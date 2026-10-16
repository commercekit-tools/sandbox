# CCv2 production readiness

Assessment date: **2026-10-15**. The reviewed SAP reference is Management API
**2.0.12**. Results apply to this feature branch; the deployed production Worker
continues to run the last merged `main` build until this PR is reviewed and
merged through Cloudflare Workers Builds.

| Area                       | Assessment                      | Evidence and gaps                                                                                                                                                                                                               |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Management API contract    | Verified with gaps              | 52 methods, paths, IDs, statuses, media types, and named schemas pass the static gate; representative responses pass runtime schema checks. Low-severity simulation limits are in `contract-audit.md`.                          |
| Sandbox Control API        | Verified                        | Ten operations, typed OpenAPI, separate control error shape, run lifecycle tests.                                                                                                                                               |
| OAuth/JWT                  | Verified                        | RS256 signature, algorithm, `kid`, issuer, audience, expiry, subject/run binding, current-run validation, and public-only JWKS tested.                                                                                          |
| Run isolation              | Verified                        | Independent credentials, control-token scope, access-token scope, correlation mismatch, state redaction, and multi-run resources tested.                                                                                        |
| Durable Object persistence | Verified                        | SQLite migrations, eviction recovery, serialized creation/polling, monotonic identifiers, reset, deletion, alarms, and parallel quota enforcement tested.                                                                       |
| Build lifecycle            | Verified                        | Success, failure, nontermination, stable terminal state, deletion, filters, progress, faults, and ZIP structure tested.                                                                                                         |
| Deployment lifecycle       | Verified                        | Eligibility, environment scope, conflicts, failure, nontermination, cancellation, green decisions, split history, and environment outcome tested.                                                                               |
| Extended Cloud Portal APIs | Verified with gaps              | Every family has behavior tests and typed representative response validation. Physical infrastructure effects are simulated; scheduled ordering supports two fields.                                                            |
| Security                   | Verified                        | Request limits, malformed inputs, token negatives, cross-token misuse, secret redaction, error sanitization, and constant-time verifier comparisons tested/reviewed.                                                            |
| Public rate limiting       | Verified with limitation        | Anonymous run creation uses the binding and local boundary tests. Cloudflare documents per-location, eventually consistent behavior; it is abuse friction rather than exact global accounting. No production load test was run. |
| Production smoke testing   | Passed                          | The bounded opt-in suite passed against production: health, OpenAPI, OAuth/JWKS, success, ZIP, failure/timeout, isolation, deleted-run, green-decision, and cleanup checks. This verifies deployed `main`, not unmerged code.   |
| OpenAPI/Scalar readiness   | Verified                        | Both OpenAPI 3.1 documents validate, use the public server, publish distinct security/error models, and contain no retired mock aliases.                                                                                        |
| SCIM                       | Separate architectural decision | Deferred; see `scim-decision.md`.                                                                                                                                                                                               |
| Website integration        | Ready                           | Required endpoints, CORS, credentials, scenario flow, errors, expiry, cleanup, and Scalar guidance are documented.                                                                                                              |

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

1. Review the PR's GitHub CI result. The workflow now points at the correct pnpm
   package and runs the OpenAPI gate explicitly.
2. Confirm the existing `CCV2_RUN` namespace, custom domain, four required
   secrets, and rate-limit namespace remain configured before merging.
3. After merge and the normal Cloudflare Workers Builds deployment, repeat the
   production smoke suite to verify this branch's deployed artifact.
4. Merge only through the normal review path. Do not deploy this feature branch.

No secret or Cloudflare resource change is required by this branch. Schema
version 3 is additive. Rolling back code leaves the additional
`resource_sequences` table unused; existing run metadata and resources remain
readable by the previous schema version. Runs created after rollback could reuse
an extended-resource identifier only after a deletion, which is why rollback
should be followed by forward redeployment rather than prolonged operation.
