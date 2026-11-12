// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ASSIGNMENT_LABELS } from "../admin/actions";
import { newGuid, Row, Store } from "../simulator/store";
import { answersOf, matchingOf, meetsAll, needsText, requiredSkills, skillScore } from "./skills";

// Who gets a call waiting in a queue (manual 5.2 step 7). Simplified: the out-of-the-box assignment
// methods only, as Microsoft Learn describes them, with the representative's presence and capacity.
//
// Sources:
// - Assignment methods for queues, https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/assignment-methods (ms.date 2026-10-30)
//   "Highest capacity": "assigns a work item to a service representative with the highest available capacity ...
//   presence that matches one of the allowed presences in the workstream. If more than one representative is
//   available with the same capacity, the work item is assigned based on the round-robin order."
//   "Advanced round robin": "The initial order is based on when a user is added to the queue. Then, the order is
//   updated based on assignments." "The ordering for round robin assignment is maintained queue-wise."
//   "Least active": "uses 'the time since last capacity is released' ..."; scenario 1 picks the representative
//   with fewer concurrent conversations, scenario 2 breaks a tie with the last capacity release time.
//   "When eligible representatives aren't found for the work items, the assignment cycle keeps retrying."
// - Create and manage workstreams, https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/create-workstreams
//   "Allowed presences: Select the presence statuses in which representatives can be assigned work."
//   "Block capacity for wrap up ... Always block: Is the default selection": capacity is used until the
//   conversation is closed, wrap-up included.
// - Create and manage capacity profiles, https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/capacity-profiles
//   "Work item limit: Number of units of the work type that you can assign to the representative"; a
//   representative's own limit (msdyn_maxunits) overrides the profile's default; "Users must be configured as a
//   bookable resource to be assigned the capacity profile."
// - Skills: Exact Match and Closest Match, simplified (src/calls/skills.ts).
// Not simulated: queue priority across queues, custom assignment rulesets, unit-based capacity, and presence
// changing by itself.

// msdyn_ocliveworkitem.statuscode, as the Toolbox reads it (environment-3d-explorer/src/live.ts):
// 1 Open (waiting), 2 Active, 4 Closed, 5 Wrap-up. statecode 0 is open, 1 closed.
export const STATUS = { open: 1, active: 2, closed: 4, wrapUp: 5 } as const;

export type Method = "Least active" | "Highest capacity" | "Advanced round robin" | "No auto assignment";

export interface Representative {
  id: string;
  name: string;
  presence: string;
  // Why they can't take this call, or nothing when they can.
  notNow?: string;
  free: number;
  open: number;
  lastAssigned?: string;
  lastReleased?: string;
  joined: number;
}

export interface Assignment {
  method: Method;
  representatives: Representative[];
  chosen?: Representative;
  // Why the chosen one, in plain words.
  why: string;
}

export function methodOf(queue: Row | undefined): Method {
  const label = queue?.msdyn_assignmentstrategy == null ? undefined : ASSIGNMENT_LABELS[queue.msdyn_assignmentstrategy];
  // A queue without a method: Least active, "the default selection when you create a voice or messaging queue".
  return label ?? (queue?.msdyn_assignmentstrategy == null ? "Least active" : "No auto assignment");
}

const latest = (values: (string | undefined)[]) => values.filter((v): v is string => !!v).sort().pop();

