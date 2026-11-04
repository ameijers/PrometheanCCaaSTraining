// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ASSIGNMENT_LABELS } from "../admin/actions";
import {
  Admin, addRouteToQueueRule, addUsers, createQueue, createVoiceWorkstream, addTeamMembers, createBusinessUnit, createOwnerTeam, findNumber, purchaseNumber, readOverflow, saveOverflow,
  setAssignmentMethod, setFallbackQueue, setOperationHours, setupWorkstream, setWorkItemLimit, OverflowPair
} from "../admin/actions";
import { methodOf } from "../calls/assignment";
import { CallRequest, placeCall } from "../calls/engine";
import { closeName, CheckResult, queueNamed } from "../lessons/checks";
import { Row, Store } from "../simulator/store";
import { LEARNER } from "../simulator/learner";
import { describeEnvironment } from "./world";

// "Build to requirements" (manual 9.1): goals a company asks for. Each goal type gives, in code, the
// requirement in plain words, the checks that decide whether it's met (manual 9.2), and a reference
// solution made only of the admin center's own actions. The checks must fail at the start and pass after
// the reference solution (manual 8.3, check 5). The AI picks goals and writes the story; it never grades.

export type Goal =
  | { type: "members"; queue: string; atLeast: number }
  | { type: "fallback"; workstream: string; queue: string }
  | { type: "choice-queue"; workstream: string; choice: string; queue: string; members: number }
  | { type: "operation-hours"; queue: string; hours: string }
  | { type: "after-hours"; queue: string; action: "Voicemail" | "Direct callback" | "End call" }
  | { type: "long-wait"; queue: string; minutes: number; action: "Direct callback" | "Voicemail" }
  | { type: "assignment-method"; queue: string; method: "Least active" | "Highest capacity" | "Advanced round robin" }
  | { type: "capacity"; profile: string; limit: number }
  | { type: "new-line"; workstream: string; queue: string }
  | { type: "business-unit"; unit: string; parent: string }
  | { type: "team"; team: string; unit: string; members: number };

export const GOAL_TYPES = ["members", "fallback", "choice-queue", "operation-hours", "after-hours", "long-wait", "assignment-method", "capacity", "new-line", "business-unit", "team"] as const;

// The level each goal type belongs to (manual 9.3). A scenario at a level may use goals of that level and below.
export const GOAL_LEVEL: Record<Goal["type"], number> = {
  members: 1, fallback: 1, "choice-queue": 2, "operation-hours": 3, "after-hours": 3, "long-wait": 3, "assignment-method": 4, capacity: 4, "new-line": 5, "business-unit": 5, team: 5
};

// The concept that explains each goal, for the Learn strip and AI hints.
export const GOAL_CONCEPT: Record<Goal["type"], string> = {
  members: "queue-users", fallback: "fallback-queue", "choice-queue": "route-to-queue", "operation-hours": "operating-hours", "after-hours": "overflow",
  "long-wait": "overflow", "assignment-method": "assignment-method", capacity: "capacity-profile", "new-line": "phone-number", "business-unit": "business-unit", team: "team"
};

const OUTCOME_OF: Record<string, string> = { Voicemail: "Voicemail", "Direct callback": "Callback", "End call": "End Call" };
// A time every operating hours record in the training is closed (Business hours: weekdays 9 to 5; Weekend desk: weekends 10 to 4).
const CLOSED = { day: 3, time: "23:00" };
const OPEN = { day: 2, time: "11:00" };

