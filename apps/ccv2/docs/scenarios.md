# Deterministic scenarios

Configure a scenario with the run-control token:

```json
{
  "build": {
    "outcome": "SUCCESS",
    "pollsBeforeTerminal": 2,
    "logsAvailable": true
  },
  "deployment": {
    "outcome": "DEPLOYED",
    "pollsBeforeTerminal": 3,
    "cancellationAllowed": true,
    "requireGreenDecision": true
  },
  "faults": [
    {
      "operationId": "getBuildProgress",
      "status": 429,
      "onCalls": [2],
      "retryAfterSeconds": 1
    }
  ]
}
```

Build outcomes are `SUCCESS`, `FAIL`, and `NEVER`. Deployment outcomes are
`DEPLOYED`, `FAIL`, and `NEVER`. `NEVER` remains in the documented nonterminal
status (`BUILDING` or `DEPLOYING`); the sandbox does not invent a vendor
`TIMEOUT` status.

`pollsBeforeTerminal = N` means N nonterminal progress responses followed by a
terminal response on poll N+1. With a value of 2, a build is `BUILDING` on polls
1 and 2 and terminal on poll 3. Terminal results remain stable. Green
deployments can pause at 90 percent until `ACCEPT`, `PREPARE_CANARY`, or `REJECT`
is submitted. Cancellation ends an eligible deployment as `UNDEPLOYED` and
persists the documented `cancelation` detail.

Faults are scoped to an official operation ID and may additionally name a
resource identifier. Supported statuses are 400, 401, 403, 404, 409, 412, 423,
429, and 500. `onCalls` counts only matching operation/resource calls. A 429 can
include `Retry-After`. Fault bodies use the Management API
`application/problem+json` shape.

Scenario changes apply to operations created afterward. Existing builds and
deployments retain their snapshot. Updating a scenario resets only fault-call
counters. Resetting a run removes simulation resources and counters and restores
the default scenario while retaining its credentials, expiration, and security
boundary.

## Cleanup fixtures (candidate integration)

`PUT /sandbox/v1/runs/{runId}/cleanup-fixture` requires the run-control bearer.
It replaces only that run's builds/deployments (150/30 record limits), clears
operation counters, and accepts optional `changes` and `loseDeleteResponse`
simulation controls. The normal 64 KiB request limit still applies. A fixture's
`response` is the vendor-shaped record; intentionally malformed records are
supported so clients can test fail-closed validation.

`modifiedAt` is internal fixture metadata. When supplied, deletion rejects builds
modified within four hours. It is never returned by SAP-shaped build reads and
is not evidence that SAP exposes a build modification timestamp or enforces this
precondition at its API.

Changes specify `operationId` (`getBuilds`, `getBuild`, `deleteBuild`), `onCall`,
`buildCode`, and either `patch` or `remove`. Call counters are per operation and
resource, making races deterministic. `loseDeleteResponse` models acceptance
followed by a 500 response; the build remains stored with status `DELETED`,
representing deletion initiation rather than physical disappearance.

The existing state endpoint's `faultCounters` now counts all target operations
(and token issuance), even when no fault is configured. Keys such as
`deleteBuild:build-1` count attempted target mutations independently of control
fixture operations; do not count run teardown or fixture PUT as SAP mutations.

Always delete the isolated run in a `finally` block. Hosted runs require explicit
configuration; these controls do not grant permission for production SAP writes.
