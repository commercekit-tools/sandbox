import { Hono, type Context } from "hono";
import { ZodError, type ZodType } from "zod";

import { environmentExists } from "../domain/fixtures";
import {
  backupStateSchema,
  createCertificateSchema,
  createDatabackupSchema,
  createDatarestoreSchema,
  createEndpointSchema,
  createRoleAssignmentSchema,
  createScheduledActivitySchema,
  deleteRoleAssignmentSchema,
  scalingUpdateSchema,
  servicePropertySchema,
  updateEndpointSchema,
  updateRoleAssignmentSchema,
  updateScheduledActivitySchema,
} from "../domain/extended";
import { jsonResponse, readJsonBody, RequestProblem, vendorProblem } from "../http";
import type { AppEnvironment } from "../types";
import { vendorError, zodDetail } from "./vendor-helpers";

export const extendedRoutes = new Hono<AppEnvironment>();

async function validatedBody<T>(context: Context<AppEnvironment>, schema: ZodType<T>): Promise<T> {
  return schema.parse(await readJsonBody(context));
}

function bodyError(error: unknown): Response | undefined {
  if (error instanceof RequestProblem)
    return vendorProblem(error.status, "Bad Request", error.message);
  if (error instanceof ZodError) return vendorProblem(400, "Bad Request", zodDetail(error));
  return undefined;
}

function parseStored(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function page<T>(url: URL, values: T[]): { value: T[]; count: number } {
  const parseInteger = (name: string, fallback: number, maximum: number): number => {
    const raw = url.searchParams.get(name);
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
      throw new Error(`${name} must be an integer from 0 to ${String(maximum)}.`);
    }
    return parsed;
  };
  const top = parseInteger("$top", 100, 100);
  const skip = parseInteger("$skip", 0, 100_000);
  return { value: values.slice(skip, skip + top), count: values.length };
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

extendedRoutes.get("/v2/subscriptions/:subscriptionCode/environments", async (context) => {
  const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getEnvironments(
    context.req.param("subscriptionCode"),
  );
  if (!result.ok) return vendorError(result);
  try {
    return jsonResponse(page(new URL(context.req.url), result.value.value));
  } catch (error) {
    return vendorProblem(
      400,
      "Bad Request",
      error instanceof Error ? error.message : "Invalid query.",
    );
  }
});

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/endpoints",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).listResources(
      "getEndpoints",
      "endpoint",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
    );
    if (!result.ok) return vendorError(result);
    try {
      const url = new URL(context.req.url);
      let values = result.value.values.map((value) => parseStored(value));
      const webProxy = url.searchParams.get("webProxy");
      const service = url.searchParams.get("service");
      if (webProxy) values = values.filter((value) => value.webProxy === webProxy);
      if (service) values = values.filter((value) => value.k8sService === service);
      return jsonResponse(page(url, values));
    } catch (error) {
      return vendorProblem(
        400,
        "Bad Request",
        error instanceof Error ? error.message : "Invalid query.",
      );
    }
  },
);

extendedRoutes.post(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/endpoints",
  async (context) => {
    try {
      const request = await validatedBody(context, createEndpointSchema);
      const { code = "", ...state } = request;
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).createResource(
        "createEndpoint",
        "endpoint",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        "endpoint",
        "code",
        code,
        JSON.stringify({ ...state, maintenanceMode: state.maintenanceMode ?? false }),
      );
      return result.ok ? jsonResponse(parseStored(result.value), 201) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/endpoints/:endpointCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
      "getEndpoint",
      "endpoint",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      context.req.param("endpointCode"),
    );
    return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
  },
);

extendedRoutes.patch(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/endpoints/:endpointCode",
  async (context) => {
    try {
      const request = await validatedBody(context, updateEndpointSchema);
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).patchResource(
        "updateEndpoint",
        "endpoint",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        context.req.param("endpointCode"),
        JSON.stringify(request),
      );
      return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.delete(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/endpoints/:endpointCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).deleteResource(
      "deleteEndpoint",
      "endpoint",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      context.req.param("endpointCode"),
    );
    return result.ok ? noContent() : vendorError(result);
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/databackups",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).listResources(
      "getDatabackups",
      "databackup",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
    );
    if (!result.ok) return vendorError(result);
    try {
      return jsonResponse(
        page(
          new URL(context.req.url),
          result.value.values.map((value) => parseStored(value)),
        ),
      );
    } catch (error) {
      return vendorProblem(
        400,
        "Bad Request",
        error instanceof Error ? error.message : "Invalid query.",
      );
    }
  },
);

