import type { AISettings } from "./ai-settings";
import { openAIService } from "./openai-service";
import { claudeService } from "./claude-service";
import { geminiService } from "./gemini-service";
import { lmStudioService } from "./lm-studio-service";
import { scrapeWebsite } from "./website-scraper";

export interface Lead {
  _rowId?: string;
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
  rowId: string;
  success: boolean;
  lead: Lead;
  content?: string;
  error?: string;
  timestamp: string;
  aiModel: string;
  temperature: number;
  index: number;
  scrapedSummary?: string;
}

export interface ProcessFileMeta {
  fileId: string;
  fileName: string;
  columnsOriginal: string[];
}

interface StartCheckpointResponse {
  resumeFromIndex: number;
  completedRowIds: string[];
  partialResults: ProcessingResult[];
}

/** Métricas em tempo real durante o lote (atualizado a cada “lote” paralelo). */
export interface GenerationProgress {
  done: number;
  total: number;
  remaining: number;
  /** Linhas concluídas só nesta execução (exclui retomada já pronta). */
  processedThisRun: number;
  elapsedMs: number;
  /** Tempo médio de relógio por linha desde o início desta execução (útil com paralelismo). */
  avgWallMsPerLeadThisRun: number | null;
  /** Estimativa grosseira: `remaining * avgWallMsPerLeadThisRun`. */
  etaMs: number | null;
  /** Com base no ritmo desta execução. */
  leadsPerMinute: number | null;
  /** Tempo de parede do último lote paralelo. */
  lastBatchWallMs: number;
  /** Média do tempo “por linha” no último lote (parede ÷ tamanho do lote). */
  avgWallMsPerLeadLastBatch: number | null;
  /** Média do tempo individual por linha (soma scrape+IA de cada linha ÷ N), no último lote. */
  avgServiceMsPerLeadLastBatch: number | null;
  successTotal: number;
  errorsTotal: number;
  concurrency: number;
  modelLabel: string;
}

export type ProgressCallback = (stats: GenerationProgress) => void;

export interface EmailDispatchProgress {
  dispatchId: string;
  status: "running" | "completed" | "failed";
  total: number;
  sent: number;
  failed: number;
  done: number;
  remaining: number;
  successRate: number;
  elapsedMs: number;
  etaMs: number | null;
  avgMsPerEmail: number | null;
  emailsPerMinute: number | null;
  startedAt: string;
  finishedAt?: string;
  errorsSample: string[];
}

function getModelName(settings: AISettings): string {
  if (settings.aiProvider === "openai") return settings.model;
  if (settings.aiProvider === "claude") return settings.claudeModel;
  if (settings.aiProvider === "gemini") return settings.geminiModel;
  return settings.lmStudioModel;
}

function getBatchSize(model: string): number {
  if (model.includes("flash") && (model.includes("gemini") || model.includes("2.0") || model.includes("2.5"))) return 50;
  if (model.includes("mini") || model.includes("haiku") || model.includes("flash-lite")) return 30;
  return 5;
}

function getConcurrency(model: string, aiProvider?: AISettings["aiProvider"]): number {
  if (aiProvider === "lm-studio") return 2;
  if (aiProvider === "gemini" && geminiService.shouldReduceConcurrency()) return 8;
  if (model.includes("flash") && (model.includes("gemini") || model.includes("2.0") || model.includes("2.5"))) return 16;
  if (model.includes("mini") || model.includes("haiku") || model.includes("flash-lite")) return 10;
  return 2;
}

export async function generateAIContent(
  lead: Lead,
  settings: AISettings,
  scrapedContent?: string
): Promise<string> {
  if (!settings.useRealAI) {
    return `Conteúdo gerado para ${String(lead.first_name ?? "Lead")} da empresa ${String(lead.company_name ?? "Empresa")}`;
  }

  if (settings.aiProvider === "openai") {
    if (!settings.openaiApiKey) throw new Error("API key da OpenAI não configurada");
    openAIService.configure(settings.openaiApiKey);
    return openAIService.generateContent(settings.systemPrompt, settings.userInstructions, lead, settings, scrapedContent);
  }

  if (settings.aiProvider === "claude") {
    if (!settings.claudeApiKey) throw new Error("API key da Claude não configurada");
    claudeService.configure(settings.claudeApiKey);
    return claudeService.generateContent(settings.systemPrompt, settings.userInstructions, lead, settings, scrapedContent);
  }

  if (settings.aiProvider === "gemini") {
    if (!settings.geminiApiKey) throw new Error("API key da Gemini não configurada");
    geminiService.configure(settings.geminiApiKey);
    return geminiService.generateContent(settings.systemPrompt, settings.userInstructions, lead, settings, scrapedContent);
  }

  lmStudioService.configure(settings);
  return lmStudioService.generateContent(settings.systemPrompt, settings.userInstructions, lead, settings, scrapedContent);
}