export function requirement(g: Goal): string {
  switch (g.type) {
    case "members": return `The ${g.queue} queue has at least ${g.atLeast} people who can take its calls.`;
    case "fallback": return `Calls on ${g.workstream} that no rule routes go to the ${g.queue} queue.`;
    case "choice-queue": return `Callers on ${g.workstream} who choose “${g.choice}” in the IVR reach a new ${g.queue} voice queue with at least ${g.members} people in it.`;
    case "operation-hours": return `The ${g.queue} queue keeps the opening times of “${g.hours}”.`;
    case "after-hours": return `Calls to ${g.queue} outside its opening times ${g.action === "Voicemail" ? "go to voicemail" : g.action === "Direct callback" ? "are offered a callback" : "are ended with a message"}.`;
    case "long-wait": return `When the predicted wait for ${g.queue} is ${g.minutes} minutes or more, callers ${g.action === "Voicemail" ? "go to voicemail" : "are offered a callback"}.`;
    case "assignment-method": return `The ${g.queue} queue hands out calls with ${g.method}.`;
    case "capacity": return `Everyone with the “${g.profile}” capacity profile can have ${g.limit} calls at the same time.`;
    case "new-line": return `A new phone line, ${g.workstream}, takes calls into the ${g.queue} queue.`;
    case "business-unit": return `There's a business unit ${g.unit}, under ${g.parent}.`;
    case "team": return `An owner team ${g.team} in the business unit ${g.unit} has at least ${g.members} members.`;
  }
}

export interface GoalCheck { title: string; result: CheckResult }

const call = async (store: Store, r: CallRequest) => placeCall(store, r, { record: false });
const voiceWs = (store: Store, name: string) => store.table("msdyn_liveworkstream").find((w) => w.msdyn_enablevoicev2 && w.statecode === 0 && closeName(w.msdyn_name, name));
const dialOf = (store: Store, workstreamId: string) => {
  const channel = store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_liveworkstreamid_value === workstreamId && c._msdyn_phonenumberid_value);
  return channel ? store.find("msdyn_ocphonenumber", channel._msdyn_phonenumberid_value)?.msdyn_phonenumber as string | undefined : undefined;
};
const near = (row: Row | undefined, wanted: string, column = "name") => (row && String(row[column]).toLowerCase() !== wanted.toLowerCase() ? `You named it “${row[column]}”; the brief said “${wanted}”. That's fine.` : undefined);

// A call that reaches this queue through routing: a line and the menu choice that a rule routes there.
async function callInto(store: Store, queue: string): Promise<CallRequest | undefined> {
  const env = await describeEnvironment(store);
  for (const line of env.lines) {
    const choice = line.choices.find((c) => c.queues.length === 1 && c.queues[0] === queue);
    if (choice) return { dial: line.dial, answers: { SelectedMenuItem: choice.value } };
    if (line.fallback === queue) return { dial: line.dial, answers: {} };
  }
  return undefined;
}

