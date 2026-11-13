// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Reading a call aloud (src/calls/speech.ts), with a stand-in for the browser's speech synthesis.
import { canSpeak, setSpeechOn, speak, speechOn } from "../../src/calls/speech";

const g = globalThis as Record<string, unknown>;

afterEach(() => { delete g.window; delete g.SpeechSynthesisUtterance; delete g.localStorage; });

test("without speech synthesis nothing happens and the setting stays off", () => {
  expect(canSpeak()).toBe(false);
  expect(() => speak([{ who: "ivr", text: "Hello" }])).not.toThrow();
  expect(speechOn()).toBe(false);
});

test("the IVR, the caller and the outcome are spoken in order, with different voices", () => {
  const spoken: { text: string; voice?: { name: string } }[] = [];
  let cancelled = 0;
  const voices = [{ name: "A", lang: "en-GB" }, { name: "B", lang: "en-US" }, { name: "C", lang: "nl-NL" }];
  g.SpeechSynthesisUtterance = class { voice?: { name: string }; lang = ""; rate = 1; pitch = 1; constructor(public text: string) {} };
  g.window = { speechSynthesis: { getVoices: () => voices, cancel: () => cancelled++, speak: (u: { text: string; voice?: { name: string } }) => spoken.push(u) } };
  speak([{ who: "ivr", text: "Press one for sales." }, { who: "caller", text: "Sales, please." }, { who: "narrator", text: "" }, { who: "narrator", text: "The call waits in Sales." }]);
  expect(cancelled).toBe(1);
  expect(spoken.map((u) => u.text)).toEqual(["Press one for sales.", "Sales, please.", "The call waits in Sales."]);
  expect(spoken[0].voice?.name).toBe("A");
  expect(spoken[1].voice?.name).toBe("B");
});

test("the setting is remembered when the browser allows it", () => {
  const items = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) };
  setSpeechOn(true);
  expect(speechOn()).toBe(true);
  setSpeechOn(false);
  expect(speechOn()).toBe(false);
});
