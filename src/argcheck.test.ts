/**
 * Tests for the inbound argument validator.
 *
 * Uses Node's built-in test runner (node:test), so no test framework is added
 * to this deliberately low-dependency server. Run via `npm test`, which
 * compiles to dist/ and executes the compiled tests with `node --test`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { validateArgs } from "./argcheck.js";
import { findToolOwner } from "./services/index.js";
import type { JSONSchema7 } from "./jsonschema.js";

// A representative paid tool schema: required fields, declared properties
// (including payment_signature), and additionalProperties:false.
const registerTool = findToolOwner("h_index_register");
assert.ok(registerTool, "h_index_register tool should be registered");
const registerSchema: JSONSchema7 = registerTool.tool.inputSchema;

const validRegisterArgs = {
  apiName: "Example",
  endpointUrl: "https://example.com",
  description: "Does a thing.",
  pricing: "{}",
  ownerAccountId: "hedera:mainnet:0.0.1",
  registryTopicId: "0.0.123",
  issuedAt: 1781000000,
  signature: "0xabc",
};

test("valid args pass with no violations", () => {
  assert.deepEqual(validateArgs(validRegisterArgs, registerSchema), []);
});

test("payment_signature is accepted (declared property, not an unknown key)", () => {
  const withPayment = { ...validRegisterArgs, payment_signature: "base64envelope" };
  assert.deepEqual(validateArgs(withPayment, registerSchema), []);
});

test("a missing required arg is rejected", () => {
  const { signature: _omit, ...missing } = validRegisterArgs;
  const errors = validateArgs(missing, registerSchema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.path, "signature");
  assert.match(errors[0]?.message ?? "", /required/);
});

test("an unknown key is rejected under additionalProperties:false", () => {
  const withUnknown = { ...validRegisterArgs, surpriseField: "x" };
  const errors = validateArgs(withUnknown, registerSchema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.path, "surpriseField");
  assert.match(errors[0]?.message ?? "", /unknown property/);
});

test("a wrong top-level type is rejected", () => {
  const errors = validateArgs([1, 2, 3], registerSchema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.path, "");
  assert.match(errors[0]?.message ?? "", /expected object/);
});

test("a wrong property type is rejected", () => {
  const badType = { ...validRegisterArgs, issuedAt: "not-a-number" };
  const errors = validateArgs(badType, registerSchema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.path, "issuedAt");
  assert.match(errors[0]?.message ?? "", /expected number/);
});

test("empty-property schema rejects any key but accepts {}", () => {
  const schema: JSONSchema7 = { type: "object", properties: {}, additionalProperties: false };
  assert.deepEqual(validateArgs({}, schema), []);
  const errors = validateArgs({ x: 1 }, schema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.path, "x");
});

test("multiple violations are all reported", () => {
  const { apiName: _drop, ...rest } = validRegisterArgs;
  const bad = { ...rest, extra: true };
  const errors = validateArgs(bad, registerSchema);
  // one missing required (apiName) + one unknown key (extra)
  assert.equal(errors.length, 2);
});

// enum enforcement at the MCP boundary (h_scope_scan.mode is a real enum).
const scanTool = findToolOwner("h_scope_scan");
assert.ok(scanTool, "h_scope_scan tool should be registered");
const scanSchema: JSONSchema7 = scanTool.tool.inputSchema;

test("a declared enum value is accepted", () => {
  const errors = validateArgs({ subject: "0xabc", mode: "full" }, scanSchema);
  assert.deepEqual(errors, []);
});

test("a value outside a declared enum is rejected", () => {
  const errors = validateArgs({ subject: "0xabc", mode: "deep" }, scanSchema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.path, "mode");
  assert.match(errors[0]?.message ?? "", /must be one of/);
});

// Nested required enforcement (h_relay_send.authorization has its own required).
const sendTool = findToolOwner("h_relay_send");
assert.ok(sendTool, "h_relay_send tool should be registered");
const sendSchema: JSONSchema7 = sendTool.tool.inputSchema;

const validSendArgs = {
  to: "hedera:mainnet:0.0.2",
  from: "hedera:mainnet:0.0.1",
  body: "hello",
  authorization: { scheme: "tip712", signature: "0xsig", issuedAt: 1781000000 },
};

test("a complete nested authorization passes", () => {
  assert.deepEqual(validateArgs(validSendArgs, sendSchema), []);
});

test("a missing nested required field is rejected with a dotted path", () => {
  const { signature: _drop, ...authRest } = validSendArgs.authorization;
  const bad = { ...validSendArgs, authorization: authRest };
  const errors = validateArgs(bad, sendSchema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.path, "authorization.signature");
  assert.match(errors[0]?.message ?? "", /required/);
});

test("a nested field of the wrong type is rejected", () => {
  const bad = {
    ...validSendArgs,
    authorization: { ...validSendArgs.authorization, issuedAt: "nope" },
  };
  const errors = validateArgs(bad, sendSchema);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.path, "authorization.issuedAt");
  assert.match(errors[0]?.message ?? "", /expected number/);
});
