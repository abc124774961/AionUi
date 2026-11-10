/** TokenBits integration added by TokenBits; AionUi remains the host product. */
import { httpRequest, type HttpRequestOptions } from '@/common/adapter/httpBridge';

export type ConnectionStatus = {
  connected: boolean;
  needs_reauthorization: boolean;
  issuer: string;
  device_id: number | null;
  account: { id: number; display_name: string } | null;
  last_sync_at: number | null;
  provider_count: number;
};
export type Authorization = {
  flow_id: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_at: number;
  interval: number;
};
export type Catalog = {
  group: string;
  groups: {
    id: string;
    name: string;
    models: { id: string; pricing: { url?: string } }[];
    recommended_model: string;
  }[];
};
export type Account = {
  account: { id: number; display_name: string };
  wallet_quota: number;
  quota_per_unit: number;
  topup_url: string;
};
export const STATUS_KEY = 'tokenbits-connection';
const prefix = '/api/integrations/tokenbits';

function request<T>(method: string, path: string, body?: unknown, options?: HttpRequestOptions): Promise<T> {
  return httpRequest<T>(method, path, body, {
    ...options,
    headers: {
      'X-AionUi-Integration': 'tokenbits',
      ...(window.__backendPort && window.__tokenBitsLocalSecret
        ? { 'X-AionUi-Local-Secret': window.__tokenBitsLocalSecret }
        : {}),
    },
  });
}

export const tokenBitsApi = {
  status: () => request<ConnectionStatus>('GET', `${prefix}/status`, undefined, { silentStatuses: [404] }),
  start: () =>
    request<Authorization>('POST', `${prefix}/device-authorizations`, {
      client_id: window.__backendPort ? 'aionui-desktop' : 'aionui-web',
      device_name: window.__backendPort ? 'AionUi Desktop' : 'AionUi Web',
    }),
  poll: (id: string) =>
    request<{ status: 'pending' | 'authorized' | 'slow_down' | 'expired' | 'denied'; interval: number }>(
      'POST',
      `${prefix}/device-authorizations/${encodeURIComponent(id)}/poll`,
      {}
    ),
  cancel: (id: string) => request<void>('DELETE', `${prefix}/device-authorizations/${encodeURIComponent(id)}`),
  catalog: () => request<Catalog>('GET', `${prefix}/catalog`),
  account: () => request<Account>('GET', `${prefix}/account`),
  sync: (group: string, models: string[]) => request<{ synced: number }>('POST', `${prefix}/sync`, { group, models }),
  disconnect: () => request<void>('DELETE', `${prefix}/connection`),
};

/** Never navigate to a URL outside the trusted issuer returned by Core. */
export function trustedUrl(value: string, issuer: string): string | null {
  try {
    const base = new URL(issuer);
    const target = new URL(value, base);
    return base.protocol === 'https:' && target.origin === base.origin && !target.username && !target.password
      ? target.href
      : null;
  } catch {
    return null;
  }
}