export async function checkGoal(store: Store, g: Goal): Promise<GoalCheck[]> {
  const q = (name: string) => queueNamed(store, name);
  switch (g.type) {
    case "members": {
      const queue = q(g.queue);
      const count = queue ? store.table("queuemembership").filter((m) => m.queueid === queue.queueid).length : 0;
      return [{ title: `${g.queue} has at least ${g.atLeast} members`, result: { passed: count >= g.atLeast, note: queue ? `${queue.name} has ${count}.` : undefined } }];
    }
    case "fallback": {
      const ws = voiceWs(store, g.workstream);
      const fb = ws?._msdyn_defaultqueue_value ? store.find("queue", ws._msdyn_defaultqueue_value) : undefined;
      return [{ title: `The fallback queue of ${g.workstream} is ${g.queue}`, result: { passed: !!fb && fb.queueid === q(g.queue)?.queueid, note: fb ? `It's ${fb.name} now.` : undefined } }];
    }
    case "choice-queue": {
      const queue = q(g.queue);
      const voice = queue?.msdyn_queuetype === 192350002;
      const count = queue ? store.table("queuemembership").filter((m) => m.queueid === queue.queueid).length : 0;
      const ws = voiceWs(store, g.workstream);
      const dial = ws && dialOf(store, ws.msdyn_liveworkstreamid);
      const routed = dial ? await call(store, { dial, answers: { SelectedMenuItem: g.choice } }) : undefined;
      return [
        { title: `A voice queue named ${g.queue}`, result: { passed: !!queue && voice, note: queue && !voice ? `${queue.name} isn't a voice queue.` : near(queue, g.queue) } },
        { title: `${g.queue} has at least ${g.members} members`, result: { passed: !!queue && count >= g.members, note: queue ? `${queue.name} has ${count}.` : undefined } },
        { title: `A call choosing “${g.choice}” reaches ${g.queue}`, result: { passed: !!queue && routed?.queue?.id === queue.queueid, note: routed?.queue ? `It reaches ${routed.queue.name} now.` : undefined } }
      ];
    }
    case "operation-hours": {
      const queue = q(g.queue);
      const hours = queue?._msdyn_operatinghourid_value ? store.find("msdyn_operatinghour", queue._msdyn_operatinghourid_value) : undefined;
      return [{ title: `${g.queue} uses the operation hours “${g.hours}”`, result: { passed: hours?.msdyn_name === g.hours, note: hours ? `It uses “${hours.msdyn_name}”.` : "It has no operation hours: it's open around the clock." } }];
    }
    case "after-hours": {
      const r = await callInto(store, g.queue);
      const result = r && await call(store, { ...r, at: CLOSED });
      const want = OUTCOME_OF[g.action];
      return [{ title: `A call to ${g.queue} on Wednesday at 23:00 ${g.action === "Voicemail" ? "goes to voicemail" : g.action === "Direct callback" ? "is offered a callback" : "is ended"}`, result: { passed: result?.outcome === want && result.queue?.name === g.queue, note: result?.outcome ? `It ${result.outcome === "Agent" ? "waits for a representative" : `ends as ${result.outcome}`} now.` : undefined } }];
    }
    case "long-wait": {
      const r = await callInto(store, g.queue);
      const long = r && await call(store, { ...r, at: OPEN, queue: { estimatedWaitMinutes: g.minutes } });
      const short = r && await call(store, { ...r, at: OPEN, queue: { estimatedWaitMinutes: Math.max(0, g.minutes - 2) } });
      // One check: the threshold is right when the long wait triggers the action and a shorter one doesn't.
      const hit = long?.outcome === OUTCOME_OF[g.action];
      const note = !long?.outcome ? undefined
        : !hit ? `A ${g.minutes}-minute wait ${long.outcome === "Agent" ? "still waits for a representative" : `ends as ${long.outcome}`} now.`
        : short?.outcome !== "Agent" ? `A ${Math.max(0, g.minutes - 2)}-minute wait triggers it too: check the number of minutes.` : undefined;
      return [{ title: `A predicted wait of ${g.minutes} minutes or more for ${g.queue} ${g.action === "Voicemail" ? "goes to voicemail" : "offers a callback"}, a shorter one doesn't`, result: { passed: hit && short?.outcome === "Agent", note } }];
    }
    case "assignment-method": {
      const queue = q(g.queue);
      const method = queue ? (queue.msdyn_assignmentstrategy == null ? undefined : ASSIGNMENT_LABELS[queue.msdyn_assignmentstrategy]) ?? methodOf(queue) : undefined;
      return [{ title: `${g.queue} uses ${g.method}`, result: { passed: method === g.method, note: method ? `It uses ${method}.` : undefined } }];
    }
    case "capacity": {
      const profile = store.table("msdyn_capacityprofile").find((p) => closeName(p.msdyn_name, g.profile));
      return [{ title: `The work item limit of “${g.profile}” is ${g.limit}`, result: { passed: profile?.msdyn_defaultmaxunits === g.limit, note: profile ? `It's ${profile.msdyn_defaultmaxunits ?? "not set"}.` : undefined } }];
    }
    case "business-unit": {
      const unit = store.table("businessunit").find((u) => closeName(u.name, g.unit));
      const parent = unit?._parentbusinessunitid_value ? store.find("businessunit", unit._parentbusinessunitid_value) : undefined;
      return [
        { title: `A business unit named ${g.unit}`, result: { passed: !!unit, note: near(unit, g.unit) } },
        { title: `Its parent business unit is ${g.parent}`, result: { passed: !!parent && parent.name === g.parent, note: parent ? `Its parent is ${parent.name}.` : undefined } }
      ];
    }
    case "team": {
      const unit = store.table("businessunit").find((u) => closeName(u.name, g.unit));
      const team = store.table("team").find((t) => !t.isdefault && closeName(t.name, g.team) && (!unit || t._businessunitid_value === unit.businessunitid));
      const count = team ? store.table("teammembership").filter((m) => m.teamid === team.teamid).length : 0;
      return [
        { title: `An owner team named ${g.team} in ${g.unit}`, result: { passed: !!team && !!unit && team.teamtype === 0, note: near(team, g.team) } },
        { title: `${g.team} has at least ${g.members} members`, result: { passed: !!team && count >= g.members, note: team ? `It has ${count}.` : undefined } }
      ];
    }
    case "new-line": {
      const ws = voiceWs(store, g.workstream);
      const queue = q(g.queue);
      const dial = ws && dialOf(store, ws.msdyn_liveworkstreamid);
      const result = dial ? await call(store, { dial, answers: {} }) : undefined;
      return [
        { title: `A voice workstream named ${g.workstream}`, result: { passed: !!ws, note: near(ws, g.workstream, "msdyn_name") } },
        { title: `${g.workstream} has a phone number`, result: { passed: !!dial } },
        { title: `A call to that number reaches ${g.queue}`, result: { passed: !!queue && result?.queue?.id === queue.queueid, note: result?.queue ? `It reaches ${result.queue.name}.` : undefined } }
      ];
    }
  }
}

