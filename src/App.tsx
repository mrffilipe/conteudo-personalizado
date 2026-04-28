import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { DEFAULT_AI_SETTINGS, type AISettings } from "./lib/ai-settings";
import { processLeads, type ProcessingResult } from "./lib/ai-content-service";
import { parseSpreadsheet, rowsToLeads } from "./lib/parseSpreadsheet";

type Provider = "openai" | "claude" | "gemini";

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
    claudeModel: claudeModel,
    geminiModel: geminiModel,
    temperature,
    maxTokens,
  };
}

function exportResultsXlsx(results: ProcessingResult[], filename: string) {
  const sorted = [...results].sort((a, b) => a.index - b.index);
  const rows = sorted.map((r) => {
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.lead)) {
      base[k] = String(v ?? "");
    }
    base["conteúdo_gerado"] = r.content ?? "";
    base["erro"] = r.error ?? "";
    base["_modelo"] = r.aiModel;
    return base;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resultados");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

function exportResultsCsv(results: ProcessingResult[], filename: string) {
  const sorted = [...results].sort((a, b) => a.index - b.index);
  if (sorted.length === 0) return;
  const keys = new Set<string>();
  sorted.forEach((r) => {
    Object.keys(r.lead).forEach((k) => keys.add(k));
  });
  keys.add("conteúdo_gerado");
  keys.add("erro");
  keys.add("_modelo");
  const cols = Array.from(keys);
  const esc = (v: string) => {
    if (/[",\n\r]/.test(v)) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const lines = [
    cols.join(","),
    ...sorted.map((r) =>
      cols
        .map((c) => {
          if (c === "conteúdo_gerado") return esc(r.content ?? "");
          if (c === "erro") return esc(r.error ?? "");
          if (c === "_modelo") return esc(r.aiModel);
          return esc(String((r.lead as Record<string, string>)[c] ?? ""));
        })
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
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
  const [temperature, setTemperature] = useState(DEFAULT_AI_SETTINGS.temperature);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_AI_SETTINGS.maxTokens);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const [results, setResults] = useState<ProcessingResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    setOpenaiKey((k) => k || (import.meta.env.VITE_OPENAI_API_KEY ?? ""));
    setClaudeKey((k) => k || (import.meta.env.VITE_ANTHROPIC_API_KEY ?? ""));
    setGeminiKey((k) => k || (import.meta.env.VITE_GEMINI_API_KEY ?? ""));
  }, []);

  const currentKey = useMemo(() => {
    if (provider === "openai") return openaiKey;
    if (provider === "claude") return claudeKey;
    return geminiKey;
  }, [provider, openaiKey, claudeKey, geminiKey]);

  const leadsFromSelection = useMemo(
    () => rowsToLeads(rawRows, selectedColumns),
    [rawRows, selectedColumns]
  );

  const onFile = useCallback(async (file: File | null) => {
    setParseError(null);
    setFileName(null);
    setRawRows([]);
    setColumns([]);
    setSelectedColumns(new Set());
    setResults([]);
    if (!file) return;

    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (![".xlsx", ".xls", ".csv"].includes(ext)) {
      setParseError("Use .xlsx, .xls ou .csv");
      return;
    }

    setParsing(true);
    try {
      const { rows, columns: cols } = await parseSpreadsheet(file);
      setFileName(file.name);
      setRawRows(rows);
      setColumns(cols);
      setSelectedColumns(new Set(cols));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Falha ao ler o arquivo");
    } finally {
      setParsing(false);
    }
  }, []);

  const toggleColumn = (c: string) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const run = async () => {
    setRunError(null);
    if (!knowledgeBase.trim() || !instruction.trim()) {
      setRunError("Preencha a base de conhecimento e a instrução.");
      return;
    }
    if (!currentKey.trim()) {
      setRunError("Informe a API key do provedor selecionado (ou defina no .env).");
      return;
    }
    if (leadsFromSelection.length === 0) {
      setRunError("Carregue uma planilha e selecione ao menos uma coluna com dados.");
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
      temperature,
      maxTokens
    );

    setProcessing(true);
    setResults([]);
    setProgress({ done: 0, total: leadsFromSelection.length });

    try {
      const out = await processLeads(
        leadsFromSelection,
        (done) => {
          setProgress({ done, total: leadsFromSelection.length });
        },
        settings
      );
      out.sort((a, b) => a.index - b.index);
      setResults(out);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Erro ao processar");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Conteúdo personalizado</h1>
        <p className="mt-1 text-sm text-slate-600">
          Defina a base de conhecimento, a instrução e execute sobre um arquivo Excel ou CSV — mesma
          lógica do gerador do Belgos CRM, sem autenticação ou Firebase.
        </p>
      </header>

      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">1. Texto de contexto</h2>
          <label className="block text-xs font-medium text-slate-600">Base de conhecimento (system)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            rows={5}
            value={knowledgeBase}
            onChange={(e) => setKnowledgeBase(e.target.value)}
            placeholder="Quem é a marca, tom de voz, produto, restrições..."
          />
          <label className="mt-3 block text-xs font-medium text-slate-600">Instrução (o que gerar em cada linha)</label>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            rows={4}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Ex.: 'Escreva um e-mail frio de no máximo 120 palavras...'"
          />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">2. Provedor e modelo</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">Provedor</label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
              >
                <option value="openai">OpenAI</option>
                <option value="claude">Anthropic (Claude)</option>
                <option value="gemini">Google (Gemini)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">API key</label>
              <input
                type="password"
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-sm"
                value={provider === "openai" ? openaiKey : provider === "claude" ? claudeKey : geminiKey}
                onChange={(e) => {
                  if (provider === "openai") setOpenaiKey(e.target.value);
                  else if (provider === "claude") setClaudeKey(e.target.value);
                  else setGeminiKey(e.target.value);
                }}
                placeholder="Ou use .env: VITE_OPENAI_API_KEY / VITE_ANTHROPIC_API_KEY / VITE_GEMINI_API_KEY"
              />
            </div>
            {provider === "openai" && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600">Modelo OpenAI</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                />
              </div>
            )}
            {provider === "claude" && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600">Modelo Claude</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                  value={claudeModel}
                  onChange={(e) => setClaudeModel(e.target.value)}
                />
              </div>
            )}
            {provider === "gemini" && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600">Modelo Gemini</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                />
              </div>
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
              <label className="block text-xs font-medium text-slate-600">Max tokens</label>
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 1)}
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">3. Arquivo (xlsx, xls ou csv)</h2>
          {parseError && (
            <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{parseError}</p>
          )}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="text-sm"
            disabled={parsing || processing}
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          {parsing && <p className="mt-2 text-sm text-slate-500">Lendo arquivo…</p>}
          {fileName && columns.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-slate-700">
                <span className="font-medium">{fileName}</span> — {rawRows.length} linha(s), {columns.length}{" "}
                coluna(s)
              </p>
              <p className="mt-2 text-xs text-slate-500">Colunas enviadas ao modelo (dados da linha):</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {columns.map((c) => (
                  <label key={c} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedColumns.has(c)}
                      onChange={() => toggleColumn(c)}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {runError && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{runError}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={processing || leadsFromSelection.length === 0}
            className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {processing ? "Gerando…" : "Gerar conteúdo"}
          </button>
          {processing && (
            <span className="text-sm text-slate-600">
              {progress.done} / {progress.total} linhas
            </span>
          )}
        </div>

        {results.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Resultados</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                  onClick={() => exportResultsXlsx(results, "resultados-conteudo.xlsx")}
                >
                  Baixar .xlsx
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                  onClick={() => exportResultsCsv(results, "resultados-conteudo.csv")}
                >
                  Baixar .csv
                </button>
              </div>
            </div>
            <div className="max-h-[480px] overflow-auto rounded border border-slate-100">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="border-b border-slate-200 p-2">#</th>
                    <th className="border-b border-slate-200 p-2">Status</th>
                    <th className="border-b border-slate-200 p-2">Conteúdo</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.index} className="align-top">
                      <td className="border-b border-slate-100 p-2">{r.index + 1}</td>
                      <td className="border-b border-slate-100 p-2">
                        {r.success ? (
                          <span className="text-green-700">ok</span>
                        ) : (
                          <span className="text-red-700" title={r.error}>
                            erro
                          </span>
                        )}
                      </td>
                      <td className="border-b border-slate-100 p-2 whitespace-pre-wrap break-words">
                        {r.success ? r.content : r.error}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <p className="text-xs text-slate-500">
          As chaves de API rodam no navegador (como no CRM original). Para produção, prefira um backend
          que chame a API sem expor a chave.
        </p>
      </div>
    </div>
  );
}
