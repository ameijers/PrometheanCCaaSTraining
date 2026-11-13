// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { CallTime } from "./engine";

// The simulated clock (manual 5.4): the contact center's local time, which can run in real time, run
// faster, stand still, or jump to a day and time. Times are Dates whose UTC fields are the local wall
// clock, the way the routing tester's isWithinOperatingHours reads them.

export const SPEEDS = [0, 1, 10, 60] as const;
export type Speed = (typeof SPEEDS)[number];

// The training starts on Tuesday 3 November 2026 at 10:00.
export const START = Date.UTC(2026, 10, 3, 10, 0);

export class Clock {
  private base: number;
  private realBase: number;
  private listeners = new Set<() => void>();

  constructor(start = START, private speedNow: Speed = 1, private readonly realNow: () => number = () => Date.now()) {
    this.base = start;
    this.realBase = realNow();
  }

  now(): Date {
    return new Date(this.base + (this.realNow() - this.realBase) * this.speedNow);
  }

  get speed(): Speed { return this.speedNow; }

  setSpeed(speed: Speed): void {
    this.rebase();
    this.speedNow = speed;
    this.changed();
  }

  // Jumps to that day and time in the current week (Sunday to Saturday).
  jumpTo(t: CallTime): void {
    const now = this.now();
    const sunday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay());
    const [h, m] = t.time.split(":").map(Number);
    this.base = sunday + ((t.day * 24 + h) * 60 + m) * 60_000;
    this.realBase = this.realNow();
    this.changed();
  }

  set(at: number): void {
    this.base = at;
    this.realBase = this.realNow();
    this.changed();
  }

  callTime(): CallTime {
    const now = this.now();
    return { day: now.getUTCDay(), time: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}` };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private rebase(): void {
    this.base = this.now().getTime();
    this.realBase = this.realNow();
  }

  private changed(): void {
    this.listeners.forEach((l) => l());
  }
}

export const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
