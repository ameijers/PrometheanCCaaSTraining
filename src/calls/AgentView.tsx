// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Button, Dropdown, Field, MessageBar, MessageBarBody, Option } from "@fluentui/react-components";
import { useStoreVersion, useTraining } from "../shell/context";
import { PRESENCE_NAMES, presenceId } from "../simulator/seeds/presence";
import { closeCall, endCall, representatives, STATUS } from "./assignment";
import { iso } from "./clock";
import { describeTime } from "./engine";

// The agent view (manual 5.3): the learner signs in as one of the representatives, sets their presence,
// and takes calls the routing offers them: accept or reject, end the call, close it after wrap-up.
// Simplified: no call controls (hold, transfer, consult), no notification timeout, and the conversation
// itself isn't simulated.

export function AgentView() {
  const { sim, clock, routing, explain } = useTraining();
  const version = useStoreVersion();
  const [, setTick] = useState(0);
  const [me, setMe] = useState<string | undefined>(routing.learnerAgent);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const store = sim.store;

  // Representatives: users with an agent status (seeds/presence.ts), by name.
  const people = store.table("msdyn_agentstatus").map((s) => store.find("systemuser", s._msdyn_agentid_value)).filter(Boolean)
    .sort((a, b) => String(a!.fullname).localeCompare(String(b!.fullname)));
  const status = me ? store.table("msdyn_agentstatus").find((s) => s._msdyn_agentid_value === me) : undefined;
  const presence = status?._msdyn_currentpresenceid_value ? store.find("msdyn_presence", status._msdyn_currentpresenceid_value) : undefined;
  const signIn = (id: string | undefined) => { routing.signInAs(id); setMe(id); explain("representative"); routing.cycle(clock.now()); };
  const setStatus = (changes: Record<string, unknown>) => {
    if (!status) return;
    store.update("msdyn_agentstatus", status.msdyn_agentstatusid, { ...changes, modifiedon: iso(clock.now()) });
    // A change of presence starts an assignment cycle (Learn, Assignment methods for queues).
    routing.cycle(clock.now());
  };

  const items = store.table("msdyn_ocliveworkitem");
  const offers = [...routing.offers].map((id) => items.find((w) => w.activityid === id)).filter(Boolean);
  const mine = me ? items.filter((w) => w.statecode === 0 && w._msdyn_activeagentid_value === me) : [];
  const queues = me ? store.table("queuemembership").filter((m) => m.systemuserid === me).map((m) => store.find("queue", m.queueid)).filter(Boolean) : [];
  const answersOf = (id: string) => store.table("msdyn_ocliveworkitemcontextitem").filter((c) => c._msdyn_ocliveworkitemid_value === id).map((c) => `${c.msdyn_name} = ${c.msdyn_value}`).join(", ");
  const waitingIn = (queueId: string) => items.filter((w) => w.statecode === 0 && w.statuscode === STATUS.open && !w._msdyn_activeagentid_value && w._msdyn_cdsqueueid_value === queueId).length;
  const ws = (id: string) => store.find("msdyn_liveworkstream", id);
  void version;

  return (
    <div className="agent">
      <div className="agent-side">
        <h2 className="phone-title">Agent view</h2>
        <Field label="Sign in as" hint="One of the representatives in this environment.">
          <Dropdown placeholder="Choose a representative" value={me ? String(store.find("systemuser", me)?.fullname ?? "") : ""} selectedOptions={me ? [me] : []}
            onOptionSelect={(_, d) => signIn(d.optionValue)}>
            {people.map((u) => <Option key={u!.systemuserid} value={u!.systemuserid}>{u!.fullname}</Option>)}
          </Dropdown>
        </Field>
        {me && status && (
          <>
            <Field label="Presence">
              <Dropdown value={status.msdyn_isagentloggedin ? String(presence?.msdyn_name ?? "") : "Signed out"} selectedOptions={presence ? [String(presence.msdyn_basepresencestatus)] : []}
                onOptionSelect={(_, d) => setStatus({ _msdyn_currentpresenceid_value: presenceId(Number(d.optionValue)), msdyn_isagentloggedin: true })}>
                {Object.entries(PRESENCE_NAMES).map(([base, name]) => <Option key={base} value={base}>{name}</Option>)}
              </Dropdown>
            </Field>
            <Button size="small" onClick={() => setStatus({ msdyn_isagentloggedin: !status.msdyn_isagentloggedin })}>{status.msdyn_isagentloggedin ? "Sign out of the workspace" : "Sign in to the workspace"}</Button>
            <div className="agent-queues">
              <strong>My queues</strong>
              {queues.length ? queues.map((q) => <p key={q!.queueid} className="admin-tight">{q!.name}: {waitingIn(q!.queueid)} waiting</p>) : <p className="admin-muted">Not in any queue.</p>}
            </div>
          </>
        )}
        <p className="admin-muted phone-note">Simulated: calls are offered here by the training's routing. Call the queue's number on the Phone tab to get one.</p>
      </div>

      <div className="agent-main">
        {!me && <p className="admin-muted">Sign in as a representative to take calls. Then call one of their queues on the Phone tab.</p>}
        {offers.map((w) => (
          <div key={w!.activityid} className="agent-offer" role="alert">
            <strong>Incoming call</strong>
            <p className="admin-tight">{ws(w!._msdyn_liveworkstreamid_value)?.msdyn_name} · {store.find("queue", w!._msdyn_cdsqueueid_value)?.name}{answersOf(w!.activityid) ? ` · ${answersOf(w!.activityid)}` : ""}</p>
            <p className="admin-muted admin-tight">{routing.decision(w!.activityid)?.method}: {routing.decision(w!.activityid)?.why}</p>
            <div className="lesson-actions">
              <Button appearance="primary" onClick={() => routing.accept(w!.activityid, clock.now())}>Accept</Button>
              <Button onClick={() => routing.reject(w!.activityid, clock.now())}>Reject</Button>
            </div>
          </div>
        ))}
        {me && !offers.length && !mine.length && (
          <MessageBar intent="info"><MessageBarBody>{status?.msdyn_isagentloggedin ? `No calls for you right now. ${whyNoCalls(store, me)}` : "You're signed out of the workspace, so no calls are offered."}</MessageBarBody></MessageBar>
        )}
        {mine.map((w) => (
          <div key={w.activityid} className="phone-call">
            <div className="phone-call-head">
              <strong>{w.msdyn_title} · {store.find("queue", w._msdyn_cdsqueueid_value)?.name}</strong>
              <span className={`phone-badge${w.statuscode === STATUS.wrapUp ? " other" : ""}`}>{w.statuscode === STATUS.wrapUp ? "Wrap-up" : "On the call"}</span>
            </div>
            {answersOf(w.activityid) && <p className="admin-tight">IVR: {answersOf(w.activityid)}</p>}
            <p className="admin-muted admin-tight">Since {describeTime({ day: new Date(w.modifiedon).getUTCDay(), time: String(w.modifiedon).slice(11, 16) })}. {w.statuscode === STATUS.wrapUp ? "Your capacity stays in use until you close it (the workstream blocks capacity for wrap-up)." : ""}</p>
            <div className="lesson-actions">
              {w.statuscode === STATUS.active
                ? <Button onClick={() => { endCall(store, w.activityid, iso(clock.now())); explain("capacity-profile"); }}>End call</Button>
                : <Button appearance="primary" onClick={() => { closeCall(store, w.activityid, iso(clock.now())); routing.cycle(clock.now()); }}>Close</Button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Why the signed-in representative isn't getting calls: the first reason the assignment gives for them.
function whyNoCalls(store: import("../simulator/store").Store, me: string): string {
  for (const m of store.table("queuemembership").filter((x) => x.systemuserid === me)) {
    const ws = store.table("msdyn_liveworkstream").find((w) => w.msdyn_enablevoicev2);
    if (!ws) break;
    const r = representatives(store, m.queueid, ws.msdyn_liveworkstreamid).find((x) => x.id === me);
    if (r?.notNow) return `You ${r.notNow}.`;
  }
  return "Nobody is calling your queues.";
}
