// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The workspace beyond taking a call: who is calling (customer identification), what is said (simulated
// transcript, sentiment, Copilot summary), and the supervisor's side (real-time analytics and the actions
// on ongoing conversations), as Microsoft Learn describes them.
import { PRESENCES } from "@toolbox/voice-workstream-builder/src/voiceSchema";
import { STATUS } from "../../src/calls/assignment";
import { saveSummary, sentiment, summaryOf, transcript } from "../../src/calls/conversation";
import { customerName, earlierCalls, identifyCaller } from "../../src/calls/customers";
import { placeCall } from "../../src/calls/engine";
import { Routing } from "../../src/calls/routing";
import { agentRows, canAssign, canMonitor, canTransfer, forceClose, kpis, supervisorAssign, transfer } from "../../src/calls/supervisor";
import { createSimulator } from "../../src/simulator";
import { SHARED_MOBILE, UNKNOWN_NUMBER } from "../../src/simulator/seeds/customers";
import { presenceId } from "../../src/simulator/seeds/presence";
import { installGlobalXrm } from "../simulator/helpers";

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 3, 10, minute, second));

function setup() {
  const sim = createSimulator();
  installGlobalXrm(sim.xrm);
  const store = sim.store;
  const queue = store.table("queue").find((q) => q.name === "Returns")!;
  const ws = store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice")!;
  const members = store.table("queuemembership").filter((m) => m.queueid === queue.queueid).map((m) => m.systemuserid);
  const presence = (user: string, base: number) => {
    const s = store.table("msdyn_agentstatus").find((x) => x._msdyn_agentid_value === user)!;
    store.update("msdyn_agentstatus", s.msdyn_agentstatusid, { _msdyn_currentpresenceid_value: presenceId(base), msdyn_isagentloggedin: true });
  };
  members.forEach((m) => presence(m, PRESENCES.Available));
  const channel = store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid)!;
  const dial = store.find("msdyn_ocphonenumber", channel._msdyn_phonenumberid_value)!.msdyn_phonenumber;
  const routing = new Routing(store);
  const call = async (from: string | undefined, now: Date) => {
    const r = await placeCall(store, { dial, from, answers: { SelectedMenuItem: "Returns" } }, { record: true, now, routing });
    return { result: r, id: r.workItemId!, item: () => store.find("msdyn_ocliveworkitem", r.workItemId!)! };
  };
  return { store, queue, members, routing, call, presence };
}

