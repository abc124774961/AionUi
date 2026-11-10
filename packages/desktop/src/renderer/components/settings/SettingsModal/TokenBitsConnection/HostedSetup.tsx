/** Open the original model panel only for a completed hosted onboarding visit. */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { getHostedWorkspace } from '@/renderer/utils/ui/hostedWorkspace';
import { showConnectionPanel } from './browserFlow';

const HostedSetup = (): null => {
  const { status, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current || !getHostedWorkspace() || status !== 'authenticated' || !user) return;
    const parameters = new URLSearchParams(location.search);
    if (location.pathname !== '/guid' || parameters.get('tokenbits_setup') !== '1') return;
    consumed.current = true;
    parameters.delete('tokenbits_setup');
    const query = parameters.toString();
    void navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
    showConnectionPanel('sidebar');
  }, [status, user, location.pathname, location.search, navigate]);
  return null;
};

export default HostedSetup;
