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

Universal releases are shared artifacts. `universalProof.storageCompatibility` must explicitly contain the active backend. Older artifacts without this field fail closed; they must be re-ingested from a current Universal build.

## Secrets

`SITE_BUILDER_BACKEND_PROFILES` is server-only JSON:

```json
{
  "rehearsal": {
    "url": "https://site-builder-api.example",
    "apiKey": "server-secret"
  }
}
```

Sites store only `backendProfileId` and the matching public `backendApiUrl`. API keys are never returned by `/api/config`, written into runtime config, deployment metadata, SharePoint or logs.

