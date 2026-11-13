// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { Button, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Detail, learnerWork, Progress } from "./client";
import { Activity, ago, cellOf, PartBars } from "./ProgressCell";

// One learner, in depth, for their trainer: for each lab and exercise of the class, a timeline of what they
// did, the quiz (each question, their answer, right or wrong, and tries), each task (done or not, when, how
// long, hints, their answer or the check's note), their predictions and interview questions, and a button
// to open their saved work read-only.
//
// Colours as in the class table (docs/classroom.md): progress blue, done green, "not right yet" amber, a
// wrong answer red; every colour comes with a word or a symbol.

type Kind = NonNullable<Detail["events"]>[number]["kind"];
const KIND_LABEL: Record<Kind, string> = { read: "Read", quiz: "Quiz", done: "Done", hint: "Hint", wrong: "Not right", answer: "Answer", ask: "Asked", start: "Started" };
const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const mins = (ms: number) => (ms < 60_000 ? "under a minute" : `${Math.round(ms / 60_000)} min`);

// The timeline: one dot per event on a line from the first to the last, coloured by kind, each with its time
// and what happened when you point at it, and the list of events below.
function Timeline({ events }: { events: NonNullable<Detail["events"]> }) {
  const [all, setAll] = useState(false);
  if (!events.length) return <p className="admin-muted">Nothing on the timeline yet.</p>;
  const times = events.map((e) => Date.parse(e.at));
  const first = Math.min(...times), last = Math.max(...times);
  const span = Math.max(last - first, 60_000);
  // On real time the pauses show; within a few minutes the dots would pile up, so they are spaced evenly then.
  const even = last - first < 5 * 60_000;
  const x = (e: (typeof events)[number], i: number) => (even ? (events.length > 1 ? i / (events.length - 1) : 0) : (Date.parse(e.at) - first) / span) * 100;
  const kinds = [...new Set(events.map((e) => e.kind))];
  const shown = all ? [...events].reverse() : [...events].reverse().slice(0, 8);
  return (
    <div className="lv-timeline">
      <div className="lv-track" role="img" aria-label={`Timeline: ${events.length} events from ${hhmm(events[0].at)} to ${hhmm(events[events.length - 1].at)}`}>
        <span className="lv-line" />
        {events.map((e, i) => (
          <span key={i} className={`lv-dot lv-k-${e.kind}`} style={{ left: `${x(e, i)}%` }} title={`${hhmm(e.at)} · ${e.what}`} />
        ))}
      </div>
      <div className="lv-axis"><span>{hhmm(events[0].at)}</span><span>{mins(last - first)}</span><span>{hhmm(events[events.length - 1].at)}</span></div>
      <p className="lv-legend">{kinds.map((k) => <span key={k}><span className={`lv-dot lv-static lv-k-${k}`} />{KIND_LABEL[k]}</span>)}</p>
      <ol className="lv-events">
        {shown.map((e, i) => <li key={i}><span className="lv-time">{hhmm(e.at)}</span> {e.what}</li>)}
      </ol>
      {events.length > 8 && <Button size="small" appearance="subtle" onClick={() => setAll(!all)}>{all ? "Show the latest" : `Show all ${events.length}`}</Button>}
    </div>
  );
}