// The representatives of a queue and whether each can take a call from this workstream now.
export function representatives(store: Store, queueId: string, workstreamId: string, exclude: Set<string> = new Set()): Representative[] {
  const ws = store.find("msdyn_liveworkstream", workstreamId);
  const allowed = new Set(String(ws?.msdyn_allowedpresences ?? "").split(",").map((p) => Number(p.trim())).filter(Boolean));
  const profiles = store.table("msdyn_liveworkstreamcapacityprofile").filter((l) => l._msdyn_workstream_id_value === workstreamId).map((l) => l._msdyn_capacityprofile_id_value);
  const open = store.table("msdyn_ocliveworkitem").filter((w) => w.statecode === 0 && w._msdyn_activeagentid_value);
  const log = store.table("training_assignment");
  const members = store.table("queuemembership").filter((m) => m.queueid === queueId);

  return members.map((m, joined): Representative => {
    const user = store.find("systemuser", m.systemuserid);
    const status = store.table("msdyn_agentstatus").find((s) => s._msdyn_agentid_value === m.systemuserid);
    const presence = status?._msdyn_currentpresenceid_value ? store.find("msdyn_presence", status._msdyn_currentpresenceid_value) : undefined;
    const mine = open.filter((w) => w._msdyn_activeagentid_value === m.systemuserid);
    const resource = store.table("bookableresource").find((r) => r._userid_value === m.systemuserid);
    // Free capacity: for each of the workstream's profiles, the limit less what's open with this
    // representative in workstreams that use the same profile. The smallest counts.
    const free = profiles.length ? Math.min(...profiles.map((p) => {
      const link = resource && store.table("msdyn_bookableresourcecapacityprofile").find((l) => l._msdyn_bookableresourceid_value === resource.bookableresourceid && l._msdyn_capacityprofileid_value === p);
      if (!link) return -Infinity;
      const limit = link.msdyn_maxunits ?? store.find("msdyn_capacityprofile", p)?.msdyn_defaultmaxunits ?? 0;
      const used = mine.filter((w) => store.table("msdyn_liveworkstreamcapacityprofile").some((l) => l._msdyn_workstream_id_value === w._msdyn_liveworkstreamid_value && l._msdyn_capacityprofile_id_value === p)).length;
      return limit - used;
    })) : 1;
    const loggedIn = status?.msdyn_isagentloggedin === true;
    const presenceName = !loggedIn ? "Signed out" : presence?.msdyn_name ?? "No presence";
    const notNow =
      !user || user.isdisabled || user.accessmode !== 0 ? "isn't an active, interactive user"
      : exclude.has(m.systemuserid) ? "declined this call"
      : !loggedIn ? "is signed out"
      : !presence || !allowed.has(presence.msdyn_basepresencestatus) ? `is ${presence?.msdyn_name ?? "without a presence"}, which this workstream doesn't assign work to`
      : free === -Infinity ? "doesn't have the workstream's capacity profile"
      : free <= 0 ? "has no capacity left"
      : undefined;
    return {
      id: m.systemuserid, name: String(user?.fullname ?? "Unknown user"), presence: presenceName, notNow, free: free === -Infinity ? 0 : free, open: mine.length, joined,
      lastAssigned: latest(log.filter((a) => a.agentid === m.systemuserid && a.queueid === queueId).map((a) => a.assignedon)),
      lastReleased: latest(log.filter((a) => a.agentid === m.systemuserid).map((a) => a.releasedon))
    };
  });
}

// Round robin order: never assigned in this queue first (in the order they joined it), then the
// earliest last assignment.
const roundRobin = (a: Representative, b: Representative) =>
  (a.lastAssigned ?? "") === (b.lastAssigned ?? "") ? a.joined - b.joined : !a.lastAssigned ? -1 : !b.lastAssigned ? 1 : a.lastAssigned.localeCompare(b.lastAssigned);
// Least active: fewest open conversations, then the earliest last capacity release (never released first).
const leastActive = (a: Representative, b: Representative) =>
  a.open !== b.open ? a.open - b.open : (a.lastReleased ?? "") === (b.lastReleased ?? "") ? a.joined - b.joined : !a.lastReleased ? -1 : !b.lastReleased ? 1 : a.lastReleased.localeCompare(b.lastReleased);
const highestCapacity = (a: Representative, b: Representative) => (a.free !== b.free ? b.free - a.free : roundRobin(a, b));

// Least active, in words. When nobody has finished a call yet, Learn doesn't say how a tie is broken: the
// training takes the order people joined the queue, and says so.
function leastActiveWhy(chosen: Representative, next: Representative): string {
  if (chosen.open < next.open) return `${chosen.name} has the fewest calls open.`;
  if (chosen.lastReleased) return `${chosen.name} has gone longest since their last call ended.`;
  if (next.lastReleased) return `${chosen.name} hasn't had a call yet.`;
  return `Nobody has finished a call yet, so the training goes by the order people joined the queue (simplified): ${chosen.name} is first.`;
}

