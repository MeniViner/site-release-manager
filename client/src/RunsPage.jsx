import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, CheckCircle2, CircleAlert, ClipboardCopy, Clock3, ExternalLink,
  FileWarning, LoaderCircle, RefreshCw, Search, X, XCircle,
} from 'lucide-react';
import { api } from './api.js';

const STATE_LABELS = {
  PREPARING_RELEASE: 'מכין ריליס', READY_FOR_SHAREPOINT: 'מוכן ל-SharePoint', DEPLOYING: 'בפריסה',
  SUCCEEDED: 'הושלם', FAILED: 'נכשל', INTERRUPTED: 'הופסק', QUEUED: 'ממתין',
};

const EVENT_STATUS = {
  started: { label: 'בתהליך', icon: Activity }, success: { label: 'הצליח', icon: CheckCircle2 },
  failed: { label: 'נכשל', icon: XCircle }, warning: { label: 'אזהרה', icon: CircleAlert }, info: { label: 'מידע', icon: Clock3 },
};

const FILTERS = [
  { value: '', label: 'כל הריצות', tone: 'all' },
  { value: 'SUCCEEDED', label: 'הושלם', tone: 'success' },
  { value: 'FAILED', label: 'נכשל', tone: 'failed' },
  { value: 'DEPLOYING', label: 'בפריסה', tone: 'deploying' },
  { value: 'READY_FOR_SHAREPOINT', label: 'מוכן ל-SharePoint', tone: 'ready' },
  { value: 'PREPARING_RELEASE', label: 'מכין ריליס', tone: 'preparing' },
  { value: 'INTERRUPTED', label: 'הופסק', tone: 'interrupted' },
];

const STAGE_ORDER = [
  { key: 'JOB_CREATED', label: 'יצירת משימה', tone: 'slate', hint: 'האתר והריליס ננעלים לריצה החדשה.' },
  { key: 'RELEASE_VALIDATED', label: 'בדיקת הריליס', tone: 'blue', hint: 'המערכת מוודאת שה-dist והקבצים קיימים.' },
  { key: 'RUNTIME_CONFIG', label: 'Runtime Config', tone: 'indigo', hint: 'נבנים host, siteCode וכל נתיבי SharePoint של האתר.' },
  { key: 'MANIFEST', label: 'Manifest וסדר העלאה', tone: 'violet', hint: 'נבנה manifest ו-index.html נשמר לסוף.' },
  { key: 'LOCAL_AUDIT', label: 'Audit מקומי (אופציונלי)', tone: 'purple', hint: 'בדיקת hashes, overlays, TXT וסימולציית פריסה מקומית. אינו חוסם פריסה אם לא הורץ.' },
  { key: 'READY_FOR_SHAREPOINT', label: 'מוכן ל-SharePoint', tone: 'amber', hint: 'כל צד השרת הסתיים ונדרש מעבר לדפדפן SharePoint.' },
  { key: 'DEPLOYER_INIT', label: 'טעינת Deployer', tone: 'yellow', hint: 'Release Manager טען את פרטי המשימה ומפעיל את מנוע SharePoint באותו דף.' },
  { key: 'TARGET_VALIDATION', label: 'אימות אתר היעד', tone: 'cyan', hint: 'נבדק שה-Deployer רץ על ה-Host הנכון.' },
  { key: 'FORM_DIGEST', label: 'חיבור ו-FormDigest', tone: 'sky', hint: 'SharePoint מחזיר FormDigest לכתיבה דרך REST.' },
  { key: 'LIBRARIES', label: 'ספריות מסמכים', tone: 'teal', hint: 'בדיקה/יצירה של siteDB ו-siteUsersDb.' },
  { key: 'FOLDERS', label: 'תיקיות', tone: 'emerald', hint: 'יצירה/בדיקה של dist, siteAssets, images ותיקיות assets.' },
  { key: 'SEED_FILES', label: 'קובצי TXT', tone: 'lime', hint: 'קבצים קיימים נשמרים וחסרים נוצרים.' },
  { key: 'RELEASE_FILES', label: 'העלאת הריליס', tone: 'orange', hint: 'קובצי ה-dist מועלים ל-SharePoint; index.html אחרון.' },
  { key: 'FINAL_VERIFY', label: 'אימות סופי', tone: 'green', hint: 'נבדקים index.html וקובץ JavaScript מתוך היעד.' },
  { key: 'COMPLETE', label: 'הושלם', tone: 'success', hint: 'הגרסה ותאריך העדכון נשמרים רק אחרי הצלחה מלאה.' },
];

