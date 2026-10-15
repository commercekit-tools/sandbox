import { Hono } from "hono";
import { parse } from "yaml";

import managementYaml from "../../openapi/management.yaml";
import sandboxControlYaml from "../../openapi/sandbox-control.yaml";
import { jsonResponse } from "../http";
import type { AppEnvironment } from "../types";

const managementDocument: unknown = parse(managementYaml);
const sandboxControlDocument: unknown = parse(sandboxControlYaml);

export const openapiRoutes = new Hono<AppEnvironment>();

openapiRoutes.get("/openapi.json", () =>
  jsonResponse(managementDocument, 200, { "Cache-Control": "public, max-age=300" }),
);

openapiRoutes.get("/openapi/sandbox.json", () =>
  jsonResponse(sandboxControlDocument, 200, { "Cache-Control": "public, max-age=300" }),
);
