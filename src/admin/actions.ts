// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ASSIGNMENT_METHODS, AssignmentMethod, QUEUE_TYPES, QueueType } from "@toolbox/queue-builder/src/queueSchema";
import { appendRules, emptyDefinition, ruleXml } from "@toolbox/route-to-queue-builder/src/rules";
import { QUEUE_IDENTIFICATION, QUEUE_OUTPUT_CONTRACT_NAME } from "@toolbox/route-to-queue-builder/src/schema";
import { DEFAULT_CAPACITY_PROFILE, NAV as VOICE_NAV } from "@toolbox/voice-workstream-builder/src/voiceSchema";
import { capacityLinkPayload, channelPayload, workstreamPayload } from "@toolbox/voice-workstream-builder/src/payload";
import { assignmentPayload } from "@toolbox/skill-assignment/src/plan";
import { SKILL_TYPE } from "@toolbox/skill-assignment/src/model";
import { DIRECTIONS } from "@toolbox/voice-workstream-builder/src/voiceSchema";
import { MATCHING, Matching } from "../calls/skills";
import { teamPayload } from "@toolbox/team-builder/src/plan";
import { PARENT_NAV as UNIT_PARENT_NAV } from "@toolbox/business-unit-builder/src/dataSource";
import { OPERATING_HOURS_NAV } from "@toolbox/queue-builder/src/queueSchema";
import { readRules as readOverflowRules, ruleXml as overflowRuleXml } from "@toolbox/voicemail-builder/src/overflow";
import { DECISION_LIST, DECLARATIVE_RULESET, INQUEUE_CONTRACTS, INQUEUE_NAV, PREQUEUE_CONTRACTS, PREQUEUE_NAV } from "@toolbox/voicemail-builder/src/schema";
import { newGuid, Row, Store } from "../simulator/store";
import { WebApi } from "../simulator/webapi";

// What the simulated admin center's pages save, written through the simulator's Web API, so the same
// columns, binds and platform behaviour apply as for any other write. The values and shapes are the
// Toolbox's, which were tested live: queue types and assignment methods (queue-builder/src/queueSchema.ts),
// route-to-queue rules and their ruleset, step and contract (route-to-queue-builder).

export interface Admin { api: WebApi; store: Store }

export const QUEUE_TYPE_LABELS: Record<number, QueueType> = Object.fromEntries(Object.entries(QUEUE_TYPES).map(([k, v]) => [v, k as QueueType]));
export const ASSIGNMENT_LABELS: Record<number, AssignmentMethod> = Object.fromEntries(Object.entries(ASSIGNMENT_METHODS).map(([k, v]) => [v, k as AssignmentMethod]));

export function createQueue({ api }: Admin, fields: { name: string; type: QueueType; priority: number; description?: string }): string {
  const name = fields.name.trim();
  if (!name) throw new Error("Enter a name for the queue.");
  if (!Number.isInteger(fields.priority) || fields.priority < 0) throw new Error("Queue priority must be a whole number, 0 or more.");
  const description = fields.description?.trim();
  // Least active "is the default selection when you create a voice or messaging queue" (Learn, Assignment methods for queues).
  const method = fields.type === "Record" ? {} : { msdyn_assignmentstrategy: ASSIGNMENT_METHODS["Least active"] };
  return api.create("queue", { name, msdyn_isomnichannelqueue: true, msdyn_queuetype: QUEUE_TYPES[fields.type], msdyn_priority: fields.priority, ...method, ...(description ? { description } : {}) });
}

export function addUsers({ api, store }: Admin, queueId: string, userIds: string[]): void {
  const queue = store.find("queue", queueId);
  if (!queue) throw new Error("The queue no longer exists.");
  const already = new Set(store.table("queuemembership").filter((m) => m.queueid === queue.queueid).map((m) => m.systemuserid));
  for (const id of new Set(userIds)) if (!already.has(id)) api.associate("queue", queue.queueid, "queuemembership_association", `/systemusers(${id})`);
}

export function setAssignmentMethod({ api }: Admin, queueId: string, method: AssignmentMethod): void {
  api.update("queue", queueId, { msdyn_assignmentstrategy: ASSIGNMENT_METHODS[method] });
}

export function setFallbackQueue({ api }: Admin, workstreamId: string, queueId: string): void {
  api.update("msdyn_liveworkstream", workstreamId, { "msdyn_defaultqueue@odata.bind": `/queues(${queueId})` });
}

// The workstream's route-to-queue ruleset, if it has one: its active routing configuration's "Route to
// queue" step (msdyn_type 192350002, route-to-queue-builder/src/schema.ts).
export function routeToQueueRuleset(store: Store, workstreamId: string): Row | undefined {
  const configs = store.table("msdyn_routingconfiguration").filter((c) => c._msdyn_liveworkstreamid_value === workstreamId);
  const config = configs.find((c) => c.msdyn_isactiveconfiguration === true) ?? configs[0];
  const step = config && store.table("msdyn_routingconfigurationstep").find((s) => s._msdyn_routingconfigurationid_value === config.msdyn_routingconfigurationid && s.msdyn_type === QUEUE_IDENTIFICATION);
  return step?._msdyn_rulesetid_value ? store.find("msdyn_decisionruleset", step._msdyn_rulesetid_value) : undefined;
}

