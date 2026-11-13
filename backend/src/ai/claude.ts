// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import Anthropic from "@anthropic-ai/sdk";
import { AiError, AiProvider, Turn } from "./provider";

// Claude through the Anthropic API (decision 15.3). Structured outputs make the answer valid JSON of
// the schema; whether the scenario is any good is still decided by code (src/scenarios/validate.ts).
// Any Claude model can be set with AI_MODEL; options a model doesn't accept aren't sent (claudeRequest).

// Models that take the API's "fallbacks: default" (another model answers when a request is declined).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
// Models that take an effort level: the current (5.x) generation.
const EFFORT_MODELS = /^claude-(fable|opus|sonnet|haiku)-5(\b|-)/;

// The request for a model: pure, so a test can check what each model is sent.
export function claudeRequest(model: string, system: string, turns: Turn[], effort: "low" | "medium", format?: Record<string, unknown>): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const fallbacks = FALLBACK_MODELS.has(model);
  const outputConfig: Anthropic.Beta.Messages.BetaOutputConfig = {
    ...(EFFORT_MODELS.test(model) ? { effort } : {}),
    ...(format ? { format: { type: "json_schema", schema: format } } : {})
  };
  return {
    model,
    max_tokens: 16000,
    ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    system,
    messages: turns.map((t) => ({ role: t.role, content: t.text }))
  };
}

export class ClaudeProvider implements AiProvider {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey });
    this.name = `Claude (${model})`;
  }

  async complete(system: string, turns: Turn[], schema: Record<string, unknown>): Promise<{ json: unknown; text: string }> {
    const text = await this.send(claudeRequest(this.model, system, turns, "medium", schema));
    try {
      return { json: JSON.parse(text), text };
    } catch {
      throw new AiError("The AI's answer wasn't valid JSON.");
    }
  }

  chat(system: string, turns: Turn[]): Promise<string> {
    return this.send(claudeRequest(this.model, system, turns, "low"));
  }

  private async send(request: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<string> {
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.client.beta.messages.create(request);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AiError("The Claude API key in backend/.env isn't accepted.", 503);
      if (e instanceof Anthropic.RateLimitError) throw new AiError("Claude is busy (rate limit). Try again in a minute.", 503);
      if (e instanceof Anthropic.NotFoundError) throw new AiError(`Claude doesn't know the model “${this.model}” (AI_MODEL in backend/.env).`, 503);
      if (e instanceof Anthropic.APIError) throw new AiError(`Claude answered with an error (${e.status}): ${e.message}`);
      throw new AiError(`Claude couldn't be reached: ${e instanceof Error ? e.message : String(e)}`, 503);
    }
    if (response.stop_reason === "refusal") throw new AiError("Claude declined this request.");
    if (response.stop_reason === "max_tokens") throw new AiError("Claude's answer was cut off.");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    if (!text.trim()) throw new AiError("Claude's answer was empty.");
    return text;
  }
}
