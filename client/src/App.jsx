import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Activity, Box, Building2, CheckCircle2, ChevronLeft, CircleAlert, CloudUpload,
  ClipboardCopy, ExternalLink, Eye, EyeOff, FileArchive, FileCode2, Folder, Gauge, LayoutDashboard, LoaderCircle, Menu, Plus,
  PencilLine, RefreshCw, Rocket, Trash2, X, ListChecks,
} from 'lucide-react';
import { api } from './api.js';
import RunsPage from './RunsPage.jsx';
import { collectDirectoryHandle, collectDroppedFolder, collectSelectedFolder, folderPickerDiagnostics, formatBytes, summarizeSource, validateDistSource } from './releaseFolder.js';
import clientPackage from '../package.json';

const APP_VERSION = clientPackage.version;

const STATUS_LABELS = {
  DRAFT: 'טיוטה', TRACKED: 'במעקב', PREPARING_RELEASE: 'מכין ריליס', READY_FOR_SHAREPOINT: 'מוכן לפריסה',
  DEPLOYING: 'מעלה ל-SharePoint', ACTIVE: 'פעיל', FAILED: 'נכשל', QUEUED: 'ממתין',
  SUCCEEDED: 'הושלם', INTERRUPTED: 'הופסק',
};

const formatDate = (value) => value ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const jobIdOf = (job) => String(job?.id || job?._id || '');

function StatusBadge({ status }) {
  return <span className={`status status-${String(status || 'DRAFT').toLowerCase()}`}>{STATUS_LABELS[status] || status || '—'}</span>;
}

function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose}><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}

function Layout() {
  const [open, setOpen] = useState(true);
  const links = [
    { to: '/', label: 'דשבורד', icon: LayoutDashboard },
    { to: '/sites', label: 'אתרים', icon: Building2 },
    { to: '/releases', label: 'ריליסים', icon: FileArchive },
    { to: '/runs', label: 'ריצות SharePoint', icon: ListChecks },
  ];
  return (
    <div className="app-shell" dir="rtl">
      <aside className={`sidebar ${open ? 'sidebar-open' : 'sidebar-closed'}`}>
        <div className="sidebar-header">
          <button className="icon-button" onClick={() => setOpen((value) => !value)}><Menu size={24} /></button>
          {open && <div><strong>ניהול אתרים</strong><small>TXT Release Manager</small></div>}
        </div>
        <nav>
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={20} />{open && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">{open ? `Site Release Manager ${APP_VERSION}` : APP_VERSION}</div>
      </aside>
      <main className="main-content"><Routes><Route path="/" element={<DashboardPage />} /><Route path="/sites" element={<SitesPage />} /><Route path="/releases" element={<ReleasesPage />} /><Route path="/runs" element={<RunsPage />} /></Routes></main>
    </div>
  );
}

function PageHeader({ title, subtitle, actions }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="page-actions">{actions}</div></div>;
}

function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.dashboard().then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (!data) return <Loading error={error} />;
  const cards = [
    ['סה״כ אתרים', data.totals.all, Building2], ['אתרים פעילים', data.totals.active, CheckCircle2],
    ['לא בריליס האחרון', data.totals.outdated, RefreshCw], ['ממתינים להשלמה', data.totals.waiting, Activity],
  ];
  return <div className="page"><PageHeader title="דשבורד" subtitle="תמונה פשוטה של מצב האתרים והריליסים" actions={<button className="secondary-button" onClick={load}><RefreshCw size={17} />רענן</button>} />
    <section className="metric-grid">{cards.map(([label, value, Icon]) => <article className="metric-card" key={label}><div className="metric-icon"><Icon size={22} /></div><div><strong>{value}</strong><span>{label}</span></div></article>)}</section>
    <section className="dashboard-grid">
      <Card title="עדכונים אחרונים"><SimpleSiteTable sites={data.recentSites} /></Card>
      <Card title={`אתרים שאינם בריליס האחרון${data.latestRelease ? ` (${data.latestRelease.version})` : ''}`}><SimpleSiteTable sites={data.outdatedSites} /></Card>
      <Card title="חלוקה לפי יחידה"><div className="unit-list">{data.byUnit.length ? data.byUnit.map((row) => <div key={row.unit}><span>{row.unit}</span><strong>{row.count}</strong></div>) : <Empty />}</div></Card>
    </section>
  </div>;
}

function Card({ title, children }) { return <article className="card"><h2>{title}</h2>{children}</article>; }
function Empty() { return <div className="empty">אין נתונים להצגה.</div>; }
function Loading({ error }) { return <div className="center-state">{error ? <><CircleAlert /><p>{error}</p></> : <><LoaderCircle className="spin" /><p>טוען...</p></>}</div>; }
function SimpleSiteTable({ sites = [] }) { return sites.length ? <div className="mini-table">{sites.map((site) => <div key={site._id || site.id}><div><strong>{site.name}</strong><span>{site.unit}</span></div><div><StatusBadge status={site.status} /><small>{site.currentVersion || 'ללא גרסה'} · {formatDate(site.lastPublishedAt || site.updatedAt)}</small></div></div>)}</div> : <Empty />; }

