// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Button, Radio, RadioGroup } from "@fluentui/react-components";
import { CallStep } from "../calls/engine";
import { useStoreVersion, useTraining } from "../shell/context";
import { answerKey, answerLabel, callFacts, faultTitle, FixGrade, gradeCall, gradeFix, optionsFor } from "./grade";
import { Answer, KIND_TITLES, Question, Scenario } from "./scenario";
import { describeEnvironment, Environment } from "./world";
import { BuildExercise, Talk } from "./BuildExercise";

// The panel for a scenario (manual 9.1): the story, then the exercise and its grade. Code grades: the
// Toolbox's health checks for "Fix the broken contact center", the call engine for "Where does this call go?".

// The learner's answer to a call: what they picked and what the call engine said. Kept with the session.
export interface CallAnswer { picked: Answer; correct: boolean; actual: Answer; steps: CallStep[] }

// What an exercise reports as the learner works: each check, and whether it's all done (for a class).
export type OnProgress = (checks: { title: string; passed: boolean }[], done: boolean) => void;

export function ScenarioPanel({ scenario, answers, onAnswer, hints, onHint, onGo, found, talk, onTalk, onProgress }: {
  scenario: Scenario;
  answers: Record<string, CallAnswer>;
  onAnswer(id: string, a: CallAnswer): void;
  // How many hints the learner opened, per fault or call: noted, not punished (manual 9.4).
  hints: Record<string, number>;
  onHint(id: string): void;
  onGo(tab: "admin" | "diagram" | "phone"): void;
  found: number[];
  talk: Talk[];
  onTalk(t: Talk, revealed: number[]): void;
  onProgress: OnProgress;
}) {
  const [storyOpen, setStoryOpen] = useState(true);
  return (
    <aside className="lesson">
      <p className="lesson-eyebrow">{KIND_TITLES[scenario.kind]} · Level {scenario.level}{scenario.source === "ai" ? " · written by AI, checked by the training" : ""}</p>
      <h1 className="lesson-title">{scenario.title}</h1>
      <button className="lesson-toggle" onClick={() => setStoryOpen((o) => !o)}>{storyOpen ? "Hide the story" : "Show the story"}</button>
      {storyOpen && <div className="lesson-story">{scenario.story.map((p, i) => <p key={i}>{p}</p>)}</div>}
      {scenario.kind === "fix" ? <FixExercise scenario={scenario} hints={hints} onHint={onHint} onGo={onGo} onProgress={onProgress} />
        : scenario.kind === "route" ? <RouteExercise scenario={scenario} answers={answers} onAnswer={onAnswer} onProgress={onProgress} />
        : <BuildExercise scenario={scenario} hints={hints} onHint={onHint} found={found} talk={talk} onTalk={onTalk} onGo={onGo} onProgress={onProgress} />}
    </aside>
  );
}

