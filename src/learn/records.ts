// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { KINDS, NodeKind } from "@toolbox/environment-3d-explorer/src/model";
import { Store } from "../simulator/store";
import conceptsJson from "../../content/concepts.json";

// From a record of the simulated environment (a Diagram shape's "Open record") to the concept that explains
// it, using the Toolbox's own shape kinds and their tables (environment-3d-explorer/src/model.ts KINDS).

export interface RecordLink { table: string; id: string }

// "<clientUrl>/main.aspx?pagetype=entityrecord&etn=queue&id=…" (tools/shared/src/xrm.ts recordUrl).
export function recordLink(url: string): RecordLink | undefined {
  try {
    const params = new URL(url).searchParams;
    const table = params.get("etn"), id = params.get("id");
    return table && id ? { table, id: id.replace(/[{}]/g, "").toLowerCase() } : undefined;
  } catch {
    return undefined;
  }
}

export function kindOf(store: Store, link: RecordLink): NodeKind | undefined {
  // Bots and representatives are both users: a bot is a non-interactive one (accessmode 4).
  if (link.table === "systemuser") return store.find("systemuser", link.id)?.accessmode === 4 ? "bot" : "agent";
  return (Object.entries(KINDS) as [NodeKind, { table?: string }][]).find(([, k]) => k.table === link.table)?.[0];
}

export function conceptForRecord(store: Store, link: RecordLink): string | undefined {
  const kind = kindOf(store, link);
  return kind ? conceptsJson.concepts.find((c) => (c as { kind?: string }).kind === kind)?.id : undefined;
}
