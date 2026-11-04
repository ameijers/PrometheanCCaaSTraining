// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { KvStore } from "../kv";
import { AiError } from "./provider";

// Limits on AI requests (manual 8.4): per day for the whole training, and per learner per day, so one
// learner can't use up a class's budget. Kept in the backend's store, so a restart doesn't reset them.
// Scenarios that pass are saved and reused, so most learners never need a new one.

const day = (d: Date) => d.toISOString().slice(0, 10);

export class UsageLimits {
  constructor(private readonly store: KvStore, readonly daily: number, readonly perLearner: number) {}

  async used(now = new Date(), learner?: string): Promise<{ today: number; learner: number }> {
    const today = (await this.store.get<number>("usage", day(now))) ?? 0;
    const mine = learner ? (await this.store.get<number>("usage", `${day(now)}:${learner}`)) ?? 0 : 0;
    return { today, learner: mine };
  }

  // Counts one request, or refuses when a limit is reached.
  async take(learner: string, now = new Date()): Promise<void> {
    const { today, learner: mine } = await this.used(now, learner);
    if (today >= this.daily) throw new AiError(`The AI's limit of ${this.daily} requests a day is reached. Ready-made scenarios still work.`, 429);
    if (mine >= this.perLearner) throw new AiError(`You've used your ${this.perLearner} AI requests for today. Ready-made scenarios still work.`, 429);
    await this.store.put("usage", day(now), today + 1);
    await this.store.put("usage", `${day(now)}:${learner}`, mine + 1);
  }
}
