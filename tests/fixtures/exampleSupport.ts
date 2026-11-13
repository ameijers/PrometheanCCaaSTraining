// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { Rows } from "../../src/simulator/store";
import { demoSeed } from "../../src/simulator/seeds/demo";
import { platformRows, ROOT_UNIT } from "../../src/simulator/seeds/platform";
import { withExtras } from "../../src/simulator/seeds/training";

// The records the Toolbox's example CSVs (tools/*/examples/*.csv) refer to by name and don't create
// themselves. Only the tests use them (tests/tools/examples.test.ts); a learner's environment doesn't
// have them. Names come from each tool's own sample data
// (tools/*/src/demoData.ts), which the examples were written against.

const id = (prefix: string, n: number) => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VOICE_QUEUE = 192350002;
const VOICE_STREAM = 192440000;
const RESOURCE_USER = 3;
const SALES = id("80", 1), SERVICE = id("80", 2);

export function exampleSupportRows(): Rows {
  const users = [
    // team-builder, user-setup and queue-builder sample data.
    { systemuserid: id("81", 1), fullname: "Anna de Vries", domainname: "anna@contoso.com", internalemailaddress: "anna@contoso.com", unit: SALES },
    { systemuserid: id("81", 2), fullname: "Bram Jansen", domainname: "bram@contoso.com", internalemailaddress: "bram@contoso.com", unit: SALES },
    { systemuserid: id("81", 3), fullname: "Chris Peters", domainname: "chris@contoso.com", internalemailaddress: "chris@contoso.com", unit: SALES },
    { systemuserid: id("81", 4), fullname: "Dana Smit", domainname: "dana@contoso.com", internalemailaddress: "dana.smit@contoso.com", unit: SERVICE },
    { systemuserid: id("81", 5), fullname: "Eva Mulder", domainname: "eva@contoso.com", internalemailaddress: "eva@contoso.com", unit: SALES, disabled: true }
  ];
  return {
    // business-unit-builder's example adds "Sales – Partners" under "Sales"; team-builder's uses "Sales" and "Service".
    businessunit: [
      { businessunitid: SALES, name: "Sales", _parentbusinessunitid_value: ROOT_UNIT },
      { businessunitid: SERVICE, name: "Service", _parentbusinessunitid_value: ROOT_UNIT }
    ],
    systemuser: users.map((u) => ({
      systemuserid: u.systemuserid, fullname: u.fullname, domainname: u.domainname, internalemailaddress: u.internalemailaddress,
      isdisabled: !!u.disabled, accessmode: 0, _businessunitid_value: u.unit
    })),
    // capacity-profile-assignment's sample.
    msdyn_capacityprofile: [{ msdyn_capacityprofileid: id("8a", 1), msdyn_name: "Escalation profile", msdyn_uniquename: "msdyn_escalationprofile", msdyn_defaultmaxunits: 1 }],
    // Anna is already a bookable resource in the queue-membership and skill-assignment samples.
    bookableresource: [{ bookableresourceid: id("82", 1), name: "Anna de Vries", _userid_value: id("81", 1), resourcetype: RESOURCE_USER }],
    // queue-builder and voice-workstream-builder samples.
    msdyn_operatinghour: [
      { msdyn_operatinghourid: id("83", 1), msdyn_name: "Workdays" },
      { msdyn_operatinghourid: id("83", 2), msdyn_name: "24/7" }
    ],
    // Queues the voice-workstream-builder, route-to-queue-builder and voicemail-builder examples name.
    queue: ["Sales Fallback", "Support Fallback", "Callbacks", "Claims Fallback", "Sales – Orders", "Support – Returns", "Support – Technical", "Sales – Voice", "Support – Voice", "Billing – Voice"]
      .map((name, i) => ({ queueid: id("84", i + 1), name, msdyn_queuetype: VOICE_QUEUE, msdyn_isomnichannelqueue: true })),
    // route-to-queue-builder's example adds rules to "Billing – Voice", and voice-channel-builder's adds channels
    // to "Contoso Voice" and "Contoso Voice Sales"; no other example creates them.
    msdyn_liveworkstream: ["Billing – Voice", "Contoso Voice", "Contoso Voice Sales"].map((name, i) => ({
      msdyn_liveworkstreamid: id("85", i + 1), msdyn_name: name, msdyn_streamsource: VOICE_STREAM, msdyn_direction: 0, msdyn_enablevoicev2: true,
      _msdyn_defaultqueue_value: id("84", 10)
    })),
    // Phone numbers the voice-workstream-builder and profile-builder examples use, all in fiction ranges
    // (examples.ts swaps the two non-fiction numbers in the CSVs for these).
    msdyn_ocphonenumber: [
      { msdyn_ocphonenumberid: id("86", 1), msdyn_phonenumber: "+44 20 7946 0201", msdyn_phoneinboundenabled: true, msdyn_phoneoutboundenabled: true },
      { msdyn_ocphonenumberid: id("86", 2), msdyn_phonenumber: "+44 20 7946 0202", msdyn_phoneinboundenabled: true, msdyn_phoneoutboundenabled: true },
      { msdyn_ocphonenumberid: id("86", 3), msdyn_phonenumber: "+1 800 555 0100", msdyn_phoneinboundenabled: false, msdyn_phoneoutboundenabled: true }
    ],
    // skill-assignment's sample skills and rating model.
    characteristic: [{ characteristicid: id("87", 1), name: "Technical support", characteristictype: 1 }],
    ratingmodel: [{ ratingmodelid: id("88", 1), name: "Skills Rating Model" }],
    ratingvalue: ["Poor", "Fair", "Good", "Very Good", "Excellent"].map((name, i) => ({ ratingvalueid: id("89", i + 1), name, value: i + 1, _ratingmodel_value: id("88", 1) }))
  };
}

// The training environment plus these records: what the example-CSV tests start from.
export function examplesSeed(): Rows {
  return withExtras(demoSeed(), [platformRows(), exampleSupportRows()]);
}
