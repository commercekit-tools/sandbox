import { z } from "zod";

import type { BuildListOptions, BuildStatus } from "../domain/build";
import type { DeploymentListOptions, DeploymentStatus } from "../domain/deployment";
import type { RunResult } from "../domain/run";
import { vendorProblem } from "../http";

const buildStatuses = new Set<BuildStatus>([
  "SCHEDULED",
  "BUILDING",
  "SUCCESS",
  "FAIL",
  "DELETED",
  "UNKNOWN",
]);

export function vendorError(result: Extract<RunResult<unknown>, { ok: false }>): Response {
  const title =
    result.status === 401
      ? "Unauthorized"
      : result.status === 403
        ? "Forbidden"
        : result.status === 404
          ? "Not Found"
          : result.status === 409
            ? "Conflict"
            : result.status === 412
              ? "Precondition Failed"
              : result.status === 423
                ? "Locked"
                : result.status === 429
                  ? "Too Many Requests"
                  : result.status >= 500
                    ? "Internal Server Error"
                    : "Bad Request";
  const headers = result.retryAfterSeconds
    ? { "Retry-After": String(result.retryAfterSeconds) }
    : undefined;
  return vendorProblem(result.status, title, result.message, headers);
}

export function parseBuildListOptions(url: URL): BuildListOptions {
  const integer = (name: string, fallback: number, minimum: number, maximum: number): number => {
    const value = url.searchParams.get(name);
    if (value === null) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new Error(`${name} must be an integer from ${String(minimum)} to ${String(maximum)}.`);
    }
    return parsed;
  };
  const orderBy = url.searchParams.get("$orderby") ?? "createdAt desc";
  const allowedOrder = ["createdAt asc", "createdAt desc", "name asc", "name desc"] as const;
  const recognizedOrder = allowedOrder.find((candidate) => candidate === orderBy);
  if (!recognizedOrder) {
    throw new Error("$orderby must select createdAt or name with asc or desc.");
  }
  const statusNot = url.searchParams
    .getAll("statusNot")
    .flatMap((value) => value.split(","))
    .filter(Boolean);
  if (statusNot.some((status) => !buildStatuses.has(status as BuildStatus))) {
    throw new Error("statusNot contains an unrecognized build status.");
  }
  parseCount(url);
  return {
    top: integer("$top", 100, 1, 100),
    skip: integer("$skip", 0, 0, 100_000),
    orderBy: recognizedOrder,
    ...(statusNot.length === 0 ? {} : { statusNot: statusNot as BuildStatus[] }),
  };
}

export function parseDeploymentListOptions(url: URL): DeploymentListOptions {
  const parseInteger = (
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number => {
    const value = url.searchParams.get(name);
    if (value === null) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
      throw new Error(`${name} must be an integer from ${String(minimum)} to ${String(maximum)}.`);
    }
    return parsed;
  };
  const order = url.searchParams.get("$orderby") ?? "createdTimestamp desc";
  if (order !== "createdTimestamp asc" && order !== "createdTimestamp desc") {
    throw new Error("$orderby must be createdTimestamp asc or createdTimestamp desc.");
  }
  const status = url.searchParams.get("status") ?? undefined;
  const statuses = new Set<DeploymentStatus>([
    "SCHEDULED",
    "DEPLOYING",
    "DEPLOYED",
    "UNDEPLOYED",
    "FAIL",
  ]);
  if (status !== undefined && !statuses.has(status as DeploymentStatus)) {
    throw new Error("status is not a recognized deployment status.");
  }
  const buildCode = url.searchParams.get("buildCode");
  const environmentCode = url.searchParams.get("environmentCode");
  parseCount(url);
  return {
    top: parseInteger("$top", 100, 1, 100),
    skip: parseInteger("$skip", 0, 0, 100_000),
    orderDescending: order.endsWith("desc"),
    ...(buildCode ? { buildCode } : {}),
    ...(environmentCode ? { environmentCode } : {}),
    ...(status === undefined ? {} : { status: status as DeploymentStatus }),
  };
}

export function parseCount(url: URL): boolean | undefined {
  const count = url.searchParams.get("$count");
  if (count === null) return undefined;
  if (count !== "true" && count !== "false") {
    throw new Error("$count must be true or false.");
  }
  return count === "true";
}

export function zodDetail(error: z.ZodError): string {
  return error.issues
    .map(({ path, message }) => `${path.join(".") || "body"}: ${message}`)
    .join("; ");
}
