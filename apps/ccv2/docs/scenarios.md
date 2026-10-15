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