describe("customer identification", () => {
  test("a contact's mobile phone or an account's phone links the customer; a shared or unknown number links nobody", () => {
    const { store } = setup();
    expect(identifyCaller(store, "+447700900123")).toMatchObject({ status: "identified", customer: { kind: "contact", name: "Sophie Turner" }, field: "Mobile Phone" });
    expect(identifyCaller(store, "+44 113 496 0388")).toMatchObject({ status: "identified", customer: { kind: "account", name: "Northwind Builders" } });
    expect(identifyCaller(store, SHARED_MOBILE)).toEqual({ status: "several", count: 2 });
    expect(identifyCaller(store, UNKNOWN_NUMBER)).toEqual({ status: "unknown" });
    expect(identifyCaller(store, undefined)).toEqual({ status: "no number" });
  });

  test("a call from a known number shows the customer in the trace and keeps their earlier calls", async () => {
    const { call, store } = setup();
    const first = await call("+44 7700 900123", at(0));
    expect(first.result.steps.find((s) => s.what === "Customer")?.detail).toMatch(/Mobile Phone of contact Sophie Turner/);
    expect(customerName(store, first.item())).toBe("Sophie Turner");
    const second = await call("+44 7700 900123", at(5));
    expect(earlierCalls(store, second.item()).map((w) => w.activityid)).toEqual([first.id]);
    const anonymous = await call(UNKNOWN_NUMBER, at(6));
    expect(customerName(store, anonymous.item())).toBe(UNKNOWN_NUMBER);
    expect(anonymous.result.steps.find((s) => s.what === "Customer")?.detail).toMatch(/doesn't match any contact or account/);
  });
});

describe("the call itself", () => {
  test("the transcript grows with the clock, sentiment follows the wait, and the summary says what happened", async () => {
    const { call, store, routing, members } = setup();
    routing.signInAs(members[0]);
    const c = await call("+44 7700 900123", at(0));
    routing.accept(c.id, at(0, 10));
    expect(transcript(store, c.item(), at(0, 10).getTime()).map((l) => l.who)).toEqual(["Representative"]);
    expect(transcript(store, c.item(), at(0, 30).getTime()).map((l) => l.text)[1]).toBe("Hi, this is Sophie. I'm calling about returns.");
    expect(sentiment(store, c.item(), at(0, 30).getTime())).toBe("Neutral");
    expect(sentiment(store, c.item(), at(2).getTime())).toBe("Positive");
    const text = saveSummary(store, c.item(), at(2).getTime());
    expect(text).toMatch(/Customer: Sophie Turner/);
    expect(text).toMatch(/Issue: the caller chose Returns in the IVR/);
    expect(summaryOf(store, c.id)).toBe(text);
  });

  test("a caller who waited more than two minutes is Negative", async () => {
    const { call, store, routing, members, presence } = setup();
    members.forEach((m) => presence(m, PRESENCES.Away));
    const c = await call(undefined, at(0));
    expect(c.item().statuscode).toBe(STATUS.open);
    presence(members[0], PRESENCES.Available);
    routing.cycle(at(3));
    expect(sentiment(store, c.item(), at(3).getTime())).toBe("Negative");
  });
});

describe("supervisor", () => {
  test("real-time KPIs count the calls and time how fast they're answered", async () => {
    const { call, store, routing, members, presence } = setup();
    await call(undefined, at(0)); // answered straight away by a simulated representative
    members.forEach((m) => presence(m, PRESENCES.Away));
    await call(undefined, at(1)); // waits
    const k = kpis(store, routing.offers, at(2).getTime());
    expect(k).toMatchObject({ offered: 2, active: 1, open: 1, serviceLevel20: 100, averageSpeedToAnswerMs: 0, longestWaitMs: 60_000 });
    const agents = agentRows(store);
    expect(agents.filter((a) => a.tab === "Interacting agents")).toHaveLength(1);
  });

  test("assign, transfer and force close follow Learn's states", async () => {
    const { call, store, routing, members, presence, queue } = setup();
    members.forEach((m) => presence(m, PRESENCES.Away));
    const waiting = await call(undefined, at(0));
    expect(canAssign(waiting.item())).toBeUndefined();
    expect(canTransfer(waiting.item())).toMatch(/Active/);
    // Assign overrides presence: Away doesn't matter.
    supervisorAssign(store, routing, waiting.id, { kind: "agent", id: members[1] }, at(1).getTime());
    expect(waiting.item()).toMatchObject({ statuscode: STATUS.active, _msdyn_activeagentid_value: members[1] });
    expect(canMonitor(waiting.item(), members[1])).toMatch(/assigned to you/);
    expect(canMonitor(waiting.item(), members[0])).toBeUndefined();

    // Transfer to the learner: offered, with a Copilot summary made first.
    routing.signInAs(members[0]);
    transfer(store, routing, waiting.id, { kind: "agent", id: members[0] }, at(2).getTime());
    expect(routing.offers.has(waiting.id)).toBe(true);
    expect(summaryOf(store, waiting.id)).toMatch(/Customer: Unknown caller/);
    expect(store.table("training_assignment").filter((a) => a.workitemid === waiting.id && !a.releasedon)).toHaveLength(0);
    routing.accept(waiting.id, at(3));
    expect(waiting.item()._msdyn_activeagentid_value).toBe(members[0]);

    // Transferred to a queue where everyone is away, the call waits with nobody on it: nothing breaks.
    transfer(store, routing, waiting.id, { kind: "queue", id: queue.queueid }, at(3, 30).getTime());
    expect(waiting.item()).toMatchObject({ statuscode: STATUS.open, _msdyn_activeagentid_value: null });
    expect(transcript(store, waiting.item(), at(4).getTime())).toEqual([]);
    expect(() => sentiment(store, waiting.item(), at(4).getTime())).not.toThrow();
    expect(() => saveSummary(store, waiting.item(), at(4).getTime())).not.toThrow();

    forceClose(store, routing, waiting.id, at(4).getTime());
    expect(waiting.item()).toMatchObject({ statecode: 1, statuscode: STATUS.closed });
  });
});