extendedRoutes.post(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/databackups",
  async (context) => {
    try {
      const request = await validatedBody(context, createDatabackupSchema);
      const now = new Date().toISOString();
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).createResource(
        "createDatabackup",
        "databackup",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        "backup",
        "databackupCode",
        "",
        JSON.stringify({
          name: `Sandbox backup ${now}`,
          status: "COMPLETED",
          databackupType: request.databackupType ?? "MANUAL",
          databackupDbSupportType: "FULL",
          description: request.description ?? "Synthetic CommerceKit backup",
          createdBy: "sandbox-technical-user",
          createdTimestamp: now,
          canBeRestored: true,
          canBeDeleted: true,
          canBeCanceled: false,
          databackupContent: request.databackupContent ?? {
            databasesBackup: { included: true },
            storagesBackup: { included: true },
          },
        }),
      );
      if (!result.ok) return vendorError(result);
      const stored = parseStored(result.value);
      if (typeof stored.databackupCode !== "string") throw new Error("Stored backup is invalid");
      return jsonResponse(
        {
          databackupCode: stored.databackupCode,
          subscriptionCode: context.req.param("subscriptionCode"),
          environmentCode: context.req.param("environmentCode"),
        },
        201,
      );
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/databackups/:databackupCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
      "getDatabackup",
      "databackup",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      context.req.param("databackupCode"),
    );
    return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
  },
);

extendedRoutes.delete(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/databackups/:databackupCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).deleteResource(
      "deleteDatabackup",
      "databackup",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      context.req.param("databackupCode"),
    );
    return result.ok ? noContent() : vendorError(result);
  },
);

extendedRoutes.put(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/databackups/:databackupCode/state",
  async (context) => {
    try {
      await validatedBody(context, backupStateSchema);
      const existing = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
        "changeDatabackupState",
        "databackup",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        context.req.param("databackupCode"),
      );
      if (!existing.ok) return vendorError(existing);
      const state = parseStored(existing.value);
      if (state.canBeCanceled !== true) {
        return vendorProblem(409, "Conflict", "This completed backup cannot be canceled.");
      }
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).patchResource(
        "changeDatabackupState",
        "databackup",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        context.req.param("databackupCode"),
        JSON.stringify({ status: "CANCELED", canBeCanceled: false }),
      );
      return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/datarestores",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).listResources(
      "getDatarestores",
      "datarestore",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
    );
    if (!result.ok) return vendorError(result);
    try {
      return jsonResponse(
        page(
          new URL(context.req.url),
          result.value.values.map((value) => parseStored(value)),
        ),
      );
    } catch (error) {
      return vendorProblem(
        400,
        "Bad Request",
        error instanceof Error ? error.message : "Invalid query.",
      );
    }
  },
);

extendedRoutes.post(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/datarestores",
  async (context) => {
    try {
      const request = await validatedBody(context, createDatarestoreSchema);
      if (request.sourceEnvironmentCode && !environmentExists(request.sourceEnvironmentCode)) {
        return vendorProblem(404, "Not Found", "The source environment was not found.");
      }
      if (request.databackupCode) {
        const backup = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
          "getDatabackup",
          "databackup",
          context.req.param("subscriptionCode"),
          request.sourceEnvironmentCode ?? context.req.param("environmentCode"),
          request.databackupCode,
        );
        if (!backup.ok) return vendorProblem(404, "Not Found", "The source backup was not found.");
      }
      const now = new Date().toISOString();
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).createResource(
        "createDatarestore",
        "datarestore",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        "restore",
        "datarestoreCode",
        "",
        JSON.stringify({
          name: `Sandbox restore ${now}`,
          status: "COMPLETED",
          ...(request.databackupCode ? { databackupCode: request.databackupCode } : {}),
          createdBy: "sandbox-technical-user",
          createdTimestamp: now,
          canBeCanceled: false,
        }),
      );
      if (!result.ok) return vendorError(result);
      const stored = parseStored(result.value);
      if (typeof stored.datarestoreCode !== "string") throw new Error("Stored restore is invalid");
      return jsonResponse(
        {
          datarestoreCode: stored.datarestoreCode,
          subscriptionCode: context.req.param("subscriptionCode"),
          environmentCode: context.req.param("environmentCode"),
        },
        201,
      );
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/datarestores/:datarestoreCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
      "getDatarestore",
      "datarestore",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      context.req.param("datarestoreCode"),
    );
    return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
  },
);

