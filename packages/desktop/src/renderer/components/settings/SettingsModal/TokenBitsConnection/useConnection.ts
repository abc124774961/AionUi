/** TokenBits integration added by TokenBits. No model request is made by this hook. */
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useOptionalAuth } from '@/renderer/hooks/context/AuthContext';
import { PROVIDERS_SWR_KEY } from '@/renderer/hooks/agent/useModelProviderList';
import { STATUS_KEY, tokenBitsApi, type Authorization } from './api';
import { ipcBridge } from '@/common';
import { authorizationUrl, rememberBrowserFlow } from './browserFlow';

export function useConnection() {
  const auth = useOptionalAuth();
  return useSWR(
    auth && auth.status !== 'authenticated' ? null : [STATUS_KEY, auth?.user?.id ?? 'desktop'],
    tokenBitsApi.status,
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );
}

/** Own one authorization flow per open panel. Secrets remain entirely in Core. */
export function useAuthorization(issuer: string) {
  const coreUser = useOptionalAuth()?.user?.id ?? 'desktop';
  const { mutate } = useSWRConfig();
  const [flow, setFlow] = useState<Authorization | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<'expired' | 'network' | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const active = useRef<Authorization | null>(null);
  const handedOff = useRef(false);

  const cancel = useCallback(() => {
    generation.current += 1;
    const previous = active.current;
    active.current = null;
    setFlow(null);
    setBusy(false);
    if (previous) void tokenBitsApi.cancel(previous.flow_id).catch(() => {});
  }, []);

  useEffect(
    () => () => {
      generation.current += 1;
      const previous = active.current;
      active.current = null;
      if (previous && !handedOff.current) void tokenBitsApi.cancel(previous.flow_id).catch(() => {});
    },
    [coreUser]
  );

  const start = useCallback(async () => {
    if (starting.current || active.current) return;
    starting.current = true;
    handedOff.current = false;
    setBusy(true);
    setFailure(null);
    const revision = generation.current;
    try {
      const result = await tokenBitsApi.start();
      if (revision !== generation.current) {
        await tokenBitsApi.cancel(result.flow_id).catch(() => {});
        return;
      }
      active.current = result;
      const url = authorizationUrl(result, issuer);
      if (window.__backendPort) {
        if (result.mode !== 'desktop') throw new Error('Invalid TokenBits mode');
        await ipcBridge.shell.openExternal.invoke(url);
      } else {
        rememberBrowserFlow(result, url, coreUser);
        handedOff.current = true;
        window.location.assign(url);
      }
      if (revision === generation.current) setFlow(result);
    } catch {
      if (revision === generation.current) {
        cancel();
        setFailure('network');
      }
    } finally {
      starting.current = false;
      if (revision === generation.current) setBusy(false);
    }
  }, [issuer, coreUser, cancel]);

  useEffect(() => {
    if (!flow || flow.mode !== 'desktop') return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed) return;
      if (Date.now() >= flow.expires_at * 1000) {
        setFailure('expired');
        cancel();
        return;
      }
      try {
        const result = await tokenBitsApi.poll(flow.flow_id);
        if (disposed) return;
        if (result.status === 'authorized') {
          active.current = null;
          setFlow(null);
          await mutate((key) => Array.isArray(key) && key[0] === STATUS_KEY);
          return;
        }
        if (result.status === 'expired') {
          setFailure(result.status);
          cancel();
          return;
        }
        timer = setTimeout(() => void poll(), Math.max(2, result.interval) * 1000);
      } catch {
        if (!disposed) {
          setFailure('network');
          cancel();
        }
      }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [flow, cancel, mutate]);

  return { flow, busy, failure, start, cancel };
}

export function useTokenBitsRefresh() {
  const { mutate } = useSWRConfig();
  return useCallback(async () => {
    await Promise.all([
      mutate(PROVIDERS_SWR_KEY),
      mutate((key) => Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('tokenbits-')),
    ]);
  }, [mutate]);
}
