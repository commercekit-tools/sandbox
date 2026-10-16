# SCIM architectural decision

## Decision

Defer SCIM until a CommerceKit workflow needs it, then implement it as a
separately versioned service surface rather than adding unverified routes to the
current Management API inventory. A separate Worker is preferred if the future
sandbox needs a Commerce-environment hostname and lifecycle distinct from a
Cloud Portal run; a well-isolated module in this Worker is acceptable only if
operations must share the existing run and scenario state.

SAP documents SCIM through the `cloudscimwebservices` extension at paths under
`/scim/v3`. It is enabled in a Commerce application manifest and served by the
Commerce environment, whereas this sandbox models the Cloud Portal Management
API at `/v2/subscriptions/...`. See SAP's [SCIM API documentation](https://help.sap.com/docs/SAP_COMMERCE_CLOUD_PUBLIC_CLOUD/452dcbb0e00f47e88a69cdaeb87a925d/baaa605b6a6f4907a2fc1cc917d8c6c7.html?locale=en-US).

## Differences from the current Worker surface

| Concern        | Management sandbox                                                                  | Future SCIM surface                                                                           |
| -------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Base URL       | Cloud Portal-compatible host and `/v2`                                              | Commerce environment host and `/scim/v3`                                                      |
| Authentication | Synthetic technical client, resource-bound RS256 JWT in `x-approuter-authorization` | Commerce authorization server/client with the SCIM client role                                |
| Media types    | JSON and SAP problem JSON                                                           | SCIM JSON media types, including `application/scim+json`                                      |
| Resources      | Builds, deployments, environments, and Cloud Portal resources                       | Users, groups, membership, SCIM list responses, filters, and patch operations                 |
| Contract       | Independently authored Management API 2.0.12 OpenAPI                                | Separate SCIM contract and compatibility audit required                                       |
| State          | One SQLite Durable Object per sandbox run                                           | Separate identity directory state, uniqueness rules, pagination, filters, and patch semantics |

No workflow or GitHub Actions integration in this repository calls `/scim/v3`.
The website integration planned after this PR needs run control, OAuth, and the
Management API only. SCIM therefore does not fix an existing compatibility gap.

## Effort and priority

A useful implementation would need an independently maintained SCIM contract,
synthetic authorization, user and group CRUD, membership consistency, SCIM
filters and pagination, PATCH operations, errors, isolation, quotas, and a new
test suite. This is approximately **2–4 engineer weeks** after selecting the
exact SAP Commerce version and required client workflows. Priority is low until
a CommerceKit action or website tool has a concrete SCIM dependency.
