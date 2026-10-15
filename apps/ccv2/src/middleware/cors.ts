import type { MiddlewareHandler } from "hono";

import type { AppEnvironment } from "../types";

const DEFAULT_ALLOWED_ORIGIN = "https://commercekit.tools";
const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, x-mock-run-id, x-approuter-authorization";

function allowedOrigins(configuredOrigins: string | undefined): ReadonlySet<string> {
  const value = configuredOrigins?.trim() ?? DEFAULT_ALLOWED_ORIGIN;

  return new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

function appendVaryOrigin(headers: Headers): void {
  const values =
    headers
      .get("Vary")
      ?.split(",")
      .map((value) => value.trim()) ?? [];

  if (!values.some((value) => value.toLowerCase() === "origin")) {
    headers.set("Vary", [...values, "Origin"].filter(Boolean).join(", "));
  }
}

export const corsMiddleware: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const origin = context.req.header("Origin");

  if (!origin) {
    await next();
    return;
  }

  const isAllowed = allowedOrigins(context.env.ALLOWED_ORIGINS).has(origin);

  if (context.req.method === "OPTIONS") {
    const headers = new Headers();
    appendVaryOrigin(headers);

    if (isAllowed) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
      headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
      headers.set("Access-Control-Max-Age", "86400");
    }

    return new Response(null, { status: 204, headers });
  }

  await next();
  appendVaryOrigin(context.res.headers);

  if (isAllowed) {
    context.res.headers.set("Access-Control-Allow-Origin", origin);
  }
};
