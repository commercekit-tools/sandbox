import { exports as worker } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_CODE } from "../src/domain/fixtures";
import { controlHeaders, createRun, issueToken, sapHeaders } from "./helpers";

const base = `https://example.com/v2/subscriptions/${SUBSCRIPTION_CODE}/builds`;
const build = (code: string, overrides: Record<string, unknown> = {}) => ({
  code,
  subscriptionCode: SUBSCRIPTION_CODE,
  applicationCode: "commerce",
  status: "SUCCESS",
  buildStartTimestamp: "2020-01-01T00:00:00.000Z",
  buildEndTimestamp: "2020-01-01T01:00:00.000Z",
  deployed: false,
  hasSnapshot: false,
  ...overrides,
});

describe("cleanup control fixtures", () => {
  it("seeds isolated paginated production-shaped records; initiation retains the deleted record", async () => {
    const run = await createRun();
    try {
      const fixture = await worker.default.fetch(
        `https://example.com/sandbox/v1/runs/${run.runId}/cleanup-fixture`,
        {
          method: "PUT",
          headers: { ...controlHeaders(run), "Content-Type": "application/json" },
          body: JSON.stringify({
            builds: Array.from({ length: 105 }, (_, index) => ({
              code: `b${index}`,
              response: build(`b${index}`),
            })),
          }),
        },
      );
      expect(fixture.status).toBe(200);
      const headers = sapHeaders(await issueToken(run));
      const first = await worker.default.fetch(`${base}?$top=100&$skip=0`, { headers });
      const firstBody = await first.json<{ count: number; value: unknown[] }>();
      expect(firstBody.count).toBe(105);
      expect(firstBody.value).toHaveLength(100);
      const second = await worker.default.fetch(`${base}?$top=100&$skip=100`, { headers });
      expect((await second.json<{ value: unknown[] }>()).value).toHaveLength(5);
      const accepted = await worker.default.fetch(`${base}/b0`, { method: "DELETE", headers });
      expect(accepted.status).toBe(204);
      expect(await accepted.text()).toBe("");
      const retained = await worker.default.fetch(`${base}/b0`, { headers });
      await expect(retained.json()).resolves.toMatchObject({ code: "b0", status: "DELETED" });
      const state = await worker.default.fetch(
        `https://example.com/sandbox/v1/runs/${run.runId}/state`,
        { headers: controlHeaders(run) },
      );
      expect(
        (await state.json<{ faultCounters: Record<string, number> }>()).faultCounters[
          "deleteBuild:b0"
        ],
      ).toBe(1);
    } finally {
      expect(
        (
          await worker.default.fetch(`https://example.com/sandbox/v1/runs/${run.runId}`, {
            method: "DELETE",
            headers: controlHeaders(run),
          })
        ).status,
      ).toBe(204);
    }
  });

  it("models safety races, internal modification and accepted ambiguous responses without leaking simulation fields", async () => {
    const run = await createRun();
    try {
      const fixture = await worker.default.fetch(
        `https://example.com/sandbox/v1/runs/${run.runId}/cleanup-fixture`,
        {
          method: "PUT",
          headers: { ...controlHeaders(run), "Content-Type": "application/json" },
          body: JSON.stringify({
            builds: [
              { code: "race", response: build("race") },
              { code: "recent", response: build("recent"), modifiedAt: new Date().toISOString() },
              { code: "ambiguous", response: build("ambiguous") },
              { code: "snapshot", response: build("snapshot", { hasSnapshot: true }) },
              { code: "unknown", response: build("unknown", { status: "UNKNOWN" }) },
            ],
            changes: [
              { operationId: "getBuild", onCall: 1, buildCode: "race", patch: { deployed: true } },
            ],
            loseDeleteResponse: ["ambiguous"],
          }),
        },
      );
      expect(fixture.status).toBe(200);
      const headers = sapHeaders(await issueToken(run));
      const raced = await worker.default.fetch(`${base}/race`, { headers });
      await expect(raced.json()).resolves.toMatchObject({ deployed: true });
      for (const code of ["race", "recent", "snapshot", "unknown"]) {
        expect(
          (await worker.default.fetch(`${base}/${code}`, { method: "DELETE", headers })).status,
        ).toBe(409);
      }
      const recent = await worker.default.fetch(`${base}/recent`, { headers });
      expect(await recent.json()).not.toHaveProperty("modifiedAt");
      expect(
        (await worker.default.fetch(`${base}/ambiguous`, { method: "DELETE", headers })).status,
      ).toBe(500);
      const accepted = await worker.default.fetch(`${base}/ambiguous`, { headers });
      await expect(accepted.json()).resolves.toMatchObject({ status: "DELETED" });
      const other = await createRun();
      try {
        const isolated = await worker.default.fetch(base, {
          headers: sapHeaders(await issueToken(other)),
        });
        await expect(isolated.json()).resolves.toMatchObject({ count: 0, value: [] });
      } finally {
        await worker.default.fetch(`https://example.com/sandbox/v1/runs/${other.runId}`, {
          method: "DELETE",
          headers: controlHeaders(other),
        });
      }
    } finally {
      await worker.default.fetch(`https://example.com/sandbox/v1/runs/${run.runId}`, {
        method: "DELETE",
        headers: controlHeaders(run),
      });
    }
  });

  it("requires control authorization and rejects duplicate fixture keys", async () => {
    const run = await createRun();
    try {
      const url = `https://example.com/sandbox/v1/runs/${run.runId}/cleanup-fixture`;
      expect((await worker.default.fetch(url, { method: "PUT" })).status).toBe(401);
      expect(
        (
          await worker.default.fetch(url, {
            method: "PUT",
            headers: { ...controlHeaders(run), "Content-Type": "application/json" },
            body: JSON.stringify({
              builds: [
                { code: "b", response: build("b") },
                { code: "b", response: build("b") },
              ],
            }),
          })
        ).status,
      ).toBe(400);
    } finally {
      await worker.default.fetch(`https://example.com/sandbox/v1/runs/${run.runId}`, {
        method: "DELETE",
        headers: controlHeaders(run),
      });
    }
  });
});
