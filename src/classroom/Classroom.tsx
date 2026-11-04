// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Scenario, KIND_TITLES } from "../scenarios/scenario";
import { classLink, classProgress, createClass, getClass, Progress, trainerLink } from "./client";
import { Membership, setMembership } from "./identity";

// Classes (manual 10, decision 15.5): learners join with a code and a display name; a trainer creates a
// class with a few exercises and follows each learner's progress per check.

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
  const [error, setError] = useState("");
  const create = async () => {
    setError("");
    try {
      const c = await createClass(name.trim(), [...picked]);
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
          <p className="interview-label">Exercises for the class</p>
          <div className="trainer-pick">
            {all.map((s) => (
              <Checkbox key={s.id} label={`${KIND_TITLES[s.kind]} · level ${s.level} · ${s.title}`} checked={picked.has(s.id)}
                onChange={(_, d) => setPicked((p) => { const n = new Set(p); if (d.checked) n.add(s.id); else n.delete(s.id); return n; })} />
            ))}
          </div>
          {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          <div className="lesson-actions"><Button appearance="primary" disabled={!name.trim() || !picked.size} onClick={() => void create()}>Create the class</Button></div>
        </div>
      ) : <ClassProgress code={cls.code} trainerKey={cls.key} all={all} />}
    </div>
  );
}

function ClassProgress({ code, trainerKey, all }: { code: string; trainerKey: string; all: Scenario[] }) {
  const [data, setData] = useState<{ class: { name: string; scenarios: string[] }; progress: Progress[] } | undefined>();
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    const load = () => classProgress(code, trainerKey).then((d) => { if (!stop) { setData(d); setError(""); } }).catch((e) => { if (!stop) setError(e instanceof Error ? e.message : String(e)); });
    void load();
    const timer = setInterval(load, 10_000);
    return () => { stop = true; clearInterval(timer); };
  }, [code, trainerKey]);
  const learners = [...new Map((data?.progress ?? []).map((p) => [p.learnerId, p.name])).entries()];
  const cell = (learner: string, scenario: string) => data?.progress.find((p) => p.learnerId === learner && p.scenarioId === scenario);
  const title = (id: string) => all.find((s) => s.id === id)?.title ?? id;
  return (
    <div className="trainer-body">
      <p><strong>{data?.class.name ?? "…"}</strong> · class code <span className="trainer-code">{code}</span></p>
      <p className="admin-muted">Learners join with the code, or this link: <code>{classLink(code)}</code></p>
      <p className="admin-muted">Your own link, to come back to this page (keep it to yourself): <code>{trainerLink(code, trainerKey)}</code></p>
      {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
      {!learners.length ? <p className="admin-muted">Nobody has started yet. Progress shows here as learners work, and updates every 10 seconds.</p> : (
        <table className="trainer-table">
          <thead><tr><th>Learner</th>{data!.class.scenarios.map((s) => <th key={s}>{title(s)}</th>)}</tr></thead>
          <tbody>
            {learners.map(([id, name]) => (
              <tr key={id}>
                <td>{name}</td>
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
