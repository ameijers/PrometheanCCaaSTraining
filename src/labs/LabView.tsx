// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { Fragment, useState } from "react";
import { Button, MessageBar, MessageBarBody, Radio, RadioGroup } from "@fluentui/react-components";
import conceptsJson from "../../content/concepts.json";
import { KIND_TITLES, Scenario } from "../scenarios/scenario";
import { Lab, LabState, LearnPage, quizPassed } from "./labs";
import { readyAfter, subjectsOf } from "./practice";

// A lab's reading part, in the workspace's Lab tab: one Learn page at a time with its passages from
// Microsoft Learn, then the quiz; and the Challenge part's exercises.

type Concept = { id: string; title: string; learn: { title: string; url: string; quote: string } };
const CONCEPTS = conceptsJson.concepts as Concept[];

const DIAGRAMS: Record<NonNullable<LearnPage["diagram"]>, string[]> = {
  "call-path": ["Phone number", "Voice channel", "Workstream", "AI agent (IVR)", "Route-to-queue rules", "Queue", "Assignment", "Representative"],
  "queue-people": ["Call waits in the queue", "Members of the queue", "Available or Busy", "Capacity left", "Assignment method picks one"],
  rules: ["Caller's answer", "Context variable", "Rule: if … then queue", "Queue", "No rule matches: fallback queue"]
};

export function LabView({ lab, state, setState, scenarios, finishedIds, onStartDo, onScenario, onLearnDone, onQuizChecked }: {
  onQuizChecked?(): void;
  lab: Lab;
  state: LabState;
  setState(s: LabState): void;
  scenarios: Scenario[];
  finishedIds: string[];
  onStartDo(): void;
  onScenario(s: Scenario): void;
  onLearnDone(): void;
}) {
  const pages = lab.learn ?? [];
  const onQuiz = state.part === "learn" && state.page >= pages.length;
  const page = pages[state.page];

  if (state.part === "challenge") {
    const list = (lab.challenges ?? []).map((id) => scenarios.find((s) => s.id === id)).filter(Boolean) as Scenario[];
    // Other exercises that suit after this lab, AI-written ones too (src/labs/practice.ts).
    const more = scenarios.filter((s) => readyAfter(s) === lab.number && !list.includes(s));
    const row = (s: Scenario) => (
      <li key={s.id}>
        <div>
          <strong>{finishedIds.includes(s.id) ? "✓ " : ""}{s.title}</strong><br />
          <span className="admin-muted">{KIND_TITLES[s.kind]} · level {s.level} · covers {subjectsOf(s)}</span>
          {readyAfter(s) > lab.number && <><br /><span className="lab-later">Best after lab {readyAfter(s)}: it also needs what that lab teaches.</span></>}
        </div>
        <Button onClick={() => onScenario(s)}>{finishedIds.includes(s.id) ? "Do it again" : "Start"}</Button>
      </li>
    );
    return (
      <article className="lab-view">
        <p className="lesson-eyebrow">Lab {lab.number} · Challenge</p>
        <h2 className="lab-title">Try it without the steps</h2>
        <p>These exercises go with this lab. You get a story and a goal, but no step-by-step tasks. Each starts in its own environment.</p>
        <ul className="lab-challenges">{list.map(row)}</ul>
        {!list.length && <p className="admin-muted">This lab has no challenge yet.</p>}
        {more.length > 0 && <>
          <h3 className="lab-more">More practice after this lab</h3>
          <ul className="lab-challenges">{more.map(row)}</ul>
        </>}
      </article>
    );
  }

  if (state.part === "do") {
    return (
      <article className="lab-view">
        <p className="lesson-eyebrow">Lab {lab.number} · Do</p>
        <h2 className="lab-title">The tasks are on the left</h2>
        <p>Work through them in the Admin center, Diagram, Phone and Agent tabs. Each task ticks off by itself when the training's check passes.</p>
      </article>
    );
  }

  if (onQuiz) return <Quiz lab={lab} state={state} setState={setState} onStartDo={onStartDo} onLearnDone={onLearnDone} onChecked={onQuizChecked} />;

  return (
    <article className="lab-view">
      <p className="lesson-eyebrow">Lab {lab.number} · Learn · page {state.page + 1} of {pages.length}</p>
      <h2 className="lab-title">{page.title}</h2>
      {page.text.map((t, i) => <p key={i}>{t}</p>)}
      {page.diagram && (
        <ol className="lab-diagram" aria-label="Diagram">
          {DIAGRAMS[page.diagram].map((step, i) => <Fragment key={step}>{i > 0 && <li className="lab-arrow" aria-hidden="true">→</li>}<li className="lab-step">{step}</li></Fragment>)}
        </ol>
      )}
      {(page.concepts ?? []).map((id) => CONCEPTS.find((c) => c.id === id)).filter(Boolean).map((c) => (
        <blockquote key={c!.id} className="lab-quote">
          <p>“{c!.learn.quote}”</p>
          <footer>Microsoft Learn, <a href={c!.learn.url} target="_blank" rel="noreferrer">{c!.learn.title}</a> · © Microsoft, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></footer>
        </blockquote>
      ))}
      <div className="lesson-actions lab-nav">
        <Button disabled={state.page === 0} onClick={() => setState({ ...state, page: state.page - 1 })}>Back</Button>
        <Button appearance="primary" onClick={() => setState({ ...state, page: state.page + 1 })}>{state.page === pages.length - 1 ? "To the quiz" : "Next"}</Button>
      </div>
    </article>
  );
}

