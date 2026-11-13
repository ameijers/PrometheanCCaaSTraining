// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { randomInt } from "crypto";
import { AiError } from "./ai/provider";
import { KvStore } from "./kv";

// Feedback from anyone using the training (docs/feedback.md): a type, a message, and if they like their name
// and email for an answer, what they were doing in the training, and their environment. Kept in the
// backend's store; only someone with the admin role reads it, marks it, or deletes it.

export const FEEDBACK_TYPES = ["problem", "idea", "content", "question", "other"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_STATUSES = ["new", "read", "done"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackItem {
  id: string;
  type: FeedbackType;
  message: string;
  name?: string;
  email?: string;
  // What they were doing: a few labelled lines the browser sends, e.g. "Lab": "4, Do", "Tab": "Admin center".
  context?: Record<string, string>;
  hasEnvironment: boolean;
  status: FeedbackStatus;
  note?: string;
  sentOn: string;
}

const MESSAGE_MAX = 2000;
const ENVIRONMENT_MAX = 30_000; // characters: one Table Storage column
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PER_SENDER_PER_DAY = 20;
const ALL_PER_DAY = 1000;

const one = (value: unknown, max: number): string | undefined => {
  const t = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t || undefined;
};

export class Feedback {
  constructor(private readonly store: KvStore) {}

  async submit(sender: unknown, body: any): Promise<{ id: string }> {
    const type = String(body?.type ?? "");
    if (!FEEDBACK_TYPES.includes(type as FeedbackType)) throw new AiError("Choose what kind of feedback this is.", 400);
    const message = String(body?.message ?? "").trim();
    if (!message) throw new AiError("Write your feedback first.", 400);
    if (message.length > MESSAGE_MAX) throw new AiError(`Keep your feedback under ${MESSAGE_MAX} characters.`, 400);
    const email = one(body?.email, 254);
    if (email && !EMAIL.test(email)) throw new AiError("That email address doesn't look right. Leave it empty if you don't want an answer.", 400);
    const environment = body?.environment;
    if (environment !== undefined && (typeof environment !== "string" || environment.length > ENVIRONMENT_MAX || !BASE64.test(environment))) {
      throw new AiError("Your environment is too large to attach. Send the feedback without it.", 400);
    }
    // A few lines about what they were doing: at most 20, short.
    const context: Record<string, string> = {};
    if (body?.context && typeof body.context === "object") {
      for (const [k, v] of Object.entries(body.context).slice(0, 20)) {
        const key = one(k, 40), value = one(v, 300);
        if (key && value) context[key] = value;
      }
    }
    await this.count(String(sender ?? "anonymous"));
    const now = new Date();
    // Sortable and unguessable: the time, then random letters.
    const id = `${now.toISOString().replace(/[^\d]/g, "").slice(0, 14)}-${Array.from({ length: 6 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[randomInt(31)]).join("")}`;
    const item: FeedbackItem = {
      id, type: type as FeedbackType, message, name: one(body?.name, 60), email,
      ...(Object.keys(context).length ? { context } : {}), hasEnvironment: !!environment, status: "new", sentOn: now.toISOString()
    };
    await this.store.put("feedback", id, item);
    if (environment) await this.store.put("feedback-environment", id, { data: environment });
    return { id };
  }

  // Newest first.
  async list(): Promise<FeedbackItem[]> {
    return (await this.store.list<FeedbackItem>("feedback")).map((r) => r.value).sort((a, b) => b.sentOn.localeCompare(a.sentOn));
  }

  async update(id: string, change: { status?: unknown; note?: unknown }): Promise<FeedbackItem> {
    const item = await this.find(id);
    if (change.status !== undefined) {
      if (!FEEDBACK_STATUSES.includes(change.status as FeedbackStatus)) throw new AiError("The status is new, read or done.", 400);
      item.status = change.status as FeedbackStatus;
    }
    if (change.note !== undefined) item.note = one(change.note, 1000);
    await this.store.put("feedback", id, item);
    return item;
  }

  async environment(id: string): Promise<{ data: string | null }> {
    await this.find(id);
    return { data: (await this.store.get<{ data: string }>("feedback-environment", id))?.data ?? null };
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.store.remove("feedback", id);
    await this.store.remove("feedback-environment", id);
  }

  private async find(id: string): Promise<FeedbackItem> {
    if (!/^\d{14}-[a-z2-9]{6}$/.test(id)) throw new AiError("No such feedback.", 404);
    const item = await this.store.get<FeedbackItem>("feedback", id);
    if (!item) throw new AiError("No such feedback.", 404);
    return item;
  }

  // At most 20 a day from one browser, and 1000 a day in all.
  private async count(sender: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    const mineKey = `${day}:feedback:${sender.replace(/[^\w-]/g, "").slice(0, 40) || "anonymous"}`, allKey = `${day}:feedback:all`;
    const mine = (await this.store.get<number>("usage", mineKey)) ?? 0, all = (await this.store.get<number>("usage", allKey)) ?? 0;
    if (mine >= PER_SENDER_PER_DAY) throw new AiError("You've sent a lot of feedback today. Thank you! Try again tomorrow.", 429);
    if (all >= ALL_PER_DAY) throw new AiError("The training has had a lot of feedback today. Try again tomorrow.", 429);
    await this.store.put("usage", mineKey, mine + 1);
    await this.store.put("usage", allKey, all + 1);
  }
}
