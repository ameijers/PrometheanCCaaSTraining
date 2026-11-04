// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Rows } from "../store";
import { demoSeed } from "./demo";
import { withHours } from "./hours";
import { withPresence } from "./presence";
import { platformRows, ROLE_NAMES, routingContracts } from "./platform";

// The environment a learner starts in: the Toolbox's demo contact center (demo.ts) plus what every
// Contact Center environment has (platform.ts).

const id = (prefix: string, n: number) => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function trainingSeed(): Rows {
  return withPresence(withHours(ivrBots(uniqueNames(withExtras(demoSeed(), [platformRows()])))));
}

// The demo has an IVR bot on Customer Service only. Lessons that start at the IVR can use any line that
// has one, so the sales and support lines get theirs too: made-up bots, set up the way the demo's is
// (a non-interactive user as the workstream's bot, environment-3d-explorer/src/demoData.ts).
const BOTS: Record<string, string> = {
  "Retail Sales – Voice": "Contoso Sales IVR (Microsoft Copilot Studio)",
  "Technical Support – Voice": "Contoso Support IVR (Microsoft Copilot Studio)"
};

function ivrBots(rows: Rows): Rows {
  let n = 0;
  for (const ws of rows.msdyn_liveworkstream ?? []) {
    const name = BOTS[ws.msdyn_name];
    if (!name || ws._msdyn_bot_user_value) continue;
    const botId = id("92", ++n);
    rows.systemuser.push({ systemuserid: botId, fullname: name, accessmode: 4, isdisabled: false });
    ws._msdyn_bot_user_value = botId;
  }
  return rows;
}

// The demo's agents share names (20 first names over 60 agents). A learner needs to tell them apart,
// so a repeated name gets another (made-up) last name.
const MORE_LAST_NAMES = ["Peters", "Hendriks", "van Dijk", "Dekker", "Brouwer", "de Wit", "Dijkstra", "Smits", "de Graaf", "van der Meer",
  "Kok", "Jacobs", "de Haan", "Vermeulen", "van den Berg", "van der Linden", "Kuipers", "Schouten", "Willems", "Maas"];

export function uniqueNames(rows: Rows): Rows {
  const taken = new Set<string>();
  for (const user of rows.systemuser ?? []) {
    let name = String(user.fullname ?? "");
    if (taken.has(name)) {
      const first = name.split(" ")[0];
      const last = MORE_LAST_NAMES.find((l) => !taken.has(`${first} ${l}`));
      if (last) name = `${first} ${last}`;
      user.fullname = name;
    }
    taken.add(name);
  }
  return rows;
}

// Adds rows to a seed the way the platform would have them: every business unit with its own roles and a
// default team, every workstream with a routing contract, and no capacity profile or rating model twice.
export function withExtras(rows: Rows, extras: Rows[]): Rows {
  // The demo already has "Default voice inbound": give it the platform's unique name instead of adding
  // a second profile with the same name.
  for (const extra of extras) {
    extra.msdyn_capacityprofile = (extra.msdyn_capacityprofile ?? []).filter((p) => {
      const same = (rows.msdyn_capacityprofile ?? []).find((d) => d.msdyn_name === p.msdyn_name);
      if (same) { same.msdyn_uniquename ??= p.msdyn_uniquename; same.msdyn_defaultmaxunits ??= p.msdyn_defaultmaxunits; }
      return !same;
    });
  }
  for (const extra of extras) {
    for (const [table, list] of Object.entries(extra)) {
      const target = (rows[table] ??= []);
      const key = Object.keys(list[0] ?? {})[0];
      // A row that's already there (the same id) isn't added twice.
      for (const row of list) if (!target.some((r) => key && r[key] === row[key])) target.push(row);
    }
  }

  // One rating model when there are two: the demo's three levels become values of the other model, so a
  // rating such as "3" means one thing (skill-assignment refuses a rating that's in two models).
  const models = rows.ratingmodel ?? [];
  if (models.length > 1) {
    const model = models[models.length - 1];
    const level: Record<string, string> = { Beginner: "Fair", Intermediate: "Good", Expert: "Excellent" };
    const target = (name: string) => rows.ratingvalue.find((v) => v._ratingmodel_value === model.ratingmodelid && v.name === level[name]);
    const old = rows.ratingvalue.filter((v) => v._ratingmodel_value !== model.ratingmodelid);
    for (const link of rows.bookableresourcecharacteristic ?? []) {
      const from = old.find((v) => v.ratingvalueid === link._ratingvalue_value);
      if (from && target(from.name)) link._ratingvalue_value = target(from.name)!.ratingvalueid;
    }
    rows.ratingvalue = rows.ratingvalue.filter((v) => v._ratingmodel_value === model.ratingmodelid);
    rows.ratingmodel = [model];
  }

  routingContracts(rows);
  let n = 0;
  // In Dataverse every team belongs to a business unit and has a team type. The demo data leaves both out:
  // its teams go to the root unit, as owner teams (teamtype 0).
  const rootUnit = (rows.businessunit ?? []).find((u) => !u._parentbusinessunitid_value);
  for (const team of rows.team ?? []) {
    if (!team._businessunitid_value && rootUnit) team._businessunitid_value = rootUnit.businessunitid;
    team.teamtype ??= 0;
  }
  for (const unit of rows.businessunit ?? []) {
    // Every business unit has its own copy of each security role (rules.ts).
    for (const name of ROLE_NAMES) {
      const has = (rows.role ??= []).some((r) => r.name === name && r._businessunitid_value === unit.businessunitid);
      if (!has) rows.role.push({ roleid: id("90", ++n), name, _businessunitid_value: unit.businessunitid });
    }
    // Every business unit has a default team (rules.ts).
    if (!(rows.team ??= []).some((t) => t.isdefault && t._businessunitid_value === unit.businessunitid)) {
      rows.team.push({ teamid: id("91", ++n), name: unit.name, isdefault: true, teamtype: 0, _businessunitid_value: unit.businessunitid });
    }
  }
  // Skills are characteristics of type 1 (skill-assignment/src/model.ts SKILL_TYPE).
  (rows.characteristic ?? []).forEach((c) => { c.characteristictype ??= 1; });
  return rows;
}