// "Create ruleset" next to Route to queues: the ruleset, and the routing configuration and step that
// hold it, the way Route-to-Queue Builder creates them (route-to-queue-builder/src/execute.ts).
export function createRouteToQueueRuleset({ api, store }: Admin, workstreamId: string): string {
  const existing = routeToQueueRuleset(store, workstreamId);
  if (existing) return existing.msdyn_decisionrulesetid;
  const workstream = store.find("msdyn_liveworkstream", workstreamId);
  if (!workstream) throw new Error("The workstream no longer exists.");
  const output = store.table("msdyn_decisioncontract").find((c) => c.msdyn_name === QUEUE_OUTPUT_CONTRACT_NAME);
  if (!output || !workstream._msdyn_routingcontractid_value) throw new Error("This workstream can't have route-to-queue rules in this environment.");
  const unique = () => `new_${newGuid().replace(/-/g, "")}`;
  const name = `${workstream.msdyn_name} route to queue`;
  let config = store.table("msdyn_routingconfiguration").find((c) => c._msdyn_liveworkstreamid_value === workstreamId && c.msdyn_isactiveconfiguration === true);
  const configId = config?.msdyn_routingconfigurationid ?? api.create("msdyn_routingconfiguration", {
    msdyn_name: name, msdyn_uniquename: unique(), msdyn_isactiveconfiguration: true, "msdyn_liveworkstreamid@odata.bind": `/msdyn_liveworkstreams(${workstreamId})`
  });
  const rulesetId = api.create("msdyn_decisionruleset", {
    msdyn_name: name, msdyn_uniquename: unique(), msdyn_rulesetdefinition: emptyDefinition(), msdyn_rulesettype: 192350000, msdyn_authoringmode: 192350000,
    msdyn_isinputcollection: false, msdyn_persistoutputdata: false, msdyn_refreshinputdata: false,
    "msdyn_inputcontractid@odata.bind": `/msdyn_decisioncontracts(${workstream._msdyn_routingcontractid_value})`,
    "msdyn_outputcontractid@odata.bind": `/msdyn_decisioncontracts(${output.msdyn_decisioncontractid})`
  });
  const orders = store.table("msdyn_routingconfigurationstep").filter((s) => s._msdyn_routingconfigurationid_value === configId).map((s) => Number(s.msdyn_steporder ?? 0));
  api.create("msdyn_routingconfigurationstep", {
    msdyn_name: name, msdyn_uniquename: unique(), msdyn_type: QUEUE_IDENTIFICATION, msdyn_steporder: Math.max(0, ...orders) + 1,
    "msdyn_routingconfigurationid@odata.bind": `/msdyn_routingconfigurations(${configId})`, "msdyn_rulesetid@odata.bind": `/msdyn_decisionrulesets(${rulesetId})`
  });
  return rulesetId;
}

// "Create route to queue rule": one condition (a context variable equals a value) and one queue.
// Simplified: the real condition builder offers more operators, attributes and related records.
export function addRouteToQueueRule(admin: Admin, workstreamId: string, rule: { name: string; variable: string; value: string; queueId: string }): void {
  if (!rule.name.trim()) throw new Error("Enter a rule name.");
  if (!rule.variable || !rule.value.trim()) throw new Error("Complete the condition.");
  if (!rule.queueId) throw new Error("Select a queue in Route to queues.");
  const rulesetId = createRouteToQueueRuleset(admin, workstreamId);
  const ruleset = admin.store.find("msdyn_decisionruleset", rulesetId)!;
  admin.api.update("msdyn_decisionruleset", rulesetId, {
    msdyn_rulesetdefinition: appendRules(ruleset.msdyn_rulesetdefinition, [{ id: newGuid(), name: rule.name.trim(), variable: rule.variable, value: rule.value.trim(), queueId: rule.queueId }])
  });
}


// ---- Editing the decision list: Edit, Delete, Move up and Move down ----

// A rule the training's rule editor can show and change: one condition on a context variable with
// "equals", routing to one queue. Other rules (percentage splits, several conditions) can still be
// deleted and moved, but not edited.
export interface SimpleRule { id: string; name: string; variable: string; value: string; queueId: string }

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// One <rule id="…">…</rule> element of a ruleset definition, with the spaces before it.
const RULE_BLOCK = (id: string) => new RegExp("[ \\t]*<rule\\s+id=\"" + escapeRegExp(id) + "\"[\\s\\S]*?</rule>");

