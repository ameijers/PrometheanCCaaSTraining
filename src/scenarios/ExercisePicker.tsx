// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from "@fluentui/react-components";
import { aiScenarios, AiStatus, aiStatus, writeAiScenario } from "./client";
import { KIND_TITLES, LEVELS, Scenario, ScenarioKind } from "./scenario";
import readyMade from "../../content/scenarios/ready-made.json";

// Choosing what to do: the guided lesson, a ready-made scenario, or one the AI wrote (and the training
// checked). With the AI switched on, "Write a new one" asks for a fresh scenario of that kind and level.

export const READY_MADE = readyMade.scenarios as Scenario[];

const LEVEL_NAMES: Record<number, string> = {
  1: "One number, one workstream, one queue",
  2: "Routing rules and IVR choices",
  3: "Operating hours and overflow",
  4: "Assignment methods and capacity",
  5: "A whole new line"
};

export function ExercisePicker({ open, current, onClose, onLesson, onScenario, classInfo, finishedIds, onTrainer }: {
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

  const item = (s: Scenario) => (
    <button key={s.id} className={`picker-item${s.id === current ? " current" : ""}`} onClick={() => onScenario(s)}>
      <span>{finishedIds.includes(s.id) ? "✓ " : ""}{s.title}</span>{s.source === "ai" ? <em>AI · {s.createdOn}</em> : finishedIds.includes(s.id) ? <em>done</em> : null}
    </button>
  );
  const everything = [...READY_MADE, ...written];
  const ofClass = (classInfo?.scenarios ?? []).map((id) => everything.find((s) => s.id === id)).filter(Boolean) as Scenario[];

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open && !writing) onClose(); }}>
      <DialogSurface className="picker">
        <DialogBody>
          <DialogTitle>Choose an exercise</DialogTitle>
          <DialogContent>
            {classInfo && (
              <section className="picker-kind picker-class">
                <h3>Your class: {classInfo.name}</h3>
                {ofClass.length ? ofClass.map((s) => <div key={s.id}>{item(s)}<span className="picker-level-name">{KIND_TITLES[s.kind]} · level {s.level}</span></div>) : <p className="admin-muted">Loading the class's exercises…</p>}
              </section>
            )}
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
                      {list.map(item)}
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
            <Button appearance="subtle" disabled={!!writing} onClick={onTrainer}>For trainers: create a class</Button>
            <Button disabled={!!writing} onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
