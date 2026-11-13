// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { TABLES } from "./schema";
import { newGuid, Row, Store } from "./store";

// What the platform does on its own when a record is written. Every rule here names its source: the
// Toolbox code that relies on it (tested live there) or a Microsoft Learn article. Add a rule only with
// a source.

// Many-to-many relationships the Toolbox associates through $ref or actions, with their intersect tables.
export interface Relationship { name: string; intersect: string; tables: [string, string]; columns: [string, string] }

export const RELATIONSHIPS: Relationship[] = [
  // queue-builder/src/queueSchema.ts MEMBERSHIP_RELATIONSHIP; read back as queuemembership(queueid, systemuserid).
  { name: "queuemembership_association", intersect: "queuemembership", tables: ["queue", "systemuser"], columns: ["queueid", "systemuserid"] },
  // team-builder/src/dataverse.ts; read back as teamroles(teamid, roleid).
  { name: "teamroles_association", intersect: "teamroles", tables: ["team", "role"], columns: ["teamid", "roleid"] },
  // user-setup/src/dataverse.ts; read back as systemuserroles(systemuserid, roleid).
  { name: "systemuserroles_association", intersect: "systemuserroles", tables: ["systemuser", "role"], columns: ["systemuserid", "roleid"] },
  // Read back as teammembership(teamid, systemuserid); written through AddMembersTeam (user-setup).
  { name: "teammembership_association", intersect: "teammembership", tables: ["team", "systemuser"], columns: ["teamid", "systemuserid"] }
];

// Columns the platform sets on every new or changed record, where the table has them.
export function stamp(logicalName: string, row: Row, creating: boolean, now: Date): void {
  const columns = TABLES[logicalName].columns;
  const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (creating && columns.createdon && row.createdon === undefined) row.createdon = at;
  if (columns.modifiedon) row.modifiedon = at;
  // A yes/no column left out of a create gets its default. Simplified: the simulator uses "No" for all of
  // them. The Toolbox relies on it for team.isdefault (user-setup and team-builder read isdefault eq false).
  if (creating) {
    for (const [name, column] of Object.entries(columns)) if (column.type === "bool" && row[name] === undefined) row[name] = false;
  }
}

// Run after a record is created.
export function afterCreate(store: Store, logicalName: string, row: Row): void {
  switch (logicalName) {
    case "businessunit": {
      // "The platform gives every business unit a default team (and its own copy of each security role)."
      // business-unit-builder/src/execute.ts, which checks for the team after creating a unit.
      const id = row.businessunitid;
      store.insert("team", { name: row.name, isdefault: true, teamtype: 0, _businessunitid_value: id });
      const root = store.table("businessunit").find((u) => !u._parentbusinessunitid_value);
      const rootRoles = root ? store.table("role").filter((r) => r._businessunitid_value === root.businessunitid) : [];
      rootRoles.forEach((r) => store.insert("role", { name: r.name, _businessunitid_value: id }));
      break;
    }
    case "msdyn_liveworkstream": {
      // "The platform completes a new workstream (routing contract, templates, record identification) but
      // doesn't give it a routing configuration." voice-workstream-builder/src/execute.ts (confirmed live).
      // The contract's shape is the one route-to-queue-builder/IMPLEMENTATION_STATUS.md describes.
      if (!row._msdyn_routingcontractid_value) {
        const contract = store.insert("msdyn_decisioncontract", { msdyn_name: `new_${newGuid().replace(/-/g, "")}`, msdyn_contractdefinition: contractXml([]) });
        store.update("msdyn_liveworkstream", row.msdyn_liveworkstreamid, { _msdyn_routingcontractid_value: contract.msdyn_decisioncontractid });
      }
      break;
    }
    case "msdyn_ocliveworkstreamcontextvariable": {
      // The platform adds a new text variable to its workstream's routing contract; Route-to-Queue Builder
      // waits for it before writing rules (route-to-queue-builder/src/execute.ts, IMPLEMENTATION_STATUS.md).
      const ws = row._msdyn_liveworkstreamid_value ? store.find("msdyn_liveworkstream", row._msdyn_liveworkstreamid_value) : undefined;
      const contract = ws?._msdyn_routingcontractid_value ? store.find("msdyn_decisioncontract", ws._msdyn_routingcontractid_value) : undefined;
      if (contract && row.msdyn_name) {
        const names = [...String(contract.msdyn_contractdefinition ?? "").matchAll(/<variable name="([^"]+)"/g)].map((m) => m[1]);
        if (!names.includes(row.msdyn_name)) store.update("msdyn_decisioncontract", contract.msdyn_decisioncontractid, { msdyn_contractdefinition: contractXml([...names, row.msdyn_name]) });
      }
      break;
    }
  }
}

// A workstream's routing contract, in the shape route-to-queue-builder/IMPLEMENTATION_STATUS.md describes.
export function contractXml(variables: string[]): string {
  return `<contract version="1">\n  <entity logical-name="msdyn_ocliveworkitem" key="msdyn_ocliveworkitem" />\n  <complex key="liveworkitemcontext">\n${variables.map((v) => `    <variable name="${v}" data-type="string" />\n`).join("")}  </complex>\n</contract>`;
}
