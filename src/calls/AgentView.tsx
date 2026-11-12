// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Fragment, useEffect, useState } from "react";
import { QUEUE_TYPES } from "@toolbox/queue-builder/src/queueSchema";
import { Button, Checkbox, Dropdown, Field, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarBody, Option } from "@fluentui/react-components";
import { useStoreVersion, useTraining } from "../shell/context";
import { PRESENCE_NAMES, presenceId } from "../simulator/seeds/presence";
import { Row, Store } from "../simulator/store";
import { closeCall, endCall, representatives, STATUS } from "./assignment";
import { iso } from "./clock";

// The representative's and supervisor's app (manual 5.3), shaped like the Copilot Service workspace
// (looked at in academyexperiment, 2026-11-12; docs/workspace-check.md): a top bar with presence, session
// tabs (Home, Inbox, one per call), an incoming call notification, and a call session with the
// Communication Panel and the Active Conversation form. Home holds the supervisor's Omnichannel Ongoing
// Conversations Dashboard. Microsoft's names, our own look, and a training simulation banner.
//
// Call controls follow Learn (Use agent dashboard and call controls in the voice channel): Mute, Hold,
// Consult, Transfer, End; "To end the call after you select End, you must close the session."
// Simplified: Consult and Transfer aren't simulated, there's no notification timeout, no transcript and
// no sentiment, and the customer isn't identified. Closing a session is only offered after End.

const LEARN = "https://learn.microsoft.com/en-us/dynamics365/contact-center/use/voice-channel-agent-experience";

type Place = { kind: "home" } | { kind: "inbox" } | { kind: "session"; id: string };

const PRESENCE_COLOR: Record<string, string> = { Available: "#107c10", Busy: "#c50f1f", "Busy - DND": "#c50f1f", Away: "#eaa300", Offline: "#8a8886" };
const STATUS_NAME: Record<number, string> = { [STATUS.open]: "Open", [STATUS.active]: "Active", [STATUS.wrapUp]: "Wrap-up", [STATUS.closed]: "Closed" };

// 75 seconds as 00:01:15.
const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

