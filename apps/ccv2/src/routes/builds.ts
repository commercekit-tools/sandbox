import { Hono } from "hono";
import { ZodError } from "zod";

import { createBuildSchema } from "../domain/build";
import { jsonResponse, readJsonBody, RequestProblem, vendorProblem } from "../http";
import { singleFileZip } from "../services/zip";
import type { AppEnvironment } from "../types";
import { parseBuildListOptions, vendorError, zodDetail } from "./vendor-helpers";

export const buildRoutes = new Hono<AppEnvironment>();

buildRoutes.get("/v2/subscriptions/:subscriptionCode/builds", async (context) => {
  try {
    const options = parseBuildListOptions(new URL(context.req.url));
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).listBuilds(
      context.req.param("subscriptionCode"),
      options,
    );
    return result.ok ? jsonResponse(result.value) : vendorError(result);
  } catch (error) {
    return vendorProblem(
      400,
      "Bad Request",
      error instanceof Error ? error.message : "Invalid query.",
    );
  }
});

buildRoutes.post("/v2/subscriptions/:subscriptionCode/builds", async (context) => {
  try {
    const request = createBuildSchema.parse(await readJsonBody(context));
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).createBuild(
      context.req.param("subscriptionCode"),
      request,
    );
    return result.ok ? jsonResponse(result.value, 201) : vendorError(result);
  } catch (error) {
    if (error instanceof RequestProblem)
      return vendorProblem(error.status, "Bad Request", error.message);
    if (error instanceof ZodError) return vendorProblem(400, "Bad Request", zodDetail(error));
    throw error;
  }
});

buildRoutes.get("/v2/subscriptions/:subscriptionCode/builds/:buildCode", async (context) => {
  const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getBuild(
    context.req.param("subscriptionCode"),
    context.req.param("buildCode"),
  );
  return result.ok ? jsonResponse(result.value) : vendorError(result);
});

buildRoutes.delete("/v2/subscriptions/:subscriptionCode/builds/:buildCode", async (context) => {
  const result = await context.env.CCV2_RUN.getByName(context.get("runId")).deleteBuild(
    context.req.param("subscriptionCode"),
    context.req.param("buildCode"),
  );
  return result.ok
    ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
    : vendorError(result);
});

buildRoutes.get(
  "/v2/subscriptions/:subscriptionCode/builds/:buildCode/progress",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getBuildProgress(
      context.req.param("subscriptionCode"),
      context.req.param("buildCode"),
    );
    return result.ok ? jsonResponse(result.value) : vendorError(result);
  },
);

buildRoutes.get("/v2/subscriptions/:subscriptionCode/builds/:buildCode/logs", async (context) => {
  const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getBuildLog(
    context.req.param("subscriptionCode"),
    context.req.param("buildCode"),
  );
  if (!result.ok) return vendorError(result);
  const archive = singleFileZip(result.value.filename, result.value.content);
  return new Response(archive, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${context.req.param("buildCode")}-logs.zip"`,
      "Cache-Control": "no-store",
    },
  });
});
