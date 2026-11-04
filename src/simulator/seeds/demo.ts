// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { demoRaw } from "@toolbox/environment-3d-explorer/src/demoData";
import { RawEnvironment, VOICE_STREAM } from "@toolbox/environment-3d-explorer/src/graph";
import { Row, Rows } from "../store";

// The phase 1 seed: the Toolbox's own demo contact center (demoRaw) turned into table rows.
//
// Changes on the way in. forTraining() makes the first two, and tests apply it to demoRaw too, so
// they compare like with like:
// - Phone numbers become numbers reserved for fiction (Ofcom's London drama range, +44 20 7946 0000
//   to 0999), because demoRaw's numbers aren't in a fiction range.
// - Rule conditions are written operator="==", the spelling Route-to-Queue Builder writes and the
//   Visual Routing Tester reads (route-to-queue-builder/src/rules.ts). demoRaw writes "equals", which
//   the routing tester warns about.
// - Columns the Toolbox filters on but demoRaw leaves out get the values those filters expect, each
//   noted below with the Toolbox file that relies on it.

const LONDON_DRAMA = "+44 20 7946 0";

export function forTraining(raw: RawEnvironment): RawEnvironment {
  const copy: RawEnvironment = JSON.parse(JSON.stringify(raw));
  copy.rulesets.forEach((r) => {
    if (typeof r.msdyn_rulesetdefinition === "string") r.msdyn_rulesetdefinition = r.msdyn_rulesetdefinition.replace(/<condition operator="equals">/g, '<condition operator="==">');
  });
  const numbers = [...new Set(copy.phoneNumbers.map((p) => p.msdyn_phonenumber as string))];
  const swap = new Map(numbers.map((n, i) => [n, `${LONDON_DRAMA}${String(100 + i).padStart(3, "0")}`]));
  copy.phoneNumbers.forEach((p) => { p.msdyn_phonenumber = swap.get(p.msdyn_phonenumber); });
  return copy;
}

// Fixed ids for rows demoRaw has no id for, so a seed always loads the same.
const seedId = (prefix: string, n: number) => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Skill levels in demoRaw ("Beginner", "Intermediate", "Expert") as one rating model.
const RATING_MODEL = seedId("5e", 1);
const RATINGS = ["Beginner", "Intermediate", "Expert"];
// systemuser.accessmode: 0 Read-Write (interactive), 4 Non-interactive (agent-readiness-checker/src/model.ts).
const INTERACTIVE = 0, NON_INTERACTIVE = 4;
// bookableresource.resourcetype for a user (the Toolbox reads with resourcetype eq 3, user-setup/src/model.ts).
const RESOURCE_USER = 3;

export function demoSeed(): Rows {
  return seedFromRaw(forTraining(demoRaw()));
}

export function seedFromRaw(raw: RawEnvironment): Rows {
  const rows: Rows = {};
  const add = (table: string, list: Row[] | undefined) => { (rows[table] ??= []).push(...(list ?? []).map((r) => ({ ...r }))); };
  let n = 0;

  add("msdyn_ocphonenumber", raw.phoneNumbers);
  add("msdyn_ocvoicechannelsetting", raw.channels);
  // Visual Routing Tester and Agent Readiness Checker take inbound voice workstreams as
  // msdyn_enablevoicev2 = true and msdyn_direction = 0 (Inbound).
  add("msdyn_liveworkstream", raw.workstreams.map((w) => ({
    ...w, statecode: 0, ...(w.msdyn_streamsource === VOICE_STREAM ? { msdyn_enablevoicev2: true, msdyn_direction: 0 } : { msdyn_enablevoicev2: false })
  })));
  add("msdyn_routingconfiguration", raw.routingConfigurations.map((c) => ({ msdyn_name: "Routing configuration", ...c })));
  add("msdyn_routingconfigurationstep", raw.routingSteps.map((s, i) => ({ msdyn_routingconfigurationstepid: seedId("5a", i + 1), msdyn_name: "Route to queue", msdyn_steporder: 1, ...s })));
  add("msdyn_decisionruleset", [...raw.rulesets, ...(raw.overflowRulesets ?? []).map((r, i) => ({ msdyn_name: `Overflow rules ${i + 1}`, ...r }))]);
  // Environment Diagram and the bulk tools read queues with msdyn_isomnichannelqueue eq true and statecode eq 0.
  add("queue", raw.queues.map((q) => ({ ...q, msdyn_isomnichannelqueue: true, statecode: 0 })));
  add("queuemembership", raw.memberships.map((m) => ({ queuemembershipid: seedId("5b", ++n), ...m })));
  add("systemuser", [
    ...raw.users.map((u) => ({ ...u, accessmode: INTERACTIVE })),
    // Bots are users too, but not interactive ones (environment-3d-explorer/src/dataverse.ts).
    ...(raw.botUsers ?? []).map((u) => ({ ...u, accessmode: NON_INTERACTIVE, isdisabled: false }))
  ]);
  add("bookableresource", raw.resources.map((r) => ({ ...r, resourcetype: RESOURCE_USER, statecode: 0 })));

  // Skills: characteristic rows, a rating model with its values, and the per-resource links.
  const skills = new Map<string, string>();
  raw.resourceSkills.forEach((s) => skills.set(s.Characteristic.characteristicid, s.Characteristic.name));
  add("characteristic", [...skills].map(([characteristicid, name]) => ({ characteristicid, name })));
  add("ratingmodel", [{ ratingmodelid: RATING_MODEL, name: "Skill level" }]);
  add("ratingvalue", RATINGS.map((name, i) => ({ ratingvalueid: seedId("5f", i + 1), name, value: i + 1, _ratingmodel_value: RATING_MODEL })));
  add("bookableresourcecharacteristic", raw.resourceSkills.map((s, i) => ({
    bookableresourcecharacteristicid: seedId("5c", i + 1), _resource_value: s._resource_value, _characteristic_value: s.Characteristic.characteristicid,
    _ratingvalue_value: s.RatingValue?.name ? seedId("5f", RATINGS.indexOf(s.RatingValue.name) + 1) : null
  })));

  add("msdyn_ocliveworkstreamcontextvariable", raw.variables);
  add("msdyn_operatinghour", raw.operatingHours);
  add("msdyn_overflowactionconfig", raw.overflowActions);
  add("msdyn_capacityprofile", raw.capacityProfiles);
  add("msdyn_liveworkstreamcapacityprofile", (raw.workstreamCapacity ?? []).map((c, i) => ({ msdyn_liveworkstreamcapacityprofileid: seedId("5d", i + 1), ...c })));
  add("msdyn_bookableresourcecapacityprofile", (raw.resourceCapacity ?? []).map((c, i) => ({ msdyn_bookableresourcecapacityprofileid: seedId("5d", 1000 + i), ...c })));
  add("businessunit", raw.businessUnits);
  add("team", raw.teams);
  add("teammembership", (raw.teamMemberships ?? []).map((m, i) => ({ teammembershipid: seedId("5e", 100 + i), ...m })));
  return rows;
}