function SitesPage() {
  const [sites, setSites] = useState([]);
  const [releases, setReleases] = useState([]);
  const [config, setConfig] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState({});
  const [job, setJob] = useState(null);
  const [selectedSite, setSelectedSite] = useState(null);
  const [editingSite, setEditingSite] = useState(null);
  const [backgroundDeployer, setBackgroundDeployer] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [s, r, c] = await Promise.all([api.sites(), api.releases(), api.config()]);
      setSites(s);
      setReleases(r);
      setConfig(c);
      if (r[0]?.id) {
        setSelectedRelease((previous) => {
          const next = { ...previous };
          for (const site of s) if (!next[site.id]) next[site.id] = r[0].id;
          return next;
        });
      }
      setError('');
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);

  const launchSharePointDeployer = (current) => {
    if (!current?.deployerUrl) return false;
    let url;
    try { url = new URL(current.deployerUrl); } catch { setError('כתובת SharePoint Deployer אינה תקינה.'); return false; }

    const managerIsLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (managerIsLocal) {
      setError('המשימה מוכנה ל-SharePoint. בבדיקה מתוך localhost יש לפתוח את חלון האבחון ידנית; פריסה ברקע מופעלת כאשר Release Manager עצמו פתוח מתוך SharePoint.');
      return false;
    }

    if (url.origin !== window.location.origin) {
      setError(`אתר היעד נמצא ב-${url.host}, בעוד Release Manager פתוח מ-${window.location.host}. בגלל מגבלות iframe של SharePoint הפריסה תיפתח בחלון נפרד רק במקרה הזה.`);
      window.open(current.deployerUrl, '_blank', 'noopener,noreferrer');
      return true;
    }

    url.searchParams.set('embedded', '1');
    url.searchParams.set('_run', String(Date.now()));
    setBackgroundDeployer({ jobId: jobIdOf(current), url: url.toString() });
    return true;
  };

  const monitorJob = async (createdJob) => {
    const id = jobIdOf(createdJob);
    if (!id) return;
    let deployerStarted = false;
    for (;;) {
      const current = await api.job(id);
      setJob(current);
      if (current.state === 'READY_FOR_SHAREPOINT' && current.deployerUrl && !deployerStarted) {
        deployerStarted = launchSharePointDeployer(current);
      }
      if (['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(current.state)) {
        setBackgroundDeployer((active) => active?.jobId === id ? null : active);
        await load();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  };

  const beginDeploy = async (site, releaseId) => {
    if (!releaseId) return setError('יש לבחור ריליס לעדכון.');
    const release = releases.find((item) => item.id === releaseId);
    const warnings = [];
    if (site.activeJobId) warnings.push('כבר קיימת משימת פריסה פעילה לאתר. הרצה חדשה תחליף ותפסיק את המשימה הקודמת.');
    if (release && (String(site.currentReleaseId || '') === String(release.id) || site.currentVersion === release.version)) {
      warnings.push(`האתר כבר מסומן על ריליס ${release.version}. אפשר להריץ אותו שוב כדי לבצע פריסה חוזרת.`);
    }
    let force = false;
    if (warnings.length) {
      const approved = window.confirm(`${warnings.join('\n\n')}\n\nלהמשיך ולהריץ את הריליס מחדש?`);
      if (!approved) return;
      force = true;
    }

    const start = async (forceRun) => {
      const created = await api.deploy(site.id, releaseId, { force: forceRun });
      setJob(created);
      monitorJob(created).catch((monitorError) => setError(monitorError.message));
    };

    try {
      await start(force);
    } catch (e) {
      if (e.status === 409 && e.payload?.canForce) {
        const approved = window.confirm('השרת זיהה משימה פעילה שלא הופיעה עדיין במסך. להפסיק אותה ולהתחיל את הריליס מחדש?');
        if (approved) {
          try { await start(true); return; }
          catch (retryError) { setError(retryError.message); }
        }
      } else setError(e.message);
    }
  };

  const createSite = async (form) => {
    try {
      const result = await api.createSite(form);
      setShowAdd(false);
      await load();
      if (result.job) {
        setJob(result.job);
        monitorJob(result.job).catch((monitorError) => setError(monitorError.message));
      }
    } catch (e) { setError(e.message); }
  };

  const saveSite = async (site, values) => {
    try {
      const updated = await api.updateSite(site.id, values);
      setEditingSite(null);
      setSelectedSite(updated);
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const deleteSite = async (site) => {
    const approved = window.confirm(`למחוק את ${site.name} מרשימת המעקב?\n\nהפעולה מוחקת רק את הרשומה והיסטוריית הריצות שלה ב-Release Manager. היא לא מוחקת דבר מ-SharePoint.`);
    if (!approved) return;
    try {
      await api.deleteSite(site.id);
      setSelectedSite(null);
      setEditingSite(null);
      await load();
    } catch (e) { setError(e.message); }
  };

  return <div className="page">
    <PageHeader title="אתרים" subtitle="מעקב, התקנה ועדכון ריליסים" actions={<><button className="secondary-button" onClick={load}><RefreshCw size={17} />רענן</button><button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={18} />הוסף אתר</button></>} />
    {backgroundDeployer && <div className="background-deploy-banner"><LoaderCircle className="spin" size={17} /><div><strong>פריסת SharePoint רצה ברקע</strong><span>אין צורך לפתוח חלון נוסף. מצב המשימה מתעדכן אוטומטית.</span></div></div>}
    {error && <div className="alert"><CircleAlert size={18} />{error}<button onClick={() => setError('')}><X size={16} /></button></div>}
    <div className="table-card"><table><thead><tr><th>יחידה</th><th>שם האתר</th><th>Host</th><th>תאריך העלאה</th><th>עדכון אחרון</th><th>גרסה</th><th>מנהל אתר</th><th>מצב</th><th>פעולה</th></tr></thead><tbody>
      {sites.map((site) => <tr key={site.id} className="site-row">
        <td>{site.unit}</td>
        <td><button className="site-name-button" onClick={() => setSelectedSite(site)}>{site.name}<Eye size={14} /></button></td>
        <td dir="ltr">{site.host}</td><td>{formatDate(site.firstPublishedAt)}</td><td>{formatDate(site.lastPublishedAt)}</td><td>{site.currentVersion || '—'}</td><td>{site.managerName}</td><td><StatusBadge status={site.status} /></td>
        <td><div className="site-actions"><div className="inline-actions"><select value={selectedRelease[site.id] || ''} onChange={(e) => setSelectedRelease((p) => ({ ...p, [site.id]: e.target.value }))}><option value="">בחר ריליס</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.version}</option>)}</select><button className="small-primary" onClick={() => beginDeploy(site, selectedRelease[site.id])}><Rocket size={15} />עדכן</button></div><div className="site-action-icons"><button className="icon-button compact" title="פרטי אתר" onClick={() => setSelectedSite(site)}><Eye size={17} /></button><button className="icon-button compact" title="ערוך אתר" onClick={() => setEditingSite(site)}><PencilLine size={17} /></button><button className="danger-icon compact" title="מחק אתר" onClick={() => deleteSite(site)}><Trash2 size={17} /></button></div></div></td>
      </tr>)}
      {!sites.length && <tr><td colSpan="9"><Empty /></td></tr>}
    </tbody></table></div>
    {showAdd && <AddSiteModal hosts={config?.sharePointHosts || []} releases={releases} onSave={createSite} onClose={() => setShowAdd(false)} />}
    {selectedSite && <SiteDetailsModal site={selectedSite} onClose={() => setSelectedSite(null)} onEdit={() => { setEditingSite(selectedSite); setSelectedSite(null); }} onDelete={() => deleteSite(selectedSite)} />}
    {editingSite && <EditSiteModal site={editingSite} hosts={config?.sharePointHosts || []} onClose={() => setEditingSite(null)} onSave={(values) => saveSite(editingSite, values)} />}
    {job && <JobModal job={job} onClose={() => setJob(null)} onLocalVerify={async (currentJob) => { const report = await api.verifyLocalDeployment(jobIdOf(currentJob)); const refreshed = await api.job(jobIdOf(currentJob)); setJob(refreshed); return report; }} />}
    {backgroundDeployer && <iframe className="sharepoint-background-deployer" title="SharePoint background deployer" src={backgroundDeployer.url} aria-hidden="true" />}
  </div>;
}

function SiteDetailsModal({ site, onClose, onEdit, onDelete }) {
  const rows = [
    ['יחידה', site.unit], ['שם האתר', site.name], ['Host', site.host], ['קוד אתר', site.siteCode], ['מנהל', site.managerName],
    ['גרסה נוכחית', site.currentVersion || '—'], ['מצב', STATUS_LABELS[site.status] || site.status], ['תאריך העלאה', formatDate(site.firstPublishedAt)],
    ['עדכון אחרון', formatDate(site.lastPublishedAt)], ['ספריית אתר', site.siteDbFolder || 'siteDB'], ['ספריית משתמשים', site.usersDbFolder || 'siteUsersDb'],
    ['siteAssets', site.siteAssetsFolder || 'siteAssets'], ['images', site.imagesFolder || 'images'], ['widgets_data.txt', site.widgetsDbTarget === 'site' ? 'ספריית האתר' : 'ספריית המשתמשים'],
  ];
  return <Modal title={site.name} onClose={onClose} wide>
    <div className="site-details-grid">{rows.map(([label, value]) => <div key={label}><span>{label}</span><strong dir={['Host','קוד אתר','ספריית אתר','ספריית משתמשים','siteAssets','images'].includes(label) ? 'ltr' : undefined}>{value || '—'}</strong></div>)}</div>
    <div className="site-final-url"><span>כתובת אתר סופית</span><a href={site.finalUrl} target="_blank" rel="noreferrer" dir="ltr">{site.finalUrl}<ExternalLink size={14} /></a></div>
    <div className="modal-actions site-detail-actions"><button className="secondary-button" onClick={onClose}>סגור</button><button className="secondary-button" onClick={onEdit}><PencilLine size={17} />ערוך</button><button className="danger-button" onClick={onDelete}><Trash2 size={17} />מחק מהמעקב</button></div>
  </Modal>;
}

function EditSiteModal({ site, hosts, onClose, onSave }) {
  const [form, setForm] = useState({
    unit: site.unit || '', name: site.name || '', host: site.host || hosts[0] || '', siteCode: site.siteCode || '', managerName: site.managerName || '',
    currentVersion: site.currentVersion || '', firstPublishedAt: site.firstPublishedAt ? new Date(site.firstPublishedAt).toISOString().slice(0, 16) : '',
    lastPublishedAt: site.lastPublishedAt ? new Date(site.lastPublishedAt).toISOString().slice(0, 16) : '', siteDbFolder: site.siteDbFolder || 'siteDB',
    usersDbFolder: site.usersDbFolder || 'siteUsersDb', siteAssetsFolder: site.siteAssetsFolder || 'siteAssets', imagesFolder: site.imagesFolder || 'images', widgetsDbTarget: site.widgetsDbTarget || 'users',
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = async () => {
    setSaving(true);
    const ok = await onSave(form);
    if (!ok) setSaving(false);
  };
  return <Modal title={`עריכת ${site.name}`} onClose={onClose} wide>
    <div className="form-grid"><Field label="יחידה"><input value={form.unit} onChange={(e) => set('unit', e.target.value)} /></Field><Field label="שם האתר"><input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field><Field label="Host"><select value={form.host} onChange={(e) => set('host', e.target.value)}>{hosts.map((host) => <option key={host}>{host}</option>)}</select></Field><Field label="קוד אתר"><input dir="ltr" value={form.siteCode} onChange={(e) => set('siteCode', e.target.value.toLowerCase())} /></Field><Field label="מנהל אתר"><input value={form.managerName} onChange={(e) => set('managerName', e.target.value)} /></Field><Field label="גרסה נוכחית"><input dir="ltr" value={form.currentVersion} onChange={(e) => set('currentVersion', e.target.value)} /></Field><Field label="תאריך העלאה"><input type="datetime-local" value={form.firstPublishedAt} onChange={(e) => set('firstPublishedAt', e.target.value)} /></Field><Field label="עדכון אחרון"><input type="datetime-local" value={form.lastPublishedAt} onChange={(e) => set('lastPublishedAt', e.target.value)} /></Field></div>
    <details className="advanced-site-settings" open><summary>הגדרות SharePoint</summary><div className="form-grid"><Field label="ספריית האתר"><input dir="ltr" value={form.siteDbFolder} onChange={(e) => set('siteDbFolder', e.target.value)} /></Field><Field label="ספריית משתמשים"><input dir="ltr" value={form.usersDbFolder} onChange={(e) => set('usersDbFolder', e.target.value)} /></Field><Field label="תיקיית siteAssets"><input dir="ltr" value={form.siteAssetsFolder} onChange={(e) => set('siteAssetsFolder', e.target.value)} /></Field><Field label="תיקיית images"><input dir="ltr" value={form.imagesFolder} onChange={(e) => set('imagesFolder', e.target.value)} /></Field><Field label="יעד widgets_data.txt"><select value={form.widgetsDbTarget} onChange={(e) => set('widgetsDbTarget', e.target.value)}><option value="users">ספריית משתמשים</option><option value="site">ספריית האתר</option></select></Field></div></details>
    <div className="target-preview" dir="ltr">https://{form.host}/sites/{form.siteCode}/{form.siteDbFolder}/dist/index.html</div>
    <div className="modal-actions"><button className="secondary-button" disabled={saving} onClick={onClose}>ביטול</button><button className="primary-button" disabled={saving} onClick={submit}>{saving ? 'שומר...' : 'שמור שינויים'}</button></div>
  </Modal>;
}

function AddSiteModal({ hosts, releases, onSave, onClose }) {
  const [form, setForm] = useState({ mode: 'existing', unit: '', name: '', host: hosts[0] || '', siteCode: '', managerName: '', currentVersion: '', firstPublishedAt: '', lastPublishedAt: '', releaseId: '', siteDbFolder: 'siteDB', usersDbFolder: 'siteUsersDb', siteAssetsFolder: 'siteAssets', imagesFolder: 'images', widgetsDbTarget: 'users' });
  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  return <Modal title="הוסף אתר" onClose={onClose} wide><div className="mode-switch"><button className={form.mode === 'existing' ? 'active' : ''} onClick={() => set('mode', 'existing')}>הוסף אתר קיים למעקב</button><button className={form.mode === 'install' ? 'active' : ''} onClick={() => set('mode', 'install')}>התקן Site Builder</button></div>
    <div className="form-grid"><Field label="יחידה"><input value={form.unit} onChange={(e) => set('unit', e.target.value)} /></Field><Field label="שם האתר"><input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field><Field label="Host"><select value={form.host} onChange={(e) => set('host', e.target.value)}>{hosts.map((host) => <option key={host}>{host}</option>)}</select></Field><Field label="קוד אתר"><input dir="ltr" value={form.siteCode} onChange={(e) => set('siteCode', e.target.value.toLowerCase())} placeholder="schedule" /></Field><Field label="מנהל אתר"><input value={form.managerName} onChange={(e) => set('managerName', e.target.value)} /></Field>
      {form.mode === 'existing' ? <><Field label="גרסה נוכחית — אופציונלי"><input dir="ltr" value={form.currentVersion} onChange={(e) => set('currentVersion', e.target.value)} /></Field><Field label="תאריך העלאה — אופציונלי"><input type="datetime-local" value={form.firstPublishedAt} onChange={(e) => set('firstPublishedAt', e.target.value)} /></Field><Field label="עדכון אחרון — אופציונלי"><input type="datetime-local" value={form.lastPublishedAt} onChange={(e) => set('lastPublishedAt', e.target.value)} /></Field></> : <Field label="ריליס להתקנה"><select value={form.releaseId} onChange={(e) => set('releaseId', e.target.value)}><option value="">בחר ריליס</option>{releases.map((release) => <option value={release.id} key={release.id}>{release.version}</option>)}</select></Field>}
    </div>
    <details className="advanced-site-settings">
      <summary>הגדרות SharePoint מתקדמות</summary>
      <div className="form-grid">
        <Field label="ספריית האתר"><input dir="ltr" value={form.siteDbFolder} onChange={(e) => set('siteDbFolder', e.target.value)} /></Field>
        <Field label="ספריית משתמשים"><input dir="ltr" value={form.usersDbFolder} onChange={(e) => set('usersDbFolder', e.target.value)} /></Field>
        <Field label="תיקיית siteAssets"><input dir="ltr" value={form.siteAssetsFolder} onChange={(e) => set('siteAssetsFolder', e.target.value)} /></Field>
        <Field label="תיקיית images"><input dir="ltr" value={form.imagesFolder} onChange={(e) => set('imagesFolder', e.target.value)} /></Field>
        <Field label="יעד widgets_data.txt"><select value={form.widgetsDbTarget} onChange={(e) => set('widgetsDbTarget', e.target.value)}><option value="users">ספריית משתמשים</option><option value="site">ספריית האתר</option></select></Field>
      </div>
      <p className="help-text">לאתר רגיל אין צורך לשנות. באתר קיים עם ספרייה שונה, למשל kashrarDB1, שנה רק את "ספריית האתר".</p>
    </details>
    <div className="target-preview" dir="ltr">https://{form.host || '<host>'}/sites/{form.siteCode || '<siteCode>'}/{form.siteDbFolder || 'siteDB'}/dist/index.html</div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>ביטול</button><button className="primary-button" onClick={() => onSave(form)}>{form.mode === 'install' ? 'צור והתקן' : 'הוסף למעקב'}</button></div>
  </Modal>;
}
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
function JobModal({ job, onClose, onLocalVerify }) {
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [localReport, setLocalReport] = useState(job.localVerification || null);
  const [copied, setCopied] = useState(false);
  const canVerifyLocally = job.state === 'READY_FOR_SHAREPOINT' && Boolean(job.manifestPath);

  useEffect(() => {
    setLocalReport(job.localVerification || null);
  }, [job.id, job._id, job.localVerification?.checkedAt, job.localVerification?.mode]);

  const verify = async () => {
    if (!onLocalVerify) return;
    setVerifying(true);
    setVerifyError('');
    try {
      const report = await onLocalVerify(job);
      setLocalReport(report);
    } catch (error) {
      setVerifyError(error.message);
    } finally {
      setVerifying(false);
    }
  };

  const copyAuditLog = async () => {
    const lines = localReport?.logLines?.length ? localReport.logLines : (job.logs || []);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setVerifyError('לא ניתן להעתיק את הלוג ללוח.');
    }
  };

  const summary = localReport?.summary || null;
  const hasDeepAuditLog = localReport?.mode === 'local-sharepoint-deep-audit' && Array.isArray(localReport?.logLines) && localReport.logLines.length > 0;
  const legacyLocalReport = Boolean(localReport) && !hasDeepAuditLog;
  const visibleLogs = hasDeepAuditLog ? localReport.logLines : (job.logs || []).slice(-120);

  return <Modal title="מצב משימה" onClose={onClose}>
    <div className="job-status"><StatusBadge status={job.state} /><strong>{job.progress || 0}%</strong></div>
    <div className="progress"><span style={{ width: `${job.progress || 0}%` }} /></div>
    <p>{job.message || 'מבצע...'}</p>
    {job.currentFile && <code>{job.currentFile}</code>}
    {job.error && <div className="alert"><CircleAlert size={18} />{job.error}</div>}
    {verifyError && <div className="alert"><CircleAlert size={18} />{verifyError}</div>}
    {canVerifyLocally && <div className="local-verify-box">
      <div><strong>Audit מקומי עמוק לפני מעבר לרשת הסגורה</strong><span>בודק Universal dist, Runtime Config, overlays, Manifest, hashes, TXT, MongoDB, Storage, Deployer, נתיבי SharePoint וסדר העלאה — בלי לגעת ב-SharePoint אמיתי.</span></div>
      <button className="secondary-button" disabled={verifying} onClick={verify}><Gauge size={17} />{verifying ? 'מריץ Audit...' : 'הרץ Audit מקומי מלא'}</button>
    </div>}
    {legacyLocalReport && <div className="legacy-audit-warning"><CircleAlert size={17} /><div><strong>זה דוח בדיקה ישן</strong><span>הדוח נשמר לפני ה-Audit העמוק ולכן אין בו את לוג PASS/WARN/FAIL המלא. הרץ את ה-Audit מחדש על אותה משימה — אין צורך ליצור Job חדש.</span></div><button className="secondary-button" disabled={verifying} onClick={verify}>{verifying ? 'מריץ...' : 'הרץ Audit מחדש'}</button></div>}
    {localReport && <div className={`local-verify-report ${localReport.ok ? 'passed' : 'failed'}`}>
      <div className="local-audit-title-row"><strong>{legacyLocalReport ? 'בדיקה בסיסית קודמת' : localReport.ok ? '✓ ה-Audit המקומי עבר' : '✕ ה-Audit המקומי נכשל'}</strong>{summary && <div className="audit-summary-badges"><span className="audit-pass">PASS {summary.passed}</span><span className="audit-warn">WARN {summary.warnings}</span><span className="audit-fail">FAIL {summary.failed}</span></div>}</div>
      <span>{localReport.fileCount || 0} קבצי פריסה נבדקו · ריליס {localReport.release?.version || '—'}</span>
      <div className="local-check-list">{(localReport.checks || []).map((check) => <div key={`${check.status || check.ok}-${check.name}`} className={check.status === 'warn' ? 'warn' : check.ok ? 'ok' : 'bad'}><span>{check.status === 'warn' ? '!' : check.ok ? '✓' : '✕'}</span><div><strong>{check.name}</strong>{check.details && <small>{check.details}</small>}</div></div>)}</div>
      {localReport.reportPath && <small dir="ltr">Report: {localReport.reportPath}</small>}
      <small>{localReport.limitation}</small>
    </div>}
    <div className="audit-log-section"><div className="audit-log-toolbar"><strong>{hasDeepAuditLog ? `לוג Audit מלא (${visibleLogs.length} שורות)` : `לוג משימה (${visibleLogs.length} שורות)`}</strong><div className="audit-log-actions">{canVerifyLocally && <button className="ghost-button" type="button" disabled={verifying} onClick={verify}><Gauge size={15} />{verifying ? 'מריץ...' : hasDeepAuditLog ? 'הרץ Audit מחדש' : 'צור לוג Audit מלא'}</button>}<button className="ghost-button" type="button" disabled={!visibleLogs.length} onClick={copyAuditLog}><ClipboardCopy size={15} />{copied ? 'הועתק' : 'העתק לוג'}</button></div></div>{visibleLogs.length ? <div className="log-box audit-log-box">{visibleLogs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}</div> : <div className="empty-audit-log">עדיין אין לוג Audit עמוק. לחץ "צור לוג Audit מלא".</div>}</div>
    {job.deployerUrl && job.state === 'READY_FOR_SHAREPOINT' && <a className="primary-button link-button" target="_blank" rel="noreferrer" href={job.deployerUrl}><ExternalLink size={17} />פתח חלון אבחון SharePoint</a>}
  </Modal>;
}

function ReleasesPage() {
  const [releases, setReleases] = useState([]);
  const [versionInfo, setVersionInfo] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [editingRelease, setEditingRelease] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [items, suggestions] = await Promise.all([api.releases(), api.releaseVersionSuggestions()]);
      setReleases(items);
      setVersionInfo(suggestions);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const upload = async ({ version, notes, source }) => {
    const data = new FormData();
    data.append('version', version);
    data.append('notes', notes);
    if (source.kind === 'folder') {
      data.append('rootName', source.rootName || 'source-folder');
      data.append('paths', JSON.stringify(source.files.map((item) => item.path)));
      for (const item of source.files) data.append('files', item.file, item.file.name);
      await api.uploadReleaseFolder(data);
    } else {
      data.append('file', source.file);
      await api.uploadRelease(data);
    }
    setShowUpload(false);
    await load();
  };

  const saveReleaseEdit = async (release, values) => {
    if (values.version !== release.version) {
      const approved = window.confirm(`לשנות את מספר הריליס מ-${release.version} ל-${values.version}?\n\nאתרים שמסומנים כרגע על הריליס יעודכנו למספר החדש. משימת פריסה פעילה של הריליס, אם קיימת, תופסק ותצטרך הרצה מחדש.`);
      if (!approved) return false;
    }
    try {
      await api.updateRelease(release.id, values);
      setEditingRelease(null);
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  return <div className="page">
    <PageHeader
      title="ריליסים"
      subtitle="גוררים את תיקיית dist האוניברסלית ושומרים אותה פעם אחת לשימוש בכל האתרים"
      actions={<button className="primary-button" onClick={() => setShowUpload(true)}><CloudUpload size={18} />ריליס חדש</button>}
    />
    {versionInfo?.latestVersion && <div className="release-last-banner"><strong>הריליס האחרון:</strong><span dir="ltr">{versionInfo.latestVersion}</span><span>· הבא המומלץ:</span><strong dir="ltr">{versionInfo.recommended}</strong></div>}
    {error && <div className="alert"><CircleAlert size={18} />{error}<button onClick={() => setError('')}><X size={16} /></button></div>}
    <div className="release-grid">
      {releases.map((release) => <article className="release-card" key={release.id}>
        <div className="release-icon"><Box size={24} /></div>
        <div>
          <div className="release-title"><strong>{release.version}</strong><StatusBadge status={release.status} /></div>
          <p>{release.notes || 'ללא פירוט'}</p>
          <small>{release.fileCount} קבצים · {(release.totalBytes / 1024 / 1024).toFixed(1)} MB · {release.uploadType === 'folder' ? 'dist' : 'dist ZIP'} · {formatDate(release.createdAt)}</small>
          <code>{release.sha256?.slice(0, 20)}…</code>
        </div>
        <div className="release-card-actions">
          <button className="icon-button" title="ערוך ריליס" onClick={() => setEditingRelease(release)}><PencilLine size={18} /></button>
          <button className="danger-icon" title="מחק" onClick={async () => { if (confirm('למחוק את הריליס?')) { try { await api.deleteRelease(release.id); load(); } catch (e) { setError(e.message); } } }}><Trash2 size={18} /></button>
        </div>
      </article>)}
      {!releases.length && <Empty />}
    </div>
    {showUpload && <UploadReleaseModal versionInfo={versionInfo} onClose={() => setShowUpload(false)} onSave={upload} />}
    {editingRelease && <EditReleaseModal release={editingRelease} onClose={() => setEditingRelease(null)} onSave={(values) => saveReleaseEdit(editingRelease, values)} />}
  </div>;
}

function EditReleaseModal({ release, onClose, onSave }) {
  const [version, setVersion] = useState(release.version || '');
  const [notes, setNotes] = useState(release.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!version.trim()) return setError('מספר גרסה הוא שדה חובה.');
    setSaving(true);
    setError('');
    const saved = await onSave({ version: version.trim(), notes });
    if (!saved) setSaving(false);
  };
  return <Modal title={`עריכת ריליס ${release.version}`} onClose={onClose}>
    {error && <div className="alert"><CircleAlert size={18} />{error}</div>}
    <div className="form-stack">
      <Field label="מספר גרסה"><input dir="ltr" value={version} onChange={(event) => setVersion(event.target.value)} /></Field>
      <Field label="מה בוצע בריליס"><textarea rows="5" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      <small>קובצי ה-dist וה-SHA-256 אינם משתנים בעריכה — רק מספר הגרסה והפירוט.</small>
    </div>
    <div className="modal-actions"><button className="secondary-button" disabled={saving} onClick={onClose}>ביטול</button><button className="primary-button" disabled={saving || !version.trim()} onClick={submit}>{saving ? 'שומר...' : 'שמור שינויים'}</button></div>
  </Modal>;
}

function buildSourceTree(source) {
  const root = { name: '', path: '', children: new Map(), isDirectory: true };
  const entries = [
    ...(source?.files || []).map((item) => ({ path: item.path, size: item.size, excluded: false, isDirectory: false })),
    ...(source?.excluded || []).map((item) => ({ ...item, excluded: true })),
  ];
  for (const entry of entries) {
    const parts = String(entry.path || '').split('/').filter(Boolean);
    let node = root;
    let currentPath = '';
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: currentPath, children: new Map(), isDirectory: index < parts.length - 1 || Boolean(entry.isDirectory) });
      }
      node = node.children.get(part);
      if (index === parts.length - 1) Object.assign(node, entry, { name: part, path: currentPath, children: node.children });
    });
  }
  return root;
}