export async function checkGoals(store: Store, goals: Goal[]): Promise<GoalCheck[][]> {
  const out: GoalCheck[][] = [];
  for (const g of goals) out.push(await checkGoal(store, g));
  return out;
}

// ---- the reference solution ----

// Representatives who could take calls: signed in, with a bookable resource, not in this queue yet.
function people(store: Store, queueId: string, n: number): string[] {
  const inQueue = new Set(store.table("queuemembership").filter((m) => m.queueid === queueId).map((m) => m.systemuserid));
  return store.table("msdyn_agentstatus").filter((s) => s.msdyn_isagentloggedin && !inQueue.has(s._msdyn_agentid_value)).map((s) => s._msdyn_agentid_value).slice(0, n);
}

function addPair(admin: Admin, queueId: string, stage: "before", pair: OverflowPair): void {
  const current = readOverflow(admin.store, queueId);
  const before = [...current.before.filter((p) => p.condition !== pair.condition), pair];
  saveOverflow(admin, queueId, stage === "before" ? before : current.before, current.queued);
}

export function solve(admin: Admin, g: Goal): void {
  const { store } = admin;
  // Names the scenario uses must be the environment's: say which ones exist, in words the AI can act on.
  const names = (list: string[]) => list.map((n) => `“${n}”`).join(", ");
  const queueId = (name: string): string => {
    const q = store.table("queue").find((x) => x.name === name && x.statecode === 0);
    if (!q) throw new Error(`There's no queue named “${name}”.`);
    return q.queueid;
  };
  const wsId = (name: string): string => {
    const w = store.table("msdyn_liveworkstream").find((x) => x.msdyn_name === name);
    if (!w) throw new Error(`There's no workstream named “${name}”.`);
    return w.msdyn_liveworkstreamid;
  };
  const hoursId = (name: string): string => {
    const all = store.table("msdyn_operatinghour");
    const h = all.find((x) => x.msdyn_name === name);
    if (!h) throw new Error(`There's no operating hours record named “${name}”: use ${names(all.map((x) => x.msdyn_name))}.`);
    return h.msdyn_operatinghourid;
  };
  const unitId = (name: string): string => {
    const all = store.table("businessunit");
    const u = all.find((x) => x.name === name);
    if (!u) throw new Error(`There's no business unit named “${name}”: use ${names(all.map((x) => x.name))}.`);
    return u.businessunitid;
  };
  const profileId = (name: string): string => {
    const all = store.table("msdyn_capacityprofile");
    const pr = all.find((x) => x.msdyn_name === name);
    if (!pr) throw new Error(`There's no capacity profile named “${name}”: use ${names(all.map((x) => x.msdyn_name))}.`);
    return pr.msdyn_capacityprofileid;
  };
  switch (g.type) {
    case "members": {
      const id = queueId(g.queue);
      const have = store.table("queuemembership").filter((m) => m.queueid === id).length;
      addUsers(admin, id, people(store, id, g.atLeast - have));
      return;
    }
    case "fallback": setFallbackQueue(admin, wsId(g.workstream), queueId(g.queue)); return;
    case "choice-queue": {
      const id = createQueue(admin, { name: g.queue, type: "Voice", priority: 1 });
      addUsers(admin, id, people(store, id, g.members));
      addRouteToQueueRule(admin, wsId(g.workstream), { name: g.choice, variable: "SelectedMenuItem", value: g.choice, queueId: id });
      return;
    }
    case "operation-hours": {
      setOperationHours(admin, queueId(g.queue), hoursId(g.hours));
      return;
    }
    case "after-hours": {
      const id = queueId(g.queue);
      if (!store.find("queue", id)!._msdyn_operatinghourid_value) setOperationHours(admin, id, hoursId("Business hours"));
      addPair(admin, id, "before", { condition: "outOfHours", action: g.action });
      return;
    }
    case "long-wait": addPair(admin, queueId(g.queue), "before", { condition: "estimatedWait", value: g.minutes, action: g.action }); return;
    case "assignment-method": setAssignmentMethod(admin, queueId(g.queue), g.method); return;
    case "capacity": setWorkItemLimit(admin, profileId(g.profile), g.limit); return;
    case "business-unit": createBusinessUnit(admin, g.unit, unitId(g.parent)); return;
    case "team": {
      const id = createOwnerTeam(admin, { name: g.team, unitId: unitId(g.unit), adminId: LEARNER.userId });
      const people = store.table("msdyn_agentstatus").map((a) => a._msdyn_agentid_value).slice(0, g.members);
      addTeamMembers(admin, id, people);
      return;
    }
    case "new-line": {
      const id = createVoiceWorkstream(admin, g.workstream, queueId(g.queue));
      setupWorkstream(admin, purchaseNumber(admin, findNumber(store, "United States", "425 (Washington)")!, { receive: true, make: false }), id);
      return;
    }
  }
}

