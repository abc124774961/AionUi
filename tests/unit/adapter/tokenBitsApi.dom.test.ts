import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenBitsApi, trustedUrl } from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/api';
import { httpRequest, resolveCoreCsrfToken } from '@/common/adapter/httpBridge';

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__backendPort;
  delete window.__tokenBitsLocalSecret;
  document.cookie = 'aionui-csrf-token=; Max-Age=0; Path=/';
});
describe('TokenBits trusted issuer navigation', () => {
  it('resolves a relative pricing page on the exact HTTPS issuer', () => {
    expect(trustedUrl('/pricing', 'https://api.tokenbits.net')).toBe('https://api.tokenbits.net/pricing');
  });
  it.each([
    'https://attacker.example/a',
    '//attacker.example/a',
    'javascript:alert(1)',
    'https://user:password@api.tokenbits.net',
  ])('rejects untrusted navigation %s', (input) => {
    expect(trustedUrl(input, 'https://api.tokenbits.net')).toBeNull();
  });
});
describe('local integration access boundary', () => {
  it('attaches its process secret only to the local Core facade', async () => {
    window.__backendPort = 13400;
    window.__tokenBitsLocalSecret = 'process-secret';
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { connected: false } }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetch);
    await tokenBitsApi.status();
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:13400/api/integrations/tokenbits/status');
    expect(fetch.mock.calls[0][1].headers).toEqual({
      'X-AionUi-Integration': 'tokenbits',
      'X-AionUi-Local-Secret': 'process-secret',
    });
  });
  it('never attaches a desktop secret to the browser same-origin request', async () => {
    window.__tokenBitsLocalSecret = 'stale-secret';
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: {} }), { headers: { 'Content-Type': 'application/json' } })
      );
    vi.stubGlobal('fetch', fetch);
    await tokenBitsApi.status();
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'X-AionUi-Integration': 'tokenbits' });
  });
});
describe('Core WebUI CSRF double-submit', () => {
  it('includes the current cookie on mutations and omits it on safe reads', async () => {
    document.cookie = 'aionui-csrf-token=csrf-example; Path=/';
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
      );
    vi.stubGlobal('fetch', fetch);
    await httpRequest('POST', '/api/example', {});
    await httpRequest('GET', '/api/example');
    expect(fetch.mock.calls[0][1].headers['x-csrf-token']).toBe('csrf-example');
    expect(fetch.mock.calls[1][1].headers['x-csrf-token']).toBeUndefined();
  });
  it('does not use WebUI cookies for the Electron loopback connection', () => {
    window.__backendPort = 13400;
    document.cookie = 'aionui-csrf-token=csrf-example; Path=/';
    expect(resolveCoreCsrfToken()).toBe('');
  });
});
