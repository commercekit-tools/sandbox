import { DurableObject } from "cloudflare:workers";

import { timingSafeTextEqual } from "../auth/crypto";
import type {
  OperationFault,
  RunInitialization,
  RunResult,
  RunState,
  RunSummary,
} from "../domain/run";
import { DEFAULT_SCENARIO, type Scenario } from "../domain/scenario";

const SCHEMA_VERSION = 2;
const MAX_EVENTS = 200;

export interface RunMetadata {
  runId: string;
  createdAt: string;
  schemaVersion: number;
}

export interface StorageHealth {
  storage: "ok";
}

interface RunMetadataRow {
  [column: string]: SqlStorageValue;
  run_id: string;
  created_at: string;
  schema_version: number;
}

interface RunSecurityRow {
  [column: string]: SqlStorageValue;
  expires_at: string;
  control_token_hash: string;
  client_id: string;
  client_secret_hash: string;
  resource: string;
}

interface ScenarioRow {
  [column: string]: SqlStorageValue;
  scenario_json: string;
}

interface CountRow {
  [column: string]: SqlStorageValue;
  count: number;
}

interface CounterRow {
  [column: string]: SqlStorageValue;
  operation_id: string;
  resource_id: string;
  call_count: number;
}

export class Ccv2Run extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.migrateSchema();
  }

  private migrateSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS run_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        run_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS run_security (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        expires_at TEXT NOT NULL,
        control_token_hash TEXT NOT NULL,
        client_id TEXT NOT NULL UNIQUE,
        client_secret_hash TEXT NOT NULL,
        resource TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS scenario_config (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        scenario_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS operation_counters (
        operation_id TEXT NOT NULL,
        resource_id TEXT NOT NULL DEFAULT '',
        call_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (operation_id, resource_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS builds (
        code TEXT PRIMARY KEY,
        subscription_code TEXT NOT NULL,
        state_json TEXT NOT NULL,
        scenario_json TEXT NOT NULL,
        poll_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS deployments (
        code TEXT PRIMARY KEY,
        subscription_code TEXT NOT NULL,
        environment_code TEXT NOT NULL,
        build_code TEXT NOT NULL,
        state_json TEXT NOT NULL,
        scenario_json TEXT NOT NULL,
        poll_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS resources (
        kind TEXT NOT NULL,
        subscription_code TEXT NOT NULL,
        environment_code TEXT NOT NULL DEFAULT '',
        code TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (kind, subscription_code, environment_code, code)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS request_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        event_type TEXT NOT NULL,
        operation_id TEXT NOT NULL DEFAULT '',
        resource_id TEXT NOT NULL DEFAULT '',
        status INTEGER NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}'
      ) STRICT;
    `);

    const now = new Date().toISOString();
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      1,
      now,
    );
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      2,
      now,
    );
  }

  ping(): StorageHealth {
    const result = this.ctx.storage.sql.exec<{ value: number }>("SELECT 1 AS value").one();
    if (result.value !== 1) throw new Error("SQLite health query returned an unexpected result");
    return { storage: "ok" };
  }

  /** Retained for the v1 storage migration test and health diagnostics. */
  getOrCreateRun(runId: string): RunMetadata {
    const normalizedRunId = runId.trim();
    if (normalizedRunId.length === 0) throw new Error("A run identifier is required");
    const createdAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO run_metadata (singleton, run_id, created_at, schema_version)
       VALUES (1, ?, ?, ?)`,
      normalizedRunId,
      createdAt,
      SCHEMA_VERSION,
    );
    const row = this.metadataRow();
    if (row?.run_id !== normalizedRunId) {
      throw new Error("Durable Object is already assigned to a different run");
    }
    return this.publicMetadata(row);
  }

  async initializeRun(initialization: RunInitialization): Promise<RunResult<RunSummary>> {
    if (this.metadataRow()) {
      return this.failure(409, "run_exists", "This Durable Object is already assigned to a run.");
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO run_metadata (singleton, run_id, created_at, schema_version)
         VALUES (1, ?, ?, ?)`,
        initialization.runId,
        initialization.createdAt,
        SCHEMA_VERSION,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO run_security
          (singleton, expires_at, control_token_hash, client_id, client_secret_hash, resource)
         VALUES (1, ?, ?, ?, ?, ?)`,
        initialization.expiresAt,
        initialization.controlTokenHash,
        initialization.clientId,
        initialization.clientSecretHash,
        initialization.resource,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO scenario_config (singleton, scenario_json) VALUES (1, ?)",
        JSON.stringify(DEFAULT_SCENARIO),
      );
      this.recordEvent("run.created", "createRun", initialization.runId, 201);
    });
    await this.ctx.storage.setAlarm(new Date(initialization.expiresAt).getTime());
    console.log(
      JSON.stringify({ event: "ccv2.run.created", runId: initialization.runId, status: 201 }),
    );
    return { ok: true, value: this.summary() };
  }

  async getRun(controlTokenHash: string): Promise<RunResult<RunSummary>> {
    const authorization = await this.authorizeControl(controlTokenHash);
    if (!authorization.ok) return authorization;
    return { ok: true, value: this.summary() };
  }

  async getActiveRun(): Promise<RunResult<{ runId: string; resource: string }>> {
    const active = await this.activeRows();
    if (!active.ok) return active;
    return {
      ok: true,
      value: { runId: active.value.metadata.run_id, resource: active.value.security.resource },
    };
  }

  async verifyClientCredentials(
    clientId: string,
    clientSecretHash: string,
    resource: string,
  ): Promise<RunResult<{ runId: string; resource: string }>> {
    const active = await this.activeRows();
    if (!active.ok)
      return this.failure(401, "invalid_client", "The client credentials are invalid.");
    const valid =
      timingSafeTextEqual(clientId, active.value.security.client_id) &&
      timingSafeTextEqual(clientSecretHash, active.value.security.client_secret_hash) &&
      timingSafeTextEqual(resource, active.value.security.resource);
    if (!valid) return this.failure(401, "invalid_client", "The client credentials are invalid.");
    return {
      ok: true,
      value: { runId: active.value.metadata.run_id, resource: active.value.security.resource },
    };
  }

  async getScenario(controlTokenHash: string): Promise<RunResult<Scenario>> {
    const authorization = await this.authorizeControl(controlTokenHash);
    if (!authorization.ok) return authorization;
    return { ok: true, value: this.scenario() };
  }

  async setScenario(controlTokenHash: string, scenario: Scenario): Promise<RunResult<Scenario>> {
    const authorization = await this.authorizeControl(controlTokenHash);
    if (!authorization.ok) return authorization;
    this.ctx.storage.sql.exec(
      `INSERT INTO scenario_config (singleton, scenario_json) VALUES (1, ?)
       ON CONFLICT(singleton) DO UPDATE SET scenario_json = excluded.scenario_json`,
      JSON.stringify(scenario),
    );
    this.ctx.storage.sql.exec("DELETE FROM operation_counters");
    this.recordEvent("scenario.updated", "updateScenario", "", 200);
    return { ok: true, value: scenario };
  }

  async getState(controlTokenHash: string): Promise<RunResult<RunState>> {
    const authorization = await this.authorizeControl(controlTokenHash);
    if (!authorization.ok) return authorization;
    const count = (table: "builds" | "deployments" | "resources" | "request_events"): number =>
      this.ctx.storage.sql.exec<CountRow>(`SELECT COUNT(*) AS count FROM ${table}`).one().count;
    const pollCounters: Record<string, number> = {};
    for (const row of this.ctx.storage.sql
      .exec<CounterRow>(
        `SELECT 'getBuildProgress' AS operation_id, code AS resource_id, poll_count AS call_count
         FROM builds WHERE poll_count > 0
         UNION ALL
         SELECT 'getDeploymentProgress', code, poll_count FROM deployments WHERE poll_count > 0`,
      )
      .toArray()) {
      pollCounters[`${row.operation_id}:${row.resource_id}`] = row.call_count;
    }
    const faultCounters: Record<string, number> = {};
    for (const row of this.ctx.storage.sql
      .exec<CounterRow>(
        "SELECT operation_id, resource_id, call_count FROM operation_counters ORDER BY operation_id, resource_id",
      )
      .toArray()) {
      faultCounters[`${row.operation_id}:${row.resource_id}`] = row.call_count;
    }
    return {
      ok: true,
      value: {
        ...this.summary(),
        counts: {
          builds: count("builds"),
          deployments: count("deployments"),
          resources: count("resources"),
          events: count("request_events"),
        },
        pollCounters,
        faultCounters,
      },
    };
  }

  async reset(controlTokenHash: string): Promise<RunResult<RunSummary>> {
    const authorization = await this.authorizeControl(controlTokenHash);
    if (!authorization.ok) return authorization;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM builds");
      this.ctx.storage.sql.exec("DELETE FROM deployments");
      this.ctx.storage.sql.exec("DELETE FROM resources");
      this.ctx.storage.sql.exec("DELETE FROM operation_counters");
      this.ctx.storage.sql.exec("DELETE FROM request_events");
      this.ctx.storage.sql.exec(
        "UPDATE scenario_config SET scenario_json = ? WHERE singleton = 1",
        JSON.stringify(DEFAULT_SCENARIO),
      );
      this.recordEvent("run.reset", "resetRun", "", 200);
    });
    return { ok: true, value: this.summary() };
  }

  async deleteRun(controlTokenHash: string): Promise<RunResult<null>> {
    const authorization = await this.authorizeControl(controlTokenHash);
    if (!authorization.ok) return authorization;
    const runId = authorization.value.metadata.run_id;
    console.log(JSON.stringify({ event: "ccv2.run.deleted", runId, status: 204 }));
    await this.ctx.storage.deleteAll();
    this.migrateSchema();
    return { ok: true, value: null };
  }

  consumeFault(operationId: string, resourceIdentifier = ""): OperationFault | null {
    const current = this.scenario();
    const applicable = current.faults.filter(
      (fault) =>
        fault.operationId === operationId &&
        (fault.resourceIdentifier === undefined || fault.resourceIdentifier === resourceIdentifier),
    );
    if (applicable.length === 0) return null;
    this.ctx.storage.sql.exec(
      `INSERT INTO operation_counters (operation_id, resource_id, call_count) VALUES (?, ?, 1)
       ON CONFLICT(operation_id, resource_id) DO UPDATE SET call_count = call_count + 1`,
      operationId,
      resourceIdentifier,
    );
    const call = this.ctx.storage.sql
      .exec<CountRow>(
        "SELECT call_count AS count FROM operation_counters WHERE operation_id = ? AND resource_id = ?",
        operationId,
        resourceIdentifier,
      )
      .one().count;
    const fault = applicable.find((candidate) => candidate.onCalls.includes(call));
    if (!fault) return null;
    this.recordEvent("scenario.fault", operationId, resourceIdentifier, fault.status, { call });
    console.log(
      JSON.stringify({
        event: "ccv2.scenario.fault",
        runId: this.metadataRow()?.run_id,
        operationId,
        resourceIdentifier,
        status: fault.status,
        call,
      }),
    );
    const result: OperationFault = {
      status: fault.status,
      title: fault.title ?? "Simulated API error",
      detail: fault.detail ?? `A configured fault was triggered for ${operationId}.`,
    };
    if (fault.retryAfterSeconds !== undefined) result.retryAfterSeconds = fault.retryAfterSeconds;
    return result;
  }

  override async alarm(): Promise<void> {
    const runId = this.metadataRow()?.run_id;
    if (runId) console.log(JSON.stringify({ event: "ccv2.run.expired", runId, status: 204 }));
    await this.ctx.storage.deleteAll();
    this.migrateSchema();
  }

  private async authorizeControl(
    controlTokenHash: string,
  ): Promise<RunResult<{ metadata: RunMetadataRow; security: RunSecurityRow }>> {
    const active = await this.activeRows();
    if (!active.ok) return active;
    if (!timingSafeTextEqual(controlTokenHash, active.value.security.control_token_hash)) {
      return this.failure(403, "forbidden", "The control token does not authorize this run.");
    }
    return active;
  }

  private async activeRows(): Promise<
    RunResult<{ metadata: RunMetadataRow; security: RunSecurityRow }>
  > {
    const metadata = this.metadataRow();
    const security = this.securityRow();
    if (!metadata || !security) return this.failure(404, "run_not_found", "The run was not found.");
    if (Date.parse(security.expires_at) <= Date.now()) {
      await this.ctx.storage.deleteAll();
      this.migrateSchema();
      return this.failure(404, "run_not_found", "The run was not found.");
    }
    return { ok: true, value: { metadata, security } };
  }

  private metadataRow(): RunMetadataRow | undefined {
    return this.ctx.storage.sql
      .exec<RunMetadataRow>(
        "SELECT run_id, created_at, schema_version FROM run_metadata WHERE singleton = 1",
      )
      .toArray()[0];
  }

  private securityRow(): RunSecurityRow | undefined {
    return this.ctx.storage.sql
      .exec<RunSecurityRow>(
        `SELECT expires_at, control_token_hash, client_id, client_secret_hash, resource
         FROM run_security WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private scenario(): Scenario {
    const row = this.ctx.storage.sql
      .exec<ScenarioRow>("SELECT scenario_json FROM scenario_config WHERE singleton = 1")
      .toArray()[0];
    return row ? (JSON.parse(row.scenario_json) as Scenario) : DEFAULT_SCENARIO;
  }

  private summary(): RunSummary {
    const metadata = this.metadataRow();
    const security = this.securityRow();
    if (!metadata || !security) throw new Error("The run metadata is incomplete");
    return {
      ...this.publicMetadata(metadata),
      expiresAt: security.expires_at,
      scenario: this.scenario(),
    };
  }

  private publicMetadata(row: RunMetadataRow): RunMetadata {
    return { runId: row.run_id, createdAt: row.created_at, schemaVersion: row.schema_version };
  }

  private recordEvent(
    eventType: string,
    operationId: string,
    resourceId: string,
    status: number,
    detail: Record<string, unknown> = {},
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO request_events
        (created_at, event_type, operation_id, resource_id, status, detail_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      new Date().toISOString(),
      eventType,
      operationId,
      resourceId,
      status,
      JSON.stringify(detail),
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM request_events WHERE id NOT IN
       (SELECT id FROM request_events ORDER BY id DESC LIMIT ?)`,
      MAX_EVENTS,
    );
  }

  private failure<T>(
    status: 400 | 401 | 403 | 404 | 409 | 412 | 423 | 429 | 500,
    code: string,
    message: string,
  ): RunResult<T> {
    return { ok: false, status, code, message };
  }
}
