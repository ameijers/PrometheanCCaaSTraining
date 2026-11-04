// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useState } from "react";
import { Button } from "@fluentui/react-components";
import { CheckResult, Lesson, Task } from "./checks";

// The lesson: the story, and the tasks as a checklist that ticks itself off as the checks pass.

export function LessonPanel({ lesson, done, onGo, onExplain }: {
  lesson: Lesson;
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
      <p className="lesson-eyebrow">Lesson · {lesson.company}</p>
      <h1 className="lesson-title">{lesson.title}</h1>
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
                  {note && <p className="lesson-problem">{note}</p>}
                  {t.hints.slice(0, shown).map((h, i) => <p key={i} className="lesson-hint">Hint: {h}</p>)}
                  <div className="lesson-actions">
                    <Button size="small" appearance="primary" onClick={() => onGo(t.tab)}>{t.tab === "phone" ? "Open the phone" : t.tab === "admin" ? "Open the admin center" : "Open the diagram"}</Button>
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
          <strong>Lesson complete.</strong> {lesson.finished}
        </div>
      )}
    </aside>
  );
}