// Three hints per goal (manual 9.4): where to look, which setting, then the concept's Learn passage.
export function goalHints(g: Goal): string[] {
  switch (g.type) {
    case "members": return ["Look at the queue in the admin center: Queues, then Advanced queues.", `Open ${g.queue} and select Add users.`, "Pick enough representatives and select Add."];
    case "fallback": return ["The fallback queue is a setting of the workstream.", `Open Workstreams, then ${g.workstream}.`, "Under Routing rules, select Edit next to Fallback queue."];
    case "choice-queue": return ["You need three things: a queue, people in it, and a rule that routes the menu choice there.", "Create the voice queue in Advanced queues and add users. Then open the workstream's route-to-queue ruleset.", `Create a rule: when SelectedMenuItem equals ${g.choice}, route to the new queue.`];
    case "operation-hours": return ["Operation hours are set on the queue.", `Open ${g.queue}: the Operation hours section is at the bottom.`, `Select Set operation hours and pick “${g.hours}” in Name.`];
    case "after-hours": return ["What happens out of hours is an overflow setting on the queue.", `The queue needs operation hours first. Then open Overflow handling on ${g.queue}.`, `Set Out of operation hours to ${g.action}.`];
    case "long-wait": return ["A long predicted wait is an overflow condition on the queue.", `Open Overflow handling on ${g.queue}, under Before work items are queued.`, `Add Average wait time, ${g.minutes} minutes, with ${g.action}.`];
    case "assignment-method": return ["How a queue hands out calls is its assignment method.", `Open ${g.queue} and select See more under Assignment method.`, `Choose ${g.method} and select Save & close.`];
    case "capacity": return ["How many calls one person can take at once comes from their capacity profile.", "Open User management, then Manage for Capacity profile.", `Open “${g.profile}” and set its Work item limit to ${g.limit}.`];
    case "business-unit": return ["Business units are set up in the Power Platform admin center, not in Copilot Service.", "Open Power Platform admin center: Settings › Users + permissions › Business units.", `Select New business unit, name it ${g.unit}, and pick ${g.parent} as its Parent business unit.`];
    case "team": return ["Teams are set up in the Power Platform admin center.", `Open Settings › Users + permissions › Teams and select + Create team, in the business unit ${g.unit}.`, `Then open the team's Manage team members and add at least ${g.members} people.`];
    case "new-line": return ["A new line needs a workstream and a phone number on it.", "Create the workstream in Workstreams with New workstream, with the fallback queue that should take its calls.", "Then get a number in Channels, Phone numbers (Add ACS number) and select Setup workstream."];
  }
}
