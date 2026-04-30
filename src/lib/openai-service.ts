import OpenAI from "openai";
import { AISettings } from "./ai-settings";
import { buildLeadUserDataBlock } from "./lead-prompt-block";

class OpenAIService {
  private client: OpenAI | null = null;
  private lastRequestTime: number = 0;
  private readonly minRequestInterval = 100; // 100ms entre requisições (até 10 req/s) para evitar rate limit

  /**
   * Configura o cliente OpenAI com a API key
   */
  configure(apiKey: string): void {
    if (!apiKey) {
      throw new Error("API key da OpenAI é obrigatória");
    }

    this.client = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true, // Necessário para uso no cliente
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
   * Gera conteúdo usando OpenAI
   */
  async generateContent(
    systemPrompt: string,
    userInstructions: string,
    leadData: Record<string, any>,
    settings: AISettings,
    scrapedContent?: string
  ): Promise<string> {
    if (!this.client) {
      throw new Error("Cliente OpenAI não configurado. Configure primeiro com configure(apiKey)");
    }

    await this.waitForRateLimit();

    const dataLine = buildLeadUserDataBlock(leadData, scrapedContent);
    const userContent = `${userInstructions}\n\n${dataLine}`;

    const makeRequest = async () => {
      // Validação de prompts
      if (!systemPrompt || !systemPrompt.trim()) {
        throw new Error("System prompt não pode estar vazio");
      }

      if (!userInstructions || !userInstructions.trim()) {
        throw new Error("User instructions não podem estar vazias");
      }

      // Validação do modelo - corrige modelos inválidos
      let model = settings.model || "gpt-4o-mini";

      // Corrige modelos que não existem
      if (model === "gpt-5-mini") {
        console.warn(`Modelo ${model} não existe, usando gpt-4o-mini como fallback`);
        model = "gpt-4o-mini";
      }

      try {
        const response = await this.client!.chat.completions.create({
          model: model,
          messages: [
            {
              role: "system",
              content: systemPrompt.trim(),
            },
            {
              role: "user",
              content: userContent.trim(),
            },
          ],
          temperature: settings.temperature || 0.7,
          max_tokens: settings.maxTokens || 1000,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Resposta vazia da API OpenAI");
        }

        return content;
      } catch (error: any) {
        // Melhor tratamento de erros da API
        const status = error?.status || error?.statusCode || error?.response?.status || error?.error?.status;

        if (status === 400) {
          const errorMessage = error?.message || error?.error?.message || "Bad Request";
          const errorCode = error?.error?.code || error?.code || "";
          const errorType = error?.error?.type || "";

          // Log detalhado para debug
          console.error("Erro 400 da API OpenAI:", {
            message: errorMessage,
            code: errorCode,
            type: errorType,
            model: model,
            systemPromptLength: systemPrompt.trim().length,
            userContentLength: userContent.trim().length,
            error: error
          });

          // Mensagem mais descritiva
          let detailedMessage = `Erro na requisição OpenAI (400): ${errorMessage}`;
          if (errorCode) {
            detailedMessage += ` - Código: ${errorCode}`;
          }
          if (errorType) {
            detailedMessage += ` (${errorType})`;
          }

          throw new Error(detailedMessage);
        }
        throw error;
      }
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
      throw new Error("Cliente OpenAI não configurado. Configure primeiro com configure(apiKey)");
    }

    await this.waitForRateLimit();

    const makeRequest = async () => {
      let model = settings.model || "gpt-4o-mini";
      if (model === "gpt-5-mini") {
        model = "gpt-4o-mini";
      }

      const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        {
          role: "system",
          content: systemPrompt.trim(),
        },
        ...messages.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
      ];

      const response = await this.client!.chat.completions.create({
        model: model,
        messages: chatMessages,
        temperature: settings.temperature || 0.7,
        max_tokens: settings.maxTokens || 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Resposta vazia da API OpenAI");
      }

      return content;
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
      throw new Error("Cliente OpenAI não configurado. Configure primeiro com configure(apiKey)");
    }

    await this.waitForRateLimit();

    const fullPrompt = `${userPrompt}\n\nTexto:\n${cellText}`;

    const makeRequest = async () => {
      // Validação do modelo - corrige modelos inválidos
      let model = settings.model || "gpt-4o-mini";

      // Corrige modelos que não existem
      if (model === "gpt-5-mini") {
        console.warn(`Modelo ${model} não existe, usando gpt-4o-mini como fallback`);
        model = "gpt-4o-mini";
      }

      try {
        const response = await this.client!.chat.completions.create({
          model: model,
          messages: [
            {
              role: "user",
              content: fullPrompt.trim(),
            },
          ],
          temperature: settings.temperature || 0.7,
          max_tokens: settings.maxTokens || 1000,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Resposta vazia da API OpenAI");
        }

        return content;
      } catch (error: any) {
        // Melhor tratamento de erros da API
        const status = error?.status || error?.statusCode || error?.response?.status || error?.error?.status;

        if (status === 400) {
          const errorMessage = error?.message || error?.error?.message || "Bad Request";
          const errorCode = error?.error?.code || error?.code || "";
          const errorType = error?.error?.type || "";

          // Log detalhado para debug
          console.error("Erro 400 da API OpenAI:", {
            message: errorMessage,
            code: errorCode,
            type: errorType,
            model: model,
            promptLength: fullPrompt.trim().length,
            error: error
          });

          // Mensagem mais descritiva
          let detailedMessage = `Erro na requisição OpenAI (400): ${errorMessage}`;
          if (errorCode) {
            detailedMessage += ` - Código: ${errorCode}`;
          }
          if (errorType) {
            detailedMessage += ` (${errorType})`;
          }

          throw new Error(detailedMessage);
        }
        throw error;
      }
    };

    return this.retryWithBackoff(makeRequest);
  }

  /**
   * Testa a conexão com a API OpenAI
   */
  async testConnection(): Promise<boolean> {
    if (!this.client) {
      throw new Error("Cliente OpenAI não configurado");
    }

    try {
      await this.waitForRateLimit();
      await this.client.models.list();
      return true;
    } catch (error) {
      console.error("Erro ao testar conexão OpenAI:", error);
      return false;
    }
  }
}

// Singleton instance
export const openAIService = new OpenAIService();

