import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { DEFAULT_AI_SETTINGS, type AISettings } from "./lib/ai-settings";
import {
  checkCheckpoint,
  processLeads,
  restartCheckpoint,
  type GenerationProgress,
  type ProcessingResult,
  type ProcessFileMeta,
} from "./lib/ai-content-service";
import { parseSpreadsheet, rowsToLeads } from "./lib/parseSpreadsheet";

type Provider = "openai" | "claude" | "gemini" | "lm-studio";

function buildSettings(
  knowledgeBase: string,
  instruction: string,
  provider: Provider,
  openaiKey: string,
  claudeKey: string,
  geminiKey: string,
  openaiModel: string,
  claudeModel: string,
  geminiModel: string,
  lmStudioBaseUrl: string,
  lmStudioModel: string,
  temperature: number,
  maxTokens: number
): AISettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    systemPrompt: knowledgeBase,
    userInstructions: instruction,
    aiProvider: provider,
    useRealAI: true,
    openaiApiKey: openaiKey,
    claudeApiKey: claudeKey,
    geminiApiKey: geminiKey,
    model: openaiModel,
    claudeModel,
    geminiModel,
    lmStudioBaseUrl,
    lmStudioModel,
    temperature,
    maxTokens,
  };
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.floor(s % 60);
  return `${m} min ${rs} s`;
}

function formatEta(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  return formatDurationMs(ms);
}

