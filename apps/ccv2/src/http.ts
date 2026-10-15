import type { Context } from "hono";

import { MAX_REQUEST_BODY_BYTES } from "./domain/run";
import type { AppEnvironment } from "./types";

export class RequestProblem extends Error {
  constructor(
    public readonly status: 400 | 413 | 415,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function readJsonBody(context: Context<AppEnvironment>): Promise<unknown> {
  const contentType = context.req.header("Content-Type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new RequestProblem(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json.",
    );
  }
  const declaredLength = Number(context.req.header("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new RequestProblem(413, "request_too_large", "The request body exceeds 64 KiB.");
  }
  const text = await context.req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new RequestProblem(413, "request_too_large", "The request body exceeds 64 KiB.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestProblem(400, "invalid_json", "The request body is not valid JSON.");
  }
}

export function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=UTF-8");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

export function mockError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status);
}

export function vendorProblem(
  status: number,
  title: string,
  detail: string,
  headers?: HeadersInit,
): Response {
  return jsonResponse({ title, detail }, status, {
    ...Object.fromEntries(new Headers(headers)),
    "Content-Type": "application/problem+json; charset=UTF-8",
  });
}

export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  return match?.[1];
}
