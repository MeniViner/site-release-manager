import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clearManagementSession } from './api.js';

/**
 * The client half of the management-session contract.
 *
 * Only the session exchange may be credentialed; every consequential mutation
 * must be Bearer-authorized and explicitly non-credentialed, because allowing
 * browser credentials on routine traffic is what let an IIS challenge escalate
 * into a native Windows credential dialog.
 *
 * A retry after a session refresh must reuse the SAME idempotency key, or the
 * server would allocate a second site for one create intent.
 */
describe('client management session', () => {
  let calls;
  // globalThis.fetch is replaced below; capture the real one so it is restored
  // rather than left stubbed for whichever file shares this worker next.
  // Note: api.js is imported STATICALLY and reset through its own exported
  // helper. Using vi.resetModules() here swapped the module instance out from
  // under sibling suites that spy on `api`, which made them fail by ordering.
  const realFetch = globalThis.fetch;

  const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(body),
    json: async () => body,
  });

  beforeEach(() => {
    calls = [];
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/api/auth/session')) {
        return jsonResponse({ ok: true, token: `token-${calls.length}`, principal: 'domain\\operator' }, 201);
      }
      return jsonResponse({ site: { id: 'site-1' } }, 201);
    });
    clearManagementSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = realFetch;
    clearManagementSession();
  });

  const find = (fragment) => calls.filter((c) => c.url.includes(fragment));

  it('establishes the session with credentials and nothing else', async () => {
    await api.createSite({ storageBackend: 'mongo', name: 'x' });
    const session = find('/api/auth/session');
    expect(session).toHaveLength(1);
    expect(session[0].options.credentials).toBe('include');
    // Custom headers would make this a preflighted request, and the preflight
    // would be challenged on the Windows-protected path.
    expect(Object.keys(session[0].options.headers || {})).toEqual(['Accept']);
  });

  it('sends the mutation with Bearer and explicitly omits credentials', async () => {
    await api.createSite({ storageBackend: 'mongo', name: 'x' });
    const create = find('/api/sites').filter((c) => c.options.method === 'POST');
    expect(create).toHaveLength(1);
    expect(create[0].options.credentials).toBe('omit');
    expect(create[0].options.headers.Authorization).toMatch(/^Bearer /);
  });

  it('reuses the SAME idempotency key when a retry follows a session refresh', async () => {
    let createAttempts = 0;
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/api/auth/session')) {
        return jsonResponse({ ok: true, token: `token-${calls.length}`, principal: 'domain\\operator' }, 201);
      }
      createAttempts += 1;
      // First attempt: the session expired between establishment and use.
      if (createAttempts === 1) {
        return jsonResponse({ ok: false, error: { code: 'management_session_required' } }, 401);
      }
      return jsonResponse({ site: { id: 'site-1' } }, 201);
    });

    await api.createSite({ storageBackend: 'mongo', name: 'x' });

    const creates = find('/api/sites').filter((c) => c.options.method === 'POST');
    expect(creates).toHaveLength(2);
    const keys = creates.map((c) => c.options.headers['Idempotency-Key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    // The retry must carry a NEW token, otherwise it would fail identically.
    expect(creates[1].options.headers.Authorization).not.toBe(creates[0].options.headers.Authorization);
  });

  it('gives a distinct key to a genuinely separate create intent', async () => {
    await api.createSite({ storageBackend: 'mongo', name: 'a' });
    await api.createSite({ storageBackend: 'mongo', name: 'b' });
    const keys = find('/api/sites')
      .filter((c) => c.options.method === 'POST')
      .map((c) => c.options.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('collapses concurrent management calls onto one session handshake', async () => {
    await Promise.all([
      api.createSite({ storageBackend: 'mongo', name: 'a' }),
      api.createSite({ storageBackend: 'mongo', name: 'b' }),
      api.createSite({ storageBackend: 'mongo', name: 'c' }),
    ]);
    expect(find('/api/auth/session')).toHaveLength(1);
  });

  it('carries the session on every consequential mutation, not only creation', async () => {
    await api.updateSite('s1', { name: 'n' });
    await api.deleteSite('s1');
    await api.deploy('s1', 'r1');
    await api.updateRelease('r1', { version: '1.0.1' });
    await api.deleteRelease('r1');
    const mutations = calls.filter((c) => !c.url.includes('/api/auth/session'));
    expect(mutations).toHaveLength(5);
    for (const call of mutations) {
      expect(call.options.headers.Authorization).toMatch(/^Bearer /);
      expect(call.options.credentials).toBe('omit');
    }
  });

  it('does not drag a session into a TXT registration', async () => {
    await api.createSite({ storageBackend: 'txt', name: 'txt-site' });
    expect(find('/api/auth/session')).toHaveLength(0);
  });
});
