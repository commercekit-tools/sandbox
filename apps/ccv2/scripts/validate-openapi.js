import SwaggerParser from "@apidevtools/swagger-parser";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { stdout } from "node:process";
import path from "node:path";
import { parse } from "yaml";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managementPath = path.join(appRoot, "openapi", "management.yaml");
const sandboxPath = path.join(appRoot, "openapi", "sandbox-control.yaml");

await Promise.all([SwaggerParser.validate(managementPath), SwaggerParser.validate(sandboxPath)]);

const [managementSource, sandboxSource, contractsSource] = await Promise.all([
  readFile(managementPath, "utf8"),
  readFile(sandboxPath, "utf8"),
  readFile(path.join(appRoot, "src", "domain", "contracts.ts"), "utf8"),
]);
const document = parse(managementSource);
const sandboxDocument = parse(sandboxSource);
const documented = new Set();
const operations = new Map();
for (const [route, pathItem] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (["get", "post", "put", "patch", "delete"].includes(method) && operation.operationId) {
      if (documented.has(operation.operationId))
        throw new Error(`Duplicate operationId ${operation.operationId}`);
      documented.add(operation.operationId);
      operations.set(operation.operationId, { method: method.toUpperCase(), operation, route });
    }
  }
}
const inventoried = new Set(
  Array.from(contractsSource.matchAll(/operationId: "([^"]+)"/g), (match) => match[1]),
);
const missing = [...inventoried].filter((operationId) => !documented.has(operationId));
const extra = [...documented].filter((operationId) => !inventoried.has(operationId));
if (missing.length || extra.length) {
  throw new Error(
    `Management OpenAPI mismatch. Missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`,
  );
}
if (documented.size !== 52)
  throw new Error(`Expected 52 management operations, found ${String(documented.size)}`);
if (document.servers?.[0]?.url !== "https://ccv2.sandbox.commercekit.tools") {
  throw new Error("The public Management API server URL is incorrect");
}
if (sandboxDocument.servers?.[0]?.url !== "https://ccv2.sandbox.commercekit.tools") {
  throw new Error("The public Sandbox Control API server URL is incorrect");
}

function resolveReference(root, value) {
  let resolved = value;
  const seen = new Set();
  while (resolved?.$ref) {
    if (!resolved.$ref.startsWith("#/"))
      throw new Error(`External reference is not allowed: ${resolved.$ref}`);
    if (seen.has(resolved.$ref)) throw new Error(`Circular reference: ${resolved.$ref}`);
    seen.add(resolved.$ref);
    resolved = resolved.$ref
      .slice(2)
      .split("/")
      .reduce((current, key) => current?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], root);
    if (!resolved) throw new Error(`Unresolved reference: ${[...seen].at(-1)}`);
  }
  return resolved;
}

function referencedSchemaName(root, schema) {
  if (schema?.$ref) return schema.$ref.split("/").at(-1);
  const resolved = resolveReference(root, schema);
  if (resolved !== schema && schema?.$ref) return schema.$ref.split("/").at(-1);
  return undefined;
}

