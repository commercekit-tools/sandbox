# CommerceKit CCv2 Sandbox Worker

This package contains the Cloudflare Worker foundation for the SAP Commerce Cloud CCv2 sandbox.
It currently exposes service-identification and health endpoints and persists minimal run metadata
in SQLite-backed Durable Objects. SAP API simulation will be added in later phases.

## Setup

```bash
cd /Users/anil/projects/sandbox
corepack enable
pnpm install
pnpm dev:ccv2
```

The Worker listens on `http://localhost:8787`.

```bash
curl http://localhost:8787/
curl http://localhost:8787/__mock/health
```

The health request invokes a fixed internal `Ccv2Run` instance and executes a real SQLite query.
There is no public endpoint for arbitrary Durable Object state.

To add local browser origins, copy `.dev.vars.example` to `.dev.vars` and update the comma-separated
`ALLOWED_ORIGINS` value. Origin matching is exact.

## Commands

Run repository checks from `/Users/anil/projects/sandbox`:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build:check
pnpm run ci
```

Application-local commands are also available:

```bash
cd /Users/anil/projects/sandbox/apps/ccv2
pnpm dev
pnpm typecheck
pnpm test
pnpm build:check
pnpm exec wrangler deploy --dry-run
```

Regenerate committed Worker runtime and binding types after changing `wrangler.jsonc`:

```bash
pnpm types:ccv2
```

## Deployment model

GitHub Actions validates pull requests and `main`; it does not deploy. Production deployment and
the `ccv2.sandbox.commercekit.tools` Custom Domain will be configured through Cloudflare Workers
Builds after this foundation is accepted.

Planned Workers Builds settings:

```text
Root directory: apps/ccv2
Build command: pnpm run build:check
Deploy command: pnpm exec wrangler deploy
```

No Cloudflare credentials or runtime secrets are required for local validation.
