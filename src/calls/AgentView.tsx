// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Fragment, useEffect, useState } from "react";
import { Button, Field, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarBody, Tab, TabList, Dropdown, Option } from "@fluentui/react-components";
import { useStoreVersion, useTraining } from "../shell/context";
import { PRESENCE_NAMES, presenceId } from "../simulator/seeds/presence";
import { Row, Store } from "../simulator/store";
import { closeCall, endCall, representatives, STATUS } from "./assignment";
import { iso } from "./clock";
import { assignedAt, saveSummary, sentiment, summaryOf, transcript } from "./conversation";
import { customerName, customerOfCall, earlierCalls, identificationText, identifyCaller, callInfo } from "./customers";
import { transfer } from "./supervisor";
import { duration, OngoingDashboard, RealtimeAnalytics, STATUS_NAME, TargetDialog, Transcript } from "./SupervisorViews";

// The representative's and supervisor's app (manual 5.3), shaped like the Copilot Service workspace
// (looked at in academyexperiment, 2026-11-12; docs/workspace-check.md), Contact Center parts only:
// - a top bar with presence and the account menu; session tabs (Home, Inbox, one per call);
// - the Inbox (My work items) and the calls waiting in the representative's queues;
// - an incoming call notification (Accept, Reject) with the identified customer;
// - a call session: the Communication Panel (call controls, live transcript), the Active Conversation form
//   (customer, timeline of earlier conversations, phone call details, IVR answers) and Copilot
//   (Summarize conversation);
// - Home: the supervisor's Omnichannel Ongoing Conversations Dashboard and Omnichannel real-time analytics
//   (SupervisorViews.tsx).
//
// Call controls follow Learn (Use agent dashboard and call controls in the voice channel): Mute, Hold,
// Consult, Transfer, End; "To end the call after you select End, you must close the session." Hide
// Transcript / Show Transcript "persists across all calls and sessions".
// Simplified: Consult isn't simulated, there's no notification timeout, the transcript and sentiment are
// scripted (conversation.ts), and a session can only be closed after End.

const LEARN = "https://learn.microsoft.com/en-us/dynamics365/contact-center/use/voice-channel-agent-experience";

type Place = { kind: "home" } | { kind: "inbox" } | { kind: "session"; id: string };
type Dashboard = "ongoing" | "realtime";

const PRESENCE_COLOR: Record<string, string> = { Available: "#107c10", Busy: "#c50f1f", "Busy - DND": "#c50f1f", Away: "#eaa300", Offline: "#8a8886" };
const SENTIMENT_ICON: Record<string, string> = { Positive: "🙂", Neutral: "😐", Negative: "🙁" };
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const hhmm = (t: number | string | undefined) => (t === undefined ? "" : new Date(t).toISOString().slice(11, 16));
const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

