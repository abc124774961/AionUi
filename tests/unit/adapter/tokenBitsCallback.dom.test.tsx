import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Callback from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/Callback';

const mocks = vi.hoisted(() => ({
  auth: { status: 'checking', user: null as { id: string } | null },
  complete: vi.fn(),
  forget: vi.fn(),
  show: vi.fn(),
  navigate: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/components/settings/SettingsModal/TokenBitsConnection/browserFlow', () => ({
  completeBrowserFlow: mocks.complete,
  forgetBrowserFlow: mocks.forget,
  showConnectionPanel: mocks.show,
}));
vi.mock('@/renderer/components/settings/SettingsModal/TokenBitsConnection/useConnection', () => ({
  useTokenBitsRefresh: () => mocks.refresh,
}));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Modal: ({ children }: { children: React.ReactNode }) => <div role='dialog'>{children}</div>,
  Alert: ({ content }: { content: React.ReactNode }) => <div role='alert'>{content}</div>,
  Spin: () => <div role='status' />,
}));
beforeEach(() => {
  window.__tokenBitsCallback = { state: 'state', code: 'code' };
  mocks.auth = { status: 'checking', user: null };
  mocks.complete.mockResolvedValue('/conversation/original');
  mocks.refresh.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  delete window.__tokenBitsCallback;
  vi.resetAllMocks();
});
describe('TokenBits callback authentication recovery', () => {
  it('waits for restored Core identity before completing and returns without a grant button', async () => {
    const { rerender } = render(<Callback />);
    expect(mocks.complete).not.toHaveBeenCalled();
    mocks.auth = { status: 'authenticated', user: { id: 'owner' } };
    rerender(<Callback />);
    await waitFor(() => expect(mocks.show).toHaveBeenCalledWith('sidebar'));
    expect(mocks.navigate).toHaveBeenCalledWith('/conversation/original', { replace: true });
  });
  it('completes only once even if StrictMode replays effects', async () => {
    mocks.auth = { status: 'authenticated', user: { id: 'owner' } };
    render(
      <React.StrictMode>
        <Callback />
      </React.StrictMode>
    );
    await waitFor(() => expect(mocks.show).toHaveBeenCalled());
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it('shows a failure without retrying or reopening the connection panel', async () => {
    mocks.auth = { status: 'authenticated', user: { id: 'owner' } };
    mocks.complete.mockRejectedValue(new Error('binding rejected'));
    const { rerender } = render(<Callback />);
    await screen.findByRole('alert');
    rerender(<Callback />);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.show).not.toHaveBeenCalled();
  });
  it('does not attach a completed callback to a different Core account', async () => {
    let release!: (path: string) => void;
    mocks.complete.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve;
      })
    );
    mocks.auth = { status: 'authenticated', user: { id: 'owner' } };
    const { rerender } = render(<Callback />);
    mocks.auth = { status: 'authenticated', user: { id: 'other' } };
    rerender(<Callback />);
    await act(async () => release('/conversation/original'));
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
