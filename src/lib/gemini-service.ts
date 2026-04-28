import { GoogleGenAI } from "@google/genai";
import { AISettings } from "./ai-settings";

class GeminiService {
  private client: GoogleGenAI | null = null;
  private lastRequestTime: number = 0;
  private readonly minRequestInterval = 20; // 20ms entre requisições (até 50 req/s) - Gemini Flash é extremamente rápido

  // Monitoramento de rate limits para ajuste dinâmico
  private rateLimitErrors: number[] = []; // Timestamps dos últimos erros 429
  private successfulRequests: number[] = []; // Timestamps das últimas requisições bem-sucedidas
  private readonly RATE_LIMIT_WINDOW = 60000; // Janela de 1 minuto para análise
  private readonly MAX_RATE_LIMIT_ERRORS = 3; // Se tiver mais de 3 erros 429 em 1 min, reduz concorrência

  /**
   * Configura o cliente Gemini com a API key
   */
  configure(apiKey: string): void {
    if (!apiKey) {
      throw new Error("API key da Gemini (Google) é obrigatória");
    }

    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Aguarda o intervalo mínimo entre requisições (rate limiting)
   * Gemini Flash é extremamente rápido, então minimizamos o delay
   */
  private async waitForRateLimit(model?: string): Promise<void> {
    // Para modelos Flash, delay mínimo (quase sem delay)
    const isFlash = model?.includes("flash");
    const interval = isFlash ? 0 : this.minRequestInterval; // 0ms para Flash (sem delay), 20ms para outros

    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < interval) {
      const waitTime = interval - timeSinceLastRequest;
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
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
          // Registra o erro 429 para monitoramento
          this.recordRateLimitError();

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
   * Gera conteúdo usando Gemini
   */
  async generateContent(
    systemPrompt: string,
    userInstructions: string,
    leadData: Record<string, any>,
    settings: AISettings
  ): Promise<string> {
    if (!this.client) {
      throw new Error(
        "Cliente Gemini não configurado. Configure primeiro com configure(apiKey)"
      );
    }

    const model = settings.geminiModel || "gemini-2.5-flash";
    await this.waitForRateLimit(model);

    const leadDataJson = JSON.stringify(leadData, null, 2);
    const userContent = `${userInstructions}\n\nDados do lead:\n${leadDataJson}`;

    const makeRequest = async () => {
      const response = await this.client!.models.generateContent({
        model: model,
        contents: userContent,
        config: {
          systemInstruction: systemPrompt,
          temperature: settings.temperature || 0.7,
          maxOutputTokens: settings.maxTokens || 1000,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Resposta vazia da API Gemini");
      }

      return text;
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
      throw new Error("Cliente Gemini não configurado. Configure primeiro com configure(apiKey)");
    }

    const model = settings.geminiModel || "gemini-2.5-flash";
    await this.waitForRateLimit(model);

    const makeRequest = async () => {
      // Converte mensagens para o formato do Gemini
      const contents = messages.map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      }));

      const response = await this.client!.models.generateContent({
        model: model,
        contents: contents,
        config: {
          systemInstruction: systemPrompt,
          temperature: settings.temperature || 0.7,
          maxOutputTokens: settings.maxTokens || 1000,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Resposta vazia da API Gemini");
      }

      return text;
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
        "Cliente Gemini não configurado. Configure primeiro com configure(apiKey)"
      );
    }

    const model = settings.geminiModel || "gemini-2.5-flash";
    await this.waitForRateLimit(model);

    const fullPrompt = `${userPrompt}\n\nTexto:\n${cellText}`;

    const makeRequest = async () => {
      const response = await this.client!.models.generateContent({
        model: model,
        contents: fullPrompt,
        config: {
          temperature: settings.temperature || 0.7,
          maxOutputTokens: settings.maxTokens || 1000,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Resposta vazia da API Gemini");
      }

      return text;
    };

    try {
      const result = await this.retryWithBackoff(makeRequest);
      this.recordSuccessfulRequest();
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Registra um erro de rate limit (429)
   */
  private recordRateLimitError(): void {
    const now = Date.now();
    this.rateLimitErrors.push(now);

    // Remove erros antigos (fora da janela de 1 minuto)
    this.rateLimitErrors = this.rateLimitErrors.filter(
      (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW
    );
  }

  /**
   * Registra uma requisição bem-sucedida
   */
  private recordSuccessfulRequest(): void {
    const now = Date.now();
    this.successfulRequests.push(now);

    // Remove requisições antigas (fora da janela de 1 minuto)
    this.successfulRequests = this.successfulRequests.filter(
      (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW
    );
  }

  /**
   * Verifica se há muitos erros de rate limit recentemente
   * Retorna true se deve reduzir a concorrência
   */
  public shouldReduceConcurrency(): boolean {
    const now = Date.now();
    const recentErrors = this.rateLimitErrors.filter(
      (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW
    );

    return recentErrors.length >= this.MAX_RATE_LIMIT_ERRORS;
  }

  /**
   * Obtém a taxa de sucesso recente (0-1)
   */
  public getSuccessRate(): number {
    const now = Date.now();
    const recentErrors = this.rateLimitErrors.filter(
      (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW
    );
    const recentSuccesses = this.successfulRequests.filter(
      (timestamp) => now - timestamp < this.RATE_LIMIT_WINDOW
    );

    const total = recentErrors.length + recentSuccesses.length;
    if (total === 0) return 1.0; // Se não há histórico, assume sucesso

    return recentSuccesses.length / total;
  }

  /**
   * Testa a conexão com a API Gemini
   */
  async testConnection(): Promise<boolean> {
    if (!this.client) {
      throw new Error("Cliente Gemini não configurado");
    }

    try {
      await this.waitForRateLimit();
      const response = await this.client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: "Test",
      });
      await response.text;
      return true;
    } catch (error) {
      console.error("Erro ao testar conexão Gemini:", error);
      return false;
    }
  }
}

// Singleton instance
export const geminiService = new GeminiService();
