import { describe, it, expect, vi } from 'vitest';
import { TradingService } from '../../services/trading-service.js';
import { RateLimiter } from '../../core/rate-limiter.js';
import { createUnifiedCache } from '../../core/unified-cache.js';

const VALID_PK = '0x' + '1'.repeat(64);
const VALID_BUILDER_CODE = '0x' + 'c'.repeat(64);

function makeService(fakeClient: Record<string, unknown>) {
  const service = new TradingService(new RateLimiter(), createUnifiedCache(), {
    privateKey: VALID_PK,
    builderCode: VALID_BUILDER_CODE,
    safeAddress: '0x' + 'a'.repeat(40),
  });
  (service as any).initialized = true;
  (service as any).clobClient = fakeClient;
  return service;
}

describe('TradingService presigned orders', () => {
  it('presignMarketOrder creates a signed payload without posting', async () => {
    const createMarketOrder = vi.fn(async () => ({ salt: 'signed' }));
    const postOrder = vi.fn();
    const service = makeService({ createMarketOrder, postOrder });

    const presigned = await service.presignMarketOrder({
      tokenId: 'token-1',
      side: 'BUY',
      amount: 3,
      price: 0.5,
      orderType: 'FAK',
      tickSize: '0.001',
      negRisk: false,
    }, { key: 'key-1', ttlMs: 250 });

    expect(presigned.key).toBe('key-1');
    expect(presigned.kind).toBe('market');
    expect(presigned.orderType).toBe('FAK');
    expect(presigned.fingerprint.walletMode).toBe('builder_safe');
    expect(presigned.fingerprint.maker).toBe('0x' + 'a'.repeat(40));
    expect(createMarketOrder).toHaveBeenCalledTimes(1);
    expect(postOrder).not.toHaveBeenCalled();
  });

  it('postPresignedOrder posts exactly the provided signed payload once', async () => {
    const signedOrder = { salt: 'signed' };
    const postOrder = vi.fn(async () => ({
      success: true,
      orderID: 'clob-order-1',
      status: 'matched',
    }));
    const service = makeService({ postOrder });

    const result = await service.postPresignedOrder({
      key: 'key-1',
      kind: 'market',
      orderType: 'FAK',
      signedOrder: signedOrder as any,
      fingerprint: {
        tokenId: 'token-1',
        side: 'BUY',
        orderType: 'FAK',
        amount: 3,
        walletMode: 'builder_safe',
        maker: '0x' + 'a'.repeat(40),
        signer: '0x' + 'b'.repeat(40),
        signatureType: 2,
      },
      createdAt: Date.now(),
      telemetry: {
        startedAt: Date.now(),
        totalMs: 0,
      },
    });

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('clob-order-1');
    expect(result.telemetry?.presignHit).toBe(true);
    expect(result.telemetry?.signAndBuildMs).toBe(0);
    expect(postOrder).toHaveBeenCalledWith(signedOrder, 'FAK');
  });

  it('blocks duplicate post of the same presigned object before CLOB', async () => {
    const postOrder = vi.fn(async () => ({ success: true, orderID: 'clob-order-1' }));
    const service = makeService({ postOrder });
    const presigned = {
      key: 'key-1',
      kind: 'market' as const,
      orderType: 'FAK' as const,
      signedOrder: { salt: 'signed' } as any,
      fingerprint: {
        tokenId: 'token-1',
        side: 'BUY' as const,
        orderType: 'FAK' as const,
        amount: 3,
        walletMode: 'builder_safe',
        maker: '0x' + 'a'.repeat(40),
        signer: '0x' + 'b'.repeat(40),
        signatureType: 2,
      },
      createdAt: Date.now(),
      telemetry: { startedAt: Date.now(), totalMs: 0 },
    };

    await service.postPresignedOrder(presigned);
    const second = await service.postPresignedOrder(presigned);

    expect(second.success).toBe(false);
    expect(second.errorMsg).toMatch(/already been used/);
    expect(postOrder).toHaveBeenCalledTimes(1);
  });

  it('fingerprints deposit-wallet identity with POLY_1271 maker/funder', () => {
    const depositWallet = '0x' + 'd'.repeat(40);
    const service = new TradingService(new RateLimiter(), createUnifiedCache(), {
      privateKey: VALID_PK,
      builderCode: VALID_BUILDER_CODE,
      walletMode: 'deposit_wallet',
      signatureType: 3,
      funderAddress: depositWallet,
    });

    const identity = service.getWalletIdentity();

    expect(identity.walletMode).toBe('deposit_wallet');
    expect(identity.maker).toBe(depositWallet);
    expect(identity.funder).toBe(depositWallet);
    expect(identity.signatureType).toBe(3);
    expect(identity.builderCode).toBe(VALID_BUILDER_CODE);
  });

  it('rejects deposit-wallet mode without an explicit maker/funder', () => {
    const service = new TradingService(new RateLimiter(), createUnifiedCache(), {
      privateKey: VALID_PK,
      builderCode: VALID_BUILDER_CODE,
      walletMode: 'deposit_wallet',
    });

    expect(() => service.getWalletIdentity()).toThrow(/deposit_wallet wallet mode requires funderAddress/);
  });
});
