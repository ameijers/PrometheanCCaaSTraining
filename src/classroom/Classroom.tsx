// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Scenario, KIND_TITLES } from "../scenarios/scenario";
import { classId, LABS } from "../labs/labs";
import { Activity, Legend, ProgressCell } from "./ProgressCell";
import { LearnerView } from "./LearnerView";
import { ClassOverview } from "./ClassOverview";
import { claimClass, classLink, classProgress, ClassSummary, ClassView, createClass, createMyClass, deleteClass, joinClass, Member, rejoinClass, myClasses, Progress, readTrainerLink, removeLearner, trainerConfig, trainerLink, updateClass } from "./client";
import { Me, me, signIn, signOut } from "./account";
import { markFinished, Membership, setLearnerId, setMembership } from "./identity";

// Classes (manual 10, decision 15.5): learners join with a code and a display name; a trainer creates a
// class with a few exercises, follows each learner's progress per check, and manages the class: an end date,
// closing or reopening it, removing a learner, deleting it.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const today = () => new Date().toISOString().slice(0, 10);

export function JoinDialog({ initialCode, onJoined, onClose }: { initialCode?: string; onJoined(m: Membership, scenarios: string[], rejoined: boolean): void; onClose(): void }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [name, setName] = useState("");
  // First time in this class, or joined before (in another browser): asked first, nothing chosen for them,
  // so nobody joins a second time as a new learner by accident.
  const [mode, setMode] = useState<"new" | "before" | undefined>();
  const before = mode === "before";
  const [personal, setPersonal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      const c = before ? await rejoinClass(code, personal) : await joinClass(code, name.trim());
      // Rejoining: this browser becomes that learner, with what they finished.
      if (before) setLearnerId(c.you.learnerId);
      markFinished(...c.you.done);
      const m = { code: c.code, className: c.name, name: c.you.name, rejoinCode: c.you.rejoinCode };
      setMembership(m);
      onJoined(m, c.scenarios, before);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const ready = !!mode && code.trim().length === 6 && (before ? personal.trim().length === 6 : !!name.trim());
  const choose = (m: "new" | "before") => { setMode(m); setError(""); };
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Join a class</DialogTitle>
          <DialogContent>
            <div className="admin-form">
              <p className="join-ask">Have you joined this class before?</p>
              <div className="join-choices" role="radiogroup" aria-label="Have you joined this class before?">
                <button type="button" role="radio" aria-checked={mode === "new"} className={`join-choice${mode === "new" ? " join-chosen" : ""}`} onClick={() => choose("new")}>
                  <strong>No, this is my first time</strong>
                  <span>You get a personal code to keep.</span>
                </button>
                <button type="button" role="radio" aria-checked={mode === "before"} className={`join-choice${mode === "before" ? " join-chosen" : ""}`} onClick={() => choose("before")}>
                  <strong>Yes, I joined before</strong>
                  <span>In another browser or on another computer. You need your personal code; your work comes with you.</span>
                </button>
              </div>
              {mode && <>
                <Field label="Class code" hint="Your trainer gives you this: six letters and digits."><Input value={code} onChange={(_, v) => setCode(v.value.toUpperCase())} maxLength={6} /></Field>
                {before
                  ? <Field label="Your personal code" hint="You got it when you joined. It's under Class at the top of the browser you joined with, and your trainer can see it.">
                      <Input value={personal} onChange={(_, v) => setPersonal(v.value.toUpperCase())} maxLength={6} />
                    </Field>
                  : <Field label="Your name" hint="What your trainer sees next to your progress. A first name is enough."><Input value={name} onChange={(_, v) => setName(v.value)} maxLength={40} /></Field>}
                {before
                  ? <p className="admin-muted">Lost your personal code? Ask your trainer: they see it next to your name.</p>
                  : <p className="admin-muted">The training keeps only your name, a random id and your work on the class's exercises. No account, no email.</p>}
              </>}
            </div>
            {error && <MessageBar intent="error"><MessageBarBody>{error}
              {!before && /already in this class/.test(error) && <> <Button size="small" onClick={() => choose("before")}>That's me: use my personal code</Button></>}
            </MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={busy || !ready} onClick={() => void join()}>{before ? "Carry on" : "Join"}</Button>
            <Button onClick={onClose}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// The class the learner is in: their personal code, and leaving.
// Right after joining: the personal code, big, with a copy button, before anything else opens. It's what
// brings the learner back to their work in another browser.
export function PersonalCodeDialog({ member, onDone }: { member: Membership; onDone(): void }) {
  const [copied, setCopied] = useState(false);
  const code = member.rejoinCode ?? "";
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onDone(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>You're in {member.className}</DialogTitle>
          <DialogContent>
            <p>Keep your <strong>personal code</strong> somewhere safe. With the class code and this code you carry on in another browser or on another computer, with your work.</p>
            <p className="code-big" aria-label={`Your personal code ${code.split("").join(" ")}`}>{code}</p>
            <p className="admin-muted">Class code {member.code} · as {member.name}. You'll also find it under Class at the top.</p>
            {copied && <MessageBar intent="success"><MessageBarBody>Copied.</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => undefined)}>Copy</Button>
            <Button appearance="primary" onClick={onDone}>Carry on</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function ClassDialog({ member, onLeave, onClose }: { member: Membership; onLeave(): void; onClose(): void }) {
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{member.className}</DialogTitle>
          <DialogContent>
            <p>You're in this class as <strong>{member.name}</strong>, class code <span className="trainer-code">{member.code}</span>.</p>
            {member.rejoinCode
              ? <p>Your personal code: <span className="trainer-code" aria-label={`Your personal code ${member.rejoinCode.split("").join(" ")}`}>{member.rejoinCode}</span></p>
              : <p className="admin-muted">Your personal code shows here once the class is reached.</p>}
            <p className="admin-muted">To carry on in another browser or on another computer: Join a class, choose "Yes, I joined before", and enter the class code and your personal code. Your work on the class's exercises comes with you.</p>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { if (window.confirm(`Leave the class ${member.className}? Your work here stays. To come back, you need your personal code.`)) onLeave(); }}>Leave the class</Button>
            <Button appearance="primary" onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// The trainer's pages. A signed-in trainer gets their classes: create one, open one, add one made with a
// trainer link. Without signing in, a class can still be created and followed with its trainer link
// (?trainer=CODE&key=KEY).
export type TrainerOpen = "home" | { code: string; key?: string };

export function TrainerView({ all, initial, onClose, onViewWork }: {
  all: Scenario[]; initial: TrainerOpen; onClose(): void;
  // Look at a learner's saved work in the training itself (read-only); back reopens this class.
  onViewWork?(who: string, what: string, data: string, back: TrainerOpen): void;
}) {
  const [who, setWho] = useState<Me | undefined>();
  // The class on screen: with its key (a trainer link), or the signed-in trainer's own (no key).
  const [open, setOpen] = useState<{ code: string; key?: string } | undefined>(initial === "home" ? undefined : initial);
  const [creating, setCreating] = useState(false);
  useEffect(() => { void me().then(setWho); }, []);
  const title = open ? "Your class" : creating ? "Create a class" : who?.trainer ? "Your classes" : "For trainers";
  const back = who?.trainer && (open || creating) ? () => { setOpen(undefined); setCreating(false); } : undefined;
  return (
    <div className="trainer" role="dialog" aria-label="Trainer">
      <div className="trainer-head">
        <h1 className="lesson-title">{title}</h1>
        <div className="trainer-head-actions">
          {who?.signedIn && <span className="admin-muted">Signed in as {who.name}</span>}
          {back && <Button onClick={back}>All your classes</Button>}
          {who?.signedIn && <Button onClick={signOut}>Sign out</Button>}
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
      {!who ? <div className="trainer-body"><p className="admin-muted">Loading…</p></div>
        : open ? <ClassProgress code={open.code} trainerKey={open.key} all={all} canClaim={who.trainer && !!open.key}
            onViewWork={onViewWork && ((name, what, data) => onViewWork(name, what, data, { code: open.code, key: open.key }))}
            onClaimed={() => setOpen({ code: open.code })} onDeleted={() => setOpen(undefined)} />
        : creating ? <CreateClass all={all} owned={who.trainer} onCreated={(c) => { setCreating(false); setOpen(c); }} />
        : who.trainer ? <TrainerHome onOpen={(code) => setOpen({ code })} onCreate={() => setCreating(true)} />
        : <SignInPanel who={who} onCreate={() => setCreating(true)} />}
    </div>
  );
}

function SignInPanel({ who, onCreate }: { who: Me; onCreate(): void }) {
  return (
    <div className="trainer-body">
      {who.signedIn
        ? who.admin
          ? <MessageBar intent="info"><MessageBarBody>You're signed in as {who.name}, as an admin: the Feedback inbox is at the top. To run classes you also need the trainer role; whoever runs the training can add it in Role management.</MessageBarBody></MessageBar>
          : <MessageBar intent="warning"><MessageBarBody>You're signed in as {who.name}, but not as a trainer. Ask whoever runs the training for a trainer invitation, open the link in it, then sign in again.</MessageBarBody></MessageBar>
        : <>
            <p>Sign in to see all your classes in one place: create classes, follow your learners' progress, and manage each class.</p>
            <div className="lesson-actions"><Button appearance="primary" onClick={signIn}>Sign in with a Microsoft account</Button></div>
            <p className="admin-muted">Trainers are invited by whoever runs the training. Learners don't sign in: they join a class with its code.</p>
          </>}
      <h2 className="trainer-sub">Without signing in</h2>
      <p className="admin-muted">You can still create a class and come back to it with its trainer link. Keep that link safe: it's the only way back to the class. Once you're a trainer, you can add the class to your list with that link.</p>
      <Button onClick={onCreate}>Create a class with a trainer link</Button>
    </div>
  );
}

function TrainerHome({ onOpen, onCreate }: { onOpen(code: string): void; onCreate(): void }) {
  const [list, setList] = useState<ClassSummary[] | undefined>();
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => myClasses().then((d) => { setList(d.classes); setError(""); }).catch((e) => setError(message(e)));
  useEffect(() => { void load(); }, []);
  const add = async () => {
    const parsed = readTrainerLink(link);
    if (!parsed) { setError("That isn't a trainer link. It looks like …?trainer=ABC123&key=…"); return; }
    setBusy(true);
    try { await claimClass(parsed.code, parsed.key); setLink(""); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  // Deleting classes from the list: one with its row's button, or several ticked at once.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (code: string) => setPicked((p) => { const n = new Set(p); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const remove = async (codes: string[]) => {
    const names = (list ?? []).filter((c) => codes.includes(c.code)).map((c) => c.name);
    const what = codes.length === 1 ? `the class ${names[0] ?? codes[0]}` : `these ${codes.length} classes: ${names.join(", ")}`;
    if (!window.confirm(`Delete ${what}? Their codes stop working, and everyone's progress in them is deleted. This can't be undone.`)) return;
    setBusy(true);
    const failed: string[] = [];
    for (const code of codes) { try { await deleteClass(code, undefined); } catch (e) { failed.push(`${code}: ${message(e)}`); } }
    setPicked(new Set());
    await load();
    if (failed.length) setError(`Not deleted: ${failed.join("; ")}`);
    setBusy(false);
  };
  const status = (c: ClassSummary) => c.closed ? "Closed" : !c.open ? `Ended ${c.openUntil}` : c.openUntil ? `Open until ${c.openUntil}` : "Open";
  return (
    <div className="trainer-body">
      <div className="lesson-actions">
        <Button appearance="primary" onClick={onCreate}>Create a class</Button>
        {picked.size > 0 && <Button className="trainer-delete" disabled={busy} onClick={() => void remove([...picked])}>Delete the selected classes ({picked.size})</Button>}
      </div>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      {!list ? <p className="admin-muted">Loading your classes…</p>
        : !list.length ? <p className="admin-muted">You have no classes yet. Create one, or add one you made earlier with its trainer link.</p>
        : (
          <table className="trainer-table trainer-list">
            <thead><tr><th><Checkbox aria-label="Select all classes" checked={picked.size === list.length ? true : picked.size ? "mixed" : false} onChange={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((c) => c.code)))} /></th><th>Class</th><th>Code</th><th>Status</th><th>Exercises</th><th>Learners</th><th>Created</th><th /></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.code}>
                  <td><Checkbox aria-label={`Select ${c.name}`} checked={picked.has(c.code)} onChange={() => toggle(c.code)} /></td>
                  <td><strong>{c.name}</strong></td>
                  <td><span className="trainer-code">{c.code}</span></td>
                  <td className={c.open ? "" : "trainer-status-off"}>{status(c)}</td>
                  <td>{c.scenarios.length}</td>
                  <td>{c.learners}</td>
                  <td>{c.createdOn.slice(0, 10)}</td>
                  <td><Button size="small" onClick={() => onOpen(c.code)} aria-label={`Open ${c.name}`}>Open</Button> <Button size="small" className="trainer-delete" disabled={busy} onClick={() => void remove([c.code])} aria-label={`Delete ${c.name}`}>Delete</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <h2 className="trainer-sub">Add a class you made with a trainer link</h2>
      <div className="trainer-manage-row">
        <Field label="Trainer link" className="trainer-link-field"><Input value={link} onChange={(_, v) => setLink(v.value)} placeholder="https://…?trainer=ABC123&key=…" /></Field>
        <Button disabled={busy || !link.trim()} onClick={() => void add()}>Add to your classes</Button>
      </div>
    </div>
  );
}

function CreateClass({ all, owned, onCreated }: { all: Scenario[]; owned: boolean; onCreated(c: { code: string; key?: string }): void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openUntil, setOpenUntil] = useState("");
  const [passcode, setPasscode] = useState("");
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!owned) trainerConfig().then((c) => setNeedsPasscode(c.passcodeRequired)).catch(() => undefined); }, [owned]);
  const create = async () => {
    setError("");
    try {
      if (owned) {
        const c = await createMyClass(name.trim(), [...picked], openUntil || undefined);
        onCreated({ code: c.code });
      } else {
        const c = await createClass(name.trim(), [...picked], { ...(openUntil ? { openUntil } : {}), ...(needsPasscode ? { passcode } : {}) });
        onCreated({ code: c.code, key: c.trainerKey });
      }
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <div className="trainer-body">
      <Field label="Class name"><Input value={name} onChange={(_, v) => setName(v.value)} maxLength={60} placeholder="For example: Contoso onboarding, November" /></Field>
      <Field label="Last day (optional)" hint="After this day learners can't join or send progress. You still see the class, and can change the date.">
        <Input type="date" value={openUntil} min={today()} onChange={(_, v) => setOpenUntil(v.value)} />
      </Field>
      {needsPasscode && (
        <Field label="Trainer passcode" required hint="Whoever runs this training gives trainers this passcode.">
          <Input type="password" value={passcode} onChange={(_, v) => setPasscode(v.value)} />
        </Field>
      )}
      <p className="interview-label">Labs and exercises for the class</p>
      <div className="trainer-pick">
        {LABS.filter((l) => l.status === "ready").map((l) => (
          <Checkbox key={l.id} label={`Lab ${l.number} · ${l.title}`} checked={picked.has(classId(l))}
            onChange={(_, d) => setPicked((p) => { const n = new Set(p); if (d.checked) n.add(classId(l)); else n.delete(classId(l)); return n; })} />
        ))}
        {all.map((s) => (
          <Checkbox key={s.id} label={`${KIND_TITLES[s.kind]} · level ${s.level} · ${s.title}`} checked={picked.has(s.id)}
            onChange={(_, d) => setPicked((p) => { const n = new Set(p); if (d.checked) n.add(s.id); else n.delete(s.id); return n; })} />
        ))}
      </div>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      <div className="lesson-actions"><Button appearance="primary" disabled={!name.trim() || !picked.size || (needsPasscode && !passcode)} onClick={() => void create()}>Create the class</Button></div>
    </div>
  );
}

// One class: its progress and its settings. With trainerKey, through the trainer link; without, as its owner.
function ClassProgress({ code, trainerKey, all, canClaim, onClaimed, onDeleted, onViewWork }: {
  code: string; trainerKey?: string; all: Scenario[]; canClaim: boolean; onClaimed(): void; onDeleted(): void;
  onViewWork?(name: string, what: string, data: string): void;
}) {
  // One learner's page, at one lab or exercise.
  const [learner, setLearner] = useState<{ id: string; focus?: string }>();
  const [data, setData] = useState<{ class: ClassView; members?: Member[]; progress: Progress[] } | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [endDraft, setEndDraft] = useState<string | undefined>();
  const load = () => classProgress(code, trainerKey).then((d) => { setData(d); setError(""); }).catch((e) => setError(message(e)));
  useEffect(() => {
    let stop = false;
    const tick = () => classProgress(code, trainerKey).then((d) => { if (!stop) { setData(d); setError(""); } }).catch((e) => { if (!stop) setError(message(e)); });
    void tick();
    const timer = setInterval(tick, 10_000);
    return () => { stop = true; clearInterval(timer); };
  }, [code, trainerKey]);
  // Each change, then the page again.
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try { await run(); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const remove = (id: string, name: string) => {
    if (window.confirm(`Remove ${name} from the class? Their progress is deleted, and they can't send progress to this class again.`)) void act(() => removeLearner(code, trainerKey, id));
  };
  const destroy = async () => {
    if (!window.confirm(`Delete the class ${data?.class.name ?? code}? Its code stops working, and everyone's progress in it is deleted. This can't be undone.`)) return;
    setBusy(true);
    try { await deleteClass(code, trainerKey); onDeleted(); } catch (e) { setError(message(e)); setBusy(false); }
  };
  const c = data?.class;
  // The time the page last read the class, for "5 min ago" and "may be stuck".
  const now = Date.now();
  const status = !c ? "" : c.closed ? "Closed: learners can't join or send progress." : !c.open ? `Ended on ${c.openUntil}: learners can't join or send progress.` : c.openUntil ? `Open until the end of ${c.openUntil}.` : "Open, with no last day.";
  const end = endDraft ?? c?.openUntil ?? "";
  // Everyone who joined, and anyone who sent progress before joining was recorded.
  const learners = [...new Map([...(data?.members ?? []), ...(data?.progress ?? [])].map((p) => [p.learnerId, p.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const personal = (id: string) => data?.members?.find((m) => m.learnerId === id)?.rejoinCode;
  const cell = (learner: string, scenario: string) => data?.progress.find((p) => p.learnerId === learner && p.scenarioId === scenario);
  const title = (id: string) => all.find((s) => s.id === id)?.title ?? LABS.filter((l) => classId(l) === id).map((l) => `Lab ${l.number}: ${l.title}`)[0] ?? id;
  const shown = learner && learners.find(([id]) => id === learner.id);
  if (shown && data) {
    return (
      <div className="trainer-body">
        <LearnerView code={code} trainerKey={trainerKey} learnerId={shown[0]} name={shown[1]} progress={data.progress} focus={learner!.focus}
          items={data.class.scenarios.map((id) => ({ id, title: title(id) }))} onBack={() => setLearner(undefined)}
          onViewWork={(what, work) => onViewWork?.(shown[1], what, work)} />
      </div>
    );
  }
  return (
    <div className="trainer-body">
      <p><strong>{data?.class.name ?? "…"}</strong> · class code <span className="trainer-code">{code}</span></p>
      <p className="admin-muted">Learners join with the code, or this link: <code>{classLink(code)}</code></p>
      {trainerKey
        ? <p className="admin-muted">Your own link, to come back to this page (keep it to yourself): <code>{trainerLink(code, trainerKey)}</code></p>
        : <p className="admin-muted">This class is in your list: sign in to come back to it.</p>}
      {canClaim && trainerKey && <div className="lesson-actions"><Button disabled={busy} onClick={() => void act(async () => { await claimClass(code, trainerKey); onClaimed(); })}>Add to your classes</Button></div>}
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      {!learners.length ? <p className="admin-muted">Nobody has joined yet. Learners show here when they join, and their progress as they work. The page updates every 10 seconds.</p> : (
        <>
        <ClassOverview now={now} learners={learners.length} progress={data!.progress}
          items={data!.class.scenarios.map((id) => ({ id, title: title(id), lab: id.startsWith("lab-") }))} />
        <h3 className="tp-heading">Each learner</h3>
        <Legend />
        <div className="tp-wrap">
        <table className="trainer-table tp-table">
          <thead><tr><th>Learner</th>{data!.class.scenarios.map((s) => <th key={s}>{title(s)}</th>)}</tr></thead>
          <tbody>
            {learners.map(([id, name]) => (
              <tr key={id}>
                <td className="tp-learner">
                  <button className="tp-name" onClick={() => setLearner({ id })}>{name}</button>{personal(id) && <span className="admin-muted tp-code" title="Their personal code, to carry on in another browser">Personal code {personal(id)}</span>}
                  <Activity updates={(data?.progress ?? []).filter((p) => p.learnerId === id).map((p) => p.updatedOn)} now={now} />
                  <Button size="small" appearance="subtle" disabled={busy} aria-label={`Remove ${name}`} onClick={() => remove(id, name)}>Remove</Button>
                </td>
                {data!.class.scenarios.map((s) => <ProgressCell key={s} p={cell(id, s)} now={now} onOpen={() => setLearner({ id, focus: s })} />)}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </>
      )}
      <p className="admin-muted">Select a name or a cell for the learner's page: their timeline, answers and tasks, and their environment. Hints are noted, not counted against anyone. The page updates every 10 seconds.</p>
      {c && (
        <section className="trainer-manage" aria-label="Manage the class">
          <h3 className="tp-heading">The class</h3>
          <p className={c.open ? "trainer-status" : "trainer-status trainer-status-off"}><strong>{status}</strong></p>
          <div className="trainer-manage-row">
            <Field label="Last day">
              <Input type="date" value={end} onChange={(_, v) => setEndDraft(v.value)} />
            </Field>
            <Button disabled={busy || end === (c.openUntil ?? "")} onClick={() => void act(async () => { await updateClass(code, trainerKey, { openUntil: end }); setEndDraft(undefined); })}>{end ? "Save the last day" : "Remove the last day"}</Button>
            {c.closed
              ? <Button disabled={busy} onClick={() => void act(() => updateClass(code, trainerKey, { closed: false }))}>Reopen the class</Button>
              : <Button disabled={busy} onClick={() => void act(() => updateClass(code, trainerKey, { closed: true }))}>Close the class</Button>}
            <Button disabled={busy} className="trainer-delete" onClick={() => void destroy()}>Delete the class</Button>
          </div>
        </section>
      )}
    </div>
  );
}
