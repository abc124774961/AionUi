/** TokenBits integration added by TokenBits, using AionUi's existing UI components. */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Popconfirm, Select, Space, Spin, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { useOptionalAuth } from '@/renderer/hooks/context/AuthContext';
import { ipcBridge } from '@/common';
import { tokenBitsApi, trustedUrl } from './api';
import { useAuthorization, useConnection, useTokenBitsRefresh } from './useConnection';

const Panel: React.FC = () => {
  const { t } = useTranslation();
  const coreUser = useOptionalAuth()?.user?.id ?? 'desktop';
  const { data: status, error: statusError, mutate: reloadStatus } = useConnection();
  const auth = useAuthorization(status?.browser_origin ?? status?.issuer ?? '');
  const attempted = useRef(false);
  const ready = status?.connected && !status.needs_reauthorization && !!status.device_id;
  const {
    data: catalog,
    error: catalogError,
    mutate: reloadCatalog,
  } = useSWR(ready ? ['tokenbits-catalog', coreUser, status.issuer, status.device_id] : null, tokenBitsApi.catalog, {
    shouldRetryOnError: false,
  });
  const {
    data: account,
    error: accountError,
    mutate: reloadAccount,
  } = useSWR(ready ? ['tokenbits-account', coreUser, status.issuer, status.device_id] : null, tokenBitsApi.account, {
    shouldRetryOnError: false,
  });
  const [group, setGroup] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'network' | 'revocation' | null>(null);
  const refresh = useTokenBitsRefresh();
  useEffect(() => {
    if (!status || statusError || attempted.current) return;
    attempted.current = true;
    if (!ready) void auth.start();
  }, [status, statusError, ready, auth.start]);
  const currentGroup = catalog?.groups.find((item) => item.id === group);
  useEffect(() => {
    setGroup('');
    setModels([]);
  }, [coreUser, status?.device_id]);
  useEffect(() => {
    if (!catalog || group) return;
    const preferred = catalog.groups.find((item) => item.id === catalog.group) ?? catalog.groups[0];
    if (preferred) {
      setGroup(preferred.id);
      setModels(preferred.recommended_model ? [preferred.recommended_model] : []);
    }
  }, [catalog, group]);
  const action = async (perform: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(null);
    try {
      await perform();
      await refresh();
    } catch (error) {
      setFailed(
        isBackendHttpError(error) && error.code === 'TOKENBITS_REVOCATION_UNCONFIRMED' ? 'revocation' : 'network'
      );
    } finally {
      setBusy(false);
    }
  };
  const open = (value: string) => {
    const url = status && trustedUrl(value, status.issuer);
    if (!url) {
      setFailed('network');
      return;
    }
    if (window.__backendPort) void ipcBridge.shell.openExternal.invoke(url).catch(() => setFailed('network'));
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
  const balance =
    account &&
    Number.isFinite(account.wallet_quota) &&
    Number.isFinite(account.quota_per_unit) &&
    account.quota_per_unit > 0
      ? (account.wallet_quota / account.quota_per_unit).toFixed(2)
      : null;

  if (!status && !statusError) return <Spin />;
  if (statusError)
    return (
      <Alert
        type='warning'
        content={t('settings.tokenBits.failed')}
        action={<Button onClick={() => void reloadStatus()}>{t('settings.tokenBits.refresh')}</Button>}
      />
    );
  return (
    <div className='flex flex-col gap-16px text-t-primary'>
      <Typography.Paragraph className='!mb-0 text-t-secondary'>
        {t('settings.tokenBits.description')}
      </Typography.Paragraph>
      {(failed || auth.failure) && (
        <Alert
          type='warning'
          content={
            failed === 'revocation'
              ? t('settings.tokenBits.revocationUnconfirmed')
              : auth.failure === 'expired'
                ? t('settings.tokenBits.expired')
                : t('settings.tokenBits.failed')
          }
        />
      )}
      {failed === 'revocation' && (
        <Button onClick={() => open('/console/personal')}>{t('settings.tokenBits.devices')}</Button>
      )}
      {status?.needs_reauthorization && <Alert type='warning' content={t('settings.tokenBits.reconnect')} />}
      {!ready ? (
        auth.flow || auth.busy ? (
          <>
            <Alert type='info' content={t('settings.tokenBits.waiting')} />
            <Button onClick={auth.cancel}>{t('common.cancel')}</Button>
          </>
        ) : (
          <Button type='primary' onClick={() => void auth.start()}>
            {t('settings.tokenBits.connect')}
          </Button>
        )
      ) : (
        <>
          <div className='flex flex-wrap items-center justify-between gap-8px'>
            <Typography.Text bold>{account?.account?.display_name ?? status?.account?.display_name}</Typography.Text>
            <Typography.Text>
              {t('settings.tokenBits.balance')}:{' '}
              {accountError || balance === null ? t('settings.tokenBits.unavailable') : `$${balance}`}
            </Typography.Text>
          </div>
          <Space wrap>
            <Button onClick={() => open(account?.topup_url ?? '/console/topup')}>
              {t('settings.tokenBits.account')}
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                void action(async () => {
                  await Promise.all([reloadStatus(), reloadCatalog(), reloadAccount()]);
                })
              }
            >
              {t('settings.tokenBits.refresh')}
            </Button>
          </Space>
          <Typography.Paragraph className='!mb-0 text-t-secondary'>
            {t('settings.tokenBits.modelHelp')} {t('settings.tokenBits.billingNotice')}
          </Typography.Paragraph>
          {catalogError ? (
            <Alert type='warning' content={t('settings.tokenBits.failed')} />
          ) : !catalog ? (
            <Spin />
          ) : catalog.groups.length === 0 ? (
            <Alert type='info' content={t('settings.tokenBits.noModels')} />
          ) : (
            <>
              <label className='text-12px text-t-secondary' htmlFor='tokenbits-group'>
                {t('settings.tokenBits.group')}
              </label>
              <Select
                id='tokenbits-group'
                aria-label={t('settings.tokenBits.group')}
                value={group}
                onChange={(value: string) => {
                  setGroup(value);
                  const selected = catalog.groups.find((item) => item.id === value);
                  setModels(selected?.recommended_model ? [selected.recommended_model] : []);
                }}
                options={catalog.groups.map((item) => ({ value: item.id, label: item.name }))}
              />
              <label className='text-12px text-t-secondary' htmlFor='tokenbits-models'>
                {t('settings.tokenBits.models')}
              </label>
              <Select
                id='tokenbits-models'
                aria-label={t('settings.tokenBits.models')}
                mode='multiple'
                maxTagCount={4}
                showSearch
                value={models}
                onChange={setModels}
                options={(currentGroup?.models ?? []).map((item) => ({ value: item.id, label: item.id }))}
              />
              <div className='flex flex-wrap justify-between items-center gap-8px'>
                <Button
                  type='primary'
                  loading={busy}
                  disabled={!group || !models.length || models.length > 20}
                  onClick={() => void action(() => tokenBitsApi.sync(group, models))}
                >
                  {t('settings.tokenBits.sync')}
                </Button>
                <Button type='text' onClick={() => open('/pricing')}>
                  {t('settings.tokenBits.pricing')}
                </Button>
              </div>
            </>
          )}
          {!!status?.provider_count && (
            <Alert type='success' content={t('settings.tokenBits.ready', { count: status.provider_count })} />
          )}
          <Typography.Paragraph className='!mb-0 text-12px text-t-secondary'>
            {t('settings.tokenBits.scope')}
          </Typography.Paragraph>
          <Popconfirm title={t('settings.tokenBits.disconnectConfirm')} onOk={() => action(tokenBitsApi.disconnect)}>
            <Button status='danger' type='text' loading={busy}>
              {t('settings.tokenBits.disconnect')}
            </Button>
          </Popconfirm>
        </>
      )}
    </div>
  );
};
export default Panel;