// The quiz: a block per question, then each question with their answer.
function Quiz({ quiz }: { quiz: NonNullable<Detail["quiz"]> }) {
  const state = (q: (typeof quiz)[number]) => (q.right ? (q.tries <= 1 ? "first" : "later") : q.answer ? "wrong" : "open");
  const label = { first: "✓ Right first time", later: "✓ Right after tries", wrong: "✗ Not right yet", open: "Not answered" } as const;
  return (
    <div className="lv-quiz">
      <div className="lv-strip" aria-hidden="true">{quiz.map((q, i) => <span key={i} className={`lv-block lv-${state(q)}`}>{i + 1}</span>)}</div>
      <ol className="lv-questions">
        {quiz.map((q, i) => (
          <li key={i}>
            <span className={`lv-tag lv-${state(q)}`}>{label[state(q)]}{q.tries > 1 ? ` (${q.tries})` : ""}</span> {q.question}
            {q.answer && <span className="lv-answer">Their answer: {q.answer}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Tasks({ tasks, started }: { tasks: NonNullable<Detail["tasks"]>; started?: string }) {
  // How long each took: from the one done before it (or the start of the timeline).
  let previous = started ? Date.parse(started) : undefined;
  return (
    <div className="lv-table-wrap">
      <table className="trainer-table lv-table">
        <thead><tr><th>Task</th><th>Their answer or the check</th><th>Hints</th><th>Done</th></tr></thead>
        <tbody>
          {tasks.map((t, i) => {
            const at = t.at ? Date.parse(t.at) : undefined;
            const took = at && previous ? mins(at - previous) : undefined;
            if (at) previous = at;
            return (
              <tr key={i} className={t.passed ? "lv-row-done" : ""}>
                <td><span className={t.passed ? "lv-ok" : "lv-todo"}>{t.passed ? "✓" : "○"}</span> {t.title}</td>
                <td>{t.answer && <>Answered “{t.answer}”{t.note ? ". " : ""}</>}{t.note}{!t.answer && !t.note && <span className="admin-muted">–</span>}</td>
                <td>{t.hints || <span className="admin-muted">–</span>}</td>
                <td>{t.at ? <>{hhmm(t.at)}{took && <span className="admin-muted"> · {took}</span>}</> : <span className="admin-muted">not yet</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Calls({ calls }: { calls: NonNullable<Detail["calls"]> }) {
  return (
    <div className="lv-table-wrap">
      <table className="trainer-table lv-table">
        <thead><tr><th>Caller</th><th>Their prediction</th><th>Where the call goes</th></tr></thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={i}>
              <td>{c.caller}</td>
              <td><span className={c.right ? "lv-ok" : "lv-bad"}>{c.right ? "✓" : "✗"}</span> {c.predicted}</td>
              <td>{c.actual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Item({ title, p, now, open }: { title: string; p?: Progress; now: number; open(): Promise<string | undefined> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { state } = cellOf(p, now);
  const d = p?.detail;
  const stuckFor = p?.current ? now - Date.parse(p.current.since) : 0;
  return (
    <section className={`lv-item lv-state-${state}`} aria-label={title}>
      <div className="lv-item-head">
        <h3>{title}</h3>
        <span className={`lv-status lv-status-${state}`}>
          {state === "done" ? "✓ Done" : state === "stuck" ? "! May be stuck" : state === "working" ? "Working" : "Not started"}
        </span>
        <Button size="small" disabled={busy || !p} onClick={async () => { setBusy(true); setNote(""); setNote((await open()) ?? ""); setBusy(false); }}>Open their environment</Button>
      </div>
      {note && <MessageBar intent="info"><MessageBarBody>{note}</MessageBarBody></MessageBar>}
      {!p ? <p className="admin-muted">They haven't started this yet.</p> : (
        <>
          {p.parts && <div className="lv-parts"><PartBars p={p} /></div>}
          {p.current && !p.done && (
            <p className={state === "stuck" ? "lv-now lv-now-stuck" : "lv-now"}>
              Now on: <strong>{p.current.title}</strong>, for {mins(stuckFor)}. Last update {ago(p.updatedOn, now)}.
            </p>
          )}
          <div className="lv-grid">
            <div>
              <h4>Timeline</h4>
              <Timeline events={d?.events ?? []} />
            </div>
            <div>
              {d?.quiz && <><h4>Quiz</h4><Quiz quiz={d.quiz} /></>}
              {d?.tasks && <><h4>Tasks</h4><Tasks tasks={d.tasks} started={d.events?.[0]?.at} /></>}
              {d?.calls && d.calls.length > 0 && <><h4>Predictions</h4><Calls calls={d.calls} /></>}
              {d?.asked && d.asked.length > 0 && <><h4>Questions they asked</h4><ol className="lv-asked">{d.asked.map((q, i) => <li key={i}>{q}</li>)}</ol></>}
              {!d?.quiz && !d?.tasks && !d?.calls?.length && !d?.asked?.length && (
                <ul className="lv-checks">{p.checks.map((c, i) => <li key={i}><span className={c.passed ? "lv-ok" : "lv-todo"}>{c.passed ? "✓" : "○"}</span> {c.title}</li>)}</ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function LearnerView({ code, trainerKey, learnerId, name, items, progress, focus, onBack, onViewWork }: {
  code: string;
  trainerKey?: string;
  learnerId: string;
  name: string;
  // The class's labs and exercises, in order, with their titles.
  items: { id: string; title: string }[];
  progress: Progress[];
  focus?: string;
  onBack(): void;
  onViewWork(what: string, data: string): void;
}) {
  const now = Date.now();
  const focused = useRef<HTMLDivElement>(null);
  useEffect(() => { focused.current?.scrollIntoView({ block: "start" }); }, [focus]);
  const mine = progress.filter((p) => p.learnerId === learnerId);
  const open = async (id: string, title: string): Promise<string | undefined> => {
    try {
      const { work } = await learnerWork(code, trainerKey, learnerId, id);
      if (!work) return "Nothing saved yet: work is saved once they start the hands-on part of a lab, or an exercise.";
      onViewWork(title, work.data);
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  return (
    <div className="lv">
      <div className="lv-head">
        <Button onClick={onBack}>← Back to the class</Button>
        <h2>{name}</h2>
        <Activity updates={mine.map((p) => p.updatedOn)} now={now} />
      </div>
      {items.map((it) => (
        <div key={it.id} ref={it.id === focus ? focused : undefined}>
          <Item title={it.title} p={mine.find((p) => p.scenarioId === it.id)} now={now} open={() => open(it.id, it.title)} />
        </div>
      ))}
    </div>
  );
}