function Quiz({ lab, state, setState, onStartDo, onLearnDone, onChecked }: { lab: Lab; state: LabState; setState(s: LabState): void; onStartDo(): void; onLearnDone(): void; onChecked?(): void }) {
  const questions = lab.quiz ?? [];
  // Answers are marked once the learner checks them; changing an answer hides its mark again.
  const [checked, setChecked] = useState<Set<string>>(() => new Set(quizPassed(lab, state.quiz) ? questions.map((q) => q.id) : []));
  const passed = quizPassed(lab, state.quiz) && questions.every((q) => checked.has(q.id));
  const answered = questions.every((q) => state.quiz[q.id] !== undefined);
  return (
    <article className="lab-view">
      <p className="lesson-eyebrow">Lab {lab.number} · Learn · quiz</p>
      <h2 className="lab-title">Check what you know</h2>
      {questions.map((q, n) => {
        const given = state.quiz[q.id];
        const shown = checked.has(q.id) && given !== undefined;
        return (
          <fieldset key={q.id} className="lab-question">
            <legend>{n + 1}. {q.question}</legend>
            <RadioGroup value={given === undefined ? "" : String(given)} onChange={(_, d) => {
              setState({ ...state, quiz: { ...state.quiz, [q.id]: Number(d.value) } });
              setChecked((c) => { const x = new Set(c); x.delete(q.id); return x; });
            }}>
              {q.options.map((o, i) => <Radio key={i} value={String(i)} label={o} />)}
            </RadioGroup>
            {shown && (given === q.answer
              ? <p className="lab-right">Right. {q.why}</p>
              : <p className="lab-wrong">Not quite. Read the question again, or go back to the pages.</p>)}
          </fieldset>
        );
      })}
      <div className="lesson-actions lab-nav">
        <Button onClick={() => setState({ ...state, page: (lab.learn?.length ?? 1) - 1 })}>Back to the pages</Button>
        {!passed && <Button appearance="primary" disabled={!answered} onClick={() => { setChecked(new Set(questions.map((q) => q.id))); onChecked?.(); if (quizPassed(lab, state.quiz)) onLearnDone(); }}>Check my answers</Button>}
        {passed && <Button appearance="primary" onClick={onStartDo}>Start the hands-on part</Button>}
      </div>
      {passed && <MessageBar intent="success"><MessageBarBody>All right. Next: do it yourself in the environment.</MessageBarBody></MessageBar>}
    </article>
  );
}
