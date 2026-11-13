// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Progress } from "./client";
import { cellOf } from "./ProgressCell";

// The class at a glance, above the learner table: headline numbers, how far the class got in each lab and
// exercise (a funnel), where learners are now (and who may be stuck), and the quiz questions most get wrong.
//
// Colours (docs/classroom.md): the funnel's stages are four steps of one blue, light to dark (an ordinal
// ramp, checked: lightest 2:1 on the page); "may be stuck" is the status amber; the quiz bars are the
// progress blue. Every bar has its number in words next to it; pointing at a bar names the learners.

export interface SummaryItem { id: string; title: string; lab: boolean }

const STAGE_SHADES = ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab"];
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const names = (list: string[]) => (list.length ? list.join(", ") : "nobody");

// How many learners reached each stage of a lab or exercise.
function stages(item: SummaryItem, rows: Progress[]): { label: string; who: string[] }[] {
  const of = (test: (p: Progress) => boolean) => rows.filter(test).map((p) => p.name);
  if (!item.lab) return [{ label: "Started", who: of(() => true) }, { label: "Done", who: of((p) => p.done) }];
  return [
    { label: "Started", who: of(() => true) },
    { label: "Learn done", who: of((p) => !!p.parts?.learn?.done || p.done) },
    { label: "Do done", who: of((p) => !!p.parts?.do?.done || p.done) },
    { label: "Did a challenge", who: of((p) => (p.parts?.challenge?.done ?? 0) > 0) }
  ];
}

function Funnel({ item, rows, learners }: { item: SummaryItem; rows: Progress[]; learners: number }) {
  return (
    <div className="cs-funnel">
      <p className="cs-item">{item.title}</p>
      {stages(item, rows).map((s, i) => (
        <div key={s.label} className="cs-row" title={`${s.label}: ${names(s.who)}`}>
          <span className="cs-label">{s.label}</span>
          <span className="cs-track">{s.who.length > 0 && <span className="cs-bar" style={{ width: `${pct(s.who.length, learners)}%`, background: STAGE_SHADES[item.lab ? i : i * 3] }} />}</span>
          <span className="cs-value">{s.who.length} of {learners}</span>
        </div>
      ))}
    </div>
  );
}

// Where learners are now: the step each is on, longest bar first, amber for those who may be stuck.
function WhereNow({ items, progress, now }: { items: SummaryItem[]; progress: Progress[]; now: number }) {
  const at = new Map<string, { item: string; step: string; working: string[]; stuck: string[] }>();
  for (const p of progress) {
    if (p.done || !p.current) continue;
    const item = items.find((i) => i.id === p.scenarioId);
    if (!item) continue;
    const key = `${p.scenarioId}|${p.current.title}`;
    const row = at.get(key) ?? { item: item.title, step: p.current.title, working: [], stuck: [] };
    (cellOf(p, now).state === "stuck" ? row.stuck : row.working).push(p.name);
    at.set(key, row);
  }
  const rows = [...at.values()].sort((a, b) => b.stuck.length - a.stuck.length || (b.working.length + b.stuck.length) - (a.working.length + a.stuck.length)).slice(0, 8);
  if (!rows.length) return <p className="admin-muted">Nobody is in the middle of something right now.</p>;
  const most = Math.max(...rows.map((r) => r.working.length + r.stuck.length));
  return (
    <div>
      {rows.map((r) => (
        <div key={`${r.item}|${r.step}`} className="cs-now" title={`${r.item}: ${r.step}\nWorking: ${names(r.working)}\nMay be stuck: ${names(r.stuck)}`}>
          <span className="cs-step"><strong>{r.step}</strong> <span className="admin-muted">· {r.item}</span></span>
          <span className="cs-track cs-split">
            {r.stuck.length > 0 && <span className="cs-bar cs-stuck" style={{ width: `${pct(r.stuck.length, most)}%` }} />}
            {r.working.length > 0 && <span className="cs-bar cs-working" style={{ width: `${pct(r.working.length, most)}%` }} />}
          </span>
          <span className="cs-who">{[...r.stuck.map((n) => `! ${n}`), ...r.working].join(", ")}</span>
        </div>
      ))}
    </div>
  );
}

