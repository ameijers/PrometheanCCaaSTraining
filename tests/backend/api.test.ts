// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The backend's request handler (backend/src/api.ts), as the local server and Azure Functions call it:
// classes with their codes and trainer keys, progress, who may write, and the AI's per-learner limit.
import * as os from "os";
import * as path from "path";
import { ApiRequest, createApi } from "../../backend/src/api";
import { AiProvider } from "../../backend/src/ai/provider";
import { MemoryStore } from "../../backend/src/kv";
import { Settings } from "../../backend/src/settings";

const settings: Settings = { model: "m", azure: {}, dailyLimit: 40, learnerLimit: 2, port: 0 };
const stand: AiProvider = { name: "stand-in", complete: async () => ({ json: { hint: "Look at the queue." }, text: "" }), chat: async () => "" };
const SITE = "https://training.example";

function api(provider?: AiProvider) {
  return createApi({ settings, store: new MemoryStore(), cacheDir: path.join(os.tmpdir(), "learn-cache-test"), allowed: (o) => o === SITE, provider });
}
const req = (method: string, p: string, body?: unknown, extra: Partial<ApiRequest> = {}): ApiRequest => {
  const [pathname, query] = p.split("?");
  return { method, path: pathname, query: new URLSearchParams(query ?? ""), origin: SITE, learner: "f".repeat(32), body: async () => body ?? {}, ...extra };
};
const learner = "0123456789abcdef0123456789abcdef";

