# Bulk Deployments

`POST /api/deployment-batches` creates a durable orchestration record. A request contains one backend, one Universal release and unique Site IDs.

The server preflights every Site and rejects the entire request with explicit per-Site reasons when a Site is missing, belongs to another backend, or the release is incompatible. It never silently skips a target.

Child work uses the normal `createDeploymentJob()` path, including target locks, private staging, telemetry, retry/resume and browser leases. The batch does not implement a second deployment engine.

Concurrency is fixed at `1` in the initial foundation. Job creation continues after an individual failure and records that failure on the batch. `GET /api/deployment-batches/:id` derives live counts and state from child jobs. Child Run details remain authoritative.

