# CCv2 production readiness

Assessment refreshed **2026-11-18**, against merged API source
`4af998a4783ffa54dd5d7835bfc0dcc4dd382e14`. The reviewed SAP reference remains
Management API **2.0.12**. The contract and Worker-runtime assessments below describe
repository checks; production observations and their limits are recorded separately.

| Area                       | Assessment                      | Evidence and gaps                                                                                                                                                                                                               |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Management API contract    | Verified with gaps              | 52 methods, paths, IDs, statuses, media types, and named schemas pass the static gate; representative responses pass runtime schema checks. Low-severity simulation limits are in `contract-audit.md`.                          |
| Sandbox Control API        | Verified                        | Eleven operations, including isolated cleanup-fixture seeding, typed OpenAPI, separate control errors and run lifecycle tests.                                                                                                  |
| OAuth/JWT                  | Verified                        | RS256 signature, algorithm, `kid`, issuer, audience, expiry, subject/run binding, current-run validation, and public-only JWKS tested.                                                                                          |
| Run isolation              | Verified                        | Independent credentials, control-token scope, access-token scope, correlation mismatch, state redaction, and multi-run resources tested.                                                                                        |
| Durable Object persistence | Verified                        | SQLite migrations, eviction recovery, serialized creation/polling, monotonic identifiers, reset, deletion, alarms, and parallel quota enforcement tested.                                                                       |
| Build lifecycle            | Verified                        | Success, failure, nontermination, stable terminal state, deletion, filters, progress, faults, and ZIP structure tested.                                                                                                         |
| Deployment lifecycle       | Verified                        | Eligibility, environment scope, conflicts, failure, nontermination, cancellation, green decisions, split history, and environment outcome tested.                                                                               |
| Extended Cloud Portal APIs | Verified with gaps              | Every family has behavior tests and typed representative response validation. Physical infrastructure effects are simulated; scheduled ordering supports two fields.                                                            |
| Security                   | Verified                        | Request limits, malformed inputs, token negatives, cross-token misuse, secret redaction, error sanitization, and constant-time verifier comparisons tested/reviewed.                                                            |
| Public rate limiting       | Verified with limitation        | Anonymous run creation uses the binding and local boundary tests. Cloudflare documents per-location, eventually consistent behavior; it is abuse friction rather than exact global accounting. No production load test was run. |
| Production checks          | Evidence below                  | Public read-only observations, historical broad smoke and hosted Action workflows have different coverage. No new mutating production smoke is claimed by this refresh.                                                         |
| OpenAPI readiness          | Verified                        | Both OpenAPI 3.1 documents validate, use the public server, publish distinct security/error models, and contain no retired mock aliases.                                                                                        |
| SCIM                       | Separate architectural decision | Deferred; see `scim-decision.md`.                                                                                                                                                                                               |
| Website integration        | Implemented                     | The published website owns the read-only Swagger UI reference and interactive Playground. See `website-integration.md` for endpoints, credentials, errors, CORS and cleanup.                                                    |

## Validation evidence and limits

- [Main CI run 43620784834](https://github.com/commercekit-tools/sandbox/actions/runs/43620784834)
  passed 63 Worker-runtime tests across 14 files, generated binding types, OpenAPI validation,
  lint/type checks and the Worker bundle dry-run for the assessed source.
- Read-only production checks on November 18 UTC returned healthy Worker/SQLite status,
  the expected production website CORS header and a public-only RSA JWKS. Both published
  OpenAPI objects matched the assessed main YAML. Matching public contracts does not identify
  the deployed code commit or prove fresh token issuance or every lifecycle path.
- The October 15 assessment recorded a passing opt-in production smoke covering OAuth,
  lifecycle success/failure/timeouts, isolation, ZIP logs, green decisions and run removal.
  That historical result is not a new execution of this branch.
- The owner-authorized November 15 hosted
  [build/approval/synthetic-deploy run](https://github.com/commercekit-tools/action-integration-tests/actions/runs/43681867766)
  and [cleanup dry-run/repeat run](https://github.com/commercekit-tools/action-integration-tests/actions/runs/43681889413)
  passed. The approved deploy recreated a synthetic build in a fresh run; provider delivery
  was disabled. The [integration evidence](https://github.com/commercekit-tools/action-integration-tests/blob/1174dd82b4a8c4f049e234d1862387b56571c0b0/docs/VALIDATION.md)
  preserves the tested revisions, assertions and verified run removals.

The original hosted smoke/full/provider matrix, live Slack/Teams delivery and dedicated
hosted cancellation/timeout scenarios remain unrun in that evidence. They require a separate
deliberate authorization. Sandbox success does not establish real SAP cleanup eligibility,
operational deletion guarantees or Action release approval.

## Development dependency security

The development-only minimatch 10.2.6 paths in ESLint and TypeScript-ESLint were affected by
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
ESLint 10.15.0 and TypeScript-ESLint 8.73.0 adopt patched upstream requirements; the lockfile
resolves minimatch 11.0.9 without an override. Worker runtime dependencies are unchanged.
`pnpm security:audit` checks the complete dependency graph, including development tooling,
in the existing local and GitHub CI gates.

## Security hardening completed

- Vendor problems retain `application/problem+json`; control and OAuth errors
  retain their own formats.
- Bearer header parsing is bounded, malformed tokens fail closed, and verifier
  comparison pads unequal inputs before the runtime constant-time comparison.
- Access tokens are rejected after deletion or expiry. Control and SAP tokens
  are not interchangeable.
- The state API excludes client secrets, control tokens, bearer tokens, signing
  keys, and stored verifiers.
- The schema migration adds monotonic per-resource counters so deletion cannot
  cause identifier reuse or collision. Existing run tables and data remain in
  place.
- Unknown Management routes and unhandled Management failures use sanitized SAP
  problem responses.

## Remaining risks and manual checks

1. Review the exact change's GitHub CI result, including dependency security and OpenAPI checks.
2. Confirm the existing `CCV2_RUN` namespace, custom domain, four required
   secrets, and rate-limit namespace remain configured before merging.
3. After a runtime deployment, use the documented read-only checks first. Run the mutating
   production smoke only with explicit authorization and retain its sanitized result.
4. Keep normal review and main-based Cloudflare Workers Builds as the deployment path.

The dependency/documentation update does not require new secrets, bindings or storage
migrations. The existing schema version 3 is additive. Rolling back code leaves the additional
`resource_sequences` table unused; existing run metadata and resources remain
readable by the previous schema version. Runs created after rollback could reuse
an extended-resource identifier only after a deletion, which is why rollback
should be followed by forward redeployment rather than prolonged operation.
