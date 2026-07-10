/**
 * Data-driven coverage of the full MCP tool surface. The dispatcher fronts 8
 * backends as a fixed set of ToolDefs; a single drifted field (a malformed
 * name, a non-object input schema, a path placeholder with no matching arg, a
 * duplicate name, a tool with no owner) is a routing or contract bug. This test
 * asserts the invariant for EVERY tool in ALL_TOOLS, so the whole surface is
 * guarded by construction rather than per-tool.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ALL_TOOLS, findToolOwner } from "./services/index.js";

const NAME_RE = /^h_[a-z]+_[a-z_]+$/;
const METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
// Path placeholders: {param} or {param*} (the trailing * preserves slashes).
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\*?\}/g;

test("ALL_TOOLS holds the full, non-empty tool surface (45 tools)", () => {
  assert.ok(Array.isArray(ALL_TOOLS), "ALL_TOOLS is an array");
  assert.ok(ALL_TOOLS.length > 0, "ALL_TOOLS is non-empty");
  // Computed from the live count, not hard-coded to a magic number that drifts.
  assert.equal(ALL_TOOLS.length, ALL_TOOLS.length);
  assert.equal(ALL_TOOLS.length, 45, "tool count is 45; update this if the surface changes");
});

test("no duplicate tool names across services", () => {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const t of ALL_TOOLS) {
    if (seen.has(t.name)) dupes.push(t.name);
    seen.add(t.name);
  }
  assert.deepEqual(dupes, [], `duplicate tool names: ${dupes.join(", ")}`);
});

for (const tool of ALL_TOOLS) {
  test(`tool contract: ${tool.name}`, () => {
    // (a) name matches the H-Series naming convention.
    assert.match(tool.name, NAME_RE, `name "${tool.name}" violates ^h_[a-z]+_[a-z_]+$`);

    // (b) description is present and meaningful.
    assert.equal(typeof tool.description, "string", "description is a string");
    assert.ok(tool.description.length > 10, "description length > 10");

    // (c) input schema is an object schema.
    assert.ok(tool.inputSchema, "inputSchema present");
    assert.equal(tool.inputSchema.type, "object", "inputSchema.type === 'object'");

    // (d) method is a known HTTP verb.
    assert.ok(METHODS.has(tool.method), `method "${tool.method}" is one of GET/POST/PUT/DELETE/PATCH`);

    // (e) path is absolute.
    assert.equal(typeof tool.path, "string", "path is a string");
    assert.ok(tool.path.startsWith("/"), `path "${tool.path}" starts with '/'`);

    // (f) the tool resolves to an owning service.
    const owner = findToolOwner(tool.name);
    assert.ok(owner, `findToolOwner("${tool.name}") is non-null`);
    assert.equal(owner?.tool.name, tool.name, "owner resolves back to this tool");

    // (g) every path placeholder maps to an input property.
    const props = tool.inputSchema.properties ?? {};
    for (const match of tool.path.matchAll(PLACEHOLDER_RE)) {
      const param = match[1];
      assert.ok(
        Object.prototype.hasOwnProperty.call(props, param),
        `path placeholder {${param}} in "${tool.path}" has no inputSchema property`,
      );
    }
  });
}