export function simpleRule(rule: { id: string; name: string; conditions: { operator: string; lhs: string; rhs?: string }[]; setAttributes: { lhs: string; rhs: string }[]; distributionRecords: unknown[] }): SimpleRule | undefined {
  if (rule.conditions.length !== 1 || rule.distributionRecords.length) return undefined;
  const c = rule.conditions[0];
  const queue = rule.setAttributes.find((s) => s.lhs === "assign_to.queue")?.rhs;
  if (!/^liveworkitemcontext\./.test(c.lhs) || !["==", "equals"].includes(c.operator) || c.rhs === undefined || !queue) return undefined;
  return { id: rule.id, name: rule.name, variable: c.lhs.replace(/^liveworkitemcontext\./, ""), value: c.rhs, queueId: queue.replace(/[{}]/g, "").toLowerCase() };
}

function rewriteRuleset(admin: Admin, workstreamId: string, change: (definition: string) => string): void {
  const ruleset = routeToQueueRuleset(admin.store, workstreamId);
  if (!ruleset) throw new Error("This workstream has no route-to-queue rules.");
  admin.api.update("msdyn_decisionruleset", ruleset.msdyn_decisionrulesetid, { msdyn_rulesetdefinition: change(String(ruleset.msdyn_rulesetdefinition ?? "")) });
}

export function updateRouteToQueueRule(admin: Admin, workstreamId: string, rule: SimpleRule): void {
  if (!rule.name.trim()) throw new Error("Enter a rule name.");
  if (!rule.variable || !rule.value.trim()) throw new Error("Complete the condition.");
  if (!rule.queueId) throw new Error("Select a queue in Route to queues.");
  rewriteRuleset(admin, workstreamId, (definition) => {
    if (!RULE_BLOCK(rule.id).test(definition)) throw new Error("The rule no longer exists.");
    return definition.replace(RULE_BLOCK(rule.id), ruleXml({ ...rule, name: rule.name.trim(), value: rule.value.trim() }));
  });
}

export function deleteRouteToQueueRule(admin: Admin, workstreamId: string, ruleId: string): void {
  rewriteRuleset(admin, workstreamId, (definition) => definition.replace(new RegExp(RULE_BLOCK(ruleId).source + "\\n?"), ""));
}

// Moves a rule one place up (-1) or down (+1) in the decision list.
export function moveRouteToQueueRule(admin: Admin, workstreamId: string, ruleId: string, step: -1 | 1): void {
  rewriteRuleset(admin, workstreamId, (definition) => {
    const blocks = [...definition.matchAll(/[ \t]*<rule\s+id="([^"]*)"[\s\S]*?<\/rule>/g)];
    const i = blocks.findIndex((b) => b[1] === ruleId);
    const j = i + step;
    if (i < 0 || j < 0 || j >= blocks.length) return definition;
    const [a, b] = i < j ? [blocks[i], blocks[j]] : [blocks[j], blocks[i]];
    const end = (m: RegExpMatchArray) => m.index! + m[0].length;
    return definition.slice(0, a.index) + b[0] + definition.slice(end(a), b.index) + a[0] + definition.slice(end(b));
  });
}

// ---- Phone numbers: the number pool (manual 5.1) ----
//
// "Add ACS number" in the real admin center buys a number through Azure Communication Services (Learn,
// Manage phone numbers). The training hands out the next free number from a range reserved for fiction
// instead, so a simulated number can never be a real one:
// - United States: 555-0100 to 555-0199, in any area code;
// - United Kingdom: Ofcom's London drama range, 020 7946 0000 to 0999.
// There's no fictional toll-free range, so toll-free numbers (and SMS, which Learn says only toll-free
// numbers have) aren't offered.

export const NUMBER_COUNTRIES = {
  "United States": { locations: { "206 (Washington)": "+1 206 555 01", "312 (Illinois)": "+1 312 555 01", "425 (Washington)": "+1 425 555 01" }, digits: 2 },
  "United Kingdom": { locations: { "020 (London)": "+44 20 7946 0" }, digits: 3 }
} as const;
export type NumberCountry = keyof typeof NUMBER_COUNTRIES;

const digitsOf = (n: unknown) => String(n ?? "").replace(/[^\d]/g, "");

// The next number in the range that isn't in the environment yet.
export function findNumber(store: Store, country: NumberCountry, location: string): string | undefined {
  const c = NUMBER_COUNTRIES[country];
  const prefix = (c.locations as Record<string, string>)[location];
  if (!prefix) throw new Error("Select a location.");
  const taken = new Set(store.table("msdyn_ocphonenumber").map((p) => digitsOf(p.msdyn_phonenumber)));
  for (let i = 0; i < 10 ** c.digits; i++) {
    const n = `${prefix}${String(i).padStart(c.digits, "0")}`;
    if (!taken.has(digitsOf(n))) return n;
  }
  return undefined;
}

export function purchaseNumber({ api, store }: Admin, number: string, plans: { receive: boolean; make: boolean }): string {
  if (!plans.receive && !plans.make) throw new Error("Select at least one calling plan.");
  if (store.table("msdyn_ocphonenumber").some((p) => digitsOf(p.msdyn_phonenumber) === digitsOf(number))) throw new Error("That number is already in this environment.");
  return api.create("msdyn_ocphonenumber", { msdyn_phonenumber: number, msdyn_phoneinboundenabled: plans.receive, msdyn_phoneoutboundenabled: plans.make });
}

