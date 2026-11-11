// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { OPERATOR_MAP, STEP_TYPE_ENRICHMENT } from "@toolbox/visual-routing-tester/src/dataverse";
import { isParsedGroup, ParsedGroup, ParsedRule, parseDecisionXml, withHitPolicy, WritableAction, WritableGroup, writeRuleXml } from "@toolbox/visual-routing-tester/src/ruleXml";
import { appendRuleXml } from "@toolbox/route-to-queue-builder/src/rules";
import { newGuid, Row, Store } from "../simulator/store";
import { Admin, createRouteToQueueRuleset, routeToQueueRuleset } from "./actions";

// The rule editor of the simulated admin center: conditions in And/Or groups, a queue or a percentage split
// for route-to-queue rules, and outputs for work classification rules. The XML is written and read by the
// Toolbox (visual-routing-tester/src/ruleXml.ts writeRuleXml and parseDecisionXml), so what the editor saves
// is what the routing engine evaluates.
//
// What the editor offers, from the admin center (docs/admin-center-check.md, checked 2026-11-11):
// - fields: the workstream's context variables (under "Context item value (Conversation)") and Priority Score;
// - operators: those of the real admin center whose XML the Toolbox knows (OPERATOR_MAP). Left out: Does not
//   contain, Begins with, Ends with, In, Not In and Does not contain data, and the date operators;
// - up to five queues in a percentage split that totals 100 (Learn, Configure route-to-queue rules);
// - up to five outputs per classification rule (Learn, Configure work classification rulesets).

export type FieldType = "text" | "number";

export interface RuleField {
  lhs: string;
  label: string;
  type: FieldType;
  // Where the admin center lists it: a related entity or the root record.
  under: "Context item value (Conversation)" | "Conversation";
}

export interface RuleOperator { xml: string; label: string; types: FieldType[]; needsValue: boolean }

export const OPERATORS: RuleOperator[] = [
  { xml: "==", label: "Equals", types: ["text", "number"], needsValue: true },
  { xml: "!=", label: "Does not equal", types: ["text", "number"], needsValue: true },
  { xml: "contains", label: "Contains", types: ["text"], needsValue: true },
  { xml: ">", label: "Is greater than", types: ["number"], needsValue: true },
  { xml: ">=", label: "Is greater than or equal to", types: ["number"], needsValue: true },
  { xml: "<", label: "Is less than", types: ["number"], needsValue: true },
  { xml: "<=", label: "Is less than or equal to", types: ["number"], needsValue: true },
  { xml: "not-null", label: "Contains data", types: ["text", "number"], needsValue: false }
];
// Every operator offered is one the routing engine understands.
for (const o of OPERATORS) if (!OPERATOR_MAP[o.xml]) throw new Error(`The routing engine doesn't know the operator ${o.xml}.`);

export const operatorLabel = (xml: string) => OPERATORS.find((o) => o.xml === xml)?.label ?? (xml === "equals" ? "Equals" : xml);

const CONTEXT = "liveworkitemcontext.";
export const PRIORITY_SCORE = "msdyn_ocliveworkitem.msdyn_priorityscore";
const NUMBER_VARIABLE = 192350001;

export function ruleFields(store: Store, workstreamId: string): RuleField[] {
  const variables = store.table("msdyn_ocliveworkstreamcontextvariable").filter((v) => v._msdyn_liveworkstreamid_value === workstreamId)
    .sort((a, b) => String(a.msdyn_name).localeCompare(String(b.msdyn_name)));
  return [
    ...variables.map((v): RuleField => ({ lhs: CONTEXT + v.msdyn_name, label: String(v.msdyn_name), type: v.msdyn_datatype === NUMBER_VARIABLE ? "number" : "text", under: "Context item value (Conversation)" })),
    { lhs: PRIORITY_SCORE, label: "Priority Score", type: "number", under: "Conversation" }
  ];
}

// How a field reads in the decision list: "MenuItemSelected", "Priority Score".
export function fieldLabel(lhs: string): string {
  if (lhs === PRIORITY_SCORE) return "Priority Score";
  return lhs.replace(/^liveworkitemcontext\./, "").replace(/^msdyn_ocliveworkitem\./, "");
}

// ---- Conditions as the editor holds them ----

export interface ConditionRow { field: string; operator: string; value: string }
export interface ConditionGroup { logic: "AND" | "OR"; items: (ConditionRow | ConditionGroup)[] }
export const isGroup = (item: ConditionRow | ConditionGroup): item is ConditionGroup => "items" in item;
export const emptyConditions = (): ConditionGroup => ({ logic: "AND", items: [] });

