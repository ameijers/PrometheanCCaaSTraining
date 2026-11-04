// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Level 5 onboarding: a business unit and an owner team with members, as the Power Platform admin
// center pages do it, checked by the scenario goals.
import { addTeamMembers, createBusinessUnit, createOwnerTeam } from "../../src/admin/actions";
import { checkGoals } from "../../src/scenarios/goals";
import { createSimulator } from "../../src/simulator";
import { LEARNER } from "../../src/simulator/learner";

const sim = createSimulator();
const admin = { api: sim.api, store: sim.store };
const unit = (name: string) => sim.store.table("businessunit").find((u) => u.name === name)!;
const goals = [
  { type: "business-unit" as const, unit: "Contoso Parts", parent: "Contoso" },
  { type: "team" as const, team: "Parts Support", unit: "Contoso Parts", members: 2 }
];
const passed = async () => (await checkGoals(sim.store, goals)).flat().every((c) => c.result.passed);

describe("business units and teams", () => {
  test("a new business unit gets its parent and its own default team", async () => {
    expect(await passed()).toBe(false);
    const id = createBusinessUnit(admin, "Contoso Parts", unit("Contoso").businessunitid);
    expect(unit("Contoso Parts")._parentbusinessunitid_value).toBe(unit("Contoso").businessunitid);
    expect(sim.store.table("team").some((t) => t.isdefault && t._businessunitid_value === id)).toBe(true);
  });

  test("an owner team with members meets the goals", async () => {
    const team = createOwnerTeam(admin, { name: "Parts Support", unitId: unit("Contoso Parts").businessunitid, adminId: LEARNER.userId });
    expect(sim.store.find("team", team)!.teamtype).toBe(0);
    expect(await passed()).toBe(false);
    const people = sim.store.table("msdyn_agentstatus").map((a) => a._msdyn_agentid_value).slice(0, 2);
    addTeamMembers(admin, team, people);
    expect(await passed()).toBe(true);
  });

  test("a default team's members can't be changed", () => {
    const team = sim.store.table("team").find((t) => t.isdefault)!;
    expect(() => addTeamMembers(admin, team.teamid, [LEARNER.userId])).toThrow();
  });
});
