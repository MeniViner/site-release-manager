import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { getApiBootstrapDiagnostics, getApiHealthDiagnostics, initializeApiRuntime, verifyApiHealth } from './api.js';
import './styles.css';

function renderBootstrapFailure(root, error) {
  const diagnostics = getApiBootstrapDiagnostics();
  const health = getApiHealthDiagnostics();
  const details = diagnostics.length
    ? diagnostics.map((attempt, index) => [
      `ניסיון ${index + 1}: ${attempt.fileName}`,
      `URL: ${attempt.url}`,
      `HTTP: ${attempt.status || 'network-error'} ${attempt.statusText || ''}`.trim(),
      `Content-Type: ${attempt.contentType || 'unknown'}`,
      `Error: ${attempt.error || 'unknown'}`,
      `Preview: ${attempt.preview || '(empty)'}`,
    ].join('\n')).join('\n\n')
    : 'לא נרשמו ניסיונות Runtime Config.';

  createRoot(root).render(
    <div dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'Arial, sans-serif', background: '#f1f5f9', padding: 24 }}>
      <div style={{ width: 'min(920px, 100%)', background: '#fff', border: '1px solid #fecaca', borderRadius: 16, padding: 24, color: '#991b1b', boxShadow: '0 20px 50px rgba(15,23,42,.10)' }}>
        <h1 style={{ marginTop: 0 }}>אתחול Release Manager נכשל</h1>
        <p>{health ? 'Runtime Config נטען, אבל לא ניתן להגיע ל־Node API.' : 'לא ניתן לטעון את הגדרת ה־API של סביבת ההרצה.'}</p>
        <code dir="ltr" style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#fff7f7', padding: 12, borderRadius: 10 }}>{String(error?.message || error)}</code>
        {health && <>
          <h2 style={{ fontSize: 18, marginTop: 22 }}>אבחון API</h2>
          <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 10, maxHeight: 220, overflow: 'auto' }}>{[
            `URL: ${health.url || ''}`,
            `API Base: ${health.apiBaseUrl || ''}`,
            `Runtime source: ${health.runtimeSource || ''}`,
            `HTTP: ${health.status || 'network-error'} ${health.statusText || ''}`.trim(),
            `Runtime version: ${health.runtimeVersion || 'unknown'}`,
            `API version: ${health.apiVersion || 'unknown'}`,
            `Version match: ${health.versionMatches === false ? 'NO' : 'yes/unknown'}`,
            `Error: ${health.error || 'unreachable'}`,
            `Preview: ${health.preview || '(empty)'}`,
          ].join('\n')}</pre>
        </>}
        <h2 style={{ fontSize: 18, marginTop: 22 }}>אבחון Runtime Config</h2>
        <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 10, maxHeight: 360, overflow: 'auto' }}>{details}</pre>
        {health && /127\.0\.0\.1|localhost/i.test(health.url || '') ? (
          <p style={{ marginBottom: 0, color: '#7f1d1d', fontWeight: 700 }}>בדיקת SharePoint מקומית: השאר טרמינל פתוח עם <code dir="ltr">npm run sharepoint:local</code>. לאחר מכן רענן את הדף.</p>
        ) : (
          <p style={{ marginBottom: 0, color: '#7f1d1d' }}>אם ה־Preview מתחיל ב־&lt;!DOCTYPE או &lt;html, SharePoint החזיר עמוד HTML במקום קובץ Runtime Config. בדוק שהקובץ אכן קיים ליד index.html.</p>
        )}
      </div>
    </div>,
  );
}

async function bootstrap() {
  const root = document.getElementById('root');
  if (!root) throw new Error('Root element #root was not found.');

  try {
    await initializeApiRuntime();
    await verifyApiHealth();
    createRoot(root).render(
      <React.StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </React.StrictMode>,
    );
  } catch (error) {
    console.error('[release-manager] bootstrap failed', error);
    console.error('[release-manager] bootstrap diagnostics', getApiBootstrapDiagnostics());
    renderBootstrapFailure(root, error);
  }
}

bootstrap();
