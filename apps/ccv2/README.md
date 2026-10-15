# CommerceKit CCv2 Sandbox Worker

This Cloudflare Worker provides isolated, deterministic simulations for the SAP
Commerce Cloud Management API. It implements all 52 operations inventoried from
the published 2.0.12 contract across builds, deployments, environments,
endpoints, backups/restores, scaling, certificates, scheduled activities,
service properties, and role assignments.

The compatibility contract is independently authored. SAP's official
documentation remains the authority:
[Cloud Portal API](https://help.sap.com/docs/SAP_COMMERCE_CLOUD_PUBLIC_CLOUD/0fa6bcf4736c46f78c248512391eb467/66abfe678b55457fab235ce8039dda71.html?locale=en-US).

## Local setup

```bash
cd /Users/anil/projects/sandbox
corepack enable
pnpm install
pnpm --filter @commercekit/sandbox-ccv2 secrets:generate
pnpm dev:ccv2
```

The key generator creates an ignored `apps/ccv2/.dev.vars` with mode `0600`.
It refuses to rotate an existing file implicitly. The Worker listens on
`http://localhost:8787`. Exact local browser origins can be edited in
`ALLOWED_ORIGINS`; CORS is not authentication.

## Complete curl flow

The examples use `jq` and synthetic credentials created by the sandbox.

```bash
BASE_URL="http://localhost:8787"

# 1. Create a 24-hour run.
RUN_JSON="$(curl --fail --silent --show-error -X POST "$BASE_URL/sandbox/v1/runs")"
RUN_ID="$(jq -r .runId <<<"$RUN_JSON")"
CONTROL_TOKEN="$(jq -r .controlToken <<<"$RUN_JSON")"
CLIENT_ID="$(jq -r .credentials.clientId <<<"$RUN_JSON")"
CLIENT_SECRET="$(jq -r .credentials.clientSecret <<<"$RUN_JSON")"
RESOURCE="$(jq -r .credentials.resource <<<"$RUN_JSON")"

# 2. Obtain a synthetic OAuth token.
TOKEN_JSON="$(curl --fail --silent --show-error -X POST "$BASE_URL/oauth2/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "resource=$RESOURCE")"
ACCESS_TOKEN="$(jq -r .access_token <<<"$TOKEN_JSON")"

# 3. Configure successful build and deployment behavior.
curl --fail --silent --show-error -X PUT "$BASE_URL/sandbox/v1/runs/$RUN_ID/scenario" \
  -H "Authorization: Bearer $CONTROL_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "build":{"outcome":"SUCCESS","pollsBeforeTerminal":2,"logsAvailable":true},
    "deployment":{"outcome":"DEPLOYED","pollsBeforeTerminal":2,"cancellationAllowed":true,"requireGreenDecision":false},
    "faults":[]
  }'

# 4. Create a build.
BUILD_JSON="$(curl --fail --silent --show-error -X POST \
  "$BASE_URL/v2/subscriptions/SUBSCRIPTION_001/builds" \
  -H "x-approuter-authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"branch":"main","name":"sandbox-release","applicationCode":"commerce"}')"
BUILD_CODE="$(jq -r .code <<<"$BUILD_JSON")"

# 5. Poll three times: BUILDING, BUILDING, SUCCESS.
for _ in 1 2 3; do
  curl --fail --silent --show-error \
    "$BASE_URL/v2/subscriptions/SUBSCRIPTION_001/builds/$BUILD_CODE/progress" \
    -H "x-approuter-authorization: Bearer $ACCESS_TOKEN" | jq .
done

# 6. Download a valid ZIP log archive.
curl --fail --silent --show-error \
  "$BASE_URL/v2/subscriptions/SUBSCRIPTION_001/builds/$BUILD_CODE/logs" \
  -H "x-approuter-authorization: Bearer $ACCESS_TOKEN" \
  --output "$BUILD_CODE-logs.zip"

# 7. Create a deployment.
DEPLOYMENT_JSON="$(curl --fail --silent --show-error -X POST \
  "$BASE_URL/v2/subscriptions/SUBSCRIPTION_001/deployments" \
  -H "x-approuter-authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"buildCode\":\"$BUILD_CODE\",\"environmentCode\":\"d1\",\"databaseUpdateMode\":\"UPDATE\",\"strategy\":\"ROLLING_UPDATE\"}")"
DEPLOYMENT_CODE="$(jq -r .code <<<"$DEPLOYMENT_JSON")"

# 8. Poll three times: DEPLOYING, DEPLOYING, DEPLOYED.
for _ in 1 2 3; do
  curl --fail --silent --show-error \
    "$BASE_URL/v2/subscriptions/SUBSCRIPTION_001/deployments/$DEPLOYMENT_CODE/progress" \
    -H "x-approuter-authorization: Bearer $ACCESS_TOKEN" | jq .
done

# 9. Inspect sanitized state; credentials and their verifiers are excluded.
curl --fail --silent --show-error "$BASE_URL/sandbox/v1/runs/$RUN_ID/state" \
  -H "Authorization: Bearer $CONTROL_TOKEN" | jq .

# 10. Delete the run and all retained state.
curl --fail --silent --show-error -X DELETE "$BASE_URL/sandbox/v1/runs/$RUN_ID" \
  -H "Authorization: Bearer $CONTROL_TOKEN"
```

Never put real SAP credentials into this public sandbox.

## Behavior and limits

- Runs expire after 24 hours through Durable Object alarms.
- Scenario behavior is snapshotted when a build or deployment is created.
- Only progress endpoints advance lifecycle state.
- `pollsBeforeTerminal = N` yields N nonterminal responses and terminal state on N+1.
- `NEVER` stays `BUILDING` or `DEPLOYING`.
- Green deployments support decisions, canary preparation, and traffic splits.
- Reset clears resources, counters, and scenario configuration while preserving credentials and expiry.
- Vendor errors use `application/problem+json`; control errors use the documented control envelope.

See [architecture](docs/architecture.md), [authentication](docs/authentication.md),
[scenarios](docs/scenarios.md), [API coverage](docs/api-coverage.md), and
[deployment readiness](docs/cloudflare-deployment.md). The final review artifacts
are the [contract audit](docs/contract-audit.md), [production readiness report](docs/production-readiness.md),
[SCIM decision](docs/scim-decision.md), and [website integration contract](docs/website-integration.md).

## Contracts and validation

- Management API: `GET /openapi.json`
- Sandbox control API: `GET /openapi/sandbox.json`
- JWKS: `GET /.well-known/jwks.json`
- Health: `GET /sandbox/v1/health`

```bash
pnpm types:ccv2
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm --filter @commercekit/sandbox-ccv2 openapi:check
pnpm build:check
pnpm run ci
```

The production-safe smoke runner defaults to the local Worker:

```bash
pnpm smoke:ccv2
CCV2_CONFIRM_PRODUCTION=1 pnpm smoke:production
```

The production command is opt-in, bounded, uses synthetic credentials only, and
attempts to delete every disposable run even after a failed assertion. It never
prints client secrets, control tokens, or access tokens.

Tests run in Cloudflare's Workers runtime with SQLite Durable Objects and
ephemeral test signing material. `pnpm build:check` is a Wrangler dry run and
does not deploy. GitHub Actions validates only; Cloudflare Workers Builds deploys
commits merged to `main`.
