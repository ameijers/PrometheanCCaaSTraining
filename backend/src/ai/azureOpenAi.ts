// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { AiError, AiProvider, Turn } from "./provider";

// Azure OpenAI (in Microsoft Foundry), through its v1 REST API: Chat Completions with structured outputs.
// Request shape from Microsoft Learn, "How to use structured outputs with Azure OpenAI in Microsoft
// Foundry Models" (ms.date 2026-08-24), REST tab:
//   POST https://<resource>.openai.azure.com/openai/v1/chat/completions, header api-key,
//   body { model: <deployment name>, messages, response_format: { type: "json_schema", json_schema: { name, strict: true, schema } } }
// A refused request comes back with message.refusal. Strict schemas need every field required and
// additionalProperties false, which the training's schemas have (src/scenarios/scenario.ts outputSchema).
// The deployment must be a model that supports structured outputs (the article lists them).

export class AzureOpenAiProvider implements AiProvider {
  readonly name: string;
  private readonly url: string;

  constructor(endpoint: string, private readonly apiKey: string, private readonly deployment: string, private readonly http: typeof fetch = fetch) {
    // Accepts the resource address with or without /openai/v1.
    this.url = `${endpoint.replace(/\/+$/, "").replace(/\/openai\/v1$/, "")}/openai/v1/chat/completions`;
    this.name = `Azure OpenAI (${deployment})`;
  }

  async complete(system: string, turns: Turn[], schema: Record<string, unknown>): Promise<{ json: unknown; text: string }> {
    const text = await this.send(system, turns, { type: "json_schema", json_schema: { name: "answer", strict: true, schema } });
    try {
      return { json: JSON.parse(text), text };
    } catch {
      throw new AiError("The AI's answer wasn't valid JSON.");
    }
  }

  chat(system: string, turns: Turn[]): Promise<string> {
    return this.send(system, turns);
  }

  private async send(system: string, turns: Turn[], responseFormat?: Record<string, unknown>): Promise<string> {
    let response: Response;
    try {
      response = await this.http(this.url, {
        method: "POST",
        headers: { "api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.deployment,
          messages: [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role, content: t.text }))],
          ...(responseFormat ? { response_format: responseFormat } : {})
        })
      });
    } catch (e) {
      throw new AiError(`Azure OpenAI couldn't be reached: ${e instanceof Error ? e.message : String(e)}`, 503);
    }
    const body: any = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) throw new AiError("The Azure OpenAI key in backend/.env isn't accepted.", 503);
    if (response.status === 404) throw new AiError(`Azure OpenAI has no deployment “${this.deployment}” at this endpoint (AZURE_OPENAI_DEPLOYMENT in backend/.env).`, 503);
    if (response.status === 429) throw new AiError("Azure OpenAI is busy (rate limit). Try again in a minute.", 503);
    if (!response.ok) throw new AiError(`Azure OpenAI answered with an error (${response.status}): ${body?.error?.message ?? "no details"}`);
    const choice = body?.choices?.[0];
    if (choice?.message?.refusal) throw new AiError("Azure OpenAI declined this request.");
    if (choice?.finish_reason === "length") throw new AiError("Azure OpenAI's answer was cut off.");
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (!text.trim()) throw new AiError("Azure OpenAI's answer was empty.");
    return text;
  }
}
