# Mongo Site Provisioning

Site Builder owns Mongo registration, collections, indexes, canonical seed content, schema migrations and backup semantics. Release Manager only calls the authenticated Site Builder API.

A Release Manager Mongo Site stores:

- `storageBackend: "mongo"`
- `builderSiteId` (mapped to runtime `siteId`)
- `backendProfileId`
- public `backendApiUrl`
- SharePoint host, `siteCode`, frontend library/folder and images path
- optional `rehearsal: true`

Before frontend staging, Release Manager verifies Site Builder health reports Mongo, calls the idempotent provision endpoint, and verifies provision status. A normal update may create missing canonical objects but must never overwrite existing application data.

The Mongo SharePoint plan contains the frontend library, `dist`, images and release asset folders. It intentionally contains no TXT seeds, users-data library or TXT permissions marker.

Health compatibility is strict: a known backend mismatch or incompatible Universal `storageCompatibility` blocks deployment. Data-schema requirements can be enforced from `requiresDataSchemaVersion` as manifests adopt that field.

