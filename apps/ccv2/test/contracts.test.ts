import { exports as worker } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { managementOperations } from "../src/domain/contracts";

describe("published API contracts", () => {
  it("registers every inventoried management operation with Hono", () => {
    const routes = new Set(
      createApp().routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    );
    for (const operation of managementOperations) {
      const honoPath = operation.path.replaceAll(/\{([^}]+)\}/g, ":$1");
      expect(routes, operation.operationId).toContain(`${operation.method} ${honoPath}`);
    }
    expect(managementOperations).toHaveLength(52);
  });

  it("serves the independently authored Management API document", async () => {
    const response = await worker.default.fetch("https://example.com/openapi.json");
    expect(response.status).toBe(200);
    const document = await response.json<{
      openapi: string;
      servers: { url: string }[];
      paths: Record<string, Record<string, { operationId?: string }>>;
    }>();
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers[0]?.url).toBe("https://ccv2.sandbox.commercekit.tools");
    const operationIds = Object.values(document.paths).flatMap((path) =>
      Object.values(path).flatMap((operation) => operation.operationId ?? []),
    );
    expect(new Set(operationIds).size).toBe(52);
  });

  it("serves the separate mock-control document", async () => {
    const response = await worker.default.fetch("https://example.com/openapi/mock.json");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/__mock/runs": { post: { operationId: "createRun" } },
        "/oauth2/token": { post: { operationId: "issueToken" } },
      },
    });
  });
});