describe("classes", () => {
  const a = api();

  test("a trainer creates a class, learners report progress, and only the trainer's key shows it", async () => {
    const created = await a.handle(req("POST", "/classes", { name: "Contoso onboarding", scenarios: ["route-1-first-day", "build-2-warranty"] }));
    const { code, trainerKey } = created.body as { code: string; trainerKey: string };
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(trainerKey).toMatch(/^[0-9a-f]{32}$/);

    expect((await a.handle(req("GET", `/classes/${code.toLowerCase()}`))).body).toEqual({ code, name: "Contoso onboarding", scenarios: ["route-1-first-day", "build-2-warranty"] });

    const report = { learnerId: learner, name: "Sam", scenarioId: "build-2-warranty", title: "A menu choice for warranty claims", checks: [{ title: "A voice queue named Warranty", passed: true }, { title: "x", passed: false }], done: false, hints: 1 };
    expect((await a.handle(req("POST", `/classes/${code}/progress`, report))).status).toBe(200);
    expect((await a.handle(req("POST", `/classes/${code}/progress`, { ...report, done: true }))).status).toBe(200);

    expect((await a.handle(req("GET", `/classes/${code}/progress?key=wrong`))).status).toBe(403);
    const seen = (await a.handle(req("GET", `/classes/${code}/progress?key=${trainerKey}`))).body as any;
    expect(seen.progress).toEqual([expect.objectContaining({ name: "Sam", scenarioId: "build-2-warranty", done: true, hints: 1 })]);
  });

  test("bad input is refused in plain words", async () => {
    expect((await a.handle(req("POST", "/classes", { name: "", scenarios: ["x"] }))).body).toEqual({ error: "The class name must be 1 to 60 characters." });
    expect((await a.handle(req("POST", "/classes", { name: "A", scenarios: [] }))).status).toBe(400);
    expect((await a.handle(req("GET", "/classes/ABC"))).body).toEqual({ error: "A class code has 6 letters and digits." });
    expect((await a.handle(req("GET", "/classes/ZZZZZZ"))).status).toBe(404);
  });

  test("a browser can create a few classes a day, not more", async () => {
    const b = api();
    for (let i = 0; i < 10; i++) expect((await b.handle(req("POST", "/classes", { name: `Class ${i}`, scenarios: ["x"] }))).status).toBe(200);
    expect((await b.handle(req("POST", "/classes", { name: "One more", scenarios: ["x"] }))).body).toEqual({ error: "You've created 10 classes today. Try again tomorrow." });
  });

  test("only the training's own pages may write", async () => {
    expect((await a.handle(req("POST", "/classes", { name: "A", scenarios: ["x"] }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await a.handle(req("POST", "/classes", { name: "A", scenarios: ["x"] }, { origin: undefined }))).status).toBe(403);
    expect((await a.handle(req("POST", "/classes/ABCDEF/delete", { key: "k" }, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("a trainer passcode", () => {
  const withPasscode = createApi({ settings: { ...settings, trainerPasscode: "contoso-trainers" }, store: new MemoryStore(), cacheDir: path.join(os.tmpdir(), "learn-cache-test"), allowed: (o) => o === SITE });

  test("is asked for when it's set, and not otherwise", async () => {
    expect((await withPasscode.handle(req("GET", "/trainer"))).body).toEqual({ passcodeRequired: true });
    expect((await api().handle(req("GET", "/trainer"))).body).toEqual({ passcodeRequired: false });
  });

  test("only the right passcode creates a class", async () => {
    const make = (passcode?: string) => withPasscode.handle(req("POST", "/classes", { name: "A", scenarios: ["x"], passcode }));
    expect((await make()).body).toEqual({ error: "That isn't the trainer passcode. Ask whoever runs the training for it." });
    expect((await make("contoso")).status).toBe(403);
    expect((await make("contoso-trainers")).status).toBe(200);
  });
});

describe("managing a class", () => {
  const a = api();
  const other = "fedcba9876543210fedcba9876543210";
  const report = (code: string, who: string) => a.handle(req("POST", `/classes/${code}/progress`, { learnerId: who, name: who === learner ? "Sam" : "Kim", scenarioId: "x", title: "X", checks: [], done: false, hints: 0 }));
  const make = async (extra: object = {}) => (await a.handle(req("POST", "/classes", { name: "Workshop", scenarios: ["x"], ...extra }))).body as { code: string; trainerKey: string };
  const seen = async (code: string, key: string) => (await a.handle(req("GET", `/classes/${code}/progress?key=${key}`))).body as any;

  test("an end date in the past stops joining and progress; the trainer still sees the class and can move it", async () => {
    const { code, trainerKey } = await make({ openUntil: "2020-01-31" });
    expect((await a.handle(req("GET", `/classes/${code}`))).body).toEqual({ error: "The class Workshop ended on 2020-01-31. Ask your trainer." });
    expect((await report(code, learner)).status).toBe(410);
    expect((await seen(code, trainerKey)).class).toMatchObject({ openUntil: "2020-01-31", open: false, closed: false });
    const moved = await a.handle(req("POST", `/classes/${code}/settings`, { key: trainerKey, openUntil: "2999-12-31" }));
    expect(moved.body).toMatchObject({ openUntil: "2999-12-31", open: true });
    expect((await report(code, learner)).status).toBe(200);
    expect((await a.handle(req("POST", `/classes/${code}/settings`, { key: trainerKey, openUntil: "" }))).body).not.toHaveProperty("openUntil");
    expect((await a.handle(req("POST", "/classes", { name: "B", scenarios: ["x"], openUntil: "next week" }))).body).toEqual({ error: "The end date must be a date like 2026-12-31." });
  });

  test("a closed class takes no one until it's reopened", async () => {
    const { code, trainerKey } = await make();
    expect((await a.handle(req("POST", `/classes/${code}/settings`, { key: trainerKey, closed: true }))).body).toMatchObject({ closed: true, open: false });
    expect((await a.handle(req("GET", `/classes/${code}`))).status).toBe(410);
    expect((await report(code, learner)).body).toEqual({ error: "The class Workshop is closed. Ask your trainer." });
    await a.handle(req("POST", `/classes/${code}/settings`, { key: trainerKey, closed: false }));
    expect((await report(code, learner)).status).toBe(200);
  });

  test("a removed learner's progress goes, and they can't report again; the others stay", async () => {
    const { code, trainerKey } = await make();
    await report(code, learner);
    await report(code, other);
    expect((await a.handle(req("POST", `/classes/${code}/remove`, { key: trainerKey, learnerId: learner }))).body).toEqual({ removed: true });
    expect((await seen(code, trainerKey)).progress.map((p: any) => p.name)).toEqual(["Kim"]);
    expect((await report(code, learner)).status).toBe(403);
    expect((await report(code, other)).status).toBe(200);
  });

  test("deleting removes the class and its progress for good", async () => {
    const { code, trainerKey } = await make();
    await report(code, learner);
    expect((await a.handle(req("POST", `/classes/${code}/delete`, { key: trainerKey }))).body).toEqual({ deleted: true });
    expect((await a.handle(req("GET", `/classes/${code}`))).status).toBe(404);
    expect((await a.handle(req("GET", `/classes/${code}/progress?key=${trainerKey}`))).status).toBe(404);
  });

  test("every change needs the trainer's key", async () => {
    const { code } = await make();
    for (const [action, body] of [["settings", { closed: true }], ["remove", { learnerId: learner }], ["delete", {}]] as const) {
      expect((await a.handle(req("POST", `/classes/${code}/${action}`, { ...body, key: "0".repeat(32) }))).status).toBe(403);
      expect((await a.handle(req("POST", `/classes/${code}/${action}`, body))).status).toBe(403);
    }
    expect((await a.handle(req("GET", `/classes/${code}`))).status).toBe(200);
  });
});

test("AI requests need a learner id and stop at the learner's limit", async () => {
  const a = api(stand);
  const hint = (who?: string) => a.handle(req("POST", "/ai/hint", { requirement: "r", checks: [], concept: "queue" }, { learner: who }));
  expect((await hint()).status).toBe(400);
  expect((await hint(learner)).body).toEqual({ hint: "Look at the queue.", concept: "queue" });
  expect((await hint(learner)).status).toBe(200);
  expect(await hint(learner)).toEqual({ status: 429, body: { error: "You've used your 2 AI requests for today. Ready-made scenarios still work." } });
  expect((await a.handle(req("GET", "/ai/status", undefined, { learner }))).body).toMatchObject({ available: true, usedByYou: 2, learnerLimit: 2 });
});

test("a scenario is written one try per request: a failed try comes back with its problems, the next one goes with it", async () => {
  const call = (dial: string, choice: string, answerQueue: string) =>
    ({ caller: "Hello.", dial, choice, day: -1, time: "", estimatedWaitMinutes: -1, waitedSeconds: -1, answerQueue, answerOutcome: "Agent" });
  const good = { title: "Calls on a quiet morning", story: ["Predict where each call goes."], questions: [call("+44 20 7946 0102", "Billing", "Billing"), call("+44 20 7946 0102", "Repairs", "Overflow"), call("+44 20 7946 0105", "2", "Tier 2 Support")] };
  const wrong = { ...good, questions: [call("+44 20 7946 0102", "Billing", "Returns"), ...good.questions.slice(1)] };
  const seen: number[] = [];
  let n = 0;
  const ai: AiProvider = { name: "stand-in", chat: async () => "", complete: async (_s, turns) => { seen.push(turns.length); const json = [wrong, good][n++]; return { json, text: JSON.stringify(json) }; } };
  const a = api(ai);
  const first = (await a.handle(req("POST", "/ai/scenario", { kind: "route", level: 2 }))).body as any;
  expect(first).toMatchObject({ attempt: 1, maxAttempts: 3, problems: [expect.stringMatching(/call engine says/)] });
  const second = (await a.handle(req("POST", "/ai/scenario", { kind: "route", level: 2, previous: [{ text: first.text, problems: first.problems }] }))).body as any;
  expect(second).toMatchObject({ attempt: 2, scenario: { title: "Calls on a quiet morning", source: "ai" } });
  expect(seen).toEqual([1, 3]); // the second try saw the first draft and what failed in it
  expect(((await a.handle(req("GET", "/ai/scenarios"))).body as any).scenarios.map((s: any) => s.title)).toEqual(["Calls on a quiet morning"]);
});
