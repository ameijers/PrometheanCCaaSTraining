// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { Store } from "../simulator/store";
import { Assignment, assign, assignmentFor, closeCall, endCall, STATUS } from "./assignment";
import type { CallStep } from "./engine";

// The assignment cycle, run as the clock moves (Learn: it starts on "Arrival of a new work item in the
// queue", "Change to representative presence", "Addition of a representative to the queue", and keeps
// retrying). Waiting calls are offered oldest first. The simulated representatives accept straight away
// and finish their calls after a few minutes; the learner, signed in as a representative in the agent
// view, gets an offer to accept or reject.
//
// Simplified: a simulated call lasts 3 to 8 minutes and wrap-up 1 minute (made up, the same for a call
// every time). A call the learner rejects isn't offered to them again (Learn allows up to three declines).

export const WRAP_UP_MINUTES = 1;
const minutes = (n: number) => n * 60_000;

export function callMinutes(workItemId: string): number {
  let h = 0;
  for (const c of workItemId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 3 + (h % 6);
}

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

export class Routing {
  // The representative the learner is signed in as in the agent view, if any.
  learnerAgent?: string;
  // Calls offered to the learner, waiting for accept or reject.
  readonly offers = new Set<string>();
  private readonly declined = new Map<string, Set<string>>();
  private readonly decisions = new Map<string, Assignment>();

  constructor(private readonly store: Store) {}

  cycle(now: Date): void {
    const t = now.getTime();
    const items = this.store.table("msdyn_ocliveworkitem").filter((w) => w.statecode === 0);
    // The simulated representatives' calls move on.
    for (const w of items) {
      const agent = w._msdyn_activeagentid_value;
      if (!agent || agent === this.learnerAgent) continue;
      // Every step that's due, so a jump of the clock moves a call through all of them.
      let since = Date.parse(w.modifiedon ?? w.createdon);
      let status = w.statuscode;
      if (status === STATUS.active && t >= since + minutes(callMinutes(w.activityid))) {
        since += minutes(callMinutes(w.activityid));
        endCall(this.store, w.activityid, iso(since));
        status = STATUS.wrapUp;
      }
      if (status === STATUS.wrapUp && t >= since + minutes(WRAP_UP_MINUTES)) closeCall(this.store, w.activityid, iso(since + minutes(WRAP_UP_MINUTES)));
    }
    // Waiting calls, oldest first.
    for (const w of this.store.table("msdyn_ocliveworkitem").filter((x) => x.statecode === 0 && x.statuscode === STATUS.open && !x._msdyn_activeagentid_value).sort((a, b) => String(a.createdon).localeCompare(String(b.createdon)))) {
      if (this.offers.has(w.activityid) || !w._msdyn_cdsqueueid_value || !w._msdyn_liveworkstreamid_value) continue;
      // While the learner has an offer open, they aren't offered another.
      const exclude = new Set(this.declined.get(w.activityid) ?? []);
      if (this.learnerAgent && this.offers.size) exclude.add(this.learnerAgent);
      const decision = assignmentFor(this.store, w._msdyn_cdsqueueid_value, w._msdyn_liveworkstreamid_value, exclude, w.activityid);
      this.decisions.set(w.activityid, decision);
      if (!decision.chosen) continue;
      if (decision.chosen.id === this.learnerAgent) this.offers.add(w.activityid);
      else assign(this.store, w.activityid, decision.chosen.id, iso(t));
    }
  }

  accept(workItemId: string, now: Date): void {
    if (!this.offers.delete(workItemId) || !this.learnerAgent) return;
    assign(this.store, workItemId, this.learnerAgent, iso(now.getTime()));
  }

  reject(workItemId: string, now: Date): void {
    if (!this.offers.delete(workItemId) || !this.learnerAgent) return;
    this.declined.set(workItemId, new Set([...(this.declined.get(workItemId) ?? []), this.learnerAgent]));
    this.cycle(now);
  }

  // A supervisor's transfer to the learner: offered to them like a routed call (Learn: the transfer
  // completes when the representative selects Accept or Reject).
  offerToLearner(workItemId: string): void {
    if (this.learnerAgent) this.offers.add(workItemId);
  }

  // A call that's assigned, transferred or closed some other way isn't offered any more.
  withdraw(workItemId: string): void {
    this.offers.delete(workItemId);
  }

  // Signing out or switching representative: open offers go back to the queue.
  signInAs(agentId: string | undefined): void {
    this.offers.clear();
    this.learnerAgent = agentId;
  }

  // The call trace's assignment step, for a call just placed.
  step(workItemId: string): CallStep {
    const w = this.store.find("msdyn_ocliveworkitem", workItemId);
    const d = this.decisions.get(workItemId);
    const method = d ? `${d.method}. ` : "";
    if (this.offers.has(workItemId)) return { what: "Assignment", detail: `${method}${d?.why ?? ""} The call is offered to you in the agent view.`, status: "ok" };
    if (w?._msdyn_activeagentid_value) {
      const name = this.store.find("systemuser", w._msdyn_activeagentid_value)?.fullname;
      return { what: "Assignment", detail: `${method}${d?.why ?? ""} ${name} takes the call.`, status: "ok" };
    }
    return { what: "Assignment", detail: `${method}${d?.why ?? "Nobody can take it yet, so it waits."}`, status: "ok" };
  }

  decision(workItemId: string): Assignment | undefined {
    return this.decisions.get(workItemId);
  }
}