extendedRoutes.put(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/datarestores/:datarestoreCode/state",
  async (context) => {
    try {
      await validatedBody(context, backupStateSchema);
      const existing = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
        "changeDatarestoreState",
        "datarestore",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        context.req.param("datarestoreCode"),
      );
      if (!existing.ok) return vendorError(existing);
      const state = parseStored(existing.value);
      if (state.canBeCanceled !== true) {
        return vendorProblem(409, "Conflict", "This completed restore cannot be canceled.");
      }
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).patchResource(
        "changeDatarestoreState",
        "datarestore",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        context.req.param("datarestoreCode"),
        JSON.stringify({ status: "CANCELED", canBeCanceled: false }),
      );
      return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

function defaultScaling(subscriptionCode: string, environmentCode: string) {
  return {
    subscriptionCode,
    environmentCode,
    hibernated: false,
    kubernetesClusters: [{ code: "commerce", replicas: 2, size: "MEDIUM" }],
    databaseSchemas: [{ code: "commerce", size: "MEDIUM" }],
    services: [{ code: "backgroundProcessing", replicas: 1, size: "MEDIUM" }],
  };
}

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/scaling",
  async (context) => {
    const stub = context.env.CCV2_RUN.getByName(context.get("runId"));
    const result = await stub.getResource(
      "getEnvironmentScaling",
      "scaling",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      "current",
    );
    if (result.ok) return jsonResponse(parseStored(result.value));
    if (result.status !== 404) return vendorError(result);
    if (!environmentExists(context.req.param("environmentCode"))) {
      return vendorProblem(404, "Not Found", "The environment was not found.");
    }
    return jsonResponse(
      defaultScaling(context.req.param("subscriptionCode"), context.req.param("environmentCode")),
    );
  },
);

extendedRoutes.patch(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/scaling",
  async (context) => {
    try {
      const request = await validatedBody(context, scalingUpdateSchema);
      const current = defaultScaling(
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
      );
      const state = { ...current, ...request };
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).putResource(
        "updateEnvironmentScaling",
        "scaling",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        "current",
        JSON.stringify(state),
        true,
      );
      return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/scalingOptions",
  async (context) => {
    if (!environmentExists(context.req.param("environmentCode"))) {
      return vendorProblem(404, "Not Found", "The environment was not found.");
    }
    const authorization = await context.env.CCV2_RUN.getByName(context.get("runId")).listResources(
      "getEnvironmentScalingOption",
      "scalingOptions",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
    );
    if (!authorization.ok) return vendorError(authorization);
    return jsonResponse({
      kubernetesClusters: [
        { code: "commerce", replicas: [1, 2, 3, 4], sizes: ["SMALL", "MEDIUM", "LARGE"] },
      ],
      databaseSchemas: [{ code: "commerce", sizes: ["SMALL", "MEDIUM", "LARGE"] }],
      services: [{ code: "backgroundProcessing", replicas: [1, 2, 3, 4] }],
    });
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/scheduledactivities",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).listResources(
      "getScheduledActivities",
      "scheduledActivity",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
    );
    if (!result.ok) return vendorError(result);
    try {
      return jsonResponse(
        page(
          new URL(context.req.url),
          result.value.values.map((value) => parseStored(value)),
        ),
      );
    } catch (error) {
      return vendorProblem(
        400,
        "Bad Request",
        error instanceof Error ? error.message : "Invalid query.",
      );
    }
  },
);

