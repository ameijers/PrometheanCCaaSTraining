// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { Rows } from "../store";

// Customers who call: a few made-up accounts and contacts, so a call can be matched to a customer.
// Learn (Identify customers automatically): "You can identify incoming voice calls if the phone number of
// the incoming call matches the number for a contact in the mobile phone or account phone field."
//
// Phone numbers are fiction-only ranges: mobiles from Ofcom's drama range 07700 900000–900999, account
// phones from the Leeds drama range 0113 496 0000–0999. One mobile number is shared by two contacts, so a
// learner can see that a number that matches more than one record isn't linked.

const id = (prefix: string, n: number) => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SHARED_MOBILE = "+44 7700 900461";
export const UNKNOWN_NUMBER = "+44 7700 900999";

const ACCOUNTS = [
  { name: "Fabrikam Garden Supplies", telephone1: "+44 113 496 0217" },
  { name: "Northwind Builders", telephone1: "+44 113 496 0388" }
];

const CONTACTS = [
  { firstname: "Sophie", lastname: "Turner", mobilephone: "+44 7700 900123", emailaddress1: "sophie.turner@example.com", account: 0 },
  { firstname: "Daniel", lastname: "Okafor", mobilephone: "+44 7700 900245", emailaddress1: "daniel.okafor@example.com", account: 1 },
  { firstname: "Priya", lastname: "Shah", mobilephone: "+44 7700 900372", emailaddress1: "priya.shah@example.net" },
  { firstname: "Tom", lastname: "Baker", mobilephone: SHARED_MOBILE, emailaddress1: "tom.baker@example.org" },
  { firstname: "Emma", lastname: "Baker", mobilephone: SHARED_MOBILE, emailaddress1: "emma.baker@example.org" }
];

export function withCustomers(rows: Rows): Rows {
  rows.account ??= [];
  rows.contact ??= [];
  ACCOUNTS.forEach((a, i) => {
    if (!rows.account.some((r) => r.accountid === id("a1", i + 1))) rows.account.push({ accountid: id("a1", i + 1), name: a.name, telephone1: a.telephone1, statecode: 0 });
  });
  CONTACTS.forEach((c, i) => {
    if (rows.contact.some((r) => r.contactid === id("c1", i + 1))) return;
    rows.contact.push({
      contactid: id("c1", i + 1), firstname: c.firstname, lastname: c.lastname, fullname: `${c.firstname} ${c.lastname}`,
      mobilephone: c.mobilephone, emailaddress1: c.emailaddress1, statecode: 0,
      ...(c.account === undefined ? {} : { _parentcustomerid_value: id("a1", c.account + 1) })
    });
  });
  return rows;
}