export function AgentView() {
  const { sim, clock, routing, explain } = useTraining();
  const version = useStoreVersion();
  const [, setTick] = useState(0);
  const [me, setMe] = useState<string | undefined>(routing.learnerAgent);
  const [place, setPlace] = useState<Place>({ kind: "home" });
  // Call controls that only change how the call looks here (nothing is heard in the training).
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [held, setHeld] = useState<Set<string>>(new Set());
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  void version;
  const store = sim.store;
  const now = clock.now().getTime();

  // Representatives: users with an agent status (seeds/presence.ts), by name.
  const people = store.table("msdyn_agentstatus").map((s) => store.find("systemuser", s._msdyn_agentid_value)).filter(Boolean)
    .sort((a, b) => String(a!.fullname).localeCompare(String(b!.fullname)));
  const status = me ? store.table("msdyn_agentstatus").find((s) => s._msdyn_agentid_value === me) : undefined;
  const presence = status?._msdyn_currentpresenceid_value ? store.find("msdyn_presence", status._msdyn_currentpresenceid_value) : undefined;
  const signedIn = !!status?.msdyn_isagentloggedin;
  const presenceName = signedIn ? String(presence?.msdyn_name ?? "Offline") : "Offline";
  const myName = me ? String(store.find("systemuser", me)?.fullname ?? "") : "";

  const signIn = (id: string | undefined) => { routing.signInAs(id); setMe(id); setPlace({ kind: "home" }); explain("representative"); routing.cycle(clock.now()); };
  const setStatus = (changes: Record<string, unknown>) => {
    if (!status) return;
    store.update("msdyn_agentstatus", status.msdyn_agentstatusid, { ...changes, modifiedon: iso(clock.now()) });
    // A change of presence starts an assignment cycle (Learn, Assignment methods for queues).
    routing.cycle(clock.now());
  };

  const items = store.table("msdyn_ocliveworkitem");
  const offers = [...routing.offers].map((id) => items.find((w) => w.activityid === id)).filter(Boolean) as Row[];
  const mine = me ? items.filter((w) => w.statecode === 0 && w._msdyn_activeagentid_value === me) : [];
  const queues = me ? store.table("queuemembership").filter((m) => m.systemuserid === me).map((m) => store.find("queue", m.queueid)).filter(Boolean) as Row[] : [];
  const waitingIn = (queueId: string) => items.filter((w) => w.statecode === 0 && w.statuscode === STATUS.open && !w._msdyn_activeagentid_value && w._msdyn_cdsqueueid_value === queueId).length;

  const accept = (id: string) => { routing.accept(id, clock.now()); setPlace({ kind: "session", id }); };
  const session = place.kind === "session" ? mine.find((w) => w.activityid === place.id) : undefined;
  // A session whose call was closed elsewhere (or a switch of representative) goes back to the Inbox.
  useEffect(() => { if (place.kind === "session" && !session) setPlace({ kind: "inbox" }); }, [place.kind, session]);

  const closeSession = (w: Row) => {
    closeCall(store, w.activityid, iso(clock.now()));
    routing.cycle(clock.now());
    setPlace({ kind: "inbox" });
  };

  return (
    <div className="ws">
      <div className="admin-banner" role="note">
        <strong>Training simulation by Promethean Academy</strong>, not Microsoft's Copilot Service workspace. Buttons and fields have
        the real names; the look is our own. <a href={LEARN} target="_blank" rel="noreferrer">How it works on Microsoft Learn</a>
      </div>

      <div className="ws-training">
        <span className="ws-signin">
          <label id="ws-signin-label">Sign in as</label>
          <Dropdown aria-labelledby="ws-signin-label" placeholder="Choose a representative" value={myName} selectedOptions={me ? [me] : []} onOptionSelect={(_, d) => signIn(d.optionValue)}>
            {people.map((u) => <Option key={u!.systemuserid} value={u!.systemuserid}>{u!.fullname}</Option>)}
          </Dropdown>
        </span>
        {me && <span className="ws-queues">My queues: {queues.length ? queues.map((q) => `${q.name} (${waitingIn(q.queueid)} waiting)`).join(", ") : "none"}</span>}
        <span className="admin-muted">Training: call one of these queues on the Phone tab to get a call here.</span>
      </div>

      <div className="ws-top">
        <span className="ws-app">Copilot Service workspace</span>
        {me && (
          <div className="ws-top-actions">
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <button className="ws-presence" aria-label={`Presence: ${presenceName}`} title={presenceName}>
                  <span className="ws-dot" style={{ background: PRESENCE_COLOR[presenceName] ?? "#8a8886" }} />{presenceName}
                </button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {Object.entries(PRESENCE_NAMES).map(([base, name]) => (
                    <MenuItem key={base} icon={<span className="ws-dot" style={{ background: PRESENCE_COLOR[name] }} />}
                      onClick={() => setStatus({ _msdyn_currentpresenceid_value: presenceId(Number(base)), msdyn_isagentloggedin: true })}>{name}</MenuItem>
                  ))}
                </MenuList>
              </MenuPopover>
            </Menu>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <button className="ws-account" aria-label={`Account manager for ${myName}`} title={myName}>{initials(myName)}</button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {signedIn
                    ? <MenuItem onClick={() => setStatus({ msdyn_isagentloggedin: false })}>Sign out</MenuItem>
                    : <MenuItem onClick={() => setStatus({ msdyn_isagentloggedin: true })}>Sign in</MenuItem>}
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        )}
      </div>

      {!me ? (
        <div className="ws-empty"><p>Choose a representative under <strong>Sign in as</strong> to open their workspace.</p></div>
      ) : (
        <>
          <div className="ws-stage">
          <nav className="ws-sessions" aria-label="Sessions">
            <button className={place.kind === "home" ? "active" : ""} onClick={() => setPlace({ kind: "home" })}>Home</button>
            <button className={place.kind === "inbox" ? "active" : ""} onClick={() => setPlace({ kind: "inbox" })}>Inbox</button>
            {mine.map((w) => (
              <span key={w.activityid} className={`ws-session${place.kind === "session" && place.id === w.activityid ? " active" : ""}`}>
                <button onClick={() => setPlace({ kind: "session", id: w.activityid })}>📞 {customerOf(w)}</button>
                <button className="ws-close" aria-label="Close session" disabled={w.statuscode !== STATUS.wrapUp}
                  title={w.statuscode === STATUS.wrapUp ? "Close session: closes the conversation" : "End the call first"} onClick={() => closeSession(w)}>✕</button>
              </span>
            ))}
          </nav>

          {!signedIn
            ? <MessageBar intent="warning"><MessageBarBody>You're signed out of the workspace, so no calls are offered. Sign in from the account menu (top right).</MessageBarBody></MessageBar>
            : !offers.length && !mine.length && <MessageBar intent="info"><MessageBarBody>No calls for you right now. {whyNoCalls(store, me)}</MessageBarBody></MessageBar>}

          <div className="ws-body">
            {place.kind === "home" && <OngoingDashboard store={store} now={now} />}
            {place.kind === "inbox" && <Inbox store={store} items={mine} now={now} open={(id) => setPlace({ kind: "session", id })} />}
            {session && (
              <CallSession store={store} w={session} now={now} muted={muted.has(session.activityid)} held={held.has(session.activityid)}
                toggleMute={() => setMuted(toggle(muted, session.activityid))} toggleHold={() => setHeld(toggle(held, session.activityid))}
                end={() => { endCall(store, session.activityid, iso(clock.now())); explain("capacity-profile"); }}
                close={() => closeSession(session)} why={routing.decision(session.activityid)} />
            )}
          </div>

          {offers.map((w) => (
            <div key={w.activityid} className="ws-notification" role="alertdialog" aria-label="Incoming call">
              <p className="ws-notification-title">📞 Incoming call</p>
              <p className="admin-tight"><strong>{customerOf(w)}</strong></p>
              <p className="admin-tight">Queue: {store.find("queue", w._msdyn_cdsqueueid_value)?.name}</p>
              {answersOf(store, w.activityid).length > 0 && <p className="admin-tight admin-muted">{answersOf(store, w.activityid).map(([n, v]) => `${n}: ${v}`).join(" · ")}</p>}
              <p className="admin-muted admin-tight ws-why">Training: {routing.decision(w.activityid)?.method}: {routing.decision(w.activityid)?.why}</p>
              <div className="ws-notification-actions">
                <Button appearance="primary" onClick={() => accept(w.activityid)}>Accept</Button>
                <Button onClick={() => routing.reject(w.activityid, clock.now())}>Reject</Button>
              </div>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

// The caller isn't identified in the training: no customer records are matched to phone numbers.
function customerOf(_w: Row): string {
  return "Unknown caller";
}

function answersOf(store: Store, id: string): [string, string][] {
  return store.table("msdyn_ocliveworkitemcontextitem").filter((c) => c._msdyn_ocliveworkitemid_value === id).map((c) => [String(c.msdyn_name), String(c.msdyn_value)]);
}

function assignedAt(store: Store, id: string): number | undefined {
  const a = store.table("training_assignment").filter((x) => x.workitemid === id).sort((x, y) => String(y.assignedon).localeCompare(String(x.assignedon)))[0];
  return a ? new Date(a.assignedon).getTime() : undefined;
}

// Inbox: My work items, as in the workspace (customer, queue, how long, when).
function Inbox({ store, items, now, open }: { store: Store; items: Row[]; now: number; open: (id: string) => void }) {
  return (
    <div className="ws-inbox">
      <div className="ws-card ws-inbox-list">
        <p className="ws-card-title">My work items</p>
        {items.length ? items.map((w) => (
          <button key={w.activityid} className="ws-item" onClick={() => open(w.activityid)}>
            <span className="ws-item-icon" aria-hidden="true">📞</span>
            <span>
              <strong>{customerOf(w)}</strong><br />
              <span className="ws-link">Queue: {store.find("queue", w._msdyn_cdsqueueid_value)?.name}</span><br />
              <span className="admin-muted">{duration(now - (assignedAt(store, w.activityid) ?? now))} · {STATUS_NAME[Number(w.statuscode)]}</span>
            </span>
          </button>
        )) : <p className="admin-muted">No work items.</p>}
        <p className="admin-muted ws-count">{items.length} items</p>
      </div>
      <div className="ws-card ws-inbox-empty"><p className="admin-muted">Select an item to work on.</p></div>
    </div>
  );
}

// A call session: the Communication Panel (call controls) and the Active Conversation form.
function CallSession(props: {
  store: Store; w: Row; now: number; muted: boolean; held: boolean; toggleMute(): void; toggleHold(): void; end(): void; close(): void;
  why?: { method: string; why: string };
}) {
  const { store, w, now, muted, held } = props;
  const active = w.statuscode === STATUS.active;
  const started = assignedAt(store, w.activityid);
  const queue = store.find("queue", w._msdyn_cdsqueueid_value);
  const workstream = store.find("msdyn_liveworkstream", w._msdyn_liveworkstreamid_value);
  const answers = answersOf(store, w.activityid);
  const notSimulated = "Not simulated in the training";
  return (
    <div className="ws-session-body">
      <section className="ws-card ws-panel" aria-label="Communication Panel">
        <p className="ws-card-title">Communication Panel</p>
        <div className="ws-caller">
          <span className="ws-avatar" aria-hidden="true">?</span>
          <span><strong>{customerOf(w)}</strong><br /><span className="admin-muted">{active ? (held ? "On hold" : "On the call") : "Call ended"} · {duration(now - (started ?? now))}</span></span>
        </div>
        <div className="ws-controls" role="toolbar" aria-label="Call controls">
          <button disabled={!active} aria-pressed={muted} onClick={props.toggleMute}>🎙️<span>{muted ? "Unmute" : "Mute"}</span></button>
          <button disabled={!active} aria-pressed={held} onClick={props.toggleHold}>⏸️<span>{held ? "Unhold" : "Hold"}</span></button>
          <button disabled title={notSimulated}>👥<span>Consult</span></button>
          <button disabled title={notSimulated}>↪️<span>Transfer</span></button>
          <button className="ws-end" disabled={!active} onClick={props.end}>📵<span>End</span></button>
        </div>
        <div className="ws-messages">
          <p className="ws-card-title">System Messages</p>
          {started && <p className="admin-tight">{new Date(started).toISOString().slice(11, 16)} You accepted the call.</p>}
          {!active && <p className="admin-tight">The call ended. Wrap-up: close the session to close the conversation.</p>}
          <p className="admin-muted admin-tight">The transcript and sentiment aren't simulated.</p>
        </div>
      </section>

      <section className="ws-card ws-form" aria-label="Active Conversation">
        <p className="ws-form-title">Active Conversation</p>
        <span className={`phone-badge${active ? "" : " other"}`}>{STATUS_NAME[Number(w.statuscode)]}</span>
        {!active && (
          <MessageBar intent="info"><MessageBarBody>
            In wrap-up your capacity stays in use. Close the session to close the conversation.{" "}
            <Button size="small" appearance="primary" onClick={props.close}>Close session</Button>
          </MessageBarBody></MessageBar>
        )}
        <Field label="Search customer"><Input disabled placeholder="No customer linked" /></Field>
        <p className="ws-section">Phone call details</p>
        <dl className="ws-fields">
          <dt>Engagement channel</dt><dd>Voice call</dd>
          <dt>Workstream</dt><dd>{String(workstream?.msdyn_name ?? "")}</dd>
          <dt>Queue</dt><dd>{String(queue?.name ?? "")}</dd>
          <dt>Waiting time</dt><dd>{started ? duration(started - new Date(w.createdon).getTime()) : ""}</dd>
          <dt>Start time</dt><dd>{started ? new Date(started).toISOString().slice(11, 16) : ""}</dd>
          <dt>Subject</dt><dd>{String(w.msdyn_title ?? "")}</dd>
        </dl>
        <p className="ws-section">Context from the IVR</p>
        {answers.length
          ? <dl className="ws-fields">{answers.map(([n, v]) => <Fragment key={n}><dt>{n}</dt><dd>{v}</dd></Fragment>)}</dl>
          : <p className="admin-muted">No answers were captured.</p>}
        {props.why && <p className="admin-muted ws-why">Training: why you got this call. {props.why.method}: {props.why.why}</p>}
      </section>
    </div>
  );
}

// The supervisor's Omnichannel Ongoing Conversations Dashboard: Filter by queues, and the conversations
// that are open, active or in wrap-up. Monitor and Copy URL aren't simulated.
function OngoingDashboard({ store, now }: { store: Store; now: number }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const queues = store.table("queue").filter((q) => q.msdyn_queuetype === QUEUE_TYPES.Voice || store.table("msdyn_ocliveworkitem").some((w) => w._msdyn_cdsqueueid_value === q.queueid))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const shown = queues.filter((q) => String(q.name).toLowerCase().includes(search.toLowerCase()));
  const rows = store.table("msdyn_ocliveworkitem").filter((w) => w.statecode === 0 && (!picked.size || picked.has(w._msdyn_cdsqueueid_value)));
  const agent = (w: Row) => w._msdyn_activeagentid_value ? String(store.find("systemuser", w._msdyn_activeagentid_value)?.fullname ?? "") : "";
  void now;
  return (
    <div>
      <p className="ws-dashboard-title">Omnichannel Ongoing Conversations Dashboard</p>
      <div className="ws-dashboard">
        <div className="ws-card ws-filter">
          <p className="ws-card-title">Filter by queues</p>
          <Input size="small" placeholder="Search" value={search} onChange={(_, d) => setSearch(d.value)} aria-label="Search queues" />
          <p className="admin-muted admin-tight">{shown.length} records</p>
          <div className="ws-filter-list">
            {shown.map((q) => <Checkbox key={q.queueid} label={String(q.name)} checked={picked.has(q.queueid)} onChange={() => setPicked(toggle(picked, q.queueid))} />)}
          </div>
        </div>
        <div className="ws-card ws-conversations">
          <div className="ws-conversations-head">
            <p className="ws-card-title">Conversations</p>
            <span><Button size="small" appearance="subtle" disabled title="Not simulated in the training">Monitor</Button><Button size="small" appearance="subtle" disabled title="Not simulated in the training">Copy URL</Button></span>
          </div>
          <div className="ws-table-wrap">
            <table className="ws-table">
              <thead><tr><th>Customer</th><th>Subject</th><th>Queue</th><th>Channel</th><th>Status Reason</th><th>Customer Sentiment</th><th>Representative</th></tr></thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.activityid}>
                    <td>{customerOf(w)}</td><td>{String(w.msdyn_title ?? "")}</td><td>{String(store.find("queue", w._msdyn_cdsqueueid_value)?.name ?? "")}</td>
                    <td>Voice call</td><td>{STATUS_NAME[Number(w.statuscode)]}</td><td>---</td><td>{agent(w) || "---"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="admin-muted">We didn't find anything to show here.</p>}
          </div>
          <p className="admin-muted admin-tight">Representative is the training's extra column: who has the call. Sentiment isn't simulated.</p>
        </div>
      </div>
    </div>
  );
}

// Why the signed-in representative isn't getting calls: the first reason the assignment gives for them.
function whyNoCalls(store: Store, me: string): string {
  for (const m of store.table("queuemembership").filter((x) => x.systemuserid === me)) {
    const ws = store.table("msdyn_liveworkstream").find((w) => w.msdyn_enablevoicev2);
    if (!ws) break;
    const r = representatives(store, m.queueid, ws.msdyn_liveworkstreamid).find((x) => x.id === me);
    if (r?.notNow) return `You ${r.notNow}.`;
  }
  return "Nobody is calling your queues.";
}
