import { exports as worker } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIO } from "../src/domain/scenario";
import { controlHeaders, createRun, issueToken, sapHeaders } from "./helpers";

const subscription = "https://example.com/v2/subscriptions/131762872233634f29fdeb7d50983aa4";

describe("public input validation", () => {
  it("rejects malformed bodies, media types, paging, enums, duplicates, and invalid scopes", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const builds = `${subscription}/builds`;
    const post = (body: string, contentType = "application/json") =>
      worker.default.fetch(builds, {
        method: "POST",
        headers: { ...sapHeaders(token), "Content-Type": contentType },
        body,
      });
    for (const response of [
      await post("{"),
      await post(""),
      await post('{"branch":"main","name":"build"}', "text/plain"),
      await post(JSON.stringify({ branch: "x".repeat(70_000), name: "build" })),
    ]) {
      expect([400, 413, 415]).toContain(response.status);
      expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    }

    for (const query of ["$skip=-1", "$top=0", "$top=101", "$count=yes", "$orderby=code asc"]) {
      const response = await worker.default.fetch(`${builds}?${query}`, {
        headers: sapHeaders(token),
      });
      expect(response.status, query).toBe(400);
    }

    const endpoints = `${subscription}/environments/d1/endpoints`;
    const endpoint = {
      code: "duplicate",
      name: "Endpoint",
      domainName: "endpoint.sandbox.invalid",
      protocol: "HTTPS",
      k8sService: "commerce",
      k8sServiceVersion: "BLUE",
      access: "ALLOW_ALL",
    };
    const endpointInit = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(
      (await worker.default.fetch(endpoints, endpointInit({ ...endpoint, protocol: "FTP" })))
        .status,
    ).toBe(400);
    expect((await worker.default.fetch(endpoints, endpointInit(endpoint))).status).toBe(201);
    expect((await worker.default.fetch(endpoints, endpointInit(endpoint))).status).toBe(409);
    expect(
      (
        await worker.default.fetch(
          `${subscription}/environments/unknown/endpoints`,
          endpointInit(endpoint),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await worker.default.fetch("https://example.com/v2/subscriptions/UNKNOWN/environments", {
          headers: sapHeaders(token),
        })
      ).status,
    ).toBe(404);

    const excessivePolls = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/scenario`,
      {
        method: "PUT",
        headers: { ...controlHeaders(run), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...DEFAULT_SCENARIO,
          build: { ...DEFAULT_SCENARIO.build, pollsBeforeTerminal: 101 },
        }),
      },
    );
    expect(excessivePolls.status).toBe(400);
    const excessiveFaults = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/scenario`,
      {
        method: "PUT",
        headers: { ...controlHeaders(run), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...DEFAULT_SCENARIO,
          faults: Array.from({ length: 26 }, () => ({
            operationId: "getBuilds",
            status: 500,
            onCalls: [1],
          })),
        }),
      },
    );
    expect(excessiveFaults.status).toBe(400);
    expect(
      (
        await worker.default.fetch("https://example.com/sandbox/v1/runs/not-a-run", {
          headers: controlHeaders(run),
        })
      ).status,
    ).toBe(400);

    const unknownVendor = await worker.default.fetch(`${subscription}/unknown`, {
      headers: sapHeaders(token),
    });
    expect(unknownVendor.status).toBe(404);
    expect(unknownVendor.headers.get("Content-Type")).toContain("application/problem+json");
  });
});
