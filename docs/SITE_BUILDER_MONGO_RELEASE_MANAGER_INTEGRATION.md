# Site Builder and Release Manager runtime contract

## Canonical Mongo deployment

Release Manager allocates a stable logical `siteId`. SharePoint host, Web code,
hosting library, and folder paths are separate physical hosting identity. A
Mongo target receives:

```json
{
  "storageBackend": "mongo",
  "siteId": "srm-...",
  "dailyDataApiUrl": "https://sitebuilderhub.idf/api/daily-data/v1"
}
```

Site Builder resolves central data routes relative to that versioned base:

```text
{dailyDataApiUrl}/sites/{siteId}/...
```

It must not append another `/api`. `dailyDataApiUrl` is an absolute HTTP(S) URL
ending in `/api/daily-data/v1`, without credentials, query parameters, or a
fragment.

`backendApiUrl` is legacy compatibility only. When explicitly supplied by an
older deployment it retains its historical server-root behavior:

```text
{backendApiUrl}/api/sites/{siteId}/...
```

The fields are not aliases. Conflicting simultaneous values are rejected
instead of guessed or rewritten. TXT overlays contain neither field.

## Creation and authorization

Mongo creation follows this order:

1. Validate the requested Universal release and Mongo compatibility.
2. Resolve the trusted management principal.
3. Allocate and persist the immutable logical site identity.
4. Provision defaults idempotently and verify completeness.
5. Create the deployment job.
6. Let the browser worker perform authenticated SharePoint mutations.

The trusted principal becomes the initial viewer, submitter, editor, and
administrator. Browser-supplied identities, administrators, site IDs,
`backendApiUrl`, API keys, and CORS origins are never trusted. Production
rejects the development identity header.

Management and daily-data calls use credentials only on routes that require the
trusted Windows/IIS identity. CORS preflight remains anonymous at the Express
layer. Silent integrated Windows authentication, identity-header overwrite,
and prevention of direct backend bypass are environment acceptance gates.

## Deployment and acceptance

The stored Universal release remains immutable. Each run gets fresh staging,
target overlay files, a bootstrap script loaded before application scripts, and
regenerated hashes. Static upload success, runtime startup, and authorized data
access are separate acceptance states.

Local macOS tests prove source behavior and package integrity only. They do not
prove IIS schema support, silent domain authentication, SharePoint browser
sessions, Windows dependency compatibility, or real data access.