export function AgentView() {
  const { sim, clock, routing, explain } = useTraining();
  const version = useStoreVersion();
  const [, setTick] = useState(0);
  const [me, setMe] = useState<string | undefined>(routing.learnerAgent);
  const [place, setPlace] = useState<Place>({ kind: "home" });
  const [dashboard, setDashboard] = useState<Dashboard>("ongoing");
  // Call controls that only change how the call looks here (nothing is heard in the training).
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [showTranscript, setShowTranscript] = useState(true);
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
  const waiting = items.filter((w) => w.statecode === 0 && w.statuscode === STATUS.open && !w._msdyn_activeagentid_value && queues.some((q) => q.queueid === w._msdyn_cdsqueueid_value));

  const accept = (id: string) => { routing.accept(id, clock.now()); setPlace({ kind: "session", id }); };
  const session = place.kind === "session" ? mine.find((w) => w.activityid === place.id) : undefined;
  // A session whose call was closed or moved elsewhere goes back to the Inbox.
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
        {me && <span className="ws-queues">My queues: {queues.length ? queues.map((q) => q.name).join(", ") : "none"}</span>}
        <span className="admin-muted">Training: call one of these queues on the Phone tab to get a call here. Home has the supervisor's views.</span>
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
        <div className="ws-stage">
          <nav className="ws-sessions" aria-label="Sessions">
            <button className={place.kind === "home" ? "active" : ""} onClick={() => setPlace({ kind: "home" })}>Home</button>
            <button className={place.kind === "inbox" ? "active" : ""} onClick={() => setPlace({ kind: "inbox" })}>Inbox</button>
            {mine.map((w) => (
              <span key={w.activityid} className={`ws-session${place.kind === "session" && place.id === w.activityid ? " active" : ""}`}>
                <button onClick={() => setPlace({ kind: "session", id: w.activityid })}>📞 {customerName(store, w)}</button>
                <button className="ws-close" aria-label="Close session" disabled={w.statuscode !== STATUS.wrapUp}
                  title={w.statuscode === STATUS.wrapUp ? "Close session: closes the conversation" : "End the call first"} onClick={() => closeSession(w)}>✕</button>
              </span>
            ))}
          </nav>

          {!signedIn
            ? <MessageBar intent="warning"><MessageBarBody>You're signed out of the workspace, so no calls are offered. Sign in from the account menu (top right).</MessageBarBody></MessageBar>
            : !offers.length && !mine.length && <MessageBar intent="info"><MessageBarBody>No calls for you right now. {whyNoCalls(store, me)}</MessageBarBody></MessageBar>}

          <div className="ws-body">
            {place.kind === "home" && (
              <div>
                <TabList size="small" selectedValue={dashboard} onTabSelect={(_, d) => setDashboard(d.value as Dashboard)} className="ws-dashboard-tabs">
                  <Tab value="ongoing">Omnichannel Ongoing Conversations Dashboard</Tab>
                  <Tab value="realtime">Omnichannel real-time analytics</Tab>
                </TabList>
                {dashboard === "ongoing" ? <OngoingDashboard store={store} routing={routing} now={now} me={me} /> : <RealtimeAnalytics store={store} routing={routing} now={now} me={me} />}
              </div>
            )}
            {place.kind === "inbox" && <Inbox store={store} items={mine} waiting={waiting} now={now} open={(id) => setPlace({ kind: "session", id })} />}
            {session && (
              <CallSession store={store} w={session} now={now} me={me} muted={muted.has(session.activityid)} held={held.has(session.activityid)} showTranscript={showTranscript}
                toggleTranscript={() => setShowTranscript(!showTranscript)}
                toggleMute={() => setMuted(toggle(muted, session.activityid))} toggleHold={() => setHeld(toggle(held, session.activityid))}
                end={() => { endCall(store, session.activityid, iso(clock.now())); saveSummary(store, store.find("msdyn_ocliveworkitem", session.activityid)!, now); explain("capacity-profile"); }}
                transfer={(t) => { transfer(store, routing, session.activityid, t, now); setPlace({ kind: "inbox" }); }}
                close={() => closeSession(session)} why={routing.decision(session.activityid)} />
            )}
          </div>

          {offers.map((w) => {
            const found = identifyCaller(store, callInfo(store, w.activityid)?.fromnumber);
            return (
              <div key={w.activityid} className="ws-notification" role="alertdialog" aria-label="Incoming call">
                <p className="ws-notification-title">📞 Incoming call</p>
                <p className="admin-tight"><strong>{customerName(store, w)}</strong></p>
                <p className="admin-tight">Queue: {store.find("queue", w._msdyn_cdsqueueid_value)?.name}</p>
                {answersOf(store, w.activityid).length > 0 && <p className="admin-tight admin-muted">{answersOf(store, w.activityid).map(([n, v]) => `${n}: ${v}`).join(" · ")}</p>}
                <p className="admin-muted admin-tight ws-why">Training: {identificationText(found)} {routing.decision(w.activityid)?.method ? `${routing.decision(w.activityid)?.method}: ${routing.decision(w.activityid)?.why}` : "A transfer to you."}</p>
                <div className="ws-notification-actions">
                  <Button appearance="primary" onClick={() => accept(w.activityid)}>Accept</Button>
                  <Button onClick={() => routing.reject(w.activityid, clock.now())}>Reject</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function answersOf(store: Store, id: string): [string, string][] {
  return store.table("msdyn_ocliveworkitemcontextitem").filter((c) => c._msdyn_ocliveworkitemid_value === id).map((c) => [String(c.msdyn_name), String(c.msdyn_value)]);
}

// Inbox: My work items, as in the workspace (customer, queue, how long, sentiment), and the calls waiting in
// the representative's queues.
function Inbox({ store, items, waiting, now, open }: { store: Store; items: Row[]; waiting: Row[]; now: number; open: (id: string) => void }) {
  return (
    <div className="ws-inbox">
      <div className="ws-card ws-inbox-list">
        <p className="ws-card-title">My work items</p>
        {items.length ? items.map((w) => (
          <button key={w.activityid} className="ws-item" onClick={() => open(w.activityid)}>
            <span className="ws-item-icon" aria-hidden="true">📞</span>
            <span>
              <strong>{customerName(store, w)}</strong><br />
              <span className="ws-link">Queue: {store.find("queue", w._msdyn_cdsqueueid_value)?.name}</span><br />
              <span className="admin-muted">{duration(now - (assignedAt(store, w.activityid) ?? now))} · {sentiment(store, w, now) ?? "---"} · {STATUS_NAME[Number(w.statuscode)]}</span>
            </span>
          </button>
        )) : <p className="admin-muted">No work items.</p>}
        <p className="admin-muted ws-count">{items.length} items</p>
      </div>
      <div className="ws-card">
        <p className="ws-card-title">Waiting in my queues</p>
        {waiting.length ? (
          <table className="ws-table">
            <thead><tr><th>Customer</th><th>Queue</th><th>Waiting</th></tr></thead>
            <tbody>{waiting.map((w) => <tr key={w.activityid}><td>{customerName(store, w)}</td><td>{String(store.find("queue", w._msdyn_cdsqueueid_value)?.name ?? "")}</td><td>{duration(now - Date.parse(w.createdon))}</td></tr>)}</tbody>
          </table>
        ) : <p className="admin-muted">Nobody is waiting in your queues.</p>}
        <p className="admin-muted admin-tight ws-why">Training view: routing offers these calls to the representatives of the queue as they become free.</p>
      </div>
    </div>
  );
}

// A call session: the Communication Panel (call controls, transcript), the Active Conversation form and
// Copilot.
function CallSession(props: {
  store: Store; w: Row; now: number; me: string; muted: boolean; held: boolean; showTranscript: boolean; toggleTranscript(): void;
  toggleMute(): void; toggleHold(): void; end(): void; close(): void; transfer(t: import("./supervisor").Target): void;
  why?: { method: string; why: string };
}) {
  const { store, w, now, muted, held } = props;
  const [transferring, setTransferring] = useState(false);
  // The summary card shows the latest summary until it's closed; a new one (Summarize, End) shows again.
  const [closedFor, setClosedFor] = useState<string>();
  const active = w.statuscode === STATUS.active;
  const started = assignedAt(store, w.activityid);
  const queue = store.find("queue", w._msdyn_cdsqueueid_value);
  const workstream = store.find("msdyn_liveworkstream", w._msdyn_liveworkstreamid_value);
  const answers = answersOf(store, w.activityid);
  const customer = customerOfCall(store, w);
  const found = identifyCaller(store, callInfo(store, w.activityid)?.fromnumber);
  const mood = sentiment(store, w, now);
  const lines = transcript(store, w, now);
  const info = callInfo(store, w.activityid);
  const shownSummary = info?.summary && String(info.summarizedon) !== closedFor ? String(info.summary) : undefined;
  const account = customer?.kind === "contact" && customer.row._parentcustomerid_value ? store.find("account", customer.row._parentcustomerid_value) : undefined;
  const history = earlierCalls(store, w);
  return (
    <div className="ws-session-body">
      <section className="ws-card ws-panel" aria-label="Communication Panel">
        <p className="ws-card-title">Communication Panel</p>
        <div className="ws-caller">
          <span className="ws-avatar" aria-hidden="true">{customer ? initials(customer.name) : "?"}</span>
          <span><strong>{customerName(store, w)}</strong><br />
            <span className="admin-muted">{active ? (held ? "On hold" : "On the call") : "Call ended"} · {duration(now - (started ?? now))}{mood ? ` · ${SENTIMENT_ICON[mood]} ${mood}` : ""}</span></span>
        </div>
        <div className="ws-controls" role="toolbar" aria-label="Call controls">
          <button disabled={!active} aria-pressed={muted} onClick={props.toggleMute}>🎙️<span>{muted ? "Unmute" : "Mute"}</span></button>
          <button disabled={!active} aria-pressed={held} onClick={props.toggleHold}>⏸️<span>{held ? "Unhold" : "Hold"}</span></button>
          <button disabled title="Not simulated in the training">👥<span>Consult</span></button>
          <button disabled={!active} onClick={() => setTransferring(true)}>↪️<span>Transfer</span></button>
          <button className="ws-end" disabled={!active} onClick={props.end}>📵<span>End</span></button>
        </div>
        <div className="ws-messages">
          <div className="ws-conversations-head">
            <p className="ws-card-title">Transcript</p>
            <Button size="small" appearance="subtle" onClick={props.toggleTranscript}>{props.showTranscript ? "Hide Transcript" : "Show Transcript"}</Button>
          </div>
          {props.showTranscript && <Transcript lines={lines} />}
          <p className="admin-muted admin-tight ws-why">Simulated: nobody speaks in the training, so the transcript is a short script and sentiment follows how long the caller waited.</p>
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
        {customer ? (
          <>
            <p className="ws-section">Customer</p>
            <dl className="ws-fields">
              <dt>{customer.kind === "contact" ? "Contact" : "Account"}</dt><dd className="ws-link">{customer.name}</dd>
              {account && <><dt>Company</dt><dd>{String(account.name)}</dd></>}
              <dt>{customer.kind === "contact" ? "Mobile Phone" : "Main Phone"}</dt><dd>{String(customer.kind === "contact" ? customer.row.mobilephone : customer.row.telephone1)}</dd>
              {customer.row.emailaddress1 && <><dt>Email</dt><dd>{String(customer.row.emailaddress1)}</dd></>}
            </dl>
            <p className="ws-section">Timeline</p>
            {history.length ? (
              <ul className="ws-timeline">
                {history.map((h) => <li key={h.activityid}><strong>{hhmm(h.createdon)} · {String(store.find("queue", h._msdyn_cdsqueueid_value)?.name ?? "")} · {STATUS_NAME[Number(h.statuscode)]}</strong>{summaryOf(store, h.activityid) && <span className="admin-muted"> {summaryOf(store, h.activityid)!.split("\n").find((l) => l.startsWith("Issue"))}</span>}</li>)}
              </ul>
            ) : <p className="admin-muted">No earlier conversations.</p>}
          </>
        ) : (
          <Field label="Search customer" hint={found.status === "no number" ? "The number was withheld." : identificationText(found)}><Input disabled placeholder="No customer linked" /></Field>
        )}
        <p className="ws-section">Phone call details</p>
        <dl className="ws-fields">
          <dt>Engagement channel</dt><dd>Voice call</dd>
          <dt>Phone Number</dt><dd>{String(callInfo(store, w.activityid)?.fromnumber || "Withheld")}</dd>
          <dt>Workstream</dt><dd>{String(workstream?.msdyn_name ?? "")}</dd>
          <dt>Queue</dt><dd>{String(queue?.name ?? "")}</dd>
          <dt>Waiting time</dt><dd>{started ? duration(started - Date.parse(w.createdon)) : ""}</dd>
          <dt>Start time</dt><dd>{hhmm(started)}</dd>
        </dl>
        <p className="ws-section">Context from the IVR</p>
        {answers.length
          ? <dl className="ws-fields">{answers.map(([n, v]) => <Fragment key={n}><dt>{n}</dt><dd>{v}</dd></Fragment>)}</dl>
          : <p className="admin-muted">No answers were captured.</p>}
        {props.why && <p className="admin-muted ws-why">Training: why you got this call. {props.why.method}: {props.why.why}</p>}
      </section>

      <section className="ws-card ws-copilot" aria-label="Copilot">
        <p className="ws-card-title">✨ Copilot</p>
        <Button size="small" onClick={() => saveSummary(store, w, now)}>Summarize conversation</Button>
        {shownSummary ? (
          <div className="ws-summary">
            <ul>{shownSummary.split("\n").map((l) => <li key={l}>{l}</li>)}</ul>
            <span className="ws-toolbar">
              <Button size="small" appearance="subtle" onClick={() => void navigator.clipboard?.writeText(shownSummary).catch(() => undefined)}>Copy</Button>
              <Button size="small" appearance="subtle" onClick={() => setClosedFor(String(info?.summarizedon))}>Close</Button>
            </span>
          </div>
        ) : <p className="admin-muted">Copilot also summarizes the call by itself when you transfer or end it.</p>}
        <p className="admin-muted admin-tight ws-why">Simulated: the training writes the summary from the call's data, in Copilot's structured format. In the product Copilot writes it from the transcript.</p>
      </section>

      {transferring && (
        <TargetDialog store={store} title="Transfer" w={w} me={props.me}
          intro="Transfer the call to a representative or a queue. Copilot summarizes the call for whoever gets it."
          close={() => setTransferring(false)} done={(t) => { setTransferring(false); props.transfer(t); }} />
      )}
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
