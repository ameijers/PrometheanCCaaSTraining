// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Row, Store } from "../simulator/store";

// Skill-based routing (level 4), simplified.
//
// Sources:
// - Understand how skill match algorithm works in unified routing,
//   https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/set-up-skill-based-routing (ms.date 2026-05-07)
//   "Exact match filters all matched representatives whose skill rating value is greater than or equal to the
//   required value, and then orders them based on the selected out-of-the-box assignment strategy." "If a
//   representative isn't available with all the required skills and corresponding proficiency, then the
//   conversation remains unassigned in the queue." Closest Match "puts all representatives in an order that's
//   based on their closeness to the required skill and proficiency"; "If no representative is available with any
//   of the required skills, then the conversation might be assigned to a representative without any required skills."
// - Configure work classification rulesets,
//   https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/configure-work-classification (ms.date 2026-05-08)
//   "Skill attachment rules ... are written in the format of 'if defined condition satisfies, then attach defined
//   skills to the work item.'" "When one of the rule item conditions matches, the output section of the rule
//   item is run."
// - Work Stream (msdyn_liveworkstream) table reference: msdyn_matchinglogic, Exact Match 192350000, Closest Match 192350001.
//
// Simplified: one skill classification ruleset per workstream, each rule with one condition and one skill; the
// rules are kept in a training table (training_skillrule) because Learn doesn't document how the platform
// stores a skill attachment ruleset. Closest Match orders by how many of the needed skills a representative has
// at the needed rating, not by Learn's full closeness order (exact, then over-, then underqualified).

export const MATCHING = { "Exact Match": 192350000, "Closest Match": 192350001 } as const;
export type Matching = keyof typeof MATCHING;

export function matchingOf(ws: Row | undefined): Matching | undefined {
  return ws?.msdyn_matchinglogic === MATCHING["Exact Match"] ? "Exact Match" : ws?.msdyn_matchinglogic === MATCHING["Closest Match"] ? "Closest Match" : undefined;
}

export interface SkillNeed { skillId: string; skill: string; ratingId: string; rating: string; value: number; rule: string }

export const skillRules = (store: Store, workstreamId: string): Row[] =>
  store.table("training_skillrule").filter((r) => r.workstreamid === workstreamId).sort((a, b) => a.ruleorder - b.ruleorder);

// The skills the first matching rule attaches to a call with these IVR answers.
export function requiredSkills(store: Store, workstreamId: string, answers: Record<string, unknown>): SkillNeed[] {
  const rule = skillRules(store, workstreamId).find((r) => String(answers[r.variable] ?? "") === r.value);
  const skill = rule && store.find("characteristic", rule.skillid);
  const rating = rule && store.find("ratingvalue", rule.ratingvalueid);
  if (!rule || !skill || !rating) return [];
  return [{ skillId: skill.characteristicid, skill: String(skill.name), ratingId: rating.ratingvalueid, rating: String(rating.name), value: Number(rating.value), rule: String(rule.name) }];
}

// The IVR answers a waiting call carries (its context items).
export function answersOf(store: Store, workItemId: string): Record<string, string> {
  return Object.fromEntries(store.table("msdyn_ocliveworkitemcontextitem").filter((c) => c._msdyn_ocliveworkitemid_value === workItemId).map((c) => [c.msdyn_name, c.msdyn_value]));
}

// A representative's rating for a skill: 0 when they don't have it.
export function ratingOf(store: Store, userId: string, skillId: string): number {
  const resource = store.table("bookableresource").find((r) => r._userid_value === userId);
  const link = resource && store.table("bookableresourcecharacteristic").find((l) => l._resource_value === resource.bookableresourceid && l._characteristic_value === skillId);
  if (!link) return 0;
  return Number(store.find("ratingvalue", link._ratingvalue_value)?.value ?? 0);
}

export const meetsAll = (store: Store, userId: string, needs: SkillNeed[]) => needs.every((n) => ratingOf(store, userId, n.skillId) >= n.value);
export const skillScore = (store: Store, userId: string, needs: SkillNeed[]) => needs.filter((n) => ratingOf(store, userId, n.skillId) >= n.value).length;
export const needsText = (needs: SkillNeed[]) => needs.map((n) => `${n.skill} (${n.rating} or better)`).join(" and ");
