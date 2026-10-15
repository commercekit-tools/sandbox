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
for (const pathItem of Object.values(document.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (["get", "post", "put", "patch", "delete"].includes(method) && operation.operationId) {
      if (documented.has(operation.operationId))
        throw new Error(`Duplicate operationId ${operation.operationId}`);
      documented.add(operation.operationId);
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
