import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';
import { api } from './api.js';
import { deploySharePointJob } from './sharepointDeploymentEngine.js';

const runningJobs = new Set();

export default function SharePointDeploymentCoordinator() {
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const host = window.location.hostname.toLowerCase();
    const local = ['localhost', '127.0.0.1'].includes(host);

    const tick = async () => {
      if (cancelled || busyRef.current || local) return;
      try {
        const runs = await api.runs();
        const ready = runs.find((run) => ['READY_FOR_SHAREPOINT', 'DEPLOYING'].includes(run.state) && run.site?.host?.toLowerCase() === host);
        if (!ready || runningJobs.has(ready.id)) return;

        busyRef.current = true;
        runningJobs.add(ready.id);
        setStatus({ jobId: ready.id, progress: Number(ready.progress || 40), stage: 'READY_FOR_SHAREPOINT', message: `מתחיל פריסה של ${ready.site?.name || 'האתר'}…`, error: '' });
        try {
          const result = await deploySharePointJob(ready.id, {
            onProgress(next) {
              if (!cancelled) setStatus((previous) => ({ ...previous, jobId: ready.id, ...next, error: '' }));
            },
          });
          if (!cancelled) setStatus({ jobId: ready.id, progress: 100, stage: 'COMPLETE', message: 'הפריסה הושלמה בהצלחה.', finalUrl: result.finalUrl, done: true, error: '' });
        } catch (error) {
          if (!cancelled) setStatus({ jobId: ready.id, progress: 100, stage: error.stage || 'FAILED', message: 'פריסת SharePoint נכשלה.', error: error.message, failed: true });
        } finally {
          runningJobs.delete(ready.id);
          busyRef.current = false;
        }
      } catch (error) {
        if (!cancelled) console.warn('[release-manager] deployment coordinator poll failed', error);
      }
    };

    tick();
    timerRef.current = window.setInterval(tick, 1800);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  if (!status) return null;
  return <div className={`global-deployment-banner ${status.failed ? 'failed' : status.done ? 'done' : ''}`}>
    <div className="global-deployment-icon">{status.failed ? <CircleAlert size={18} /> : status.done ? <CheckCircle2 size={18} /> : <LoaderCircle className="spin" size={18} />}</div>
    <div className="global-deployment-copy">
      <strong>{status.failed ? 'פריסת SharePoint נכשלה' : status.done ? 'פריסת SharePoint הושלמה' : 'פריסת SharePoint רצה ברקע'}</strong>
      <span>{status.error || status.message}</span>
      {!status.done && !status.failed && <div className="global-deployment-progress"><span style={{ width: `${Math.max(0, Math.min(100, status.progress || 0))}%` }} /></div>}
    </div>
    <strong className="global-deployment-percent">{status.progress || 0}%</strong>
  </div>;
}
