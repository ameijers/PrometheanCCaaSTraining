// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, MessageBar, MessageBarBody, Option, Radio, RadioGroup, Textarea } from "@fluentui/react-components";
import { changeFeedback, deleteFeedback, feedbackEnvironment, FeedbackItem, FeedbackStatus, FeedbackType, listFeedback, sendFeedback } from "../classroom/client";

// Feedback (docs/feedback.md): anyone sends it from the header, with what they were doing if they like;
// someone with the admin role reads it in the Feedback inbox.

export const FEEDBACK_TYPES: { type: FeedbackType; label: string; hint: string }[] = [
  { type: "problem", label: "Something doesn't work", hint: "A button that does nothing, an error, a check that doesn't tick off" },
  { type: "content", label: "Something in the content is wrong or unclear", hint: "A lab page, a task, an explanation, a quiz question" },
  { type: "idea", label: "An idea or a wish", hint: "Something you'd like the training to have or do differently" },
  { type: "question", label: "A question", hint: "Leave your email if you'd like an answer" },
  { type: "other", label: "Something else", hint: "" }
];
const TYPE_LABEL = Object.fromEntries(FEEDBACK_TYPES.map((t) => [t.type, t.label])) as Record<FeedbackType, string>;
const MAX = 2000;

export function FeedbackDialog({ context, environment, onClose }: {
  // What the learner is doing, in a few labelled lines: shown before it's sent.
  context: Record<string, string>;
  // Their environment, packed, for "Attach my environment" (undefined: it can't be packed here).
  environment?: () => Promise<string>;
  onClose(): void;
}) {
  const [type, setType] = useState<FeedbackType | "">("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [withContext, setWithContext] = useState(true);
  const [withEnvironment, setWithEnvironment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string>();

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      let packed: string | undefined;
      if (withEnvironment && environment) {
        packed = await environment();
        if (packed.length > 30_000) { packed = undefined; setError("Your environment is too large to attach, so it's sent without it."); }
      }
      const { id } = await sendFeedback({
        type: type as FeedbackType, message: message.trim(), name: name.trim() || undefined, email: email.trim() || undefined,
        context: withContext ? context : undefined, environment: packed
      });
      setSent(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface className="fb-dialog">
        <DialogBody>
          <DialogTitle>Feedback</DialogTitle>
          <DialogContent>
            {sent ? (
              <MessageBar intent="success"><MessageBarBody>Thank you! Your feedback is in{email ? ", and you'll hear back by email" : ""}. Reference: <strong>{sent}</strong></MessageBarBody></MessageBar>
            ) : (
              <>
                <p className="admin-tight">Tell us what works, what doesn't, and what you'd like. Everyone's feedback helps, in a class or not.</p>
                <Field label="What is it about?" required>
                  <RadioGroup value={type} onChange={(_, d) => setType(d.value as FeedbackType)}>
                    {FEEDBACK_TYPES.map((t) => <Radio key={t.type} value={t.type} label={<>{t.label}{t.hint && <span className="fb-hint"> · {t.hint}</span>}</>} />)}
                  </RadioGroup>
                </Field>
                <Field label="Your feedback" required hint={`${message.length} of ${MAX} characters`}>
                  <Textarea value={message} maxLength={MAX} resize="vertical" rows={5} onChange={(_, d) => setMessage(d.value)} />
                </Field>
                <div className="fb-two">
                  <Field label="Your name (optional)"><Input value={name} maxLength={60} onChange={(_, d) => setName(d.value)} /></Field>
                  <Field label="Your email (optional)" hint="Only if you'd like an answer."><Input type="email" value={email} maxLength={254} onChange={(_, d) => setEmail(d.value)} /></Field>
                </div>
                <Checkbox checked={withContext} onChange={(_, d) => setWithContext(!!d.checked)} label="Include what I was doing in the training" />
                {withContext && <dl className="fb-context">{Object.entries(context).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
                {environment && (
                  <Checkbox checked={withEnvironment} onChange={(_, d) => setWithEnvironment(!!d.checked)}
                    label="Attach my environment, so the training's team can see what I see (what you set up in the training, nothing else)" />
                )}
              </>
            )}
            {error && <MessageBar intent={sent ? "warning" : "error"}><MessageBarBody>{error}</MessageBarBody></MessageBar>}
          </DialogContent>
          <DialogActions>
            {sent ? <Button appearance="primary" onClick={onClose}>Close</Button> : <>
              <Button appearance="primary" disabled={busy || !type || !message.trim()} onClick={() => void send()}>{busy ? "Sending…" : "Send"}</Button>
              <Button onClick={onClose}>Cancel</Button>
            </>}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// The admin's inbox: all feedback, newest first, filtered by type and status; mark it, note it, delete it,
// and open an attached environment read-only.
export function FeedbackInbox({ onClose, onOpenEnvironment }: { onClose(): void; onOpenEnvironment(item: FeedbackItem, data: string): void }) {
  const [items, setItems] = useState<FeedbackItem[]>();
  const [error, setError] = useState("");
  const [type, setType] = useState<FeedbackType | "all">("all");
  const [status, setStatus] = useState<FeedbackStatus | "open">("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = () => listFeedback().then((r) => { setItems(r.feedback); setError(""); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);
  const act = async (run: () => Promise<unknown>) => { try { await run(); await load(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const shown = (items ?? []).filter((i) => (type === "all" || i.type === type) && (status === "open" ? i.status !== "done" : i.status === status));
  const count = (s: FeedbackStatus) => (items ?? []).filter((i) => i.status === s).length;

  return (
    <div className="trainer" role="dialog" aria-label="Feedback inbox">
      <div className="trainer-head">
        <h1 className="lesson-title">Feedback</h1>
        <div className="trainer-head-actions">
          <Button onClick={() => void load()}>Refresh</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
      <div className="trainer-body">
        <div className="fb-filters">
          <Field label="Kind">
            <Dropdown value={type === "all" ? "All kinds" : TYPE_LABEL[type]} selectedOptions={[type]} onOptionSelect={(_, d) => setType(d.optionValue as FeedbackType | "all")}>
              <Option value="all">All kinds</Option>
              {FEEDBACK_TYPES.map((t) => <Option key={t.type} value={t.type}>{t.label}</Option>)}
            </Dropdown>
          </Field>
          <Field label="Status">
            <Dropdown value={{ open: `New and read (${count("new") + count("read")})`, new: `New (${count("new")})`, read: `Read (${count("read")})`, done: `Done (${count("done")})` }[status]} selectedOptions={[status]}
              onOptionSelect={(_, d) => setStatus(d.optionValue as FeedbackStatus | "open")}>
              <Option value="open">{`New and read (${count("new") + count("read")})`}</Option>
              <Option value="new">{`New (${count("new")})`}</Option>
              <Option value="read">{`Read (${count("read")})`}</Option>
              <Option value="done">{`Done (${count("done")})`}</Option>
            </Dropdown>
          </Field>
        </div>
        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
        {!items ? <p className="admin-muted">Loading…</p> : !shown.length ? <p className="admin-muted">No feedback here.</p> : (
          <ol className="fb-list">
            {shown.map((i) => (
              <li key={i.id} className={`fb-item fb-${i.status}`}>
                <div className="fb-item-head">
                  <span className={`fb-type fb-type-${i.type}`}>{TYPE_LABEL[i.type]}</span>
                  <span className="admin-muted">{new Date(i.sentOn).toLocaleString()} · {i.id}</span>
                  <span className={`fb-status fb-status-${i.status}`}>{i.status === "new" ? "New" : i.status === "read" ? "Read" : "✓ Done"}</span>
                </div>
                <p className="fb-message">{i.message}</p>
                {(i.name || i.email) && <p className="admin-tight">From {i.name ?? "someone"}{i.email && <> · <a href={`mailto:${i.email}`}>{i.email}</a></>}</p>}
                {i.context && <dl className="fb-context">{Object.entries(i.context).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
                <Field label="Note for the team">
                  <Input value={notes[i.id] ?? i.note ?? ""} onChange={(_, d) => setNotes({ ...notes, [i.id]: d.value })} />
                </Field>
                <div className="lesson-actions">
                  {notes[i.id] !== undefined && notes[i.id] !== (i.note ?? "") && <Button size="small" onClick={() => void act(() => changeFeedback(i.id, { note: notes[i.id] }))}>Save the note</Button>}
                  {i.status !== "read" && <Button size="small" onClick={() => void act(() => changeFeedback(i.id, { status: "read" }))}>Mark as read</Button>}
                  {i.status !== "done" && <Button size="small" appearance="primary" onClick={() => void act(() => changeFeedback(i.id, { status: "done" }))}>Mark as done</Button>}
                  {i.status === "done" && <Button size="small" onClick={() => void act(() => changeFeedback(i.id, { status: "new" }))}>Open again</Button>}
                  {i.hasEnvironment && <Button size="small" onClick={() => void act(async () => { const { data } = await feedbackEnvironment(i.id); if (data) onOpenEnvironment(i, data); })}>Open their environment</Button>}
                  <Button size="small" className="trainer-delete" onClick={() => { if (window.confirm("Delete this feedback? This can't be undone.")) void act(() => deleteFeedback(i.id)); }}>Delete</Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
