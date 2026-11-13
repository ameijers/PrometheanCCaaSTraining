// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { Settings } from "../settings";
import { AzureOpenAiProvider } from "./azureOpenAi";
import { ClaudeProvider } from "./claude";
import { AiProvider } from "./provider";

// Which AI the backend uses, from its settings: AI_PROVIDER when it's set, otherwise whichever has a
// key. Returns why the AI is off when it can't be used, so the backend can say so plainly.
export function chooseProvider(s: Settings): { provider?: AiProvider; off?: string } {
  const wanted = s.provider?.toLowerCase() ?? (s.apiKey ? "claude" : s.azure.apiKey ? "azure-openai" : undefined);
  if (!wanted) return { off: "no API key in backend/.env (see backend/.env.example)" };
  if (wanted === "claude") {
    return s.apiKey ? { provider: new ClaudeProvider(s.apiKey, s.model) } : { off: "AI_PROVIDER is claude, but there's no ANTHROPIC_API_KEY in backend/.env" };
  }
  if (wanted === "azure-openai") {
    const missing = (["endpoint", "apiKey", "deployment"] as const).filter((k) => !s.azure[k]).map((k) => ({ endpoint: "AZURE_OPENAI_ENDPOINT", apiKey: "AZURE_OPENAI_API_KEY", deployment: "AZURE_OPENAI_DEPLOYMENT" })[k]);
    return missing.length
      ? { off: `AI_PROVIDER is azure-openai, but backend/.env has no ${missing.join(", ")}` }
      : { provider: new AzureOpenAiProvider(s.azure.endpoint!, s.azure.apiKey!, s.azure.deployment!) };
  }
  return { off: `AI_PROVIDER “${s.provider}” isn't known: use claude or azure-openai` };
}