async function startCheckpoint(fileMeta: ProcessFileMeta, total: number): Promise<StartCheckpointResponse> {
  const response = await fetch("/api/checkpoint/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...fileMeta, total }),
  });
  if (!response.ok) throw new Error(`Falha ao iniciar checkpoint: HTTP ${response.status}`);
  return (await response.json()) as StartCheckpointResponse;
}

async function saveCheckpoint(fileId: string, results: ProcessingResult[]): Promise<void> {
  if (results.length === 0) return;
  await fetch("/api/checkpoint/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId, results }),
  });
}

async function finishCheckpoint(
  fileMeta: ProcessFileMeta,
  format: "xlsx" | "csv",
  sendgridApiKey?: string,
  emailSubject?: string,
  emailLimit?: number
): Promise<{ downloadUrl: string | null; emailDispatchId: string | null; emailDispatchError: string | null }> {
  const response = await fetch("/api/checkpoint/finish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId: fileMeta.fileId, format, fileName: fileMeta.fileName, sendgridApiKey, emailSubject, emailLimit }),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    return {
      downloadUrl: null,
      emailDispatchId: null,
      emailDispatchError: err.error ?? `Falha ao finalizar checkpoint (HTTP ${response.status})`,
    };
  }
  const data = (await response.json()) as { downloadUrl?: string; emailDispatchId?: string | null; emailDispatchError?: string | null };
  return {
    downloadUrl: data.downloadUrl ?? null,
    emailDispatchId: data.emailDispatchId ?? null,
    emailDispatchError: data.emailDispatchError ?? null,
  };
}

export async function getEmailDispatchProgress(dispatchId: string): Promise<EmailDispatchProgress | null> {
  const response = await fetch(`/api/email-dispatch/${encodeURIComponent(dispatchId)}`);
  if (!response.ok) return null;
  return (await response.json()) as EmailDispatchProgress;
}

export async function startBatchEmailDispatch(params: {
  fileMeta: ProcessFileMeta;
  sendgridApiKey: string;
  emailSubject: string;
  emailLimit: number;
}): Promise<{ emailDispatchId: string | null; emailDispatchError: string | null; downloadXlsxUrl: string | null }> {
  const finish = await finishCheckpoint(
    params.fileMeta,
    "xlsx",
    params.sendgridApiKey,
    params.emailSubject,
    params.emailLimit
  );
  return {
    emailDispatchId: finish.emailDispatchId,
    emailDispatchError: finish.emailDispatchError,
    downloadXlsxUrl: finish.downloadUrl,
  };
}

export async function sendManualEmailTest(payload: {
  sendgridApiKey: string;
  to: string;
  subject: string;
  content: string;
}): Promise<void> {
  const response = await fetch("/api/email-send-test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Falha no envio manual: HTTP ${response.status}`);
  }
}

export async function checkCheckpoint(fileId: string): Promise<{ found: boolean; completed: number; total: number }> {
  try {
    const response = await fetch(`/api/checkpoint/${fileId}`);
    if (!response.ok) return { found: false, completed: 0, total: 0 };
    const data = (await response.json()) as { results?: ProcessingResult[]; total?: number };
    return { found: true, completed: data.results?.length ?? 0, total: data.total ?? 0 };
  } catch {
    return { found: false, completed: 0, total: 0 };
  }
}

export async function importEmailCheckpoint(
  fileMeta: ProcessFileMeta,
  rows: Record<string, unknown>[]
): Promise<{ found: boolean; completed: number; total: number }> {
  const response = await fetch("/api/checkpoint/import-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId: fileMeta.fileId, fileName: fileMeta.fileName, rows }),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Falha ao importar checkpoint de email (HTTP ${response.status})`);
  }
  return (await response.json()) as { found: boolean; completed: number; total: number };
}

