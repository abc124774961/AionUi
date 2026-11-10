import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { tokenBitsApi, type Authorization } from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/api';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import {
  completeBrowserFlow,
  forgetBrowserFlow,
  rememberBrowserFlow,
  safeReturnPath,
} from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/browserFlow';

const state = 'a'.repeat(43);
const code = `wb_bc_${'b'.repeat(48)}`;
const issuer = 'https://api.tokenbits.net';
const flow = (): Authorization => ({
  flow_id: 'browser-1',
  mode: 'web',
  expires_at: Math.floor(Date.now() / 1000) + 600,
  authorization_url: `${issuer}/aionui/connect?state=${state}&redirect_uri=${encodeURIComponent(`${location.origin}/tokenbits/callback`)}`,
});
beforeEach(() => {
  history.replaceState(null, '', '/#/conversation/original');
  sessionStorage.clear();
});
afterEach(() => {
  forgetBrowserFlow();
  vi.restoreAllMocks();
});
function prepare() {
  const current = flow();
  rememberBrowserFlow(current, current.authorization_url, 'owner');
  window.__tokenBitsCallback = { state, code };
  return vi.spyOn(tokenBitsApi, 'complete').mockResolvedValue({ status: 'authorized' });
}
describe('TokenBits browser return boundary', () => {
  it.each([new TypeError('Failed to fetch'), new SyntaxError('Truncated response body')])(
    'recovers a lost completion body only after its exact flow reports authorized (%s)',
    async (error) => {
      prepare().mockRejectedValue(error);
      const poll = vi.spyOn(tokenBitsApi, 'poll').mockResolvedValue({ status: 'authorized', interval: 2 });
      expect(await completeBrowserFlow('owner')).toBe('/conversation/original');
      expect(poll).toHaveBeenCalledWith('browser-1');
      expect(window.__tokenBitsCallback).toBeUndefined();
    }
  );
  it('recovers an already completed flow after Core has cleared its browser binding cookie', async () => {
    prepare().mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/complete',
        status: 403,
        body: { code: 'TOKENBITS_BROWSER_BINDING' },
      })
    );
    vi.spyOn(tokenBitsApi, 'poll').mockResolvedValue({ status: 'authorized', interval: 2 });
    await expect(completeBrowserFlow('owner')).resolves.toBe('/conversation/original');
  });
  it.each(['pending', 'expired'] as const)('does not claim recovery for a %s flow', async (status) => {
    prepare().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(tokenBitsApi, 'poll').mockResolvedValue({ status, interval: 2 });
    await expect(completeBrowserFlow('owner')).rejects.toThrow();
    expect(window.__tokenBitsCallback).toEqual({ code, state });
  });
  it('does not query flow status to override a rejected state', async () => {
    prepare().mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/complete',
        status: 400,
        body: { code: 'TOKENBITS_INVALID_REQUEST' },
      })
    );
    const poll = vi.spyOn(tokenBitsApi, 'poll');
    await expect(completeBrowserFlow('owner')).rejects.toThrow();
    expect(poll).not.toHaveBeenCalled();
  });
  it('clears callback values before application imports and repairs the relative asset path', () => {
    const html = readFileSync('packages/desktop/src/renderer/index.html', 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    history.replaceState(null, '', `/tokenbits/callback#code=${code}&state=${state}`);
    window.eval(script!);
    expect(location.href).toBe(`${location.origin}/#/tokenbits/callback`);
    expect(window.__tokenBitsCallback).toEqual({ code, state });
    expect(html.indexOf('Capture short-lived')).toBeLessThan(html.indexOf('src="./main.tsx"'));
  });
  it('completes once for the original account and returns to its safe workbench path', async () => {
    const complete = prepare();
    expect(await completeBrowserFlow('owner')).toBe('/conversation/original');
    expect(complete).toHaveBeenCalledWith('browser-1', code, state);
    await expect(completeBrowserFlow('owner')).rejects.toThrow();
  });
  it('does not send a callback for another Core account', async () => {
    const complete = prepare();
    await expect(completeBrowserFlow('other-user')).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
  it('does not send attacker state even when the tab has a pending connection', async () => {
    const complete = prepare();
    window.__tokenBitsCallback = { code, state: 'x'.repeat(43) };
    await expect(completeBrowserFlow('owner')).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
  it('rejects a callback in a browser tab with no initiation context', async () => {
    const complete = prepare();
    sessionStorage.clear();
    await expect(completeBrowserFlow('owner')).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
  it('does not save callback credentials in tab storage', () => {
    prepare();
    expect(JSON.stringify(sessionStorage)).not.toContain(code);
  });
  it('fails closed when tab storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    const current = flow();
    expect(() => rememberBrowserFlow(current, current.authorization_url, 'owner')).toThrow();
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/login', '/tokenbits/callback', '/x#code=secret'])(
    'rejects unsafe return location %s',
    (path) => {
      expect(safeReturnPath(path)).toBe('/guid');
    }
  );
});
