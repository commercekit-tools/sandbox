import { DurableObject } from "cloudflare:workers";

const SCHEMA_VERSION = 1;

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

export class Ccv2Run extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS run_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        run_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        schema_version INTEGER NOT NULL
      ) STRICT
    `);
  }

  ping(): StorageHealth {
    const result = this.ctx.storage.sql.exec<{ value: number }>("SELECT 1 AS value").one();

    if (result.value !== 1) {
      throw new Error("SQLite health query returned an unexpected result");
    }

    return { storage: "ok" };
  }

  getOrCreateRun(runId: string): RunMetadata {
    const normalizedRunId = runId.trim();
    if (normalizedRunId.length === 0) {
      throw new Error("A run identifier is required");
    }

    const createdAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO run_metadata (singleton, run_id, created_at, schema_version)
       VALUES (1, ?, ?, ?)`,
      normalizedRunId,
      createdAt,
      SCHEMA_VERSION,
    );

    const row = this.ctx.storage.sql
      .exec<RunMetadataRow>(
        `SELECT run_id, created_at, schema_version
         FROM run_metadata
         WHERE singleton = 1`,
      )
      .one();

    if (row.run_id !== normalizedRunId) {
      throw new Error("Durable Object is already assigned to a different run");
    }

    return {
      runId: row.run_id,
      createdAt: row.created_at,
      schemaVersion: row.schema_version,
    };
  }
}
