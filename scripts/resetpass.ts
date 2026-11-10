#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Node/Bun CLI — resets the WebUI admin password for the standalone
 * `bun run webui` host (independent of Electron).
 *
 * Uses Core's local account CLI against the explicitly resolved data directory.
 * No HTTP server is started and no remote reset endpoint is exposed.
 *
 * Usage:
 *   bun run resetpass                 # default work dir
 *   bun run resetpass --data-dir /x   # custom work dir
 *   AIONUI_DATA_DIR=/x bun run resetpass
 *   NODE_ENV=production bun run resetpass
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { setAdminPasswordWithCli } from '../packages/web-cli/src/ensureAdminPassword.js';

const BACKEND_BINARY = process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg: string) => console.log(`${colors.blue}i${colors.reset} ${msg}`),
  success: (msg: string) => console.log(`${colors.green}OK${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}ERR${colors.reset} ${msg}`),
  warning: (msg: string) => console.log(`${colors.yellow}WARN${colors.reset} ${msg}`),
  highlight: (msg: string) => console.log(`${colors.cyan}${colors.bright}${msg}${colors.reset}`),
};

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  return next && !next.startsWith('--') ? next : undefined;
}

/**
 * Same resolution as scripts/webui.ts:resolveBackendDataDir — keep both in sync
 * so `bun run webui` and `bun run resetpass` always target the same SQLite DB.
 * See the comment there for why the default is `~/.aionui-web*` (not `~/.aionui*`).
 */
function resolveWorkDir(): string {
  const override = getFlag('--data-dir') ?? process.env.AIONUI_DATA_DIR;
  if (override && override.trim().length > 0) {
    const resolved = path.resolve(override);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }
  const suffix =
    process.env.NODE_ENV === 'production' ? '' : process.env.AIONUI_MULTI_INSTANCE === '1' ? '-dev-2' : '-dev';
  const dir = path.join(os.homedir(), `.aionui-web${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveBackendBinary(): string {
  if (process.env.AIONUI_BACKEND_BIN) return process.env.AIONUI_BACKEND_BIN;

  const bundledBase = process.env.AIONUI_BACKEND_BUNDLED_DIR ?? path.join(repoRoot, 'resources', 'bundled-aioncore');
  const runtimeKey = `${process.platform}-${process.arch}`;
  const bundled = path.join(bundledBase, runtimeKey, BACKEND_BINARY);
  if (fs.existsSync(bundled)) return bundled;

  try {
    const cmd = process.platform === 'win32' ? `where ${BACKEND_BINARY}` : `which ${BACKEND_BINARY}`;
    const found = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return found;
  } catch {
    // fall through
  }

  throw new Error(
    `Cannot find "${BACKEND_BINARY}". Set AIONUI_BACKEND_BIN, put it on PATH, or place it at ${bundled}.`
  );
}

// Skip flag values (e.g. `--data-dir /some/path`) so they don't get picked up
// as the username positional argument.
const FLAGS_WITH_VALUES = new Set(['--data-dir', '--port']);

function resolveUsername(): string {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      if (FLAGS_WITH_VALUES.has(a)) i++; // skip the flag's value too
      continue;
    }
    positional.push(a);
  }
  return positional[0] || 'admin';
}

async function main(): Promise<void> {
  const username = resolveUsername();
  const workDir = resolveWorkDir();

  log.info(`Target user: ${username} (advisory — operates on system_default_user)`);
  log.info(`Work dir   : ${workDir}`);

  try {
    const newPassword = await setAdminPasswordWithCli(resolveBackendBinary(), workDir);
    log.success('Password reset successfully.');
    log.info('New password:');
    log.highlight(newPassword);
    log.warning('Please change this password after next login.');
    log.warning('Existing sessions are not revoked by this command.');
  } catch (error) {
    log.error(error instanceof Error ? error.message : 'Password reset failed');
    process.exitCode = 1;
  }
}

void main();
