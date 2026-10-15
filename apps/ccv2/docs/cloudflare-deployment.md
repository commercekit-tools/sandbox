# Cloudflare deployment readiness

## Already configured

- Worker name: `commercekit-sandbox-ccv2`
- SQLite-backed Durable Object class and binding: `Ccv2Run` / `CCV2_RUN`
- Cloudflare Workers Builds from the Git-connected repository
- Custom domain: `ccv2.sandbox.commercekit.tools`
- Preview URLs disabled
- Observability and sampled traces enabled

## Introduced by this change

- `workers_dev = false` and a declarative custom-domain route
- `RUN_CREATION_RATE_LIMIT`, namespace `1001`, at 30 requests per 60 seconds
- Required-secret declarations, so a deployment fails when signing material is absent
- Text-module rules for the checked-in OpenAPI documents

The rate-limit namespace ID must remain unique within the Cloudflare account. If
`1001` is already assigned to an unrelated rule, choose an unused positive
integer in `wrangler.jsonc` before merge. For stronger perimeter control, add a
Cloudflare WAF rate-limit rule for `POST /__mock/runs` using the same 30/minute
policy. The binding remains the application-level enforcement point.

## Secrets required before merge

| Secret                  | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `MOCK_JWT_PRIVATE_KEY`  | PKCS#8 RSA private key used for RS256 access tokens         |
| `MOCK_JWT_PUBLIC_JWK`   | JSON RSA public JWK exposed through JWKS                    |
| `MOCK_JWT_KID`          | Stable key identifier shared by JWT headers and JWKS        |
| `RUN_TOKEN_SIGNING_KEY` | Random HMAC key for run-control and client-secret verifiers |

Generate files in a secure temporary directory without printing their contents:

```bash
set -euo pipefail
umask 077

# Run these checks from the repository root. Stop if the deployment listing says
# that commercekit-sandbox-ccv2 does not exist: Wrangler is using the wrong
# Cloudflare account or profile, and `secret put` would create a new Worker.
pnpm --dir apps/ccv2 exec wrangler whoami
pnpm --dir apps/ccv2 exec wrangler deployments list >/dev/null

KEY_DIR="$(mktemp -d)"
pnpm --filter @commercekit-tools/sandbox-ccv2 secrets:generate-production -- "$KEY_DIR"
pnpm --dir apps/ccv2 exec wrangler secret put MOCK_JWT_PRIVATE_KEY < "$KEY_DIR/mock-jwt-private.pem"
pnpm --dir apps/ccv2 exec wrangler secret put MOCK_JWT_PUBLIC_JWK < "$KEY_DIR/mock-jwt-public.jwk"
pnpm --dir apps/ccv2 exec wrangler secret put MOCK_JWT_KID < "$KEY_DIR/mock-jwt-kid.txt"
pnpm --dir apps/ccv2 exec wrangler secret put RUN_TOKEN_SIGNING_KEY < "$KEY_DIR/run-token-signing-key.txt"
rm -rf "$KEY_DIR"
```

Provision all four secrets before merging. A partial rotation breaks token
issuance or verification. Rotate the private key, public JWK, and `kid` together;
existing one-hour access tokens signed by the old key stop working unless a
multi-key rotation strategy is added later.

## Pre-merge checks

1. Confirm the existing Durable Object namespace is still bound to `Ccv2Run`.
2. Confirm Custom Domain ownership for `ccv2.sandbox.commercekit.tools`.
3. Provision the four required secrets.
4. Confirm rate-limit namespace `1001` is available.
5. Run `pnpm run ci` from the repository root.
6. Merge only after the PR and Cloudflare Workers Build configuration are ready.

## Post-deployment checks

1. Request `/__mock/health`, `/openapi.json`, and `/.well-known/jwks.json`.
2. Create a disposable run and obtain a token.
3. Execute one successful build and deployment flow.
4. Delete the run and confirm its token is rejected.
5. Check structured Worker logs for errors without credential values.

No manual feature-branch deployment or GitHub deployment workflow is required.