function FixExercise({ scenario, hints, onHint, onGo, onProgress }: { scenario: Scenario; hints: Record<string, number>; onHint(id: string): void; onGo(tab: "admin" | "diagram"): void; onProgress: OnProgress }) {
  const { explain } = useTraining();
  const version = useStoreVersion();
  const [grade, setGrade] = useState<FixGrade | undefined>();
  const faults = scenario.faults ?? [];
  useEffect(() => {
    const t = setTimeout(() => void gradeFix(faults).then(setGrade).catch(() => undefined), 150);
    return () => clearTimeout(t);
  }, [version, scenario.id]);
  useEffect(() => {
    if (grade) onProgress([...grade.faults.map((f, i) => ({ title: `Problem ${i + 1} fixed`, passed: f.fixed })), { title: "Nothing new broke", passed: !grade.newProblems.length }], grade.done);
  }, [grade]);
  const fixed = grade?.faults.filter((f) => f.fixed).length ?? 0;
  const used = Object.values(hints).reduce((a, b) => a + b, 0);

  return (
    <>
      <p className="scenario-brief">{faults.length} problem{faults.length === 1 ? " was" : "s were"} planted in this contact center. Find them (the Diagram marks problems), then fix them in the admin center. Each one ticks off when the health checks no longer find it.</p>
      <div className="lesson-actions">
        <Button size="small" appearance="primary" onClick={() => onGo("diagram")}>Open the diagram</Button>
        <Button size="small" onClick={() => onGo("admin")}>Open the admin center</Button>
      </div>
      <div className="lesson-progress scenario-progress" role="progressbar" aria-valuemin={0} aria-valuemax={faults.length} aria-valuenow={fixed} aria-label={`${fixed} of ${faults.length} fixed`}><div style={{ width: `${(100 * fixed) / Math.max(1, faults.length)}%` }} /></div>
      <ol className="lesson-tasks">
        {faults.map((f, i) => {
          const id = `f${i + 1}`;
          const isFixed = !!grade?.faults[i]?.fixed;
          const t = faultTitle(f);
          const shown = hints[id] ?? 0;
          return (
            <li key={id} className={isFixed ? "done" : "current"}>
              <div className="lesson-task-title"><span className="lesson-mark">{isFixed ? "✓" : ""}</span>{isFixed ? "Fixed" : `Problem ${i + 1}: not fixed yet`}</div>
              {isFixed && <p className="lesson-done">{t.found}</p>}
              {!isFixed && (
                <div className="lesson-current">
                  {t.hints.slice(0, shown).map((h, j) => <p key={j} className="lesson-hint">Hint: {h}</p>)}
                  <div className="lesson-actions">
                    {shown < t.hints.length && <Button size="small" onClick={() => onHint(id)}>Hint</Button>}
                    {shown >= 2 && <Button size="small" appearance="subtle" onClick={() => explain(t.concept)}>Explain</Button>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!!grade?.newProblems.length && (
        <div className="lesson-problem">A change made something else stop working: {grade.newProblems.map((p) => p.title).join("; ")}. The Diagram shows where.</div>
      )}
      {grade?.done && (
        <div className="lesson-finished"><strong>All fixed.</strong> {faults.length} of {faults.length} problems fixed, and nothing new broke. {used ? `You used ${used} hint${used === 1 ? "" : "s"}.` : "No hints used."}</div>
      )}
    </>
  );
}

function RouteExercise({ scenario, answers, onAnswer, onProgress }: { scenario: Scenario; answers: Record<string, CallAnswer>; onAnswer(id: string, a: CallAnswer): void; onProgress: OnProgress }) {
  const { sim } = useTraining();
  const [env, setEnv] = useState<Environment | undefined>();
  useEffect(() => { void describeEnvironment(sim.store).then(setEnv); }, [scenario.id]);
  const questions = scenario.questions ?? [];
  const right = questions.filter((q) => answers[q.id]?.correct).length;
  const answered = questions.filter((q) => answers[q.id]).length;
  useEffect(() => {
    if (answered) onProgress(questions.map((q, i) => ({ title: `Call ${i + 1} predicted right`, passed: !!answers[q.id]?.correct })), answered === questions.length);
  }, [answered]);

  return (
    <>
      <p className="scenario-brief">Predict where each call ends. Look around the admin center and the Diagram first if you like. Your first answer counts; after that you see the call step by step.</p>
      <ol className="lesson-tasks">
        {questions.map((q, i) => <CallQuestion key={q.id} n={i + 1} q={q} env={env} answer={answers[q.id]} onAnswer={(a) => onAnswer(q.id, a)} />)}
      </ol>
      {answered === questions.length && (
        <div className="lesson-finished"><strong>{right} of {questions.length} right.</strong> {right === questions.length ? "Every call went where you said." : "Look at the steps of the calls you missed: they show which setting decided."}</div>
      )}
    </>
  );
}

function CallQuestion({ n, q, env, answer, onAnswer }: { n: number; q: Question; env?: Environment; answer?: CallAnswer; onAnswer(a: CallAnswer): void }) {
  const { sim, explain } = useTraining();
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const options = env ? optionsFor(q, env) : [];

  const check = async () => {
    const choice = options.find((o) => answerKey(o) === picked);
    if (!choice) return;
    setBusy(true);
    try {
      const g = await gradeCall(sim.store, q, choice);
      onAnswer({ picked: choice, correct: g.correct, actual: g.actual, steps: g.result.steps });
      explain(g.result.steps.some((s) => s.what === "Overflow") ? (q.at ? "operating-hours" : "overflow") : g.result.steps.some((s) => /fallback queue/.test(s.detail)) ? "fallback-queue" : "route-to-queue");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={answer ? (answer.correct ? "done" : "missed") : "current"}>
      <div className="lesson-task-title"><span className="lesson-mark">{answer ? (answer.correct ? "✓" : "✗") : ""}</span>Call {n}</div>
      <div className="lesson-current">
        <p className="scenario-caller">“{q.caller}”</p>
        <ul className="scenario-facts">{callFacts(q).map((f) => <li key={f}>{f}</li>)}</ul>
        {!answer && (
          <>
            <RadioGroup value={picked} onChange={(_, d) => setPicked(d.value)}>
              {options.map((o) => <Radio key={answerKey(o)} value={answerKey(o)} label={answerLabel(o)} />)}
            </RadioGroup>
            <div className="lesson-actions"><Button size="small" appearance="primary" disabled={!picked || busy} onClick={() => void check()}>Check</Button></div>
          </>
        )}
        {answer && (
          <>
            <p className={answer.correct ? "lesson-done" : "lesson-problem"}>{answer.correct ? `Right. ${answerLabel(answer.actual)}.` : `Your answer: ${answerLabel(answer.picked)}. What happens: ${answerLabel(answer.actual)}.`}</p>
            <details className="scenario-steps" open={!answer.correct}>
              <summary>The call, step by step</summary>
              <ol className="phone-steps">{answer.steps.map((s, j) => <li key={j} className={s.status}><strong>{s.what}</strong> {s.detail}</li>)}</ol>
            </details>
          </>
        )}
      </div>
    </li>
  );
}
