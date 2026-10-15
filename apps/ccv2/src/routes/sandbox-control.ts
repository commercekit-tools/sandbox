import { Hono, type Context } from "hono";
import { ZodError } from "zod";

import { randomHex, randomSecret, secretVerifier } from "../auth/crypto";
import { RUN_ID_PATTERN, RUN_LIFETIME_MS, type RunResult } from "../domain/run";
import { parseScenario } from "../domain/scenario";
import { bearerToken, controlError, readJsonBody, RequestProblem, jsonResponse } from "../http";
import type { AppEnvironment } from "../types";

export const sandboxControlRoutes = new Hono<AppEnvironment>();

function stubFor(context: Context<AppEnvironment>, runId: string) {
  return context.env.CCV2_RUN.getByName(runId);
}

async function controlVerifier(
  context: Context<AppEnvironment>,
  runId: string,
): Promise<string | Response> {
  if (!RUN_ID_PATTERN.test(runId)) {
    return controlError(400, "invalid_run_id", "The run identifier is malformed.");
  }
  const token = bearerToken(context.req.header("Authorization"));
  if (!token) return controlError(401, "unauthorized", "A run-control bearer token is required.");
  return secretVerifier(context.env.RUN_TOKEN_SIGNING_KEY, "control", runId, token);
}

function resultResponse(result: Extract<RunResult<unknown>, { ok: false }>): Response {
  return controlError(result.status, result.code, result.message);
}

sandboxControlRoutes.post("/sandbox/v1/runs", async (context) => {
  const source = context.req.header("CF-Connecting-IP") ?? "unknown";
  const rateLimit = await context.env.RUN_CREATION_RATE_LIMIT.limit({ key: source });
  if (!rateLimit.success) {
    return controlError(
      429,
      "rate_limited",
      "Too many sandbox runs have been created. Try again later.",
    );
  }

  const runId = `run_${randomHex(16)}`;
  const controlToken = randomSecret();
  const clientSecret = randomSecret();
  const clientId = `ccv2_${runId}_${randomHex(8)}`;
  const resource = `urn:commercekit:ccv2:${runId}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + RUN_LIFETIME_MS).toISOString();
  const [controlTokenHash, clientSecretHash] = await Promise.all([
    secretVerifier(context.env.RUN_TOKEN_SIGNING_KEY, "control", runId, controlToken),
    secretVerifier(context.env.RUN_TOKEN_SIGNING_KEY, "client", runId, clientSecret),
  ]);
  const result = await stubFor(context, runId).initializeRun({
    runId,
    createdAt,
    expiresAt,
    controlTokenHash,
    clientId,
    clientSecretHash,
    resource,
  });
  if (!result.ok) return resultResponse(result);

  return jsonResponse(
    {
      runId,
      controlToken,
      expiresAt,
      credentials: {
        clientId,
        clientSecret,
        resource,
        tokenUrl: `${context.env.MOCK_JWT_ISSUER}/oauth2/token`,
      },
    },
    201,
  );
});

sandboxControlRoutes.get("/sandbox/v1/runs/:runId", async (context) => {
  const { runId } = context.req.param();
  const verifier = await controlVerifier(context, runId);
  if (verifier instanceof Response) return verifier;
  const result = await stubFor(context, runId).getRun(verifier);
  return result.ok ? jsonResponse(result.value) : resultResponse(result);
});

sandboxControlRoutes.delete("/sandbox/v1/runs/:runId", async (context) => {
  const { runId } = context.req.param();
  const verifier = await controlVerifier(context, runId);
  if (verifier instanceof Response) return verifier;
  const result = await stubFor(context, runId).deleteRun(verifier);
  if (!result.ok) return resultResponse(result);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
});

sandboxControlRoutes.get("/sandbox/v1/runs/:runId/scenario", async (context) => {
  const { runId } = context.req.param();
  const verifier = await controlVerifier(context, runId);
  if (verifier instanceof Response) return verifier;
  const result = await stubFor(context, runId).getScenario(verifier);
  return result.ok ? jsonResponse(result.value) : resultResponse(result);
});

sandboxControlRoutes.put("/sandbox/v1/runs/:runId/scenario", async (context) => {
  const { runId } = context.req.param();
  const verifier = await controlVerifier(context, runId);
  if (verifier instanceof Response) return verifier;
  try {
    const scenario = parseScenario(await readJsonBody(context));
    const result = await stubFor(context, runId).setScenario(verifier, scenario);
    return result.ok ? jsonResponse(result.value) : resultResponse(result);
  } catch (error) {
    if (error instanceof RequestProblem)
      return controlError(error.status, error.code, error.message);
    if (error instanceof ZodError) {
      return jsonResponse(
        {
          error: {
            code: "invalid_scenario",
            message: "The scenario is invalid.",
            issues: error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
          },
        },
        400,
      );
    }
    throw error;
  }
});

sandboxControlRoutes.get("/sandbox/v1/runs/:runId/state", async (context) => {
  const { runId } = context.req.param();
  const verifier = await controlVerifier(context, runId);
  if (verifier instanceof Response) return verifier;
  const result = await stubFor(context, runId).getState(verifier);
  return result.ok ? jsonResponse(result.value) : resultResponse(result);
});

sandboxControlRoutes.post("/sandbox/v1/runs/:runId/reset", async (context) => {
  const { runId } = context.req.param();
  const verifier = await controlVerifier(context, runId);
  if (verifier instanceof Response) return verifier;
  const result = await stubFor(context, runId).reset(verifier);
  return result.ok ? jsonResponse(result.value) : resultResponse(result);
});
