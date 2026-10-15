# Authentication

Run creation returns an opaque control token plus a synthetic OAuth client ID,
client secret, resource, and token URL. These values are synthetic and must not
be replaced with real SAP production credentials.

The control token is accepted only as `Authorization: Bearer <token>` on the
matching run's `/__mock/runs/{runId}/*` operations. Its HMAC verifier is stored in
SQLite. A run ID alone grants no access, and an OAuth access token does not grant
scenario-control access.

The token endpoint accepts SAP's technical-user form:

```http
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded

client_id=...&client_secret=...&grant_type=client_credentials&resource=...
```

The client ID contains the run routing identifier, but the independently
generated client secret is always verified. The response is an RS256 JWT valid
for 3,600 seconds. It contains `iss`, `aud`, `sub`, `iat`, `exp`, `jti`, and
`run_id`. Protected Management API requests send it as:

```http
x-approuter-authorization: Bearer <access-token>
```

The Worker verifies the signature, `kid`, algorithm, issuer, expiry, audience,
subject/run consistency, and current run existence. `alg=none`, wrong-audience,
expired, deleted-run, and wrongly signed tokens fail closed. The optional
`x-mock-run-id` header is only a consistency check and cannot select a different
run.

The public verification key is available from `/.well-known/jwks.json`. The
private key is a required Cloudflare secret and is never derived or generated at
Worker startup.

For local development, create ignored test values without printing them:

```bash
pnpm --filter @commercekit/sandbox-ccv2 secrets:generate
```

The command creates `apps/ccv2/.dev.vars` with mode `0600` and refuses to
overwrite an existing file. Tests generate a separate ephemeral RSA key pair in
the Vitest configuration and never depend on production secrets.
