// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { loadRoutingModel } from "@toolbox/visual-routing-tester/src/dataverse";
import { simulate } from "@toolbox/visual-routing-tester/src/evaluator";
import { Outcome, OverflowRule, Queue, RoutingModel } from "@toolbox/visual-routing-tester/src/model";
import { describe as describeOverflow } from "@toolbox/voicemail-builder/src/overflow";
import { isWithinOperatingHours } from "@toolbox/visual-routing-tester/src/operatingHours";
import { cleanId, newGuid, Row, Store } from "../simulator/store";
import type { Routing } from "./routing";
import { identificationText, recordCaller } from "./customers";
import { channelOfNumber } from "../admin/actions";

// A call, step by step (manual 5.2): number → voice channel → workstream → IVR answers → route-to-queue
// rules → queue. The routing itself is the Toolbox's: the Visual Routing Tester's loadRoutingModel()
// reads the simulator (through Xrm, which the shell and the tests put in place) and its simulate()
// picks the queue, then the queue's overflow rules (pre-queue, then in-queue) with the queue's operating
// hours checked by the routing tester's isWithinOperatingHours. Assignment to an agent comes later.

export interface CallStep {
  what: string;      // "Phone number", "Voice channel", "Route to queues", …
  detail: string;
  status: "ok" | "stop";
}

export interface CallResult {
  steps: CallStep[];
  // How the call ends: "Agent" means it waits in the queue for a representative (the routing tester's
  // outcomes, visual-routing-tester/src/model.ts). None when it doesn't reach a queue.
  outcome?: Outcome;
  queue?: { id: string; name: string; members: number };
  workstreamId?: string;
  // The live work item the call wrote, when it was recorded.
  workItemId?: string;
}

export interface CallRequest {
  dial: string;
  // The number the caller calls from, used to identify the customer (customers.ts). Optional.
  from?: string;
  // The caller's answers to the IVR, by context variable name.
  answers: Record<string, string>;
  // When the call comes in, in the contact center's own local time. Without it, operating hours aren't
  // checked and out-of-hours overflow doesn't fire.
  at?: CallTime;
  // What the queue looks like when the call arrives, for the overflow rules that check it.
  queue?: { estimatedWaitMinutes?: number; callsWaiting?: number; waitedSeconds?: number };
}

// A day of the week (0 Sunday … 6 Saturday, as Date.getUTCDay) and a time "HH:MM".
export interface CallTime { day: number; time: string }
export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const describeTime = (t: CallTime) => `${DAYS[t.day]} ${t.time}`;

// isWithinOperatingHours reads a Date's UTC fields as the queue's local wall-clock time. Any week works;
// this is the week of 1 November 2026 (a Sunday).
function wallClock(t: CallTime): Date {
  const [h, m] = t.time.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 1 + t.day, h, m));
}

// What each queue's overflow rules see (visual-routing-tester/src/dataverse.ts QUEUE_STATE_FIELDS).
function queueValues(model: RoutingModel, request: CallRequest): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const q of model.queues) {
    const v: Record<string, unknown> = {};
    if (request.at && q.operatingHours?.length) v["queue_prequeue.iswithinoperatinghour"] = isWithinOperatingHours(q.operatingHours, wallClock(request.at));
    if (request.queue?.estimatedWaitMinutes !== undefined) v["queue_prequeue.estimatedwaittimeinminutes"] = request.queue.estimatedWaitMinutes;
    if (request.queue?.callsWaiting !== undefined) v["queue_prequeue.currentqueuesize"] = request.queue.callsWaiting;
    if (request.queue?.waitedSeconds !== undefined) v["queue_inqueue.lapsedwaittime"] = request.queue.waitedSeconds;
    out[q.id] = v;
  }
  return out;
}

const ENDINGS: Record<Outcome, string> = {
  "Agent": "waits for a representative",
  "Voicemail": "is sent to voicemail",
  "Callback": "is offered a callback",
  "Scheduled Callback": "is offered a scheduled callback",
  "End Call": "is ended",
  "Transfer to Phone": "is transferred to an outside number",
  "Queue Transfer": "is transferred to another queue",
  "Remain In Queue": "stays in the queue"
};
export const endingOf = (o: Outcome) => ENDINGS[o];

