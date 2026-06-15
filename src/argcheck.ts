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
 *   - enum: a present value whose property schema declares an `enum` must be
 *     one of the listed members. Closed value sets (e.g. h_scope_scan.mode)
 *     are the cheapest way an attacker probes a backend, so we gate them here.
 *   - nested required: when a present property is itself an object schema with
 *     its own `required` (and/or `properties`), it is recursed one level so a
 *     required sub-field (e.g. h_relay_send.authorization.signature) is enforced
 *     at the MCP boundary, not only at the backend.
 *
 * It does not enforce pattern, minimum/maximum, minItems/maxItems, or array
 * item shapes, and recursion stops after one nested object level: those stay
 * with the backend, which is the authoritative validator.
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

// Cap how deep recursion descends so a hostile nested schema/payload cannot
// drive unbounded work. Tool schemas only need one level past the top object
// (the top call is depth 0, a nested object's contents are depth 1).
const MAX_RECURSE_DEPTH = 1;

function joinPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/**
 * Validate `args` against `schema`. Returns the list of violations; an empty
 * list means valid. Collects all violations rather than failing on the first
 * so the caller gets one complete error message.
 */
export function validateArgs(args: unknown, schema: JSONSchema7): ArgValidationError[] {
  const errors: ArgValidationError[] = [];
  validateInto(args, schema, "", 0, errors);
  return errors;
}

function validateInto(
  args: unknown,
  schema: JSONSchema7,
  prefix: string,
  depth: number,
  errors: ArgValidationError[],
): void {
  // Type check for this node. Tool schemas are objects; if a schema says so,
  // enforce it. A type mismatch here makes property checks meaningless.
  if (schema.type && !matchesType(args, schema.type)) {
    errors.push({
      path: prefix,
      message: `${prefix ? `property '${prefix}' ` : ""}expected ${schema.type}, got ${typeOf(args) ?? typeof args}`,
    });
    return;
  }

  // enum: a present value must be a listed member. Compared with deep equality
  // against scalars/arrays/objects so non-string enums work too.
  if (schema.enum && args !== undefined && !enumIncludes(schema.enum, args)) {
    errors.push({
      path: prefix,
      message: `${prefix ? `property '${prefix}' ` : "value "}must be one of ${JSON.stringify(schema.enum)}`,
    });
  }

  // Below here only object-shaped args carry properties/required to check.
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return;
  }
  const obj = args as Record<string, unknown>;
  const props = schema.properties ?? {};

  // required: each must be present and not undefined.
  for (const name of schema.required ?? []) {
    if (!(name in obj) || obj[name] === undefined) {
      errors.push({
        path: joinPath(prefix, name),
        message: `missing required property '${name}'`,
      });
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
        errors.push({
          path: joinPath(prefix, key),
          message: `unknown property '${key}' not permitted`,
        });
      }
      continue;
    }
    if (value === undefined) continue;

    // Property type check.
    if (propSchema.type && !matchesType(value, propSchema.type)) {
      errors.push({
        path: joinPath(prefix, key),
        message: `property '${key}' expected ${propSchema.type}, got ${typeOf(value) ?? typeof value}`,
      });
      continue;
    }

    // enum on a present property value.
    if (propSchema.enum && !enumIncludes(propSchema.enum, value)) {
      errors.push({
        path: joinPath(prefix, key),
        message: `property '${key}' must be one of ${JSON.stringify(propSchema.enum)}`,
      });
    }

    // Recurse one level into a nested object schema so its own required/enum
    // are enforced (e.g. authorization.signature). Past MAX_RECURSE_DEPTH we
    // defer to the backend.
    const nestedIsObject =
      value !== null && typeof value === "object" && !Array.isArray(value);
    const schemaHasNestedRules =
      !!propSchema.properties || !!propSchema.required;
    if (nestedIsObject && schemaHasNestedRules && depth < MAX_RECURSE_DEPTH) {
      validateInto(value, propSchema, joinPath(prefix, key), depth + 1, errors);
    }
  }
}

/** Deep-equality membership test for an enum's declared members. */
function enumIncludes(members: unknown[], value: unknown): boolean {
  return members.some((m) => deepEqual(m, value));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}
