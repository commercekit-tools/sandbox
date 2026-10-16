# Architecture

Each sandbox run maps to one `Ccv2Run` Durable Object through
`CCV2_RUN.getByName(runId)`. The run ID is generated with 128 bits of entropy and
is routing information only. A separate opaque control token protects
CommerceKit operations, while an independently generated client secret protects
the synthetic OAuth client.

```mermaid
flowchart LR
  Client -->|control bearer| Control[/sandbox/v1 routes]
  Client -->|client credentials| OAuth[/oauth2/token]
  OAuth -->|RS256 JWT| Client
  Client -->|x-approuter-authorization| SAP[/v2 routes]
  Control --> DO[(Ccv2Run SQLite)]
  OAuth --> DO
  SAP --> DO
  JWT[Stable RSA secret and public JWK] --> OAuth
  JWT --> SAP
```

The SQLite schema is version 3. The original `run_metadata` table remains in
place, and `schema_migrations` records additive migrations. Security verifiers,
scenario configuration, operation counters, builds, deployments, general API
resources, monotonic resource sequences, and a capped event stream live in
separate strict tables. Plaintext control tokens and client secrets are never
stored.

All state that affects API behavior is inside the Durable Object. Worker isolate
memory is not authoritative. Mutations execute serially in the object, and SQL
transactions group multi-table reset and initialization work. The alarm is set
to the run's 24-hour expiration time. Alarm execution atomically clears storage;
empty schema tables are then recreated so requests to the same object return 404
rather than implicitly recreating the run.

Build and deployment scenarios are copied into their records at creation time.
Later scenario edits affect newly created operations only. Only
`getBuildProgress` and `getDeploymentProgress` advance their respective state
machines. Detail and list operations are observational. A configured fault is
evaluated before a polling transition, so a transient error does not consume a
lifecycle poll.

Per-run limits are 100 builds, 100 deployments, 100 resources per extended
resource kind, 25 fault rules, 20 call occurrences per rule, and 200 retained
events. Request bodies are limited to 64 KiB. Anonymous run creation uses a
Cloudflare Rate Limiting binding configured for 30 requests per source key per
minute.

The Management API routes preserve `/v2/subscriptions/{subscriptionCode}/...`.
CommerceKit controls stay under `/sandbox/v1/*`. The two surfaces have separate
authorization models and separately served OpenAPI documents.
