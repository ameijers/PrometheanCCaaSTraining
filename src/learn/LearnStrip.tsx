// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { CONCEPTS } from "../shell/context";
import { learnStatus, LearnStatus } from "./client";

// The explanation of what the learner is looking at: our short summary, then the passage from Microsoft
// Learn, quoted, with the article's link and date (manual 7.3). The quote is saved in content/concepts.json;
// the backend checks it against the article as it is today (manual 7.4).

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function LearnStrip({ conceptId }: { conceptId?: string }) {
  const concept = conceptId ? CONCEPTS.get(conceptId) : undefined;
  const [status, setStatus] = useState<LearnStatus | undefined | "checking">("checking");

  useEffect(() => {
    if (!concept) return;
    let current = true;
    setStatus("checking");
    void learnStatus(concept.id).then((s) => { if (current) setStatus(s); });
    return () => { current = false; };
  }, [concept?.id]);

  if (!concept) return <footer className="learn"><span className="admin-muted">Select ⓘ next to a setting, or Open record on a shape in the Diagram, to see what it is.</span></footer>;
  const date = longDate(status && status !== "checking" && status.date ? status.date : concept.learn.date);
  const note = status === "checking" ? undefined
    : !status ? { kind: "offline", text: `Microsoft Learn couldn't be reached: this is the saved explanation, checked on ${longDate(concept.learn.checkedOn)}.` }
    : !status.quoteFound ? { kind: "changed", text: "Microsoft Learn has changed this passage since we checked it. The explanation is being reviewed; read the full article for the latest." }
    : status.dateChanged ? { kind: "changed", text: `Microsoft Learn updated this article on ${longDate(status.date!)}. The passage below is still in it.` }
    : { kind: "ok", text: `Checked against Microsoft Learn${status.source === "live" ? " just now" : ` on ${longDate(status.fetchedAt)}`}.` };
  return (
    <footer className="learn" aria-live="polite">
      <div className="learn-summary"><strong>{concept.title}.</strong> {concept.summary}</div>
      <blockquote className="learn-quote">
        “{concept.learn.quote}”
        <cite>
          Microsoft Learn, <a href={concept.learn.url} target="_blank" rel="noreferrer">{concept.learn.title}</a>, updated {date}. <a href={concept.learn.url} target="_blank" rel="noreferrer">Read the full article</a>
          {/* The documentation is Microsoft's, under CC BY 4.0 (docs/learn-source.md, "Terms"): credit, the license, and whether it was shortened. */}
          <span className="learn-license"> © Microsoft, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>{concept.learn.quote.includes("…") ? "; shortened where you see “…”" : ""}.</span>
        </cite>
        {note && <span className={`learn-status ${note.kind}`}>{note.text}</span>}
      </blockquote>
    </footer>
  );
}