// The voice channel a number is on, if any.
// The inbound line a number is on. An outbound profile's channel uses the number too, but only for calls
// out ("a number already used by an inbound channel is normal for an outbound profile", profile-builder/src/plan.ts).
export const isOutbound = (store: Store, workstreamId?: string) => !!workstreamId && store.find("msdyn_liveworkstream", workstreamId)?.msdyn_direction === DIRECTIONS.Outbound;
export const channelOfNumber = (store: Store, phoneId: string) => store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_phonenumberid_value === phoneId && !isOutbound(store, c._msdyn_liveworkstreamid_value));

// "Setup workstream": the number goes on a voice channel of that workstream. "You can associate a phone
// number with only one voice workstream" (Learn). Simplified: the training adds a voice channel with the
// number and the workstream's other settings stay as they are. The lookup names are Voice Workstream
// Builder's (voice-workstream-builder/src/voiceSchema.ts NAV.channel).
export function setupWorkstream({ api, store }: Admin, phoneId: string, workstreamId: string): string {
  const phone = store.find("msdyn_ocphonenumber", phoneId);
  const ws = store.find("msdyn_liveworkstream", workstreamId);
  if (!phone || !ws) throw new Error("The number or the workstream no longer exists.");
  if (channelOfNumber(store, phoneId)) throw new Error("This number is already on a workstream: a number can be on only one voice workstream.");
  if (!phone.msdyn_phoneinboundenabled) throw new Error("This number can't receive calls: its calling plan has no Receive calls.");
  const lines = store.table("msdyn_ocvoicechannelsetting").filter((c) => c._msdyn_liveworkstreamid_value === workstreamId).length;
  return api.create("msdyn_ocvoicechannelsetting", {
    msdyn_name: `${ws.msdyn_name.replace(/ – Voice$/, "")} line ${lines + 1}`,
    [`${VOICE_NAV.channel.workstream}@odata.bind`]: `/msdyn_liveworkstreams(${workstreamId})`,
    [`${VOICE_NAV.channel.phoneNumber}@odata.bind`]: `/msdyn_ocphonenumbers(${phoneId})`
  });
}

// ---- Queue: Operation hours and Overflow handling ----
//
// Learn, Create and manage queues for unified routing: "In Operation hours, select Set operation hours ...
// select an operating hour record in the Name list. Select Save and close." Learn, Manage overflow of work
// items in queues: "When you add an operating hour record to a queue, the system assigns a default overflow
// condition Out of operation hours with the action Assign to queue anyway." Overflow rules are written the
// way Voicemail Builder writes them (voicemail-builder/src/overflow.ts ruleXml, execute.ts).

export type OverflowCondition = "outOfHours" | "callsWaiting" | "estimatedWait" | "waitTime";
export type OverflowActionKind = "Assign to queue anyway" | "Direct callback" | "End call" | "Transfer to a different queue" | "Voicemail";
export interface OverflowPair { condition: OverflowCondition; value?: number; action: OverflowActionKind; targetQueueId?: string }

// msdyn_overflowactionconfig.msdyn_overflowactiontype for each action (src/simulator/schema.ts OVERFLOW_ACTION_TYPES).
export const OVERFLOW_ACTIONS: Record<OverflowActionKind, number> = {
  "Assign to queue anyway": 192350000, "End call": 192350001, "Direct callback": 192350003, "Voicemail": 192350004, "Transfer to a different queue": 192350005
};
const ACTION_OF_TYPE = Object.fromEntries(Object.entries(OVERFLOW_ACTIONS).map(([k, v]) => [v, k])) as Record<number, OverflowActionKind>;

export function setOperationHours({ api, store }: Admin, queueId: string, hoursId: string): void {
  if (!store.find("msdyn_operatinghour", hoursId)) throw new Error("Select an operating hour record.");
  api.update("queue", queueId, { [`${OPERATING_HOURS_NAV}@odata.bind`]: `/msdyn_operatinghours(${hoursId})` });
  const { before, queued } = readOverflow(store, queueId);
  if (!before.some((p) => p.condition === "outOfHours")) saveOverflow({ api, store }, queueId, [{ condition: "outOfHours", action: "Assign to queue anyway" }, ...before], queued);
}

