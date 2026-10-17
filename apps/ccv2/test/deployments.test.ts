import { exports as worker } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIO } from "../src/domain/scenario";
import { configureScenario, createRun, issueToken, sapHeaders, type CreatedRun } from "./helpers";

const subscription = "https://example.com/v2/subscriptions/131762872233634f29fdeb7d50983aa4";

async function successfulBuild(run: CreatedRun, token: string): Promise<string> {
  await configureScenario(run, {
    ...DEFAULT_SCENARIO,
    build: { ...DEFAULT_SCENARIO.build, pollsBeforeTerminal: 0 },
  });
  const response = await worker.default.fetch(`${subscription}/builds`, {
    method: "POST",
    headers: { ...sapHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ branch: "main", name: "deployment-build" }),
  });
  const build = await response.json<{ code: string }>();
  await worker.default.fetch(`${subscription}/builds/${build.code}/progress`, {
    headers: sapHeaders(token),
  });
  return build.code;
}

function createDeployment(
  token: string,
  buildCode: string,
  overrides: Record<string, unknown> = {},
): Promise<Response> {
  return worker.default.fetch(`${subscription}/deployments`, {
    method: "POST",
    headers: { ...sapHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      buildCode,
      environmentCode: "d1",
      databaseUpdateMode: "NONE",
      strategy: "ROLLING_UPDATE",
      ...overrides,
    }),
  });
}