// The quiz questions most learners don't get right the first time.
function HardestQuestions({ items, progress }: { items: SummaryItem[]; progress: Progress[] }) {
  const qs = new Map<string, { question: string; item: string; answered: number; missed: string[] }>();
  for (const p of progress) {
    const item = items.find((i) => i.id === p.scenarioId);
    for (const q of p.detail?.quiz ?? []) {
      if (!item || !q.tries) continue;
      const key = `${p.scenarioId}|${q.question}`;
      const row = qs.get(key) ?? { question: q.question, item: item.title, answered: 0, missed: [] };
      row.answered++;
      if (!q.right || q.tries > 1) row.missed.push(p.name);
      qs.set(key, row);
    }
  }
  const rows = [...qs.values()].filter((r) => r.missed.length).sort((a, b) => b.missed.length / b.answered - a.missed.length / a.answered || b.missed.length - a.missed.length).slice(0, 6);
  if (!rows.length) return <p className="admin-muted">{qs.size ? "Everyone got every quiz question right the first time." : "No quiz has been checked yet."}</p>;
  return (
    <div>
      {rows.map((r) => (
        <div key={`${r.item}|${r.question}`} className="cs-q" title={`${r.item}\nNot right the first time: ${names(r.missed)}`}>
          <span className="cs-question">{r.question} <span className="admin-muted">· {r.item}</span></span>
          <span className="cs-track">{r.missed.length > 0 && <span className="cs-bar cs-working" style={{ width: `${pct(r.missed.length, r.answered)}%` }} />}</span>
          <span className="cs-value">{pct(r.missed.length, r.answered)}% · {r.missed.length} of {r.answered}</span>
        </div>
      ))}
    </div>
  );
}

export function ClassOverview({ items, progress, learners, now }: { items: SummaryItem[]; progress: Progress[]; learners: number; now: number }) {
  const inClass = progress.filter((p) => items.some((i) => i.id === p.scenarioId));
  const lastSeen = new Map<string, number>();
  for (const p of inClass) lastSeen.set(p.learnerId, Math.max(lastSeen.get(p.learnerId) ?? 0, Date.parse(p.updatedOn)));
  const active = [...lastSeen.values()].filter((t) => now - t < 5 * 60_000).length;
  const finished = new Set(items.map((i) => i.id));
  const allDone = [...new Set(inClass.map((p) => p.learnerId))].filter((id) => [...finished].every((i) => inClass.some((p) => p.learnerId === id && p.scenarioId === i && p.done))).length;
  const stuck = new Set(inClass.filter((p) => cellOf(p, now).state === "stuck").map((p) => p.learnerId)).size;
  const tiles: [string, number, string][] = [
    ["Learners", learners, "joined the class"],
    ["Active now", active, "did something in the last 5 minutes"],
    ["Finished everything", allDone, `of the ${items.length} labs and exercises`],
    ["May be stuck", stuck, "on the same thing for over 10 minutes"]
  ];
  return (
    <section className="cs" aria-label="The class at a glance">
      <div className="cs-tiles">
        {tiles.map(([name, value, hint]) => (
          <div key={name} className={`cs-tile${name === "May be stuck" && value ? " cs-tile-stuck" : ""}`}>
            <span className="cs-tile-value">{name === "May be stuck" && value ? `! ${value}` : value}</span>
            <span className="cs-tile-name">{name}</span>
            <span className="cs-tile-hint">{hint}</span>
          </div>
        ))}
      </div>
      <div className="cs-charts">
        <div className="cs-card">
          <h3>How far the class got</h3>
          {items.map((i) => <Funnel key={i.id} item={i} rows={inClass.filter((p) => p.scenarioId === i.id)} learners={learners} />)}
        </div>
        <div className="cs-card">
          <h3>Where they are now</h3>
          <p className="cs-key"><span className="cs-swatch cs-stuck" />! May be stuck <span className="cs-swatch cs-working" />Working</p>
          <WhereNow items={items} progress={inClass} now={now} />
        </div>
        <div className="cs-card">
          <h3>Hardest quiz questions</h3>
          <p className="cs-key">Share of learners not right the first time</p>
          <HardestQuestions items={items} progress={inClass} />
        </div>
      </div>
    </section>
  );
}
