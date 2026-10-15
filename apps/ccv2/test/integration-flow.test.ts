import { exports as worker } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { DEFAULT_SCENARIO } from "../src/domain/scenario";
import { configureScenario, controlHeaders, createRun, issueToken, sapHeaders } from "./helpers";

const subscription = "https://example.com/v2/subscriptions/SUBSCRIPTION_001";

describe("complete Worker-runtime integration flows", () => {
  it("runs a successful build and deployment from run creation through deletion", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    await configureScenario(run, {
      ...DEFAULT_SCENARIO,
      build: { ...DEFAULT_SCENARIO.build, pollsBeforeTerminal: 1 },
      deployment: {
        ...DEFAULT_SCENARIO.deployment,
        pollsBeforeTerminal: 1,
        requireGreenDecision: false,
      },
    });

    const buildResponse = await worker.default.fetch(`${subscription}/builds`, {
      method: "POST",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", name: "e2e-release", applicationCode: "commerce" }),
    });
    const build = await buildResponse.json<{ code: string }>();
    for (const expected of ["BUILDING", "SUCCESS"]) {
      const progress = await worker.default.fetch(`${subscription}/builds/${build.code}/progress`, {
        headers: sapHeaders(token),
      });
      await expect(progress.json()).resolves.toMatchObject({ buildStatus: expected });
    }
    const logs = await worker.default.fetch(`${subscription}/builds/${build.code}/logs`, {
      headers: sapHeaders(token),
    });
    expect(logs.status).toBe(200);
    expect(new Uint8Array(await logs.arrayBuffer()).slice(0, 2)).toEqual(
      new Uint8Array([0x50, 0x4b]),
    );

    expect(
      (
        await worker.default.fetch(`${subscription}/deploymentmodes`, {
          headers: sapHeaders(token),
        })
      ).status,
    ).toBe(200);
    const deploymentResponse = await worker.default.fetch(`${subscription}/deployments`, {
      method: "POST",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        buildCode: build.code,
        environmentCode: "d1",
        databaseUpdateMode: "UPDATE",
        strategy: "ROLLING_UPDATE",
      }),
    });
    const deployment = await deploymentResponse.json<{ code: string }>();
    for (const expected of ["DEPLOYING", "DEPLOYED"]) {
      const progress = await worker.default.fetch(
        `${subscription}/deployments/${deployment.code}/progress`,
        { headers: sapHeaders(token) },
      );
      await expect(progress.json()).resolves.toMatchObject({ deploymentStatus: expected });
    }
    const environments = await worker.default.fetch(`${subscription}/environments`, {
      headers: sapHeaders(token),
    });
    const environmentBody = await environments.json<{
      value: { code: string; deploymentStatus: string }[];
    }>();
    expect(environmentBody.value.find(({ code }) => code === "d1")).toMatchObject({
      deploymentStatus: "DEPLOYED",
    });
    const state = await worker.default.fetch(`https://example.com/__mock/runs/${run.runId}/state`, {
      headers: controlHeaders(run),
    });
    await expect(state.json()).resolves.toMatchObject({ counts: { builds: 1, deployments: 1 } });

    expect(
      (
        await worker.default.fetch(`https://example.com/__mock/runs/${run.runId}`, {
          method: "DELETE",
          headers: controlHeaders(run),
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await worker.default.fetch(`${subscription}/builds/${build.code}`, {
          headers: sapHeaders(token),
        })
      ).status,
    ).toBe(401);
  });

  it("keeps failure and timeout flows deterministic", async () => {
    const failedRun = await createRun();
    const failedToken = await issueToken(failedRun);
    await configureScenario(failedRun, {
      ...DEFAULT_SCENARIO,
      build: { outcome: "FAIL", pollsBeforeTerminal: 0, logsAvailable: false },
    });
    const failedBuild = await (
      await worker.default.fetch(`${subscription}/builds`, {
        method: "POST",
        headers: { ...sapHeaders(failedToken), "Content-Type": "application/json" },
        body: JSON.stringify({ branch: "broken", name: "failure-flow" }),
      })
    ).json<{ code: string }>();
    const failure = await worker.default.fetch(
      `${subscription}/builds/${failedBuild.code}/progress`,
      {
        headers: sapHeaders(failedToken),
      },
    );
    await expect(failure.json()).resolves.toMatchObject({ buildStatus: "FAIL" });

    const timeoutRun = await createRun();
    const timeoutToken = await issueToken(timeoutRun);
    await configureScenario(timeoutRun, {
      ...DEFAULT_SCENARIO,
      build: { outcome: "NEVER", pollsBeforeTerminal: 0, logsAvailable: true },
    });
    const timeoutBuild = await (
      await worker.default.fetch(`${subscription}/builds`, {
        method: "POST",
        headers: { ...sapHeaders(timeoutToken), "Content-Type": "application/json" },
        body: JSON.stringify({ branch: "slow", name: "timeout-flow" }),
      })
    ).json<{ code: string }>();
    for (let poll = 0; poll < 4; poll += 1) {
      const response = await worker.default.fetch(
        `${subscription}/builds/${timeoutBuild.code}/progress`,
        { headers: sapHeaders(timeoutToken) },
      );
      await expect(response.json()).resolves.toMatchObject({ buildStatus: "BUILDING" });
    }
  });
});
