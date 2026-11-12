// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { PRESENCE_NAMES } from "../simulator/seeds/presence";
import { Row, Store } from "../simulator/store";
import { assign, closeCall, requeue, STATUS } from "./assignment";
import { acceptedAt, saveSummary } from "./conversation";
import { callInfo } from "./customers";
import type { Routing } from "./routing";

// The supervisor's side: the numbers on Omnichannel real-time analytics, and the actions on ongoing
// conversations.
//
// Metric names and meanings from Learn (Calculate conversation metrics):
// - Total conversations offered: "The total number of inbound conversations that a service representative
//   received directly or an AI agent escalated."
// - Active conversations awaiting service representative acceptance: "conversations with service
//   representatives assigned and customers waiting for the service representative to accept".
// - Active conversations with service representative acceptance: "assigned to a service representative,
//   accepted, and actively engaged".
// - Wrap-up conversations: "conversations that are currently in the Wrap-up state".
// - Longest wait time: "the longest first wait time among unaccepted incoming conversations".
// - Average speed to answer: "the average time (in seconds) for a service representative to accept a
//   conversation after ... it enters a direct queue".
// - Service level (20 seconds): "The percentage of customer conversations where the speed to answer is less
//   than or equal to" 20 seconds.
// - Average conversation handle time: "the total handle time divided by the number of conversations
//   handled". Simplified: handle time here runs from accepting the call to closing it.
// Actions from Learn (Monitor, assign, transfer, and end conversations as a supervisor): monitor Active
// voice conversations, but not "conversations that are assigned to you"; assign a conversation in "an Open
// state and not assigned to any service representative", to a representative or a queue, overriding
// "the service representative's presence and allocated capacity"; transfer conversations "in the Active or
// Waiting states"; end conversations forcibly, after which "its status is set to Closed".
//
// Simplified: the reports cover every call in this session (no Time filter), and abandoned calls aren't
// simulated (a caller never hangs up).

export interface Kpis {
  offered: number;
  awaiting: number;
  active: number;
  wrapUp: number;
  open: number;
  longestWaitMs?: number;
  averageSpeedToAnswerMs?: number;
  serviceLevel20?: number;
  averageHandleTimeMs?: number;
}

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

export function kpis(store: Store, offers: Set<string>, now: number, queueId?: string): Kpis {
  const items = store.table("msdyn_ocliveworkitem").filter((w) => !queueId || w._msdyn_cdsqueueid_value === queueId);
  const live = items.filter((w) => w.statecode === 0);
  const waiting = live.filter((w) => w.statuscode === STATUS.open && !w._msdyn_activeagentid_value);
  const answered = items.map((w) => ({ w, at: acceptedAt(store, w.activityid) })).filter((x) => x.at !== undefined) as { w: Row; at: number }[];
  const speeds = answered.map((x) => x.at - Date.parse(x.w.createdon));
  const handled = answered.filter((x) => x.w.statuscode === STATUS.closed).map((x) => Date.parse(x.w.modifiedon) - x.at);
  const unaccepted = waiting.map((w) => now - Date.parse(w.createdon));
  return {
    offered: items.length,
    awaiting: waiting.filter((w) => offers.has(w.activityid)).length,
    active: live.filter((w) => w.statuscode === STATUS.active).length,
    wrapUp: live.filter((w) => w.statuscode === STATUS.wrapUp).length,
    open: waiting.filter((w) => !offers.has(w.activityid)).length,
    longestWaitMs: unaccepted.length ? Math.max(...unaccepted) : undefined,
    averageSpeedToAnswerMs: average(speeds),
    serviceLevel20: speeds.length ? Math.round((speeds.filter((s) => s <= 20_000).length / speeds.length) * 100) : undefined,
    averageHandleTimeMs: average(handled)
  };
}

export interface AgentRow {
  id: string;
  name: string;
  presence: string;
  signedIn: boolean;
  conversations: number;
  queues: string[];
  // Idle agents, Interacting agents, Offline agents: the Agent report's tabs.
  tab: "Idle agents" | "Interacting agents" | "Offline agents";
}