// The queue's condition-action pairs: "Before work items are queued" (pre-queue) and "When work items are queued" (in-queue).
export function readOverflow(store: Store, queueId: string): { before: OverflowPair[]; queued: OverflowPair[] } {
  const queue = store.find("queue", queueId);
  const pairs = (rulesetId?: string): OverflowPair[] => {
    const set = rulesetId ? store.find("msdyn_decisionruleset", rulesetId) : undefined;
    return readOverflowRules(set?.msdyn_rulesetdefinition).flatMap((r) => {
      const config = r.actionId ? store.find("msdyn_overflowactionconfig", r.actionId) : undefined;
      const action = config ? ACTION_OF_TYPE[config.msdyn_overflowactiontype] : undefined;
      if (!r.condition || !action) return [];
      const pair: OverflowPair = { condition: r.condition, action };
      if (r.value && r.condition !== "outOfHours") pair.value = Number(r.value);
      if (action === "Transfer to a different queue") pair.targetQueueId = String(config!.msdyn_overflowactiondata ?? "");
      return [pair];
    });
  };
  return { before: pairs(queue?._msdyn_prequeueoverflowrulesetid_value), queued: pairs(queue?._msdyn_inqueueoverflowrulesetid_value) };
}

// The action record a rule points to: an existing one of that kind (and target queue), or a new one.
function actionConfig({ api, store }: Admin, pair: OverflowPair): string {
  const type = OVERFLOW_ACTIONS[pair.action];
  const transfer = pair.action === "Transfer to a different queue";
  const found = store.table("msdyn_overflowactionconfig").find((c) => c.msdyn_overflowactiontype === type && (!transfer || c.msdyn_overflowactiondata === pair.targetQueueId));
  if (found) return found.msdyn_overflowactionconfigid;
  const target = transfer ? store.find("queue", pair.targetQueueId ?? "") : undefined;
  if (transfer && !target) throw new Error("Select the queue to transfer to.");
  return api.create("msdyn_overflowactionconfig", { msdyn_name: target ? `QueueTransfer_${target.name}` : pair.action, msdyn_overflowactiontype: type, ...(target ? { msdyn_overflowactiondata: target.queueid } : {}) });
}

export function saveOverflow(admin: Admin, queueId: string, before: OverflowPair[], queued: OverflowPair[]): void {
  const { api, store } = admin;
  const queue = store.find("queue", queueId);
  if (!queue) throw new Error("The queue no longer exists.");
  for (const p of [...before, ...queued]) {
    if (p.condition === "outOfHours") continue;
    if (!(Number.isInteger(p.value) && (p.value as number) > 0)) throw new Error("Enter a whole number for each condition.");
    if (p.condition === "estimatedWait" && (p.value as number) > 60) throw new Error("Average wait time is 1 to 60 minutes.");
    if (p.condition === "callsWaiting" && (p.value as number) > 100) throw new Error("Work item limit exceeds is 1 to 100.");
  }
  if (before.some((p) => p.condition === "outOfHours") && !queue._msdyn_operatinghourid_value) throw new Error("Set operation hours first: without them the queue is never out of operation hours.");
  const stages: [OverflowPair[], "prequeue" | "inqueue"][] = [[before, "prequeue"], [queued, "inqueue"]];
  for (const [pairs, stage] of stages) {
    const column = stage === "prequeue" ? "_msdyn_prequeueoverflowrulesetid_value" : "_msdyn_inqueueoverflowrulesetid_value";
    let n = 0;
    const rules = pairs.map((p) => overflowRuleXml(newGuid(), `Rule${++n}`, { condition: p.condition, value: p.value }, actionConfig(admin, p)));
    const definition = `<decision hit-policy="first" version="1">\n  <rules>\n${rules.join("\n")}\n  </rules>\n</decision>`;
    const existing = store.find("queue", queueId)![column];
    if (existing) { api.update("msdyn_decisionruleset", existing, { msdyn_rulesetdefinition: definition }); continue; }
    if (!pairs.length) continue;
    const names = stage === "prequeue" ? PREQUEUE_CONTRACTS : INQUEUE_CONTRACTS;
    const contract = (name: string) => store.table("msdyn_decisioncontract").find((c) => c.msdyn_name === name)?.msdyn_decisioncontractid;
    const rulesetId = api.create("msdyn_decisionruleset", {
      msdyn_name: `queue_${stage}_${queue.name}`, msdyn_uniquename: `msdyn_${newGuid().replace(/-/g, "")}`, msdyn_rulesetdefinition: definition,
      msdyn_rulesettype: DECLARATIVE_RULESET, msdyn_authoringmode: DECISION_LIST, msdyn_isinputcollection: false, msdyn_persistoutputdata: false, msdyn_refreshinputdata: false,
      "msdyn_inputcontractid@odata.bind": `/msdyn_decisioncontracts(${contract(names.input)})`, "msdyn_outputcontractid@odata.bind": `/msdyn_decisioncontracts(${contract(names.output)})`
    });
    api.update("queue", queueId, { [`${stage === "prequeue" ? PREQUEUE_NAV : INQUEUE_NAV}@odata.bind`]: `/msdyn_decisionrulesets(${rulesetId})` });
  }
}

// ---- User management: Capacity profiles ----
//
// Learn, Create and manage capacity profiles: "select User management in Customer support ... select Manage
// for Capacity profile ... select Create new ... Profile name ... Work item limit ... On the Users tab,
// select Add user." "Users must be configured as a bookable resource to be assigned the capacity profile."
// Reset frequency and Assignment blocking aren't simulated.

