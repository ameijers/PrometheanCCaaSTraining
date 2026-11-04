// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The AI parts phase 7 adds, with a stand-in for the AI: a "Build to requirements" scenario goes through
// check 5 like any other, the AI customer only reveals needs that exist, and a hint must be usable.
import { answerAsCustomer, writeHint, writeScenario } from "../../backend/src/ai/scenarios";
import { AiProvider } from "../../backend/src/ai/provider";
import { Scenario } from "../../src/scenarios/scenario";
import readyMade from "../../content/scenarios/ready-made.json";

const scripted = (answers: unknown[]): AiProvider => {
  let n = 0;
  return { name: "stand-in", complete: async () => { const json = answers[Math.min(n++, answers.length - 1)]; return { json, text: JSON.stringify(json) }; }, chat: async () => "" };
};
const goal = (g: Record<string, unknown>) => ({ queue: "", workstream: "", choice: "", hours: "", action: "", method: "", profile: "", number: 0, ...g });

test("an AI build scenario whose goal is met already goes back, and passes once fixed", async () => {
  const already = { title: "Round robin for billing", story: ["Billing wants calls handed out in turn."], goals: [goal({ type: "assignment-method", queue: "Billing", method: "Least active" })] };
  const fixed = { ...already, goals: [goal({ type: "assignment-method", queue: "Billing", method: "Advanced round robin" })] };
  const written = await writeScenario(scripted([already, fixed]), "build", 4);
  expect(written.attempts[0].problems).toEqual([expect.stringMatching(/already met at the start/)]);
  expect(written.scenario?.goals).toEqual([{ type: "assignment-method", queue: "Billing", method: "Advanced round robin" }]);
});

test("the AI customer's answer only counts needs that exist", async () => {
  const s = readyMade.scenarios.find((x) => x.id === "interview-2-warranty") as Scenario;
  const r = await answerAsCustomer(scripted([{ answer: "We want warranty calls in their own queue.", revealed: [0, 7, -1] }]), s, [], "What about warranty calls?");
  expect(r).toEqual({ answer: "We want warranty calls in their own queue.", revealed: [0] });
  await expect(answerAsCustomer(scripted([{ answer: "Call me on 020 7946 0999.", revealed: [] }]), s, [], "Can I call you?")).rejects.toThrow(/couldn't be used/);
});

test("a hint is used only when it's short enough", async () => {
  expect(await writeHint(scripted([{ hint: "Look at the queue's assignment method." }]), "r", [], { title: "t", quote: "q" })).toBe("Look at the queue's assignment method.");
  await expect(writeHint(scripted([{ hint: "x".repeat(700) }]), "r", [], { title: "t", quote: "q" })).rejects.toThrow(/couldn't be used/);
});