const formatDate = (value) => value ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';
const duration = (ms) => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

function StateBadge({ value }) {
  return <span className={`run-state run-state-${String(value || '').toLowerCase()}`}>{STATE_LABELS[value] || value || '—'}</span>;
}

function countByState(runs, value) {
  if (!value) return runs.length;
  return runs.filter((run) => run.state === value).length;
}

function summarizeStage(events, stageKey) {
  const stageEvents = events.filter((event) => event.stage === stageKey);
  if (!stageEvents.length) return { status: 'pending', event: null, count: 0 };
  const event = stageEvents.at(-1);
  const failed = [...stageEvents].reverse().find((item) => item.status === 'failed');
  if (failed && !stageEvents.some((item) => item.status === 'success' && new Date(item.at) > new Date(failed.at))) {
    return { status: 'failed', event: failed, count: stageEvents.length };
  }
  const success = [...stageEvents].reverse().find((item) => item.status === 'success');
  if (success) return { status: 'success', event: success, count: stageEvents.length };
  const warning = [...stageEvents].reverse().find((item) => item.status === 'warning');
  if (warning) return { status: 'warning', event: warning, count: stageEvents.length };
  const started = [...stageEvents].reverse().find((item) => item.status === 'started');
  if (started) return { status: 'started', event: started, count: stageEvents.length };
  return { status: 'info', event, count: stageEvents.length };
}

export default function RunsPage() {
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setRuns(await api.runs());
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const openRun = async (id) => {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await api.run(id));
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => runs.filter((run) => {
    if (stateFilter && run.state !== stateFilter) return false;
    const haystack = `${run.site?.name || ''} ${run.site?.unit || ''} ${run.site?.host || ''} ${run.site?.siteCode || ''} ${run.release?.version || ''} ${run.currentStageLabel || ''}`.toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  }), [runs, query, stateFilter]);

  return <div className="page">
    <div className="page-header">
      <div><h1>ריצות SharePoint</h1><p>כל ניסיון פריסה נשמר שלב-שלב כדי לדעת בדיוק איפה נכשל, איזו בקשה בוצעה ומה SharePoint החזיר.</p></div>
      <div className="page-actions"><button className="secondary-button" onClick={load}><RefreshCw size={17} />רענן</button></div>
    </div>

    <div className="runs-filter-panel">
      <div className="runs-filter-chips" role="group" aria-label="סינון לפי מצב ריצה">
        {FILTERS.map((filter, index) => {
          const active = stateFilter === filter.value;
          const count = countByState(runs, filter.value);
          return <button
            type="button"
            key={filter.value || 'all'}
            className={`run-filter-chip run-filter-${filter.tone} ${active ? 'active' : ''}`}
            onClick={() => setStateFilter(filter.value)}
            aria-pressed={active}
          >
            <span className="run-filter-index">{index + 1}</span>
            <span>{filter.label}</span>
            <strong>{count}</strong>
          </button>;
        })}
      </div>
      <label className="runs-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש אתר, יחידה, Host או גרסה" /></label>
    </div>

    {error && <div className="alert"><CircleAlert size={18} />{error}<button onClick={() => setError('')}><X size={16} /></button></div>}
    {loading ? <div className="center-state"><LoaderCircle className="spin" /><p>טוען ריצות...</p></div> :
      <div className="runs-list">
        {filtered.map((run) => {
          const failed = run.failureInfo || run.error;
          const elapsed = run.finishedAt && run.startedAt ? new Date(run.finishedAt) - new Date(run.startedAt) : null;
          return <button className={`run-row ${run.state === 'FAILED' ? 'run-row-failed' : ''}`} key={run.id} onClick={() => openRun(run.id)}>
            <div className="run-main"><div className="run-title"><strong>{run.site?.name || 'אתר לא ידוע'}</strong><StateBadge value={run.state} /></div><span dir="ltr">{run.site?.host || '—'}/sites/{run.site?.siteCode || '—'}</span></div>
            <div className="run-cell"><small>ריליס</small><strong dir="ltr">{run.release?.version || '—'}</strong></div>
            <div className="run-cell"><small>שלב אחרון</small><strong>{run.currentStageLabel || run.currentStage || '—'}</strong></div>
            <div className="run-cell"><small>התחיל</small><strong>{formatDate(run.startedAt || run.createdAt)}</strong></div>
            <div className="run-cell"><small>משך</small><strong>{duration(elapsed)}</strong></div>
            <div className="run-progress-mini"><span style={{ width: `${run.progress || 0}%` }} /></div>
            {failed && <div className="run-failure-preview"><FileWarning size={16} /><span>{run.failureInfo?.message || run.error}</span></div>}
          </button>;
        })}
        {!filtered.length && <div className="empty">אין ריצות להצגה.</div>}
      </div>}

    {selectedId && <RunDetailModal run={detail} loading={detailLoading} onClose={() => { setSelectedId(''); setDetail(null); }} onRefresh={() => openRun(selectedId)} />}
  </div>;
}

