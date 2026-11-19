# CommerceKit website integration contract

The [CommerceKit Sandbox website](https://commercekit.tools/sandbox/ccv2) calls the
independently deployed API at `https://ccv2.sandbox.commercekit.tools`.
The website owns the API reference, documentation and interactive Playground; the Worker owns
the API and isolated simulation state.

## Required endpoints

| Purpose               | Method and path                                | Authorization                                         |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Health                | `GET /sandbox/v1/health`                       | None                                                  |
| Management OpenAPI    | `GET /openapi.json`                            | None                                                  |
| Sandbox OpenAPI       | `GET /openapi/sandbox.json`                    | None                                                  |
| Create run            | `POST /sandbox/v1/runs`                        | None; public rate limit applies                       |
| Run detail            | `GET /sandbox/v1/runs/{runId}`                 | Control bearer                                        |
| Scenario              | `GET`, `PUT /sandbox/v1/runs/{runId}/scenario` | Control bearer                                        |
| Sanitized state       | `GET /sandbox/v1/runs/{runId}/state`           | Control bearer                                        |
| Reset                 | `POST /sandbox/v1/runs/{runId}/reset`          | Control bearer                                        |
| Advanced test fixture | `PUT /sandbox/v1/runs/{runId}/cleanup-fixture` | Control bearer; isolated test setup                   |
| Delete                | `DELETE /sandbox/v1/runs/{runId}`              | Control bearer                                        |
| OAuth token           | `POST /oauth2/token`                           | Synthetic client credentials in the form body         |
| Public signing keys   | `GET /.well-known/jwks.json`                   | None                                                  |
| Management operations | `/v2/subscriptions/{subscriptionCode}/...`     | Synthetic access token in `x-approuter-authorization` |

Use the synthetic subscription code `131762872233634f29fdeb7d50983aa4` for
Management API paths. Build codes use the production-shaped `YYYYMMDD.N` form,
and deployment codes are numeric strings. Always retain the code returned by a
create response instead of deriving the next value in browser code.

## Run and authorization flow

Create a run and retain the returned values only for the active browser session:

```http
POST /sandbox/v1/runs

HTTP/1.1 201 Created
Content-Type: application/json

{
  "runId": "run_...",
  "controlToken": "...",
  "expiresAt": "2026-10-16T18:00:00.000Z",
  "credentials": {
    "clientId": "ccv2_run_..._...",
    "clientSecret": "...",
    "resource": "urn:commercekit:ccv2:run_...",
    "tokenUrl": "https://ccv2.sandbox.commercekit.tools/oauth2/token"
  }
}
```

The control token is valid only for that run. Exchange the synthetic client
credentials using `application/x-www-form-urlencoded`:

```text
client_id=<clientId>&client_secret=<clientSecret>&grant_type=client_credentials&resource=<resource>
```

Send the returned access token as
`x-approuter-authorization: Bearer <token>` on Management requests. The optional
`x-sandbox-run-id` header may correlate browser activity, but it must match the
authenticated token and is never a credential.

Control tokens, client secrets, and access tokens must not appear in URLs,
analytics events, error telemetry, console logs, or persistent public storage.
The current Playground keeps them in an in-memory session provider; a full page refresh
clears the local session. Redact authorization headers before logging request diagnostics.

## Scenario configuration

`PUT /sandbox/v1/runs/{runId}/scenario` replaces the complete scenario:

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
  "faults": []
}
```

`pollsBeforeTerminal = N` produces N nonterminal progress responses and the
terminal result on the next progress call. Existing builds and deployments keep
the scenario snapshot from creation. Reset deletes run resources and counters,
restores the default scenario, and preserves credentials and expiration.

## Errors

- Management API errors use `application/problem+json` with `title` and
  `detail`.
- Control API errors use `application/json` with
  `{ "error": { "code": "...", "message": "..." } }`.
- OAuth errors use `application/json` with `error` and `error_description`.

The website should branch on HTTP status and media type before decoding an error.
Treat `401` as token invalidation, `403` as a run/token mismatch, `404` after
expiry or deletion as a terminal run state, `429` as retryable only after the
provided `Retry-After`, and unexpected `5xx` as a visible failure. The current Playground
does not automatically replay general requests: its bounded progress poller handles `429`
with `Retry-After`, while other polling failures stop and can be resumed deliberately.
Do not replay a create mutation whose server-side outcome is unknown.

## CORS and browser requests

The checked-in allowlist includes exactly `https://commercekit.tools` and the
CommerceKit Vite development origin `http://localhost:5173`. Override the
comma-separated `ALLOWED_ORIGINS` value when another exact development origin
is required; origins do not include a trailing slash. Preflight responses allow
`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`, plus these request
headers:

- `Authorization`
- `Content-Type`
- `x-approuter-authorization`
- `x-sandbox-run-id`
- `x-request-id`

Unlisted origins receive no permissive CORS headers. CORS is a browser boundary;
it is not authentication or abuse prevention.

## Expiration and cleanup

Runs expire 24 hours after creation. An expired or deleted run cannot issue a
new token, and previously issued tokens stop authorizing Management operations.
The website should show the expiry, stop polling at terminal states, cap all
polling attempts, and delete a run when the user ends the playground session.
The current Playground preserves the active in-memory run during client-side navigation
across the website; End Session explicitly removes it. A full page refresh clears the local
credentials. Browser unload cannot guarantee cleanup, so server-side expiration remains
the fallback when deletion cannot complete.

## OpenAPI reference and advanced fixtures

Both documents are OpenAPI 3.1 JSON, use the public API server URL, define their
security schemes, and contain typed request and response schemas. The published
[API reference](https://commercekit.tools/sandbox/ccv2/api) uses Swagger UI to display
the Management and Sandbox Control documents. Try requests, credential configuration,
credential persistence and the external validator are disabled there. Interactive runs and
synthetic credentials belong to the [Playground](https://commercekit.tools/sandbox/ccv2/playground).

The Control document also exposes `seedCleanupFixture` for advanced isolated integration
tests. It seeds bounded build/deployment records and deterministic cleanup races; it is not
a Playground editor or a SAP endpoint. Hosted approval testing uses it to recreate a build
after the original run is removed. See the
[integration workflow guide](https://github.com/commercekit-tools/action-integration-tests/blob/1174dd82b4a8c4f049e234d1862387b56571c0b0/docs/WORKFLOWS.md)
for that synthetic handoff and the separate dry-run eligibility limits.