// The editor's top group is always And, as in the admin center. In real data the conditions on context
// variables sit in a second And group inside the outer one (the related entity "Context item value"); the
// editor writes them that way and unwraps it again when it reads a rule.
function toWritable(group: ConditionGroup): WritableGroup {
  const items = (g: ConditionGroup): WritableGroup => ({
    operator: g.logic,
    items: g.items.map((item) => (isGroup(item) ? items(item) : { operator: item.operator, lhs: item.field, ...(needsValue(item.operator) ? { rhs: item.value.trim() } : {}) }))
  });
  return { operator: "AND", items: [items({ logic: "AND", items: group.items })] };
}

function fromParsed(group: ParsedGroup): ConditionGroup {
  let g = group;
  while (g.operator === "AND" && g.items.length === 1 && isParsedGroup(g.items[0]) && g.items[0].operator === "AND") g = g.items[0];
  const convert = (p: ParsedGroup): ConditionGroup => ({
    logic: p.operator,
    items: p.items.map((item) => (isParsedGroup(item) ? convert(item) : { field: item.lhs, operator: item.operator === "equals" || item.operator === "=" ? "==" : item.operator, value: item.rhs ?? "" }))
  });
  const top = convert(g);
  return top.logic === "AND" ? top : { logic: "AND", items: [top] };
}

const needsValue = (xml: string) => OPERATORS.find((o) => o.xml === xml)?.needsValue ?? true;

// The conditions in words, for the decision list: "Region equals North and (MenuItemSelected equals Sales or …)".
export function describeConditions(group: ConditionGroup): string {
  const text = (g: ConditionGroup): string => g.items.map((item) => (isGroup(item)
    ? `(${text(item)})`
    : `${fieldLabel(item.field)} ${operatorLabel(item.operator).toLowerCase()}${needsValue(item.operator) ? ` ${item.value}` : ""}`)).join(` ${g.logic.toLowerCase()} `);
  return group.items.length ? text(group) : "Always";
}

function checkConditions(group: ConditionGroup, fields: RuleField[]): void {
  const check = (g: ConditionGroup) => {
    if (g !== group && !g.items.length) throw new Error("A group has no rows. Add a row to it, or remove the group.");
    for (const item of g.items) {
      if (isGroup(item)) { check(item); continue; }
      const field = fields.find((f) => f.lhs === item.field);
      if (!field) throw new Error(item.field ? `${fieldLabel(item.field)} isn't a field of this workstream.` : "Select a field in each row.");
      const op = OPERATORS.find((o) => o.xml === item.operator);
      if (!op || !op.types.includes(field.type)) throw new Error(`Select an operator for ${field.label}.`);
      if (op.needsValue && !item.value.trim()) throw new Error(`Enter a value for ${field.label}.`);
      if (op.needsValue && field.type === "number" && Number.isNaN(Number(item.value))) throw new Error(`${field.label} is a number: enter a number.`);
    }
  };
  check(group);
}

// ---- Rulesets: replacing, removing and moving rules ----

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RULE_BLOCK = (id: string) => new RegExp("[ \\t]*<rule\\s+id=\"" + escapeRegExp(id) + "\"[\\s\\S]*?</rule>");

function rewrite(admin: Admin, ruleset: Row, change: (definition: string) => string): void {
  admin.api.update("msdyn_decisionruleset", ruleset.msdyn_decisionrulesetid, { msdyn_rulesetdefinition: change(String(ruleset.msdyn_rulesetdefinition ?? "")) });
}

// A new rule goes after the existing ones; an existing rule is replaced where it is.
function putRule(admin: Admin, ruleset: Row, id: string | undefined, xml: (id: string) => string): void {
  if (!id) return rewrite(admin, ruleset, (definition) => appendRuleXml(definition, [xml(newGuid())]));
  rewrite(admin, ruleset, (definition) => {
    if (!RULE_BLOCK(id).test(definition)) throw new Error("The rule no longer exists.");
    return definition.replace(RULE_BLOCK(id), xml(id));
  });
}

export function deleteRule(admin: Admin, ruleset: Row, ruleId: string): void {
  rewrite(admin, ruleset, (definition) => definition.replace(new RegExp(RULE_BLOCK(ruleId).source + "\\n?"), ""));
}

