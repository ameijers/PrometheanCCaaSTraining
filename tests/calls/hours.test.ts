// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Operating hours and overflow on calls (manual 5.2 steps 3 and 6): the queue's calendar decides
// whether out-of-hours overflow fires, and the queue's state feeds the wait-time rules.
import { CallRequest, placeCall } from "../../src/calls/engine";
import { createSimulator } from "../../src/simulator";
import { installGlobalXrm } from "../simulator/helpers";

describe("calls with operating hours and overflow", () => {
  const sim = createSimulator();
  beforeAll(() => installGlobalXrm(sim.xrm));
  const dialOf = (workstream: string) => {
    const ws = sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === workstream)!;
    const channel = sim.store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid)!;
    return sim.store.find("msdyn_ocphonenumber", channel._msdyn_phonenumberid_value)!.msdyn_phonenumber as string;
  };
  const call = (workstream: string, choice: string, extra: Partial<CallRequest> = {}) =>
    placeCall(sim.store, { dial: dialOf(workstream), answers: { SelectedMenuItem: choice }, ...extra }, { record: false });

  test("in opening hours, a sales call waits for a representative", async () => {
    const r = await call("Retail Sales – Voice", "Sales", { at: { day: 2, time: "10:00" } });
    expect(r).toMatchObject({ outcome: "Agent", queue: { name: "Sales" } });
    expect(r.steps.find((s) => s.what === "Queue")!.detail).toMatch(/within its operating hours/);
  });

  test("after hours, it goes to voicemail", async () => {
    const r = await call("Retail Sales – Voice", "Sales", { at: { day: 2, time: "22:00" } });
    expect(r).toMatchObject({ outcome: "Voicemail", queue: { name: "Sales" } });
    expect(r.steps.find((s) => s.what === "Overflow")!.detail).toMatch(/fires: out of operating hours.$/);
    expect(r.workItemId).toBeUndefined();
  });

  test("on Saturday the billing queue is closed", async () => {
    expect((await call("Customer Service – Voice", "Billing", { at: { day: 6, time: "11:00" } })).outcome).toBe("Voicemail");
    expect((await call("Customer Service – Voice", "Billing", { at: { day: 5, time: "16:59" } })).outcome).toBe("Agent");
    expect((await call("Customer Service – Voice", "Billing", { at: { day: 5, time: "17:00" } })).outcome).toBe("Voicemail");
  });

  test("a long predicted wait offers a callback", async () => {
    const r = await call("Retail Sales – Voice", "Sales", { at: { day: 1, time: "12:00" }, queue: { estimatedWaitMinutes: 20 } });
    expect(r.outcome).toBe("Callback");
    expect((await call("Retail Sales – Voice", "Sales", { at: { day: 1, time: "12:00" }, queue: { estimatedWaitMinutes: 5 } })).outcome).toBe("Agent");
  });

  test("a caller who waited too long in Tier 1 is transferred to Tier 2", async () => {
    const r = await call("Technical Support – Voice", "1", { queue: { waitedSeconds: 400 } });
    expect(r).toMatchObject({ outcome: "Agent", queue: { name: "Tier 2 Support" } });
    expect(r.steps.filter((s) => s.what === "Queue").map((s) => s.detail)).toEqual([expect.stringMatching(/Tier 1 Support/), expect.stringMatching(/Tier 2 Support/)]);
  });

  test("without a time, hours aren't checked", async () => {
    expect((await call("Retail Sales – Voice", "Sales")).outcome).toBe("Agent");
  });
});
