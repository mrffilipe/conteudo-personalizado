import type { AISettings } from "./ai-settings";
import { openAIService } from "./openai-service";
import { claudeService } from "./claude-service";
import { geminiService } from "./gemini-service";

export interface Lead {
  first_name?: string;
  company_name?: string;
  company_industry?: string;
  job_title?: string;
  location?: string;
  email?: string;
  phone?: string;
  website?: string;
  [key: string]: unknown;
}

export interface ProcessingResult {
  success: boolean;
  lead: Lead;
  content?: string;
  error?: string;
  timestamp: string;
  aiModel: string;
  temperature: number;
  index: number;
}

type ProgressCallback = (
  processed: number,
  current: Lead | null,
  result: ProcessingResult | null
) => void;

type ResultSaveCallback = (results: ProcessingResult[]) => Promise<void>;

function getBatchSize(model: string): number {
  if (
    model.includes("flash") &&
    (model.includes("gemini") || model.includes("2.0") || model.includes("2.5"))
  ) {
    return 50;
  }
  if (model.includes("mini") || model.includes("haiku") || model.includes("flash-lite")) {
    return 30;
  }
  return 5;
}

function getConcurrency(model: string, aiProvider?: string): number {
  if (aiProvider === "gemini") {
    const shouldReduce = geminiService.shouldReduceConcurrency();
    const successRate = geminiService.getSuccessRate();

    if (model.includes("flash") && (model.includes("gemini") || model.includes("2.0") || model.includes("2.5"))) {
      if (shouldReduce || successRate < 0.7) {
        return 8;
      }
      if (successRate < 0.9) {
        return 12;
      }
      return 16;
    }

    if (model.includes("mini") || model.includes("haiku") || model.includes("flash-lite")) {
      if (shouldReduce || successRate < 0.7) {
        return 5;
      }
      if (successRate < 0.9) {
        return 7;
      }
      return 10;
    }
  }

  if (model.includes("flash") && (model.includes("gemini") || model.includes("2.0") || model.includes("2.5"))) {
    return 16;
  }
  if (model.includes("mini") || model.includes("haiku") || model.includes("flash-lite")) {
    return 10;
  }
  return 2;
}

export async function generateAIContent(lead: Lead, settings: AISettings): Promise<string> {
  if (!settings.useRealAI) {
    return `Conteúdo gerado para ${String(lead.first_name ?? "Lead")} da empresa ${String(lead.company_name ?? "Empresa")}`;
  }

  if (settings.aiProvider === "openai") {
    if (!settings.openaiApiKey) {
      throw new Error("API key da OpenAI não configurada");
    }
    openAIService.configure(settings.openaiApiKey);

    return openAIService.generateContent(
      settings.systemPrompt,
      settings.userInstructions,
      lead as Record<string, unknown>,
      settings
    );
  }

  if (settings.aiProvider === "claude") {
    if (!settings.claudeApiKey) {
      throw new Error("API key da Claude não configurada");
    }
    claudeService.configure(settings.claudeApiKey);

    return claudeService.generateContent(
      settings.systemPrompt,
      settings.userInstructions,
      lead as Record<string, unknown>,
      settings
    );
  }

  if (!settings.geminiApiKey) {
    throw new Error("API key da Gemini não configurada");
  }
  geminiService.configure(settings.geminiApiKey);

  return geminiService.generateContent(
    settings.systemPrompt,
    settings.userInstructions,
    lead as Record<string, unknown>,
    settings
  );
}

async function processLead(lead: Lead, index: number, settings: AISettings): Promise<ProcessingResult> {
  const timestamp = new Date().toISOString();
  const modelName =
    settings.aiProvider === "openai"
      ? settings.model
      : settings.aiProvider === "claude"
        ? settings.claudeModel
        : settings.geminiModel;

  try {
    const content = await generateAIContent(lead, settings);

    return {
      success: true,
      lead,
      content,
      timestamp,
      aiModel: modelName,
      temperature: settings.temperature,
      index,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";

    return {
      success: false,
      lead,
      error: errorMessage,
      timestamp,
      aiModel: modelName,
      temperature: settings.temperature,
      index,
    };
  }
}

async function processBatch(
  batch: Lead[],
  startIndex: number,
  settings: AISettings,
  onProgress: ProgressCallback,
  onResultSave?: ResultSaveCallback
): Promise<ProcessingResult[]> {
  const modelName =
    settings.aiProvider === "openai"
      ? settings.model
      : settings.aiProvider === "claude"
        ? settings.claudeModel
        : settings.geminiModel;
  const concurrency = getConcurrency(modelName, settings.aiProvider);

  const results: ProcessingResult[] = [];
  const pendingSaves: ProcessingResult[] = [];
  let lastSaveTime = Date.now();

  for (let i = 0; i < batch.length; i += concurrency) {
    const concurrentLeads = batch.slice(i, i + concurrency);

    const concurrentPromises = concurrentLeads.map(async (lead, batchIndex) => {
      const index = startIndex + i + batchIndex;
      const result = await processLead(lead, index, settings);

      onProgress(startIndex + i + batchIndex + 1, lead, result);

      return result;
    });

    const batchResults = await Promise.all(concurrentPromises);
    results.push(...batchResults);
    pendingSaves.push(...batchResults);

    const now = Date.now();
    const shouldSave = pendingSaves.length >= 5 || (now - lastSaveTime >= 1000 && pendingSaves.length > 0);

    if (shouldSave && onResultSave) {
      const toSave = [...pendingSaves];
      pendingSaves.length = 0;
      lastSaveTime = now;

      onResultSave(toSave).catch((err) => {
        console.error("Erro ao salvar resultados:", err);
      });
    }
  }

  if (pendingSaves.length > 0 && onResultSave) {
    await onResultSave(pendingSaves);
  }

  return results;
}

export async function processLeads(
  leads: Lead[],
  onProgress: ProgressCallback,
  settings: AISettings,
  onResultSave?: ResultSaveCallback
): Promise<ProcessingResult[]> {
  if (!leads || leads.length === 0) {
    return [];
  }

  const modelName =
    settings.aiProvider === "openai"
      ? settings.model
      : settings.aiProvider === "claude"
        ? settings.claudeModel
        : settings.geminiModel;
  const batchSize = getBatchSize(modelName);

  const batches: Lead[][] = [];
  for (let i = 0; i < leads.length; i += batchSize) {
    batches.push(leads.slice(i, i + batchSize));
  }

  const isGeminiFlash =
    modelName.includes("flash") &&
    (modelName.includes("gemini") || modelName.includes("2.0") || modelName.includes("2.5"));
  let maxConcurrentBatches = isGeminiFlash ? 8 : 2;

  if (settings.aiProvider === "gemini") {
    const shouldReduce = geminiService.shouldReduceConcurrency();
    const successRate = geminiService.getSuccessRate();

    if (shouldReduce || successRate < 0.7) {
      maxConcurrentBatches = isGeminiFlash ? 4 : 2;
    } else if (successRate < 0.9) {
      maxConcurrentBatches = isGeminiFlash ? 6 : 2;
    }
  }
  const allResults: ProcessingResult[] = [];

  for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
    const concurrentBatches = batches.slice(i, i + maxConcurrentBatches);

    const batchPromises = concurrentBatches.map((batch, batchIndex) => {
      const startIndex = (i + batchIndex) * batchSize;
      return processBatch(batch, startIndex, settings, onProgress, onResultSave);
    });

    const batchResults = await Promise.all(batchPromises);
    allResults.push(...batchResults.flat());
  }

  return allResults;
}
