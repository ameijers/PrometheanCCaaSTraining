// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Every ready lab's hands-on part, done task by task the way a learner does it (the admin center's
// actions, the phone, the workspace's events), in a fresh environment. Before a question is answered,
// the answer the lab expects is worked out from the environment itself, so a lab can't ask for a wrong
// "right answer".
import { addUsers, createQueue, findNumber, purchaseNumber, setupWorkstream } from "../../src/admin/actions";
import { createClassificationRuleset, emptyConditions, PRIORITY_SCORE, saveClassificationRule } from "../../src/admin/rules";
import { methodOf } from "../../src/calls/assignment";
import { customerOfCall } from "../../src/calls/customers";
import { lineOf, placeCall } from "../../src/calls/engine";
import { Routing } from "../../src/calls/routing";
import { LABS, labLesson, labValues } from "../../src/labs/labs";
import { Lesson, record, runChecks, Task } from "../../src/lessons/checks";
import { solve } from "../../src/scenarios/goals";
import { createSimulator } from "../../src/simulator";
import { Store } from "../../src/simulator/store";
import { installGlobalXrm } from "../simulator/helpers";

const NOW = new Date(Date.UTC(2026, 10, 3, 10, 0));
const SOPHIE = "+44 7700 900123";

type Ctx = { store: Store; admin: { api: any; store: Store }; routing: Routing; v: Record<string, string>; lesson: Lesson; lastCall?: string };

const wsNamed = (store: Store, name: string) => store.table("msdyn_liveworkstream").find((w) => w.msdyn_name === name)!;
const queueOf = (store: Store, id?: string) => (id ? String(store.find("queue", store.find("msdyn_ocliveworkitem", id)!._msdyn_cdsqueueid_value)?.name) : undefined);
const numberOf = (store: Store, wsName: string) => {
  const c = store.table("msdyn_ocvoicechannelsetting").find((x) => x._msdyn_liveworkstreamid_value === wsNamed(store, wsName).msdyn_liveworkstreamid && x._msdyn_phonenumberid_value);
  return String(store.find("msdyn_ocphonenumber", c!._msdyn_phonenumberid_value)!.msdyn_phonenumber);
};

// What the environment says the answer is, for each question a lab asks.
const TRUTH: Record<string, (c: Ctx) => string> = {
  "orientation/which-workstream": (c) => c.v.workstream,
  "orientation/which-queue": (c) => queueOf(c.store, c.lastCall)!,
  "orientation/second-queue": (c) => queueOf(c.store, c.lastCall)!,
  "queues-people/count-members": (c) => String(c.store.table("queuemembership").filter((m) => m.queueid === c.store.table("queue").find((q) => q.name === c.v.queue1)!.queueid).length),
  "numbers/which-ws": (c) => String(lineOf(c.store, c.v.techDial).workstream!.msdyn_name),
  "numbers/how-many": (c) => String(c.store.table("msdyn_ocvoicechannelsetting").filter((x) => x._msdyn_liveworkstreamid_value === wsNamed(c.store, c.v.workstream).msdyn_liveworkstreamid && x._msdyn_phonenumberid_value).length),
  "workstreams/fallback-now": (c) => String(c.store.find("queue", wsNamed(c.store, c.v.techWs)._msdyn_defaultqueue_value)!.name),
  "workstreams/profile": (c) => {
    const link = c.store.table("msdyn_liveworkstreamcapacityprofile").find((l) => l._msdyn_workstream_id_value === wsNamed(c.store, c.v.techWs).msdyn_liveworkstreamid)!;
    return String(c.store.find("msdyn_capacityprofile", link._msdyn_capacityprofile_id_value)!.msdyn_name);
  },
  "assignment/method-now": (c) => methodOf(c.store.table("queue").find((q) => q.name === c.v.queue1)),
  "assignment/limit-now": (c) => String(c.store.table("msdyn_capacityprofile").find((p) => p.msdyn_name === c.v.profile)!.msdyn_defaultmaxunits),
  "ivr/variable": (c) => String(c.store.table("msdyn_ocliveworkstreamcontextvariable").find((x) => x._msdyn_liveworkstreamid_value === wsNamed(c.store, c.v.workstream).msdyn_liveworkstreamid && x.msdyn_name === c.v.variable)!.msdyn_name),
  "ivr/dutch-ivr": (c) => (wsNamed(c.store, c.v.dutchWs)._msdyn_bot_user_value ? "Yes" : "No"),
  "ivr/unknown-queue": (c) => queueOf(c.store, c.lastCall)!,
  "classification/rulesets-now": (c) => c.v.rulesets,
  "hours-overflow/hours-now": (c) => {
    const q = c.store.table("queue").find((x) => x.name === c.v.queue1)!;
    return String(c.store.find("msdyn_operatinghour", q._msdyn_operatinghourid_value)!.msdyn_name);
  },
  "workspace/company": (c) => {
    const customer = customerOfCall(c.store, c.store.find("msdyn_ocliveworkitem", c.lastCall!)!)!;
    return String(c.store.find("account", customer.row._parentcustomerid_value)!.name);
  }
};

