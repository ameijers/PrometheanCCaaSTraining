// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { LEARNER } from "../learner";
import { contractXml } from "../rules";
import { Rows } from "../store";

// What every Contact Center environment already has before anyone configures it: the root business unit's
// security roles, time zones, languages, hold music, the default capacity profiles, the managed decision
// contracts and the voicemail routing hub. Names and values come from the Toolbox code that reads them;
// each block says where.

const id = (prefix: string, n: number) => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Security roles the Toolbox's tools assign (team-builder/src/demoData.ts ROLE_NAMES).
export const ROLE_NAMES = ["Basic User", "Omnichannel agent", "Omnichannel supervisor", "System Administrator"];
// The root business unit of the demo (environment-3d-explorer/src/demoData.ts: "Contoso").
export const ROOT_UNIT = "000000ab-0000-4000-8000-000000000001";

export function platformRows(): Rows {
  return {
    // The root business unit's roles. Each business unit has its own copy (rules.ts); training.ts adds
    // them for every seeded unit.
    role: ROLE_NAMES.map((name, i) => ({ roleid: id("6a", i + 1), name, _businessunitid_value: ROOT_UNIT })),

    // Time zones (user-setup/src/demoData.ts; Dataverse codes, user-setup/src/model.ts FALLBACK_TIME_ZONE = 92).
    timezonedefinition: [
      { timezonedefinitionid: id("6b", 1), timezonecode: 92, standardname: "UTC", userinterfacename: "(GMT) Coordinated Universal Time" },
      { timezonedefinitionid: id("6b", 3), timezonecode: 105, standardname: "Romance Standard Time", userinterfacename: "(GMT+01:00) Brussels, Copenhagen, Madrid, Paris" },
      { timezonedefinitionid: id("6b", 4), timezonecode: 110, standardname: "W. Europe Standard Time", userinterfacename: "(GMT+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna" }
    ],

    // Voice languages and hold music (voice-workstream-builder/src/demoData.ts).
    msdyn_oclanguage: [
      ["English - United States", "en-US"], ["English - United Kingdom", "en-GB"], ["Dutch - Netherlands", "nl-NL"],
      ["Dutch - Belgium", "nl-BE"], ["German - Germany", "de-DE"], ["French - France", "fr-FR"]
    ].map(([name, locale], i) => ({ msdyn_oclanguageid: id("6c", i + 1), msdyn_languagename: name, msdyn_localecode: locale })),
    msdyn_ocphonemusic: ["Anthem", "Beep", "Transform", "Compose", "Parallel", "Personalize", "Deep Vision", "Tree Line", "Rising Sun"]
      .map((name, i) => ({ msdyn_ocphonemusicid: id("6d", i + 1), msdyn_name: name })),

    // The default voice capacity profiles (user-setup/src/model.ts DEFAULT_CAPACITY_PROFILES).
    msdyn_capacityprofile: [
      { msdyn_capacityprofileid: id("6e", 1), msdyn_name: "Default voice inbound", msdyn_uniquename: "msdyn_voice_inbound_profile", msdyn_defaultmaxunits: 1 },
      { msdyn_capacityprofileid: id("6e", 2), msdyn_name: "Default voice outbound", msdyn_uniquename: "msdyn_voice_default_outbound_profile", msdyn_defaultmaxunits: 1 }
    ],

    // The learner, as the environment's signed-in user (Xrm's userSettings point here).
    systemuser: [{
      systemuserid: LEARNER.userId, fullname: LEARNER.userName, domainname: "learner@contoso.com", internalemailaddress: "learner@contoso.com",
      isdisabled: false, accessmode: 0, _businessunitid_value: ROOT_UNIT
    }],

    // The platform's managed decision contracts, found by name (route-to-queue-builder/src/schema.ts,
    // voicemail-builder/src/schema.ts).
    msdyn_decisioncontract: [
      "Demand queue identification output contract",
      "Queue Overflow Management ruleset input contract", "Queue Overflow Management ruleset output contract",
      "Inqueue Overflow Management ruleset input contract", "Inqueue Overflow Management ruleset output contract"
    ].map((name, i) => ({ msdyn_decisioncontractid: id("6f", i + 1), msdyn_name: name, msdyn_contractdefinition: "<contract version=\"1\" />" })),

    // The voicemail record-routing hub, with its (empty) intake ruleset (voicemail-builder/src/schema.ts).
    msdyn_decisionruleset: [{ msdyn_decisionrulesetid: id("70", 1), msdyn_name: "Voicemail intake rules", msdyn_rulesetdefinition: "" }],
    msdyn_masterentityroutingconfiguration: [{
      msdyn_masterentityroutingconfigurationid: id("71", 1), msdyn_name: "Voicemail routing hub", msdyn_entitylogicalname: "msdyn_ocvoicemail", _msdyn_rulesetid_value: id("70", 1)
    }]
  };
}

// Every demo workstream gets the routing contract the platform gives a workstream (rules.ts).
export function routingContracts(rows: Rows): void {
  (rows.msdyn_liveworkstream ?? []).forEach((w, i) => {
    if (w._msdyn_routingcontractid_value) return;
    const contractId = id("72", i + 1);
    const variables = (rows.msdyn_ocliveworkstreamcontextvariable ?? []).filter((v) => v._msdyn_liveworkstreamid_value === w.msdyn_liveworkstreamid).map((v) => v.msdyn_name);
    (rows.msdyn_decisioncontract ??= []).push({ msdyn_decisioncontractid: contractId, msdyn_name: `new_${contractId.replace(/-/g, "")}`, msdyn_contractdefinition: contractXml(variables) });
    w._msdyn_routingcontractid_value = contractId;
  });
}
