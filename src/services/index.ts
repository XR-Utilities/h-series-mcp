import type { ServiceDef, ToolDef } from "../types.js";
import { hIndex } from "./h-index.js";
import { hSeal } from "./h-seal.js";
import { hGrant } from "./h-grant.js";
import { hRelay } from "./h-relay.js";
import { hScope } from "./h-scope.js";
import { hPact } from "./h-pact.js";
import { hGate } from "./h-gate.js";
import { hCert } from "./h-cert.js";
import { hAgent } from "./h-agent.js";

export const SERVICES: ServiceDef[] = [hIndex, hSeal, hGrant, hRelay, hScope, hPact, hGate, hCert, hAgent];

// The full static tool surface, gate open or shut. Contract tests assert over this.
export const ALL_TOOLS = SERVICES.flatMap((s) => s.tools);

/**
 * Runtime gate: a tool that presents a service-to-service secret (secretHeaderEnv)
 * is enabled ONLY when every referenced env var is set in the process. Read at call
 * time (not module load) so the gate is fail-closed AND an operator can set/rotate
 * the secret without a rebuild. Tools with no secret are always enabled. This is
 * what disables the H-Agent research surface until RESEARCH_SERVICE_SECRET is set.
 */
export function isToolEnabled(tool: ToolDef): boolean {
  for (const spec of Object.values(tool.secretHeaderEnv ?? {})) {
    if (!process.env[spec.env]) return false;
  }
  return true;
}

/** The tools currently advertisable/callable: the static surface minus gated-off tools. */
export function listEnabledTools(): ToolDef[] {
  return ALL_TOOLS.filter(isToolEnabled);
}

export function findToolOwner(toolName: string):
  | { service: ServiceDef; tool: ServiceDef["tools"][number] }
  | null {
  for (const service of SERVICES) {
    const tool = service.tools.find((t) => t.name === toolName);
    // Fail-closed: a gated-off tool (secret unset) resolves to no owner, so a call
    // to it is an "unknown tool" and it never reaches a backend.
    if (tool && isToolEnabled(tool)) return { service, tool };
  }
  return null;
}
