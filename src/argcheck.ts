/**
 * Inbound argument validation against a tool's declared inputSchema.
 *
 * Why this exists: the low-level MCP Server.setRequestHandler path validates
 * the JSON-RPC request envelope, not the tool arguments inside it. Without a
 * check here, unvalidated and unknown fields would flow straight to a backend.
 * The closeout checklist requires inbound tool arguments to be validated
 * before dispatch, so this gate runs in the CallTool handler ahead of
 * dispatchTool.
 *
 * Scope is deliberately a small dependency-free subset of JSON Schema Draft 7,
 * not a full validator (no ajv): the goal is to stop malformed or unexpected
 * input from reaching a backend, while the backends remain the authoritative
 * validators. It enforces:
 *
 *   - required: every name in `required` must be present (not undefined).
 *   - top-level type: when the schema declares an object, args must be an
 *     object; an array or scalar is rejected.
 *   - property types: each present property whose schema declares a `type` is
 *     checked against that type (string/number/integer/boolean/object/array/
 *     null). Nested object/array contents are not recursed: a single level is
 *     enough to keep unexpected shapes out without duplicating backend logic.
 *   - additionalProperties:false: unknown keys (not in `properties`) are
 *     rejected so unvalidated fields cannot reach a backend.
 *
 * It does not enforce enum, pattern, minimum/maximum, minItems/maxItems, or
 * any nested constraints: those stay with the backend, which is the validator.
 */

import type { JSONSchema7 } from "./jsonschema.js";

export interface ArgValidationError {
  /** Dotted path to the offending value, "" for the top-level object. */
  path: string;
  /** Human-readable reason, suitable for an MCP isError text body. */
  message: string;
}

function typeOf(v: unknown): JSONSchema7["type"] {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "string") return "string";
  if (t === "object") return "object";
  // function / undefined / symbol / bigint: report as the literal typeof so the
  // mismatch message is honest rather than coerced into a schema type.
  return undefined;
}

function matchesType(v: unknown, expected: NonNullable<JSONSchema7["type"]>): boolean {
  switch (expected) {
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    case "array":
      return Array.isArray(v);
    case "null":
      return v === null;
    default:
      return true;
  }
}

/**
 * Validate `args` against `schema`. Returns the list of violations; an empty
 * list means valid. Collects all violations rather than failing on the first
 * so the caller gets one complete error message.
 */
export function validateArgs(args: unknown, schema: JSONSchema7): ArgValidationError[] {
  const errors: ArgValidationError[] = [];

  // Top-level type. Tool schemas are objects; if a schema says so, enforce it.
  if (schema.type && !matchesType(args, schema.type)) {
    errors.push({
      path: "",
      message: `expected ${schema.type}, got ${typeOf(args) ?? typeof args}`,
    });
    // No point checking properties of a non-object.
    return errors;
  }

  // Below here only object-shaped args carry properties/required to check.
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return errors;
  }
  const obj = args as Record<string, unknown>;
  const props = schema.properties ?? {};

  // required: each must be present and not undefined.
  for (const name of schema.required ?? []) {
    if (!(name in obj) || obj[name] === undefined) {
      errors.push({ path: name, message: `missing required property '${name}'` });
    }
  }

  // additionalProperties:false rejects unknown keys. A schema/object value of
  // additionalProperties (allowing extra keys) or true leaves unknown keys
  // alone; we only reject on the explicit false.
  const additionalAllowed = schema.additionalProperties !== false;

  for (const [key, value] of Object.entries(obj)) {
    const propSchema = props[key];
    if (!propSchema) {
      if (!additionalAllowed) {
        errors.push({ path: key, message: `unknown property '${key}' not permitted` });
      }
      continue;
    }
    // Property type check, one level deep only.
    if (propSchema.type && value !== undefined && !matchesType(value, propSchema.type)) {
      errors.push({
        path: key,
        message: `property '${key}' expected ${propSchema.type}, got ${typeOf(value) ?? typeof value}`,
      });
    }
  }

  return errors;
}