export function agentRows(store: Store, queueId?: string): AgentRow[] {
  const live = store.table("msdyn_ocliveworkitem").filter((w) => w.statecode === 0 && w._msdyn_activeagentid_value);
  return store.table("msdyn_agentstatus")
    .filter((s) => !queueId || store.table("queuemembership").some((m) => m.queueid === queueId && m.systemuserid === s._msdyn_agentid_value))
    .map((s): AgentRow => {
      const presence = s._msdyn_currentpresenceid_value ? String(store.find("msdyn_presence", s._msdyn_currentpresenceid_value)?.msdyn_name ?? "") : "";
      const conversations = live.filter((w) => w._msdyn_activeagentid_value === s._msdyn_agentid_value).length;
      const offline = !s.msdyn_isagentloggedin || presence === "Offline";
      return {
        id: s._msdyn_agentid_value, name: String(store.find("systemuser", s._msdyn_agentid_value)?.fullname ?? ""),
        presence: offline ? "Offline" : presence, signedIn: !offline,
        conversations,
        queues: store.table("queuemembership").filter((m) => m.systemuserid === s._msdyn_agentid_value).map((m) => String(store.find("queue", m.queueid)?.name ?? "")).sort(),
        tab: offline ? "Offline agents" : conversations ? "Interacting agents" : "Idle agents"
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Agent availability status: how many representatives are in each presence.
export function availability(rows: AgentRow[]): [string, number][] {
  const names = Object.values(PRESENCE_NAMES);
  return names.map((n) => [n, rows.filter((r) => r.presence === n).length] as [string, number]);
}

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

// What a supervisor can do with a conversation now, and why not.
export function canMonitor(w: Row, me?: string): string | undefined {
  if (w.statuscode !== STATUS.active) return "Voice calls can be monitored in the Active state only.";
  if (me && w._msdyn_activeagentid_value === me) return "You can't monitor conversations that are assigned to you.";
  return undefined;
}
export const canAssign = (w: Row): string | undefined =>
  w.statuscode === STATUS.open && !w._msdyn_activeagentid_value ? undefined : "Only an Open conversation that isn't assigned to anyone can be assigned.";
export const canTransfer = (w: Row): string | undefined =>
  w.statuscode === STATUS.active ? undefined : "Only an Active conversation can be transferred.";

export type Target = { kind: "agent"; id: string } | { kind: "queue"; id: string };

// Assign: straight to the representative (overriding presence and capacity), or into a queue.
export function supervisorAssign(store: Store, routing: Routing, workItemId: string, target: Target, now: number): void {
  routing.withdraw(workItemId);
  if (target.kind === "queue") requeue(store, workItemId, target.id, iso(now));
  else assign(store, workItemId, target.id, iso(now));
  routing.cycle(new Date(now));
}

// Transfer (by the representative on the call, or by a supervisor): Copilot summarizes, the current
// representative's capacity is released, and the call goes to the queue or is offered to the representative.
// A simulated representative accepts straight away; the learner gets the notification.
export function transfer(store: Store, routing: Routing, workItemId: string, target: Target, now: number): void {
  const w = store.find("msdyn_ocliveworkitem", workItemId);
  if (!w) return;
  saveSummary(store, w, now);
  routing.withdraw(workItemId);
  const queueId = target.kind === "queue" ? target.id : w._msdyn_cdsqueueid_value;
  requeue(store, workItemId, queueId, iso(now));
  if (target.kind === "agent") {
    if (target.id === routing.learnerAgent) routing.offerToLearner(workItemId);
    else assign(store, workItemId, target.id, iso(now));
  }
  routing.cycle(new Date(now));
}

export function forceClose(store: Store, routing: Routing, workItemId: string, now: number): void {
  routing.withdraw(workItemId);
  closeCall(store, workItemId, iso(now));
  routing.cycle(new Date(now));
}

// Join call (barge): the representative is told a supervisor joined.
export function joinCall(store: Store, workItemId: string): void {
  const info = callInfo(store, workItemId);
  if (info) store.update("training_call", info.training_callid, { supervisorjoined: true });
  else store.insert("training_call", { workitemid: workItemId, supervisorjoined: true });
}
