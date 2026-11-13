// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The simulated clock (manual 5.4): runs in real time or faster, stands still, jumps; and a call made
// at the clock's time follows operating hours.
import { Clock } from "../../src/calls/clock";
import { placeCall } from "../../src/calls/engine";
import { createSimulator } from "../../src/simulator";
import { installGlobalXrm } from "../simulator/helpers";

test("runs at its speed, stands still, and jumps to a day and time in the same week", () => {
  let real = 0;
  const clock = new Clock(undefined, 1, () => real);
  expect(clock.callTime()).toEqual({ day: 2, time: "10:00" }); // Tuesday 3 November 2026, 10:00
  real += 5 * 60_000;
  expect(clock.callTime().time).toBe("10:05");
  clock.setSpeed(60);
  real += 60_000; // one real minute is an hour
  expect(clock.callTime().time).toBe("11:05");
  clock.setSpeed(0);
  real += 3_600_000;
  expect(clock.callTime().time).toBe("11:05");
  clock.jumpTo({ day: 6, time: "22:30" });
  expect(clock.callTime()).toEqual({ day: 6, time: "22:30" });
  expect(clock.now().toISOString()).toBe("2026-11-07T22:30:00.000Z");
});

test("a sales call at the clock's time follows the queue's operating hours", async () => {
  const sim = createSimulator();
  installGlobalXrm(sim.xrm);
  const clock = new Clock(undefined, 0);
  const call = () => placeCall(sim.store, { dial: "+44 20 7946 0100", answers: { SelectedMenuItem: "Sales" }, at: clock.callTime() }, { record: false });
  expect((await call()).outcome).toBe("Agent");
  clock.jumpTo({ day: 2, time: "22:00" });
  expect((await call()).outcome).toBe("Voicemail");
});
