// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Scenario, KIND_TITLES } from "../scenarios/scenario";
import { classLink, classProgress, ClassView, createClass, deleteClass, getClass, Progress, removeLearner, trainerConfig, trainerLink, updateClass } from "./client";
import { Membership, setMembership } from "./identity";

// Classes (manual 10, decision 15.5): learners join with a code and a display name; a trainer creates a
// class with a few exercises, follows each learner's progress per check, and manages the class: an end date,
// closing or reopening it, removing a learner, deleting it.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const today = () => new Date().toISOString().slice(0, 10);

export function JoinDialog({ initialCode, onJoined, onClose }: { initialCode?: string; onJoined(m: Membership, scenarios: string[]): void; onClose(): void }) {
  const [code, setCode] = useState(initialCode ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      const c = await getClass(code);
      const m = { code: c.code, className: c.name, name: name.trim() };
      setMembership(m);
      onJoined(m, c.scenarios);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Join a class</DialogTitle>
          <DialogContent>
            <div className="admin-form">
              <Field label="Class code" hint="Your trainer gives you this: six letters and digits."><Input value={code} onChange={(_, v) => setCode(v.value.toUpperCase())} maxLength={6} /></Field>
              <Field label="Your name" hint="What your trainer sees next to your progress. A first name is enough."><Input value={name} onChange={(_, v) => setName(v.value)} maxLength={40} /></Field>
              <p className="admin-muted">The training keeps only this name and a random id from this browser. No account, no email.</p>
            </div>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" disabled={busy || code.trim().length !== 6 || !name.trim()} onClick={() => void join()}>Join</Button>
            <Button onClick={onClose}>Cancel</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// The trainer's page: create a class, then follow it. Opened from the exercise list, or with the
// trainer's link (?trainer=CODE&key=KEY).
export function TrainerView({ all, initial, onClose }: { all: Scenario[]; initial?: { code: string; key: string }; onClose(): void }) {
  const [cls, setCls] = useState<{ code: string; key: string } | undefined>(initial);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openUntil, setOpenUntil] = useState("");
  const [passcode, setPasscode] = useState("");
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!cls) trainerConfig().then((c) => setNeedsPasscode(c.passcodeRequired)).catch(() => undefined); }, [cls]);
  const create = async () => {
    setError("");
    try {
      const c = await createClass(name.trim(), [...picked], { ...(openUntil ? { openUntil } : {}), ...(needsPasscode ? { passcode } : {}) });
      setCls({ code: c.code, key: c.trainerKey });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="trainer" role="dialog" aria-label="Trainer">
      <div className="trainer-head">
        <h1 className="lesson-title">{cls ? "Your class" : "Create a class"}</h1>
        <Button onClick={onClose}>Close</Button>
      </div>
      {!cls ? (
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
          <p className="interview-label">Exercises for the class</p>
          <div className="trainer-pick">
            {all.map((s) => (
              <Checkbox key={s.id} label={`${KIND_TITLES[s.kind]} · level ${s.level} · ${s.title}`} checked={picked.has(s.id)}
                onChange={(_, d) => setPicked((p) => { const n = new Set(p); if (d.checked) n.add(s.id); else n.delete(s.id); return n; })} />
            ))}
          </div>
          {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          <div className="lesson-actions"><Button appearance="primary" disabled={!name.trim() || !picked.size || (needsPasscode && !passcode)} onClick={() => void create()}>Create the class</Button></div>
        </div>
      ) : <ClassProgress code={cls.code} trainerKey={cls.key} all={all} onDeleted={() => setCls(undefined)} />}
    </div>
  );
}

function ClassProgress({ code, trainerKey, all, onDeleted }: { code: string; trainerKey: string; all: Scenario[]; onDeleted(): void }) {
  const [data, setData] = useState<{ class: ClassView; progress: Progress[] } | undefined>();
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
  const status = !c ? "" : c.closed ? "Closed: learners can't join or send progress." : !c.open ? `Ended on ${c.openUntil}: learners can't join or send progress.` : c.openUntil ? `Open until the end of ${c.openUntil}.` : "Open, with no last day.";
  const end = endDraft ?? c?.openUntil ?? "";
  const learners = [...new Map((data?.progress ?? []).map((p) => [p.learnerId, p.name])).entries()];
  const cell = (learner: string, scenario: string) => data?.progress.find((p) => p.learnerId === learner && p.scenarioId === scenario);
  const title = (id: string) => all.find((s) => s.id === id)?.title ?? id;
  return (
    <div className="trainer-body">
      <p><strong>{data?.class.name ?? "…"}</strong> · class code <span className="trainer-code">{code}</span></p>
      <p className="admin-muted">Learners join with the code, or this link: <code>{classLink(code)}</code></p>
      <p className="admin-muted">Your own link, to come back to this page (keep it to yourself): <code>{trainerLink(code, trainerKey)}</code></p>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      {c && (
        <section className="trainer-manage" aria-label="Manage the class">
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
      {!learners.length ? <p className="admin-muted">Nobody has started yet. Progress shows here as learners work, and updates every 10 seconds.</p> : (
        <table className="trainer-table">
          <thead><tr><th>Learner</th>{data!.class.scenarios.map((s) => <th key={s}>{title(s)}</th>)}</tr></thead>
          <tbody>
            {learners.map(([id, name]) => (
              <tr key={id}>
                <td>{name} <Button size="small" appearance="subtle" disabled={busy} aria-label={`Remove ${name}`} onClick={() => remove(id, name)}>Remove</Button></td>
                {data!.class.scenarios.map((s) => {
                  const p = cell(id, s);
                  const passed = p?.checks.filter((c) => c.passed).length ?? 0;
                  return (
                    <td key={s} className={p?.done ? "done" : p ? "busy" : ""} title={p?.checks.map((c) => `${c.passed ? "✓" : "○"} ${c.title}`).join("\n")}>
                      {p ? <>{p.done ? "✓ Done" : `${passed} of ${p.checks.length}`}{p.hints ? <span className="admin-muted"> · {p.hints} hint{p.hints === 1 ? "" : "s"}</span> : null}</> : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="admin-muted">Hover over a cell to see each check. Hints are noted, not counted against anyone.</p>
    </div>
  );
}
