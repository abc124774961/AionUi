/** Optional TokenBits entry points; preserves AionUi's providers and navigation. */
import React, { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Button, Modal, Tag, Tooltip } from '@arco-design/web-react';
import { LinkOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import Panel from './Panel';
import { useConnection } from './useConnection';
import { getConnectionPanel, showConnectionPanel, subscribeConnectionPanel } from './browserFlow';
export { default as TokenBitsCallback } from './Callback';

const DISMISS_KEY = 'aionui.tokenbits.welcome.dismissed';
const TokenBitsConnection: React.FC<{ placement?: 'welcome' | 'settings' | 'sidebar'; collapsed?: boolean }> = ({
  placement = 'settings',
  collapsed = false,
}) => {
  const { t } = useTranslation();
  const { data: status } = useConnection();
  const panelId = useId();
  const activePanel = useSyncExternalStore(subscribeConnectionPanel, getConnectionPanel, (): string | null => null);
  const visible = activePanel === panelId || activePanel === placement;
  const setVisible = (open: boolean) => {
    if (!open) showConnectionPanel(null);
    else if (getConnectionPanel() === null) showConnectionPanel(panelId);
  };
  useEffect(
    () => () => {
      if (getConnectionPanel() === panelId || getConnectionPanel() === placement) showConnectionPanel(null);
    },
    [panelId, placement]
  );
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const connected = status?.connected && !status.needs_reauthorization;
  if (placement === 'welcome' && !visible && (dismissed || connected)) return null;
  const label = connected ? t('settings.tokenBits.connected') : t('settings.tokenBits.connect');
  return (
    <>
      <div className={placement === 'sidebar' ? 'w-full mb-4px' : 'flex flex-wrap items-center gap-8px py-12px'}>
        {placement !== 'sidebar' && (
          <span className='text-12px text-t-secondary flex-1'>{t('settings.tokenBits.shortDescription')}</span>
        )}
        <Tooltip content={label} disabled={!collapsed}>
          <Button
            type={placement === 'settings' ? 'secondary' : 'text'}
            size='small'
            className={placement === 'sidebar' ? 'w-full !justify-start' : ''}
            icon={<LinkOne size='16' />}
            aria-label={label}
            onClick={() => setVisible(true)}
          >
            {!collapsed && label}
          </Button>
        </Tooltip>
        {placement === 'settings' && connected && <Tag>{t('settings.tokenBits.managed')}</Tag>}
        {placement === 'welcome' && (
          <Button
            type='text'
            size='small'
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(DISMISS_KEY, '1');
              } catch {
                /* Persistence may be blocked by browser policy. */
              }
            }}
          >
            {t('settings.tokenBits.later')}
          </Button>
        )}
      </div>
      <Modal
        title={t('settings.tokenBits.title')}
        style={{ width: 'min(520px, calc(100vw - 32px))' }}
        visible={visible}
        onCancel={() => setVisible(false)}
        footer={null}
        unmountOnExit
        focusLock
      >
        {visible && <Panel />}
      </Modal>
    </>
  );
};
export default TokenBitsConnection;
