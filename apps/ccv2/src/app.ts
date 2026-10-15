import { Hono } from "hono";

import { sapAuthentication } from "./auth/middleware";
import { bodyLimitMiddleware } from "./middleware/body-limit";
import { corsMiddleware } from "./middleware/cors";
import { buildRoutes } from "./routes/builds";
import { deploymentRoutes } from "./routes/deployments";
import { extendedRoutes } from "./routes/extended";
import { healthRoutes } from "./routes/health";
import { mockControlRoutes } from "./routes/mock-control";
import { oauthRoutes } from "./routes/oauth";
import { openapiRoutes } from "./routes/openapi";
import type { AppEnvironment } from "./types";

export function createApp(): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();

  app.use("*", corsMiddleware);
  app.use("*", bodyLimitMiddleware);

  app.get("/", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({
      service: "CommerceKit CCv2 Sandbox",
      status: "available",
      documentation: "https://commercekit.tools/tools/sandbox/ccv2",
    });
  });

  app.all("/", (context) => {
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

  app.route("/", healthRoutes);
  app.route("/", oauthRoutes);
  app.route("/", mockControlRoutes);
  app.route("/", openapiRoutes);
  app.use("/v2/*", sapAuthentication);
  app.route("/", buildRoutes);
  app.route("/", deploymentRoutes);
  app.route("/", extendedRoutes);

  app.notFound((context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      {
        error: {
          code: "not_found",
          message: "The requested resource was not found.",
        },
      },
      404,
    );
  });

  app.onError((error, context) => {
    console.error(
      JSON.stringify({
        event: "ccv2.request.unhandled_error",
        method: context.req.method,
        path: context.req.path,
        error: error.message,
      }),
    );

    context.header("Cache-Control", "no-store");
    return context.json(
      {
        error: {
          code: "internal_error",
          message: "An unexpected error occurred.",
        },
      },
      500,
    );
  });

  return app;
}

export const app = createApp();
