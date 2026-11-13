// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

// The AI providers: Claude sends each model only the options it takes, Azure OpenAI is called the way
// Microsoft Learn documents it, and the backend picks a provider from its settings. No network: Azure's
// is a stand-in, and Claude's request is built without sending it.
import { AzureOpenAiProvider } from "../../backend/src/ai/azureOpenAi";
import { chooseProvider } from "../../backend/src/ai/choose";
import { claudeRequest } from "../../backend/src/ai/claude";
import { Settings } from "../../backend/src/settings";
import { outputSchema } from "../../src/scenarios/scenario";

const turns = [{ role: "user" as const, text: "Write a scenario." }];

describe("Claude: options per model", () => {
  test("Opus 5.5 gets the refusal fallback and an effort level", () => {
    const r = claudeRequest("claude-opus-5-5", "sys", turns, "medium", { type: "object" }) as any;
    expect(r).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "medium", format: { type: "json_schema" } } });
  });

  test("Haiku 5.5 and Sonnet 5.5: effort, and the fallback only where the API offers it", () => {
    const haiku = claudeRequest("claude-haiku-5-5", "sys", turns, "medium", { type: "object" }) as any;
    expect(haiku.fallbacks).toBeUndefined();
    expect(haiku.betas).toBeUndefined();
    expect(haiku.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: { type: "object" } } });
    expect((claudeRequest("claude-sonnet-5-5", "sys", turns, "low") as any)).toMatchObject({ fallbacks: "default", output_config: { effort: "low" } });
  });

  test("an older model gets neither", () => {
    const r = claudeRequest("claude-sonnet-4-6", "sys", turns, "low") as any;
    expect(r.fallbacks).toBeUndefined();
    expect(r.output_config).toBeUndefined();
  });
});

describe("Azure OpenAI", () => {
  const answer = (body: unknown, status = 200) => jest.fn(async () => new Response(JSON.stringify(body), { status }));
  const ok = (content: string) => answer({ choices: [{ finish_reason: "stop", message: { role: "assistant", content, refusal: null } }] });

  test("is called as Microsoft Learn documents the v1 API, with a strict schema", async () => {
    const http = ok('{"title":"A"}');
    const ai = new AzureOpenAiProvider("https://contoso-ai.openai.azure.com/", "key-1", "gpt-5-mini", http as unknown as typeof fetch);
    expect(await ai.complete("sys", turns, { type: "object" })).toEqual({ json: { title: "A" }, text: '{"title":"A"}' });
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://contoso-ai.openai.azure.com/openai/v1/chat/completions");
    expect(init.headers).toMatchObject({ "api-key": "key-1" });
    expect(JSON.parse(String(init.body))).toEqual({
      model: "gpt-5-mini",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "Write a scenario." }],
      response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: { type: "object" } } }
    });
  });

  test("the endpoint may already end in /openai/v1", async () => {
    const http = ok("hi");
    await new AzureOpenAiProvider("https://x.openai.azure.com/openai/v1", "k", "d", http as unknown as typeof fetch).chat("sys", turns);
    expect((http.mock.calls[0] as unknown as [string])[0]).toBe("https://x.openai.azure.com/openai/v1/chat/completions");
  });

  test("a refusal, a missing deployment and a cut-off answer are said plainly", async () => {
    const provider = (http: jest.Mock) => new AzureOpenAiProvider("https://x.openai.azure.com", "k", "gpt-x", http as unknown as typeof fetch);
    await expect(provider(answer({ choices: [{ message: { content: null, refusal: "No." } }] })).chat("s", turns)).rejects.toThrow("declined");
    await expect(provider(answer({ error: { message: "DeploymentNotFound" } }, 404)).chat("s", turns)).rejects.toThrow("no deployment “gpt-x”");
    await expect(provider(answer({ choices: [{ finish_reason: "length", message: { content: "{" } }] })).chat("s", turns)).rejects.toThrow("cut off");
  });
});

test("the training's schemas meet Azure's strict rules: every field required, no extra fields", () => {
  const walk = (s: any, where: string): void => {
    if (s?.type === "object") {
      expect([where, s.additionalProperties]).toEqual([where, false]);
      expect([where, [...s.required].sort()]).toEqual([where, Object.keys(s.properties).sort()]);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${where}.${k}`);
    }
    if (s?.type === "array") walk(s.items, `${where}[]`);
  };
  walk(outputSchema("fix"), "fix");
  walk(outputSchema("route"), "route");
});

describe("choosing the provider", () => {
  const base: Settings = { model: "claude-opus-5-5", azure: {}, dailyLimit: 40, learnerLimit: 15, port: 7071 };
  const azure = { endpoint: "https://x.openai.azure.com", apiKey: "k", deployment: "gpt-5-mini" };

  test("whichever has a key, Claude first", () => {
    expect(chooseProvider({ ...base, apiKey: "a" }).provider?.name).toBe("Claude (claude-opus-5-5)");
    expect(chooseProvider({ ...base, azure }).provider?.name).toBe("Azure OpenAI (gpt-5-mini)");
    expect(chooseProvider({ ...base, apiKey: "a", azure, provider: "azure-openai" }).provider?.name).toBe("Azure OpenAI (gpt-5-mini)");
    expect(chooseProvider({ ...base, apiKey: "a", model: "claude-haiku-5-5" }).provider?.name).toBe("Claude (claude-haiku-5-5)");
  });

  test("says why the AI is off", () => {
    expect(chooseProvider(base).off).toMatch(/no API key/);
    expect(chooseProvider({ ...base, provider: "azure-openai", azure: { apiKey: "k" } }).off).toMatch(/no AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT/);
    expect(chooseProvider({ ...base, provider: "gemini" }).off).toMatch(/isn't known/);
  });
});
