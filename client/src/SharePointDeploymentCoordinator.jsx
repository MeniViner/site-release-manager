import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, Users } from 'lucide-react';
import { api } from './api.js';
import { deploySharePointJob } from './sharepointDeploymentEngine.js';

/**
 * Same-page SharePoint deployment.
 *
 * When Release Manager is served from the SharePoint host that owns the target,
 * deployment runs here — the user never has to open a separate deployer page.
 *
 * Exclusivity is enforced by the SERVER lease, not by this module: several tabs
 * may poll, but only the one that wins the lease mutates SharePoint. A tab that
 * loses simply reports that another worker owns the run.
 */

/** Jobs in these states still have SharePoint work left and can be resumed. */
const RESUMABLE = ['READY_FOR_SHAREPOINT', 'WAITING_FOR_BROWSER', 'DEPLOYING', 'PAUSED'];

const inFlight = new Set();

export default function SharePointDeploymentCoordinator() {
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const host = window.location.hostname.toLowerCase();
    const isLocalPreview = ['localhost', '127.0.0.1'].includes(host);

    const tick = async () => {
      if (cancelled || busyRef.current || isLocalPreview) return;
      try {
        const runs = await api.runs();
        const candidate = runs.find((run) => RESUMABLE.includes(run.state) && run.site?.host?.toLowerCase() === host);
        if (!candidate || inFlight.has(candidate.id)) return;

        busyRef.current = true;
        inFlight.add(candidate.id);
        setStatus({
          jobId: candidate.id,
          progress: Number(candidate.progress || 35),
          stage: candidate.currentStage || 'BROWSER_ACTIVATE',
          message: candidate.state === 'PAUSED'
            ? `ממשיך פריסה שנקטעה של ${candidate.site?.name || 'האתר'}…`
            : `מתחיל פריסה של ${candidate.site?.name || 'האתר'}…`,
          error: '',
        });

        try {
          const result = await deploySharePointJob(candidate.id, {
            onProgress(next) {
              if (!cancelled) setStatus((previous) => ({ ...previous, jobId: candidate.id, ...next, error: '' }));
            },
          });
          if (!cancelled) {
            setStatus({ jobId: candidate.id, progress: 100, stage: 'COMPLETE', message: 'הפריסה הושלמה בהצלחה.', finalUrl: result.finalUrl, done: true, error: '' });
          }
        } catch (error) {
          if (cancelled) return;
          // Losing the lease is not a deployment failure: another tab owns it.
          if (error.apiCode === 'LEASE_HELD' || error.apiCode === 'LEASE_RACE' || error.apiCode === 'LEASE_LOST') {
            setStatus({ jobId: candidate.id, progress: Number(candidate.progress || 0), stage: candidate.currentStage || '', message: 'הפריסה מתבצעת בלשונית אחרת של Release Manager.', foreign: true, error: '' });
            return;
          }
          if (error.apiCode === 'JOB_SETTLED') { setStatus(null); return; }
          setStatus({
            jobId: candidate.id,
            progress: 100,
            stage: error.failureInfo?.stage || 'FAILED',
            message: 'פריסת SharePoint נכשלה.',
            error: error.message,
            nextAction: error.failureInfo?.nextAction || '',
            failed: true,
          });
        } finally {
          inFlight.delete(candidate.id);
          busyRef.current = false;
        }
      } catch (error) {
        if (!cancelled) console.warn('[release-manager] deployment coordinator poll failed', error);
      }
    };

    tick();
    timerRef.current = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  if (!status) return null;

  const icon = status.failed ? <CircleAlert size={18} />
    : status.done ? <CheckCircle2 size={18} />
      : status.foreign ? <Users size={18} />
        : <LoaderCircle className="spin" size={18} />;

  const title = status.failed ? 'פריסת SharePoint נכשלה'
    : status.done ? 'פריסת SharePoint הושלמה'
      : status.foreign ? 'הפריסה רצה בלשונית אחרת'
        : 'פריסת SharePoint רצה ברקע';

  return <div className={`global-deployment-banner ${status.failed ? 'failed' : status.done ? 'done' : ''}`}>
    <div className="global-deployment-icon">{icon}</div>
    <div className="global-deployment-copy">
      <strong>{title}</strong>
      <span>{status.error || status.message}</span>
      {status.nextAction && <span className="global-deployment-next">{status.nextAction}</span>}
      {!status.done && !status.failed && !status.foreign && (
        <div className="global-deployment-progress"><span style={{ width: `${Math.max(0, Math.min(100, status.progress || 0))}%` }} /></div>
      )}
    </div>
    <strong className="global-deployment-percent">{status.progress || 0}%</strong>
  </div>;
}
