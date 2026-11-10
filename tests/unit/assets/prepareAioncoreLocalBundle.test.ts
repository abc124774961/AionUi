import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { prepareAioncore } = require('../../../packages/shared-scripts/src/prepare-aioncore');

describe('prepare-aioncore local bundle input', () => {
  it('hard fails local bundle input that lacks managed-resources manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    mkdirSync(join(localBundle, 'managed-resources'), { recursive: true });
    writeFileSync(join(localBundle, 'aioncore.exe'), '');

    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      expect(() =>
        prepareAioncore({
          projectRoot,
          platform: 'win32',
          arch: 'x64',
          version: 'v0.1.46',
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

it.skipIf(process.platform === 'win32')('keeps a copied runtime portable after its source bundle is removed', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'aionui-relocatable-bundle-'));
  const projectRoot = join(tmp, 'project');
  const localBundle = join(tmp, 'bundle');
  const managed = join(localBundle, 'managed-resources');
  mkdirSync(join(managed, 'node/bin'), { recursive: true });
  mkdirSync(join(managed, 'node/lib'), { recursive: true });
  writeFileSync(join(localBundle, 'aioncore'), 'fixture-core');
  writeFileSync(join(managed, 'node/bin/node'), 'fixture-node');
  writeFileSync(join(managed, 'node/lib/npm.js'), 'fixture-npm');
  symlinkSync('../lib/npm.js', join(managed, 'node/bin/npm'));
  writeFileSync(
    join(managed, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      runtimeKey: 'darwin-arm64',
      node: { version: '24.11.0', root: 'node', executable: 'bin/node' },
      clis: [],
    })
  );
  const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
  process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
  try {
    const result = prepareAioncore({ projectRoot, platform: 'darwin', arch: 'arm64', version: 'v0.2.2-tokenbits' });
    rmSync(localBundle, { recursive: true, force: true });
    const copied = join(result.dir, 'managed-resources/node/bin/npm');
    expect(readlinkSync(copied)).toBe('../lib/npm.js');
    expect(readFileSync(copied, 'utf8')).toBe('fixture-npm');
  } finally {
    if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  }
});
