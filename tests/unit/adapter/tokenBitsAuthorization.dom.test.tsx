import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenBitsApi, type Authorization } from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/api';
import { useAuthorization } from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/useConnection';

vi.mock('@/common', () => ({
  ipcBridge: { shell: { openExternal: { invoke: vi.fn().mockResolvedValue(undefined) } } },
}));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({ PROVIDERS_SWR_KEY: 'providers' }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useOptionalAuth: () => undefined }));
vi.mock('@/renderer/components/settings/SettingsModal/TokenBitsConnection/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/components/settings/SettingsModal/TokenBitsConnection/api')>()),
  STATUS_KEY: 'tokenbits-connection',
  tokenBitsApi: { start: vi.fn(), poll: vi.fn(), cancel: vi.fn(), sync: vi.fn() },
}));
const authorization: Authorization = {
  flow_id: 'flow-1',
  authorization_url: 'https://api.tokenbits.net/aionui/connect',
  mode: 'desktop',
  expires_at: 1900000000,
};
function wrapper({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>{children}</SWRConfig>;
}
describe('optional TokenBits authorization', () => {
  beforeEach(() => {
    window.__backendPort = 13400;
    vi.useFakeTimers();
    vi.setSystemTime(1800000000000);
    vi.mocked(tokenBitsApi.start).mockResolvedValue(authorization);
    vi.mocked(tokenBitsApi.cancel).mockResolvedValue(undefined);
    vi.mocked(tokenBitsApi.poll).mockResolvedValue({ status: 'pending', interval: 5 });
  });
  afterEach(() => {
    cleanup();
    delete window.__backendPort;
    vi.useRealTimers();
    vi.resetAllMocks();
  });
  it('coalesces repeated clicks and never creates model connections during authorization', async () => {
    const { result } = renderHook(() => useAuthorization('https://api.tokenbits.net'), { wrapper });
    await act(async () => {
      await Promise.all([result.current.start(), result.current.start()]);
    });
    expect(tokenBitsApi.start).toHaveBeenCalledTimes(1);
    expect(tokenBitsApi.sync).not.toHaveBeenCalled();
    expect(result.current.flow?.flow_id).toBe('flow-1');
  });
  it('stops polling and cancels a pending flow when the panel closes', async () => {
    const { result, unmount } = renderHook(() => useAuthorization('https://api.tokenbits.net'), { wrapper });
    await act(async () => {
      await result.current.start();
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(tokenBitsApi.cancel).toHaveBeenCalledWith('flow-1');
    expect(tokenBitsApi.poll).not.toHaveBeenCalled();
  });
  it('cleans up authorization issued after the panel has closed', async () => {
    let release!: (value: Authorization) => void;
    vi.mocked(tokenBitsApi.start).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const { result, unmount } = renderHook(() => useAuthorization('https://api.tokenbits.net'), { wrapper });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.start();
    });
    unmount();
    await act(async () => {
      release(authorization);
      await pending;
    });
    expect(tokenBitsApi.cancel).toHaveBeenCalledWith('flow-1');
    expect(tokenBitsApi.poll).not.toHaveBeenCalled();
  });
  it('honors the server interval without an overlapping poll', async () => {
    vi.mocked(tokenBitsApi.poll).mockResolvedValue({ status: 'pending', interval: 15 });
    const { result } = renderHook(() => useAuthorization('https://api.tokenbits.net'), { wrapper });
    await act(async () => {
      await result.current.start();
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(tokenBitsApi.poll).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(tokenBitsApi.poll).toHaveBeenCalledTimes(2);
  });
  it('shows a recoverable failure when the browser authorization expires', async () => {
    vi.mocked(tokenBitsApi.poll).mockResolvedValue({ status: 'expired', interval: 5 });
    const { result } = renderHook(() => useAuthorization('https://api.tokenbits.net'), { wrapper });
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.failure).toBe('expired');
    expect(result.current.flow).toBeNull();
    expect(tokenBitsApi.sync).not.toHaveBeenCalled();
  });
  it('does not poll an expired flow', async () => {
    vi.mocked(tokenBitsApi.start).mockResolvedValue({ ...authorization, expires_at: 1800000001 });
    const { result } = renderHook(() => useAuthorization('https://api.tokenbits.net'), { wrapper });
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.failure).toBe('expired');
    expect(tokenBitsApi.poll).not.toHaveBeenCalled();
  });
});
