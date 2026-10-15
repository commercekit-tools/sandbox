import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { Ccv2Run } from "../src/durable-objects/ccv2-run";

describe("Ccv2Run Durable Object", () => {
  it("provides its binding and executes SQLite queries", async () => {
    expect(env.CCV2_RUN).toBeDefined();

    const stub = env.CCV2_RUN.getByName("sqlite-health-test");
    await expect(stub.ping()).resolves.toEqual({ storage: "ok" });

    await runInDurableObject(stub, (instance: Ccv2Run, state) => {
      expect(instance).toBeInstanceOf(Ccv2Run);
      const table = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_metadata'",
        )
        .one();

      expect(table.name).toBe("run_metadata");
      expect(state.storage.sql.databaseSize).toBeGreaterThan(0);
    });
  });

  it("persists metadata across repeated calls for a deterministic run ID", async () => {
    const firstStub = env.CCV2_RUN.getByName("run-persistence-test");
    const secondStub = env.CCV2_RUN.getByName("run-persistence-test");

    expect(firstStub.id.equals(secondStub.id)).toBe(true);

    const first = await firstStub.getOrCreateRun("run-persistence-test");
    const second = await secondStub.getOrCreateRun("run-persistence-test");

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      runId: "run-persistence-test",
      schemaVersion: 2,
    });
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
  });

  it("isolates metadata for separate run IDs", async () => {
    const firstStub = env.CCV2_RUN.getByName("run-isolation-a");
    const secondStub = env.CCV2_RUN.getByName("run-isolation-b");

    expect(firstStub.id.equals(secondStub.id)).toBe(false);

    const first = await firstStub.getOrCreateRun("run-isolation-a");
    const second = await secondStub.getOrCreateRun("run-isolation-b");

    expect(first.runId).toBe("run-isolation-a");
    expect(second.runId).toBe("run-isolation-b");
  });

  it("preserves metadata after object eviction", async () => {
    const stub = env.CCV2_RUN.getByName("run-eviction-test");
    const beforeEviction = await stub.getOrCreateRun("run-eviction-test");

    await evictDurableObject(stub);

    const afterEviction = await stub.getOrCreateRun("run-eviction-test");
    expect(afterEviction).toEqual(beforeEviction);
  });

  it("preserves version 1 metadata while adding versioned schema tables", async () => {
    const stub = env.CCV2_RUN.getByName("run-schema-upgrade-test");
    await runInDurableObject(stub, (_instance: Ccv2Run, state) => {
      state.storage.sql.exec(
        `INSERT INTO run_metadata (singleton, run_id, created_at, schema_version)
         VALUES (1, 'run-schema-upgrade-test', '2026-01-01T00:00:00.000Z', 1)`,
      );
    });
    await evictDurableObject(stub);
    const metadata = await stub.getOrCreateRun("run-schema-upgrade-test");
    expect(metadata).toEqual({
      runId: "run-schema-upgrade-test",
      createdAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    });
    await runInDurableObject(stub, (_instance: Ccv2Run, state) => {
      const migrations = state.storage.sql
        .exec<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version")
        .toArray();
      expect(migrations.map(({ version }) => version)).toEqual([1, 2]);
    });
  });
});
