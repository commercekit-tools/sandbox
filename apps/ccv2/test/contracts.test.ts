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

  it("serves the separate sandbox-control document and registers every operation", async () => {
    const response = await worker.default.fetch("https://example.com/openapi/sandbox.json");
    expect(response.status).toBe(200);
    const document = await response.json<{
      openapi: string;
      paths: Record<string, Record<string, { operationId?: string }>>;
    }>();
    expect(document).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/sandbox/v1/health": { get: { operationId: "getSandboxHealth" } },
        "/sandbox/v1/runs": { post: { operationId: "createRun" } },
        "/oauth2/token": { post: { operationId: "issueToken" } },
      },
    });
    const routes = new Set(
      createApp().routes.map(({ method, path }) => `${method.toUpperCase()} ${path}`),
    );
    const operations = Object.entries(document.paths).flatMap(([path, pathItem]) =>
      Object.entries(pathItem)
        .filter(
          ([method, operation]) =>
            ["get", "post", "put", "patch", "delete"].includes(method) && operation.operationId,
        )
        .map(([method, operation]) => ({ method, operation, path })),
    );
    expect(operations).toHaveLength(10);
    for (const { method, operation, path } of operations) {
      const honoPath = path.replaceAll(/\{([^}]+)\}/g, ":$1");
      expect(routes, operation.operationId).toContain(`${method.toUpperCase()} ${honoPath}`);
    }
  });

  it("does not expose the retired mock-control paths", async () => {
    const responses = await Promise.all([
      worker.default.fetch("https://example.com/__mock/health"),
      worker.default.fetch("https://example.com/__mock/runs", { method: "POST" }),
      worker.default.fetch("https://example.com/openapi/mock.json"),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([404, 404, 404]);
  });
});