function TreeNode({ node, depth = 0 }) {
  const children = Array.from(node.children?.values?.() || []).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  if (node.isDirectory) {
    return <details className={`source-tree-folder ${node.excluded ? 'excluded' : ''}`} open={depth < 2}><summary><span className="source-tree-indent" style={{ width: `${depth * 14}px` }} /><Folder size={15} /><span>{node.name || 'מקור'}</span>{node.excluded && <small>{node.reason || 'לא יעלה'}</small>}</summary>{!node.excluded && children.map((child) => <TreeNode key={child.path} node={child} depth={depth + 1} />)}</details>;
  }
  return <div className={`source-tree-file ${node.excluded ? 'excluded' : ''}`}><span className="source-tree-indent" style={{ width: `${depth * 14}px` }} />{node.excluded ? <EyeOff size={14} /> : <FileCode2 size={14} />}<span>{node.name}</span>{node.excluded ? <small>{node.reason}</small> : <small>{formatBytes(node.size)}</small>}</div>;
}

function SourcePreview({ source }) {
  const summary = summarizeSource(source);
  const tree = useMemo(() => buildSourceTree(source), [source]);
  const roots = Array.from(tree.children.values());
  return <div className="source-preview"><div className="source-summary"><div><strong>{source.rootName || 'dist'}</strong><span>{summary.fileCount.toLocaleString('he-IL')} קבצים יעלו · {formatBytes(summary.totalBytes)}</span>{source.detectedFromProjectRoot && <small>זוהתה תיקיית dist אוטומטית מתוך תיקיית הפרויקט — שאר הפרויקט לא יעלה.</small>}</div><div className="source-summary-badges"><span className="included-badge">Universal dist מוכן</span>{summary.excludedCount > 0 && <span className="excluded-badge">{summary.excludedCount} קובצי overlay ייווצרו בפריסה</span>}</div></div><div className="source-tree" dir="ltr">{roots.map((node) => <TreeNode key={node.path} node={node} />)}</div></div>;
}

