import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHostedWorkspace,
  HOSTED_GUARD_KEY,
  HOSTED_SUBJECT_KEY,
  initializeHostedWorkspace,
  withHostedWorkspaceUrl,
} from '@/renderer/utils/ui/hostedWorkspace';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import { resolveBackendAssetUrl } from '@/renderer/utils/platform';
import { registerPwa } from '@/renderer/services/registerPwa';

vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: () => '' }));
const guard = 'g'.repeat(43);
const subject = 'a'.repeat(64);
const configuration = { guard, subject, issuer: 'https://api.tokenbits.net' };
let cleanup = (): void => {};
let fetchRequest = vi.fn();
const reload = vi.fn();
const socketURLs: string[] = [];
const eventURLs: string[] = [];
const socketClose = vi.fn();
const eventClose = vi.fn();
class SocketFixture extends EventTarget {
  constructor(url: string | URL, _protocols?: string | string[]) {
    super();
    socketURLs.push(String(url));
  }
  close = socketClose;
}
class EventFixture extends EventTarget {
  constructor(url: string | URL, _options?: EventSourceInit) {
    super();
    eventURLs.push(String(url));
  }
  close = eventClose;
}
beforeEach(() => {
  vi.stubGlobal('electronAPI', undefined);
  window.__backendPort = undefined;
  window.__TOKENBITS_HOSTED__ = { ...configuration };
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.style.visibility = '';
  document.body.innerHTML = '<main id="root">Private account content</main>';
  fetchRequest = vi.fn().mockResolvedValue(new Response('ok'));
  vi.stubGlobal('fetch', fetchRequest);
  vi.stubGlobal('WebSocket', SocketFixture);
  vi.stubGlobal('EventSource', EventFixture);
  socketURLs.length = 0;
  eventURLs.length = 0;
});
afterEach(() => {
  cleanup();
  cleanup = () => {};
  delete window.__TOKENBITS_HOSTED__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const install = (): void => {
  cleanup = initializeHostedWorkspace(window, reload);
};

describe('hosted document request boundary', () => {
  it('does not install an offline worker that could cache hosted session HTML', async () => {
    const register = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
    install();
    await registerPwa();
    expect(register).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    { ...configuration, guard: 'short' },
    { ...configuration, subject: 'user' },
    { ...configuration, issuer: 'http://issuer.invalid' },
  ])('leaves an absent or malformed hosted configuration inactive (%j)', (value) => {
    window.__TOKENBITS_HOSTED__ = value;
    install();
    expect(getHostedWorkspace()).toBeNull();
    expect(window.fetch).toBe(fetchRequest);
  });
  it('keeps Electron requests and native URLs unchanged even if a hosted marker is present', () => {
    vi.stubGlobal('electronAPI', {});
    install();
    expect(window.fetch).toBe(fetchRequest);
    expect(withHostedWorkspaceUrl('/api/fs/stream')).toBe('/api/fs/stream');
  });
  it('captures the document guard once and preserves caller headers', async () => {
    install();
    window.__TOKENBITS_HOSTED__ = { ...configuration, guard: 'b'.repeat(43) };
    await fetch('/api/auth/user', { headers: { Accept: 'application/json' } });
    const headers = fetchRequest.mock.calls[0][1].headers as Headers;
    expect(headers.get('X-TokenBits-Workspace')).toBe(guard);
    expect(headers.get('Accept')).toBe('application/json');
  });
  it('preserves Request objects and their headers while adding the guard', async () => {
    install();
    const request = new Request(`${location.origin}/api/save`, {
      method: 'POST',
      body: 'payload',
      headers: { 'Content-Type': 'text/plain' },
    });
    await fetch(request);
    expect(fetchRequest.mock.calls[0][0]).toBe(request);
    expect(fetchRequest.mock.calls[0][1].headers.get('Content-Type')).toBe('text/plain');
    expect(fetchRequest.mock.calls[0][1].headers.get('X-TokenBits-Workspace')).toBe(guard);
  });
  it('does not wrap an external fetch or attach its document guard', async () => {
    install();
    const options = { headers: { Accept: 'text/plain' } };
    await fetch('https://external.invalid/api/file', options);
    expect(fetchRequest).toHaveBeenCalledWith('https://external.invalid/api/file', options);
  });
  it('guards same-origin XHR uploads without changing external uploads', () => {
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {});
    vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
    const header = vi.spyOn(XMLHttpRequest.prototype, 'setRequestHeader').mockImplementation(() => {});
    install();
    const local = new XMLHttpRequest();
    local.open('POST', '/api/fs/upload');
    local.send('file');
    const remote = new XMLHttpRequest();
    remote.open('POST', 'https://external.invalid/upload');
    remote.send('file');
    expect(header).toHaveBeenCalledExactlyOnceWith('X-TokenBits-Workspace', guard);
  });
  it('guards WebSockets and SSE while preserving remote destinations', () => {
    install();
    const local = new WebSocket(`${location.origin.replace('http', 'ws')}/ws?channel=1`);
    const remote = new WebSocket('wss://external.invalid/ws');
    const events = new EventSource('/api/channel/weixin/login');
    expect(new URL(socketURLs[0]).searchParams.get('__tb_guard')).toBe(guard);
    expect(socketURLs[1]).toBe('wss://external.invalid/ws');
    expect(new URL(eventURLs[0]).searchParams.get('__tb_guard')).toBe(guard);
    local.close();
    remote.close();
    events.close();
  });
  it('keeps external SSE free of the hosted guard', () => {
    install();
    const events = new EventSource('https://external.invalid/events');
    expect(eventURLs).toEqual(['https://external.invalid/events']);
    events.close();
  });
  it('guards centralized file and avatar URLs but preserves static and remote assets', () => {
    install();
    const file = buildFileStreamUrl({ kind: 'project', pe_id: 'project', relative_path: 'preview.pdf' });
    expect(new URL(file).searchParams.get('__tb_guard')).toBe(guard);
    expect(new URL(resolveBackendAssetUrl('/api/assistants/one/avatar')!).searchParams.get('__tb_guard')).toBe(guard);
    expect(['/assets/icon.svg', 'https://external.invalid/api/avatar'].map(withHostedWorkspaceUrl)).toEqual([
      '/assets/icon.svg',
      'https://external.invalid/api/avatar',
    ]);
  });
  it('replaces stale guard query values on native API URLs', () => {
    install();
    const url = new URL(withHostedWorkspaceUrl('/api/ppt-proxy/5000?__tb_guard=old&slide=2'));
    expect(url.searchParams.getAll('__tb_guard')).toEqual([guard]);
    expect(url.searchParams.get('slide')).toBe('2');
  });
});

describe('hosted account changes', () => {
  it.each([HOSTED_SUBJECT_KEY, HOSTED_GUARD_KEY, null])(
    'hides the previous account and reloads once after %s changes',
    (key) => {
      install();
      sessionStorage.setItem('private-preview', 'old content');
      const event = new StorageEvent('storage', { key, newValue: key ? 'changed' : null });
      window.dispatchEvent(event);
      window.dispatchEvent(event);
      expect(document.body.textContent).toBe('');
      expect(sessionStorage.getItem('private-preview')).toBeNull();
      expect(reload).toHaveBeenCalledTimes(1);
    }
  );
  it('aborts old requests and closes streams without deleting the new account markers', async () => {
    install();
    await fetch('/api/conversations');
    const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
    const events = new EventSource('/api/events');
    localStorage.setItem(HOSTED_SUBJECT_KEY, 'b'.repeat(64));
    window.dispatchEvent(new StorageEvent('storage', { key: HOSTED_SUBJECT_KEY, newValue: 'b'.repeat(64) }));
    expect(fetchRequest.mock.calls[0][1].signal.aborted).toBe(true);
    expect([vi.mocked(socket.close).mock.calls.length, vi.mocked(events.close).mock.calls.length]).toEqual([1, 1]);
    expect(localStorage.getItem(HOSTED_SUBJECT_KEY)).toBe('b'.repeat(64));
  });
  it('aborts an in-flight upload on account change but leaves completed uploads alone', () => {
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {});
    vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {});
    vi.spyOn(XMLHttpRequest.prototype, 'setRequestHeader').mockImplementation(() => {});
    install();
    const pending = new XMLHttpRequest();
    const finished = new XMLHttpRequest();
    const pendingAbort = vi.spyOn(pending, 'abort');
    const finishedAbort = vi.spyOn(finished, 'abort');
    for (const request of [pending, finished]) {
      request.open('POST', '/api/fs/upload');
      request.send('file');
    }
    finished.dispatchEvent(new Event('loadend'));
    window.dispatchEvent(new StorageEvent('storage', { key: HOSTED_SUBJECT_KEY, newValue: 'changed' }));
    expect(pendingAbort).toHaveBeenCalledTimes(1);
    expect(finishedAbort).not.toHaveBeenCalled();
  });
  it('rejects a new request from an invalidated document', () => {
    install();
    window.dispatchEvent(new StorageEvent('storage', { key: HOSTED_GUARD_KEY, newValue: 'changed' }));
    expect(() => fetch('/api/save')).toThrow('Workspace session changed');
    expect(fetchRequest).not.toHaveBeenCalled();
  });
  it('does not reload for unrelated preferences or unchanged session markers', () => {
    install();
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
    window.dispatchEvent(new StorageEvent('storage', { key: HOSTED_GUARD_KEY, newValue: guard }));
    expect(reload).not.toHaveBeenCalled();
  });
  it('rejects a stale document before application startup if a newer session is already stored', () => {
    localStorage.setItem(HOSTED_GUARD_KEY, 'b'.repeat(43));
    install();
    expect(getHostedWorkspace()).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
