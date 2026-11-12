// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { useTraining } from "../shell/context";
import { Speed, SPEEDS } from "./clock";
import { DAYS } from "./engine";

// The contact center's clock, in a bar above the Phone, Agent and Diagram tabs: its local time, how fast it
// runs, and a jump to a day and time.

const SPEED_LABELS: Record<Speed, string> = { 0: "Stopped", 1: "Real time", 10: "10× faster", 60: "60× faster" };

export function ClockBar() {
  const { clock } = useTraining();
  const [, setTick] = useState(0);
  const [jumping, setJumping] = useState(false);
  const [day, setDay] = useState(String(clock.callTime().day));
  const [time, setTime] = useState("22:00");
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    const off = clock.onChange(() => setTick((t) => t + 1));
    return () => { clearInterval(timer); off(); };
  }, [clock]);
  const now = clock.callTime();

  return (
    <span className="clock" title="The contact center's local time. Operating hours and calls use it.">
      <span className="clock-time">{DAYS[now.day]} {now.time}</span>
      <select aria-label="Clock speed" value={clock.speed} onChange={(e) => clock.setSpeed(Number(e.target.value) as Speed)}>
        {SPEEDS.map((s) => <option key={s} value={s}>{SPEED_LABELS[s]}</option>)}
      </select>
      {jumping ? (
        <span className="clock-jump">
          <select aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          <input aria-label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button onClick={() => { if (/^\d\d:\d\d$/.test(time)) clock.jumpTo({ day: Number(day), time }); setJumping(false); }}>Go</button>
          <button onClick={() => setJumping(false)}>Cancel</button>
        </span>
      ) : <button onClick={() => setJumping(true)}>Jump to…</button>}
    </span>
  );
}