// Moves a rule one place up (-1) or down (+1) in its decision list.
export function moveRule(admin: Admin, ruleset: Row, ruleId: string, step: -1 | 1): void {
  rewrite(admin, ruleset, (definition) => {
    const blocks = [...definition.matchAll(/[ \t]*<rule\s+id="([^"]*)"[\s\S]*?<\/rule>/g)];
    const i = blocks.findIndex((b) => b[1] === ruleId);
    const j = i + step;
    if (i < 0 || j < 0 || j >= blocks.length) return definition;
    const [a, b] = i < j ? [blocks[i], blocks[j]] : [blocks[j], blocks[i]];
    const end = (m: RegExpMatchArray) => m.index! + m[0].length;
    return definition.slice(0, a.index) + b[0] + definition.slice(end(a), b.index) + a[0] + definition.slice(end(b));
  });
}

export const rulesOf = (ruleset: Row | undefined): ParsedRule[] => (ruleset ? parseDecisionXml(ruleset.msdyn_rulesetdefinition)?.rules ?? [] : []);
export const hitPolicyOf = (ruleset: Row | undefined): "first" | "all" | undefined => (ruleset ? parseDecisionXml(ruleset.msdyn_rulesetdefinition)?.hitPolicy : undefined);

// ---- Route-to-queue rules ----

export interface QueueShare { queueId: string; percentage: string }
export interface RouteRule { id?: string; name: string; conditions: ConditionGroup; queues: QueueShare[] }

export const MAX_QUEUES = 5;

const cleanId = (id: string) => id.replace(/[{}]/g, "").toLowerCase();

export function readRouteRule(rule: ParsedRule): RouteRule {
  const split = rule.distributionRecords.map((r) => ({
    queueId: cleanId(r.find((s) => s.lhs === "queuedetails.queueid")?.rhs ?? ""),
    percentage: r.find((s) => s.lhs === "queuedetails.percentage")?.rhs ?? ""
  }));
  const queue = rule.setAttributes.find((s) => s.lhs === "assign_to.queue")?.rhs;
  return { id: rule.id, name: rule.name, conditions: fromParsed(rule.group), queues: split.length ? split : [{ queueId: queue ? cleanId(queue) : "", percentage: "" }] };
}

function routeAction(store: Store, queues: QueueShare[]): WritableAction {
  if (!queues.length || queues.some((q) => !q.queueId)) throw new Error("Select a queue in Route to queues.");
  if (queues.length > MAX_QUEUES) throw new Error(`A rule can share calls between up to ${MAX_QUEUES} queues.`);
  for (const q of queues) if (!store.find("queue", q.queueId)) throw new Error("A queue in Route to queues no longer exists.");
  if (new Set(queues.map((q) => q.queueId)).size !== queues.length) throw new Error("Each queue can be in Route to queues once.");
  if (queues.length === 1) return { queueId: queues[0].queueId };
  const split = queues.map((q) => ({ queueId: q.queueId, percentage: Number(q.percentage) }));
  if (split.some((q) => !Number.isInteger(q.percentage) || q.percentage < 1 || q.percentage > 99)) throw new Error("Enter a Work allocation percentage from 1 to 99 for each queue.");
  const total = split.reduce((sum, q) => sum + q.percentage, 0);
  if (total !== 100) throw new Error(`The Work allocation percentages add up to ${total}. They must total 100.`);
  return { split };
}

export function saveRouteRule(admin: Admin, workstreamId: string, rule: RouteRule): void {
  const name = rule.name.trim();
  if (!name) throw new Error("Enter a rule name.");
  checkConditions(rule.conditions, ruleFields(admin.store, workstreamId));
  const action = routeAction(admin.store, rule.queues);
  const rulesetId = createRouteToQueueRuleset(admin, workstreamId);
  const ruleset = admin.store.find("msdyn_decisionruleset", rulesetId)!;
  putRule(admin, ruleset, rule.id, (id) => writeRuleXml({ id, name, conditions: toWritable(rule.conditions), action }));
}

// Rule hit policy on the workstream page: Hit-all or Hit-first.
export function setHitPolicy(admin: Admin, workstreamId: string, hitPolicy: "first" | "all"): void {
  const ruleset = routeToQueueRuleset(admin.store, workstreamId);
  if (!ruleset) throw new Error("This workstream has no route-to-queue rules.");
  rewrite(admin, ruleset, (definition) => withHitPolicy(definition, hitPolicy));
}

// ---- The one-condition rules lessons, scenarios and the export work with ----

// A rule with one condition on a context variable with "equals", routing to one queue.
export interface SimpleRule { id: string; name: string; variable: string; value: string; queueId: string }

