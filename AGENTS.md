# Repository guidance

- Use pnpm workspaces. Each sandbox service lives in `apps/<service-name>` and deploys as an
  independent Cloudflare Worker.
- Write strict, Cloudflare-native TypeScript and prefer Web Platform APIs.
- Use Hono for HTTP routing and SQLite-backed Durable Objects for isolated run state.
- Preserve vendor API paths and contracts when SAP endpoints are added.
- Keep tests deterministic and run them in Cloudflare's Workers runtime.
- Do not add a mock frontend; the catalog, documentation, and playground belong on
  `commercekit.tools`.
- Never commit production secrets. Cloudflare manages deployment and runtime secrets.
- Avoid speculative abstractions, shared packages, and dependencies.
- Before finishing a change, run `pnpm run ci` from the repository root. (`pnpm ci` is pnpm's
  frozen-install alias.)