// Questions whose answer is found by doing something: the lab's expected answer must be what happens.
async function proveByDoing(c: Ctx, key: string, expect: string) {
  if (key === "assignment/predict") {
    const call = await placeCall(c.store, { dial: c.v.dial, answers: { [c.v.variable]: c.v.value1 } }, { record: false });
    const steps = await placeCall(c.store, { dial: c.v.dial, answers: { [c.v.variable]: c.v.value1 } }, { record: true, now: NOW, routing: new Routing(c.store) });
    expect.length && expectAssigned(c, steps.workItemId!, expect);
    void call;
    return true;
  }
  if (key === "hours-overflow/evening-test") {
    const r = await placeCall(c.store, { dial: c.v.techDial, answers: { [c.v.variable]: c.v.techValue1 }, at: { day: 3, time: "23:00" } }, { record: false });
    expectEqual(r.outcome, expect, key);
    return true;
  }
  return false;
}
function expectAssigned(c: Ctx, id: string, name: string) {
  const agent = c.store.find("systemuser", c.store.find("msdyn_ocliveworkitem", id)!._msdyn_activeagentid_value)?.fullname;
  expectEqual(agent, name, "who takes the call");
}
function expectEqual(actual: unknown, wanted: unknown, what: string) {
  if (actual !== wanted) throw new Error(`${what}: the lab expects “${wanted}”, the environment says “${actual}”.`);
}

async function doTask(c: Ctx, lab: string, t: Task) {
  const ch = t.check;
  switch (ch.type) {
    case "answer": {
      const key = `${lab}/${t.id}`;
      if (TRUTH[key]) expectEqual(TRUTH[key](c), ch.expect, key);
      else if (!(await proveByDoing(c, key, ch.expect))) throw new Error(`No way to check the answer to ${key}.`);
      record(c.store, `answer:${ch.key}`, ch.expect);
      return;
    }
    case "seen": record(c.store, `seen:${ch.what}`); return;
    case "did": {
      if (ch.what === "accept-call") {
        // As the learner, signed in as the representative the lab names, from Sophie's number for the workspace lab.
        const rep = c.store.table("systemuser").find((u) => u.fullname === c.v.rep)!;
        c.routing.signInAs(rep.systemuserid);
        const r = await placeCall(c.store, { dial: c.v.dial, from: lab === "workspace" ? SOPHIE : undefined, answers: { [c.v.variable]: c.v.value1 } }, { record: true, now: NOW, routing: c.routing });
        if (!c.routing.offers.has(r.workItemId!)) throw new Error(`${lab}: the call isn't offered to ${c.v.rep}.`);
        c.routing.accept(r.workItemId!, NOW);
        c.lastCall = r.workItemId;
      }
      record(c.store, `did:${ch.what}`);
      return;
    }
    case "goal": solve(c.admin, ch.goal); return;
    case "row": createQueue(c.admin, { name: String(ch.where.name), type: "Voice", priority: 1 }); return;
    case "members": {
      const q = c.store.table("queue").find((x) => x.name === ch.queue)!;
      addUsers(c.admin, q.queueid, c.store.table("msdyn_agentstatus").slice(0, ch.atLeast).map((a) => a._msdyn_agentid_value));
      return;
    }
    case "numbers": {
      const phone = purchaseNumber(c.admin, findNumber(c.store, "United States", "425 (Washington)")!, { receive: true, make: false });
      setupWorkstream(c.admin, phone, wsNamed(c.store, ch.workstream).msdyn_liveworkstreamid);
      return;
    }
    case "callMade": {
      const dial = ch.dial ?? (ch.workstream ? numberOf(c.store, ch.workstream) : c.lesson.line.dial);
      const r = await placeCall(c.store, { dial, answers: ch.answers }, { record: true, now: NOW, routing: c.routing });
      c.lastCall = r.workItemId;
      return;
    }
    case "trace": {
      // The priority task: a work classification ruleset with one rule that sets Priority Score.
      const ws = lineOf(c.store, ch.dial).workstream!.msdyn_liveworkstreamid;
      const ruleset = createClassificationRuleset(c.admin, ws, { name: "Priority" });
      const [[variable, value]] = Object.entries(ch.answers);
      saveClassificationRule(c.admin, ws, ruleset, { name: "Urgent", conditions: { ...emptyConditions(), items: [{ field: `liveworkitemcontext.${variable}`, operator: "==", value }] }, outputs: [{ field: PRIORITY_SCORE, value: "10" }] });
      return;
    }
    case "call": return; // it places its own call
  }
}

describe.each(LABS.filter((l) => l.status === "ready" && l.do && !("template" in l.do)).map((l) => [l.number, l.id] as const))("lab %i (%s)", (_, id) => {
  test("nothing is done at the start, and every task can be done in order", async () => {
    const sim = createSimulator();
    installGlobalXrm(sim.xrm);
    const store = sim.store;
    const lab = LABS.find((l) => l.id === id)!;
    const lesson = labLesson(lab, store, 1);
    const c: Ctx = { store, admin: { api: sim.api, store }, routing: new Routing(store), v: labValues(store), lesson };
    // Every placeholder was filled in.
    expect(JSON.stringify(lesson)).not.toMatch(/\{[a-zA-Z0-9]+\}/);
    const passed = async () => Object.entries(await runChecks(store, lesson)).filter(([, r]) => r.passed).map(([k]) => k);
    expect(await passed()).toEqual([]);
    for (const [i, t] of lesson.tasks.entries()) {
      await doTask(c, id, t);
      expect(await passed()).toEqual(expect.arrayContaining(lesson.tasks.slice(0, i + 1).map((x) => x.id)));
    }
  });
});