export function simpleRule(rule: { id: string; name: string; conditions: { operator: string; lhs: string; rhs?: string }[]; setAttributes: { lhs: string; rhs: string }[]; distributionRecords: unknown[] }): SimpleRule | undefined {
  if (rule.conditions.length !== 1 || rule.distributionRecords.length) return undefined;
  const c = rule.conditions[0];
  const queue = rule.setAttributes.find((s) => s.lhs === "assign_to.queue")?.rhs;
  if (!/^liveworkitemcontext./.test(c.lhs) || !["==", "equals"].includes(c.operator) || c.rhs === undefined || !queue) return undefined;
  return { id: rule.id, name: rule.name, variable: c.lhs.replace(/^liveworkitemcontext./, ""), value: c.rhs, queueId: queue.replace(/[{}]/g, "").toLowerCase() };
}

export function updateRouteToQueueRule(admin: Admin, workstreamId: string, rule: SimpleRule): void {
  saveRouteRule(admin, workstreamId, { id: rule.id, name: rule.name, conditions: { logic: "AND", items: [{ field: CONTEXT + rule.variable, operator: "==", value: rule.value }] }, queues: [{ queueId: rule.queueId, percentage: "" }] });
}

function routeRuleset(admin: Admin, workstreamId: string): Row {
  const ruleset = routeToQueueRuleset(admin.store, workstreamId);
  if (!ruleset) throw new Error("This workstream has no route-to-queue rules.");
  return ruleset;
}

export const deleteRouteToQueueRule = (admin: Admin, workstreamId: string, ruleId: string) => deleteRule(admin, routeRuleset(admin, workstreamId), ruleId);
export const moveRouteToQueueRule = (admin: Admin, workstreamId: string, ruleId: string, step: -1 | 1) => moveRule(admin, routeRuleset(admin, workstreamId), ruleId, step);

// ---- Work classification rulesets ----
//
// Learn, Configure work classification rulesets (ms.date 2026-05-08): up to 10 rulesets per workstream, run in
// order; within a ruleset, the first rule that matches sets its outputs and the next ruleset runs (the
// real classification ruleset in the Toolbox's test data has hit-policy "first"). Each is a step of type
// Work classification in the workstream's routing configuration (visual-routing-tester/src/dataverse.ts).

export const MAX_RULESETS = 10;
export const MAX_OUTPUTS = 5;

function activeConfig(store: Store, workstreamId: string): Row | undefined {
  const configs = store.table("msdyn_routingconfiguration").filter((c) => c._msdyn_liveworkstreamid_value === workstreamId);
  return configs.find((c) => c.msdyn_isactiveconfiguration === true) ?? configs[0];
}

function classificationSteps(store: Store, workstreamId: string): Row[] {
  const config = activeConfig(store, workstreamId);
  return config ? store.table("msdyn_routingconfigurationstep")
    .filter((s) => s._msdyn_routingconfigurationid_value === config.msdyn_routingconfigurationid && s.msdyn_type === STEP_TYPE_ENRICHMENT && s._msdyn_rulesetid_value)
    .sort((a, b) => Number(a.msdyn_steporder ?? 0) - Number(b.msdyn_steporder ?? 0)) : [];
}

export function classificationRulesets(store: Store, workstreamId: string): Row[] {
  return classificationSteps(store, workstreamId).map((s) => store.find("msdyn_decisionruleset", s._msdyn_rulesetid_value)).filter((r): r is Row => !!r);
}

