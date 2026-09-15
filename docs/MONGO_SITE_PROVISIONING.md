# Mongo Site Provisioning

Mongo provisioning is embedded in Site Release Manager. It calls the packaged,
versioned Site Builder domain in-process; it never calls an external Site
Builder API or sends an API key.

On ordinary Mongo creation, Release Manager generates the immutable
`builderSiteId`, allocates unique SharePoint library paths, records the creator
as the initial daily-data administrator, and returns a read-only technical
preview. `backendProfileId`, `backendApiUrl`, manually supplied site IDs and
`rehearsal` are not accepted as ordinary site settings.

During a new-site deployment, Release Manager creates only missing canonical
Site Builder objects and asserts `siteExists`, `provisioned`, and
`missingDefaults === 0` before recording success. Normal deployments of
existing Mongo sites do not seed, migrate, or rewrite application data. An
administrator may use the explicit `repair: true` daily-data endpoint to
repair incomplete provisioning. Migration rehearsal marking is available only
in the Migration workflow.

The Mongo SharePoint plan provisions only the unique frontend hosting library,
images, `dist`, and release asset folders. It creates no TXT seed files,
users-data library, or TXT permissions marker.
