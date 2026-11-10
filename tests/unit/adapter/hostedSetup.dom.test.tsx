import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HostedSetup from '@/renderer/components/settings/SettingsModal/TokenBitsConnection/HostedSetup';

const mocks = vi.hoisted(() => ({
  auth: { status: 'authenticated', user: { id: 'owner' } as { id: string } | null },
  hosted: true,
  location: { pathname: '/guid', search: '?tokenbits_setup=1&keep=yes' },
  navigate: vi.fn(),
  show: vi.fn(),
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/renderer/utils/ui/hostedWorkspace', () => ({ getHostedWorkspace: () => (mocks.hosted ? {} : null) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useLocation: () => mocks.location }));
vi.mock('@/renderer/components/settings/SettingsModal/TokenBitsConnection/browserFlow', () => ({
  showConnectionPanel: mocks.show,
}));
beforeEach(() => {
  mocks.auth = { status: 'authenticated', user: { id: 'owner' } };
  mocks.hosted = true;
  mocks.location = { pathname: '/guid', search: '?tokenbits_setup=1&keep=yes' };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('hosted first-visit model confirmation', () => {
  it('opens the existing sidebar model panel once and removes only the setup marker', () => {
    render(
      <React.StrictMode>
        <HostedSetup />
      </React.StrictMode>
    );
    expect(mocks.show).toHaveBeenCalledExactlyOnceWith('sidebar');
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/guid?keep=yes', { replace: true });
  });
  it('waits for the restored Core account before opening the model panel', () => {
    mocks.auth = { status: 'checking', user: null };
    const view = render(<HostedSetup />);
    expect(mocks.show).not.toHaveBeenCalled();
    mocks.auth = { status: 'authenticated', user: { id: 'owner' } };
    view.rerender(<HostedSetup />);
    expect(mocks.show).toHaveBeenCalledExactlyOnceWith('sidebar');
  });
  it.each(['', '?tokenbits_setup=0', '?keep=yes'])(
    'does not reopen or reconnect on an ordinary visit (%s)',
    (search) => {
      mocks.location.search = search;
      render(<HostedSetup />);
      expect(mocks.show).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
    }
  );
  it('does not change a desktop or unhosted WebUI visit', () => {
    mocks.hosted = false;
    render(<HostedSetup />);
    expect(mocks.show).not.toHaveBeenCalled();
  });
  it('does not treat another route as hosted onboarding', () => {
    mocks.location.pathname = '/conversation/existing';
    render(<HostedSetup />);
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
