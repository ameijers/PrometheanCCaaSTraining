// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Skill-based routing (src/calls/skills.ts) and outbound profiles: what they do to a call.
import { addSkillRule, createOutboundProfile, outboundProfiles, setMatchingLogic, setUserSkills } from "../../src/admin/actions";
import { assignmentFor } from "../../src/calls/assignment";
import { placeCall } from "../../src/calls/engine";
import { meetsAll, requiredSkills } from "../../src/calls/skills";
import { createSimulator } from "../../src/simulator";
import { installGlobalXrm } from "../simulator/helpers";

const sim = createSimulator();
const admin = { api: sim.api, store: sim.store };
beforeAll(() => installGlobalXrm(sim.xrm));
const store = sim.store;
const ws = store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice")!.msdyn_liveworkstreamid;
const queue = store.table("queue").find((q) => q.name === "Returns" && q.statecode === 0)!.queueid;
const skill = store.table("characteristic").find((c) => c.name === "Returns")!.characteristicid;
const expert = store.table("ratingvalue").find((v) => v.name === "Expert")!.ratingvalueid;
const DIAL = "+44 20 7946 0102";

async function returnsCall() {
  const result = await placeCall(store, { dial: DIAL, answers: { SelectedMenuItem: "Returns" } }, { record: true });
  expect(result.queue?.id).toBe(queue);
  return result.workItemId!;
}

describe("skill-based routing", () => {
  test("a skill attachment rule adds the skill only to calls that match it", () => {
    addSkillRule(admin, ws, { name: "Returns need Returns", variable: "SelectedMenuItem", value: "Returns", skillId: skill, ratingId: expert });
    expect(requiredSkills(store, ws, { SelectedMenuItem: "Returns" }).map((n) => `${n.skill} ${n.rating}`)).toEqual(["Returns Expert"]);
    expect(requiredSkills(store, ws, { SelectedMenuItem: "Billing" })).toEqual([]);
  });

  test("without a skill matching algorithm the skill isn't used, and the trace says so", async () => {
    const a = assignmentFor(store, queue, ws, undefined, await returnsCall());
    expect(a.why).toMatch(/no Default skill matching algorithm/);
  });

  test("Exact Match gives the call only to someone with the skill at the rating or better", async () => {
    setMatchingLogic(admin, ws, "Exact Match");
    const needs = requiredSkills(store, ws, { SelectedMenuItem: "Returns" });
    const a = assignmentFor(store, queue, ws, undefined, await returnsCall());
    const lacking = a.representatives.filter((r) => !meetsAll(store, r.id, needs));
    expect(lacking.length).toBeGreaterThan(0);
    // Each is left out: for the skill, or already for another reason (presence, capacity, signed out).
    lacking.forEach((r) => expect(r.notNow).toBeTruthy());
    expect(lacking.some((r) => r.notNow === "doesn't have Returns (Expert or better)")).toBe(true);
    if (a.chosen) expect(meetsAll(store, a.chosen.id, needs)).toBe(true);
  });

  test("when nobody has the skill, the call stays unassigned in the queue", async () => {
    // Nobody in the queue is an expert in a skill nobody has.
    const rare = store.table("characteristic").find((c) => c.name === "Writing")!.characteristicid;
    addSkillRule(admin, ws, { name: "Billing needs Writing", variable: "SelectedMenuItem", value: "Billing", skillId: rare, ratingId: expert });
    const holders = store.table("bookableresourcecharacteristic").filter((l) => l._characteristic_value === rare);
    holders.forEach((l) => sim.api.remove("bookableresourcecharacteristic", l.bookableresourcecharacteristicid));
    const result = await placeCall(store, { dial: DIAL, answers: { SelectedMenuItem: "Billing" } }, { record: true });
    const a = assignmentFor(store, result.queue!.id, ws, undefined, result.workItemId);
    expect(a.chosen).toBeUndefined();
    expect(a.why).toMatch(/stays unassigned in the queue/);
  });

  test("giving people the skill makes them eligible", async () => {
    const members = store.table("queuemembership").filter((m) => m.queueid === queue).map((m) => m.systemuserid);
    setUserSkills(admin, skill, members, expert);
    const needs = requiredSkills(store, ws, { SelectedMenuItem: "Returns" });
    expect(members.every((m) => meetsAll(store, m, needs))).toBe(true);
    const a = assignmentFor(store, queue, ws, undefined, await returnsCall());
    expect(a.representatives.some((r) => r.notNow?.startsWith("doesn't have"))).toBe(false);
  });
});

describe("outbound profiles", () => {
  test("a profile on a number that's also an inbound line doesn't take that line's calls", async () => {
    const phone = store.table("msdyn_ocphonenumber").find((n) => n.msdyn_phonenumber === DIAL)!;
    const billing = store.table("queue").find((q) => q.name === "Billing" && q.statecode === 0)!.queueid;
    const id = createOutboundProfile(admin, { name: "Billing Outbound", phoneId: phone.msdyn_ocphonenumberid, queueId: billing });
    expect(outboundProfiles(store).map((p) => p.msdyn_liveworkstreamid)).toContain(id);
    expect(store.find("msdyn_liveworkstream", id)!._msdyn_outboundqueueid_value).toBe(billing);
    const result = await placeCall(store, { dial: DIAL, answers: { SelectedMenuItem: "Returns" } }, { record: false });
    expect(result.workstreamId).toBe(ws);
  });

  test("a number without Make calls can't be a profile's number", () => {
    const phone = store.table("msdyn_ocphonenumber").find((n) => !n.msdyn_phoneoutboundenabled)!;
    const billing = store.table("queue").find((q) => q.name === "Billing" && q.statecode === 0)!.queueid;
    expect(() => createOutboundProfile(admin, { name: "Another", phoneId: phone.msdyn_ocphonenumberid, queueId: billing })).toThrow(/isn't enabled for outbound calling/);
  });
});
