# CommerceKit Sandbox

CommerceKit Sandbox is an open-source API simulation platform for testing GitHub Actions,
command-line tools, integrations, and developer applications without depending on live vendor
systems.

The repository is part of the [CommerceKit](https://commercekit.tools) developer-tooling
ecosystem. Each simulated service is an independently deployable Cloudflare Worker in a pnpm
workspace. SAP Commerce Cloud CCv2 is the first service.

## Architecture

```text
apps/
└── ccv2/   # commercekit-sandbox-ccv2 Worker
```

New services can be added under `apps/<service-name>` with their own Wrangler configuration,
bindings, tests, and deployment. Shared packages will be introduced only after reusable code
exists.

The CCv2 Worker uses:

- TypeScript and Hono for the HTTP API
- Cloudflare Workers for execution
- SQLite-backed Durable Objects for isolated run state
- Vitest with Cloudflare's Workers runtime integration
- ESLint and Prettier for code quality

API documentation, the service catalog, and the interactive playground will live on
`commercekit.tools`. This repository does not contain a frontend. The planned production API
hostname is `ccv2.sandbox.commercekit.tools`.

## Requirements

- Node.js 24 LTS
- pnpm 12.11.2 through Corepack

```bash
corepack enable
pnpm install
```

## Development

Start the CCv2 Worker on `http://localhost:8787`:

```bash
pnpm dev:ccv2
```

Smoke-test the implemented routes:

```bash
curl http://localhost:8787/
curl http://localhost:8787/__mock/health
```

The health route performs a real SQLite query through the Durable Object binding.

## Validation

```bash
pnpm types:ccv2
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build:check
pnpm run ci
```

`pnpm build:check` builds the Worker through a Wrangler deployment dry-run. It does not deploy or
require Cloudflare credentials.

GitHub Actions runs validation only. Production deployment will be configured separately through
Cloudflare Workers Builds, with `apps/ccv2` as the root directory. Cloudflare will own runtime
configuration, future secrets, and the custom domain.

## Current status

The repository currently provides the project foundation, health and service-identification
routes, strict CORS handling, SQLite-backed Durable Object persistence, local development, runtime
tests, CI, and dependency maintenance.

SAP authentication, CCv2 API contracts, build and deployment simulation, environment APIs, SCIM,
and scenario management are planned for later phases and are not currently implemented.

## License

[MIT](LICENSE)
