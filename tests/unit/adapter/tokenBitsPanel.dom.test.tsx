import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Panel from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/Panel';
import {
  STATUS_KEY,
  tokenBitsApi,
  type Account,
  type Catalog,
  type ConnectionStatus,
} from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/api';

vi.mock('@/common', () => ({ ipcBridge: { shell: { openExternal: { invoke: vi.fn() } } } }));
vi.mock('@/common/adapter/httpBridge', () => ({ isBackendHttpError: () => false }));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({ PROVIDERS_SWR_KEY: 'providers' }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useOptionalAuth: () => ({ user: { id: 'core-user' }, status: 'authenticated' }),
}));
vi.mock('@/renderer/components/settings/SettingsModal/TokenBitsConnection/api', () => ({
  STATUS_KEY: 'tokenbits-connection',
  trustedUrl: () => null,
  tokenBitsApi: {
    status: vi.fn(),
    account: vi.fn(),
    catalog: vi.fn(),
    disconnect: vi.fn(),
    sync: vi.fn(),
    start: vi.fn(),
    poll: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', () => ({
  Alert: ({ content, action }: { content: React.ReactNode; action?: React.ReactNode }) => (
    <div role='alert'>
      {content}
      {action}
    </div>
  ),
  Button: ({
    children,
    onClick,
    disabled,
    loading,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Popconfirm: ({ children, onOk }: { children: React.ReactNode; onOk: () => Promise<void> }) => (
    <div>
      {children}
      <button onClick={() => void onOk()}>Confirm device disconnect</button>
    </div>
  ),
  Select: ({
    id,
    mode,
    value,
    onChange,
    options,
    'aria-label': label,
  }: {
    id: string;
    mode?: string;
    value: string | string[];
    onChange: (value: string | string[]) => void;
    options: { value: string; label: string }[];
    'aria-label': string;
  }) => (
    <select
      id={id}
      aria-label={label}
      multiple={mode === 'multiple'}
      value={value}
      onChange={(event) =>
        onChange(
          mode === 'multiple'
            ? Array.from(event.currentTarget.selectedOptions, (option) => option.value)
            : event.currentTarget.value
        )
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Spin: () => <div role='status'>Loading</div>,
  Typography: {
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Paragraph: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  },
}));

const connectedStatus = (deviceId: number): ConnectionStatus => ({
  connected: true,
  needs_reauthorization: false,
  issuer: 'https://api.tokenbits.net',
  device_id: deviceId,
  // Core knows the device immediately after exchange, before /account is loaded.
  account: null,
  last_sync_at: null,
  provider_count: 0,
});
const accountFor = (id: number, name: string, dollars: number): Account => ({
  account: { id, display_name: name },
  wallet_quota: dollars * 500000,
  quota_per_unit: 500000,
  topup_url: 'https://api.tokenbits.net/console/topup',
});
const catalogFor = (prefix: string): Catalog => ({
  // A and B deliberately share the group ID; the old model selection is still invalid.
  group: 'standard',
  groups: [
    {
      id: 'standard',
      name: `${prefix} service`,
      recommended_model: `${prefix}-recommended`,
      models: [
        { id: `${prefix}-recommended`, pricing: { url: '/pricing' } },
        { id: `${prefix}-custom`, pricing: { url: '/pricing' } },
      ],
    },
  ],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderPanel() {
  // Each case gets a real isolated SWR cache. Keep A's cache entries during the switch,
  // so the test detects accidental reuse rather than hiding it by remounting the provider.
  const cache = new Map();
  let mutate!: ReturnType<typeof useSWRConfig>['mutate'];
  const CaptureCache = () => {
    mutate = useSWRConfig().mutate;
    return <Panel />;
  };
  render(
    <SWRConfig
      value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}
    >
      <CaptureCache />
    </SWRConfig>
  );
  return { refreshStatus: () => mutate([STATUS_KEY, 'core-user']) };
}

beforeEach(() => {
  vi.mocked(tokenBitsApi.sync).mockResolvedValue({ synced: 1 });
  vi.mocked(tokenBitsApi.cancel).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('TokenBits Panel account and device boundaries', () => {
  it('uses the /account identity before status knows the account, and never converts a failed balance refresh into zero', async () => {
    const account = deferred<Account>();
    vi.mocked(tokenBitsApi.status).mockResolvedValue(connectedStatus(23));
    vi.mocked(tokenBitsApi.catalog).mockResolvedValue(catalogFor('first'));
    vi.mocked(tokenBitsApi.account).mockReturnValue(account.promise);
    renderPanel();

    await waitFor(() => expect(tokenBitsApi.account).toHaveBeenCalled());
    expect(screen.getByText('settings.tokenBits.unavailable', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    await act(async () => account.resolve(accountFor(7, 'Fresh account identity', 12.5)));
    expect(await screen.findByText('Fresh account identity')).toBeInTheDocument();
    expect(screen.getByText('$12.50', { exact: false })).toBeInTheDocument();
    expect(tokenBitsApi.start).not.toHaveBeenCalled();
    expect(tokenBitsApi.sync).not.toHaveBeenCalled();

    vi.mocked(tokenBitsApi.account).mockRejectedValue(new Error('network unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'settings.tokenBits.refresh' }));
    await waitFor(() =>
      expect(screen.getByText('settings.tokenBits.unavailable', { exact: false })).toBeInTheDocument()
    );
    expect(screen.queryByText('$0.00', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText('$12.50', { exact: false })).not.toBeInTheDocument();
  });

  it('disconnects A and connects B without reusing A balance, catalog or model selection in the same SWR cache', async () => {
    let status = connectedStatus(23);
    const secondAccount = deferred<Account>();
    const secondCatalog = deferred<Catalog>();
    vi.mocked(tokenBitsApi.status).mockImplementation(async () => status);
    vi.mocked(tokenBitsApi.account).mockImplementation(() =>
      status.device_id === 24 ? secondAccount.promise : Promise.resolve(accountFor(7, 'Account A', 12.5))
    );
    vi.mocked(tokenBitsApi.catalog).mockImplementation(() =>
      status.device_id === 24 ? secondCatalog.promise : Promise.resolve(catalogFor('device-a'))
    );
    vi.mocked(tokenBitsApi.disconnect).mockImplementation(async () => {
      status = { ...connectedStatus(23), connected: false, device_id: null };
    });
    const { refreshStatus } = renderPanel();

    expect(await screen.findByText('Account A')).toBeInTheDocument();
    const models = await screen.findByLabelText('settings.tokenBits.models');
    fireEvent.change(models, { target: { value: 'device-a-custom' } });
    expect(models).toHaveValue(['device-a-custom']);
    expect(screen.getByText('$12.50', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm device disconnect' }));
    expect(await screen.findByRole('button', { name: 'settings.tokenBits.connect' })).toBeInTheDocument();
    expect(tokenBitsApi.disconnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Account A')).not.toBeInTheDocument();

    // Simulate the next authorization completing; all Panel and SWR hooks remain real.
    const accountCallsBeforeB = vi.mocked(tokenBitsApi.account).mock.calls.length;
    status = connectedStatus(24);
    await act(async () => refreshStatus());
    await waitFor(() => expect(vi.mocked(tokenBitsApi.account).mock.calls.length).toBeGreaterThan(accountCallsBeforeB));
    expect(screen.getByText('settings.tokenBits.unavailable', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Account A')).not.toBeInTheDocument();
    expect(screen.queryByText('$12.50', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/device-a-/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('settings.tokenBits.models')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00', { exact: false })).not.toBeInTheDocument();

    await act(async () => {
      secondAccount.resolve(accountFor(8, 'Account B', 3.75));
      secondCatalog.resolve(catalogFor('device-b'));
    });
    expect(await screen.findByText('Account B')).toBeInTheDocument();
    expect(screen.getByText('$3.75', { exact: false })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('settings.tokenBits.models')).toHaveValue(['device-b-recommended'])
    );
    expect(screen.queryByText(/device-a-/)).not.toBeInTheDocument();
    expect(screen.queryByText('Account A')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'settings.tokenBits.sync' }));
    await waitFor(() => expect(tokenBitsApi.sync).toHaveBeenCalledWith('standard', ['device-b-recommended']));
  });
});
