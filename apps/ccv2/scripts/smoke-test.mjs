/* global AbortController, URL, URLSearchParams, clearTimeout, console, fetch, process, setTimeout */

import { inflateRawSync } from "node:zlib";

const DEFAULT_LOCAL_URL = "http://127.0.0.1:8787";
const PRODUCTION_URL = "https://ccv2.sandbox.commercekit.tools";
const DEFAULT_TIMEOUT_MS = 10_000;
const SUBSCRIPTION = "SUBSCRIPTION_001";

function parseArguments(argv) {
  const options = {
    baseUrl: process.env.CCV2_SMOKE_BASE_URL ?? DEFAULT_LOCAL_URL,
    timeoutMs: Number(process.env.CCV2_SMOKE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    production: false,
    confirmed: process.env.CCV2_CONFIRM_PRODUCTION === "1",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base-url") options.baseUrl = argv[++index] ?? "";
    else if (argument === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (argument === "--production") options.production = true;
    else if (argument === "--confirm-production") options.confirmed = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  if (!options.baseUrl || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 100) {
    throw new Error("A valid base URL and an integer timeout of at least 100 ms are required.");
  }
  const targetIsProduction = new URL(options.baseUrl).origin === PRODUCTION_URL;
  if ((options.production || targetIsProduction) && !options.confirmed) {
    throw new Error(
      "Production smoke testing requires CCV2_CONFIRM_PRODUCTION=1 or --confirm-production.",
    );
  }
  if (options.production && !targetIsProduction) {
    throw new Error(`--production requires the target ${PRODUCTION_URL}.`);
  }
  options.production ||= targetIsProduction;
  return options;
}

const options = parseArguments(process.argv.slice(2));
const createdRuns = new Map();
const results = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(label) {
  results.set(label, "PASS");
}

async function request(path, init = {}, expectedStatus) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${options.baseUrl}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
      signal: controller.signal,
    });
    if (expectedStatus !== undefined && response.status !== expectedStatus) {
      throw new Error(
        `${init.method ?? "GET"} ${path} returned ${response.status}; expected ${expectedStatus}.`,
      );
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRequest(path, init = {}, expectedStatus = 200) {
  const response = await request(path, init, expectedStatus);
  const contentType = response.headers.get("content-type") ?? "";
  assert(contentType.includes("json"), `${path} did not return JSON.`);
  return response.json();
}

async function createRun() {
  const run = await jsonRequest("/sandbox/v1/runs", { method: "POST" }, 201);
  assert(/^run_[0-9a-f]{32}$/.test(run.runId), "Run creation returned an invalid run ID.");
  assert(run.controlToken && run.credentials?.clientSecret, "Run credentials are incomplete.");
  createdRuns.set(run.runId, run.controlToken);
  return run;
}

function controlHeaders(run) {
  return { Authorization: `Bearer ${run.controlToken}` };
}

function sapHeaders(token, runId) {
  return {
    "x-approuter-authorization": `Bearer ${token}`,
    ...(runId ? { "x-sandbox-run-id": runId } : {}),
  };
}

async function issueToken(run) {
  const body = new URLSearchParams({
    client_id: run.credentials.clientId,
    client_secret: run.credentials.clientSecret,
    grant_type: "client_credentials",
    resource: run.credentials.resource,
  });
  const response = await jsonRequest(
    "/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    200,
  );
  assert(response.token_type === "Bearer" && response.access_token, "OAuth response is invalid.");
  return response.access_token;
}

async function configure(run, overrides) {
  const scenario = {
    build: { outcome: "SUCCESS", pollsBeforeTerminal: 0, logsAvailable: true },
    deployment: {
      outcome: "DEPLOYED",
      pollsBeforeTerminal: 0,
      cancellationAllowed: true,
      requireGreenDecision: true,
    },
    faults: [],
    ...overrides,
  };
  await jsonRequest(
    `/sandbox/v1/runs/${run.runId}/scenario`,
    {
      method: "PUT",
      headers: { ...controlHeaders(run), "Content-Type": "application/json" },
      body: JSON.stringify(scenario),
    },
    200,
  );
}

async function deleteRun(run) {
  const response = await request(`/sandbox/v1/runs/${run.runId}`, {
    method: "DELETE",
    headers: controlHeaders(run),
  });
  if (response.status !== 204 && response.status !== 404 && response.status !== 410) {
    throw new Error(`Cleanup for ${run.runId} returned ${response.status}.`);
  }
  createdRuns.delete(run.runId);
}

async function createBuild(run, token, name) {
  return jsonRequest(
    `/v2/subscriptions/${SUBSCRIPTION}/builds`,
    {
      method: "POST",
      headers: { ...sapHeaders(token, run.runId), "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", name }),
    },
    201,
  );
}

async function pollBuild(run, token, code, expected, attempts = 4) {
  let progress;
  for (let index = 0; index < attempts; index += 1) {
    progress = await jsonRequest(`/v2/subscriptions/${SUBSCRIPTION}/builds/${code}/progress`, {
      headers: sapHeaders(token, run.runId),
    });
    if (["SUCCESS", "FAIL"].includes(progress.buildStatus)) break;
  }
  assert(progress?.buildStatus === expected, `Build ${code} ended as ${progress?.buildStatus}.`);
  return progress;
}

async function createDeployment(run, token, buildCode, strategy = "ROLLING_UPDATE") {
  return jsonRequest(
    `/v2/subscriptions/${SUBSCRIPTION}/deployments`,
    {
      method: "POST",
      headers: { ...sapHeaders(token, run.runId), "Content-Type": "application/json" },
      body: JSON.stringify({
        buildCode,
        environmentCode: "d1",
        databaseUpdateMode: "NONE",
        strategy,
      }),
    },
    201,
  );
}

async function pollDeployment(run, token, code, expected, attempts = 5) {
  let progress;
  for (let index = 0; index < attempts; index += 1) {
    progress = await jsonRequest(`/v2/subscriptions/${SUBSCRIPTION}/deployments/${code}/progress`, {
      headers: sapHeaders(token, run.runId),
    });
    if (["DEPLOYED", "FAIL", "UNDEPLOYED"].includes(progress.deploymentStatus)) break;
  }
  assert(
    progress?.deploymentStatus === expected,
    `Deployment ${code} ended as ${progress?.deploymentStatus}.`,
  );
  return progress;
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function verifySingleFileZip(bytes) {
  assert(bytes.length >= 52 && readUint32(bytes, 0) === 0x04034b50, "ZIP local header is invalid.");
  const method = readUint16(bytes, 8);
  const expectedCrc = readUint32(bytes, 14);
  const compressedSize = readUint32(bytes, 18);
  const uncompressedSize = readUint32(bytes, 22);
  const nameLength = readUint16(bytes, 26);
  const extraLength = readUint16(bytes, 28);
  const start = 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + compressedSize);
  const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : undefined;
  assert(content, `ZIP compression method ${method} is unsupported.`);
  assert(content.length === uncompressedSize, "ZIP uncompressed size is invalid.");
  assert(crc32(content) === expectedCrc, "ZIP CRC-32 is invalid.");
  assert(readUint32(bytes, bytes.length - 22) === 0x06054b50, "ZIP end record is invalid.");
}

async function successfulFlow() {
  const run = await createRun();
  const token = await issueToken(run);
  await configure(run, {});
  const build = await createBuild(run, token, "smoke-success");
  await pollBuild(run, token, build.code, "SUCCESS");
  const detail = await jsonRequest(`/v2/subscriptions/${SUBSCRIPTION}/builds/${build.code}`, {
    headers: sapHeaders(token, run.runId),
  });
  assert(
    detail.code === build.code && detail.status === "SUCCESS",
    "Build detail is inconsistent.",
  );
  const logs = await request(
    `/v2/subscriptions/${SUBSCRIPTION}/builds/${build.code}/logs`,
    {
      headers: sapHeaders(token, run.runId),
    },
    200,
  );
  verifySingleFileZip(new Uint8Array(await logs.arrayBuffer()));
  pass("Build success");
  pass("ZIP logs");

  const modes = await jsonRequest(`/v2/subscriptions/${SUBSCRIPTION}/deploymentmodes`, {
    headers: sapHeaders(token, run.runId),
  });
  assert(Array.isArray(modes) && modes.length > 0, "Deployment modes are empty.");
  const deployment = await createDeployment(run, token, build.code);
  await pollDeployment(run, token, deployment.code, "DEPLOYED");
  const deploymentDetail = await jsonRequest(
    `/v2/subscriptions/${SUBSCRIPTION}/deployments/${deployment.code}`,
    { headers: sapHeaders(token, run.runId) },
  );
  assert(deploymentDetail.status === "DEPLOYED", "Deployment detail is inconsistent.");
  pass("Deployment success");
  const state = await jsonRequest(`/sandbox/v1/runs/${run.runId}/state`, {
    headers: controlHeaders(run),
  });
  assert(
    state.counts?.builds === 1 && state.counts?.deployments === 1,
    "Run state is inconsistent.",
  );
  assert(!JSON.stringify(state).includes(run.controlToken), "Run state exposed its control token.");
  await deleteRun(run);
  const deleted = await request(`/sandbox/v1/runs/${run.runId}`, { headers: controlHeaders(run) });
  assert([404, 410].includes(deleted.status), "Deleted-run access did not fail.");
  pass("Deleted-run behavior");
}

async function failureFlows() {
  const buildRun = await createRun();
  const buildToken = await issueToken(buildRun);
  await configure(buildRun, {
    build: {
      outcome: "FAIL",
      pollsBeforeTerminal: 0,
      logsAvailable: false,
      failureMessage: "Synthetic failure",
    },
  });
  const failedBuild = await createBuild(buildRun, buildToken, "smoke-build-failure");
  const failedProgress = await pollBuild(buildRun, buildToken, failedBuild.code, "FAIL", 1);
  assert(failedProgress.errorMessage, "Failed build did not include failure details.");
  await deleteRun(buildRun);

  const deploymentRun = await createRun();
  const deploymentToken = await issueToken(deploymentRun);
  await configure(deploymentRun, {});
  const build = await createBuild(deploymentRun, deploymentToken, "smoke-deployment-failure");
  await pollBuild(deploymentRun, deploymentToken, build.code, "SUCCESS", 1);
  await configure(deploymentRun, {
    deployment: {
      outcome: "FAIL",
      pollsBeforeTerminal: 0,
      cancellationAllowed: true,
      requireGreenDecision: true,
      failureMessage: "Synthetic rollout failure",
    },
  });
  const deployment = await createDeployment(deploymentRun, deploymentToken, build.code);
  const progress = await pollDeployment(deploymentRun, deploymentToken, deployment.code, "FAIL", 1);
  assert(
    JSON.stringify(progress).includes("Synthetic rollout failure"),
    "Deployment failure details are absent.",
  );
  await deleteRun(deploymentRun);

  const timeoutRun = await createRun();
  const timeoutToken = await issueToken(timeoutRun);
  await configure(timeoutRun, {
    build: { outcome: "NEVER", pollsBeforeTerminal: 0, logsAvailable: false },
  });
  const pendingBuild = await createBuild(timeoutRun, timeoutToken, "smoke-timeout");
  for (let index = 0; index < 3; index += 1) {
    const pending = await jsonRequest(
      `/v2/subscriptions/${SUBSCRIPTION}/builds/${pendingBuild.code}/progress`,
      { headers: sapHeaders(timeoutToken, timeoutRun.runId) },
    );
    assert(pending.buildStatus === "BUILDING", "Nonterminating build unexpectedly terminated.");
  }
  await deleteRun(timeoutRun);
  pass("Failure scenarios");
  pass("Bounded timeout");
}

async function isolationFlow() {
  const first = await createRun();
  const second = await createRun();
  const [firstToken, secondToken] = await Promise.all([issueToken(first), issueToken(second)]);
  assert(firstToken !== secondToken, "Independent runs received the same access token.");
  const wrongControl = await request(`/sandbox/v1/runs/${second.runId}`, {
    headers: controlHeaders(first),
  });
  assert(wrongControl.status === 403, "A control token authorized another run.");
  const wrongCorrelation = await request(`/v2/subscriptions/${SUBSCRIPTION}/builds`, {
    headers: sapHeaders(firstToken, second.runId),
  });
  assert(wrongCorrelation.status === 403, "A mismatched correlation run was accepted.");
  const secondList = await jsonRequest(`/v2/subscriptions/${SUBSCRIPTION}/builds`, {
    headers: sapHeaders(secondToken, second.runId),
  });
  assert(secondList.count === 0, "A new run observed another run's resources.");
  await deleteRun(first);
  await deleteRun(second);
  pass("Run isolation");
}

async function greenFlow() {
  const run = await createRun();
  const token = await issueToken(run);
  await configure(run, {});
  const build = await createBuild(run, token, "smoke-green");
  await pollBuild(run, token, build.code, "SUCCESS", 1);
  const deployment = await createDeployment(run, token, build.code, "GREEN");
  const root = `/v2/subscriptions/${SUBSCRIPTION}/deployments/${deployment.code}`;
  const waiting = await jsonRequest(`${root}/progress`, { headers: sapHeaders(token, run.runId) });
  assert(
    waiting.deploymentStatus === "DEPLOYING" && waiting.percentage === 90,
    "Green deployment did not await a decision.",
  );
  await jsonRequest(
    `${root}/decisions`,
    {
      method: "POST",
      headers: { ...sapHeaders(token, run.runId), "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "PREPARE_CANARY", reason: "Smoke verification" }),
    },
    201,
  );
  const split = await jsonRequest(`${root}/trafficsplit`, {
    headers: sapHeaders(token, run.runId),
  });
  assert(split.services?.[0]?.percentage === 10, "Canary traffic split is invalid.");
  await jsonRequest(
    `${root}/decisions`,
    {
      method: "POST",
      headers: { ...sapHeaders(token, run.runId), "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "ACCEPT", reason: "Smoke verification passed" }),
    },
    201,
  );
  const detail = await jsonRequest(root, { headers: sapHeaders(token, run.runId) });
  assert(detail.status === "DEPLOYED", "Accepted green deployment did not complete.");
  await deleteRun(run);
  pass("Blue/green behavior");
}

async function cleanup() {
  const failures = [];
  for (const [runId, controlToken] of createdRuns) {
    try {
      await deleteRun({ runId, controlToken });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) throw new Error(`Cleanup failed for ${failures.length} run(s).`);
  pass("Cleanup");
}

async function main() {
  console.log(`CCv2 Sandbox ${options.production ? "Production" : "Local"} Smoke Test\n`);
  console.log(`Target: ${options.baseUrl}\n`);
  let failure;
  try {
    const health = await jsonRequest("/sandbox/v1/health");
    assert(health.status === "ok", "Health endpoint is not healthy.");
    pass("Health");
    const [management, control, jwks] = await Promise.all([
      request("/openapi.json", {}, 200),
      request("/openapi/sandbox.json", {}, 200),
      jsonRequest("/.well-known/jwks.json"),
    ]);
    assert(
      (management.headers.get("content-type") ?? "").includes("json"),
      "Management OpenAPI is not JSON.",
    );
    assert(
      (control.headers.get("content-type") ?? "").includes("json"),
      "Control OpenAPI is not JSON.",
    );
    assert(
      Array.isArray(jwks.keys) && jwks.keys.every((key) => !key.d),
      "JWKS is invalid or private.",
    );
    pass("OpenAPI");
    pass("OAuth/JWKS");
    await successfulFlow();
    await failureFlows();
    await isolationFlow();
    await greenFlow();
  } catch (error) {
    failure = error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      failure ??= cleanupError;
      results.set("Cleanup", "FAIL");
    }
  }
  for (const [label, result] of results) console.log(`${label}: ${result}`);
  console.log(`\nResult: ${failure ? "FAIL" : "PASS"}`);
  if (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    console.error(`Reason: ${message.replace(/Bearer [^\s]+/g, "Bearer [REDACTED]")}`);
    process.exitCode = 1;
  }
}

await main();