function fallbackExport(results: ProcessingResult[], fileName: string, format: "xlsx" | "csv") {
  const rows = [...results]
    .sort((a, b) => a.index - b.index)
    .map((r) => ({ ...r.lead, conteudo_gerado: r.content ?? "", erro: r.error ?? "", _modelo: r.aiModel }));
  const ws = XLSX.utils.json_to_sheet(rows);
  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    XLSX.writeFile(wb, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
    return;
  }
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function App() {
  const [knowledgeBase, setKnowledgeBase] = useState(DEFAULT_AI_SETTINGS.systemPrompt);
  const [instruction, setInstruction] = useState(DEFAULT_AI_SETTINGS.userInstructions);
  const [provider, setProvider] = useState<Provider>("openai");
  const [openaiKey, setOpenaiKey] = useState("");
  const [claudeKey, setClaudeKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState(DEFAULT_AI_SETTINGS.model);
  const [claudeModel, setClaudeModel] = useState(DEFAULT_AI_SETTINGS.claudeModel);
  const [geminiModel, setGeminiModel] = useState(DEFAULT_AI_SETTINGS.geminiModel);
  const [lmStudioBaseUrl, setLmStudioBaseUrl] = useState(DEFAULT_AI_SETTINGS.lmStudioBaseUrl);
  const [lmStudioModel, setLmStudioModel] = useState(DEFAULT_AI_SETTINGS.lmStudioModel);
  const [temperature, setTemperature] = useState(DEFAULT_AI_SETTINGS.temperature);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_AI_SETTINGS.maxTokens);
  const [enrichFromWebsite, setEnrichFromWebsite] = useState(false);

  const [fileMeta, setFileMeta] = useState<ProcessFileMeta | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [resumeInfo, setResumeInfo] = useState<{ completed: number; total: number } | null>(null);
  const [resumeChoice, setResumeChoice] = useState<boolean | null>(null);

  const [results, setResults] = useState<ProcessingResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [runStats, setRunStats] = useState<GenerationProgress | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [downloadXlsxUrl, setDownloadXlsxUrl] = useState<string | null>(null);
  const [downloadCsvUrl, setDownloadCsvUrl] = useState<string | null>(null);

  useEffect(() => {
    setOpenaiKey((k) => k || (import.meta.env.VITE_OPENAI_API_KEY ?? ""));
    setClaudeKey((k) => k || (import.meta.env.VITE_ANTHROPIC_API_KEY ?? ""));
    setGeminiKey((k) => k || (import.meta.env.VITE_GEMINI_API_KEY ?? ""));
    setLmStudioBaseUrl((v) => v || (import.meta.env.VITE_LM_STUDIO_BASE_URL ?? DEFAULT_AI_SETTINGS.lmStudioBaseUrl));
  }, []);

  const currentKey = useMemo(() => {
    if (provider === "openai") return openaiKey;
    if (provider === "claude") return claudeKey;
    if (provider === "gemini") return geminiKey;
    return "lm-studio";
  }, [provider, openaiKey, claudeKey, geminiKey]);

  const leadsFromSelection = useMemo(() => rowsToLeads(rawRows, selectedColumns), [rawRows, selectedColumns]);
  const toggleColumn = (column: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  };

  const onFile = useCallback(async (file: File | null) => {
    setParseError(null);
    setFileMeta(null);
    setRawRows([]);
    setColumns([]);
    setSelectedColumns(new Set());
    setResults([]);
    setResumeInfo(null);
    setResumeChoice(null);
    setDownloadXlsxUrl(null);
    setDownloadCsvUrl(null);
    if (!file) return;
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (![".xlsx", ".xls", ".csv"].includes(ext)) {
      setParseError("Use .xlsx, .xls ou .csv");
      return;
    }
    setParsing(true);
    try {
      const { rows, columns: cols, fileId, fileName } = await parseSpreadsheet(file);
      setRawRows(rows);
      setColumns(cols);
      setSelectedColumns(new Set(cols));
      const nextMeta = { fileId, fileName, columnsOriginal: cols };
      setFileMeta(nextMeta);
      const checkpoint = await checkCheckpoint(fileId);
      if (checkpoint.found && checkpoint.completed > 0) {
        setResumeInfo({ completed: checkpoint.completed, total: checkpoint.total || rows.length });
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Falha ao ler o arquivo");
    } finally {
      setParsing(false);
    }
  }, []);

  const run = async () => {
    setRunError(null);
    if (!knowledgeBase.trim() || !instruction.trim()) {
      setRunError("Preencha a base de conhecimento e a instrução.");
      return;
    }
    if (provider !== "lm-studio" && !currentKey.trim()) {
      setRunError("Informe a API key do provedor selecionado (ou defina no .env).");
      return;
    }
    if (!fileMeta || leadsFromSelection.length === 0) {
      setRunError("Carregue uma planilha e selecione ao menos uma coluna com dados.");
      return;
    }
    if (resumeInfo && resumeChoice === null) {
      setRunError("Escolha se deseja Retomar ou Recomeçar antes de processar.");
      return;
    }

    const settings = buildSettings(
      knowledgeBase,
      instruction,
      provider,
      openaiKey,
      claudeKey,
      geminiKey,
      openaiModel,
      claudeModel,
      geminiModel,
      lmStudioBaseUrl,
      lmStudioModel,
      temperature,
      maxTokens
    );

    if (resumeChoice === false) {
      await restartCheckpoint(fileMeta.fileId);
    }

    setProcessing(true);
    setResults([]);
    setRunStats(null);

    try {
      const out = await processLeads(
        leadsFromSelection,
        fileMeta,
        (stats) => setRunStats(stats),
        settings,
        { enrichFromWebsite, resumeExisting: resumeChoice !== false }
      );
      setResults(out.results);
      setDownloadXlsxUrl(out.downloadXlsxUrl);
      setDownloadCsvUrl(out.downloadCsvUrl);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Erro ao processar");
    } finally {
      setProcessing(false);
      setRunStats(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Conteúdo personalizado</h1>
        <p className="mt-1 text-sm text-slate-600">Agora com backend para scraping, checkpoint e arquivo de saída isolado.</p>
      </header>

      <div className="space-y-6">
        {resumeInfo && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Encontramos um processamento anterior deste arquivo ({resumeInfo.completed} de {resumeInfo.total} concluídos).
            <div className="mt-2 flex gap-2">
              <button type="button" className="rounded bg-amber-600 px-3 py-1.5 text-white" onClick={() => setResumeChoice(true)}>Retomar</button>
              <button type="button" className="rounded border border-amber-400 px-3 py-1.5" onClick={() => setResumeChoice(false)}>Recomeçar</button>
            </div>
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">1. Texto de contexto</h2>
          <textarea className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm" rows={5} value={knowledgeBase} onChange={(e) => setKnowledgeBase(e.target.value)} />
          <textarea className="mt-3 w-full rounded-lg border border-slate-300 p-3 text-sm" rows={4} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">2. Provedor e modelo</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <select className="rounded-lg border border-slate-300 p-2 text-sm" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
              <option value="openai">OpenAI</option>
              <option value="claude">Anthropic (Claude)</option>
              <option value="gemini">Google (Gemini)</option>
              <option value="lm-studio">LM Studio (local)</option>
            </select>
            {provider !== "lm-studio" ? (
              <input type="password" autoComplete="off" className="rounded-lg border border-slate-300 p-2 font-mono text-sm" value={provider === "openai" ? openaiKey : provider === "claude" ? claudeKey : geminiKey} onChange={(e) => {
                if (provider === "openai") setOpenaiKey(e.target.value);
                else if (provider === "claude") setClaudeKey(e.target.value);
                else setGeminiKey(e.target.value);
              }} />
            ) : (
              <div className="text-xs text-slate-500">API key opcional (LM Studio local)</div>
            )}
            {provider === "openai" && <input className="sm:col-span-2 rounded-lg border border-slate-300 p-2 text-sm" value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} />}
            {provider === "claude" && <input className="sm:col-span-2 rounded-lg border border-slate-300 p-2 text-sm" value={claudeModel} onChange={(e) => setClaudeModel(e.target.value)} />}
            {provider === "gemini" && <input className="sm:col-span-2 rounded-lg border border-slate-300 p-2 text-sm" value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} />}
            {provider === "lm-studio" && (
              <>
                <input className="rounded-lg border border-slate-300 p-2 text-sm" value={lmStudioBaseUrl} onChange={(e) => setLmStudioBaseUrl(e.target.value)} />
                <input className="rounded-lg border border-slate-300 p-2 text-sm" value={lmStudioModel} onChange={(e) => setLmStudioModel(e.target.value)} />
              </>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600">Temperature</label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={2}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Max tokens (resposta)</label>
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={enrichFromWebsite} onChange={(e) => setEnrichFromWebsite(e.target.checked)} />
              Enriquecer com conteúdo do site (quando houver coluna `website`)
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">3. Arquivo</h2>
          {parseError && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{parseError}</p>}
          <input type="file" accept=".xlsx,.xls,.csv" className="text-sm" disabled={parsing || processing} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {fileMeta && (
            <div className="mt-2">
              <p className="text-sm text-slate-700">{fileMeta.fileName} - {rawRows.length} linha(s), {columns.length} coluna(s)</p>
              <p className="mt-2 text-xs text-slate-500">Colunas enviadas ao modelo:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {columns.map((column) => (
                  <label key={column} className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={selectedColumns.has(column)} onChange={() => toggleColumn(column)} />
                    {column}
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {runError && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{runError}</p>}

        <button type="button" onClick={run} disabled={processing || leadsFromSelection.length === 0} className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {processing ? "Gerando..." : "Gerar conteúdo"}
        </button>

        {processing && runStats && (
          <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Estatísticas (ao vivo)</h3>
            <p className="mt-0.5 text-xs text-slate-500">Modelo: {runStats.modelLabel} · paralelismo: {runStats.concurrency}</p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">Progresso</dt>
                <dd className="font-mono text-slate-900">
                  {runStats.done} / {runStats.total}
                  <span className="text-slate-500"> ({runStats.remaining} restantes)</span>
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">Tempo decorrido</dt>
                <dd className="font-mono text-slate-900">{formatDurationMs(runStats.elapsedMs)}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">Estimativa para concluir</dt>
                <dd className="font-mono text-slate-900">{formatEta(runStats.etaMs)}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">Média / linha (relógio, nesta execução)</dt>
                <dd className="font-mono text-slate-900">
                  {runStats.avgWallMsPerLeadThisRun != null
                    ? formatDurationMs(runStats.avgWallMsPerLeadThisRun)
                    : "—"}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">Média / linha (último lote, serviço)</dt>
                <dd className="font-mono text-slate-900">
                  {runStats.avgServiceMsPerLeadLastBatch != null
                    ? formatDurationMs(runStats.avgServiceMsPerLeadLastBatch)
                    : "—"}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">Último lote (parede)</dt>
                <dd className="font-mono text-slate-900">{formatDurationMs(runStats.lastBatchWallMs)}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">Ritmo</dt>
                <dd className="font-mono text-slate-900">
                  {runStats.leadsPerMinute != null ? `${runStats.leadsPerMinute.toFixed(1)} linhas/min` : "—"}
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <dt className="text-xs font-medium text-slate-500">Sucesso / erro (total acumulado)</dt>
                <dd className="font-mono text-slate-900">
                  <span className="text-green-700">{runStats.successTotal}</span>
                  {" / "}
                  <span className="text-red-700">{runStats.errorsTotal}</span>
                </dd>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 sm:col-span-2 lg:col-span-3">
                <dt className="text-xs font-medium text-slate-500">Nesta execução</dt>
                <dd className="text-slate-700">
                  {runStats.processedThisRun} linha(s) processada(s) desde o início do clique em Gerar
                  {runStats.processedThisRun === 0 && " — a estimativa aparece após a primeira leva."}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {results.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Resultados</h2>
              <div className="flex gap-2">
                {downloadXlsxUrl ? (
                  <a className="rounded border border-slate-300 px-3 py-1.5 text-sm" href={downloadXlsxUrl} download>Baixar .xlsx</a>
                ) : (
                  <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => fallbackExport(results, `${fileMeta?.fileName ?? "resultado"}-resultado.xlsx`, "xlsx")}>Baixar .xlsx (fallback)</button>
                )}
                {downloadCsvUrl ? (
                  <a className="rounded border border-slate-300 px-3 py-1.5 text-sm" href={downloadCsvUrl} download>Baixar .csv</a>
                ) : (
                  <button type="button" className="rounded border border-slate-300 px-3 py-1.5 text-sm" onClick={() => fallbackExport(results, `${fileMeta?.fileName ?? "resultado"}-resultado.csv`, "csv")}>Baixar .csv (fallback)</button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