extendedRoutes.post(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/scheduledactivities",
  async (context) => {
    try {
      const request = await validatedBody(context, createScheduledActivitySchema);
      const now = new Date().toISOString();
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).createResource(
        "createScheduledActivity",
        "scheduledActivity",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        "activity",
        "code",
        "",
        JSON.stringify({
          subscriptionCode: context.req.param("subscriptionCode"),
          environmentCode: context.req.param("environmentCode"),
          ...request,
          status: "SCHEDULED",
          readOnly: false,
          updatable: true,
          cancelable: true,
          createdBy: "sandbox-technical-user",
          createdTimestamp: now,
        }),
      );
      return result.ok ? jsonResponse(parseStored(result.value), 201) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/scheduledactivities/:activityCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
      "getScheduledActivity",
      "scheduledActivity",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      context.req.param("activityCode"),
    );
    return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
  },
);

extendedRoutes.patch(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/scheduledactivities/:activityCode",
  async (context) => {
    try {
      const request = await validatedBody(context, updateScheduledActivitySchema);
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).patchResource(
        "updateScheduledActivity",
        "scheduledActivity",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        context.req.param("activityCode"),
        JSON.stringify({
          ...request,
          lastModifiedBy: "sandbox-technical-user",
          lastModifiedTimestamp: new Date().toISOString(),
        }),
      );
      return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.post(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/scheduledactivities/:activityCode/cancel",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).patchResource(
      "cancelScheduledActivity",
      "scheduledActivity",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      context.req.param("activityCode"),
      JSON.stringify({
        status: "CANCELED",
        cancelable: false,
        finishedTimestamp: new Date().toISOString(),
      }),
    );
    return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
  },
);

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/services/:serviceCode/properties/:propertyCode",
  async (context) => {
    const code = `${context.req.param("serviceCode")}:${context.req.param("propertyCode")}`;
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
      "getProperty",
      "serviceProperty",
      context.req.param("subscriptionCode"),
      context.req.param("environmentCode"),
      code,
    );
    if (result.ok) return jsonResponse(parseStored(result.value));
    if (result.status !== 404) return vendorError(result);
    if (
      context.req.param("serviceCode") === "commerce" &&
      context.req.param("propertyCode") === "catalog"
    ) {
      return jsonResponse({ key: "catalog", value: "electronics", flags: ["EDITABLE"] });
    }
    return vendorError(result);
  },
);

extendedRoutes.put(
  "/v2/subscriptions/:subscriptionCode/environments/:environmentCode/services/:serviceCode/properties/:propertyCode",
  async (context) => {
    try {
      const request = await validatedBody(context, servicePropertySchema);
      if (request.key !== context.req.param("propertyCode")) {
        return vendorProblem(400, "Bad Request", "The property key must match the path.");
      }
      const code = `${context.req.param("serviceCode")}:${context.req.param("propertyCode")}`;
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).putResource(
        "putProperty",
        "serviceProperty",
        context.req.param("subscriptionCode"),
        context.req.param("environmentCode"),
        code,
        JSON.stringify(request),
        true,
      );
      return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);

extendedRoutes.get("/v2/subscriptions/:subscriptionCode/certificates", async (context) => {
  const result = await context.env.CCV2_RUN.getByName(context.get("runId")).listResources(
    "getCertificates",
    "certificate",
    context.req.param("subscriptionCode"),
  );
  if (!result.ok) return vendorError(result);
  try {
    return jsonResponse(
      page(
        new URL(context.req.url),
        result.value.values.map((value) => parseStored(value)),
      ),
    );
  } catch (error) {
    return vendorProblem(
      400,
      "Bad Request",
      error instanceof Error ? error.message : "Invalid query.",
    );
  }
});

extendedRoutes.post("/v2/subscriptions/:subscriptionCode/certificates", async (context) => {
  try {
    const request = await validatedBody(context, createCertificateSchema);
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).createResource(
      "createCertificate",
      "certificate",
      context.req.param("subscriptionCode"),
      "",
      "certificate",
      "code",
      "",
      JSON.stringify({
        name: request.name,
        subscriptionCode: context.req.param("subscriptionCode"),
        domains: ["sandbox.invalid"],
        issuer: "CommerceKit Synthetic CA",
        expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000).toISOString(),
        description: request.description ?? "Synthetic certificate metadata",
        endpoints: [],
      }),
    );
    return result.ok ? jsonResponse(parseStored(result.value), 201) : vendorError(result);
  } catch (error) {
    const response = bodyError(error);
    if (response) return response;
    throw error;
  }
});

