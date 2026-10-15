import { exports as worker } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { Ccv2Run } from "../src/durable-objects/ccv2-run";

describe("CCv2 Worker HTTP API", () => {
  it("identifies the service", async () => {
    const response = await worker.default.fetch("https://example.com/");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      service: "CommerceKit CCv2 Sandbox",
      status: "available",
      documentation: "https://commercekit.tools/tools/sandbox/ccv2",
    });
  });

  it("reports Worker and SQLite storage health", async () => {
    const response = await worker.default.fetch("https://example.com/sandbox/v1/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "ccv2",
      components: {
        worker: "ok",
        storage: "ok",
      },
    });
  });

  it("returns a sanitized 503 response when durable storage fails", async () => {
    const storageError = vi.spyOn(Ccv2Run.prototype, "ping").mockImplementation(() => {
      throw new Error("private storage connection detail");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await worker.default.fetch("https://example.com/sandbox/v1/health");
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body).not.toContain("private storage connection detail");
      expect(JSON.parse(body)).toEqual({
        status: "unavailable",
        service: "ccv2",
        components: {
          worker: "ok",
          storage: "unavailable",
        },
        error: {
          code: "storage_unavailable",
          message: "Durable storage is unavailable.",
        },
      });
    } finally {
      storageError.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("returns a consistent JSON response for unknown routes", async () => {
    const response = await worker.default.fetch("https://example.com/not-found");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "The requested resource was not found.",
      },
    });
  });

  it("returns 405 for unsupported methods on known endpoints", async () => {
    const response = await worker.default.fetch("https://example.com/sandbox/v1/health", {
      method: "POST",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "method_not_allowed" },
    });
  });

  it("sanitizes unexpected exceptions", async () => {
    const testApp = createApp();
    testApp.get("/__test/error", () => {
      throw new Error("private infrastructure detail");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await testApp.request("https://example.com/__test/error");
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).not.toContain("private infrastructure detail");
      expect(body).not.toContain("stack");
      expect(JSON.parse(body)).toEqual({
        error: {
          code: "internal_error",
          message: "An unexpected error occurred.",
        },
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
