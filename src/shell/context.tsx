// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { createContext, useContext, useEffect, useState } from "react";
import { Simulator } from "../simulator";
import { Clock } from "../calls/clock";
import { Routing } from "../calls/routing";
import conceptsJson from "../../content/concepts.json";

// What every part of the training screen shares: the simulator, and which explanation the Learn strip shows.

export interface Concept {
  id: string;
  title: string;
  summary: string;
  learn: { title: string; url: string; date: string; checkedOn: string; quote: string };
}

export const CONCEPTS: Map<string, Concept> = new Map(conceptsJson.concepts.map((c) => [c.id, c as Concept]));

export interface Training {
  sim: Simulator;
  // The simulated clock and the routing that runs on it (src/calls/clock.ts, routing.ts).
  clock: Clock;
  routing: Routing;
  // Shows a concept in the Learn strip (an ⓘ on a field, or the current task).
  explain(conceptId: string): void;
}

export const TrainingContext = createContext<Training | undefined>(undefined);

export function useTraining(): Training {
  const t = useContext(TrainingContext);
  if (!t) throw new Error("useTraining outside the training screen");
  return t;
}

// Re-renders when the simulated environment changes, and returns a number that changes with it.
export function useStoreVersion(): number {
  const { sim } = useTraining();
  const [version, setVersion] = useState(0);
  useEffect(() => sim.store.onChange(() => setVersion((v) => v + 1)), [sim]);
  return version;
}