export function createCapacityProfile({ api, store }: Admin, name: string, limit: number): string {
  if (!name.trim()) throw new Error("Enter a profile name.");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("The work item limit is a whole number, 1 or more.");
  if (store.table("msdyn_capacityprofile").some((p) => String(p.msdyn_name).toLowerCase() === name.trim().toLowerCase())) throw new Error("A capacity profile with this name already exists.");
  return api.create("msdyn_capacityprofile", { msdyn_name: name.trim(), msdyn_defaultmaxunits: limit });
}

export function setWorkItemLimit({ api }: Admin, profileId: string, limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("The work item limit is a whole number, 1 or more.");
  api.update("msdyn_capacityprofile", profileId, { msdyn_defaultmaxunits: limit });
}

export function addProfileUsers({ api, store }: Admin, profileId: string, userIds: string[]): void {
  const profile = store.find("msdyn_capacityprofile", profileId);
  if (!profile) throw new Error("The capacity profile no longer exists.");
  for (const userId of new Set(userIds)) {
    const resource = store.table("bookableresource").find((r) => r._userid_value === userId);
    if (!resource) throw new Error(`${store.find("systemuser", userId)?.fullname ?? "This user"} isn't a bookable resource, so they can't get a capacity profile.`);
    if (store.table("msdyn_bookableresourcecapacityprofile").some((l) => l._msdyn_bookableresourceid_value === resource.bookableresourceid && l._msdyn_capacityprofileid_value === profileId)) continue;
    api.create("msdyn_bookableresourcecapacityprofile", {
      msdyn_name: `${profile.msdyn_name}-${resource.bookableresourceid}`,
      "msdyn_bookableresourceid@odata.bind": `/bookableresources(${resource.bookableresourceid})`, "msdyn_capacityprofileid@odata.bind": `/msdyn_capacityprofiles(${profileId})`
    });
  }
}

// ---- Workstreams: New workstream (voice) ----
//
// Learn, Create and manage workstreams: "Select New workstream. In the Create a workstream dialog: Name, Type,
// Work distribution mode ... For voice, push mode only is available ... Fallback queue". The record is Voice
// Workstream Builder's (voice-workstream-builder/src/payload.ts workstreamPayload and capacityLinkPayload),
// with the default voice inbound capacity profile.
export function createVoiceWorkstream({ api, store }: Admin, name: string, fallbackQueueId: string): string {
  if (!name.trim()) throw new Error("Enter a name.");
  if (store.table("msdyn_liveworkstream").some((w) => String(w.msdyn_name).toLowerCase() === name.trim().toLowerCase())) throw new Error("A workstream with this name already exists.");
  if (!store.find("queue", fallbackQueueId)) throw new Error("Select a fallback queue.");
  const profile = store.table("msdyn_capacityprofile").find((p) => p.msdyn_uniquename === DEFAULT_CAPACITY_PROFILE.Inbound);
  const id = api.create("msdyn_liveworkstream", workstreamPayload({
    key: name, name: name.trim(), lines: [], direction: "Inbound", workDistribution: "Push", capacityFormat: "Profile", capacityUnits: 0,
    presences: ["Available", "Busy"], notification: "Screen pop with timeout", agentAffinity: false, restrictRecordingDownload: false, restrictTranscriptDownload: false,
    channels: [], refs: { defaultQueue: fallbackQueueId }
  }));
  if (profile) api.create("msdyn_liveworkstreamcapacityprofile", capacityLinkPayload(id, { id: profile.msdyn_capacityprofileid, name: profile.msdyn_name }));
  return id;
}

// ---- Power Platform admin center: Business units and Teams (onboarding, level 5) ----
//
// Learn, Create or edit business units: "On the Business Units page, select New business unit ... Enter a
// name for the new business unit. The Parent business unit field is pre-filled with the root business unit
// ... Select Save." The record is Business Unit Builder's (business-unit-builder/src/execute.ts unitPayload,
// dataSource.ts PARENT_NAV). The platform gives the new unit a default team and its own roles (rules.ts).
// Learn, Teams in Dataverse: "Select + Create team ... Team name ... Description ... Business unit ...
// Administrator ... Team type", then "Manage team members ... + Add team members". The record is Team
// Builder's (team-builder/src/plan.ts teamPayload); only Owner teams, the one type Team Builder makes
// without an Entra group.

export function createBusinessUnit({ api, store }: Admin, name: string, parentId: string): string {
  if (!name.trim()) throw new Error("Enter a name for the business unit.");
  if (!store.find("businessunit", parentId)) throw new Error("Select a parent business unit.");
  if (store.table("businessunit").some((u) => String(u.name).toLowerCase() === name.trim().toLowerCase())) throw new Error("A business unit with this name already exists.");
  return api.create("businessunit", { name: name.trim(), [`${UNIT_PARENT_NAV}@odata.bind`]: `/businessunits(${parentId})` });
}

