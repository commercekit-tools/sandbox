import { env, exports as worker } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIO } from "../src/domain/scenario";
import { configureScenario, controlHeaders, createRun, issueToken, sapHeaders } from "./helpers";

const subscription = "https://example.com/v2/subscriptions/SUBSCRIPTION_001";

function createBuild(token: string, index: number): Promise<Response> {
  return worker.default.fetch(`${subscription}/builds`, {
    method: "POST",
    headers: { ...sapHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ branch: `branch-${String(index)}`, name: `build-${String(index)}` }),
  });
}

describe("Durable Object concurrency and persistence", () => {
  it("serializes concurrent creation and polling without regressing state", async () => {
    const run = await createRun();
    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      build: { ...DEFAULT_SCENARIO.build, pollsBeforeTerminal: 5 },
    });
    const token = await issueToken(run);
    const creations = await Promise.all([createBuild(token, 1), createBuild(token, 2)]);
    expect(creations.map(({ status }) => status)).toEqual([201, 201]);
    const builds = await Promise.all(
      creations.map((response) => response.json<{ code: string }>()),
    );
    expect(new Set(builds.map(({ code }) => code)).size).toBe(2);

    const target = builds[0];
    if (!target) throw new Error("Concurrent build creation returned no build");
    const reads = await Promise.all(
      Array.from({ length: 5 }, () =>
        worker.default.fetch(`${subscription}/builds/${target.code}`, {
          headers: sapHeaders(token),
        }),
      ),
    );
    expect(reads.every(({ status }) => status === 200)).toBe(true);

    const polls = await Promise.all(
      Array.from({ length: 6 }, () =>
        worker.default
          .fetch(`${subscription}/builds/${target.code}/progress`, {
            headers: sapHeaders(token),
          })
          .then((response) => response.json<{ buildStatus: string; percentage: number }>()),
      ),
    );
    expect(polls.map(({ percentage }) => percentage).toSorted((a, b) => a - b)).toEqual([
      16, 33, 50, 66, 83, 100,
    ]);
    expect(polls.some(({ buildStatus }) => buildStatus === "SUCCESS")).toBe(true);
    const stable = await worker.default.fetch(`${subscription}/builds/${target.code}/progress`, {
      headers: sapHeaders(token),
    });
    await expect(stable.json()).resolves.toMatchObject({ buildStatus: "SUCCESS", percentage: 100 });

    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      deployment: { ...DEFAULT_SCENARIO.deployment, pollsBeforeTerminal: 3 },
    });
    const deploymentResponse = await worker.default.fetch(`${subscription}/deployments`, {
      method: "POST",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        buildCode: target.code,
        environmentCode: "d1",
        databaseUpdateMode: "NONE",
        strategy: "ROLLING_UPDATE",
      }),
    });
    const deployment = await deploymentResponse.json<{ code: string }>();
    const deploymentPolls = await Promise.all(
      Array.from({ length: 4 }, () =>
        worker.default
          .fetch(`${subscription}/deployments/${deployment.code}/progress`, {
            headers: sapHeaders(token),
          })
          .then((response) => response.json<{ deploymentStatus: string; percentage: number }>()),
      ),
    );
    expect(deploymentPolls.map(({ percentage }) => percentage).toSorted((a, b) => a - b)).toEqual([
      25, 50, 75, 100,
    ]);
    expect(deploymentPolls.some(({ deploymentStatus }) => deploymentStatus === "DEPLOYED")).toBe(
      true,
    );
  });

  it("keeps operation snapshots stable across scenario edits and reset", async () => {
    const run = await createRun();
    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      build: { ...DEFAULT_SCENARIO.build, pollsBeforeTerminal: 0 },
    });
    const token = await issueToken(run);
    const response = await createBuild(token, 1);
    const build = await response.json<{ code: string }>();
    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      build: {
        outcome: "FAIL",
        pollsBeforeTerminal: 0,
        logsAvailable: false,
        failureMessage: "New operations fail",
      },
    });
    const original = await worker.default.fetch(`${subscription}/builds/${build.code}/progress`, {
      headers: sapHeaders(token),
    });
    await expect(original.json()).resolves.toMatchObject({ buildStatus: "SUCCESS" });

    const reset = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/reset`,
      { method: "POST", headers: controlHeaders(run) },
    );
    expect(reset.status).toBe(200);
    const state = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/state`,
      { headers: controlHeaders(run) },
    );
    await expect(state.json()).resolves.toMatchObject({
      counts: { builds: 0, deployments: 0, resources: 0 },
      scenario: DEFAULT_SCENARIO,
    });
    expect(
      (
        await worker.default.fetch(`${subscription}/builds/${build.code}`, {
          headers: sapHeaders(token),
        })
      ).status,
    ).toBe(404);
  });

  it("does not reuse generated resource identifiers and recovers resources after eviction", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const root = `${subscription}/environments/d1/endpoints`;
    const create = (name: string) =>
      worker.default.fetch(root, {
        method: "POST",
        headers: { ...sapHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          domainName: `${name}.sandbox.invalid`,
          protocol: "HTTPS",
          k8sService: "commerce",
          k8sServiceVersion: "BLUE",
          access: "ALLOW_ALL",
        }),
      });
    const first = await (await create("first")).json<{ code: string }>();
    expect(
      (
        await worker.default.fetch(`${root}/${first.code}`, {
          method: "DELETE",
          headers: sapHeaders(token),
        })
      ).status,
    ).toBe(204);
    const second = await (await create("second")).json<{ code: string }>();
    expect(second.code).not.toBe(first.code);

    await evictDurableObject(env.CCV2_RUN.getByName(run.runId));
    const recovered = await worker.default.fetch(`${root}/${second.code}`, {
      headers: sapHeaders(token),
    });
    await expect(recovered.json()).resolves.toMatchObject({ code: second.code, name: "second" });
  });

  it("keeps reset and deletion final when requests are already queued", async () => {
    const resetRun = await createRun();
    const resetToken = await issueToken(resetRun);
    const buildRequest = createBuild(resetToken, 1);
    const resetRequest = worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${resetRun.runId}/reset`,
      { method: "POST", headers: controlHeaders(resetRun) },
    );
    const [buildResponse, resetResponse] = await Promise.all([buildRequest, resetRequest]);
    expect([201, 404]).toContain(buildResponse.status);
    expect(resetResponse.status).toBe(200);
    const state = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${resetRun.runId}/state`,
      { headers: controlHeaders(resetRun) },
    );
    const resetState = await state.json<{ counts: { builds: number }; scenario: unknown }>();
    expect([0, 1]).toContain(resetState.counts.builds);
    expect(resetState.scenario).toEqual(DEFAULT_SCENARIO);

    const deleteRun = await createRun();
    const deleteToken = await issueToken(deleteRun);
    const queuedBuild = createBuild(deleteToken, 2);
    const queuedDeletion = worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${deleteRun.runId}`,
      { method: "DELETE", headers: controlHeaders(deleteRun) },
    );
    const [queuedBuildResponse, deletionResponse] = await Promise.all([
      queuedBuild,
      queuedDeletion,
    ]);
    expect([201, 404]).toContain(queuedBuildResponse.status);
    expect(deletionResponse.status).toBe(204);
    expect(
      (
        await worker.default.fetch(`${subscription}/builds`, {
          headers: sapHeaders(deleteToken),
        })
      ).status,
    ).toBe(401);
  });

  it("enforces the per-kind resource quota under parallel creation", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const root = `${subscription}/environments/d1/endpoints`;
    const responses = await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        worker.default.fetch(root, {
          method: "POST",
          headers: { ...sapHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `endpoint-${String(index)}`,
            domainName: `endpoint-${String(index)}.sandbox.invalid`,
            protocol: "HTTPS",
            k8sService: "commerce",
            k8sServiceVersion: "BLUE",
            access: "ALLOW_ALL",
          }),
        }),
      ),
    );
    expect(responses.filter(({ status }) => status === 201)).toHaveLength(100);
    expect(responses.filter(({ status }) => status === 429)).toHaveLength(1);
    const listing = await worker.default.fetch(`${root}?$top=100`, { headers: sapHeaders(token) });
    await expect(listing.json()).resolves.toMatchObject({ count: 100 });
  });
});
