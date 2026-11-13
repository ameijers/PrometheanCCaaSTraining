// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The admin pages phase 7 adds, as actions: a queue's operation hours and overflow handling, capacity
// profiles, and a new voice workstream. Each is checked by what it does to a call.
import {
  addProfileUsers, createCapacityProfile, createVoiceWorkstream, findNumber, purchaseNumber, readOverflow, saveOverflow, setOperationHours, setupWorkstream, setWorkItemLimit
} from "../../src/admin/actions";
import { representatives } from "../../src/calls/assignment";
import { placeCall } from "../../src/calls/engine";
import { createSimulator } from "../../src/simulator";
import { installGlobalXrm } from "../simulator/helpers";

const sim = createSimulator();
const admin = { api: sim.api, store: sim.store };
beforeAll(() => installGlobalXrm(sim.xrm));
const queue = (name: string) => sim.store.table("queue").find((q) => q.name === name && q.statecode === 0)!.queueid;
const ws = (name: string) => sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === name)!.msdyn_liveworkstreamid;
const returnsCall = (extra: object = {}) => placeCall(sim.store, { dial: "+44 20 7946 0102", answers: { SelectedMenuItem: "Returns" }, ...extra }, { record: false });
const night = { at: { day: 2, time: "23:00" } };

describe("operation hours and overflow handling on a queue", () => {
  test("setting operation hours adds Out of operation hours with Assign to queue anyway, so the call still waits", async () => {
    const hours = sim.store.table("msdyn_operatinghour").find((h) => h.msdyn_name === "Business hours")!.msdyn_operatinghourid;
    setOperationHours(admin, queue("Returns"), hours);
    expect(readOverflow(sim.store, queue("Returns")).before).toEqual([{ condition: "outOfHours", action: "Assign to queue anyway" }]);
    expect((await returnsCall(night)).outcome).toBe("Agent");
  });

  test("Voicemail out of hours, a callback on a long predicted wait, a transfer after a long wait in the queue", async () => {
    saveOverflow(admin, queue("Returns"), [{ condition: "outOfHours", action: "Voicemail" }, { condition: "estimatedWait", value: 10, action: "Direct callback" }],
      [{ condition: "waitTime", value: 300, action: "Transfer to a different queue", targetQueueId: queue("Escalations") }]);
    expect((await returnsCall(night)).outcome).toBe("Voicemail");
    expect((await returnsCall({ at: { day: 2, time: "11:00" }, queue: { estimatedWaitMinutes: 15 } })).outcome).toBe("Callback");
    expect(await returnsCall({ at: { day: 2, time: "11:00" }, queue: { waitedSeconds: 400 } })).toMatchObject({ outcome: "Agent", queue: { name: "Escalations" } });
    expect(readOverflow(sim.store, queue("Returns"))).toEqual({
      before: [{ condition: "outOfHours", action: "Voicemail" }, { condition: "estimatedWait", value: 10, action: "Direct callback" }],
      queued: [{ condition: "waitTime", value: 300, action: "Transfer to a different queue", targetQueueId: queue("Escalations") }]
    });
  });

  test("out of operation hours needs operation hours", () => {
    expect(() => saveOverflow(admin, queue("Order Desk"), [{ condition: "outOfHours", action: "Voicemail" }], [])).toThrow(/Set operation hours first/);
  });
});

describe("capacity profiles", () => {
  const voiceProfile = () => sim.store.table("msdyn_capacityprofile").find((p) => p.msdyn_uniquename === "msdyn_voice_inbound_profile")!.msdyn_capacityprofileid;

  test("a higher work item limit gives every representative with the profile more room", () => {
    const free = () => representatives(sim.store, queue("Billing"), ws("Customer Service – Voice")).filter((r) => !r.notNow).map((r) => r.free);
    expect(new Set(free())).toEqual(new Set([1]));
    setWorkItemLimit(admin, voiceProfile(), 2);
    expect(new Set(free())).toEqual(new Set([2]));
  });

  test("a new profile, with users who are bookable resources", () => {
    const id = createCapacityProfile(admin, "Callbacks", 3);
    const users = sim.store.table("bookableresource").slice(0, 2).map((r) => r._userid_value);
    addProfileUsers(admin, id, users);
    expect(sim.store.table("msdyn_bookableresourcecapacityprofile").filter((l) => l._msdyn_capacityprofileid_value === id)).toHaveLength(2);
    expect(() => createCapacityProfile(admin, "callbacks", 1)).toThrow(/already exists/);
    expect(() => addProfileUsers(admin, id, ["0000c0de-0000-4000-8000-000000000001"])).toThrow(/isn't a bookable resource/);
  });
});

test("a new voice workstream with a new number takes calls into its fallback queue, where a representative gets them", async () => {
  const id = createVoiceWorkstream(admin, "Spare Parts – Voice", queue("Order Desk"));
  const dial = findNumber(sim.store, "United States", "312 (Illinois)")!;
  setupWorkstream(admin, purchaseNumber(admin, dial, { receive: true, make: false }), id);
  const call = await placeCall(sim.store, { dial, answers: {} }, { record: false });
  expect(call).toMatchObject({ outcome: "Agent", queue: { name: "Order Desk" } });
  expect(representatives(sim.store, queue("Order Desk"), id).some((r) => !r.notNow)).toBe(true);
  expect(() => createVoiceWorkstream(admin, "spare parts – voice", queue("Order Desk"))).toThrow(/already exists/);
});
