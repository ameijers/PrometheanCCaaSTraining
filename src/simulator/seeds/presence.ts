// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ASSIGNMENT_METHODS, QUEUE_TYPES } from "@toolbox/queue-builder/src/queueSchema";
import { PRESENCES } from "@toolbox/voice-workstream-builder/src/voiceSchema";
import { Rows } from "../store";

// Who's at work: each representative's presence, and what the workstreams and queues need for
// assignment (src/calls/assignment.ts). The demo has none of this.
//
// - Presences: the five base presences, with the names the admin center shows (content/admin-pages/pages.json)
//   and the option values the Toolbox uses (voice-workstream-builder/src/voiceSchema.ts PRESENCES,
//   environment-3d-explorer/src/live.ts BASE_PRESENCE).
// - Agent status (msdyn_agentstatus): signed in or not, and the current presence, as the Live view reads it.
//   Most representatives are available; a few are away or signed out, so assignment has choices to make.
// - Allowed presences on each voice workstream: Available and Busy. A choice for the training's data, not
//   a product default (Learn: "Select the presence statuses in which representatives can be assigned work",
//   Create and manage workstreams).
// - Assignment method on each voice queue that has none: Least active, which Learn says "is the default
//   selection when you create a voice or messaging queue" (Assignment methods for queues).

const id = (prefix: string, n: number) => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const PRESENCE_NAMES: Record<number, string> = {
  [PRESENCES.Available]: "Available", [PRESENCES.Busy]: "Busy", [PRESENCES["Busy - DND"]]: "Busy - DND", [PRESENCES.Away]: "Away", [PRESENCES.Offline]: "Offline"
};

export const presenceId = (base: number) => id("6f", Object.keys(PRESENCE_NAMES).indexOf(String(base)) + 1);

export function withPresence(rows: Rows): Rows {
  rows.msdyn_presence ??= [];
  for (const [base, name] of Object.entries(PRESENCE_NAMES)) {
    if (!rows.msdyn_presence.some((p) => p.msdyn_basepresencestatus === Number(base))) rows.msdyn_presence.push({ msdyn_presenceid: presenceId(Number(base)), msdyn_name: name, msdyn_basepresencestatus: Number(base) });
  }

  // Representatives: interactive, enabled users who are bookable resources.
  const resources = new Set((rows.bookableresource ?? []).map((r) => r._userid_value));
  const people = (rows.systemuser ?? []).filter((u) => u.accessmode === 0 && !u.isdisabled && resources.has(u.systemuserid));
  rows.msdyn_agentstatus ??= [];
  people.forEach((u, i) => {
    if (rows.msdyn_agentstatus.some((s) => s._msdyn_agentid_value === u.systemuserid)) return;
    const away = i % 5 === 3, signedOut = i % 7 === 6;
    rows.msdyn_agentstatus.push({
      msdyn_agentstatusid: id("70", i + 1), _msdyn_agentid_value: u.systemuserid, msdyn_isagentloggedin: !signedOut, msdyn_isblockedbysomeprofile: false,
      _msdyn_currentpresenceid_value: presenceId(signedOut ? PRESENCES.Offline : away ? PRESENCES.Away : PRESENCES.Available), modifiedon: "2026-11-03T08:00:00Z"
    });
  });

  for (const ws of rows.msdyn_liveworkstream ?? []) {
    if (ws.msdyn_enablevoicev2 && !ws.msdyn_allowedpresences) ws.msdyn_allowedpresences = `${PRESENCES.Available},${PRESENCES.Busy}`;
  }
  for (const q of rows.queue ?? []) {
    if (q.msdyn_queuetype === QUEUE_TYPES.Voice && q.msdyn_assignmentstrategy == null) q.msdyn_assignmentstrategy = ASSIGNMENT_METHODS["Least active"];
  }
  return rows;
}
