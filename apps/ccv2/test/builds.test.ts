import { exports as worker } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIO } from "../src/domain/scenario";
import { configureScenario, controlHeaders, createRun, issueToken, sapHeaders } from "./helpers";

const base = "https://example.com/v2/subscriptions/SUBSCRIPTION_001/builds";

async function createBuild(token: string, body: unknown = { branch: "main", name: "release" }) {
  return worker.default.fetch(base, {
    method: "POST",
    headers: { ...sapHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("SAP-compatible build API", () => {
  it("creates, lists, retrieves, progresses, logs, and deletes a build", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const creation = await createBuild(token, {
      branch: "feature/checkout",
      name: "checkout-release",
      applicationCode: "commerce",
    });
    expect(creation.status).toBe(201);
    const created = await creation.json<{ code: string; subscriptionCode: string }>();
    expect(created).toEqual({ code: "build_000001", subscriptionCode: "SUBSCRIPTION_001" });

    const detailBeforePoll = await worker.default.fetch(`${base}/${created.code}`, {
      headers: sapHeaders(token),
    });
    await expect(detailBeforePoll.json()).resolves.toMatchObject({
      code: created.code,
      branch: "feature/checkout",
      applicationCode: "commerce",
      status: "SCHEDULED",
    });

    const statuses: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const progress = await worker.default.fetch(`${base}/${created.code}/progress`, {
        headers: sapHeaders(token),
      });
      expect(progress.status).toBe(200);
      const body = await progress.json<{ buildStatus: string; percentage: number }>();
      statuses.push(body.buildStatus);
      expect(body.percentage).toBeGreaterThan(0);
    }
    expect(statuses).toEqual(["BUILDING", "BUILDING", "SUCCESS"]);
    const stable = await worker.default.fetch(`${base}/${created.code}/progress`, {
      headers: sapHeaders(token),
    });
    await expect(stable.json()).resolves.toMatchObject({ buildStatus: "SUCCESS", percentage: 100 });

    const logs = await worker.default.fetch(`${base}/${created.code}/logs`, {
      headers: sapHeaders(token),
    });
    expect(logs.status).toBe(200);
    expect(logs.headers.get("Content-Type")).toBe("application/zip");
    expect(logs.headers.get("Content-Disposition")).toContain(`${created.code}-logs.zip`);
    const bytes = new Uint8Array(await logs.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(bytes.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);

    const listing = await worker.default.fetch(`${base}?$top=1&$skip=0&$orderby=name%20asc`, {
      headers: sapHeaders(token),
    });
    await expect(listing.json()).resolves.toMatchObject({
      count: 1,
      value: [{ code: created.code }],
    });

    const deletion = await worker.default.fetch(`${base}/${created.code}`, {
      method: "DELETE",
      headers: sapHeaders(token),
    });
    expect(deletion.status).toBe(204);
    const deleted = await worker.default.fetch(`${base}/${created.code}`, {
      headers: sapHeaders(token),
    });
    await expect(deleted.json()).resolves.toMatchObject({ status: "DELETED" });
  });

  it("supports failed and nonterminating scenario snapshots", async () => {
    const run = await createRun();
    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      build: {
        outcome: "FAIL",
        pollsBeforeTerminal: 0,
        logsAvailable: false,
        failureMessage: "Compilation failed",
      },
    });
    const token = await issueToken(run);
    const failedCreate = await createBuild(token, { branch: "broken", name: "broken" });
    const failed = await failedCreate.json<{ code: string }>();

    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      build: { outcome: "NEVER", pollsBeforeTerminal: 0, logsAvailable: true },
    });
    const neverCreate = await createBuild(token, { branch: "slow", name: "slow" });
    const never = await neverCreate.json<{ code: string }>();

    const failedProgress = await worker.default.fetch(`${base}/${failed.code}/progress`, {
      headers: sapHeaders(token),
    });
    await expect(failedProgress.json()).resolves.toMatchObject({
      buildStatus: "FAIL",
      errorMessage: "Compilation failed",
    });
    const noLogs = await worker.default.fetch(`${base}/${failed.code}/logs`, {
      headers: sapHeaders(token),
    });
    expect(noLogs.status).toBe(404);

    for (let index = 0; index < 5; index += 1) {
      const progress = await worker.default.fetch(`${base}/${never.code}/progress`, {
        headers: sapHeaders(token),
      });
      await expect(progress.json()).resolves.toMatchObject({ buildStatus: "BUILDING" });
    }
  });

  it("validates requests, authentication, subscriptions, pagination, and active deletion", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    expect((await createBuild(token, { name: "missing branch" })).status).toBe(400);
    expect((await createBuild(token, { branch: "main", name: "ok", extra: true })).status).toBe(
      400,
    );
    expect((await worker.default.fetch(base)).status).toBe(401);
    expect(
      (
        await worker.default.fetch("https://example.com/v2/subscriptions/OTHER/builds", {
          headers: sapHeaders(token),
        })
      ).status,
    ).toBe(404);
    expect(
      (await worker.default.fetch(`${base}?$top=101`, { headers: sapHeaders(token) })).status,
    ).toBe(400);

    const creation = await createBuild(token);
    const build = await creation.json<{ code: string }>();
    const deletion = await worker.default.fetch(`${base}/${build.code}`, {
      method: "DELETE",
      headers: sapHeaders(token),
    });
    expect(deletion.status).toBe(409);
  });

  it("applies faults before lifecycle advancement and isolates fault counters", async () => {
    const first = await createRun();
    const second = await createRun();
    await configureScenario(first, {
      ...DEFAULT_SCENARIO,
      build: { ...DEFAULT_SCENARIO.build, pollsBeforeTerminal: 0 },
      faults: [
        {
          operationId: "getBuildProgress",
          status: 429,
          onCalls: [1],
          retryAfterSeconds: 2,
        },
      ],
    });
    const firstToken = await issueToken(first);
    const secondToken = await issueToken(second);
    const firstBuild = await (await createBuild(firstToken)).json<{ code: string }>();
    const secondBuild = await (await createBuild(secondToken)).json<{ code: string }>();

    const fault = await worker.default.fetch(`${base}/${firstBuild.code}/progress`, {
      headers: sapHeaders(firstToken),
    });
    expect(fault.status).toBe(429);
    expect(fault.headers.get("Retry-After")).toBe("2");
    const firstSuccess = await worker.default.fetch(`${base}/${firstBuild.code}/progress`, {
      headers: sapHeaders(firstToken),
    });
    await expect(firstSuccess.json()).resolves.toMatchObject({ buildStatus: "SUCCESS" });

    const secondProgress = await worker.default.fetch(`${base}/${secondBuild.code}/progress`, {
      headers: sapHeaders(secondToken),
    });
    await expect(secondProgress.json()).resolves.toMatchObject({ buildStatus: "BUILDING" });

    const state = await worker.default.fetch(
      `https://example.com/__mock/runs/${first.runId}/state`,
      {
        headers: controlHeaders(first),
      },
    );
    await expect(state.json()).resolves.toMatchObject({
      pollCounters: { [`getBuildProgress:${firstBuild.code}`]: 1 },
      faultCounters: { [`getBuildProgress:${firstBuild.code}`]: 2 },
    });
  });
});
