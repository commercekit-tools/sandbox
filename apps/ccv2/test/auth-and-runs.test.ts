import { env, exports as worker } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIO } from "../src/domain/scenario";
import { controlHeaders, createRun, issueToken } from "./helpers";

describe("run control and synthetic OAuth", () => {
  it("creates isolated runs and returns credentials only once", async () => {
    const first = await createRun();
    const second = await createRun();
    expect(first.runId).not.toBe(second.runId);
    expect(first.controlToken).not.toBe(second.controlToken);
    expect(first.credentials.clientSecret).not.toBe(second.credentials.clientSecret);
    expect(first.credentials.tokenUrl).toBe("https://ccv2.sandbox.commercekit.tools/oauth2/token");

    const unauthorized = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${first.runId}`,
    );
    expect(unauthorized.status).toBe(401);

    const crossRun = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${first.runId}`,
      {
        headers: controlHeaders(second),
      },
    );
    expect(crossRun.status).toBe(403);

    const response = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${first.runId}`,
      {
        headers: controlHeaders(first),
      },
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(first.controlToken);
    expect(text).not.toContain(first.credentials.clientSecret);
    expect(JSON.parse(text)).toMatchObject({
      runId: first.runId,
      scenario: DEFAULT_SCENARIO,
      schemaVersion: 3,
    });
  });

  it("validates and persists scenarios, then resets without rotating credentials", async () => {
    const run = await createRun();
    const scenario = {
      build: { outcome: "FAIL", pollsBeforeTerminal: 1, logsAvailable: false },
      deployment: {
        outcome: "NEVER",
        pollsBeforeTerminal: 4,
        cancellationAllowed: false,
        requireGreenDecision: true,
      },
      faults: [{ operationId: "getBuildProgress", status: 429, onCalls: [2] }],
    };
    const update = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/scenario`,
      {
        method: "PUT",
        headers: { ...controlHeaders(run), "Content-Type": "application/json" },
        body: JSON.stringify(scenario),
      },
    );
    expect(update.status).toBe(200);

    const read = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/scenario`,
      { headers: controlHeaders(run) },
    );
    await expect(read.json()).resolves.toEqual(scenario);

    const invalid = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/scenario`,
      {
        method: "PUT",
        headers: { ...controlHeaders(run), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...scenario,
          faults: [{ operationId: "madeUp", status: 500, onCalls: [1] }],
        }),
      },
    );
    expect(invalid.status).toBe(400);

    const reset = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/reset`,
      {
        method: "POST",
        headers: controlHeaders(run),
      },
    );
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({ scenario: DEFAULT_SCENARIO });
    await expect(issueToken(run)).resolves.toEqual(expect.any(String));
  });

  it("issues RS256 tokens and publishes the verification key", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "RS256", kid: "ccv2-test-key" });

    const jwksResponse = await worker.default.fetch("https://example.com/.well-known/jwks.json");
    expect(jwksResponse.status).toBe(200);
    const jwks = await jwksResponse.json<{ keys: JsonWebKey[] }>();
    expect(jwks.keys).toHaveLength(1);
    const publicJwk = jwks.keys[0];
    if (!publicJwk) throw new Error("JWKS did not contain a public key");
    const key = await importJWK(publicJwk, "RS256");
    const verified = await jwtVerify(token, key, {
      issuer: "https://ccv2.sandbox.commercekit.tools",
      audience: run.credentials.resource,
    });
    expect(verified.payload).toMatchObject({ run_id: run.runId, sub: run.runId });
  });

  it("rejects invalid OAuth requests and deleted runs", async () => {
    const run = await createRun();
    const tokenUrl = "https://example.com/oauth2/token";
    const post = (values: Record<string, string>) =>
      worker.default.fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(values),
      });
    const base = {
      client_id: run.credentials.clientId,
      client_secret: run.credentials.clientSecret,
      grant_type: "client_credentials",
      resource: run.credentials.resource,
    };
    expect((await post({ ...base, grant_type: "password" })).status).toBe(400);
    expect((await post({ ...base, client_secret: "incorrect" })).status).toBe(401);
    expect((await post({ ...base, resource: "wrong-audience" })).status).toBe(401);
    expect((await post({ client_id: base.client_id })).status).toBe(400);

    const deletion = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}`,
      {
        method: "DELETE",
        headers: controlHeaders(run),
      },
    );
    expect(deletion.status).toBe(204);
    expect((await post(base)).status).toBe(401);
    const inspection = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}`,
      {
        headers: controlHeaders(run),
      },
    );
    expect(inspection.status).toBe(404);
  });

  it("removes storage when the run alarm fires", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const stub = env.CCV2_RUN.getByName(run.runId);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const response = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}`,
      {
        headers: controlHeaders(run),
      },
    );
    expect(response.status).toBe(404);
    const vendorResponse = await worker.default.fetch(
      "https://example.com/v2/subscriptions/SUBSCRIPTION_001/builds",
      { headers: { "x-approuter-authorization": `Bearer ${token}` } },
    );
    expect(vendorResponse.status).toBe(401);
  });

  it("enforces the scenario request size limit", async () => {
    const run = await createRun();
    const response = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/scenario`,
      {
        method: "PUT",
        headers: { ...controlHeaders(run), "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(70_000) }),
      },
    );
    expect(response.status).toBe(413);
  });
});
