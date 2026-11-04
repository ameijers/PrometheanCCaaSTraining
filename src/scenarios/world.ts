// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { QUEUE_TYPES } from "@toolbox/queue-builder/src/queueSchema";
import { loadRoutingModel } from "@toolbox/visual-routing-tester/src/dataverse";
import { Workstream } from "@toolbox/visual-routing-tester/src/model";
import { parseDecisionXml } from "@toolbox/visual-routing-tester/src/ruleXml";
import { routeToQueueRuleset } from "../admin/actions";
import { overflowTrigger } from "../calls/engine";
import { cleanId, Rows, Store } from "../simulator/store";
import { healthySeed } from "../simulator/seeds/healthy";
import { describeHours, HOURS } from "../simulator/seeds/hours";
import { Answer, Fault, Scenario } from "./scenario";

// The world a scenario starts in: the healthy environment (seeds/healthy.ts) with the scenario's faults
// planted, and a description of that environment in plain words, for the AI that writes scenarios and
// for the checks that test them.

// Ids for the switched-off queues faults add.
const offId = (n: number) => `000000f0-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function scenarioRows(scenario: Pick<Scenario, "faults">): Rows {
  const rows = healthySeed();
  const store = new Store(rows);
  (scenario.faults ?? []).forEach((f, i) => plant(store, f, i + 1));
  return store.snapshot();
}

// A queue that was switched off (statecode 1): still a record, but not an active omnichannel queue, so
// the health checks report whatever still points at it.
function switchedOff(store: Store, n: number, name: string): string {
  const id = offId(n);
  store.insert("queue", { queueid: id, name: `${name} (old)`, msdyn_isomnichannelqueue: true, msdyn_queuetype: QUEUE_TYPES.Voice, statecode: 1 });
  return id;
}

function plant(store: Store, fault: Fault, n: number): void {
  const workstream = (name: string) => {
    const w = store.table("msdyn_liveworkstream").find((x) => x.msdyn_name === name);
    if (!w) throw new Error(`There's no workstream named “${name}”.`);
    return w;
  };
  switch (fault.type) {
    case "no-members": {
      const queue = store.table("queue").find((q) => q.name === fault.queue && q.statecode === 0);
      if (!queue) throw new Error(`There's no queue named “${fault.queue}”.`);
      for (const m of store.table("queuemembership").filter((x) => x.queueid === queue.queueid)) store.remove("queuemembership", m.queuemembershipid);
      return;
    }
    case "fallback-queue-off": {
      const w = workstream(fault.workstream);
      const old = store.find("queue", w._msdyn_defaultqueue_value);
      store.update("msdyn_liveworkstream", w.msdyn_liveworkstreamid, { _msdyn_defaultqueue_value: switchedOff(store, n, old?.name ?? "Fallback") });
      return;
    }
    case "rule-queue-off": {
      const w = workstream(fault.workstream);
      const ruleset = routeToQueueRuleset(store, w.msdyn_liveworkstreamid);
      const xml = String(ruleset?.msdyn_rulesetdefinition ?? "");
      const rule = parseDecisionXml(xml)?.rules.find((r) => r.name === fault.rule);
      if (!ruleset || !rule) throw new Error(`The workstream “${fault.workstream}” has no rule named “${fault.rule}”.`);
      const target = rule.setAttributes.find((s) => s.lhs === "assign_to.queue");
      const queue = target && store.find("queue", cleanId(target.rhs));
      if (!target || !queue) throw new Error(`The rule “${fault.rule}” doesn't route to one queue.`);
      const block = new RegExp(`<rule\\s+id="${rule.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?</rule>`).exec(xml)![0];
      const off = switchedOff(store, n, queue.name);
      store.update("msdyn_decisionruleset", ruleset.msdyn_decisionrulesetid, { msdyn_rulesetdefinition: xml.replace(block, block.replace(target.rhs, off)) });
      return;
    }
  }
}

// ---- the environment in plain words ----

export interface Line {
  dial: string;
  workstream: string;
  ivr?: string;                     // the IVR bot's name, if the line has one
  choices: { value: string; rule: string; queues: string[] }[];
  fallback?: string;
}

export interface QueueInfo {
  name: string; members: number; hours?: string; overflow: string[]; routed: boolean;
  // Where a call can end because of this queue's overflow rules (for answer choices, src/scenarios/grade.ts).
  ends: Answer[];
}

export interface Environment { lines: Line[]; queues: QueueInfo[] }