export function assignmentFor(store: Store, queueId: string, workstreamId: string, exclude?: Set<string>, workItemId?: string): Assignment {
  const method = methodOf(store.find("queue", queueId));
  const needs = workItemId ? requiredSkills(store, workstreamId, answersOf(store, workItemId)) : [];
  const matching = needs.length ? matchingOf(store.find("msdyn_liveworkstream", workstreamId)) : undefined;
  // Exact Match: only those with every needed skill at the needed rating or better.
  const reps = representatives(store, queueId, workstreamId, exclude).map((r) =>
    matching === "Exact Match" && !r.notNow && !meetsAll(store, r.id, needs) ? { ...r, notNow: `doesn't have ${needsText(needs)}` } : r);
  const skillNote = !needs.length ? "" : matching === "Exact Match" ? ` The call needs ${needsText(needs)} (Exact Match).`
    : matching === "Closest Match" ? ` The call needs ${needsText(needs)}: Closest Match puts those who have it first (simplified).`
    : ` A rule attached ${needsText(needs)}, but the workstream has no Default skill matching algorithm, so the training doesn't use the skill.`;
  if (method === "No auto assignment") return { method, representatives: reps, why: "The queue doesn't assign calls automatically: a representative picks them up." };
  const ready = reps.filter((r) => !r.notNow);
  if (!ready.length) {
    const why = matching === "Exact Match" && reps.some((r) => r.notNow?.startsWith("doesn't have"))
      ? `Nobody who can take calls now has ${needsText(needs)}, so the call stays unassigned in the queue (Exact Match).`
      : reps.length ? "Nobody in the queue can take it now, so it waits and routing keeps trying." : "The queue has no members, so the call waits.";
    return { method, representatives: reps, why };
  }
  const base = method === "Highest capacity" ? highestCapacity : method === "Advanced round robin" ? roundRobin : leastActive;
  const order = matching === "Closest Match" ? (a: Representative, b: Representative) => (skillScore(store, b.id, needs) - skillScore(store, a.id, needs)) || base(a, b) : base;
  const [chosen, ...rest] = [...ready].sort(order);
  const why = (!rest.length ? `${chosen.name} is the only one who can take it.`
    : method === "Least active" ? leastActiveWhy(chosen, rest[0])
    : method === "Highest capacity" ? (chosen.free > rest[0].free ? `${chosen.name} has the most free capacity.` : `${chosen.name} is next in round robin order among those with the most free capacity.`)
    : `${chosen.name} is next in the queue's round robin order.`) + skillNote;
  return { method, representatives: reps, chosen, why };
}

// Gives the call to a representative: the platform's rows (the live work item's agent and status) and
// the training's own log of the assignment.
export function assign(store: Store, workItemId: string, agentId: string, at: string): void {
  const item = store.find("msdyn_ocliveworkitem", workItemId);
  if (!item) return;
  store.update("msdyn_ocliveworkitem", workItemId, { _msdyn_activeagentid_value: agentId, statuscode: STATUS.active, modifiedon: at });
  store.insert("training_assignment", { training_assignmentid: newGuid(), queueid: item._msdyn_cdsqueueid_value, agentid: agentId, workitemid: workItemId, assignedon: at });
}

// The call ends: wrap-up. Capacity stays in use until it's closed ("Always block").
export function endCall(store: Store, workItemId: string, at: string): void {
  store.update("msdyn_ocliveworkitem", workItemId, { statuscode: STATUS.wrapUp, modifiedon: at });
}

// Closed: capacity is released.
export function closeCall(store: Store, workItemId: string, at: string): void {
  store.update("msdyn_ocliveworkitem", workItemId, { statecode: 1, statuscode: STATUS.closed, modifiedon: at });
  release(store, workItemId, at);
}

// The representative's capacity for this call is released (the call closes or moves on to someone else).
export function release(store: Store, workItemId: string, at: string): void {
  for (const a of store.table("training_assignment").filter((x) => x.workitemid === workItemId && !x.releasedon)) store.update("training_assignment", a.training_assignmentid, { releasedon: at });
}

// Back to a queue, unassigned and Open: a transfer to a queue, or a transfer to a representative who
// hasn't accepted yet.
export function requeue(store: Store, workItemId: string, queueId: string, at: string): void {
  release(store, workItemId, at);
  store.update("msdyn_ocliveworkitem", workItemId, { _msdyn_cdsqueueid_value: queueId, _msdyn_activeagentid_value: null, statuscode: STATUS.open, modifiedon: at });
}

