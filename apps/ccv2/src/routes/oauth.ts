import { Hono } from "hono";

import { secretVerifier } from "../auth/crypto";
import { issueAccessToken, publicJwks } from "../auth/jwt";
import { MAX_REQUEST_BODY_BYTES, runIdFromClientId } from "../domain/run";
import { jsonResponse } from "../http";
import type { AppEnvironment } from "../types";

export const oauthRoutes = new Hono<AppEnvironment>();

function oauthError(status: number, error: string, description: string): Response {
  return jsonResponse({ error, error_description: description }, status, {
    "WWW-Authenticate": `Bearer error="${error}"`,
  });
}

oauthRoutes.post("/oauth2/token", async (context) => {
  const contentType = context.req.header("Content-Type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/x-www-form-urlencoded") {
    return oauthError(
      400,
      "invalid_request",
      "Content-Type must be application/x-www-form-urlencoded.",
    );
  }
  const declaredLength = Number(context.req.header("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return oauthError(400, "invalid_request", "The token request is too large.");
  }
  const bytes = await context.req.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) {
    return oauthError(400, "invalid_request", "The token request is too large.");
  }
  const text = new TextDecoder().decode(bytes);
  const form = new URLSearchParams(text);
  const clientId = form.get("client_id") ?? "";
  const clientSecret = form.get("client_secret") ?? "";
  const grantType = form.get("grant_type") ?? "";
  const resource = form.get("resource") ?? "";
  if (!clientId || !clientSecret || !grantType || !resource) {
    return oauthError(
      400,
      "invalid_request",
      "client_id, client_secret, grant_type, and resource are required.",
    );
  }
  if (grantType !== "client_credentials") {
    return oauthError(400, "unsupported_grant_type", "Only client_credentials is supported.");
  }
  const runId = runIdFromClientId(clientId);
  if (!runId) return oauthError(401, "invalid_client", "The client credentials are invalid.");

  const stub = context.env.CCV2_RUN.getByName(runId);
  const clientSecretHash = await secretVerifier(
    context.env.RUN_TOKEN_SIGNING_KEY,
    "client",
    runId,
    clientSecret,
  );
  const verified = await stub.verifyClientCredentials(clientId, clientSecretHash, resource);
  if (!verified.ok) {
    console.warn(JSON.stringify({ event: "ccv2.oauth.failed", runId, status: 401 }));
    return oauthError(401, "invalid_client", "The client credentials are invalid.");
  }
  const fault = await stub.consumeFault("issueToken");
  if (fault) return oauthError(fault.status, "temporarily_unavailable", fault.detail);

  const token = await issueAccessToken(context.env, runId, resource);
  return jsonResponse({
    access_token: token.accessToken,
    token_type: "Bearer",
    expires_in: token.expiresIn,
  });
});

oauthRoutes.get("/.well-known/jwks.json", (context) =>
  jsonResponse(publicJwks(context.env), 200, { "Cache-Control": "public, max-age=300" }),
);
