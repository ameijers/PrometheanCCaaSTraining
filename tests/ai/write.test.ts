// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The AI writes, code checks (manual 8.3): a scenario that fails goes back with what failed, up to three
// times, then it's dropped; one that passes is saved. A stand-in for the AI plays its part, so the test
// needs no API key and no network.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MAX_ATTEMPTS, systemPrompt, writeCaller, writeScenario, healthyEnvironment } from "../../backend/src/ai/scenarios";
import { UsageLimits } from "../../backend/src/ai/limits";
import { MemoryStore } from "../../backend/src/kv";
import { AiProvider, Turn } from "../../backend/src/ai/provider";

// A stand-in that answers with each of these in turn, and remembers what it was sent.
function scripted(answers: unknown[]): AiProvider & { seen: Turn[][] } {
  let n = 0;
  const seen: Turn[][] = [];
  return {
    name: "stand-in", seen,
    complete: async (_system, turns) => { seen.push(turns); const json = answers[Math.min(n++, answers.length - 1)]; return { json, text: JSON.stringify(json) }; },
    chat: async () => ""
  };
}

const call = (dial: string, choice: string, answerQueue: string, answerOutcome = "Agent", extra: Record<string, unknown> = {}) =>
  ({ caller: "Hello, I have a question.", dial, choice, day: -1, time: "", estimatedWaitMinutes: -1, waitedSeconds: -1, answerQueue, answerOutcome, ...extra });

const good = {
  title: "Questions on a busy Tuesday",
  story: ["Contoso's service desk is busy today.", "Predict where each call goes."],
  questions: [
    call("+44 20 7946 0102", "Billing", "Billing"),
    call("+44 20 7946 0102", "Repairs", "Overflow"),
    call("+44 20 7946 0105", "2", "Tier 2 Support")
  ]
};
const wrong = { ...good, questions: [call("+44 20 7946 0102", "Billing", "Returns"), ...good.questions.slice(1)] };

describe("writing a scenario", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "scenarios-"));

  test("the AI sees the environment in plain words", async () => {
    const prompt = systemPrompt(await healthyEnvironment());
    expect(prompt).toMatch(/\+44 20 7946 0102 rings the workstream “Customer Service – Voice”/);
    expect(prompt).toMatch(/“Billing”: 8 members, open Monday to Friday, 09:00 to 17:00\. Overflow: Out of operating hours: Voicemail/);
  });

  test("a scenario that fails goes back with what failed, and is saved once it passes", async () => {
    const ai = scripted([wrong, good]);
    const saveDir = dir();
    const written = await writeScenario(ai, "route", 2, { saveDir });
    expect(written.attempts.map((a) => a.problems.length > 0)).toEqual([true, false]);
    expect(ai.seen[1].at(-1)!.text).toMatch(/the call engine says “It waits in “Billing”/);
    expect(written.scenario).toMatchObject({ kind: "route", level: 2, source: "ai", title: good.title });
    expect(fs.readdirSync(saveDir)).toEqual([`${written.scenario!.id}.json`]);
  });

  test("after three failures it's dropped", async () => {
    const saveDir = dir();
    const written = await writeScenario(scripted([wrong]), "route", 2, { saveDir });
    expect(written.scenario).toBeUndefined();
    expect(written.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(fs.readdirSync(saveDir)).toEqual([]);
  });

  test("a fix scenario with faults the health checks find passes", async () => {
    const written = await writeScenario(scripted([{
      title: "Silence on the returns line", story: ["Returns calls ring and ring."],
      faults: [{ type: "no-members", queue: "Returns", workstream: "", rule: "" }]
    }]), "fix", 1);
    expect(written.scenario?.faults).toEqual([{ type: "no-members", queue: "Returns" }]);
  });
});

describe("the AI caller", () => {
  test("a choice the line knows is used, and one it doesn't know is asked for again", async () => {
    const ai = scripted([{ name: "Sam", mood: "calm", says: "My invoice looks wrong.", choice: "Invoices" }, { name: "Sam", mood: "calm", says: "My invoice looks wrong.", choice: "Billing" }]);
    expect(await writeCaller(ai, "+44 20 7946 0102")).toMatchObject({ choice: "Billing" });
    expect(ai.seen).toHaveLength(2);
  });

  test("a line without an IVR gets no choice", async () => {
    await expect(writeCaller(scripted([{ name: "Lou", mood: "rushed", says: "Hi.", choice: "Partner" }]), "+44 20 7946 0108")).rejects.toThrow(/couldn't|didn't/);
  });
});

test("the limits refuse once reached, per learner and per day, and start again the next day", async () => {
  const limits = new UsageLimits(new MemoryStore(), 3, 2);
  const day = new Date("2026-11-03T10:00:00Z");
  const a = "a".repeat(32), b = "b".repeat(32);
  await limits.take(a, day); await limits.take(a, day);
  await expect(limits.take(a, day)).rejects.toThrow(/your 2 AI requests for today/);
  await limits.take(b, day);
  await expect(limits.take(b, day)).rejects.toThrow(/limit of 3 requests a day/);
  await expect(limits.take(a, new Date("2026-11-04T10:00:00Z"))).resolves.toBeUndefined();
});