export function createOwnerTeam({ api, store }: Admin, fields: { name: string; unitId: string; adminId: string; description?: string }): string {
  const unit = store.find("businessunit", fields.unitId);
  const admin = store.find("systemuser", fields.adminId);
  if (!fields.name.trim()) throw new Error("Enter a team name.");
  if (!unit) throw new Error("Select a business unit.");
  if (!admin) throw new Error("Select an administrator.");
  // "Be sure this name is unique within a business unit" (Learn).
  if (store.table("team").some((t) => t._businessunitid_value === unit.businessunitid && String(t.name).toLowerCase() === fields.name.trim().toLowerCase())) throw new Error("This business unit already has a team with this name.");
  return api.create("team", teamPayload({
    name: fields.name.trim(), type: "Owner", membership: "Members and guests",
    unit: { id: unit.businessunitid, name: unit.name, disabled: false },
    admin: { id: admin.systemuserid, fullName: admin.fullname, signIn: "", disabled: false, interactive: true },
    description: fields.description?.trim() || undefined
  }));
}

export function addTeamMembers({ api, store }: Admin, teamId: string, userIds: string[]): void {
  const team = store.find("team", teamId);
  if (!team) throw new Error("The team no longer exists.");
  // "You can't add or remove users from the business unit's default team" (Learn, Create or edit business units).
  if (team.isdefault) throw new Error("This is a business unit's default team: its members are the users of that business unit.");
  const already = new Set(store.table("teammembership").filter((m) => m.teamid === team.teamid).map((m) => m.systemuserid));
  for (const id of new Set(userIds)) if (!already.has(id)) api.associate("team", team.teamid, "teammembership_association", `/systemusers(${id})`);
}

// ---- Skills (level 4): the Skills hub, a workstream's skill matching, skill attachment rules ----
//
// Learn, Set up skills and assign representatives (ms.date 2026-05-08): "In the site map, select User
// management under Customer Support. Select Manage for Skills hub." "On the Skills page, select Create. On the
// Create Skill dialog, select a skill type in the Skill type list, and then enter a name for it in Skill name.
// To add the skill to users, in the Users section, select Add ... Select Add selected users. To add proficiency,
// select the users ... select Update proficiency, and select a value." A user's skill is a bookable resource
// characteristic, written the way Skill Assignment writes it (skill-assignment/src/plan.ts assignmentPayload).

export function createSkill({ api, store }: Admin, name: string): string {
  if (!name.trim()) throw new Error("Enter a skill name.");
  // "The name must be unique" (Learn).
  if (store.table("characteristic").some((c) => String(c.name).toLowerCase() === name.trim().toLowerCase())) throw new Error("A skill with this name already exists.");
  return api.create("characteristic", { name: name.trim(), characteristictype: SKILL_TYPE });
}

// Adds the skill to each user, or changes their proficiency when they have it already.
export function setUserSkills({ api, store }: Admin, skillId: string, userIds: string[], ratingId: string): void {
  if (!store.find("characteristic", skillId)) throw new Error("The skill no longer exists.");
  if (!store.find("ratingvalue", ratingId)) throw new Error("Select a proficiency.");
  for (const userId of new Set(userIds)) {
    const user = store.find("systemuser", userId);
    const resource = store.table("bookableresource").find((r) => r._userid_value === userId);
    if (!resource) throw new Error(`${user?.fullname ?? "This user"} isn't set up as a bookable resource, so skills can't be added.`);
    const link = store.table("bookableresourcecharacteristic").find((l) => l._resource_value === resource.bookableresourceid && l._characteristic_value === skillId);
    if (link) api.update("bookableresourcecharacteristic", link.bookableresourcecharacteristicid, { "RatingValue@odata.bind": `/ratingvalues(${ratingId})` });
    else api.create("bookableresourcecharacteristic", assignmentPayload(resource.bookableresourceid, skillId, ratingId));
  }
}

export function removeUserSkill({ api, store }: Admin, skillId: string, userId: string): void {
  const resource = store.table("bookableresource").find((r) => r._userid_value === userId);
  const link = resource && store.table("bookableresourcecharacteristic").find((l) => l._resource_value === resource.bookableresourceid && l._characteristic_value === skillId);
  if (link) api.remove("bookableresourcecharacteristic", link.bookableresourcecharacteristicid);
}

// Learn, Understand how skill match algorithm works: "In the work distribution settings of the workstream, set
// the value for Default skill matching algorithm as Exact Match" (or Closest Match).
export function setMatchingLogic({ api }: Admin, workstreamId: string, matching: Matching | undefined): void {
  api.update("msdyn_liveworkstream", workstreamId, { msdyn_matchinglogic: matching ? MATCHING[matching] : null });
}

// Learn, Configure work classification rulesets: in a workstream's Routing rules, "Work classification
// (optional)", Create Ruleset, then Create Rule with a name, Conditions and the skills in the Output. Kept in
// the training table training_skillrule (src/simulator/schema.ts).
export interface SkillRuleFields { name: string; variable: string; value: string; skillId: string; ratingId: string }

