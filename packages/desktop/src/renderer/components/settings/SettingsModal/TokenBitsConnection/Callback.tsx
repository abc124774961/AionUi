/** Finish only a handoff initiated in this browser tab and the same Core account. */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { completeBrowserFlow, forgetBrowserFlow, showConnectionPanel } from './browserFlow';
import { useTokenBitsRefresh } from './useConnection';

const Callback: React.FC = () => {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const refresh = useTokenBitsRefresh();
  const [active, setActive] = useState(() => !!window.__tokenBitsCallback);
  const [failed, setFailed] = useState(false);
  const completion = useRef<Promise<string> | null>(null);
  const owner = useRef<string | null>(null);
  useEffect(() => {
    if (!active || status !== 'authenticated' || !user) return;
    if (owner.current && owner.current !== user.id) {
      forgetBrowserFlow();
      setFailed(true);
      return;
    }
    owner.current = user.id;
    let disposed = false;
    completion.current ??= completeBrowserFlow(user.id);
    void completion.current
      .then(async (returnPath) => {
        if (disposed) return;
        setActive(false);
        await navigate(returnPath, { replace: true });
        await refresh();
        showConnectionPanel('sidebar');
      })
      .catch(() => {
        if (!disposed) {
          forgetBrowserFlow();
          setFailed(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [active, status, user, navigate, refresh]);
  // AuthProvider restores cookies with same-origin requests. If the Core session
  // truly expired, the ordinary login page remains available before completion.
  if (!active || status !== 'authenticated') return null;
  return (
    <Modal visible title={t('settings.tokenBits.title')} footer={null} closable={false} maskClosable={false}>
      {failed ? (
        <Alert
          type='warning'
          content={t('settings.tokenBits.failed')}
          action={
            <Button
              onClick={() => {
                setActive(false);
                void navigate('/guid', { replace: true });
              }}
            >
              {t('common.close')}
            </Button>
          }
        />
      ) : (
        <Spin tip={t('settings.tokenBits.waiting')} />
      )}
    </Modal>
  );
};
export default Callback;
