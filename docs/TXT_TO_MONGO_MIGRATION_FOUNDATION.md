# TXT to Mongo Migration Foundation

> **Current boundary:** rehearsal is no longer an ordinary Mongo site field.
> Only the Migration workflow can mark a separately allocated Mongo target as
> `migrationRehearsal`; it does not authorize production migration, TXT
> modification, cutover, or backend conversion.

Migration never flips the backend of an existing Site. A plan links:

1. an unchanged TXT production source;
2. a distinct Mongo destination marked `migrationRehearsal: true` by the
   migration-only endpoint.

The API rejects same-record, wrong-backend, same-target and same-Mongo-ID pairs. Current plan states stop at rehearsal preparation; there is no Apply, Cutover or production mutation endpoint.

Future cutover is expected to freeze TXT writes, make a final TXT backup, invoke Site Builder-owned migration tooling, verify counts and hashes, deploy the Mongo runtime frontend, run acceptance smoke, promote the destination, and retain TXT for rollback. None of those destructive operations are implemented here.

If Site Builder migration tooling cannot be exposed without widening privileges, execution remains operator-only while Release Manager stores inventory, warnings, validation and rehearsal tracking.
