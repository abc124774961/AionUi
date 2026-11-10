/** Browser handoff metadata is tab-scoped; credentials and PKCE remain in Core. */
import { tokenBitsApi, trustedUrl, type Authorization } from './api';
import { isBackendHttpError } from '@/common/adapter/httpBridge';

const HANDOFF_KEY = 'aionui.tokenbits.browser-flow';
type Handoff = { flowId: string; state: string; userId: string; returnPath: string; expiresAt: number };
type Callback = { code: string; state: string };
declare global {
  interface Window {
    /** Captured and removed from the address bar by index.html before app bootstrap. */
    __tokenBitsCallback?: Callback;
  }
}

export function safeReturnPath(value: unknown): string {
  return typeof value === 'string' &&
    /^\/(?!\/)/.test(value) &&
    !/[\\\r\n#]/.test(value) &&
    !value.startsWith('/tokenbits/') &&
    !value.startsWith('/login')
    ? value
    : '/guid';
}

export function authorizationUrl(flow: Authorization, issuer: string): string {
  const trusted = trustedUrl(flow.authorization_url, issuer);
  if (!trusted || new URL(trusted).pathname !== '/aionui/connect' || flow.expires_at * 1000 <= Date.now()) {
    throw new Error('Invalid TokenBits browser authorization');
  }
  return trusted;
}

export function rememberBrowserFlow(flow: Authorization, url: string, userId: string): void {
  const parameters = new URL(url).searchParams;
  const state = parameters.get('state') ?? '';
  if (
    flow.mode !== 'web' ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(state) ||
    parameters.get('redirect_uri') !== `${window.location.origin}/tokenbits/callback`
  ) {
    throw new Error('Invalid TokenBits browser handoff');
  }
  const handoff: Handoff = {
    flowId: flow.flow_id,
    state,
    userId,
    returnPath: safeReturnPath(window.location.hash.slice(1)),
    expiresAt: flow.expires_at,
  };
  // Fail closed if tab storage is unavailable; never navigate without return context.
  sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
}

export function forgetBrowserFlow(): void {
  delete window.__tokenBitsCallback;
  try {
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    /* Storage can be disabled. */
  }
}

export async function completeBrowserFlow(userId: string): Promise<string> {
  const callback = window.__tokenBitsCallback;
  const handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) ?? 'null') as Handoff | null;
  if (
    !callback ||
    !handoff ||
    handoff.userId !== userId ||
    handoff.state !== callback.state ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(callback.state) ||
    !/^wb_bc_[A-Za-z0-9_-]{48}$/.test(callback.code) ||
    typeof handoff.flowId !== 'string' ||
    !handoff.flowId ||
    !Number.isFinite(handoff.expiresAt) ||
    handoff.expiresAt * 1000 <= Date.now()
  ) {
    throw new Error('Invalid TokenBits browser callback');
  }
  const response = await tokenBitsApi
    .complete(handoff.flowId, callback.code, callback.state)
    .catch(async (error: unknown) => {
      const uncertain =
        error instanceof TypeError ||
        error instanceof SyntaxError ||
        (error instanceof DOMException && error.name === 'NetworkError') ||
        (isBackendHttpError(error) && error.status === 403 && error.code === 'TOKENBITS_BROWSER_BINDING');
      if (!uncertain) throw error;
      // Core may have saved the account and cleared its binding cookie before the
      // response body reached us. Recover only the exact locally validated flow.
      const status = await tokenBitsApi.poll(handoff.flowId);
      if (status.status !== 'authorized') throw error;
      return { status: 'authorized' as const };
    });
  if (response.status !== 'authorized') throw new Error('TokenBits connection incomplete');
  forgetBrowserFlow();
  return safeReturnPath(handoff.returnPath);
}

// There are three entry points, but only one connection panel may own a flow.
let activePanel: string | null = null;
const panelListeners = new Set<() => void>();
export const getConnectionPanel = (): string | null => activePanel;
export function showConnectionPanel(id: string | null): void {
  activePanel = id;
  panelListeners.forEach((listener) => listener());
}
export function subscribeConnectionPanel(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => {
    panelListeners.delete(listener);
  };
}
