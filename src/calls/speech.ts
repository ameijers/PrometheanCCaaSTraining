// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// Speech for the phone (manual 5.5, optional): the browser's own speech synthesis reads the IVR, the AI caller
// and the outcome aloud. Off by default, and the training works the same without it. Speech recognition isn't
// used: in Edge and Chrome it sends the microphone's audio to the browser maker's online service.

export type Speaker = "ivr" | "caller" | "narrator";
export interface Line { who: Speaker; text: string }

export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

const KEY = "ccaas.speech";
export function speechOn(): boolean {
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}
export function setSpeechOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* the setting just isn't remembered */ }
  if (!on) stopSpeaking();
}

// English voices, so the IVR and the caller sound different where the browser has more than one.
function voiceFor(who: Speaker): SpeechSynthesisVoice | undefined {
  const english = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (!english.length) return undefined;
  const index = who === "ivr" ? 0 : who === "caller" ? 1 : 2;
  return english[index % english.length];
}

export function speak(lines: Line[]): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  for (const line of lines.filter((l) => l.text.trim())) {
    const u = new SpeechSynthesisUtterance(line.text);
    const voice = voiceFor(line.who);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-GB";
    u.rate = line.who === "caller" ? 1.05 : 1;
    u.pitch = line.who === "caller" ? 1.15 : line.who === "ivr" ? 0.95 : 1;
    synth.speak(u);
  }
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
