// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { ReactNode, useState } from "react";
import { Button, Input, Select } from "@fluentui/react-components";
import { useTraining } from "../shell/context";
import { CheckResult, Lesson, record, recorded, Task } from "./checks";

// The lesson: the story, and the tasks as a checklist that ticks itself off as the checks pass.

export function LessonPanel({ lesson, done, onGo, onExplain, header }: {
  lesson: Lesson;
  // A lab's header (src/labs/LabPanel.tsx) in place of the lesson's own eyebrow.
  header?: ReactNode;
  done: Record<string, CheckResult>;
  onGo(tab: Task["tab"]): void;
  onExplain(concept: string): void;
}) {
  const current = lesson.tasks.find((t) => !done[t.id]?.passed);
  const finished = lesson.tasks.filter((t) => done[t.id]?.passed).length;
  const [hints, setHints] = useState<Record<string, number>>({});
  const [storyOpen, setStoryOpen] = useState(true);

  return (
    <aside className="lesson">
      {header ?? <p className="lesson-eyebrow">Lesson · {lesson.company}</p>}
      {header ? <h2 className="lesson-subtitle">{lesson.title}</h2> : <h1 className="lesson-title">{lesson.title}</h1>}
      <div className="lesson-progress" role="progressbar" aria-valuemin={0} aria-valuemax={lesson.tasks.length} aria-valuenow={finished} aria-label={`${finished} of ${lesson.tasks.length} tasks done`}>
        <div style={{ width: `${(100 * finished) / lesson.tasks.length}%` }} />
      </div>
      <button className="lesson-toggle" onClick={() => setStoryOpen((o) => !o)}>{storyOpen ? "Hide the story" : "Show the story"}</button>
      {storyOpen && <div className="lesson-story">{lesson.story.map((p, i) => <p key={i}>{p}</p>)}</div>}

      <ol className="lesson-tasks">
        {lesson.tasks.map((t) => {
          const isDone = !!done[t.id]?.passed;
          const note = done[t.id]?.note;
          const isCurrent = t === current;
          const shown = hints[t.id] ?? 0;
          return (
            <li key={t.id} className={isDone ? "done" : isCurrent ? "current" : "todo"}>
              <div className="lesson-task-title"><span className="lesson-mark">{isDone ? "✓" : ""}</span>{t.title}</div>
              {isDone && note && <p className="lesson-note">{note}</p>}
              {isDone && t.done && <p className="lesson-done">{t.done}</p>}
              {isCurrent && (
                <div className="lesson-current">
                  <p>{t.do}</p>
                  {t.ask && t.check.type === "answer" && <Answer task={t} answerKey={t.check.key} />}
                  {note && <p className="lesson-problem">{note}</p>}
                  {t.hints.slice(0, shown).map((h, i) => <p key={i} className="lesson-hint">Hint: {h}</p>)}
                  <div className="lesson-actions">
                    <Button size="small" appearance={t.ask ? "secondary" : "primary"} onClick={() => onGo(t.tab)}>{t.tab === "phone" ? "Open the phone" : t.tab === "admin" ? "Open the admin center" : t.tab === "agent" ? "Open the Agent tab" : "Open the diagram"}</Button>
                    {shown < t.hints.length && <Button size="small" onClick={() => setHints((h) => ({ ...h, [t.id]: shown + 1 }))}>Hint</Button>}
                    <Button size="small" appearance="subtle" onClick={() => onExplain(t.concept)}>Explain</Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!current && (
        <div className="lesson-finished">
          <strong>{header ? "Hands-on part done." : "Lesson complete."}</strong> {lesson.finished}{header ? " The Challenge part has exercises without the steps." : ""}
        </div>
      )}
    </aside>
  );
}

// A question task: pick a queue or workstream from the environment, pick from a list, or type a number.
// The answer is kept in the environment (checks.ts record), where the task's check reads it.
function Answer({ task, answerKey }: { task: Task; answerKey: string }) {
  const { sim } = useTraining();
  const key = `answer:${answerKey}`;
  const [value, setValue] = useState(() => recorded(sim.store, key) ?? "");
  const ask = task.ask!;
  const options = ask.options === "queues" ? sim.store.table("queue").filter((q) => q.statecode === 0).map((q) => String(q.name))
    : ask.options === "workstreams" ? sim.store.table("msdyn_liveworkstream").map((w) => String(w.msdyn_name))
    : ask.options === "people" ? sim.store.table("msdyn_agentstatus").map((a) => String(sim.store.find("systemuser", a._msdyn_agentid_value)?.fullname ?? ""))
    : ask.options === "profiles" ? sim.store.table("msdyn_capacityprofile").map((p) => String(p.msdyn_name))
    : ask.options === "hours" ? sim.store.table("msdyn_operatinghour").map((h) => String(h.msdyn_name))
    : ask.options === "variables" ? sim.store.table("msdyn_ocliveworkstreamcontextvariable").map((v) => String(v.msdyn_name))
    : ask.options === "number" ? undefined : ask.options;
  return (
    <div className="lesson-answer">
      <label htmlFor={`ask-${task.id}`}>{ask.question}</label>
      {options
        ? <Select id={`ask-${task.id}`} value={value} onChange={(_, d) => setValue(d.value)}>
            <option value="">Choose…</option>
            {[...new Set(options)].sort().map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        : <Input id={`ask-${task.id}`} type="number" value={value} onChange={(_, d) => setValue(d.value)} />}
      <Button size="small" appearance="primary" disabled={!value.trim()} onClick={() => record(sim.store, key, value.trim())}>Check answer</Button>
    </div>
  );
}
