// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ruleXml } from "@toolbox/voicemail-builder/src/overflow";
import { Row, Rows } from "../store";

// Operating hours and overflow, the way a real environment has them.
//
// The demo gives "Business hours" and "Weekend desk" to some queues, but no calendar behind them, and its
// overflow rules have no conditions (environment-3d-explorer/src/demoData.ts), so they would always fire.
// Here each operating hours record gets a calendar in the shape the Visual Routing Tester reads (an outer
// weekly rule pointing to an inner calendar with the day's window, visual-routing-tester/src/dataverse.ts
// loadOperatingHoursByOpHourId), and each overflow rule gets the conditions the admin center writes,
// written by Voicemail Builder's ruleXml (voicemail-builder/src/overflow.ts).

const id = (prefix: string, n: number) => `${prefix.padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;

// The time zone of every calendar: UTC (timezonecode 92, seeds/platform.ts). The training's clock is
// the contact center's own local time, so the zone only has to be one the environment has.
const TIME_ZONE = 92;

export interface Hours { name: string; days: string; from: string; to: string }

// What the training's contact center keeps. Shown to learners and to the AI as plain text (describeHours).
export const HOURS: Hours[] = [
  { name: "Business hours", days: "MO,TU,WE,TH,FR", from: "09:00", to: "17:00" },
  { name: "Weekend desk", days: "SA,SU", from: "10:00", to: "16:00" }
];

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const DAY_NAMES: Record<string, string> = { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" };

export function describeHours(h: Hours): string {
  const days = h.days.split(",");
  return `${DAY_NAMES[days[0]]} to ${DAY_NAMES[days[days.length - 1]]}, ${h.from} to ${h.to}`;
}

// Overflow as the training has it. Values are the thresholds the rule checks.
const OVERFLOW: { queue: string; stage: "pre" | "in"; rules: { condition: "outOfHours" | "estimatedWait" | "waitTime"; value?: number; action: string }[] }[] = [
  { queue: "Sales", stage: "pre", rules: [{ condition: "outOfHours", action: "Voicemail" }, { condition: "estimatedWait", value: 15, action: "Callback" }] },
  { queue: "Billing", stage: "pre", rules: [{ condition: "outOfHours", action: "Voicemail" }] },
  { queue: "Tier 1 Support", stage: "in", rules: [{ condition: "waitTime", value: 300, action: "QueueTransfer_Tier2" }] }
];

export function withHours(rows: Rows): Rows {
  let n = 0;
  for (const h of HOURS) {
    const record = (rows.msdyn_operatinghour ?? []).find((o) => o.msdyn_name === h.name);
    if (!record || record.msdyn_calendarid) continue;
    const outer = id("6c", ++n), inner = id("6c", ++n);
    (rows.calendar ??= []).push({ calendarid: outer, name: h.name }, { calendarid: inner, name: `${h.name} (day)` });
    (rows.calendarrule ??= []).push(
      { calendarruleid: id("6d", n * 2 - 1), name: h.name, _calendarid_value: outer, _innercalendarid_value: inner, pattern: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${h.days}`,
        timezonecode: TIME_ZONE, effectiveintervalstart: "2026-01-01T00:00:00Z", effectiveintervalend: "9999-12-30T00:00:00Z", starttime: "2026-01-01T00:00:00Z" },
      { calendarruleid: id("6d", n * 2), name: `${h.name} (day)`, _calendarid_value: inner, offset: minutes(h.from), duration: minutes(h.to) - minutes(h.from), timezonecode: TIME_ZONE }
    );
    record.msdyn_calendarid = outer;
  }

  const actions = rows.msdyn_overflowactionconfig ?? [];
  const queues = rows.queue ?? [];
  const rulesets = rows.msdyn_decisionruleset ?? [];
  let r = 0;
  for (const o of OVERFLOW) {
    const queue = queues.find((q) => q.name === o.queue);
    const column = o.stage === "pre" ? "_msdyn_prequeueoverflowrulesetid_value" : "_msdyn_inqueueoverflowrulesetid_value";
    const ruleset = queue && rulesets.find((s: Row) => s.msdyn_decisionrulesetid === queue[column]);
    if (!ruleset) continue;
    const rules = o.rules.map((rule) => {
      const action = actions.find((a) => a.msdyn_name === rule.action);
      if (!action) throw new Error(`No overflow action named ${rule.action}.`);
      return ruleXml(id("6e", ++r), `Rule${r}`, { condition: rule.condition, value: rule.value }, action.msdyn_overflowactionconfigid);
    });
    // "first": the first rule that fires decides, as the demo's rulesets have it.
    ruleset.msdyn_rulesetdefinition = `<decision hit-policy="first" version="1">\n  <rules>\n${rules.join("\n")}\n  </rules>\n</decision>`;
  }
  return rows;
}