const contractBlocks = Array.from(
  contractsSource.matchAll(
    /\{\s*family:\s*"[^"]+",\s*method:\s*"([A-Z]+)",\s*path:\s*`([^`]+)`,\s*operationId:\s*"([^"]+)"([\s\S]*?)success:\s*\[([^\]]+)\],\s*\}/g,
  ),
  (match) => ({
    method: match[1],
    path: match[2]
      .replaceAll("${subscription}", "/v2/subscriptions/{subscriptionCode}")
      .replaceAll(
        "${environment}",
        "/v2/subscriptions/{subscriptionCode}/environments/{environmentCode}",
      ),
    operationId: match[3],
    requestSchema: /requestSchema:\s*"([^"]+)"/.exec(match[4])?.[1],
    responseSchema: /responseSchema:\s*"([^"]+)"/.exec(match[4])?.[1],
    success: match[5].split(",").map((status) => status.trim()),
  }),
);
if (contractBlocks.length !== 52) {
  throw new Error(
    `Expected to parse 52 contract inventory entries, found ${String(contractBlocks.length)}`,
  );
}
for (const contract of contractBlocks) {
  const found = operations.get(contract.operationId);
  if (!found || found.method !== contract.method || found.route !== contract.path) {
    throw new Error(
      `${contract.operationId} must be ${contract.method} ${contract.path}; found ${found?.method ?? "missing"} ${found?.route ?? ""}`,
    );
  }
  for (const status of contract.success) {
    const response = resolveReference(document, found.operation.responses?.[status]);
    if (!response) throw new Error(`${contract.operationId} is missing success response ${status}`);
    if (status === "204" || status === "202") continue;
    const expectedMediaType =
      contract.responseSchema === "binary" ? "application/octet-stream" : "application/json";
    const schema = response.content?.[expectedMediaType]?.schema;
    if (!schema) {
      throw new Error(
        `${contract.operationId} ${status} is missing ${expectedMediaType} response content`,
      );
    }
    if (contract.responseSchema !== "binary") {
      const actual = referencedSchemaName(document, schema);
      if (actual !== contract.responseSchema) {
        throw new Error(
          `${contract.operationId} ${status} must use ${contract.responseSchema}; found ${actual ?? "an inline schema"}`,
        );
      }
    }
  }
  if (contract.requestSchema) {
    const requestBody = resolveReference(document, found.operation.requestBody);
    const mediaTypes = Object.values(requestBody?.content ?? {});
    const actual = mediaTypes.map(({ schema }) => referencedSchemaName(document, schema));
    if (!actual.includes(contract.requestSchema)) {
      throw new Error(
        `${contract.operationId} must use request schema ${contract.requestSchema}; found ${actual.join(", ") || "none"}`,
      );
    }
  }
  for (const [status, responseOrReference] of Object.entries(found.operation.responses ?? {})) {
    if (contract.success.includes(status)) continue;
    const response = resolveReference(document, responseOrReference);
    if (!response.content?.["application/problem+json"]) {
      throw new Error(
        `${contract.operationId} error response ${status} is not application/problem+json`,
      );
    }
  }
}

const serializedManagement = JSON.stringify(document);
for (const retired of ["/__mock", "/openapi/mock.json", "x-mock-run-id"]) {
  if (managementSource.includes(retired) || sandboxSource.includes(retired)) {
    throw new Error(`An OpenAPI document still contains retired identifier ${retired}`);
  }
}
if (
  serializedManagement.includes("#/components/responses/Object") ||
  serializedManagement.includes("#/components/responses/List") ||
  serializedManagement.includes("#/components/requestBodies/Object")
) {
  throw new Error("Management operations must not use generic object or list contracts");
}
const sandboxOperations = Object.entries(sandboxDocument.paths).flatMap(([route, pathItem]) =>
  Object.entries(pathItem)
    .filter(
      ([method, operation]) =>
        ["get", "post", "put", "patch", "delete"].includes(method) && operation.operationId,
    )
    .map(([method, operation]) => ({ method, operationId: operation.operationId, route })),
);
if (sandboxOperations.length !== 10) {
  throw new Error(`Expected 10 sandbox operations, found ${String(sandboxOperations.length)}`);
}
const invalidSandboxRoute = sandboxOperations.find(
  ({ route }) =>
    !route.startsWith("/sandbox/v1/") &&
    route !== "/oauth2/token" &&
    route !== "/.well-known/jwks.json",
);
if (invalidSandboxRoute) {
  throw new Error(`Unexpected Sandbox Control API route: ${invalidSandboxRoute.route}`);
}
if (sandboxSource.includes("__mock") || sandboxSource.includes("x-mock-run-id")) {
  throw new Error("The Sandbox Control API still contains a retired mock identifier");
}
stdout.write(
  `Validated Management API (${String(documented.size)} operations) and Sandbox Control API (${String(sandboxOperations.length)} operations).\n`,
);