describe("SAP-compatible deployment API", () => {
  it("exposes modes and a deterministic successful deployment lifecycle", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const buildCode = await successfulBuild(run, token);
    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      deployment: { ...DEFAULT_SCENARIO.deployment, pollsBeforeTerminal: 2 },
    });

    const modes = await worker.default.fetch(`${subscription}/deploymentmodes`, {
      headers: sapHeaders(token),
    });
    expect(modes.status).toBe(200);
    await expect(modes.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentCode: "d1",
          deploymentModes: {
            dataMigrationMode: ["NONE", "UPDATE", "INITIALIZE"],
            deploymentMode: ["ROLLING_UPDATE", "RECREATE", "GREEN"],
          },
        }),
      ]),
    );

    const creation = await createDeployment(token, buildCode);
    expect(creation.status).toBe(201);
    const deployment = await creation.json<{ code: string; subscriptionCode: string }>();
    expect(deployment).toEqual({
      code: "700001",
      subscriptionCode: "131762872233634f29fdeb7d50983aa4",
    });
    const observed = await worker.default.fetch(`${subscription}/deployments/${deployment.code}`, {
      headers: sapHeaders(token),
    });
    await expect(observed.json()).resolves.toMatchObject({ status: "SCHEDULED", buildCode });

    const statuses: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const progress = await worker.default.fetch(
        `${subscription}/deployments/${deployment.code}/progress`,
        { headers: sapHeaders(token) },
      );
      const body = await progress.json<{ deploymentStatus: string; stages: unknown[] }>();
      statuses.push(body.deploymentStatus);
      expect(body.stages).toHaveLength(1);
    }
    expect(statuses).toEqual(["DEPLOYING", "DEPLOYING", "DEPLOYED"]);

    const list = await worker.default.fetch(
      `${subscription}/deployments?environmentCode=d1&status=DEPLOYED&buildCode=${buildCode}`,
      { headers: sapHeaders(token) },
    );
    await expect(list.json()).resolves.toMatchObject({
      count: 1,
      value: [{ code: deployment.code }],
    });
  });

  it("validates referential integrity and prevents conflicting active deployments", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const buildCode = await successfulBuild(run, token);

    expect((await createDeployment(token, "missing")).status).toBe(404);
    expect((await createDeployment(token, buildCode, { environmentCode: "missing" })).status).toBe(
      404,
    );
    expect((await createDeployment(token, buildCode, { strategy: "BLUE" })).status).toBe(400);
    expect((await createDeployment(token, buildCode)).status).toBe(201);
    expect((await createDeployment(token, buildCode)).status).toBe(409);
  });

  it("supports failed and nonterminating deployments", async () => {
    const failedRun = await createRun();
    const failedToken = await issueToken(failedRun);
    const failedBuild = await successfulBuild(failedRun, failedToken);
    await configureScenario(failedRun, {
      ...DEFAULT_SCENARIO,
      deployment: {
        ...DEFAULT_SCENARIO.deployment,
        outcome: "FAIL",
        pollsBeforeTerminal: 0,
        failureMessage: "Pod rollout failed",
      },
    });
    const failed = await (
      await createDeployment(failedToken, failedBuild)
    ).json<{ code: string }>();
    const failedProgress = await worker.default.fetch(
      `${subscription}/deployments/${failed.code}/progress`,
      { headers: sapHeaders(failedToken) },
    );
    await expect(failedProgress.json()).resolves.toMatchObject({
      deploymentStatus: "FAIL",
      percentage: 100,
      stages: [{ status: "FAIL", steps: [{ message: "Pod rollout failed" }] }],
    });

    const neverRun = await createRun();
    const neverToken = await issueToken(neverRun);
    const neverBuild = await successfulBuild(neverRun, neverToken);
    await configureScenario(neverRun, {
      ...DEFAULT_SCENARIO,
      deployment: { ...DEFAULT_SCENARIO.deployment, outcome: "NEVER", pollsBeforeTerminal: 0 },
    });
    const never = await (await createDeployment(neverToken, neverBuild)).json<{ code: string }>();
    for (let index = 0; index < 5; index += 1) {
      const progress = await worker.default.fetch(
        `${subscription}/deployments/${never.code}/progress`,
        { headers: sapHeaders(neverToken) },
      );
      await expect(progress.json()).resolves.toMatchObject({ deploymentStatus: "DEPLOYING" });
    }
  });

  it("persists green decisions and traffic split history", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const buildCode = await successfulBuild(run, token);
    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      deployment: { ...DEFAULT_SCENARIO.deployment, pollsBeforeTerminal: 0 },
    });
    const creation = await createDeployment(token, buildCode, { strategy: "GREEN" });
    const deployment = await creation.json<{ code: string }>();
    const root = `${subscription}/deployments/${deployment.code}`;
    const progress = await worker.default.fetch(`${root}/progress`, { headers: sapHeaders(token) });
    await expect(progress.json()).resolves.toMatchObject({
      deploymentStatus: "DEPLOYING",
      percentage: 90,
    });

    const prepare = await worker.default.fetch(`${root}/decisions`, {
      method: "POST",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "PREPARE_CANARY", reason: "Canary validation" }),
    });
    expect(prepare.status).toBe(201);
    const updateSplit = await worker.default.fetch(`${root}/trafficsplit`, {
      method: "PUT",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        services: [{ code: "commerce", percentage: 25 }],
        endpoints: [{ code: "storefront", percentage: 25 }],
      }),
    });
    expect(updateSplit.status).toBe(201);
    await expect(updateSplit.json()).resolves.toMatchObject({
      services: [{ code: "commerce", percentage: 25 }],
    });
    const history = await worker.default.fetch(`${root}/trafficsplit/history`, {
      headers: sapHeaders(token),
    });
    await expect(history.json()).resolves.toMatchObject({
      count: 1,
      value: [{ deploymentCode: deployment.code }],
    });

    const accept = await worker.default.fetch(`${root}/decisions`, {
      method: "POST",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "ACCEPT", reason: "Canary healthy" }),
    });
    expect(accept.status).toBe(201);
    const detail = await worker.default.fetch(root, { headers: sapHeaders(token) });
    await expect(detail.json()).resolves.toMatchObject({
      status: "DEPLOYED",
      canaryStatus: "SUCCEEDED",
    });
    const decisions = await worker.default.fetch(`${root}/decisions`, {
      headers: sapHeaders(token),
    });
    await expect(decisions.json()).resolves.toMatchObject({
      deploymentDecisions: [{ type: "PREPARE_CANARY" }, { type: "ACCEPT" }],
    });
  });

  it("supports official cancellation resources and rejects repeated cancellation", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const buildCode = await successfulBuild(run, token);
    const deployment = await (await createDeployment(token, buildCode)).json<{ code: string }>();
    const root = `${subscription}/deployments/${deployment.code}`;
    const options = await worker.default.fetch(`${root}/cancellationoptions`, {
      headers: sapHeaders(token),
    });
    const optionsBody = await options.json<{ databaseRollbackRestoreTimestamp: string }>();
    expect(Number.isNaN(Date.parse(optionsBody.databaseRollbackRestoreTimestamp))).toBe(false);
    const cancellation = await worker.default.fetch(`${root}/cancellation`, {
      method: "POST",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ rollbackDatabase: true, cancelReason: "Release withdrawn" }),
    });
    expect(cancellation.status).toBe(202);
    const detail = await worker.default.fetch(root, { headers: sapHeaders(token) });
    await expect(detail.json()).resolves.toMatchObject({
      status: "UNDEPLOYED",
      cancelation: { rollbackDatabase: true, cancelReason: "Release withdrawn", failed: false },
    });
    expect(
      (
        await worker.default.fetch(`${root}/cancellation`, {
          method: "POST",
          headers: { ...sapHeaders(token), "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(409);
  });
});
