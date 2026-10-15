import { exports as worker } from "cloudflare:workers";

export interface CreatedRun {
  runId: string;
  controlToken: string;
  expiresAt: string;
  credentials: {
    clientId: string;
    clientSecret: string;
    resource: string;
    tokenUrl: string;
  };
}

export async function createRun(): Promise<CreatedRun> {
  const response = await worker.default.fetch("https://example.com/__mock/runs", {
    method: "POST",
    headers: { "CF-Connecting-IP": `192.0.2.${String(Math.floor(Math.random() * 250) + 1)}` },
  });
  if (response.status !== 201)
    throw new Error(`Run creation failed with ${String(response.status)}`);
  return response.json<CreatedRun>();
}

export function controlHeaders(run: CreatedRun): Record<string, string> {
  return { Authorization: `Bearer ${run.controlToken}` };
}

export async function issueToken(run: CreatedRun): Promise<string> {
  const response = await worker.default.fetch("https://example.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: run.credentials.clientId,
      client_secret: run.credentials.clientSecret,
      grant_type: "client_credentials",
      resource: run.credentials.resource,
    }),
  });
  if (response.status !== 200)
    throw new Error(`Token issuance failed with ${String(response.status)}`);
  const body = await response.json<{ access_token: string }>();
  return body.access_token;
}
