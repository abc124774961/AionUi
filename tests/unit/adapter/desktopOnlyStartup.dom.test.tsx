import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ zoom: vi.fn(), setZoom: vi.fn(), status: vi.fn(), subscribe: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: { application: { getZoomFactor: { invoke: mocks.zoom }, setZoomFactor: { invoke: mocks.setZoom } } },
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  webui: { getStatus: { invoke: mocks.status }, statusChanged: { on: mocks.subscribe } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import useFontScale from '@/renderer/hooks/ui/font/useFontScale';
import QuickActionButtons from '@/renderer/pages/guid/components/QuickActionButtons';

beforeEach(() => {
  delete window.electronAPI;
  mocks.zoom.mockResolvedValue(1.1);
  mocks.setZoom.mockResolvedValue(1.2);
  mocks.status.mockResolvedValue({ running: true });
  mocks.subscribe.mockReturnValue(vi.fn());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('desktop startup capabilities', () => {
  it('does not request Electron zoom in a browser', async () => {
    const { result } = renderHook(useFontScale);
    await act(async () => result.current[1](1.2));
    expect(mocks.zoom).not.toHaveBeenCalled();
    expect(mocks.setZoom).not.toHaveBeenCalled();
  });

  it('continues to read and update Electron zoom on desktop', async () => {
    vi.stubGlobal('electronAPI', {});
    const { result } = renderHook(useFontScale);
    await act(async () => result.current[1](1.2));
    expect(mocks.zoom).toHaveBeenCalledOnce();
    expect(mocks.setZoom).toHaveBeenCalledWith({ factor: 1.2 });
  });

  it('does not offer or poll a desktop WebUI service from the browser', async () => {
    render(
      <MemoryRouter>
        <QuickActionButtons
          onOpenLink={vi.fn()}
          onOpenBugReport={vi.fn()}
          inactiveBorderColor='gray'
          activeShadow='none'
        />
      </MemoryRouter>
    );
    await act(async () => {});
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(screen.queryByText(/settings.webui/)).toBeNull();
  });
});
