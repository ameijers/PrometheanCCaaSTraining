// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// Assignment to a representative (manual 5.2 step 7), as Microsoft Learn describes the out-of-the-box
// methods, and the routing runtime that moves calls on as the clock runs. The Toolbox's Live view reads
// the result.
import { loadRaw } from "@toolbox/environment-3d-explorer/src/dataverse";
import { buildGraph } from "@toolbox/environment-3d-explorer/src/graph";
import { buildLive } from "@toolbox/environment-3d-explorer/src/live";
import { ASSIGNMENT_METHODS } from "@toolbox/queue-builder/src/queueSchema";
import { PRESENCES } from "@toolbox/voice-workstream-builder/src/voiceSchema";
import { assign, assignmentFor, closeCall, representatives } from "../../src/calls/assignment";
import { placeCall } from "../../src/calls/engine";
import { callMinutes, Routing } from "../../src/calls/routing";
import { createSimulator } from "../../src/simulator";
import { presenceId } from "../../src/simulator/seeds/presence";
import { Store } from "../../src/simulator/store";
import { installGlobalXrm } from "../simulator/helpers";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 10, minute));

function setup() {
  const sim = createSimulator();
  installGlobalXrm(sim.xrm);
  const store = sim.store;
  const queue = store.table("queue").find((q) => q.name === "Returns")!;
  const ws = store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === "Customer Service – Voice")!;
  const members = store.table("queuemembership").filter((m) => m.queueid === queue.queueid).map((m) => m.systemuserid);
  // Everyone in the queue signed in and available, unless a test says otherwise.
  const presence = (user: string, base: number, loggedIn = true) => {
    const s = store.table("msdyn_agentstatus").find((x) => x._msdyn_agentid_value === user)!;
    store.update("msdyn_agentstatus", s.msdyn_agentstatusid, { _msdyn_currentpresenceid_value: presenceId(base), msdyn_isagentloggedin: loggedIn });
  };
  members.forEach((m) => presence(m, PRESENCES.Available));
  const call = (n: number) => {
    const id = `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
    store.insert("msdyn_ocliveworkitem", { activityid: id, msdyn_ocliveworkitemid: id, statecode: 0, statuscode: 1, createdon: at(n).toISOString(), modifiedon: at(n).toISOString(), _msdyn_cdsqueueid_value: queue.queueid, _msdyn_liveworkstreamid_value: ws.msdyn_liveworkstreamid });
    return id;
  };
  const pick = (exclude?: Set<string>) => assignmentFor(store, queue.queueid, ws.msdyn_liveworkstreamid, exclude);
  const setMethod = (m: keyof typeof ASSIGNMENT_METHODS) => store.update("queue", queue.queueid, { msdyn_assignmentstrategy: ASSIGNMENT_METHODS[m] });
  return { sim, store, queue, ws, members, presence, call, pick, setMethod };
}

const nameOf = (store: Store, id: string) => store.find("systemuser", id)!.fullname;

describe("who can take a call", () => {
  test("every queue calls are routed to has someone ready in the training data", () => {
    const { store } = setup();
    for (const ws of store.table("msdyn_liveworkstream").filter((w) => w.msdyn_enablevoicev2)) {
      const queues = new Set(store.table("queue").filter((q) => q.msdyn_queuetype === 192350002 && store.table("queuemembership").some((m) => m.queueid === q.queueid)).map((q) => q.queueid));
      for (const q of queues) expect([ws.msdyn_name, store.find("queue", q)!.name, representatives(store, q, ws.msdyn_liveworkstreamid).some((r) => !r.notNow)]).toEqual([ws.msdyn_name, store.find("queue", q)!.name, true]);
    }
  });

  test("signed out, a presence the workstream doesn't allow, and no capacity left each rule someone out", () => {
    const { store, members, presence, pick, call } = setup();
    presence(members[0], PRESENCES.Available, false);
    presence(members[1], PRESENCES.Away);
    assign(store, call(1), members[2], at(1).toISOString());
    const reasons = Object.fromEntries(pick().representatives.map((r) => [r.id, r.notNow]));
    expect(reasons[members[0]]).toBe("is signed out");
    expect(reasons[members[1]]).toMatch(/is Away, which this workstream doesn't assign work to/);
    expect(reasons[members[2]]).toBe("has no capacity left"); // the voice profile's work item limit is 1
    expect(reasons[members[3]]).toBeUndefined();
  });
});

describe("the assignment methods", () => {
  test("least active (the default for a voice queue): fewest calls, then the longest since a call ended", () => {
    const { store, members, pick, call } = setup();
    expect(pick().method).toBe("Least active");
    // Everyone had one call; members[3]'s ended first, so they've been least active since.
    members.forEach((m, i) => { const id = call(i); assign(store, id, m, at(i).toISOString()); closeCall(store, id, at(30 - i).toISOString()); });
    const chosen = pick().chosen!;
    expect(chosen.id).toBe(members[members.length - 1]);
    expect(pick().why).toMatch(/gone longest since their last call ended/);
  });

  test("advanced round robin: the order people joined the queue, then whoever was assigned longest ago", () => {
    const { store, members, pick, call, setMethod } = setup();
    setMethod("Advanced round robin");
    expect(pick().chosen!.id).toBe(members[0]);
    const id = call(1);
    assign(store, id, members[0], at(1).toISOString());
    closeCall(store, id, at(2).toISOString());
    expect(pick().chosen!.id).toBe(members[1]);
  });

  test("highest capacity: the most free capacity, round robin on a tie", () => {
    const { store, members, pick, setMethod } = setup();
    setMethod("Highest capacity");
    const resource = store.table("bookableresource").find((r) => r._userid_value === members[2])!;
    const link = store.table("msdyn_bookableresourcecapacityprofile").find((l) => l._msdyn_bookableresourceid_value === resource.bookableresourceid)!;
    store.update("msdyn_bookableresourcecapacityprofile", link.msdyn_bookableresourcecapacityprofileid, { msdyn_maxunits: 3 });
    expect(pick()).toMatchObject({ chosen: { id: members[2], free: 3 }, why: expect.stringMatching(/most free capacity/) });
  });

  test("nobody ready: the call waits", () => {
    const { members, presence, pick } = setup();
    members.forEach((m) => presence(m, PRESENCES.Offline, false));
    expect(pick().chosen).toBeUndefined();
    expect(pick().why).toMatch(/waits and routing keeps trying/);
  });
});

describe("the routing runtime", () => {
  test("a call is taken, ended, wrapped up and closed as the clock runs, and capacity comes back", () => {
    const { store, call } = setup();
    const routing = new Routing(store);
    const id = call(0);
    routing.cycle(at(0));
    const agent = store.find("msdyn_ocliveworkitem", id)!._msdyn_activeagentid_value;
    expect(agent).toBeTruthy();
    routing.cycle(at(2));
    expect(store.find("msdyn_ocliveworkitem", id)!.statuscode).toBe(2); // still talking: a call lasts 3 to 8 minutes
    routing.cycle(at(callMinutes(id)));
    expect(store.find("msdyn_ocliveworkitem", id)!.statuscode).toBe(5); // wrap-up
    routing.cycle(at(15));
    expect(store.find("msdyn_ocliveworkitem", id)).toMatchObject({ statecode: 1, statuscode: 4 });
    expect(store.table("training_assignment").find((a) => a.workitemid === id)!.releasedon).toBeTruthy();
  });

  test("when everyone is busy the call waits, and is taken when someone is free", () => {
    const { store, members, call } = setup();
    const routing = new Routing(store);
    members.forEach((_, i) => call(i));
    const waiting = call(members.length);
    routing.cycle(at(members.length));
    expect(store.find("msdyn_ocliveworkitem", waiting)!._msdyn_activeagentid_value).toBeUndefined();
    routing.cycle(at(30));
    expect(store.find("msdyn_ocliveworkitem", waiting)!._msdyn_activeagentid_value).toBeTruthy();
  });

  test("the learner, signed in as a representative, gets an offer to accept or reject", () => {
    const { store, members, presence, call } = setup();
    const routing = new Routing(store);
    members.slice(1).forEach((m) => presence(m, PRESENCES.Away));
    routing.signInAs(members[0]);
    const id = call(0);
    routing.cycle(at(0));
    expect([...routing.offers]).toEqual([id]);
    expect(routing.step(id).detail).toMatch(/offered to you/);
    // Rejected: back in the queue, and someone else takes it when they're back.
    routing.reject(id, at(1));
    presence(members[1], PRESENCES.Available);
    routing.cycle(at(2));
    expect(nameOf(store, store.find("msdyn_ocliveworkitem", id)!._msdyn_activeagentid_value)).toBe(nameOf(store, members[1]));
    // Accepted: it's the learner's, and the simulated representatives' rules don't end it.
    const second = call(3);
    routing.cycle(at(3));
    routing.accept(second, at(4));
    routing.cycle(at(30));
    expect(store.find("msdyn_ocliveworkitem", second)).toMatchObject({ _msdyn_activeagentid_value: members[0], statuscode: 2 });
  });

  test("a placed call shows its assignment in the trace, and the Live view shows it with an agent", async () => {
    const { sim, store, ws } = setup();
    const routing = new Routing(store);
    const channel = store.table("msdyn_ocvoicechannelsetting").find((c) => c._msdyn_liveworkstreamid_value === ws.msdyn_liveworkstreamid)!;
    const dial = store.find("msdyn_ocphonenumber", channel._msdyn_phonenumberid_value)!.msdyn_phonenumber;
    const r = await placeCall(store, { dial, answers: { SelectedMenuItem: "Returns" } }, { record: true, now: at(0), routing });
    expect(r.steps.at(-1)).toMatchObject({ what: "Assignment", detail: expect.stringMatching(/^Least active\. .* takes the call\.$/) });

    const graph = buildGraph(await loadRaw());
    const live = buildLive(graph, { agentStatuses: store.table("msdyn_agentstatus").map((s) => ({ ...s, msdyn_currentpresenceid: store.find("msdyn_presence", s._msdyn_currentpresenceid_value) })), conversations: store.table("msdyn_ocliveworkitem"), since: at(0).toISOString() }, at(1).toISOString());
    expect(live.open.map((c) => c.status)).toEqual(["with-agent"]);
    expect([...live.presence.values()].some((p) => p.presence === "available")).toBe(true);
    void sim;
  });
});