export async function restartCheckpoint(fileId: string): Promise<void> {
  await fetch("/api/checkpoint/restart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
}

export async function processLeads(
  leads: Lead[],
  fileMeta: ProcessFileMeta,
  onProgress: ProgressCallback,
  settings: AISettings,
  options?: { enrichFromWebsite?: boolean; resumeExisting?: boolean },
  sendgridApiKey?: string,
  emailSubject?: string,
  emailLimit?: number
): Promise<{
  results: ProcessingResult[];
  downloadXlsxUrl: string | null;
  downloadCsvUrl: string | null;
  emailDispatchId: string | null;
  emailDispatchError: string | null;
}> {
  if (!leads.length) {
    return { results: [], downloadXlsxUrl: null, downloadCsvUrl: null, emailDispatchId: null, emailDispatchError: null };
  }

  const checkpoint = await startCheckpoint(fileMeta, leads.length);
  const completedRowIds = new Set(options?.resumeExisting ? checkpoint.completedRowIds : []);
  const allResults: ProcessingResult[] = options?.resumeExisting ? [...checkpoint.partialResults] : [];

  const pendingLeads = leads.filter((lead) => !completedRowIds.has(String(lead._rowId ?? "")));
  const modelName = getModelName(settings);
  const batchSize = getBatchSize(modelName);
  const concurrency = getConcurrency(modelName, settings.aiProvider);
  const initialDone = allResults.length;
  const runStartedAt = performance.now();

  const emitProgress = (
    lastBatchWallMs: number,
    lastBatchServiceMs: number[],
    chunkScheduledSize?: number
  ) => {
    const done = allResults.length;
    const processedThisRun = done - initialDone;
    const elapsedMs = performance.now() - runStartedAt;
    const avgWallMsPerLeadThisRun =
      processedThisRun > 0 ? elapsedMs / processedThisRun : null;
    const remaining = leads.length - done;
    const etaMs =
      avgWallMsPerLeadThisRun != null && remaining > 0 ? remaining * avgWallMsPerLeadThisRun : null;
    const leadsPerMinute =
      processedThisRun > 0 && elapsedMs > 0 ? (processedThisRun / elapsedMs) * 60_000 : null;
    const chunkLen = lastBatchServiceMs.length;
    const avgWallMsPerLeadLastBatch =
      chunkLen > 0 && lastBatchWallMs > 0 ? lastBatchWallMs / chunkLen : null;
    const sumSvc = lastBatchServiceMs.reduce((a, b) => a + b, 0);
    const avgServiceMsPerLeadLastBatch = chunkLen > 0 ? sumSvc / chunkLen : null;
    const parallelSlots = chunkScheduledSize && chunkScheduledSize > 0 ? chunkScheduledSize : chunkLen;

    onProgress({
      done,
      total: leads.length,
      remaining,
      processedThisRun,
      elapsedMs,
      avgWallMsPerLeadThisRun,
      etaMs,
      leadsPerMinute,
      lastBatchWallMs,
      avgWallMsPerLeadLastBatch,
      avgServiceMsPerLeadLastBatch,
      successTotal: allResults.filter((r) => r.success).length,
      errorsTotal: allResults.filter((r) => !r.success).length,
      concurrency: parallelSlots > 0 ? parallelSlots : concurrency,
      modelLabel: modelName,
    });
  };

  emitProgress(0, [], concurrency);

  for (let i = 0; i < pendingLeads.length; i += batchSize) {
    const batch = pendingLeads.slice(i, i + batchSize);
    const pendingSaves: ProcessingResult[] = [];
    for (let j = 0; j < batch.length; j += concurrency) {
      const chunk = batch.slice(j, j + concurrency);
      const batchWallStart = performance.now();
      const chunkResults = await Promise.all(
        chunk.map(async (lead) => {
          const serviceStart = performance.now();
          const rowId = String(lead._rowId ?? `r-${Date.now()}`);
          const timestamp = new Date().toISOString();
          let scrapedSummary = "";
          if (options?.enrichFromWebsite && typeof lead.website === "string" && lead.website.trim()) {
            const scrapeResult = await scrapeWebsite(lead.website);
            if (scrapeResult.ok) {
              scrapedSummary = scrapeResult.summary ?? "";
            }
          }
          try {
            const content = await generateAIContent(lead, settings, scrapedSummary || undefined);
            const result: ProcessingResult = {
              rowId,
              success: true,
              lead,
              content,
              timestamp,
              aiModel: modelName,
              temperature: settings.temperature,
              index: leads.findIndex((item) => item._rowId === lead._rowId),
              scrapedSummary,
            };
            return { result, serviceMs: performance.now() - serviceStart };
          } catch (error) {
            return {
              result: {
                rowId,
                success: false,
                lead,
                error: error instanceof Error ? error.message : "Erro desconhecido",
                timestamp,
                aiModel: modelName,
                temperature: settings.temperature,
                index: leads.findIndex((item) => item._rowId === lead._rowId),
                scrapedSummary,
              } satisfies ProcessingResult,
              serviceMs: performance.now() - serviceStart,
            };
          }
        })
      );
      const lastBatchWallMs = performance.now() - batchWallStart;
      const lastBatchServiceMs = chunkResults.map((x) => x.serviceMs);
      const resultsOnly = chunkResults.map((x) => x.result);
      allResults.push(...resultsOnly);
      pendingSaves.push(...resultsOnly);
      emitProgress(lastBatchWallMs, lastBatchServiceMs, chunk.length);
      await saveCheckpoint(fileMeta.fileId, pendingSaves);
    }
  }

  const xlsxFinish = await finishCheckpoint(fileMeta, "xlsx", sendgridApiKey, emailSubject, emailLimit);
  const csvFinish = await finishCheckpoint(fileMeta, "csv");
  allResults.sort((a, b) => a.index - b.index);
  return {
    results: allResults,
    downloadXlsxUrl: xlsxFinish.downloadUrl,
    downloadCsvUrl: csvFinish.downloadUrl,
    emailDispatchId: xlsxFinish.emailDispatchId,
    emailDispatchError: xlsxFinish.emailDispatchError,
  };
}
