import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive, ArrowRight, CheckCircle2, CircleAlert, Database, ExternalLink,
  FileText, History, LoaderCircle, PencilLine, Rocket, Save, Trash2, X,
} from 'lucide-react';
import { api } from './api.js';
import { buildSiteIdentity } from '../../shared/siteRuntime.js';

const STATUS_LABELS = {
  DRAFT: 'טיוטה', TRACKED: 'במעקב', ACTIVE: 'פעיל', FAILED: 'נכשל',
  READY_FOR_SHAREPOINT: 'מוכן לפריסה', WAITING_FOR_BROWSER: 'ממתין לדפדפן',
  DEPLOYING: 'בפריסה', PAUSED: 'מושהה', SUCCEEDED: 'הושלם',
  CANCELLED: 'בוטל', SUPERSEDED: 'הוחלף',
};

const BACKUP_LABELS = {
  PASSED: 'הצליח', PARTIAL: 'חלקי', FAILED: 'נכשל',
  SKIPPED_FRESH_TARGET: 'דולג — יעד חדש',
  SKIPPED_UNSUPPORTED_BACKEND: 'דולג — Backend לא נתמך',
  IN_PROGRESS: 'בתהליך',
};

const formatDate = (value) => value
  ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

function relativeAge(value) {
  if (!value) return '—';
  const deltaMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat('he-IL', { numeric: 'auto' });
  if (Math.abs(deltaMinutes) < 60) return formatter.format(deltaMinutes, 'minute');
  const hours = Math.round(deltaMinutes / 60);
  if (Math.abs(hours) < 48) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function StateBadge({ value }) {
  return <span className={`status status-${String(value || '').toLowerCase()}`}>{STATUS_LABELS[value] || value || '—'}</span>;
}

function BackupBadge({ value }) {
  return <span className={`backup-outcome backup-${String(value || '').toLowerCase()}`}>{BACKUP_LABELS[value] || value || '—'}</span>;
}

function WorkspaceSection({ id, icon: Icon, title, subtitle, children, sectionRef }) {
  return <section id={id} ref={sectionRef} className="site-workspace-section" tabIndex={id ? -1 : undefined}>
    <div className="workspace-section-heading">
      <span className="workspace-section-icon"><Icon size={19} /></span>
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    </div>
    {children}
  </section>;
}

function IdentityGrid({ identity }) {
  const rows = [
    ['Host', identity.host],
    ['siteCode', identity.siteCode],
    ['siteDbFolder', identity.siteDbFolder],
    ['usersDbFolder', identity.usersDbFolder],
    ['siteAssetsFolder', identity.siteAssetsFolder],
    ['imagesFolder', identity.imagesFolder],
    ['widgetsDbTarget', identity.widgetsDbTarget],
    ['storageBackend', identity.storageBackend],
  ];
  return <div className="identity-grid">
    {rows.map(([label, value]) => <div key={label}><span>{label}</span><strong dir="ltr">{value || '—'}</strong></div>)}
  </div>;
}

function SiteEditor({ site, hosts, identityLocked, onCancel, onSaved }) {
  const [form, setForm] = useState({
    unit: site.unit || '',
    name: site.name || '',
    managerName: site.managerName || '',
    host: site.host || hosts[0] || '',
    siteCode: site.siteCode || '',
    siteDbFolder: site.siteDbFolder || 'siteDB',
    usersDbFolder: site.usersDbFolder || 'siteUsersDb',
    siteAssetsFolder: site.siteAssetsFolder || 'siteAssets',
    imagesFolder: site.imagesFolder || 'images',
    widgetsDbTarget: site.widgetsDbTarget || 'users',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const preview = useMemo(() => {
    try {
      return { identity: buildSiteIdentity({ ...form, storageBackend: site.storageBackend }), error: '' };
    } catch (identityError) {
      return { identity: null, error: identityError.message };
    }
  }, [form, site.storageBackend]);

  const save = async () => {
    if (!preview.identity || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.updateSite(site.id, form);
      await onSaved();
    } catch (saveError) {
      setError(saveError.message);
      setSaving(false);
    }
  };

  return <div className="site-editor">
    {error && <div className="alert"><CircleAlert size={18} />{error}</div>}
    {identityLocked && <div className="workspace-warning"><CircleAlert size={18} /><div><strong>זהות היעד נעולה זמנית</strong><span>אפשר לעדכן שם, יחידה ומנהל. שדות SharePoint ייפתחו כשהריצה הפעילה תסתיים.</span></div></div>}
    <div className="form-grid">
      <label className="field"><span>יחידה</span><input value={form.unit} onChange={(event) => set('unit', event.target.value)} /></label>
      <label className="field"><span>שם האתר</span><input value={form.name} onChange={(event) => set('name', event.target.value)} /></label>
      <label className="field"><span>מנהל האתר</span><input value={form.managerName} onChange={(event) => set('managerName', event.target.value)} /></label>
      <label className="field"><span>Host</span><select disabled={identityLocked} value={form.host} onChange={(event) => set('host', event.target.value)}>{hosts.map((host) => <option key={host}>{host}</option>)}</select></label>
      <label className="field"><span>siteCode</span><input disabled={identityLocked} dir="ltr" value={form.siteCode} onChange={(event) => set('siteCode', event.target.value.toLowerCase())} /></label>
      <label className="field"><span>siteDbFolder</span><input disabled={identityLocked} dir="ltr" value={form.siteDbFolder} onChange={(event) => set('siteDbFolder', event.target.value)} /></label>
      <label className="field"><span>usersDbFolder</span><input disabled={identityLocked} dir="ltr" value={form.usersDbFolder} onChange={(event) => set('usersDbFolder', event.target.value)} /></label>
      <label className="field"><span>siteAssetsFolder</span><input disabled={identityLocked} dir="ltr" value={form.siteAssetsFolder} onChange={(event) => set('siteAssetsFolder', event.target.value)} /></label>
      <label className="field"><span>imagesFolder</span><input disabled={identityLocked} dir="ltr" value={form.imagesFolder} onChange={(event) => set('imagesFolder', event.target.value)} /></label>
      <label className="field"><span>widgets_data.txt</span><select disabled={identityLocked} value={form.widgetsDbTarget} onChange={(event) => set('widgetsDbTarget', event.target.value)}><option value="users">usersDbFolder</option><option value="site">siteAssetsRoot</option></select></label>
    </div>
    <div className={`derived-target-preview ${preview.error ? 'invalid' : ''}`}>
      <small>הנתיבים הנגזרים מתעדכנים אוטומטית</small>
      <code dir="ltr">{preview.identity?.finalAppUrl || preview.error}</code>
    </div>
    <div className="workspace-actions">
      <button className="secondary-button" onClick={onCancel} disabled={saving}><X size={17} />ביטול</button>
      <button className="primary-button" onClick={save} disabled={saving || !preview.identity}><Save size={17} />{saving ? 'שומר...' : 'שמור שינויים'}</button>
    </div>
  </div>;
}

export default function SitePage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const releasesRef = useRef(null);
  const [site, setSite] = useState(null);
  const [releases, setReleases] = useState([]);
  const [config, setConfig] = useState(null);
  const [selectedReleaseId, setSelectedReleaseId] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [detail, releaseItems, appConfig] = await Promise.all([api.site(siteId), api.releases(), api.config()]);
      setSite(detail);
      setReleases(releaseItems);
      setConfig(appConfig);
      setSelectedReleaseId((current) => current || detail.latestAvailableRelease?.id || detail.currentRelease?.id || releaseItems[0]?.id || '');
      setError('');
    } catch (loadError) {
      setError(loadError.message);
      setSite(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [siteId]);
  useEffect(() => {
    if (site && searchParams.get('section') === 'releases' && releasesRef.current) {
      releasesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      releasesRef.current.focus({ preventScroll: true });
    }
    if (site && searchParams.get('section') === 'edit') setEditing(true);
  }, [site, searchParams]);

  const deploy = async () => {
    const release = releases.find((item) => item.id === selectedReleaseId);
    if (!release || deploying) return;
    if (site.currentRelease?.id === release.id || site.currentVersion === release.version) {
      if (!window.confirm(`האתר כבר מסומן על ריליס ${release.version}. לבצע פריסה חוזרת?`)) return;
    }
    setDeploying(true);
    setError('');
    try {
      const job = await api.deploy(site.id, release.id);
      navigate(`/runs?runId=${job.id || job._id}`);
    } catch (deployError) {
      setError(deployError.message);
      setDeploying(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`למחוק את ${site.name} מרשימת המעקב בלבד?\n\nספריות, תיקיות, TXT, גיבויים ונתוני SharePoint לא יימחקו.`)) return;
    try {
      await api.deleteSite(site.id);
      navigate('/sites');
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  if (loading) return <div className="center-state"><LoaderCircle className="spin" /><p>טוען פרטי אתר...</p></div>;
  if (!site) return <div className="page"><div className="site-not-found"><CircleAlert size={30} /><h1>האתר לא נמצא</h1><p>{error || 'רשומת האתר אינה קיימת.'}</p><Link className="secondary-button" to="/sites"><ArrowRight size={17} />חזרה לאתרים</Link></div></div>;

  const latestBackup = site.backups?.[0] || null;
  const currentRelease = site.currentRelease;
  const active = site.activeRun;
  const hasValidIdentity = Boolean(site.identity);

  return <div className="page site-workspace">
    <Link className="workspace-back-link" to="/sites"><ArrowRight size={16} />כל האתרים</Link>
    <header className="site-workspace-header">
      <div>
        <div className="site-header-eyebrow"><span>{site.unit}</span><StateBadge value={site.status} /><span className="backend-pill"><Database size={14} />{String(site.storageBackend || 'txt').toUpperCase()}</span></div>
        <h1>{site.name}</h1>
        <p>גרסה נוכחית <strong dir="ltr">{site.currentVersion || 'ללא גרסה'}</strong> · <span dir="ltr">{site.targetKey || site.identityError}</span></p>
      </div>
      <div className="site-header-actions">
        <select aria-label="ריליס לפריסה" value={selectedReleaseId} onChange={(event) => setSelectedReleaseId(event.target.value)}>
          {releases.map((release) => <option key={release.id} value={release.id}>{release.version}</option>)}
        </select>
        {site.finalUrl && <a className="primary-button" href={site.finalUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} />פתח אתר</a>}
        <button className="secondary-button" disabled={deploying || !selectedReleaseId || Boolean(active) || !hasValidIdentity} onClick={deploy}><Rocket size={17} />{deploying ? 'מתחיל...' : 'פרוס / עדכן'}</button>
        <button className="secondary-button" onClick={() => setEditing(true)}><PencilLine size={17} />ערוך</button>
      </div>
    </header>

    {error && <div className="alert"><CircleAlert size={18} />{error}<button aria-label="סגור הודעת שגיאה" onClick={() => setError('')}><X size={16} /></button></div>}
    {active && <div className="workspace-warning"><CircleAlert size={18} /><div><strong>ריצת פריסה פעילה כותבת ליעד</strong><span>עריכת זהות היעד חסומה עד לסיום הריצה.</span></div><Link to={`/runs?runId=${active.jobId}`}>פתח ריצה</Link></div>}

    {editing && <WorkspaceSection icon={PencilLine} title="עריכת אתר" subtitle="הנתיבים הנגזרים אינם שדות נפרדים; הם מתעדכנים אוטומטית משדות הזהות הקנוניים.">
      <SiteEditor site={site} hosts={config?.sharePointHosts || [site.host]} identityLocked={Boolean(active)} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await load(); }} />
    </WorkspaceSection>}

    <div className="site-workspace-grid">
      <WorkspaceSection icon={Database} title="זהות היעד" subtitle="siteCode מזהה את ה-SharePoint Web; זוג הספריות מזהה את התקנת Site Builder הלוגית בתוכו.">
        {hasValidIdentity ? <>
          <IdentityGrid identity={site.identity} />
          <div className="identity-explainer">
            <div><strong dir="ltr">{site.identity.siteCode}</strong><span>SharePoint Web</span></div>
            <span className="identity-plus">+</span>
            <div><strong dir="ltr">{site.identity.siteDbFolder} · {site.identity.usersDbFolder}</strong><span>התקנה לוגית עצמאית</span></div>
          </div>
          <a className="final-url-row" href={site.finalUrl} target="_blank" rel="noreferrer"><span>Final app URL</span><code dir="ltr">{site.finalUrl}</code><ExternalLink size={15} /></a>
        </> : <div className="workspace-warning"><CircleAlert size={18} /><div><strong>זהות היעד השמורה אינה תקינה</strong><span>{site.identityError} פתח עריכה ותקן את שדות SharePoint לפני פריסה.</span></div></div>}
      </WorkspaceSection>

      <WorkspaceSection icon={CheckCircle2} title="ריליס נוכחי">
        <div className="current-release-card">
          <strong dir="ltr">{currentRelease?.version || site.currentVersion || '—'}</strong>
          <dl>
            <div><dt>Release ID</dt><dd dir="ltr">{currentRelease?.id || '—'}</dd></div>
            <div><dt>Source build ID</dt><dd dir="ltr">{currentRelease?.buildId || '—'}</dd></div>
            <div><dt>נפרס בתאריך</dt><dd>{formatDate(currentRelease?.deployedAt || site.lastPublishedAt)}</dd></div>
            <div><dt>ריצה מוצלחת אחרונה</dt><dd>{site.lastSuccessfulRun ? <Link to={`/runs?runId=${site.lastSuccessfulRun.id}`}>#{site.lastSuccessfulRun.id.slice(-6)}</Link> : '—'}</dd></div>
            <div><dt>Final URL</dt><dd>{site.finalUrl ? <a href={site.finalUrl} target="_blank" rel="noreferrer" dir="ltr">{site.finalUrl}</a> : '—'}</dd></div>
          </dl>
        </div>
      </WorkspaceSection>
    </div>

    <WorkspaceSection id="release-history" sectionRef={releasesRef} icon={History} title="ריליסים אחרונים והיסטוריית פריסות" subtitle="היסטוריה זו מסוננת ל-targetKey של ההתקנה הלוגית הנוכחית.">
      {site.latestAvailableRelease && <div className="latest-release-callout"><Archive size={18} /><div><strong>ריליס {site.latestAvailableRelease.version} זמין</strong><span>חדש יותר מהריליס שמותקן באתר · Build {site.latestAvailableRelease.buildId || '—'}</span></div></div>}
      <div className="table-card workspace-table"><table><thead><tr><th>גרסה</th><th>תאריך</th><th>מצב</th><th>Run ID</th><th>סוג</th></tr></thead><tbody>
        {site.runs.map((run) => <tr key={run.id}><td dir="ltr">{run.release?.version || '—'}</td><td>{formatDate(run.finishedAt || run.createdAt)}</td><td><StateBadge value={run.state} /></td><td><Link to={`/runs?runId=${run.id}`} dir="ltr">#{run.id.slice(-8)}</Link></td><td>{run.type === 'INSTALL' ? 'התקנה' : 'עדכון'}</td></tr>)}
        {!site.runs.length && <tr><td colSpan="5">אין עדיין ניסיונות פריסה ליעד הזה.</td></tr>}
      </tbody></table></div>
    </WorkspaceSection>

    <div className="site-workspace-grid">
      <WorkspaceSection icon={History} title="ריצות אחרונות">
        <div className="recent-run-list">
          {site.runs.slice(0, 6).map((run) => <Link key={run.id} to={`/runs?runId=${run.id}`}><div><strong>{run.release?.version || '—'}</strong><span>{formatDate(run.startedAt || run.createdAt)}</span></div><StateBadge value={run.state} /></Link>)}
          {!site.runs.length && <p className="empty">אין ריצות להצגה.</p>}
        </div>
      </WorkspaceSection>

      <WorkspaceSection icon={Archive} title="גיבויים">
        {latestBackup ? <div className="backup-summary-card">
          <div><BackupBadge value={latestBackup.outcome} /><span>{relativeAge(latestBackup.finishedAt || latestBackup.createdAt)}</span></div>
          <dl><div><dt>גרסת מקור</dt><dd dir="ltr">{latestBackup.sourceVersion || '—'}</dd></div><div><dt>קבצים</dt><dd>{latestBackup.copiedCount}/{latestBackup.fileCount}</dd></div><div><dt>ריצה</dt><dd><Link to={`/runs?runId=${latestBackup.runId}`}>#{latestBackup.runId.slice(-6)}</Link></dd></div></dl>
          {latestBackup.backupUrl && <a href={latestBackup.backupUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />פתח תיקיית גיבוי</a>}
          {['FAILED', 'PARTIAL'].includes(latestBackup.outcome) && <p className="backup-warning">הפריסה יכולה להצליח גם כאשר הגיבוי נכשל. בדוק את פרטי הריצה.</p>}
        </div> : <p className="empty">עדיין לא נרשמו גיבויים אוטומטיים.</p>}
        <Link className="secondary-button workspace-full-link" to={`/backups?siteId=${site.id}`}>כל הגיבויים של האתר</Link>
      </WorkspaceSection>
    </div>

    <WorkspaceSection icon={FileText} title="נתונים ונתיבים" subtitle="קובצי הנתונים נגזרים מהזהות דרך shared/siteRuntime.js; אין Registry נוסף במסך.">
      {site.storageBackend === 'txt' && hasValidIdentity ? <div className="canonical-path-list">
        {(site.plan?.txtSeeds || []).map((file) => <div key={file.path}><strong dir="ltr">{file.fileName}</strong><code dir="ltr">{file.path}</code></div>)}
      </div> : <p className="empty">{site.storageBackend === 'txt' ? 'תקן את זהות היעד כדי להציג את נתיבי ה-TXT.' : 'נתיבי TXT אינם חלים על Backend זה.'}</p>}
    </WorkspaceSection>

    <WorkspaceSection icon={Trash2} title="פעולות מסוכנות" subtitle="מחיקה כאן מסירה את רשומת המעקב בלבד.">
      <div className="tracking-delete-panel"><div><strong>מחיקת רשומת Site</strong><p>לא יימחקו ספריות, תיקיות, קובצי TXT, גיבויים, אפליקציה או נתונים ב-SharePoint.</p></div><button className="danger-button" disabled={Boolean(active)} onClick={remove}><Trash2 size={17} />מחק מהמעקב בלבד</button></div>
    </WorkspaceSection>
  </div>;
}