// What an overflow rule checks, in Voicemail Builder's words (voicemail-builder/src/overflow.ts describe):
// "Out of operating hours", "Estimated wait 15 min or more", "Waited 300 s or more".
export function overflowTrigger(rule: OverflowRule): string {
  const c = rule.conditions.find((x) => x.operator !== "notNull");
  const id = c?.variableId ?? "";
  if (/iswithinoperatinghour/.test(id)) return describeOverflow({ condition: "outOfHours" });
  if (/estimatedwaittime/.test(id)) return describeOverflow({ condition: "estimatedWait", value: Number(c?.value) });
  if (/currentqueuesize/.test(id)) return describeOverflow({ condition: "callsWaiting", value: Number(c?.value) });
  if (/lapsedwaittime/.test(id)) return describeOverflow({ condition: "waitTime", value: Number(c?.value) });
  return rule.trigger;
}

function hoursNote(queue: Queue, at: CallTime | undefined): string {
  if (!queue.operatingHours?.length) return "";
  if (!at) return " It has operating hours, but the call has no time, so they aren't checked.";
  return isWithinOperatingHours(queue.operatingHours, wallClock(at))
    ? ` At ${describeTime(at)} it's within its operating hours.`
    : ` At ${describeTime(at)} it's outside its operating hours.`;
}

const digits = (number: string) => number.replace(/[^\d]/g, "");

// An attribute a classification rule sets, as the admin center names it (the Toolbox drops the prefix).
const attributeLabel = (attribute: string) => (attribute === "msdyn_priorityscore" ? "Priority Score" : attribute);

export function findNumber(store: Store, dial: string): Row | undefined {
  const wanted = digits(dial);
  return wanted ? store.table("msdyn_ocphonenumber").find((p) => digits(String(p.msdyn_phonenumber ?? "")) === wanted) : undefined;
}

// Where a call to this number goes, without the routing: the channel and its workstream.
export function lineOf(store: Store, dial: string): { number?: Row; channel?: Row; workstream?: Row } {
  const number = findNumber(store, dial);
  const channel = number && channelOfNumber(store, number.msdyn_ocphonenumberid);
  const workstream = channel?._msdyn_liveworkstreamid_value ? store.find("msdyn_liveworkstream", channel._msdyn_liveworkstreamid_value) : undefined;
  return { number, channel, workstream };
}

