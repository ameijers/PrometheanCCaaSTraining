// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The number pool (manual 5.1): a new number comes from a range reserved for fiction, is written as a
// phone number record, and rings the workstream it's set up on.
import { channelOfNumber, findNumber, purchaseNumber, setupWorkstream } from "../../src/admin/actions";
import { placeCall } from "../../src/calls/engine";
import { createSimulator } from "../../src/simulator";
import { installGlobalXrm } from "../simulator/helpers";

describe("the number pool", () => {
  const sim = createSimulator();
  const admin = { api: sim.api, store: sim.store };
  beforeAll(() => installGlobalXrm(sim.xrm));
  const ws = () => sim.store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Dutch Desk – Voice")!.msdyn_liveworkstreamid;

  test("numbers come from the fiction ranges, the next free one each time", () => {
    expect(findNumber(sim.store, "United States", "425 (Washington)")).toBe("+1 425 555 0100");
    expect(findNumber(sim.store, "United Kingdom", "020 (London)")).toBe("+44 20 7946 0000");
    purchaseNumber(admin, "+1 425 555 0100", { receive: true, make: false });
    expect(findNumber(sim.store, "United States", "425 (Washington)")).toBe("+1 425 555 0101");
  });

  test("a new number is ready for setup, then rings the workstream it's set up on", async () => {
    const dial = findNumber(sim.store, "United States", "206 (Washington)")!;
    const id = purchaseNumber(admin, dial, { receive: true, make: true });
    expect(channelOfNumber(sim.store, id)).toBeUndefined();
    expect((await placeCall(sim.store, { dial, answers: {} }, { record: false })).steps.at(-1)!.detail).toMatch(/isn't on any voice channel/);
    setupWorkstream(admin, id, ws());
    const call = await placeCall(sim.store, { dial, answers: {} }, { record: false });
    expect(call.steps.find((s) => s.what === "Workstream")!.detail).toMatch(/Dutch Desk – Voice/);
    expect(call.queue?.name).toBe("Overflow");
  });

  test("a number goes on one workstream only, and must be able to receive calls", () => {
    const taken = sim.store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_phonenumberid_value)!._msdyn_phonenumberid_value;
    expect(() => setupWorkstream(admin, taken, ws())).toThrow(/only one voice workstream/);
    const outboundOnly = purchaseNumber(admin, findNumber(sim.store, "United Kingdom", "020 (London)")!, { receive: false, make: true });
    expect(() => setupWorkstream(admin, outboundOnly, ws())).toThrow(/can't receive calls/);
    expect(() => purchaseNumber(admin, "+44 20 7946 0100", { receive: true, make: false })).toThrow(/already/);
  });
});
