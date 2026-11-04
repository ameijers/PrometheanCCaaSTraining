// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";

// The backend's settings. Secrets live only here (manual 14): in backend/.env, which git ignores, or in
// the environment. The browser never sees them. backend/.env.example lists them.
//
//   AI_PROVIDER              claude or azure-openai. Default: whichever has a key (Claude first).
//   ANTHROPIC_API_KEY        Claude (decision 15.3)
//   AI_MODEL                 the Claude model, default claude-opus-5-5
//   AZURE_OPENAI_ENDPOINT    Azure OpenAI: https://<resource>.openai.azure.com
//   AZURE_OPENAI_API_KEY
//   AZURE_OPENAI_DEPLOYMENT  the deployment name of a model that supports structured outputs
//   AI_DAILY_LIMIT           AI requests per day for the whole training, default 40 (manual 8.4)
//   AI_LEARNER_LIMIT         AI requests per learner per day, default 15
// Without a key, the AI is switched off and the training runs on ready-made scenarios.

export const ROOT = path.resolve(__dirname, "../..");

const envFile = path.join(ROOT, "backend/.env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (name: string) => process.env[name]?.trim() || undefined;

export interface Settings {
  provider?: string;
  apiKey?: string;
  model: string;
  azure: { endpoint?: string; apiKey?: string; deployment?: string };
  dailyLimit: number;
  learnerLimit: number;
  port: number;
}

export const settings: Settings = {
  provider: env("AI_PROVIDER"),
  apiKey: env("ANTHROPIC_API_KEY"),
  model: env("AI_MODEL") ?? "claude-opus-5-5",
  azure: { endpoint: env("AZURE_OPENAI_ENDPOINT"), apiKey: env("AZURE_OPENAI_API_KEY"), deployment: env("AZURE_OPENAI_DEPLOYMENT") },
  dailyLimit: Number(env("AI_DAILY_LIMIT") ?? 40),
  learnerLimit: Number(env("AI_LEARNER_LIMIT") ?? 15),
  port: Number(env("PORT") ?? 7071)
};
