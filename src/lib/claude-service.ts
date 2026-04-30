import Anthropic from "@anthropic-ai/sdk";
import { AISettings } from "./ai-settings";
import { buildLeadUserDataBlock } from "./lead-prompt-block";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
const CLAUDE_MODEL_ALIASES: Record<string, string> = {
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-5",
  "claude-3-5-haiku-20241022": "claude-haiku-4-5",
  "claude-3-7-sonnet-20250219": "claude-sonnet-4-5",
  "claude-sonnet-4-20250514": "claude-sonnet-4-5",
  "claude-3-opus-20240229": "claude-opus-4-5",
};
const VALID_CLAUDE_MODELS = new Set([
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-opus-4-5",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5-20251101",
]);

function resolveClaudeModel(model?: string): string {
  if (!model) {
    return DEFAULT_CLAUDE_MODEL;
  }
  if (VALID_CLAUDE_MODELS.has(model)) {
    return model;
  }
  const mapped = CLAUDE_MODEL_ALIASES[model];
  if (mapped) {
    console.warn(`Modelo Claude ${model} mapeado para ${mapped}`);
    return mapped;
  }
  console.warn(`Modelo Claude ${model} inválido, usando ${DEFAULT_CLAUDE_MODEL}`);
  return DEFAULT_CLAUDE_MODEL;
}

class ClaudeService {
  private client: Anthropic | null = null;
  private lastRequestTime: number = 0;
  private readonly minRequestInterval = 100; // 100ms entre requisições (até 10 req/s) para evitar rate limit

  /**
   * Configura o cliente Claude com a API key
   */
  configure(apiKey: string): void {
    if (!apiKey) {
      throw new Error("API key da Claude (Anthropic) é obrigatória");
    }

    this.client = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true, // Necessário para executar no navegador
    });
  }

  /**
   * Aguarda o intervalo mínimo entre requisições (rate limiting)
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Retry com exponential backoff, especialmente para rate limit (429)
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5,
    initialDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const status = error?.status || error?.statusCode || error?.response?.status;
        if (status === 400 || status === 401 || status === 403 || status === 404) {
          const message =
            status === 404
              ? "Modelo Claude inválido ou sem acesso. Verifique o modelo nas configurações."
              : "Erro de autenticação ou requisição inválida na API Claude.";
          throw new Error(message);
        }

        // Se for o último retry, lança o erro
        if (attempt === maxRetries) {
          break;
        }

        // Para rate limit (429), usa backoff mais agressivo e espera mais tempo
        if (status === 429) {
          // Tenta extrair o retry-after do header
          const retryAfter = error?.response?.headers?.['retry-after'] ||
            error?.headers?.['retry-after'] ||
            error?.retryAfter;

          if (retryAfter) {
            // Espera o tempo especificado pelo servidor (em segundos)
            const waitTime = parseInt(retryAfter, 10) * 1000;
            console.warn(`Rate limit atingido. Aguardando ${waitTime / 1000}s conforme retry-after header`);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          } else {
            // Exponential backoff mais agressivo para 429: 2s, 4s, 8s, 16s, 32s
            const delay = Math.min(initialDelay * Math.pow(2, attempt + 1), 30000); // Máximo 30s
            console.warn(`Rate limit atingido. Aguardando ${delay / 1000}s antes do retry ${attempt + 1}/${maxRetries}`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        } else {
          // Para outros erros, usa backoff normal
          const delay = initialDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error("Erro desconhecido ao fazer requisição");
  }

  /**
   * Gera conteúdo usando Claude
   */
  async generateContent(
    systemPrompt: string,
    userInstructions: string,
    leadData: Record<string, any>,
    settings: AISettings,
    scrapedContent?: string
  ): Promise<string> {
    if (!this.client) {
      throw new Error(
        "Cliente Claude não configurado. Configure primeiro com configure(apiKey)"
      );
    }

    await this.waitForRateLimit();

    const dataLine = buildLeadUserDataBlock(leadData, scrapedContent);
    const userContent = `${userInstructions}\n\n${dataLine}`;

    const model = resolveClaudeModel(settings.claudeModel);
    const makeRequest = async () => {
      const response = await this.client!.messages.create({
        model: model,
        max_tokens: settings.maxTokens || 1000,
        temperature: settings.temperature || 0.7,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Resposta da Claude não é texto");
      }

      if (!content.text) {
        throw new Error("Resposta vazia da API Claude");
      }

      return content.text;
    };

    return this.retryWithBackoff(makeRequest);
  }

  /**
   * Gera resposta de chat com histórico de mensagens
   */
  async chatWithHistory(
    systemPrompt: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    settings: AISettings
  ): Promise<string> {
    if (!this.client) {
      throw new Error("Cliente Claude não configurado. Configure primeiro com configure(apiKey)");
    }

    await this.waitForRateLimit();

    const model = resolveClaudeModel(settings.claudeModel);
    const makeRequest = async () => {
      const chatMessages = messages.map((msg) => ({
        role: (msg.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: msg.content,
      }));

      const response = await this.client!.messages.create({
        model: model,
        max_tokens: settings.maxTokens || 1000,
        temperature: settings.temperature || 0.7,
        system: systemPrompt,
        messages: chatMessages,
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Resposta da Claude não é texto");
      }

      if (!content.text) {
        throw new Error("Resposta vazia da API Claude");
      }

      return content.text;
    };

    return this.retryWithBackoff(makeRequest);
  }

  /**
   * Gera conteúdo com prompt único (sem system prompt separado)
   */
  async generateWithPromptOnly(
    userPrompt: string,
    cellText: string,
    settings: AISettings
  ): Promise<string> {
    if (!this.client) {
      throw new Error(
        "Cliente Claude não configurado. Configure primeiro com configure(apiKey)"
      );
    }

    await this.waitForRateLimit();

    const fullPrompt = `${userPrompt}\n\nTexto:\n${cellText}`;

    const model = resolveClaudeModel(settings.claudeModel);
    const makeRequest = async () => {
      const response = await this.client!.messages.create({
        model: model,
        max_tokens: settings.maxTokens || 1000,
        temperature: settings.temperature || 0.7,
        messages: [
          {
            role: "user",
            content: fullPrompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Resposta da Claude não é texto");
      }

      if (!content.text) {
        throw new Error("Resposta vazia da API Claude");
      }

      return content.text;
    };

    return this.retryWithBackoff(makeRequest);
  }

  /**
   * Testa a conexão com a API Claude
   */
  async testConnection(): Promise<boolean> {
    if (!this.client) {
      throw new Error("Cliente Claude não configurado");
    }

    try {
      await this.waitForRateLimit();
      // Teste simples: fazer uma requisição pequena
      await this.client.messages.create({
        model: resolveClaudeModel(),
        max_tokens: 10,
        messages: [
          {
            role: "user",
            content: "Test",
          },
        ],
      });
      return true;
    } catch (error) {
      console.error("Erro ao testar conexão Claude:", error);
      return false;
    }
  }
}

// Singleton instance
export const claudeService = new ClaudeService();

