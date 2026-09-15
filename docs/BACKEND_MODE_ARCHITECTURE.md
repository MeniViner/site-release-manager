# Backend Mode Architecture

Release Manager has two global operating modes: `txt` (the safe default) and `mongo`. The browser persists the selected mode in `localStorage`, applies it as `data-backend-mode`, and sends it as a validated API filter. A mode change never mutates a Site.

## Isolation

- Every Site, deployment job, batch and backup records `storageBackend`.
- `storageBackend` is immutable on a Site. Migration creates a separate linked destination.
- Deployment behavior is selected once through `deploymentProfiles.js`.
- The TXT profile retains the existing two-library, folder, seed, backup and browser pipeline.
- The Mongo profile emits no TXT seeds, users library or TXT permissions marker.
- A direct route to a Site in the other mode shows a boundary screen and disables deployment until the operator switches mode.

## Release compatibility

Universal releases are shared artifacts. `universalProof.storageCompatibility` must explicitly contain Mongo before a Mongo deployment. Older artifacts without this field retain legacy TXT compatibility only, preserving the existing production path while failing closed for Mongo.

## Central Mongo data service

Mongo sites use one server only: the existing Site Release Manager Express
application serves management routes under `/api/*` and the Site Builder daily
data service under `/api/daily-data/v1/*`. The browser receives only the
centrally configured `dailyDataApiUrl`; no backend profile, external server
URL, or API key is stored in a site, runtime overlay, browser bundle, or log.

The daily data database is configured independently through
`BUILDER_DATA_MONGO_DB_NAME`; management records remain in `MONGO_DB_NAME`.
The packaged Site Builder domain retains its own `sites`, revisions, audit,
backup, and logical-site collections inside that separate database.
