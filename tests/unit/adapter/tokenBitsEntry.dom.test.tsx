import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TokenBitsConnection from '@/renderer/components/settings/SettingsModal/TokenBitsConnection';
const mocks = vi.hoisted(() => ({ data: { connected: false, needs_reauthorization: false } }));
vi.mock('@/renderer/components/settings/SettingsModal/TokenBitsConnection/useConnection', () => ({
  useConnection: () => mocks,
}));
vi.mock('@/renderer/components/settings/SettingsModal/TokenBitsConnection/Panel', () => ({
  default: () => <div data-testid='tokenbits-panel' />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@icon-park/react', () => ({ LinkOne: () => <span /> }));
vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': label,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    'aria-label'?: string;
  }) => (
    <button onClick={onClick} aria-label={label}>
      {children}
    </button>
  ),
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div role='dialog'>{children}</div> : null,
}));
beforeEach(() => {
  localStorage.clear();
  mocks.data = { connected: false, needs_reauthorization: false };
});
afterEach(cleanup);
describe('AionUi optional connection entry', () => {
  it('persists Later on the welcome page without hiding settings or sidebar access', () => {
    const { unmount } = render(<TokenBitsConnection placement='welcome' />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.tokenBits.later' }));
    expect(screen.queryByRole('button', { name: 'settings.tokenBits.connect' })).toBeNull();
    unmount();
    render(<TokenBitsConnection placement='welcome' />);
    render(<TokenBitsConnection placement='settings' />);
    expect(screen.getAllByRole('button', { name: 'settings.tokenBits.connect' })).toHaveLength(1);
  });
  it('opens the connection panel only after the user chooses its entry', () => {
    render(<TokenBitsConnection placement='sidebar' collapsed />);
    expect(screen.queryByTestId('tokenbits-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'settings.tokenBits.connect' }));
    expect(screen.getByTestId('tokenbits-panel')).toBeInTheDocument();
  });
  it('keeps model configuration open after authorization succeeds from the welcome page', () => {
    const { rerender } = render(<TokenBitsConnection placement='welcome' />);
    fireEvent.click(screen.getByRole('button', { name: 'settings.tokenBits.connect' }));
    mocks.data.connected = true;
    rerender(<TokenBitsConnection placement='welcome' />);
    expect(screen.getByTestId('tokenbits-panel')).toBeInTheDocument();
  });
  it('hides the welcome promotion once connected while retaining sidebar status', () => {
    mocks.data.connected = true;
    render(<TokenBitsConnection placement='welcome' />);
    render(<TokenBitsConnection placement='sidebar' />);
    expect(screen.queryByText('settings.tokenBits.shortDescription')).toBeNull();
    expect(screen.getByRole('button', { name: 'settings.tokenBits.connected' })).toBeInTheDocument();
  });
});
