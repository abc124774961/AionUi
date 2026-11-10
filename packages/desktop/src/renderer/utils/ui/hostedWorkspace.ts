/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type HostedWorkspace = Readonly<{ guard: string; subject: string; issuer: string }>;

declare global {
  interface Window {
    __TOKENBITS_HOSTED__?: unknown;
  }
}

export const HOSTED_SUBJECT_KEY = 'aionui.tokenbits.hosted-subject';
export const HOSTED_GUARD_KEY = 'aionui.tokenbits.hosted-guard';
const WORKSPACE_HEADER = 'X-TokenBits-Workspace';
const GUARD_QUERY = '__tb_guard';
type BrowserWindow = Window & typeof globalThis;
let active: { session: HostedWorkspace; origin: string; invalidated: boolean } | null = null;

/** Return the immutable configuration captured for this hosted document only. */
export function getHostedWorkspace(): HostedWorkspace | null {
  return active && !active.invalidated ? active.session : null;
}

function readConfiguration(target: BrowserWindow): HostedWorkspace | null {
  if (target.electronAPI || target.__backendPort || !/^https?:$/.test(target.location.protocol)) return null;
  const value = target.__TOKENBITS_HOSTED__;
  if (!value || typeof value !== 'object') return null;
  const { guard, subject, issuer } = value as Record<string, unknown>;
  if (
    typeof guard !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(guard) ||
    typeof subject !== 'string' ||
    !/^[a-f0-9]{64}$/.test(subject) ||
    typeof issuer !== 'string'
  ) {
    return null;
  }
  try {
    const parsed = new URL(issuer);
    if (parsed.protocol !== 'https:' || parsed.origin !== issuer) return null;
  } catch {
    return null;
  }
  return Object.freeze({ guard, subject, issuer });
}

/** Bind native media, download and iframe URLs without changing external URLs. */
export function withHostedWorkspaceUrl(value: string): string {
  if (!active || active.invalidated) return value;
  try {
    const url = new URL(value, active.origin);
    if (url.origin !== active.origin || !url.pathname.startsWith('/api/')) return value;
    url.searchParams.set(GUARD_QUERY, active.session.guard);
    return url.toString();
  } catch {
    return value;
  }
}

/** Install before browser adapters can issue requests. Ordinary WebUI and Electron are unchanged. */
export function initializeHostedWorkspace(
  target: BrowserWindow = window,
  reload: () => void = () => target.location.reload()
): () => void {
  if (active) return () => {};
  const session = readConfiguration(target);
  if (!session) return () => {};
  const runtime = { session, origin: target.location.origin, invalidated: false };
  active = runtime;
  const pending = new AbortController();
  const sockets = new Set<WebSocket>();
  const sources = new Set<EventSource>();
  const uploads = new Set<XMLHttpRequest>();
  const localRequests = new WeakSet<XMLHttpRequest>();
  const originalFetch = target.fetch;
  const originalOpen = target.XMLHttpRequest.prototype.open;
  const originalSend = target.XMLHttpRequest.prototype.send;
  const OriginalWebSocket = target.WebSocket;
  const OriginalEventSource = target.EventSource;

  const sameOrigin = (value: string): boolean => {
    try {
      return new URL(value, target.location.href).origin === runtime.origin;
    } catch {
      return false;
    }
  };
  const ensureCurrent = (): void => {
    if (runtime.invalidated) throw new DOMException('Workspace session changed', 'AbortError');
  };
  const invalidate = (): void => {
    if (runtime.invalidated) return;
    runtime.invalidated = true;
    pending.abort();
    uploads.forEach((request) => request.abort());
    sockets.forEach((socket) => socket.close());
    sources.forEach((source) => source.close());
    try {
      // Shared localStorage belongs to the NEW session now; only clear this
      // tab's private state. Reload discards React, SWR and preview memory.
      target.sessionStorage.clear();
    } catch {
      // Storage may be disabled. Hiding the old document is still mandatory.
    }
    target.document.documentElement.style.visibility = 'hidden';
    target.document.body?.replaceChildren();
    reload();
  };

  target.fetch = (input, init) => {
    const request = input instanceof Request ? input : null;
    if (!sameOrigin(request ? request.url : String(input))) return originalFetch.call(target, input, init);
    ensureCurrent();
    const headers = new Headers(init?.headers ?? request?.headers);
    headers.set(WORKSPACE_HEADER, session.guard);
    const callerSignal = init?.signal ?? request?.signal;
    const signal = callerSignal ? AbortSignal.any([callerSignal, pending.signal]) : pending.signal;
    return originalFetch.call(target, input, { ...init, headers, signal });
  };

  target.XMLHttpRequest.prototype.open = function (method, url, async = true, username?, password?) {
    localRequests.delete(this);
    if (sameOrigin(String(url))) localRequests.add(this);
    originalOpen.call(this, method, url, async, username, password);
  };
  target.XMLHttpRequest.prototype.send = function (body) {
    if (localRequests.has(this)) {
      ensureCurrent();
      this.setRequestHeader(WORKSPACE_HEADER, session.guard);
      uploads.add(this);
      this.addEventListener('loadend', () => uploads.delete(this), { once: true });
    }
    originalSend.call(this, body);
  };

  target.WebSocket = class HostedWebSocket extends OriginalWebSocket {
    constructor(value: string | URL, protocols?: string | string[]) {
      const url = new URL(value, target.location.href);
      const httpOrigin = url.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
      const local = httpOrigin === runtime.origin;
      if (local) {
        ensureCurrent();
        url.searchParams.set(GUARD_QUERY, session.guard);
      }
      super(local ? url.toString() : value, protocols);
      if (local) {
        sockets.add(this);
        this.addEventListener('close', () => sockets.delete(this), { once: true });
      }
    }
  };
  if (OriginalEventSource) {
    target.EventSource = class HostedEventSource extends OriginalEventSource {
      constructor(value: string | URL, options?: EventSourceInit) {
        const local = sameOrigin(String(value));
        if (local) ensureCurrent();
        super(local ? withHostedWorkspaceUrl(String(value)) : value, options);
        if (local) sources.add(this);
      }
    };
  }

  const changed = (event: StorageEvent): void => {
    if (event.storageArea && event.storageArea !== target.localStorage) return;
    if (
      event.key === null ||
      (event.key === HOSTED_SUBJECT_KEY && event.newValue !== session.subject) ||
      (event.key === HOSTED_GUARD_KEY && event.newValue !== session.guard)
    ) {
      invalidate();
    }
  };
  target.addEventListener('storage', changed);
  try {
    const subject = target.localStorage.getItem(HOSTED_SUBJECT_KEY);
    const guard = target.localStorage.getItem(HOSTED_GUARD_KEY);
    if ((subject && subject !== session.subject) || (guard && guard !== session.guard)) invalidate();
  } catch {
    // The signed, server-injected document remains the identity source.
  }
  return () => {
    target.removeEventListener('storage', changed);
    target.fetch = originalFetch;
    target.XMLHttpRequest.prototype.open = originalOpen;
    target.XMLHttpRequest.prototype.send = originalSend;
    target.WebSocket = OriginalWebSocket;
    if (OriginalEventSource) target.EventSource = OriginalEventSource;
    pending.abort();
    active = null;
  };
}

if (typeof window !== 'undefined') initializeHostedWorkspace();
