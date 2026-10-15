import { env, exports as worker } from "cloudflare:workers";
import { importPKCS8, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { createRun, issueToken, sapHeaders } from "./helpers";

const builds = "https://example.com/v2/subscriptions/SUBSCRIPTION_001/builds";

async function customToken(runId: string, audience: string, expiration: number): Promise<string> {
  const key = await importPKCS8(env.MOCK_JWT_PRIVATE_KEY, "RS256");
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ run_id: runId })
    .setProtectedHeader({ alg: "RS256", kid: env.MOCK_JWT_KID })
    .setIssuer(env.MOCK_JWT_ISSUER)
    .setAudience(audience)
    .setSubject(runId)
    .setIssuedAt(now - 100)
    .setExpirationTime(expiration)
    .sign(key);
}

describe("authentication and abuse boundaries", () => {
  it("rejects invalid signatures, expiration, audience, and run-correlation mismatches", async () => {
    const first = await createRun();
    const second = await createRun();
    const valid = await issueToken(first);
    const parts = valid.split(".");
    const header = parts[0];
    const payload = parts[1];
    const signature = parts[2] ?? "";
    if (!header || !payload || !signature) throw new Error("Issued token is malformed");
    const corrupted = `${header}.${payload}.${signature.slice(0, -2)}aa`;
    expect((await worker.default.fetch(builds, { headers: sapHeaders(corrupted) })).status).toBe(
      401,
    );

    const now = Math.floor(Date.now() / 1_000);
    const expired = await customToken(first.runId, first.credentials.resource, now - 1);
    expect((await worker.default.fetch(builds, { headers: sapHeaders(expired) })).status).toBe(401);
    const wrongAudience = await customToken(first.runId, second.credentials.resource, now + 600);
    expect(
      (await worker.default.fetch(builds, { headers: sapHeaders(wrongAudience) })).status,
    ).toBe(401);
    const mismatch = await worker.default.fetch(builds, {
      headers: { ...sapHeaders(valid), "x-sandbox-run-id": second.runId },
    });
    expect(mismatch.status).toBe(403);
    const overlong = await worker.default.fetch(`${builds}/${"x".repeat(300)}`, {
      headers: sapHeaders(valid),
    });
    expect(overlong.status).toBe(400);
  });

  it("serializes concurrent build creation into unique persistent resources", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        worker.default.fetch(builds, {
          method: "POST",
          headers: { ...sapHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            branch: `branch-${String(index)}`,
            name: `build-${String(index)}`,
          }),
        }),
      ),
    );
    expect(responses.every(({ status }) => status === 201)).toBe(true);
    const codes = await Promise.all(responses.map((response) => response.json<{ code: string }>()));
    expect(new Set(codes.map(({ code }) => code)).size).toBe(10);
    const listing = await worker.default.fetch(builds, { headers: sapHeaders(token) });
    await expect(listing.json()).resolves.toMatchObject({ count: 10 });
  });

  it("uses the Cloudflare rate-limit binding for anonymous run creation", async () => {
    const responses = [];
    for (let request = 0; request < 31; request += 1) {
      responses.push(
        await worker.default.fetch("https://example.com/sandbox/v1/runs", {
          method: "POST",
          headers: { "CF-Connecting-IP": "198.51.100.254" },
        }),
      );
    }
    expect(responses.slice(0, 30).every(({ status }) => status === 201)).toBe(true);
    expect(responses[30]?.status).toBe(429);
  });
});
