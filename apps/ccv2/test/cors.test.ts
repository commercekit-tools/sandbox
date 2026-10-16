import { exports as worker } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const PRODUCTION_ORIGIN = "https://commercekit.tools";
const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:5173";
const ALLOWED_ORIGINS = [
  ["production website", PRODUCTION_ORIGIN],
  ["local Vite development server", LOCAL_DEVELOPMENT_ORIGIN],
] as const;

describe("CORS", () => {
  it.each(ALLOWED_ORIGINS)("grants access to the %s origin", async (_label, origin) => {
    const response = await worker.default.fetch("https://example.com/", {
      headers: { Origin: origin },
    });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Vary")).toContain("Origin");
    expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
  });

  it("does not grant access to an unconfigured origin", async () => {
    const response = await worker.default.fetch("https://example.com/", {
      headers: { Origin: "https://untrusted.example" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it.each(ALLOWED_ORIGINS)(
    "answers %s preflight requests with the required methods and headers",
    async (_label, origin) => {
      const response = await worker.default.fetch("https://example.com/sandbox/v1/health", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "authorization,content-type,x-sandbox-run-id,x-approuter-authorization",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
        "Authorization, Content-Type, x-sandbox-run-id, x-approuter-authorization, x-request-id",
      );
      expect(response.headers.get("Vary")).toContain("Origin");
    },
  );

  it("does not grant CORS headers to a rejected preflight origin", async () => {
    const response = await worker.default.fetch("https://example.com/sandbox/v1/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example",
        "Access-Control-Request-Method": "GET",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(response.headers.has("Access-Control-Allow-Methods")).toBe(false);
  });
});