function UploadReleaseModal({ versionInfo, onClose, onSave }) {
  const [version, setVersion] = useState(versionInfo?.recommended || '');
  const [notes, setNotes] = useState('');
  const [source, setSource] = useState(null);
  const [zipFile, setZipFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const folderInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const pickerSupport = useMemo(() => folderPickerDiagnostics(), []);

  const setFolderSource = (next) => {
    if (!next?.files?.length) throw new Error('לא נמצאו קבצים בתיקיית dist.');
    validateDistSource(next);
    setSource(next);
    setZipFile(null);
  };

  const onFolderPicked = (event) => {
    const files = event.target.files;
    if (!files?.length) return;
    setReading(true);
    setUploadError('');
    try {
      setFolderSource(collectSelectedFolder(files));
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setReading(false);
      event.target.value = '';
    }
  };

  const chooseFolderAdvanced = async () => {
    if (!pickerSupport.fileSystemAccess) return;
    setReading(true);
    setUploadError('');
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      setFolderSource(await collectDirectoryHandle(handle));
    } catch (error) {
      if (error?.name !== 'AbortError') setUploadError(`לא ניתן לקרוא את התיקייה: ${error.message}`);
    } finally {
      setReading(false);
    }
  };

  const onDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    setReading(true);
    setUploadError('');
    try { setFolderSource(await collectDroppedFolder(event.dataTransfer)); }
    catch (error) { setUploadError(`לא ניתן לקרוא את התיקייה: ${error.message}`); }
    finally { setReading(false); }
  };

  const onZipPicked = (event) => {
    const file = event.target.files?.[0] || null;
    if (file) { setZipFile(file); setSource(null); setUploadError(''); }
    event.target.value = '';
  };

  const submit = async () => {
    setSaving(true);
    setUploadError('');
    try {
      await onSave({ version, notes, source: source || { kind: 'zip', file: zipFile } });
    } catch (error) {
      setUploadError(error.message);
      setSaving(false);
    }
  };

  const ready = Boolean(version && ((source?.files?.length || 0) > 0 || zipFile));
  return <Modal title="ריליס חדש" onClose={onClose} wide><div className="form-stack">
    {uploadError && <div className="alert"><CircleAlert size={18} />{uploadError}</div>}
    <div className="version-suggestion-panel">
      <div><strong>{versionInfo?.latestVersion ? `הריליס האחרון: ${versionInfo.latestVersion}` : 'זה הריליס הראשון'}</strong><span>בחר קפיצה או כתוב מספר ידנית.</span></div>
      <div className="version-suggestion-actions">
        <button type="button" onClick={() => setVersion(versionInfo?.hotfix || '0.1.0')}><span>Hotfix / Patch</span><strong dir="ltr">{versionInfo?.hotfix || '0.1.0'}</strong></button>
        <button type="button" onClick={() => setVersion(versionInfo?.minor || '0.1.0')}><span>שינוי / Minor</span><strong dir="ltr">{versionInfo?.minor || '0.1.0'}</strong></button>
        <button type="button" onClick={() => setVersion(versionInfo?.major || '1.0.0')}><span>Major</span><strong dir="ltr">{versionInfo?.major || '1.0.0'}</strong></button>
      </div>
    </div>
    <div className="form-grid release-meta-grid"><Field label="מספר גרסה"><input dir="ltr" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="0.1.15" /></Field><Field label="מה בוצע בריליס"><textarea rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="תיקונים ושינויים בריליס..." /></Field></div>
    <div className={`folder-drop-zone ${dragging ? 'dragging' : ''}`} onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { e.preventDefault(); if (e.currentTarget === e.target) setDragging(false); }} onDrop={onDrop}>
      <CloudUpload size={34} />
      <strong>{reading ? 'קורא את התיקייה...' : 'גרור לכאן את תיקיית dist'}</strong>
      <span>אפשר גם לגרור את תיקיית הפרויקט — אם קיימת בה dist, המערכת תיקח רק אותה ולא תיגע בשאר הקבצים.</span>
      <div className="folder-picker-actions">
        <label className={`secondary-button folder-picker-label ${reading || saving ? 'disabled' : ''}`}>
          <Folder size={17} />בחר תיקיית dist
          <input ref={folderInputRef} className="hidden-file-input" type="file" webkitdirectory="true" directory="" multiple disabled={reading || saving} onChange={onFolderPicked} />
        </label>
        {pickerSupport.fileSystemAccess && <button type="button" className="ghost-button" disabled={reading || saving} onClick={chooseFolderAdvanced}>בחירה מתקדמת</button>}
      </div>
      {!pickerSupport.webkitDirectory && !pickerSupport.fileSystemAccess && <small className="folder-browser-warning">הדפדפן המשובץ לא תומך בבחירת תיקיות. פתח את http://localhost:5173 ב-Chrome רגיל או גרור את תיקיית dist לכאן.</small>}
    </div>
    <div className="auto-exclude-row"><strong>הריליס כולל רק:</strong><span>index.html</span><span>assets</span><span>images וקבצי build</span><span>Runtime Config נוצר בזמן הפריסה</span></div>
    {source && <SourcePreview source={source} />}
    {zipFile && <div className="zip-fallback-selected"><FileArchive size={18} /><div><strong>{zipFile.name}</strong><span>{formatBytes(zipFile.size)}</span></div><button className="icon-button" onClick={() => setZipFile(null)}><X size={16} /></button></div>}
    <div className="zip-fallback"><span>יש לך dist.zip?</span><button type="button" onClick={() => zipInputRef.current?.click()}>בחר dist.zip</button><input ref={zipInputRef} className="hidden-file-input" type="file" accept=".zip,application/zip" onChange={onZipPicked} /></div>
  </div><div className="modal-actions"><button className="secondary-button" disabled={saving} onClick={onClose}>ביטול</button><button className="primary-button" disabled={!ready || saving || reading} onClick={submit}><CloudUpload size={17} />{saving ? 'מעלה ושומר...' : 'שמור ריליס'}</button></div></Modal>;
}

export default function App() { return <Layout />; }
