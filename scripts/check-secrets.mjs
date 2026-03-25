#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const stagedOnly = args.has('--staged');
const verbose = args.has('--verbose');

const BLOCKED_PATH_PATTERNS = [
  {
    name: 'raw env file',
    regex: /(^|\/)\.env($|\.(?!example$).+)/i,
  },
  {
    name: 'local credentials file',
    regex: /(^|\/)\.test-creds\.json$/i,
  },
  {
    name: 'private key / certificate file',
    regex: /\.(pem|p12|pfx|key)$/i,
  },
  {
    name: 'SSH private key',
    regex: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  },
];

const CONTENT_RULES = [
  {
    name: 'private key assignment',
    regex:
      /\b(?:PRIVATE_KEY|POLY_PRIVKEY|POLY_PRIVATE_KEY|POLYMARKET_PRIVATE_KEY|privateKey)\b[\w"\s-]*[:=]\s*["']?(0x[a-fA-F0-9]{64}|[a-fA-F0-9]{64})["']?/,
  },
  {
    name: 'Polymarket API credential',
    regex:
      /\b(?:apiKey|api_key|secret|apiSecret|api_secret|passphrase)\b[\w"\s-]*[:=]\s*["']([A-Za-z0-9/_+=-]{16,})["']/i,
  },
  {
    name: 'OpenAI-style API key',
    regex: /\bsk-[A-Za-z0-9]{20,}\b/,
  },
  {
    name: 'GitHub token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  },
  {
    name: 'AWS access key',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: 'JWT token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/,
  },
  {
    name: 'PEM private key block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
];

function runGit(argsList) {
  const result = spawnSync('git', argsList, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${argsList.join(' ')} failed`);
  }

  return result.stdout;
}

function getCandidatePaths() {
  const stdout = stagedOnly
    ? runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    : runGit(['ls-files', '-z']);

  return stdout
    .split('\0')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((filePath) => !filePath.startsWith('dist/'));
}

function readGitContent(filePath) {
  if (stagedOnly) {
    const result = spawnSync('git', ['show', `:${filePath}`], {
      cwd: process.cwd(),
      encoding: null,
    });

    if (result.status !== 0) {
      throw new Error(result.stderr?.toString('utf8').trim() || `git show :${filePath} failed`);
    }

    return result.stdout;
  }

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath);
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function looksLikePlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('your_') ||
    normalized.includes('placeholder') ||
    normalized.includes('example') ||
    normalized.includes('dummy') ||
    normalized.includes('redacted') ||
    normalized.includes('changeme') ||
    normalized.includes('replace_me') ||
    normalized.includes('test_only') ||
    normalized.includes('0xyour_') ||
    normalized.includes('0x...') ||
    /^(?:0x)?(?:0123456789abcdef){4}$/i.test(value) ||
    /^(?:0x)?([0-9a-f])\1{63}$/i.test(value)
  );
}

function summarizeLine(line) {
  const compact = line.trim().replace(/\s+/g, ' ');
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function scanContent(filePath, buffer) {
  if (isBinary(buffer)) return [];

  const text = buffer.toString('utf8');
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const rule of CONTENT_RULES) {
      const match = line.match(rule.regex);
      if (!match) continue;

      const matchedValue = match[1] || match[0];
      if (looksLikePlaceholder(matchedValue)) continue;

      findings.push({
        filePath,
        lineNumber: index + 1,
        rule: rule.name,
        snippet: summarizeLine(line),
      });
    }
  }

  return findings;
}

function scanPaths(paths) {
  const findings = [];

  for (const filePath of paths) {
    if (!stagedOnly && !existsSync(filePath)) {
      continue;
    }

    for (const rule of BLOCKED_PATH_PATTERNS) {
      if (rule.regex.test(filePath)) {
        findings.push({
          filePath,
          lineNumber: null,
          rule: rule.name,
          snippet: filePath,
        });
      }
    }

    const content = readGitContent(filePath);
    if (content) {
      findings.push(...scanContent(filePath, Buffer.from(content)));
    }
  }

  return findings;
}

function printFindings(findings) {
  console.error('Secret scan failed. Remove sensitive data before committing/pushing.');

  for (const finding of findings) {
    const location = finding.lineNumber
      ? `${finding.filePath}:${finding.lineNumber}`
      : finding.filePath;
    console.error(`- ${location}  [${finding.rule}]`);
    console.error(`  ${finding.snippet}`);
  }

  console.error('');
  console.error('If a value is intentionally fake, replace it with a clear placeholder like YOUR_API_KEY_HERE.');
}

function main() {
  const paths = getCandidatePaths();

  if (verbose) {
    console.log(`Scanning ${paths.length} file(s) ${stagedOnly ? 'from the index' : 'from HEAD/worktree'}...`);
  }

  const findings = scanPaths(paths);

  if (findings.length > 0) {
    printFindings(findings);
    process.exit(1);
  }

  if (verbose) {
    console.log('Secret scan passed.');
  }
}

main();
