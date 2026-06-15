import type { ServiceDef } from "../types.js";
import { hIndex } from "./h-index.js";
import { hSeal } from "./h-seal.js";
import { hGrant } from "./h-grant.js";
import { hRelay } from "./h-relay.js";
import { hScope } from "./h-scope.js";
import { hPact } from "./h-pact.js";
import { hGate } from "./h-gate.js";

export const SERVICES: ServiceDef[] = [hIndex, hSeal, hGrant, hRelay, hScope, hPact, hGate];

export const ALL_TOOLS = SERVICES.flatMap((s) => s.tools);

export function findToolOwner(toolName: string):
  | { service: ServiceDef; tool: ServiceDef["tools"][number] }
  | null {
  for (const service of SERVICES) {
    const tool = service.tools.find((t) => t.name === toolName);
    if (tool) return { service, tool };
  }
  return null;
}
