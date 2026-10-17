import { exports as worker } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { configureScenario, controlHeaders, createRun, issueToken, sapHeaders } from "./helpers";
import { expectRequestContract, expectResponseContract } from "./schema-validator";

type JsonObject = Record<string, unknown>;

let management: JsonObject;
let control: JsonObject;

beforeAll(async () => {
  [management, control] = await Promise.all([
    worker.default
      .fetch("https://example.com/openapi.json")
      .then((response) => response.json<JsonObject>()),
    worker.default
      .fetch("https://example.com/openapi/sandbox.json")
      .then((response) => response.json<JsonObject>()),
  ]);
});

const subscription = "https://example.com/v2/subscriptions/131762872233634f29fdeb7d50983aa4";

function json(token: string, method: string, body: unknown, contentType = "application/json") {
  return {
    method,
    headers: { ...sapHeaders(token), "Content-Type": contentType },
    body: JSON.stringify(body),
  };
}

describe("actual responses conform to published OpenAPI schemas", () => {
  it("validates control, OAuth, build, deployment, binary, and problem contracts", async () => {
    const runResponse = await worker.default.fetch("https://example.com/sandbox/v1/runs", {
      method: "POST",
    });
    expect(runResponse.status).toBe(201);
    const run = (await expectResponseContract(control, "createRun", runResponse)) as Awaited<
      ReturnType<typeof createRun>
    >;

    const stateResponse = await worker.default.fetch(
      `https://example.com/sandbox/v1/runs/${run.runId}/state`,
      { headers: controlHeaders(run) },
    );
    await expectResponseContract(control, "getRunState", stateResponse);

    const oauthBody = {
      client_id: run.credentials.clientId,
      client_secret: run.credentials.clientSecret,
      grant_type: "client_credentials",
      resource: run.credentials.resource,
    };
    expectRequestContract(control, "issueToken", "application/x-www-form-urlencoded", oauthBody);
    const tokenResponse = await worker.default.fetch("https://example.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(oauthBody),
    });
    const tokenBody = (await expectResponseContract(control, "issueToken", tokenResponse)) as {
      access_token: string;
    };
    const token = tokenBody.access_token;

    await configureScenario(run, {
      build: { outcome: "SUCCESS", pollsBeforeTerminal: 0, logsAvailable: true },
      deployment: {
        outcome: "DEPLOYED",
        pollsBeforeTerminal: 0,
        cancellationAllowed: true,
        requireGreenDecision: false,
      },
      faults: [],
    });

    const buildRequest = { branch: "main", name: "contract-build", applicationCode: "commerce" };
    expectRequestContract(management, "createBuild", "application/json", buildRequest);
    const creation = await worker.default.fetch(
      `${subscription}/builds`,
      json(token, "POST", buildRequest),
    );
    const build = (await expectResponseContract(management, "createBuild", creation)) as {
      code: string;
    };
    await expectResponseContract(
      management,
      "getBuild",
      await worker.default.fetch(`${subscription}/builds/${build.code}`, {
        headers: sapHeaders(token),
      }),
    );
    await expectResponseContract(
      management,
      "getBuilds",
      await worker.default.fetch(`${subscription}/builds?$count=true&statusNot=FAIL,DELETED`, {
        headers: sapHeaders(token),
      }),
    );
    await expectResponseContract(
      management,
      "getBuildProgress",
      await worker.default.fetch(`${subscription}/builds/${build.code}/progress`, {
        headers: sapHeaders(token),
      }),
    );
    const logs = await worker.default.fetch(`${subscription}/builds/${build.code}/logs`, {
      headers: sapHeaders(token),
    });
    expect(logs.headers.get("Content-Type")).toBe("application/octet-stream");
    const archive = new Uint8Array(
      (await expectResponseContract(management, "getBuildLogs", logs)) as ArrayBuffer,
    );
    expect(Array.from(archive.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(archive.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);

    await expectResponseContract(
      management,
      "getDeploymentModes",
      await worker.default.fetch(`${subscription}/deploymentmodes`, { headers: sapHeaders(token) }),
    );
    const deploymentRequest = {
      buildCode: build.code,
      environmentCode: "d1",
      databaseUpdateMode: "NONE",
      strategy: "ROLLING_UPDATE",
    };
    expectRequestContract(management, "createDeployment", "application/json", deploymentRequest);
    const deployment = (await expectResponseContract(
      management,
      "createDeployment",
      await worker.default.fetch(
        `${subscription}/deployments`,
        json(token, "POST", deploymentRequest),
      ),
    )) as { code: string };
    await expectResponseContract(
      management,
      "getDeploymentProgress",
      await worker.default.fetch(`${subscription}/deployments/${deployment.code}/progress`, {
        headers: sapHeaders(token),
      }),
    );
    await expectResponseContract(
      management,
      "getDeployment",
      await worker.default.fetch(`${subscription}/deployments/${deployment.code}`, {
        headers: sapHeaders(token),
      }),
    );

    const problem = await worker.default.fetch(`${subscription}/builds`, {
      method: "POST",
      headers: { ...sapHeaders(token), "Content-Type": "application/json" },
      body: "{}",
    });
    expect(problem.status).toBe(400);
    expect(problem.headers.get("Content-Type")).toContain("application/problem+json");
    await expectResponseContract(management, "createBuild", problem);
  });

  it("validates representative extended-family requests and responses", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const environment = `${subscription}/environments/d1`;

    await expectResponseContract(
      management,
      "getEnvironments",
      await worker.default.fetch(`${subscription}/environments?status=AVAILABLE`, {
        headers: sapHeaders(token),
      }),
    );

    const endpointRequest = {
      name: "Contract endpoint",
      domainName: "contract.sandbox.invalid",
      protocol: "HTTPS",
      k8sService: "commerce",
      k8sServiceVersion: "BLUE",
      access: "ALLOW_ALL",
    };
    expectRequestContract(management, "createEndpoint", "application/json", endpointRequest);
    const endpoint = (await expectResponseContract(
      management,
      "createEndpoint",
      await worker.default.fetch(`${environment}/endpoints`, json(token, "POST", endpointRequest)),
    )) as { code: string };
    const endpointPatch = { maintenanceMode: true };
    expectRequestContract(
      management,
      "updateEndpoint",
      "application/merge-patch+json",
      endpointPatch,
    );
    await expectResponseContract(
      management,
      "updateEndpoint",
      await worker.default.fetch(
        `${environment}/endpoints/${endpoint.code}`,
        json(token, "PATCH", endpointPatch, "application/merge-patch+json"),
      ),
    );
    await expectResponseContract(
      management,
      "getEndpoints",
      await worker.default.fetch(`${environment}/endpoints?webProxy=public&service=commerce`, {
        headers: sapHeaders(token),
      }),
    );

    const backupRequest = { description: "Contract backup" };
    expectRequestContract(management, "createDatabackup", "application/json", backupRequest);
    const backup = (await expectResponseContract(
      management,
      "createDatabackup",
      await worker.default.fetch(`${environment}/databackups`, json(token, "POST", backupRequest)),
    )) as { databackupCode: string };
    await expectResponseContract(
      management,
      "getDatabackup",
      await worker.default.fetch(`${environment}/databackups/${backup.databackupCode}`, {
        headers: sapHeaders(token),
      }),
    );
    const restoreRequest = { databackupCode: backup.databackupCode };
    expectRequestContract(management, "createDatarestore", "application/json", restoreRequest);
    await expectResponseContract(
      management,
      "createDatarestore",
      await worker.default.fetch(
        `${environment}/datarestores`,
        json(token, "POST", restoreRequest),
      ),
    );

    await expectResponseContract(
      management,
      "getEnvironmentScalingDetail",
      await worker.default.fetch(`${environment}/scaling`, { headers: sapHeaders(token) }),
    );
    await expectResponseContract(
      management,
      "getEnvironmentScalingOption",
      await worker.default.fetch(`${environment}/scalingOptions`, { headers: sapHeaders(token) }),
    );

    const activityRequest = {
      activityType: "DEPLOYMENT",
      scheduledTimestamp: "2027-01-01T00:00:00.000Z",
    };
    expectRequestContract(
      management,
      "createScheduledActivity",
      "application/json",
      activityRequest,
    );
    await expectResponseContract(
      management,
      "createScheduledActivity",
      await worker.default.fetch(
        `${environment}/scheduledactivities`,
        json(token, "POST", activityRequest),
      ),
    );

    const propertyRequest = {
      key: "catalog",
      value: { catalogId: "electronics" },
      flags: ["EDITABLE"],
    };
    expectRequestContract(management, "putProperty", "application/json", propertyRequest);
    await expectResponseContract(
      management,
      "putProperty",
      await worker.default.fetch(
        `${environment}/services/commerce/properties/catalog`,
        json(token, "PUT", propertyRequest),
      ),
    );

    const certificateRequest = {
      name: "Contract certificate",
      certificate: "synthetic-certificate",
      certificateKey: "synthetic-private-key",
    };
    expectRequestContract(management, "createCertificate", "application/json", certificateRequest);
    await expectResponseContract(
      management,
      "createCertificate",
      await worker.default.fetch(
        `${subscription}/certificates`,
        json(token, "POST", certificateRequest),
      ),
    );
    await expectResponseContract(
      management,
      "getAllRolesForSubscription",
      await worker.default.fetch(`${subscription}/roles`, { headers: sapHeaders(token) }),
    );
    const assignmentRequest = {
      username: "contract@example.invalid",
      email: "contract@example.invalid",
      role: "ROLE_VIEWER",
      environments: ["d1"],
    };
    expectRequestContract(
      management,
      "createUserRoleAssignment",
      "application/json",
      assignmentRequest,
    );
    await expectResponseContract(
      management,
      "createUserRoleAssignment",
      await worker.default.fetch(
        `${subscription}/userroleassignments`,
        json(token, "POST", assignmentRequest),
      ),
    );
  });
});