export function createClassificationRuleset({ api, store }: Admin, workstreamId: string, fields: { name: string; description?: string }): string {
  const name = fields.name.trim();
  if (!name) throw new Error("Enter a name for the ruleset.");
  if (classificationRulesets(store, workstreamId).length >= MAX_RULESETS) throw new Error(`A workstream can have up to ${MAX_RULESETS} work classification rulesets.`);
  const workstream = store.find("msdyn_liveworkstream", workstreamId);
  if (!workstream) throw new Error("The workstream no longer exists.");
  if (!workstream._msdyn_routingcontractid_value) throw new Error("This workstream can't have work classification rules in this environment.");
  const unique = () => `new_${newGuid().replace(/-/g, "")}`;
  const configId = activeConfig(store, workstreamId)?.msdyn_routingconfigurationid ?? api.create("msdyn_routingconfiguration", {
    msdyn_name: `${workstream.msdyn_name} routing`, msdyn_uniquename: unique(), msdyn_isactiveconfiguration: true, "msdyn_liveworkstreamid@odata.bind": `/msdyn_liveworkstreams(${workstreamId})`
  });
  const description = fields.description?.trim();
  // Simplified: the input and output contract are both the workstream's own; the real output contract of a
  // classification ruleset wasn't checked.
  const contract = `/msdyn_decisioncontracts(${workstream._msdyn_routingcontractid_value})`;
  const rulesetId = api.create("msdyn_decisionruleset", {
    msdyn_name: name, msdyn_uniquename: unique(), msdyn_rulesetdefinition: "<decision hit-policy=\"first\" version=\"1\">\n  <rules>\n  </rules>\n</decision>",
    msdyn_rulesettype: 192350000, msdyn_authoringmode: 192350000, msdyn_isinputcollection: false, msdyn_persistoutputdata: false, msdyn_refreshinputdata: false,
    "msdyn_inputcontractid@odata.bind": contract, "msdyn_outputcontractid@odata.bind": contract, ...(description ? { msdyn_description: description } : {})
  });
  const orders = classificationSteps(store, workstreamId).map((s) => Number(s.msdyn_steporder ?? 0));
  api.create("msdyn_routingconfigurationstep", {
    msdyn_name: name, msdyn_uniquename: unique(), msdyn_type: STEP_TYPE_ENRICHMENT, msdyn_steporder: orders.length ? Math.max(...orders) + 1 : 0,
    "msdyn_routingconfigurationid@odata.bind": `/msdyn_routingconfigurations(${configId})`, "msdyn_rulesetid@odata.bind": `/msdyn_decisionrulesets(${rulesetId})`
  });
  return rulesetId;
}

export function deleteClassificationRuleset({ api, store }: Admin, workstreamId: string, rulesetId: string): void {
  const step = classificationSteps(store, workstreamId).find((s) => s._msdyn_rulesetid_value === rulesetId);
  if (step) api.remove("msdyn_routingconfigurationstep", step.msdyn_routingconfigurationstepid);
  if (store.find("msdyn_decisionruleset", rulesetId)) api.remove("msdyn_decisionruleset", rulesetId);
}

export function moveClassificationRuleset({ api, store }: Admin, workstreamId: string, rulesetId: string, step: -1 | 1): void {
  const steps = classificationSteps(store, workstreamId);
  const i = steps.findIndex((s) => s._msdyn_rulesetid_value === rulesetId);
  const j = i + step;
  if (i < 0 || j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  steps.forEach((s, order) => { if (s.msdyn_steporder !== order) api.update("msdyn_routingconfigurationstep", s.msdyn_routingconfigurationstepid, { msdyn_steporder: order }); });
}

export interface Output { field: string; value: string }
export interface ClassificationRule { id?: string; name: string; conditions: ConditionGroup; outputs: Output[] }

export function readClassificationRule(rule: ParsedRule): ClassificationRule {
  return { id: rule.id, name: rule.name, conditions: fromParsed(rule.group), outputs: rule.setAttributes.map((s) => ({ field: s.lhs, value: s.rhs })) };
}

export function saveClassificationRule(admin: Admin, workstreamId: string, rulesetId: string, rule: ClassificationRule): void {
  const name = rule.name.trim();
  if (!name) throw new Error("Enter a rule name.");
  const fields = ruleFields(admin.store, workstreamId);
  checkConditions(rule.conditions, fields);
  if (!rule.outputs.length) throw new Error("Add an attribute in Output: what the rule sets when it matches.");
  if (rule.outputs.length > MAX_OUTPUTS) throw new Error(`A rule can set up to ${MAX_OUTPUTS} attributes.`);
  if (new Set(rule.outputs.map((o) => o.field)).size !== rule.outputs.length) throw new Error("We found some duplicate attributes. Change or remove any attributes that appear more than once.");
  for (const o of rule.outputs) {
    const field = fields.find((f) => f.lhs === o.field);
    if (!field) throw new Error("Select an attribute in each Output row.");
    if (!o.value.trim()) throw new Error(`Enter the value ${field.label} is set to.`);
    if (field.type === "number" && Number.isNaN(Number(o.value))) throw new Error(`${field.label} is a number: enter a number.`);
  }
  const ruleset = admin.store.find("msdyn_decisionruleset", rulesetId);
  if (!ruleset) throw new Error("The ruleset no longer exists.");
  putRule(admin, ruleset, rule.id, (id) => writeRuleXml({ id, name, conditions: toWritable(rule.conditions), action: { sets: rule.outputs.map((o) => ({ lhs: o.field, rhs: o.value.trim() })) } }));
}
