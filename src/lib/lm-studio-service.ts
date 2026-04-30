import OpenAI from "openai";
import type { AISettings } from "./ai-settings";
import { buildLeadUserDataBlock } from "./lead-prompt-block";

/**
 * Chamadas diretas do browser para `http://localhost:1234` disparam CORS (OPTIONS).
 * O LM Studio costuma logar isso como erro em `/v1/chat/completions` ("messages required").
 * Em desenvolvimento, redirecionamos para o proxy do Vite (`/lmstudio/v1`).
 */
function resolveLmStudioBaseUrl(configured: string): string {
  const raw = (configured || "/lmstudio/v1").trim();
  if (raw.startsWith("/")) {
    return typeof window !== "undefined"
      ? `${window.location.origin}${raw}`
      : `http://127.0.0.1:3000${raw}`;
  }
  if (import.meta.env.DEV && typeof window !== "undefined") {
    try {
      const u = new URL(raw);
      if ((u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.port === "1234") {
        return `${window.location.origin}/lmstudio/v1`;
      }
    } catch {
      /* ignore */
    }
  }
  return raw;
}

class LMStudioService {
  private client: OpenAI | null = null;
  private configuredBaseUrl = "";

  configure(settings: AISettings): void {
    const baseURL = resolveLmStudioBaseUrl(settings.lmStudioBaseUrl);
    if (!this.client || this.configuredBaseUrl !== baseURL) {
      this.client = new OpenAI({
        apiKey: settings.openaiApiKey || "lm-studio",
        baseURL,
        dangerouslyAllowBrowser: true,
      });
      this.configuredBaseUrl = baseURL;
    }
  }

  async generateContent(
    systemPrompt: string,
    userInstructions: string,
    leadData: Record<string, unknown>,
    settings: AISettings,
    scrapedContent?: string
  ): Promise<string> {
    if (!this.client) {
      this.configure(settings);
    }

    const dataLine = buildLeadUserDataBlock(leadData, scrapedContent);
    const userContent = `${userInstructions}\n\n${dataLine}`;

    const response = await this.client!.chat.completions.create({
      model: settings.lmStudioModel || "local-model",
      messages: [
        { role: "system", content: systemPrompt.trim() },
        { role: "user", content: userContent.trim() },
      ],
      temperature: settings.temperature || 0.7,
      max_tokens: settings.maxTokens || 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Resposta vazia do LM Studio");
    }
    return content;
  }
}

export const lmStudioService = new LMStudioService();
