import { Hono, type Context } from "hono";
import { ZodError, type ZodType } from "zod";

import {
  createDeploymentSchema,
  deploymentCancellationSchema,
  deploymentDecisionSchema,
  trafficSplitSchema,
} from "../domain/deployment";
import { jsonResponse, readJsonBody, RequestProblem, vendorProblem } from "../http";
import type { AppEnvironment } from "../types";
import { parseDeploymentListOptions, vendorError, zodDetail } from "./vendor-helpers";

export const deploymentRoutes = new Hono<AppEnvironment>();

async function validatedBody<T>(context: Context<AppEnvironment>, schema: ZodType<T>): Promise<T> {
  return schema.parse(await readJsonBody(context));
}

function bodyError(error: unknown): Response | undefined {
  if (error instanceof RequestProblem)
    return vendorProblem(error.status, "Bad Request", error.message);
  if (error instanceof ZodError) return vendorProblem(400, "Bad Request", zodDetail(error));
  return undefined;
}

deploymentRoutes.get("/v2/subscriptions/:subscriptionCode/deploymentmodes", async (context) => {
  const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getDeploymentModes(
    context.req.param("subscriptionCode"),
  );
  return result.ok ? jsonResponse(result.value) : vendorError(result);
});

deploymentRoutes.get("/v2/subscriptions/:subscriptionCode/deployments", async (context) => {
  try {
    const options = parseDeploymentListOptions(new URL(context.req.url));
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).listDeployments(
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

deploymentRoutes.post("/v2/subscriptions/:subscriptionCode/deployments", async (context) => {
  try {
    const request = await validatedBody(context, createDeploymentSchema);
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).createDeployment(
      context.req.param("subscriptionCode"),
      request,
    );
    return result.ok ? jsonResponse(result.value, 201) : vendorError(result);
  } catch (error) {
    const response = bodyError(error);
    if (response) return response;
    throw error;
  }
});

deploymentRoutes.get(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getDeployment(
      context.req.param("subscriptionCode"),
      context.req.param("deploymentCode"),
    );
    return result.ok ? jsonResponse(result.value) : vendorError(result);
  },
);

deploymentRoutes.get(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode/progress",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getDeploymentProgress(
      context.req.param("subscriptionCode"),
      context.req.param("deploymentCode"),
    );
    return result.ok ? jsonResponse(result.value) : vendorError(result);
  },
);

deploymentRoutes.get(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode/decisions",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(
      context.get("runId"),
    ).getDeploymentDecisions(
      context.req.param("subscriptionCode"),
      context.req.param("deploymentCode"),
    );
    return result.ok ? jsonResponse(result.value) : vendorError(result);
  },
);

deploymentRoutes.post(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode/decisions",
  async (context) => {
    try {
      const request = await validatedBody(context, deploymentDecisionSchema);
      const result = await context.env.CCV2_RUN.getByName(
        context.get("runId"),
      ).createDeploymentDecision(
        context.req.param("subscriptionCode"),
        context.req.param("deploymentCode"),
        request,
      );
      return result.ok ? jsonResponse(result.value, 201) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

deploymentRoutes.get(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode/cancellationoptions",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(
      context.get("runId"),
    ).getDeploymentCancellationOptions(
      context.req.param("subscriptionCode"),
      context.req.param("deploymentCode"),
    );
    return result.ok ? jsonResponse(result.value) : vendorError(result);
  },
);

deploymentRoutes.post(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode/cancellation",
  async (context) => {
    try {
      const request = await validatedBody(context, deploymentCancellationSchema);
      const result = await context.env.CCV2_RUN.getByName(
        context.get("runId"),
      ).createDeploymentCancellation(
        context.req.param("subscriptionCode"),
        context.req.param("deploymentCode"),
        request,
      );
      return result.ok
        ? new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } })
        : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

deploymentRoutes.get(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode/trafficsplit",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(
      context.get("runId"),
    ).getDeploymentTrafficSplit(
      context.req.param("subscriptionCode"),
      context.req.param("deploymentCode"),
    );
    return result.ok ? jsonResponse(result.value) : vendorError(result);
  },
);

deploymentRoutes.put(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode/trafficsplit",
  async (context) => {
    try {
      const request = await validatedBody(context, trafficSplitSchema);
      const result = await context.env.CCV2_RUN.getByName(
        context.get("runId"),
      ).updateDeploymentTrafficSplit(
        context.req.param("subscriptionCode"),
        context.req.param("deploymentCode"),
        request,
      );
      return result.ok ? jsonResponse(result.value, 201) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

deploymentRoutes.get(
  "/v2/subscriptions/:subscriptionCode/deployments/:deploymentCode/trafficsplit/history",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(
      context.get("runId"),
    ).getDeploymentTrafficSplitHistory(
      context.req.param("subscriptionCode"),
      context.req.param("deploymentCode"),
    );
    return result.ok ? jsonResponse(result.value) : vendorError(result);
  },
);