// Reads the environment the way the call engine does: through the Toolbox's routing model, so the
// description and the calls agree. Needs the simulator's Xrm in place (as for placeCall).
export async function describeEnvironment(store: Store): Promise<Environment> {
  const model = await loadRoutingModel();
  const queueName = (id?: string) => (id ? model.queues.find((q) => q.id === id)?.name : undefined);
  const lines: Line[] = [];
  for (const channel of store.table("msdyn_ocvoicechannelsetting")) {
    const number = channel._msdyn_phonenumberid_value && store.find("msdyn_ocphonenumber", channel._msdyn_phonenumberid_value);
    const ws = channel._msdyn_liveworkstreamid_value && store.find("msdyn_liveworkstream", channel._msdyn_liveworkstreamid_value);
    const routed: Workstream | undefined = ws ? model.workstreams.find((w) => cleanId(w.id) === ws.msdyn_liveworkstreamid) : undefined;
    if (!number || !ws || !routed) continue;
    const bot = ws._msdyn_bot_user_value && store.find("systemuser", ws._msdyn_bot_user_value);
    lines.push({
      dial: number.msdyn_phonenumber,
      workstream: ws.msdyn_name,
      ...(bot ? { ivr: bot.fullname } : {}),
      choices: routed.queueRoutingRules.flatMap((r) => {
        const c = r.conditions.find((x) => /SelectedMenuItem/.test(x.variableId) && x.operator === "equals");
        return c ? [{ value: String(c.value), rule: r.name, queues: r.targets.map((t) => queueName(t.queueId) ?? "a queue that isn't active") }] : [];
      }),
      fallback: queueName(routed.fallbackQueueId)
    });
  }
  const routedTo = new Set(model.workstreams.flatMap((w) => [w.fallbackQueueId, ...w.queueRoutingRules.flatMap((r) => r.targets.map((t) => t.queueId))]));
  const hoursOf = new Map(store.table("msdyn_operatinghour").map((h) => [h.msdyn_operatinghourid, HOURS.find((x) => x.name === h.msdyn_name)]));
  const queues: QueueInfo[] = model.queues.map((q) => {
    const row = store.find("queue", cleanId(q.id));
    const hours = row?._msdyn_operatinghourid_value ? hoursOf.get(row._msdyn_operatinghourid_value) : undefined;
    const overflow = [...q.preQueueOverflowRules, ...q.inQueueOverflowRules].map((r) => {
      const trigger = overflowTrigger(r);
      return `${trigger}: ${r.outcome === "Queue Transfer" ? `transfer to ${queueName(r.targetQueueId)}` : r.outcome ?? "no action"}`;
    });
    const ends: Answer[] = [...q.preQueueOverflowRules, ...q.inQueueOverflowRules].flatMap((r): Answer[] =>
      r.outcome === "Queue Transfer" ? (queueName(r.targetQueueId) ? [{ queue: queueName(r.targetQueueId), outcome: "Agent" }] : []) : r.outcome ? [{ queue: q.name, outcome: r.outcome }] : []);
    return { name: q.name, members: store.table("queuemembership").filter((m) => m.queueid === cleanId(q.id)).length, ...(hours ? { hours: describeHours(hours) } : {}), overflow, routed: routedTo.has(q.id), ends };
  });
  return { lines, queues };
}

// The same, as text for the AI.
export function environmentText(env: Environment): string {
  const lines = env.lines.map((l) => [
    `- ${l.dial} rings the workstream “${l.workstream}”.${l.ivr ? ` An IVR (${l.ivr}) asks the caller to choose; the choice is stored in SelectedMenuItem.` : " No IVR: nobody asks the caller anything."}`,
    ...l.choices.map((c) => `  - Choice value “${c.value}”: rule “${c.rule}” routes to ${c.queues.length > 1 ? `${c.queues.join(" or ")}, picked at random (don't use this choice in a call to predict)` : c.queues[0]}.`),
    `  - Anything else goes to the fallback queue${l.fallback ? ` “${l.fallback}”` : ": none is set"}.`
  ].join("\n"));
  const queues = env.queues.map((q) => `- “${q.name}”: ${q.members} member${q.members === 1 ? "" : "s"}${q.routed ? "" : ", nothing routes here"}${q.hours ? `, open ${q.hours}` : ", no operating hours (always open)"}${q.overflow.length ? `. Overflow: ${q.overflow.join("; ")}` : ""}.`);
  return `Phone lines:\n${lines.join("\n")}\n\nQueues:\n${queues.join("\n")}`;
}
