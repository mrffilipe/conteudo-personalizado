export interface AISettings {
  systemPrompt: string;
  userInstructions: string;
  temperature: number;
  maxTokens: number;
  aiProvider: "openai" | "claude" | "gemini";
  model: string;
  claudeModel: string;
  geminiModel: string;
  openaiApiKey: string;
  claudeApiKey: string;
  geminiApiKey: string;
  useRealAI: boolean;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  systemPrompt:
    "Você é um assistente especializado em criar conteúdos personalizados e persuasivos para campanhas de marketing e comunicação empresarial.",
  userInstructions:
    "Crie um conteúdo personalizado baseado nos dados fornecidos. Seja criativo, profissional e mantenha um tom adequado ao contexto.",
  temperature: 0.7,
  maxTokens: 2000,
  aiProvider: "openai",
  model: "gpt-4o-mini",
  claudeModel: "claude-sonnet-4-5",
  geminiModel: "gemini-2.5-flash",
  openaiApiKey: "",
  claudeApiKey: "",
  geminiApiKey: "",
  useRealAI: true,
};
