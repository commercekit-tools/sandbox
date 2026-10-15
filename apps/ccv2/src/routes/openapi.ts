import { Hono } from "hono";
import { parse } from "yaml";

import managementYaml from "../../openapi/management.yaml";
import mockControlYaml from "../../openapi/mock-control.yaml";
import { jsonResponse } from "../http";
import type { AppEnvironment } from "../types";

const managementDocument: unknown = parse(managementYaml);
const mockControlDocument: unknown = parse(mockControlYaml);

export const openapiRoutes = new Hono<AppEnvironment>();

openapiRoutes.get("/openapi.json", () =>
  jsonResponse(managementDocument, 200, { "Cache-Control": "public, max-age=300" }),
);

openapiRoutes.get("/openapi/mock.json", () =>
  jsonResponse(mockControlDocument, 200, { "Cache-Control": "public, max-age=300" }),
);
