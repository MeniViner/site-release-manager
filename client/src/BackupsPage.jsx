import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, CircleAlert, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { api } from './api.js';

const OUTCOMES = {
  PASSED: 'הצליח',
  PARTIAL: 'חלקי',
  FAILED: 'נכשל',
  SKIPPED_FRESH_TARGET: 'דולג — יעד חדש',
  SKIPPED_UNSUPPORTED_BACKEND: 'דולג — Backend לא נתמך',
  IN_PROGRESS: 'בתהליך',
};

const formatDate = (value) => value
  ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—';

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
};

export default function BackupsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [backups, setBackups] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const siteId = searchParams.get('siteId') || '';
  const backend = searchParams.get('backend') || '';
  const outcome = searchParams.get('outcome') || '';

  const load = async () => {
    setLoading(true);
    try {
      const [records, siteItems] = await Promise.all([
        api.backups({ siteId, backend, outcome }),
        api.sites(),
      ]);
      setBackups(records);
      setSites(siteItems);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [siteId, backend, outcome]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const summary = useMemo(() => ({
    total: backups.length,
    passed: backups.filter((item) => item.outcome === 'PASSED').length,
    warnings: backups.filter((item) => ['PARTIAL', 'FAILED'].includes(item.outcome)).length,
  }), [backups]);

  return <div className="page backups-page">
    <div className="page-header"><div><h1>גיבויים</h1><p>מעקב מרכזי אחר גיבויי TXT שנשמרים ב-SharePoint. המטא-דאטה כאן מוכן גם לאסטרטגיות Backend עתידיות.</p></div><div className="page-actions"><button className="secondary-button" onClick={load}><RefreshCw size={17} />רענן</button></div></div>
    <div className="backup-metrics"><div><strong>{summary.total}</strong><span>רשומות</span></div><div><strong>{summary.passed}</strong><span>הצליחו</span></div><div><strong>{summary.warnings}</strong><span>דורשים תשומת לב</span></div></div>
    <div className="backup-filters">
      <label><span>אתר</span><select value={siteId} onChange={(event) => setFilter('siteId', event.target.value)}><option value="">כל האתרים</option>{sites.map((site) => <option value={site.id} key={site.id}>{site.name} · {site.siteDbFolder}</option>)}</select></label>
      <label><span>Backend</span><select value={backend} onChange={(event) => setFilter('backend', event.target.value)}><option value="">הכול</option><option value="txt">TXT</option><option value="mongo">Mongo (עתידי)</option></select></label>
      <label><span>תוצאה</span><select value={outcome} onChange={(event) => setFilter('outcome', event.target.value)}><option value="">הכול</option>{Object.entries(OUTCOMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {error && <div className="alert"><CircleAlert size={18} />{error}<button aria-label="סגור הודעת שגיאה" onClick={() => setError('')}><X size={16} /></button></div>}
    {loading ? <div className="center-state"><LoaderCircle className="spin" /><p>טוען גיבויים...</p></div> : <div className="table-card backups-table"><table><thead><tr><th>אתר / יעד לוגי</th><th>Backend</th><th>נוצר</th><th>גרסת מקור</th><th>גרסה נכנסת</th><th>תוצאה</th><th>קבצים</th><th>גודל</th><th>ריצה</th><th>פעולות</th></tr></thead><tbody>
      {backups.map((backup) => <tr key={backup.id}>
        <td><div className="backup-target-cell"><strong>{backup.site?.name}</strong><span dir="ltr">{backup.target?.siteCode} · {backup.target?.siteDbFolder} + {backup.target?.usersDbFolder}</span></div></td>
        <td><span className="backend-pill">{String(backup.storageBackend || '').toUpperCase()}</span></td>
        <td>{formatDate(backup.createdAt)}</td>
        <td dir="ltr">{backup.sourceVersion || '—'}</td>
        <td dir="ltr">{backup.incomingVersion || '—'}</td>
        <td><span className={`backup-outcome backup-${String(backup.outcome).toLowerCase()}`}>{OUTCOMES[backup.outcome] || backup.outcome}</span></td>
        <td>{backup.copiedCount}/{backup.fileCount}</td>
        <td dir="ltr">{formatBytes(backup.totalSizeBytes)}</td>
        <td><Link to={`/runs?runId=${backup.runId}`} dir="ltr">#{backup.runId.slice(-6)}</Link></td>
        <td><div className="backup-actions">
          {backup.site?.finalUrl && <a href={backup.site.finalUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />פתח אתר</a>}
          {backup.site?.tracked && <Link to={`/sites/${backup.siteId}`}><Archive size={14} />פרטי אתר</Link>}
          <Link to={`/runs?runId=${backup.runId}`}>פתח ריצה</Link>
          {backup.backupUrl && <a href={backup.backupUrl} target="_blank" rel="noreferrer">פתח תיקיית גיבוי</a>}
        </div></td>
      </tr>)}
      {!backups.length && <tr><td colSpan="10"><div className="empty">אין גיבויים שתואמים לסינון.</div></td></tr>}
    </tbody></table></div>}
  </div>;
}
