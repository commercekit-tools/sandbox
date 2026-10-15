import type { MiddlewareHandler } from "hono";

import { MAX_REQUEST_BODY_BYTES } from "../domain/run";
import { mockError, vendorProblem } from "../http";
import type { AppEnvironment } from "../types";

export const bodyLimitMiddleware: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const declaredLength = Number(context.req.header("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    if (context.req.path.startsWith("/v2/")) {
      return vendorProblem(413, "Payload Too Large", "The request body exceeds 64 KiB.");
    }
    if (!context.req.path.startsWith("/oauth2/")) {
      return mockError(413, "request_too_large", "The request body exceeds 64 KiB.");
    }
  }
  await next();
};
