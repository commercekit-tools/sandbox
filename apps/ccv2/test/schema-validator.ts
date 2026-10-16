import { expect } from "vitest";

type JsonObject = Record<string, unknown>;

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonObject;
}

function resolve(document: JsonObject, value: unknown): JsonObject {
  let schema = object(value, "schema");
  const seen = new Set<string>();
  while (typeof schema.$ref === "string") {
    const reference = schema.$ref;
    if (!reference.startsWith("#/") || seen.has(reference)) {
      throw new Error(`Invalid schema reference ${reference}`);
    }
    seen.add(reference);
    schema = object(
      reference
        .slice(2)
        .split("/")
        .reduce<unknown>(
          (current, key) => object(current, reference)[key.replaceAll("~1", "/")],
          document,
        ),
      reference,
    );
  }
  return schema;
}

export function assertMatchesSchema(
  document: JsonObject,
  schemaValue: unknown,
  value: unknown,
  path = "$",
): void {
  const schema = resolve(document, schemaValue);
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) assertMatchesSchema(document, part, value, path);
  }
  if (Array.isArray(schema.anyOf)) {
    const failures = schema.anyOf.filter((part) => {
      try {
        assertMatchesSchema(document, part, value, path);
        return false;
      } catch {
        return true;
      }
    });
    if (failures.length === schema.anyOf.length) throw new Error(`${path} matches no anyOf schema`);
  }
  if (schema.const !== undefined && value !== schema.const) {
    throw new Error(`${path} must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new Error(`${path} is not one of ${schema.enum.join(", ")}`);
  }
  if (schema.type !== "object" && Array.isArray(schema.required)) {
    const candidate = object(value, path);
    for (const required of schema.required as string[]) {
      if (!(required in candidate)) throw new Error(`${path}.${required} is required`);
    }
  }
  switch (schema.type) {
    case "object": {
      const candidate = object(value, path);
      for (const required of (schema.required as string[] | undefined) ?? []) {
        if (!(required in candidate)) throw new Error(`${path}.${required} is required`);
      }
      const properties = (schema.properties as JsonObject | undefined) ?? {};
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (candidate[key] !== undefined) {
          assertMatchesSchema(document, propertySchema, candidate[key], `${path}.${key}`);
        }
      }
      if (schema.additionalProperties === false) {
        const extra = Object.keys(candidate).find((key) => !(key in properties));
        if (extra) throw new Error(`${path}.${extra} is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        for (const [key, property] of Object.entries(candidate)) {
          if (!(key in properties)) {
            assertMatchesSchema(document, schema.additionalProperties, property, `${path}.${key}`);
          }
        }
      }
      break;
    }
    case "array":
      if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
      if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        throw new Error(`${path} has too few items`);
      }
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
        throw new Error(`${path} has too many items`);
      }
      for (const [index, item] of value.entries()) {
        assertMatchesSchema(document, schema.items ?? {}, item, `${path}[${String(index)}]`);
      }
      break;
    case "string":
      if (typeof value !== "string") throw new Error(`${path} must be a string`);
      if (typeof schema.minLength === "number" && value.length < schema.minLength) {
        throw new Error(`${path} is too short`);
      }
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
        throw new Error(`${path} is too long`);
      }
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
        throw new Error(`${path} does not match its pattern`);
      }
      if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
        throw new Error(`${path} must be an ISO date-time`);
      }
      break;
    case "integer":
      if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`);
      if (typeof schema.minimum === "number" && (value as number) < schema.minimum) {
        throw new Error(`${path} is below its minimum`);
      }
      if (typeof schema.maximum === "number" && (value as number) > schema.maximum) {
        throw new Error(`${path} is above its maximum`);
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${path} must be a finite number`);
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
      break;
  }
}

function operation(document: JsonObject, operationId: string): JsonObject {
  const paths = object(document.paths, "paths");
  for (const pathItem of Object.values(paths)) {
    for (const candidate of Object.values(object(pathItem, "path item"))) {
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        const operationObject = candidate as JsonObject;
        if (operationObject.operationId === operationId) return operationObject;
      }
    }
  }
  throw new Error(`Operation ${operationId} is not documented`);
}

export async function expectResponseContract(
  document: JsonObject,
  operationId: string,
  response: Response,
): Promise<unknown> {
  const operationObject = operation(document, operationId);
  const responses = object(operationObject.responses, `${operationId}.responses`);
  const responseSchema = resolve(document, responses[String(response.status)] ?? responses.default);
  const content = (responseSchema.content as JsonObject | undefined) ?? {};
  if (response.status === 204 || Object.keys(content).length === 0) {
    await expect(response.text()).resolves.toBe("");
    return undefined;
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  const mediaType = object(content[contentType ?? ""], `${operationId}.${String(contentType)}`);
  const body = contentType?.includes("json") ? await response.json() : await response.arrayBuffer();
  if (contentType?.includes("json")) {
    assertMatchesSchema(document, mediaType.schema, body, `${operationId}.response`);
  }
  return body;
}

export function expectRequestContract(
  document: JsonObject,
  operationId: string,
  mediaType: string,
  body: unknown,
): void {
  const operationObject = operation(document, operationId);
  const requestBody = resolve(document, operationObject.requestBody);
  const content = object(requestBody.content, `${operationId}.requestBody.content`);
  const media = object(content[mediaType], `${operationId}.${mediaType}`);
  assertMatchesSchema(document, media.schema, body, `${operationId}.request`);
}
