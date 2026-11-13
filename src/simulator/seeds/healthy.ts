// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { Row, Rows } from "../store";
import { trainingSeed } from "./training";

// The training environment with nothing wrong in it: the start of every scenario (src/scenarios). The
// Toolbox demo plants problems on purpose so its health checks have something to show; a scenario
// plants its own, so the Toolbox's findIssues must find exactly those (manual 8.3). Each fix below is
// one of the demo's problems, named by the check that finds it (environment-3d-explorer/src/health.ts).

export function healthySeed(): Rows {
  const rows = trainingSeed();
  const queue = (name: string) => rows.queue.find((q) => q.name === name)!;
  const user = (name: string) => rows.systemuser.find((u) => u.fullname === name)!;
  const removeRowsPointingAt = (id: string) => {
    for (const [table, list] of Object.entries(rows)) rows[table] = list.filter((r: Row) => !Object.entries(r).some(([k, v]) => k.startsWith("_") && v === id));
  };

  // no-members (Partner Desk): two representatives who can take calls.
  const partnerDesk = queue("Partner Desk");
  const ready = rows.systemuser.filter((u) => u.accessmode === 0 && !u.isdisabled && rows.bookableresource.some((r) => r._userid_value === u.systemuserid));
  ready.slice(-2).forEach((u, i) => rows.queuemembership.push({ queuemembershipid: `0000005b-0000-4000-8000-0000000009${String(i).padStart(2, "0")}`, queueid: partnerDesk.queueid, systemuserid: u.systemuserid }));

  // missing-queue (Resellers): the rule routes to the Partner Desk instead of a queue that's gone.
  for (const set of rows.msdyn_decisionruleset) {
    if (typeof set.msdyn_rulesetdefinition === "string") set.msdyn_rulesetdefinition = set.msdyn_rulesetdefinition.replace("000000a1-0000-4000-8000-000000000099", partnerDesk.queueid);
  }

  // routes-nowhere (Legacy Email): the old workstream is gone.
  const legacy = rows.msdyn_liveworkstream.find((w) => w.msdyn_name === "Legacy Email")!;
  rows.msdyn_liveworkstream = rows.msdyn_liveworkstream.filter((w) => w !== legacy);
  removeRowsPointingAt(legacy.msdyn_liveworkstreamid);

  // no-members and unreachable (Social Media): the queue nobody uses is gone.
  const social = queue("Social Media");
  rows.queue = rows.queue.filter((q) => q !== social);
  rows.queuemembership = rows.queuemembership.filter((m) => m.queueid !== social.queueid);
  removeRowsPointingAt(social.queueid);

  // unused-number and no-number: the unused number goes on the Partner Line's channel.
  const used = new Set(rows.msdyn_ocvoicechannelsetting.map((c) => c._msdyn_phonenumberid_value));
  const spare = rows.msdyn_ocphonenumber.find((p) => !used.has(p.msdyn_ocphonenumberid))!;
  rows.msdyn_ocvoicechannelsetting.find((c) => c.msdyn_name === "Partner Line channel")!._msdyn_phonenumberid_value = spare.msdyn_ocphonenumberid;

  // disabled-member (Emma Bos): a disabled user is no longer in any queue.
  const emma = user("Emma Bos");
  rows.queuemembership = rows.queuemembership.filter((m) => m.systemuserid !== emma.systemuserid);

  // no-resource (Saar de Boer): she's set up as a bookable resource.
  const saar = user("Saar de Boer");
  rows.bookableresource.push({ bookableresourceid: "000000a4-0000-4000-8000-000000000900", _userid_value: saar.systemuserid, name: saar.fullname, resourcetype: 3, statecode: 0 });
  return rows;
}