export function addSkillRule({ store }: Admin, workstreamId: string, f: SkillRuleFields): string {
  if (!f.name.trim()) throw new Error("Enter a rule name.");
  if (!f.variable) throw new Error("Select the field the condition checks.");
  if (!f.value.trim()) throw new Error("Enter the value the condition checks for.");
  if (!store.find("characteristic", f.skillId)) throw new Error("Select a skill.");
  if (!store.find("ratingvalue", f.ratingId)) throw new Error("Select a proficiency.");
  const orders = store.table("training_skillrule").filter((r) => r.workstreamid === workstreamId).map((r) => r.ruleorder as number);
  const id = newGuid();
  store.insert("training_skillrule", {
    training_skillruleid: id, workstreamid: workstreamId, name: f.name.trim(), ruleorder: Math.max(0, ...orders) + 1,
    variable: f.variable, value: f.value.trim(), skillid: f.skillId, ratingvalueid: f.ratingId
  });
  return id;
}

export function deleteSkillRule({ store }: Admin, ruleId: string): void {
  store.remove("training_skillrule", ruleId);
}

// ---- Outbound profiles (level 5) ----
//
// Learn, Configure outbound and inbound profiles (ms.date 2026-07-30): "In the Copilot Service admin center site
// map, select Productivity in Support experience. On the Productivity page, select Manage for Outbound and inbound
// profiles. Select New profile." Then Profile name, Profile type Outbound; Phone number ("only those numbers that
// are enabled for outbound calling"); Outbound info: Queue, Capacity, Caller ID number. Stored the way Profile
// Builder stores it: "An outbound profile is stored exactly like an outbound voice workstream with one voice
// channel" (profile-builder/src/plan.ts), with Voice Workstream Builder's payloads.

export interface OutboundProfileFields { name: string; phoneId: string; queueId: string; capacityProfileId?: string; callerIdPhoneId?: string }

export const outboundProfiles = (store: Store) => store.table("msdyn_liveworkstream").filter((w) => w.msdyn_direction === DIRECTIONS.Outbound && w.statecode === 0);

export function createOutboundProfile({ api, store }: Admin, f: OutboundProfileFields): string {
  const name = f.name.trim();
  if (!name) throw new Error("Enter a profile name.");
  if (store.table("msdyn_liveworkstream").some((w) => String(w.msdyn_name).toLowerCase() === name.toLowerCase())) throw new Error("A profile or workstream with this name already exists.");
  const phone = store.find("msdyn_ocphonenumber", f.phoneId);
  if (!phone) throw new Error("Select a phone number.");
  if (!phone.msdyn_phoneoutboundenabled) throw new Error("This number isn't enabled for outbound calling: its calling plan has no Make calls.");
  if (!store.find("queue", f.queueId)) throw new Error("Select a queue.");
  const callerId = f.callerIdPhoneId ?? f.phoneId;
  const profile = f.capacityProfileId ? store.find("msdyn_capacityprofile", f.capacityProfileId) : store.table("msdyn_capacityprofile").find((p) => p.msdyn_uniquename === DEFAULT_CAPACITY_PROFILE.Outbound);
  // What the admin center writes on an outbound profile (profile-builder/src/plan.ts, and IMPLEMENTATION_STATUS.md
  // for the live one: presences Available and Busy): push distribution,
  // profile-based capacity (30, unused for profiles), screen pop with timeout, no affinity.
  const id = api.create("msdyn_liveworkstream", workstreamPayload({
    key: name, name, lines: [], direction: "Outbound", workDistribution: "Push", capacityFormat: "Profile", capacityUnits: 30,
    presences: ["Available", "Busy"], outboundQueue: f.queueId, notification: "Screen pop with timeout", agentAffinity: false, restrictRecordingDownload: false, restrictTranscriptDownload: false,
    channels: [], refs: { outboundQueue: f.queueId }
  }));
  if (profile) api.create("msdyn_liveworkstreamcapacityprofile", capacityLinkPayload(id, { id: profile.msdyn_capacityprofileid, name: profile.msdyn_name }));
  api.create("msdyn_ocvoicechannelsetting", channelPayload(id, {
    line: 0, name, phoneNumber: phone.msdyn_phonenumber, language: "en-US", voiceSpeed: 0, voicePitch: 0,
    recording: { capture: "none", start: "automatic", agentTranscriptionControls: false, agentRecordingControls: false, requestConsent: false, stopOnHold: false, playNotifications: false, showTranscriptByDefault: false },
    pstnTransferControls: false, teamsTransferControls: false,
    outbound: { callerIdNumber: store.find("msdyn_ocphonenumber", callerId)?.msdyn_phonenumber, anonymousCallerId: false },
    refs: { phoneNumber: f.phoneId, callerIdNumber: callerId }
  }));
  return id;
}
