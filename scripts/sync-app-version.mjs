#!/usr/bin/env node
// Sync app.json version from package.json. Run as the npm `version` hook
// (so `npm version <type>` automatically updates app.json + stages it for the
// version commit) and as the `prebuild` hook (so any `npm run build` / `pack`
// reconciles app.json against package.json before packaging).

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pkgPath = resolve(root, 'package.json');
const appJsonPath = resolve(root, 'app.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const appJsonText = readFileSync(appJsonPath, 'utf8');
const appJson = JSON.parse(appJsonText);

if (typeof pkg.version !== 'string' || !pkg.version) {
  console.error('[sync-app-version] package.json has no version; refusing to sync.');
  process.exit(1);
}

if (appJson.version === pkg.version) {
  // No-op: already in sync. Stay silent so build output isn't noisy.
  process.exit(0);
}

const before = appJson.version;
appJson.version = pkg.version;

// Detect indentation from existing file so the diff stays clean. Default to 2.
const indentMatch = appJsonText.match(/^(\s+)"/m);
const indent = indentMatch ? indentMatch[1] : '  ';
const trailingNewline = appJsonText.endsWith('\n') ? '\n' : '';
writeFileSync(appJsonPath, JSON.stringify(appJson, null, indent) + trailingNewline);

console.log(`[sync-app-version] app.json ${before} → ${pkg.version}`);
