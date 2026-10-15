import type { MiddlewareHandler } from "hono";

import { verifyAccessToken } from "./jwt";
import { bearerToken, vendorProblem } from "../http";
import type { AppEnvironment } from "../types";

export const sapAuthentication: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const token = bearerToken(context.req.header("x-approuter-authorization"));
  if (!token) {
    return vendorProblem(
      401,
      "Unauthorized",
      "A bearer token is required in x-approuter-authorization.",
      {
        "WWW-Authenticate": "Bearer",
      },
    );
  }
  try {
    const payload = await verifyAccessToken(context.env, token);
    const runId = payload.run_id;
    const requestedRunId = context.req.header("x-mock-run-id");
    if (requestedRunId && requestedRunId !== runId) {
      return vendorProblem(
        403,
        "Forbidden",
        "The correlation run does not match the authenticated run.",
      );
    }
    if (context.req.path.split("/").some((segment) => segment.length > 255)) {
      return vendorProblem(400, "Bad Request", "A path identifier exceeds 255 characters.");
    }
    const active = await context.env.CCV2_RUN.getByName(runId).getActiveRun();
    if (!active.ok || active.value.resource !== payload.aud) {
      return vendorProblem(
        401,
        "Unauthorized",
        "The sandbox run is expired, deleted, or unavailable.",
        {
          "WWW-Authenticate": 'Bearer error="invalid_token"',
        },
      );
    }
    context.set("runId", runId);
    await next();
  } catch {
    return vendorProblem(401, "Unauthorized", "The bearer token is invalid or expired.", {
      "WWW-Authenticate": 'Bearer error="invalid_token"',
    });
  }
};
