import type { ServiceDef } from "../types.js";
import { hIndex } from "./h-index.js";
import { hSeal } from "./h-seal.js";
import { hGrant } from "./h-grant.js";
import { hRelay } from "./h-relay.js";

export const SERVICES: ServiceDef[] = [hIndex, hSeal, hGrant, hRelay];

export const ALL_TOOLS = SERVICES.flatMap((s) =>
  s.tools.map((t) => ({ ...t, _serviceId: s.id, _baseUrl: s.baseUrl })),
);

export function findToolOwner(toolName: string):
  | { service: ServiceDef; tool: ServiceDef["tools"][number] }
  | null {
  for (const service of SERVICES) {
    const tool = service.tools.find((t) => t.name === toolName);
    if (tool) return { service, tool };
  }
  return null;
}
