// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Button, Input, Spinner } from "@fluentui/react-components";
import { useStoreVersion, useTraining } from "../shell/context";
import { aiHint, aiInterview, aiStatus } from "./client";
import { checkGoals, GOAL_CONCEPT, GoalCheck, goalHints, requirement } from "./goals";
import { Scenario } from "./scenario";

// "Build to requirements" and "Customer interview" (manual 9.1). Code checks every requirement as the
// learner works; in an interview, the requirements only show once the customer has told them.

export interface Talk { q: string; a: string }

export function BuildExercise({ scenario, hints, onHint, found, talk, onTalk, onGo, onProgress }: {
  scenario: Scenario;
  hints: Record<string, number>;
  onHint(id: string): void;
  // Interview: the goals the customer revealed, and the conversation so far.
  found: number[];
  talk: Talk[];
  onTalk(t: Talk, revealed: number[]): void;
  onGo(tab: "admin" | "diagram" | "phone"): void;
  onProgress(checks: { title: string; passed: boolean }[], done: boolean): void;
}) {
  const { sim, explain } = useTraining();
  const version = useStoreVersion();
  const goals = scenario.goals ?? [];
  const [results, setResults] = useState<GoalCheck[][]>([]);
  const [ai, setAi] = useState(false);
  useEffect(() => { void aiStatus().then((s) => setAi(!!s?.available)); }, []);
  useEffect(() => {
    const t = setTimeout(() => void checkGoals(sim.store, goals).then(setResults).catch(() => undefined), 200);
    return () => clearTimeout(t);
  }, [version, scenario.id]);

  const interview = scenario.kind === "interview";
  const shown = goals.map((_, i) => i).filter((i) => !interview || found.includes(i));
  const met = (i: number) => !!results[i]?.length && results[i].every((c) => c.result.passed);
  const done = goals.length > 0 && goals.every((_, i) => met(i)) && (!interview || found.length === goals.length);
  const used = Object.values(hints).reduce((a, b) => a + b, 0);
  useEffect(() => {
    if (!results.length) return;
    const checks = goals.flatMap((g, i) => [
      ...(interview ? [{ title: `Found: ${requirement(g)}`, passed: found.includes(i) }] : []),
      ...(results[i] ?? []).map((c) => ({ title: c.title, passed: c.result.passed }))
    ]);
    onProgress(checks, done);
  }, [results, found.length]);

  return (
    <>
      {interview && scenario.interview && <Interview scenario={scenario} found={found} talk={talk} onTalk={onTalk} ai={ai} />}
      <p className="scenario-brief">
        {interview
          ? `What ${scenario.interview?.persona.split(",")[0]} needs, as you find out: ${found.length} of ${goals.length} found. Build it in the admin center; each requirement ticks off when the training's checks pass.`
          : "Build what the company asks for in the admin center. Each requirement ticks off when the training's checks pass."}
      </p>
      <div className="lesson-actions"><Button size="small" appearance="primary" onClick={() => onGo("admin")}>Open the admin center</Button><Button size="small" onClick={() => onGo("phone")}>Test with the phone</Button></div>
      <ol className="lesson-tasks">
        {shown.map((i) => {
          const g = goals[i];
          const id = `g${i + 1}`;
          const n = hints[id] ?? 0;
          return (
            <li key={id} className={met(i) ? "done" : "current"}>
              <div className="lesson-task-title"><span className="lesson-mark">{met(i) ? "✓" : ""}</span>{requirement(g)}</div>
              <ul className="scenario-checks">
                {(results[i] ?? []).map((c) => (
                  <li key={c.title} className={c.result.passed ? "ok" : "todo"}>{c.result.passed ? "✓" : "○"} {c.title}{c.result.note ? <span className="admin-muted"> · {c.result.note}</span> : null}</li>
                ))}
              </ul>
              {!met(i) && (
                <div className="lesson-current">
                  {goalHints(g).slice(0, n).map((h, j) => <p key={j} className="lesson-hint">Hint: {h}</p>)}
                  <div className="lesson-actions">
                    {n < 3 && <Button size="small" onClick={() => onHint(id)}>Hint</Button>}
                    <Button size="small" appearance="subtle" onClick={() => explain(GOAL_CONCEPT[g.type])}>Explain</Button>
                    {ai && <AiHint scenario={scenario} goal={i} checks={results[i] ?? []} />}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {done && <div className="lesson-finished"><strong>Everything they asked for works.</strong> {goals.length} of {goals.length} requirements met, checked by the training. {used ? `You used ${used} hint${used === 1 ? "" : "s"}.` : "No hints used."}</div>}
    </>
  );
}

// An AI hint for one requirement, citing its Learn passage (manual 8.2 "Feedback"). The passage comes from
// the training's own concepts; the hint text is the AI's.
function AiHint({ scenario, goal, checks }: { scenario: Scenario; goal: number; checks: GoalCheck[] }) {
  const { explain } = useTraining();
  const [hint, setHint] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    try {
      const g = scenario.goals![goal];
      const r = await aiHint({ requirement: requirement(g), checks: checks.map((c) => `${c.result.passed ? "met" : "not met"}: ${c.title}${c.result.note ? ` (${c.result.note})` : ""}`), concept: GOAL_CONCEPT[g.type] });
      setHint(r.hint);
      explain(r.concept);
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return hint ? <p className="lesson-hint scenario-ai-hint">AI hint: {hint} <span className="admin-muted">The Learn passage it's based on is below.</span></p>
    : <Button size="small" appearance="subtle" disabled={busy} onClick={() => void ask()}>{busy ? <Spinner size="extra-tiny" /> : "AI hint"}</Button>;
}

// The interview: the customer's opening, the questions asked, and the questions the learner can ask.
// Without the AI, the learner picks from the scenario's questions; with it, they can also ask their own.
function Interview({ scenario, found, talk, onTalk, ai }: { scenario: Scenario; found: number[]; talk: Talk[]; onTalk(t: Talk, revealed: number[]): void; ai: boolean }) {
  const iv = scenario.interview!;
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const asked = new Set(talk.map((t) => t.q));
  // Every scripted question, in a fixed mixed order so the ones that matter aren't all first.
  const scripted = [...iv.topics.map((t) => ({ ...t, goals: [t.goal] })), ...iv.extras.map((t) => ({ ...t, goals: [] as number[] }))]
    .sort((a, b) => a.ask.length % 7 - b.ask.length % 7 || a.ask.localeCompare(b.ask));
  const askOwn = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await aiInterview(scenario, talk, own.trim());
      onTalk({ q: own.trim(), a: r.answer }, r.revealed);
      setOwn("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="interview">
      <p className="interview-who">{iv.persona}</p>
      <p className="interview-a">“{iv.opening}”</p>
      {talk.map((t, i) => (
        <div key={i}><p className="interview-q">You: {t.q}</p><p className="interview-a">“{t.a}”</p></div>
      ))}
      <p className="interview-label">Ask a question</p>
      <div className="interview-asks">
        {scripted.filter((t) => !asked.has(t.ask)).map((t) => <button key={t.ask} className="interview-ask" onClick={() => onTalk({ q: t.ask, a: t.answer }, t.goals)}>{t.ask}</button>)}
      </div>
      {ai && (
        <div className="interview-own">
          <Input size="small" placeholder="Or ask your own question" value={own} onChange={(_, v) => setOwn(v.value)} onKeyDown={(e) => { if (e.key === "Enter" && own.trim() && !busy) void askOwn(); }} />
          <Button size="small" disabled={!own.trim() || busy} onClick={() => void askOwn()}>{busy ? <Spinner size="extra-tiny" /> : "Ask"}</Button>
        </div>
      )}
      {error && <p className="lesson-problem">{error}</p>}
      {found.length === (scenario.goals ?? []).length && <p className="lesson-done">You've found everything {iv.persona.split(",")[0]} needs.</p>}
    </div>
  );
}