function RunDetailModal({ run, loading, onClose, onRefresh }) {
  const [copied, setCopied] = useState(false);
  const events = run?.runEvents || [];
  const copyAll = async () => {
    if (!run) return;
    const lines = [
      `Run ${run.id}`,
      `Site: ${run.site?.host || ''}/sites/${run.site?.siteCode || ''}`,
      `Release: ${run.release?.version || ''}`,
      `State: ${run.state}`,
      '',
      ...events.map((event) => `[${event.at}] [${event.status}] [${event.stage}] ${event.message}${event.currentFile ? ` | ${event.currentFile}` : ''}${event.httpStatus ? ` | HTTP ${event.httpStatus}` : ''}${event.url ? ` | ${event.method || ''} ${event.url}` : ''}`),
      '',
      ...(run.logs || []),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal modal-wide run-detail-modal" onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-header run-modal-header">
        <div><h2>פרטי ריצת SharePoint</h2>{run && <small>ריצה #{String(run.id || '').slice(-6)}</small>}</div>
        <div className="run-detail-actions">
          <button className="run-action-button run-action-refresh" onClick={onRefresh}><RefreshCw size={15} />רענן</button>
          <button className="run-action-button run-action-copy" disabled={!run} onClick={copyAll}><ClipboardCopy size={15} />{copied ? 'הועתק' : 'העתק הכול'}</button>
          {run?.site?.finalUrl && <a className="run-action-button run-action-open" target="_blank" rel="noreferrer" href={run.site.finalUrl}><ExternalLink size={15} />פתח אתר יעד</a>}
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </div>
      </div>
      {loading || !run ? <div className="center-state"><LoaderCircle className="spin" /><p>טוען...</p></div> : <>
        <div className="run-detail-summary">
          <div><small>אתר</small><strong>{run.site?.name || '—'}</strong><span dir="ltr">{run.site?.host}/sites/{run.site?.siteCode}</span></div>
          <div><small>ריליס</small><strong dir="ltr">{run.release?.version || '—'}</strong><span>{run.type === 'INSTALL' ? 'התקנה' : 'עדכון'}</span></div>
          <div><small>מצב</small><StateBadge value={run.state} /><span>{run.progress || 0}%</span></div>
          <div><small>התחלה</small><strong>{formatDate(run.startedAt || run.createdAt)}</strong><span>סיום: {formatDate(run.finishedAt)}</span></div>
        </div>

        {run.failureInfo && <section className="run-failure-focus">
          <div className="failure-icon"><XCircle size={22} /></div>
          <div><h3>נקודת הכשל</h3><strong>{run.failureInfo.stageLabel || run.failureInfo.stage}</strong><p>{run.failureInfo.message}</p>
            <div className="failure-meta">
              {run.failureInfo.currentFile && <code>{run.failureInfo.currentFile}</code>}
              {run.failureInfo.httpStatus != null && <span>HTTP {run.failureInfo.httpStatus}</span>}
              {run.failureInfo.operation && <span>{run.failureInfo.operation}</span>}
              {run.failureInfo.method && <span dir="ltr">{run.failureInfo.method}</span>}
            </div>
            {run.failureInfo.url && <code className="run-url" dir="ltr">{run.failureInfo.url}</code>}
            {run.failureInfo.details?.responsePreview && <pre className="failure-preview">{run.failureInfo.details.responsePreview}</pre>}
          </div>
        </section>}

        <section className="run-stage-map-section">
          <div className="run-section-heading"><div><h3>מפת שלבי הפריסה</h3><p>השלבים תמיד מוצגים באותו סדר. הצבע והסמל מראים מיד מה עבר, מה רץ, מה נכשל ומה עדיין ממתין.</p></div><span>{STAGE_ORDER.length} שלבים</span></div>
          <div className="run-stage-map">
            {STAGE_ORDER.map((stage, index) => {
              const summary = summarizeStage(events, stage.key);
              const meta = EVENT_STATUS[summary.status] || { label: 'ממתין', icon: Clock3 };
              const Icon = summary.status === 'pending' ? Clock3 : meta.icon;
              return <article className={`run-stage-card stage-tone-${stage.tone} stage-status-${summary.status}`} key={stage.key}>
                <div className="run-stage-number">{index + 1}</div>
                <div className="run-stage-card-body">
                  <div className="run-stage-card-head"><strong>{stage.label}</strong><span><Icon size={14} />{summary.status === 'pending' ? 'ממתין' : meta.label}</span></div>
                  <p>{summary.event?.message || stage.hint}</p>
                  <div className="run-stage-card-meta">
                    {summary.event?.at && <time>{formatDate(summary.event.at)}</time>}
                    {summary.event?.durationMs != null && <small>{duration(summary.event.durationMs)}</small>}
                    {summary.event?.currentFile && <code>{summary.event.currentFile}</code>}
                  </div>
                </div>
              </article>;
            })}
          </div>
        </section>

        <section className="run-timeline-section"><div className="run-section-heading"><div><h3>אירועים מפורטים</h3><p>אירועי טלמטריה בתוך כל שלב. המספר הוא מספר השלב הקבוע — לא מספר אירוע חדש.</p></div><span>{events.length} אירועים</span></div><div className="run-timeline">
          {events.map((event, index) => {
            const meta = EVENT_STATUS[event.status] || EVENT_STATUS.info;
            const Icon = meta.icon;
            const stageNumber = STAGE_ORDER.findIndex((stage) => stage.key === event.stage) + 1;
            return <div className={`run-event run-event-${event.status}`} key={event.eventId || `${index}-${event.at}`}>
              <div className="run-event-marker"><span>{stageNumber > 0 ? stageNumber : '•'}</span><Icon size={15} /></div>
              <div className="run-event-body"><div className="run-event-head"><strong>{event.stageLabel || event.stage}</strong><span>{meta.label}</span><time>{formatDate(event.at)}</time>{event.durationMs != null && <small>{duration(event.durationMs)}</small>}</div>
                {event.message && <p>{event.message}</p>}
                <div className="run-event-meta">
                  {event.currentFile && <code>{event.currentFile}</code>}
                  {event.operation && <span>{event.operation}</span>}
                  {event.httpStatus != null && <span>HTTP {event.httpStatus}</span>}
                  {event.method && <span dir="ltr">{event.method}</span>}
                </div>
                {event.url && <code className="run-url" dir="ltr">{event.url}</code>}
                {event.details && <details><summary>פרטים נוספים</summary><pre>{JSON.stringify(event.details, null, 2)}</pre></details>}
              </div>
            </div>;
          })}
          {!events.length && <div className="empty">אין אירועי טלמטריה לריצה הזאת.</div>}
        </div></section>

        <section className="run-raw-logs"><div className="run-section-heading"><div><h3>לוג גולמי</h3><p>הלוג המקורי כפי שנשמר במערכת.</p></div><span>{(run.logs || []).length} שורות</span></div><div className="log-box audit-log-box">{(run.logs || []).length ? run.logs.map((line, i) => <div key={`${i}-${line}`}>{line}</div>) : <div>אין לוג גולמי.</div>}</div></section>
      </>}
    </div>
  </div>;
}
