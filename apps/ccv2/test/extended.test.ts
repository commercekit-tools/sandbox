import { exports as worker } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createRun, issueToken, sapHeaders } from "./helpers";

const subscription = "https://example.com/v2/subscriptions/SUBSCRIPTION_001";

function jsonRequest(token: string, method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { ...sapHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("extended SAP-compatible API families", () => {
  it("lists realistic environments and requires authentication", async () => {
    expect((await worker.default.fetch(`${subscription}/environments`)).status).toBe(401);
    const run = await createRun();
    const token = await issueToken(run);
    const response = await worker.default.fetch(`${subscription}/environments`, {
      headers: sapHeaders(token),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      count: 3,
      value: [
        { code: "d1", type: "DEVELOPMENT" },
        { code: "s1", type: "STAGING" },
        { code: "p1", type: "PRODUCTION" },
      ],
    });
  });

  it("persists endpoint create, update, list, detail, and delete operations in one run", async () => {
    const first = await createRun();
    const second = await createRun();
    const firstToken = await issueToken(first);
    const secondToken = await issueToken(second);
    const root = `${subscription}/environments/d1/endpoints`;
    const creation = await worker.default.fetch(
      root,
      jsonRequest(firstToken, "POST", {
        code: "storefront",
        name: "Storefront",
        domainName: "storefront.sandbox.invalid",
        protocol: "HTTPS",
        k8sService: "commerce",
        k8sServiceVersion: "BLUE",
        access: "ALLOW_ALL",
      }),
    );
    expect(creation.status).toBe(201);
    await expect(creation.json()).resolves.toMatchObject({
      code: "storefront",
      maintenanceMode: false,
    });

    const update = await worker.default.fetch(
      `${root}/storefront`,
      jsonRequest(firstToken, "PATCH", { maintenanceMode: true, priority: 10 }),
    );
    await expect(update.json()).resolves.toMatchObject({ maintenanceMode: true, priority: 10 });
    const list = await worker.default.fetch(`${root}?service=commerce`, {
      headers: sapHeaders(firstToken),
    });
    await expect(list.json()).resolves.toMatchObject({ count: 1, value: [{ code: "storefront" }] });

    const isolated = await worker.default.fetch(`${root}/storefront`, {
      headers: sapHeaders(secondToken),
    });
    expect(isolated.status).toBe(404);
    const deletion = await worker.default.fetch(`${root}/storefront`, {
      method: "DELETE",
      headers: sapHeaders(firstToken),
    });
    expect(deletion.status).toBe(204);
    expect(
      (await worker.default.fetch(`${root}/storefront`, { headers: sapHeaders(firstToken) }))
        .status,
    ).toBe(404);
  });

  it("creates synthetic backups and restores with referential checks", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const backups = `${subscription}/environments/d1/databackups`;
    const backupResponse = await worker.default.fetch(
      backups,
      jsonRequest(token, "POST", { description: "Before release", databackupType: "MANUAL" }),
    );
    expect(backupResponse.status).toBe(201);
    const backup = await backupResponse.json<{ databackupCode: string }>();
    const detail = await worker.default.fetch(`${backups}/${backup.databackupCode}`, {
      headers: sapHeaders(token),
    });
    await expect(detail.json()).resolves.toMatchObject({
      status: "COMPLETED",
      canBeRestored: true,
      description: "Before release",
    });
    const cancelCompleted = await worker.default.fetch(
      `${backups}/${backup.databackupCode}/state`,
      jsonRequest(token, "PUT", { action: "CANCEL" }),
    );
    expect(cancelCompleted.status).toBe(409);

    const restores = `${subscription}/environments/s1/datarestores`;
    const restoreResponse = await worker.default.fetch(
      restores,
      jsonRequest(token, "POST", {
        databackupCode: backup.databackupCode,
        sourceEnvironmentCode: "d1",
      }),
    );
    expect(restoreResponse.status).toBe(201);
    const restore = await restoreResponse.json<{ datarestoreCode: string }>();
    const restoreDetail = await worker.default.fetch(`${restores}/${restore.datarestoreCode}`, {
      headers: sapHeaders(token),
    });
    await expect(restoreDetail.json()).resolves.toMatchObject({
      status: "COMPLETED",
      databackupCode: backup.databackupCode,
    });
    const missing = await worker.default.fetch(
      restores,
      jsonRequest(token, "POST", { databackupCode: "missing", sourceEnvironmentCode: "d1" }),
    );
    expect(missing.status).toBe(404);
    expect(
      (
        await worker.default.fetch(`${backups}/${backup.databackupCode}`, {
          method: "DELETE",
          headers: sapHeaders(token),
        })
      ).status,
    ).toBe(204);
  });

  it("returns scaling capabilities and persists validated scaling changes", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const root = `${subscription}/environments/d1`;
    const initial = await worker.default.fetch(`${root}/scaling`, { headers: sapHeaders(token) });
    await expect(initial.json()).resolves.toMatchObject({
      hibernated: false,
      environmentCode: "d1",
    });
    const update = await worker.default.fetch(
      `${root}/scaling`,
      jsonRequest(token, "PATCH", {
        hibernated: true,
        services: [{ code: "backgroundProcessing", replicas: 3 }],
      }),
    );
    await expect(update.json()).resolves.toMatchObject({
      hibernated: true,
      services: [{ code: "backgroundProcessing", replicas: 3 }],
    });
    const options = await worker.default.fetch(`${root}/scalingOptions`, {
      headers: sapHeaders(token),
    });
    expect(options.status).toBe(200);
    const invalid = await worker.default.fetch(
      `${root}/scaling`,
      jsonRequest(token, "PATCH", { services: [{ code: "commerce", replicas: 100 }] }),
    );
    expect(invalid.status).toBe(400);
  });

  it("creates, reschedules, and cancels scheduled activities", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const root = `${subscription}/environments/d1/scheduledactivities`;
    const creation = await worker.default.fetch(
      root,
      jsonRequest(token, "POST", {
        activityType: "DEPLOYMENT",
        scheduledTimestamp: "2027-01-01T12:00:00.000Z",
      }),
    );
    expect(creation.status).toBe(201);
    const activity = await creation.json<{ code: string }>();
    const update = await worker.default.fetch(
      `${root}/${activity.code}`,
      jsonRequest(token, "PATCH", { scheduledTimestamp: "2027-01-02T12:00:00.000Z" }),
    );
    await expect(update.json()).resolves.toMatchObject({
      scheduledTimestamp: "2027-01-02T12:00:00.000Z",
    });
    const cancellation = await worker.default.fetch(`${root}/${activity.code}/cancel`, {
      method: "POST",
      headers: sapHeaders(token),
    });
    await expect(cancellation.json()).resolves.toMatchObject({
      status: "CANCELED",
      cancelable: false,
    });
    const listing = await worker.default.fetch(root, { headers: sapHeaders(token) });
    await expect(listing.json()).resolves.toMatchObject({ count: 1 });
  });

  it("reads and updates service properties", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const url = `${subscription}/environments/d1/services/commerce/properties/catalog`;
    const initial = await worker.default.fetch(url, { headers: sapHeaders(token) });
    await expect(initial.json()).resolves.toEqual({
      key: "catalog",
      value: { catalogId: "electronics" },
      flags: ["EDITABLE"],
    });
    const update = await worker.default.fetch(
      url,
      jsonRequest(token, "PUT", {
        key: "catalog",
        value: { catalogId: "apparel" },
        flags: ["EDITABLE"],
      }),
    );
    expect(update.status).toBe(200);
    const read = await worker.default.fetch(url, { headers: sapHeaders(token) });
    await expect(read.json()).resolves.toMatchObject({ value: { catalogId: "apparel" } });
    expect(
      (
        await worker.default.fetch(
          url,
          jsonRequest(token, "PUT", { key: "other", value: { enabled: true } }),
        )
      ).status,
    ).toBe(400);
  });

  it("stores only synthetic certificate metadata and never returns private keys", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const root = `${subscription}/certificates`;
    const creation = await worker.default.fetch(
      root,
      jsonRequest(token, "POST", {
        name: "Sandbox TLS",
        certificate: "-----BEGIN CERTIFICATE-----\nSYNTHETIC\n-----END CERTIFICATE-----",
        certificateKey: "PRIVATE-SYNTHETIC-KEY-MATERIAL",
        description: "Test certificate",
      }),
    );
    expect(creation.status).toBe(201);
    const text = await creation.text();
    expect(text).not.toContain("PRIVATE-SYNTHETIC-KEY-MATERIAL");
    const certificate = JSON.parse(text) as { code: string };
    const listing = await worker.default.fetch(root, { headers: sapHeaders(token) });
    const listingText = await listing.text();
    expect(listingText).not.toContain("PRIVATE-SYNTHETIC-KEY-MATERIAL");
    expect(JSON.parse(listingText)).toMatchObject({ count: 1 });
    expect(
      (
        await worker.default.fetch(`${root}/${certificate.code}`, {
          method: "DELETE",
          headers: sapHeaders(token),
        })
      ).status,
    ).toBe(204);
  });

  it("persists role assignments and validates their environment scope", async () => {
    const run = await createRun();
    const token = await issueToken(run);
    const root = `${subscription}/userroleassignments`;
    const roles = await worker.default.fetch(`${subscription}/roles`, {
      headers: sapHeaders(token),
    });
    await expect(roles.json()).resolves.toEqual(expect.arrayContaining(["ROLE_VIEWER"]));
    const creation = await worker.default.fetch(
      root,
      jsonRequest(token, "POST", {
        username: "developer@example.invalid",
        email: "developer@example.invalid",
        role: "ROLE_OPERATOR",
        environments: ["d1"],
      }),
    );
    expect(creation.status).toBe(201);
    const update = await worker.default.fetch(
      root,
      jsonRequest(token, "PATCH", {
        username: "developer@example.invalid",
        role: "ROLE_OPERATOR",
        environments: ["d1", "s1"],
      }),
    );
    await expect(update.json()).resolves.toMatchObject({ environments: ["d1", "s1"] });
    const list = await worker.default.fetch(root, { headers: sapHeaders(token) });
    await expect(list.json()).resolves.toMatchObject({
      items: [{ username: "developer@example.invalid" }],
    });
    expect(
      (
        await worker.default.fetch(
          root,
          jsonRequest(token, "POST", {
            username: "bad",
            role: "ROLE_VIEWER",
            environments: ["missing"],
          }),
        )
      ).status,
    ).toBe(400);
    const deletion = await worker.default.fetch(
      root,
      jsonRequest(token, "DELETE", {
        username: "developer@example.invalid",
        role: "ROLE_OPERATOR",
      }),
    );
    expect(deletion.status).toBe(204);
  });
});
