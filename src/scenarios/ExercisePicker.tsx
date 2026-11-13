// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from "@fluentui/react-components";
import { aiScenarios, AiStatus, aiStatus, writeAiScenario } from "./client";
import { KIND_TITLES, LEVELS, Scenario, ScenarioKind } from "./scenario";
import readyMade from "../../content/scenarios/ready-made.json";
import { classId, doDone, LABS, labById, labStatuses, LabStatus, learnDone } from "../labs/labs";
import { readyAfter, subjectsOf } from "../labs/practice";

// Choosing what to do: a lab, in the recommended order (src/labs), or practice: the guided lesson, a
// ready-made scenario, or one the AI wrote (and the training checked). With the AI switched on, "Write a
// new one" asks for a fresh scenario of that kind and level.

export const READY_MADE = readyMade.scenarios as Scenario[];

const LEVEL_NAMES: Record<number, string> = {
  1: "One number, one workstream, one queue",
  2: "Routing rules and IVR choices",
  3: "Operating hours and overflow",
  4: "Assignment methods and capacity",
  5: "A whole new line"
};

const STATUS_LABEL: Record<LabStatus, string> = { done: "Done", started: "Started", next: "Recommended next", open: "", planned: "Coming soon" };

export function ExercisePicker({ open, current, onClose, onLesson, onScenario, onLab, classInfo, finishedIds, onTrainer }: {
  onLab(id: string): void;
  open: boolean;
  current?: string;
  onClose(): void;
  onLesson(): void;
  onScenario(s: Scenario): void;
  // The class the learner joined: its exercises come first (phase 8).
  classInfo?: { name: string; scenarios: string[] };
  finishedIds: string[];
  onTrainer(): void;
}) {
  const [status, setStatus] = useState<AiStatus | undefined>();
  const [written, setWritten] = useState<Scenario[]>([]);
  const [writing, setWriting] = useState<string | undefined>();
  const [error, setError] = useState("");
  // Practice by lab (which exercises suit after which lab) or by kind and level; remembered in this browser.
  const [practiceBy, setPracticeBy] = useState<"lab" | "kind">(() => { try { return localStorage.getItem("practice-by") === "kind" ? "kind" : "lab"; } catch { return "lab"; } });
  const showBy = (v: "lab" | "kind") => { setPracticeBy(v); try { localStorage.setItem("practice-by", v); } catch { /* not remembered */ } };

  useEffect(() => {
    if (!open) return;
    void aiStatus().then(setStatus);
    void aiScenarios().then(setWritten);
  }, [open]);

  const write = async (kind: ScenarioKind, level: number) => {
    setWriting(`${kind}-${level}`);
    setError("");
    try {
      const s = await writeAiScenario(kind, level);
      setWritten((w) => [s, ...w]);
      onScenario(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWriting(undefined);
      void aiStatus().then(setStatus);
    }
  };

  const labDone = (n: number) => { const l = LABS.find((x) => x.number === n); return !!l && learnDone(l, finishedIds) && doDone(l, finishedIds); };
  const item = (s: Scenario, byLab = false) => (
    <button key={s.id} className={`picker-item${s.id === current ? " current" : ""}`} onClick={() => onScenario(s)} title={`Covers: ${subjectsOf(s)}`}>
      <span>{finishedIds.includes(s.id) ? "✓ " : ""}{s.title}{byLab && <span className="picker-item-sub">{KIND_TITLES[s.kind]} · level {s.level} · covers {subjectsOf(s)}</span>}</span>
      {s.source === "ai" ? <em>AI · {s.createdOn}</em> : finishedIds.includes(s.id) ? <em>done</em> : !byLab ? <em>after lab {readyAfter(s)}</em> : null}
    </button>
  );
  const everything = [...READY_MADE, ...written];
  const ofClass = (classInfo?.scenarios ?? []).map((id) => everything.find((s) => s.id === id)).filter(Boolean) as Scenario[];
  const classLabs = (classInfo?.scenarios ?? []).map((id) => LABS.find((l) => classId(l) === id)).filter(Boolean);
  const statuses = labStatuses(finishedIds);
  const labItem = (id: string) => {
    const lab = labById(id)!;
    const status = statuses.get(id)!;
    return (
      <button key={id} className={`picker-item picker-lab picker-lab-${status}${classId(lab) === current ? " current" : ""}`} disabled={status === "planned"} onClick={() => onLab(id)}>
        <span className="picker-lab-number" aria-hidden="true">{status === "done" ? "✓" : lab.number}</span>
        <span className="picker-lab-text"><strong>Lab {lab.number}: {lab.title}</strong><span>{lab.summary}</span></span>
        {STATUS_LABEL[status] && <em>{STATUS_LABEL[status]}</em>}
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open && !writing) onClose(); }}>
      <DialogSurface className="picker">
        <DialogBody>
          <DialogTitle>Labs and practice</DialogTitle>
          <DialogContent>
            {classInfo && (
              <section className="picker-kind picker-class">
                <h3>Your class: {classInfo.name}</h3>
                {classLabs.map((l) => labItem(l!.id))}
                {ofClass.length || classLabs.length ? ofClass.map((s) => <div key={s.id}>{item(s)}<span className="picker-level-name">{KIND_TITLES[s.kind]} · level {s.level}</span></div>) : <p className="admin-muted">Loading the class's exercises…</p>}
              </section>
            )}
            <section className="picker-kind">
              <h3>Labs</h3>
              <p className="admin-muted admin-tight">One subject per lab, in the recommended order: learn, do it yourself, then a challenge. You can open any lab that's ready.</p>
              {LABS.map((l) => labItem(l.id))}
            </section>
            <h2 className="picker-practice">Practice</h2>
            <p className="admin-muted admin-tight">Exercises without steps. Each is placed after the last lab it needs; it suits you once you've done that lab.</p>
            <div className="picker-toggle" role="group" aria-label="Show practice">
              <button className={practiceBy === "lab" ? "active" : ""} aria-pressed={practiceBy === "lab"} onClick={() => showBy("lab")}>By lab</button>
              <button className={practiceBy === "kind" ? "active" : ""} aria-pressed={practiceBy === "kind"} onClick={() => showBy("kind")}>By kind</button>
            </div>
            {practiceBy === "lab" && LABS.map((lab) => {
              const list = everything.filter((s) => readyAfter(s) === lab.number);
              const lesson = lab.id === "routing";
              if (!list.length && !lesson) return null;
              const done = labDone(lab.number);
              return (
                <section key={lab.id} className={`picker-kind picker-after${done ? " picker-after-done" : ""}`}>
                  <h3>After lab {lab.number}: {lab.title}</h3>
                  <p className="picker-level-name">{done ? "✓ You've done this lab: these suit you now." : `Best after you've done lab ${lab.number}.`}</p>
                  {lesson && <button className={`picker-item${current === "lesson" ? " current" : ""}`} onClick={onLesson}><span>A new menu choice<span className="picker-item-sub">Guided lesson, step by step · the same as lab 7's hands-on part</span></span></button>}
                  {list.map((s) => item(s, true))}
                </section>
              );
            })}
            {practiceBy === "lab" && <p className="admin-muted picker-ai">To have the AI write a new exercise, switch to By kind.</p>}
            {practiceBy === "kind" && <>
            <section className="picker-kind">
              <h3>Guided lesson</h3>
              <button className={`picker-item${current === "lesson" ? " current" : ""}`} onClick={onLesson}><span>A new menu choice</span><em>step by step, with tasks</em></button>
            </section>
            {(Object.keys(LEVELS) as ScenarioKind[]).map((kind) => (
              <section key={kind} className="picker-kind">
                <h3>{KIND_TITLES[kind]}</h3>
                {LEVELS[kind].map((level) => {
                  const list = [...READY_MADE, ...written].filter((s) => s.kind === kind && s.level === level);
                  return (
                    <div key={level} className="picker-level">
                      <p className="picker-level-name">Level {level} · {LEVEL_NAMES[level]}</p>
                      {list.map((s) => item(s))}
                      {status?.available && (
                        <Button size="small" appearance="subtle" disabled={!!writing} onClick={() => void write(kind, level)}>
                          {writing === `${kind}-${level}` ? <><Spinner size="extra-tiny" /> The AI is writing, the training is checking…</> : "Write a new one with AI"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
            </>}
            {error && <p className="lesson-problem">{error}</p>}
            <p className="admin-muted picker-ai">
              {status?.available
                ? `AI: ${status.provider}. ${status.usedToday} of ${status.dailyLimit} requests used today. Every AI scenario is checked by the training before you see it.`
                : status
                  ? `AI is switched off: ${status.off ?? "the backend has no API key"}. The ready-made scenarios work without it.`
                  : "The training's backend isn't running, so there are no AI scenarios. The ready-made ones work without it."}
            </p>
          </DialogContent>
          <DialogActions>
            <Button appearance="subtle" disabled={!!writing} onClick={onTrainer}>For trainers</Button>
            <Button disabled={!!writing} onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
