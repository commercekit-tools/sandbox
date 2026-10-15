import type { Scenario } from "./scenario";

export const RUN_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const RUN_ID_PATTERN = /^run_[0-9a-f]{32}$/;
export const CLIENT_ID_PATTERN = /^ccv2_(run_[0-9a-f]{32})_[0-9a-f]{16}$/;
export const MAX_REQUEST_BODY_BYTES = 64 * 1_024;

export interface RunInitialization {
  runId: string;
  createdAt: string;
  expiresAt: string;
  controlTokenHash: string;
  clientId: string;
  clientSecretHash: string;
  resource: string;
}

export interface RunSummary {
  runId: string;
  createdAt: string;
  expiresAt: string;
  scenario: Scenario;
  schemaVersion: number;
}

export interface RunState extends RunSummary {
  counts: {
    builds: number;
    deployments: number;
    resources: number;
    events: number;
  };
  pollCounters: Record<string, number>;
  faultCounters: Record<string, number>;
}

export interface OperationFault {
  status: 400 | 401 | 403 | 404 | 409 | 412 | 423 | 429 | 500;
  title: string;
  detail: string;
  retryAfterSeconds?: number;
}

export type RunResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: 400 | 401 | 403 | 404 | 409 | 412 | 423 | 429 | 500;
      code: string;
      message: string;
    };

export function runIdFromClientId(clientId: string): string | undefined {
  return CLIENT_ID_PATTERN.exec(clientId)?.[1];
}
