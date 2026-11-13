// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { Row, Store } from "../simulator/store";

// Who is calling. Learn (Identify customers automatically): a voice call is matched when its number
// "matches the number for a contact in the mobile phone or account phone field", and "If a search returns
// more than one account, contact, or case, nothing is linked." Cases aren't part of the training.

export interface Customer {
  kind: "contact" | "account";
  id: string;
  name: string;
}

export type Identification =
  | { status: "identified"; customer: Customer; field: string }
  | { status: "several"; count: number }
  | { status: "unknown" }
  | { status: "no number" };

// Phone numbers compare by their digits: "+44 7700 900123" and "+447700900123" are the same.
const digits = (n: unknown) => String(n ?? "").replace(/\D/g, "");

export function identifyCaller(store: Store, number: string | undefined): Identification {
  if (!number || !digits(number)) return { status: "no number" };
  const d = digits(number);
  const contacts = store.table("contact").filter((c) => c.statecode !== 1 && digits(c.mobilephone) === d);
  const accounts = store.table("account").filter((a) => a.statecode !== 1 && digits(a.telephone1) === d);
  const found = contacts.length + accounts.length;
  if (found > 1) return { status: "several", count: found };
  if (contacts.length) return { status: "identified", customer: { kind: "contact", id: contacts[0].contactid, name: String(contacts[0].fullname) }, field: "Mobile Phone" };
  if (accounts.length) return { status: "identified", customer: { kind: "account", id: accounts[0].accountid, name: String(accounts[0].name) }, field: "Main Phone" };
  return { status: "unknown" };
}

// In words, for the call trace and the notification.
export function identificationText(i: Identification): string {
  switch (i.status) {
    case "identified": return `The caller's number matches the ${i.field} of ${i.customer.kind === "contact" ? "contact" : "account"} ${i.customer.name}, so the call is linked to them.`;
    case "several": return `The caller's number matches ${i.count} customer records, so nothing is linked: the representative searches for the customer.`;
    case "unknown": return "The caller's number doesn't match any contact or account, so no customer is linked.";
    default: return "The caller's number isn't known, so no customer is linked.";
  }
}

// The training's row for a call (schema.ts training_call), if any.
export function callInfo(store: Store, workItemId: string): Row | undefined {
  return store.table("training_call").find((c) => c.workitemid === workItemId);
}

// The customer linked to a call, if any.
export function customerOfCall(store: Store, w: Row): (Customer & { row: Row }) | undefined {
  const info = callInfo(store, w.activityid);
  const kind = info?.customerkind as Customer["kind"] | undefined;
  if (!kind || !info?.customerid) return undefined;
  const row = store.find(kind, info.customerid);
  if (!row) return undefined;
  return { kind, id: info.customerid, name: String(kind === "contact" ? row.fullname : row.name), row };
}

// What the workspace shows for the caller: the customer's name, else the number, else "Unknown caller".
export function customerName(store: Store, w: Row): string {
  const info = callInfo(store, w.activityid);
  return customerOfCall(store, w)?.name ?? (info?.fromnumber ? String(info.fromnumber) : "Unknown caller");
}

// The customer's other conversations, newest first: the timeline on the Active Conversation form.
export function earlierCalls(store: Store, w: Row): Row[] {
  const me = customerOfCall(store, w);
  if (!me) return [];
  const theirs = new Set(store.table("training_call").filter((c) => c.customerid === me.id).map((c) => c.workitemid));
  return store.table("msdyn_ocliveworkitem")
    .filter((x) => x.activityid !== w.activityid && theirs.has(x.activityid))
    .sort((a, b) => String(b.createdon).localeCompare(String(a.createdon)));
}

// Records who called: the number, and the customer when exactly one record matches.
export function recordCaller(store: Store, workItemId: string, from: string | undefined): Identification {
  const found = identifyCaller(store, from);
  store.insert("training_call", {
    workitemid: workItemId, fromnumber: from ?? "",
    ...(found.status === "identified" ? { customerkind: found.customer.kind, customerid: found.customer.id } : {})
  });
  return found;
}

// The numbers a learner can call from on the Phone tab: each contact's mobile, each account's phone, and
// a number nobody has.
export function callerNumbers(store: Store): { number: string; label: string }[] {
  const seen = new Set<string>();
  const out: { number: string; label: string }[] = [];
  for (const c of store.table("contact").filter((x) => x.mobilephone)) {
    const shared = store.table("contact").filter((x) => digits(x.mobilephone) === digits(c.mobilephone)).length > 1;
    if (seen.has(digits(c.mobilephone))) continue;
    seen.add(digits(c.mobilephone));
    out.push({ number: String(c.mobilephone), label: shared ? `${c.mobilephone} · shared by ${store.table("contact").filter((x) => digits(x.mobilephone) === digits(c.mobilephone)).map((x) => x.fullname).join(" and ")}` : `${c.mobilephone} · ${c.fullname} (mobile)` });
  }
  for (const a of store.table("account").filter((x) => x.telephone1)) out.push({ number: String(a.telephone1), label: `${a.telephone1} · ${a.name} (account phone)` });
  return out;
}