extendedRoutes.get(
  "/v2/subscriptions/:subscriptionCode/certificates/:certificateCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).getResource(
      "getCertificate",
      "certificate",
      context.req.param("subscriptionCode"),
      "",
      context.req.param("certificateCode"),
    );
    return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
  },
);

extendedRoutes.delete(
  "/v2/subscriptions/:subscriptionCode/certificates/:certificateCode",
  async (context) => {
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).deleteResource(
      "deleteCertificate",
      "certificate",
      context.req.param("subscriptionCode"),
      "",
      context.req.param("certificateCode"),
    );
    return result.ok ? noContent() : vendorError(result);
  },
);

extendedRoutes.get("/v2/subscriptions/:subscriptionCode/roles", async (context) => {
  const authorization = await context.env.CCV2_RUN.getByName(context.get("runId")).listResources(
    "getRoles",
    "roleCatalog",
    context.req.param("subscriptionCode"),
  );
  if (!authorization.ok) return vendorError(authorization);
  return jsonResponse([
    { code: "ROLE_VIEWER", name: "Viewer" },
    { code: "ROLE_OPERATOR", name: "Operator" },
    { code: "ROLE_ADMIN", name: "Administrator" },
  ]);
});

extendedRoutes.get("/v2/subscriptions/:subscriptionCode/userroleassignments", async (context) => {
  const result = await context.env.CCV2_RUN.getByName(context.get("runId")).listResources(
    "getUserRoleAssignments",
    "roleAssignment",
    context.req.param("subscriptionCode"),
  );
  if (!result.ok) return vendorError(result);
  return jsonResponse({ items: result.value.values.map((value) => parseStored(value)) });
});

extendedRoutes.post("/v2/subscriptions/:subscriptionCode/userroleassignments", async (context) => {
  try {
    const request = await validatedBody(context, createRoleAssignmentSchema);
    if (request.environments.some((code) => !environmentExists(code))) {
      return vendorProblem(400, "Bad Request", "One or more environment codes are invalid.");
    }
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).createResource(
      "createUserRoleAssignment",
      "roleAssignment",
      context.req.param("subscriptionCode"),
      "",
      "role",
      "",
      `${request.username}:${request.role}`,
      JSON.stringify({
        username: request.username,
        role: request.role,
        subscriptionCode: context.req.param("subscriptionCode"),
        environments: request.environments,
      }),
    );
    if (!result.ok) return vendorError(result);
    return jsonResponse(parseStored(result.value), 201);
  } catch (error) {
    const response = bodyError(error);
    if (response) return response;
    throw error;
  }
});

extendedRoutes.patch("/v2/subscriptions/:subscriptionCode/userroleassignments", async (context) => {
  try {
    const request = await validatedBody(context, updateRoleAssignmentSchema);
    const code = `${request.username}:${request.role}`;
    const result = await context.env.CCV2_RUN.getByName(context.get("runId")).putResource(
      "updateUserRoleAssignment",
      "roleAssignment",
      context.req.param("subscriptionCode"),
      "",
      code,
      JSON.stringify({
        username: request.username,
        role: request.role,
        subscriptionCode: context.req.param("subscriptionCode"),
        environments: request.environments,
      }),
      false,
    );
    return result.ok ? jsonResponse(parseStored(result.value)) : vendorError(result);
  } catch (error) {
    const response = bodyError(error);
    if (response) return response;
    throw error;
  }
});

extendedRoutes.delete(
  "/v2/subscriptions/:subscriptionCode/userroleassignments",
  async (context) => {
    try {
      const request = await validatedBody(context, deleteRoleAssignmentSchema);
      const result = await context.env.CCV2_RUN.getByName(context.get("runId")).deleteResource(
        "deleteUserRoleAssignment",
        "roleAssignment",
        context.req.param("subscriptionCode"),
        "",
        `${request.username}:${request.role}`,
      );
      return result.ok ? noContent() : vendorError(result);
    } catch (error) {
      const response = bodyError(error);
      if (response) return response;
      throw error;
    }
  },
);
