// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// The backend's request handler (backend/src/api.ts), as the local server and Azure Functions call it:
// classes with their codes and trainer keys, progress, who may write, and the AI's per-learner limit.
import * as os from "os";
import * as path from "path";
import { ApiRequest, createApi, readPrincipal } from "../../backend/src/api";
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

  test("a lab's parts and what the learner is on now are kept, cleaned up", async () => {
    const { code, trainerKey } = (await a.handle(req("POST", "/classes", { name: "Labs", scenarios: ["lab-queues-people"] }))).body as { code: string; trainerKey: string };
    const since = new Date(Date.now() - 12 * 60_000).toISOString();
    await a.handle(req("POST", `/classes/${code}/progress`, {
      learnerId: learner, name: "Sam", scenarioId: "lab-queues-people", title: "Lab 4", checks: [], done: false, hints: 0,
      parts: { learn: { read: 5, pages: 5, done: true }, do: { passed: 2.7, tasks: 500, done: "yes" }, challenge: { done: -3, of: 1 }, extra: { x: 1 } },
      current: { title: "  Add at least two users   to Priority Customers ", since }
    }));
    const p = ((await a.handle(req("GET", `/classes/${code}/progress?key=${trainerKey}`))).body as any).progress[0];
    expect(p.parts).toEqual({ learn: { read: 5, pages: 5, done: true }, do: { passed: 2, tasks: 99, done: false }, challenge: { done: 0, of: 1 } });
    expect(p.current).toEqual({ title: "Add at least two users to Priority Customers", since });
    // A "since" in the future becomes now.
    await a.handle(req("POST", `/classes/${code}/progress`, { learnerId: learner, name: "Sam", scenarioId: "lab-queues-people", title: "Lab 4", checks: [], done: false, hints: 0, current: { title: "Quiz", since: "2999-01-01T00:00:00Z" } }));
    const later = ((await a.handle(req("GET", `/classes/${code}/progress?key=${trainerKey}`))).body as any).progress[0];
    expect(Date.parse(later.current.since)).toBeLessThanOrEqual(Date.now());
    expect(later.parts).toBeUndefined();
  });

  test("the detail for the learner's page is kept within limits, and only the trainer sees a learner's work", async () => {
    const { code, trainerKey } = (await a.handle(req("POST", "/classes", { name: "Detail", scenarios: ["lab-orientation"] }))).body as { code: string; trainerKey: string };
    const at = new Date(Date.now() - 60_000).toISOString();
    await a.handle(req("POST", `/classes/${code}/progress`, {
      learnerId: learner, name: "Sam", scenarioId: "lab-orientation", title: "Lab 1", checks: [], done: false, hints: 1,
      detail: {
        quiz: [{ question: "What decides the queue?", answer: "The rules", right: true, tries: 2 }],
        tasks: [{ title: "Which queue?", passed: false, hints: 1, answer: "Overflow", note: "“Overflow” isn't it." }],
        events: [...Array.from({ length: 100 }, (_, i) => ({ at, what: `Read page ${i}`, kind: "read" })), { at: "not a date", what: "x", kind: "read" }, { at, what: "Odd", kind: "hacked" }],
        extra: "ignored"
      }
    }));
    const p = ((await a.handle(req("GET", `/classes/${code}/progress?key=${trainerKey}`))).body as any).progress[0];
    expect(p.detail.quiz).toEqual([{ question: "What decides the queue?", answer: "The rules", right: true, tries: 2 }]);
    expect(p.detail.tasks[0]).toMatchObject({ title: "Which queue?", passed: false, hints: 1, answer: "Overflow" });
    expect(p.detail.events).toHaveLength(79); // the last 80, less the one without a time
    expect(p.detail.events.at(-1)).toEqual({ at, what: "Odd", kind: "start" });
    expect(p.detail.extra).toBeUndefined();

    // The learner's work: the trainer may read it with the key; nobody else.
    await a.handle(req("POST", `/classes/${code}/work`, { scenarioId: "lab-orientation", data: "SGVsbG8=" }, { learner }));
    expect((await a.handle(req("GET", `/classes/${code}/work/${learner}/lab-orientation?key=${trainerKey}`))).body).toMatchObject({ work: { data: "SGVsbG8=" } });
    expect((await a.handle(req("GET", `/classes/${code}/work/${learner}/lab-orientation?key=wrong`))).status).toBe(403);
    expect((await a.handle(req("GET", `/classes/${code}/work/${learner}/build-2-warranty?key=${trainerKey}`))).status).toBe(400);
  });

  test("a progress record always fits in one Table Storage column: the oldest events go first", async () => {
    const { fit } = await import("../../backend/src/classes");
    const at = new Date().toISOString();
    const long = "x".repeat(160);
    const p = {
      learnerId: learner, name: "Sam", scenarioId: "lab-orientation", title: "Lab 1", checks: [], done: false, hints: 0, updatedOn: at,
      detail: {
        quiz: Array.from({ length: 12 }, () => ({ question: long + long, answer: long, right: false, tries: 3 })),
        tasks: Array.from({ length: 20 }, () => ({ title: long, passed: false, hints: 2, answer: long, note: long + long })),
        events: Array.from({ length: 80 }, (_, i) => ({ at, what: `${i} ${long}`, kind: "read" }))
      }
    };
    expect(JSON.stringify(p).length).toBeGreaterThan(30_000);
    const kept = fit(p as any);
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(30_000);
    expect(kept.detail?.quiz).toHaveLength(12);
    // The newest events stay.
    expect(kept.detail?.events?.at(-1)?.what.startsWith("79 ")).toBe(true);
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

  test("a learner who joins shows up straight away, once, and goes when removed", async () => {
    const { code, trainerKey } = await make();
    const join = (who: string, name: string) => a.handle(req("POST", `/classes/${code}/join`, { learnerId: who, name }));
    expect((await join(learner, "Sam")).body).toMatchObject({ code, name: "Workshop", scenarios: ["x"], you: { name: "Sam", done: [] } });
    await join(learner, "Sam");
    await report(code, other); // sent progress without joining (joined before joins were recorded)
    expect((await seen(code, trainerKey)).members.map((m: any) => m.name)).toEqual(["Kim", "Sam"]);
    await a.handle(req("POST", `/classes/${code}/remove`, { key: trainerKey, learnerId: learner }));
    expect((await seen(code, trainerKey)).members.map((m: any) => m.name)).toEqual(["Kim"]);
    expect((await join(learner, "Sam")).status).toBe(403);
    await a.handle(req("POST", `/classes/${code}/settings`, { key: trainerKey, closed: true }));
    expect((await join(other, "Kim")).status).toBe(410);
  });

  test("a learner carries on in another browser with their personal code, work and all", async () => {
    const { code, trainerKey } = await make();
    const joined = (await a.handle(req("POST", `/classes/${code}/join`, { learnerId: learner, name: "Sam" }))).body as any;
    const personal = joined.you.rejoinCode;
    expect(personal).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    // Joining again (the page opening) keeps the code.
    expect(((await a.handle(req("POST", `/classes/${code}/join`, { learnerId: learner, name: "Sam" }))).body as any).you.rejoinCode).toBe(personal);
    await a.handle(req("POST", `/classes/${code}/progress`, { learnerId: learner, name: "Sam", scenarioId: "x", title: "X", checks: [], done: true, hints: 0 }));

    // Work is saved and read with the learner's id (header X-Learner), only for the class's exercises.
    const data = Buffer.from("packed work").toString("base64");
    const save = (who: string, body: object) => a.handle(req("POST", `/classes/${code}/work`, body, { learner: who }));
    expect((await save(learner, { scenarioId: "x", data })).body).toEqual({ saved: true });
    expect((await save(learner, { scenarioId: "other", data })).status).toBe(400);
    expect((await save(learner, { scenarioId: "x", data: "not base64!" })).status).toBe(400);
    expect((await save(learner, { scenarioId: "x", data: "A".repeat(30_004) })).status).toBe(400);
    expect((await save(other, { scenarioId: "x", data })).body).toEqual({ error: "Join the class first." });

    // Another browser: the personal code gives back the same learner, what they finished, and their work.
    const back = (await a.handle(req("POST", `/classes/${code}/rejoin`, { rejoinCode: personal.toLowerCase() }, { learner: other }))).body as any;
    expect(back.you).toEqual({ learnerId: learner, name: "Sam", rejoinCode: personal, done: ["x"] });
    expect(((await a.handle(req("GET", `/classes/${code}/work/x`, undefined, { learner }))).body as any).work).toMatchObject({ data });
    expect((await a.handle(req("POST", `/classes/${code}/rejoin`, { rejoinCode: "ZZZZZZ" }))).status).toBe(404);
    expect((await seen(code, trainerKey)).members).toEqual([expect.objectContaining({ name: "Sam", rejoinCode: personal })]);

    // Removed: the code, the work and the learner go.
    await a.handle(req("POST", `/classes/${code}/remove`, { key: trainerKey, learnerId: learner }));
    expect((await a.handle(req("POST", `/classes/${code}/rejoin`, { rejoinCode: personal }))).status).toBe(404);
    expect((await a.handle(req("GET", `/classes/${code}/work/x`, undefined, { learner }))).status).toBe(403);
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

describe("a signed-in trainer", () => {
  const a = createApi({ settings: { ...settings, trainerPasscode: "contoso-trainers" }, store: new MemoryStore(), cacheDir: path.join(os.tmpdir(), "learn-cache-test"), allowed: (o) => o === SITE });
  const ann = { id: "ann-1", name: "ann@contoso.example", roles: ["anonymous", "authenticated", "trainer"] };
  const bob = { id: "bob-2", name: "bob@contoso.example", roles: ["anonymous", "authenticated", "trainer"] };
  const as = (user: typeof ann | undefined, method: string, p: string, body?: unknown) => a.handle(req(method, p, body, { user }));

  test("says who is signed in, and whether they're a trainer", async () => {
    expect((await as(undefined, "GET", "/me")).body).toEqual({ signedIn: false, trainer: false, admin: false });
    expect((await as(ann, "GET", "/me")).body).toEqual({ signedIn: true, name: "ann@contoso.example", trainer: true, admin: false });
    expect((await as({ ...ann, roles: ["anonymous", "authenticated"] }, "GET", "/me")).body).toMatchObject({ signedIn: true, trainer: false });
  });

  test("only a trainer gets the trainer's routes", async () => {
    expect(await as(undefined, "GET", "/manage/classes")).toEqual({ status: 401, body: { error: "Sign in as a trainer first." } });
    expect((await as({ ...ann, roles: ["authenticated"] }, "POST", "/manage/classes", { name: "A", scenarios: ["x"] })).status).toBe(403);
  });

  test("creates classes without the passcode, sees only their own, and manages them without the key", async () => {
    const made = (await as(ann, "POST", "/manage/classes", { name: "Ann's class", scenarios: ["x"], openUntil: "2999-01-31" })).body as { code: string };
    await as(bob, "POST", "/manage/classes", { name: "Bob's class", scenarios: ["x"] });
    await a.handle(req("POST", `/classes/${made.code}/progress`, { learnerId: learner, name: "Sam", scenarioId: "x", title: "X", checks: [], done: false, hints: 0 }));
    const list = ((await as(ann, "GET", "/manage/classes")).body as any).classes;
    expect(list).toEqual([expect.objectContaining({ code: made.code, name: "Ann's class", openUntil: "2999-01-31", open: true, learners: 1 })]);
    expect(((await as(ann, "GET", `/manage/classes/${made.code}`)).body as any).progress).toHaveLength(1);
    expect((await as(bob, "GET", `/manage/classes/${made.code}`)).body).toEqual({ error: "This class isn't in your list. Add it with its trainer link." });
    expect((await as(bob, "POST", `/manage/classes/${made.code}/delete`)).status).toBe(403);
    expect((await as(ann, "POST", `/manage/classes/${made.code}/settings`, { closed: true })).body).toMatchObject({ closed: true });
    expect((await as(ann, "POST", `/manage/classes/${made.code}/remove`, { learnerId: learner })).body).toEqual({ removed: true });
    expect((await as(ann, "POST", `/manage/classes/${made.code}/delete`)).body).toEqual({ deleted: true });
    expect(((await as(ann, "GET", "/manage/classes")).body as any).classes).toEqual([]);
  });

  test("adds a class made with a trainer link to their list, once", async () => {
    const { code, trainerKey } = (await as(undefined, "POST", "/classes", { name: "Old class", scenarios: ["x"], passcode: "contoso-trainers" })).body as { code: string; trainerKey: string };
    expect((await as(ann, "POST", "/manage/claim", { code, key: "0".repeat(32) })).status).toBe(403);
    expect((await as(ann, "POST", "/manage/claim", { code, key: trainerKey })).body).toMatchObject({ code, name: "Old class" });
    expect(((await as(ann, "GET", "/manage/classes")).body as any).classes.map((c: any) => c.code)).toContain(code);
    expect((await as(bob, "POST", "/manage/claim", { code, key: trainerKey })).body).toEqual({ error: "Another trainer already has this class in their list." });
    // The trainer link still works.
    expect((await a.handle(req("GET", `/classes/${code}/progress?key=${trainerKey}`))).status).toBe(200);
  });
});

test("Static Web Apps' client principal is read, and anything else is ignored", () => {
  const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
  expect(readPrincipal(encode({ identityProvider: "aad", userId: "abc123", userDetails: "ann@contoso.example", userRoles: ["anonymous", "authenticated", "trainer"] })))
    .toEqual({ id: "abc123", name: "ann@contoso.example", roles: ["anonymous", "authenticated", "trainer"] });
  expect(readPrincipal(undefined)).toBeUndefined();
  expect(readPrincipal("not base64 json")).toBeUndefined();
  expect(readPrincipal(encode({ userId: "a/b", userRoles: ["trainer"] }))).toBeUndefined();
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

describe("feedback", () => {
  const a = createApi({ settings, store: new MemoryStore(), cacheDir: path.join(os.tmpdir(), "learn-cache-test"), allowed: (o) => o === SITE });
  const ada = { id: "ada-1", name: "ada@contoso.example", roles: ["anonymous", "authenticated", "admin"] };
  const tim = { id: "tim-2", name: "tim@contoso.example", roles: ["anonymous", "authenticated", "trainer"] };
  const as = (user: typeof ada | undefined, method: string, p: string, body?: unknown) => a.handle(req(method, p, body, { user }));

  test("anyone sends feedback; only an admin reads, marks and deletes it", async () => {
    const sent = await a.handle(req("POST", "/feedback", {
      type: "content", message: "  Lab 4 says Do not disturb, the menu says Busy - DND.  ", name: "Sam", email: "sam@example.com",
      context: { Lab: "4: Queues and representatives, Learn", Tab: "Lab", "": "dropped" }, environment: "SGVsbG8="
    }));
    expect(sent.status).toBe(200);
    const { id } = sent.body as { id: string };
    expect(id).toMatch(/^\d{14}-[a-z2-9]{6}$/);

    expect((await as(undefined, "GET", "/admin/feedback")).status).toBe(401);
    expect((await as(tim, "GET", "/admin/feedback")).status).toBe(403);
    const list = ((await as(ada, "GET", "/admin/feedback")).body as any).feedback;
    expect(list).toEqual([expect.objectContaining({ id, type: "content", message: "Lab 4 says Do not disturb, the menu says Busy - DND.", name: "Sam", email: "sam@example.com", context: { Lab: "4: Queues and representatives, Learn", Tab: "Lab" }, hasEnvironment: true, status: "new" })]);
    expect(((await as(ada, "GET", `/admin/feedback/${id}/environment`)).body as any).data).toBe("SGVsbG8=");

    expect(((await as(ada, "POST", `/admin/feedback/${id}`, { status: "done", note: "Fixed the wording." })).body as any)).toMatchObject({ status: "done", note: "Fixed the wording." });
    expect((await as(ada, "POST", `/admin/feedback/${id}`, { status: "lost" })).status).toBe(400);
    expect((await as(ada, "POST", `/admin/feedback/${id}/delete`)).status).toBe(200);
    expect(((await as(ada, "GET", "/admin/feedback")).body as any).feedback).toEqual([]);
  });

  test("bad feedback is refused in plain words", async () => {
    expect((await a.handle(req("POST", "/feedback", { type: "rant", message: "x" }))).body).toEqual({ error: "Choose what kind of feedback this is." });
    expect((await a.handle(req("POST", "/feedback", { type: "idea", message: "   " }))).body).toEqual({ error: "Write your feedback first." });
    expect((await a.handle(req("POST", "/feedback", { type: "idea", message: "Hi", email: "not-an-email" }))).status).toBe(400);
    expect((await a.handle(req("POST", "/feedback", { type: "idea", message: "Hi", environment: "not base64!" }))).status).toBe(400);
    expect((await a.handle(req("POST", "/feedback", { type: "idea", message: "Hi" }, { origin: "https://elsewhere.example" }))).status).toBe(403);
  });
});
