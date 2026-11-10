import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configService } from '@/common/config/configService';

const response = (status = 200, data: unknown = {}) =>
  new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  configService.reset();
  delete window.__backendPort;
  document.cookie = 'aionui-csrf-token=preferences-csrf; Path=/';
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  configService.reset();
  delete window.__backendPort;
  document.cookie = 'aionui-csrf-token=; Max-Age=0; Path=/';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser preference writes use the Core session contract', () => {
  it.each(['set', 'remove', 'setBatch'] as const)('adds CSRF when %s persists preferences', async (operation) => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetch);
    if (operation === 'set') await configService.set('language', 'zh-CN');
    if (operation === 'remove') await configService.remove('language');
    if (operation === 'setBatch') await configService.setBatch({ language: 'zh-CN', 'ui.zoomFactor': 1.25 });
    expect(fetch.mock.calls[0][1].headers['x-csrf-token']).toBe('preferences-csrf');
    expect(fetch.mock.calls[0][0]).toBe('/api/settings/client');
    expect(fetch.mock.calls[0][1].method).toBe('PUT');
  });

  it('keeps safe preference reads free of a CSRF header', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response(200, { language: 'zh-CN' })));
    vi.stubGlobal('fetch', fetch);
    await configService.whenReady();
    expect(configService.get('language')).toBe('zh-CN');
    expect(fetch.mock.calls[0][1].headers['x-csrf-token']).toBeUndefined();
  });

  it('refreshes an expired session once before replaying a preference write', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetch);
    await configService.set('language', 'en-US');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/settings/client',
      '/api/auth/refresh',
      '/api/settings/client',
    ]);
  });

  it('propagates a rejected preference write without retrying a forbidden request', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response(403)));
    vi.stubGlobal('fetch', fetch);
    await expect(configService.set('language', 'en-US')).rejects.toThrow('403');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not forward browser CSRF cookies to the Electron loopback backend', async () => {
    window.__backendPort = 13400;
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetch);
    await configService.set('language', 'en-US');
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:13400/api/settings/client');
    expect(fetch.mock.calls[0][1].headers['x-csrf-token']).toBeUndefined();
  });
});
