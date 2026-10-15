import { Hono } from "hono";

import type { AppEnvironment } from "../types";

const HEALTH_OBJECT_NAME = "__ccv2_health__";

export const healthRoutes = new Hono<AppEnvironment>();

healthRoutes.get("/sandbox/v1/health", async (context) => {
  context.header("Cache-Control", "no-store");

  try {
    const healthObject = context.env.CCV2_RUN.getByName(HEALTH_OBJECT_NAME);
    await healthObject.ping();

    return context.json({
      status: "ok",
      service: "ccv2",
      components: {
        worker: "ok",
        storage: "ok",
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ccv2.health.storage_failed",
        error: error instanceof Error ? error.message : "Unknown storage failure",
      }),
    );

    return context.json(
      {
        status: "unavailable",
        service: "ccv2",
        components: {
          worker: "ok",
          storage: "unavailable",
        },
        error: {
          code: "storage_unavailable",
          message: "Durable storage is unavailable.",
        },
      },
      503,
    );
  }
});

healthRoutes.all("/sandbox/v1/health", (context) => {
  context.header("Allow", "GET");
  context.header("Cache-Control", "no-store");
  return context.json(
    {
      error: {
        code: "method_not_allowed",
        message: "This endpoint only supports GET requests.",
      },
    },
    405,
  );
});