// With a routing runtime, a recorded call goes through an assignment cycle straight away, and the trace
// says who takes it (src/calls/routing.ts).
export async function placeCall(store: Store, request: CallRequest, options: { record: boolean; now?: Date; routing?: Routing } = { record: true }): Promise<CallResult> {
  const steps: CallStep[] = [];
  const stop = (what: string, detail: string): CallResult => { steps.push({ what, detail, status: "stop" }); return { steps }; };

  const { number, channel, workstream } = lineOf(store, request.dial);
  if (!number) return stop("Phone number", `Nobody answers: ${request.dial} isn't a number in this environment.`);
  steps.push({ what: "Phone number", detail: `${number.msdyn_phonenumber} rings.`, status: "ok" });
  if (!channel) return stop("Voice channel", "The number isn't on any voice channel, so the call can't be taken.");
  steps.push({ what: "Voice channel", detail: `The number is on the voice channel “${channel.msdyn_name}”.`, status: "ok" });
  if (!workstream) return stop("Workstream", "The voice channel has no workstream.");
  steps.push({ what: "Workstream", detail: `The channel belongs to the workstream “${workstream.msdyn_name}”.`, status: "ok" });

  const bot = workstream._msdyn_bot_user_value ? store.find("systemuser", workstream._msdyn_bot_user_value) : undefined;
  const answered = Object.entries(request.answers).filter(([, v]) => v !== "");
  if (bot) {
    steps.push({
      what: "IVR",
      detail: `${bot.fullname} answers first. ${answered.length ? `The caller's answers: ${answered.map(([k, v]) => `${k} = ${v}`).join(", ")}.` : "The caller doesn't answer."}`,
      status: "ok"
    });
  }

  const model = await loadRoutingModel();
  const routed = model.workstreams.find((w) => cleanId(w.id) === workstream.msdyn_liveworkstreamid);
  if (!routed) return stop("Route to queues", "This workstream isn't an active inbound voice workstream, so it doesn't route calls.");
  const result = simulate(routed, model, Object.fromEntries(answered), queueValues(model, request));
  // Work classification: what each matching rule set (Learn: the first match in a ruleset sets its output).
  for (const step of result.steps.filter((s) => s.kind === "enrichment" && s.status === "matched")) {
    const sets = routed.classificationRules.find((r) => r.id === step.id)?.sets ?? [];
    steps.push({ what: "Work classification", detail: `The rule “${step.label}” matches and sets ${sets.map((s) => `${attributeLabel(s.attribute)} to ${s.value}`).join(", ") || "nothing"}.`, status: "ok" });
  }
  const rule = result.rule;
  const firstQueue = result.steps.find((s) => s.kind === "queue");
  if (!firstQueue || !result.queue) return stop("Route to queues", "No rule matched and the workstream has no fallback queue, so the call has nowhere to go.");
  const fallback = routed.fallbackQueueId && cleanId(routed.fallbackQueueId) === cleanId(firstQueue.id) && !rule;
  const passed = result.steps.filter((s) => s.kind === "queueRouting" && s.id.endsWith("-passed")).map((s) => ` The rule “${s.label.replace(/ — not used$/, "")}” matches too and isn't used: ${s.detail}`);
  const split = rule && rule.targets.length > 1 ? ` It shares its calls by percentage (${rule.targets.map((t) => `${model.queues.find((q) => q.id === t.queueId)?.name ?? "?"} ${t.weightPercent}%`).join(", ")}); this call is given to “${firstQueue.label}”.` : "";
  steps.push({
    what: "Route to queues",
    detail: rule ? `The rule “${rule.name}” matches.${split}${passed.join("")}` : fallback ? "No route-to-queue rule matches, so the call goes to the workstream's fallback queue." : "The call is routed to a queue.",
    status: "ok"
  });
  // Each queue the call reaches, with the overflow rule that moved it on.
  const queueSteps = result.steps.filter((s) => s.kind === "queue");
  const fired = result.steps.filter((s) => s.kind === "overflow" && s.status === "matched");
  queueSteps.forEach((q, i) => {
    const queue = model.queues.find((m) => m.id === q.id.replace(/-transfer-d+$/, ""));
    steps.push({ what: "Queue", detail: `The call reaches “${q.label}”.${queue ? hoursNote(queue, request.at) : ""}`, status: "ok" });
    const rule = fired[i];
    const overflow = rule && [...model.queues.flatMap((m) => [...m.preQueueOverflowRules, ...m.inQueueOverflowRules])].find((r) => r.id === rule.id);
    if (rule) steps.push({ what: "Overflow", detail: `The overflow rule “${rule.label}” fires: ${overflow ? overflowTrigger(overflow).replace(/^./, (x) => x.toLowerCase()) : rule.detail.replace(/ — fired$/, "")}.`, status: "ok" });
  });
  const queueId = cleanId(result.queue.id);
  const outcome = result.outcome ?? "Agent";
  const members = store.table("queuemembership").filter((m) => m.queueid === queueId).length;
  steps.push({
    what: "Outcome",
    detail: outcome === "Agent"
      ? `The call waits in “${result.queue.name}” for a representative. The queue has ${members} member${members === 1 ? "" : "s"}.`
      : `The call ${endingOf(outcome)} from “${result.queue.name}”.`,
    status: "ok"
  });

  const out: CallResult = { steps, outcome, queue: { id: queueId, name: result.queue.name, members }, workstreamId: workstream.msdyn_liveworkstreamid };
  // Only a call that waits in a queue stays open as a live work item.
  if (options.record && outcome === "Agent") {
    const now = options.now ?? new Date();
    out.workItemId = recordCall(store, request, workstream.msdyn_liveworkstreamid, queueId, now);
    if (request.from) steps.push({ what: "Customer", detail: identificationText(recordCaller(store, out.workItemId, request.from)), status: "ok" });
    if (options.routing) {
      options.routing.cycle(now);
      steps.push(options.routing.step(out.workItemId));
    }
  }
  return out;
}

// The rows the platform writes for a call waiting in a queue: a live work item (statecode 0 open,
// statuscode 1 Open with no agent is "waiting" in environment-3d-explorer/src/live.ts) and its captured
// context values (msdyn_ocliveworkitemcontextitem, as Context Variable Monitor reads them).
function recordCall(store: Store, request: CallRequest, workstreamId: string, queueId: string, now: Date): string {
  const id = newGuid();
  const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  store.insert("msdyn_ocliveworkitem", {
    activityid: id, msdyn_ocliveworkitemid: id, msdyn_title: `Call to ${request.dial}`, statecode: 0, statuscode: 1, createdon: at, modifiedon: at,
    _msdyn_cdsqueueid_value: queueId, _msdyn_liveworkstreamid_value: workstreamId
  });
  for (const [name, value] of Object.entries(request.answers)) {
    if (value !== "") store.insert("msdyn_ocliveworkitemcontextitem", { msdyn_name: name, msdyn_value: value, createdon: at, _msdyn_ocliveworkitemid_value: id });
  }
  return id;
}
