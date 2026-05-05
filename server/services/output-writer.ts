import { promises as fs } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type { CheckpointData } from "../types";

const outputDir = path.resolve(process.cwd(), process.env.OUTPUT_DIR ?? "./data/output");

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function toRows(checkpoint: CheckpointData): Record<string, string>[] {
  const ordered = [...checkpoint.results].sort((a, b) => a.index - b.index);
  return ordered.map((result) => {
    const row: Record<string, string> = {};
    checkpoint.columnsOriginal.forEach((column) => {
      row[column] = String(result.lead[column] ?? "");
    });
    row["conteudo_gerado"] = result.content ?? "";
    row["erro"] = result.error ?? "";
    row["_modelo"] = result.aiModel;
    row["_status"] = result.success ? "ok" : "erro";
    row["_site_resumo"] = result.scrapedSummary ?? "";
    row["_email_enviado"] = result.emailSentSuccess ? "sim" : "nao";
    row["_email_enviado_em"] = result.emailSentAt ?? "";
    row["_email_erro_envio"] = result.emailSentError ?? "";
    row["_email_tentativas"] = String(result.emailSentAttempts ?? 0);
    return row;
  });
}

export async function writeOutput(checkpoint: CheckpointData, format: "xlsx" | "csv"): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const safeBase = `${baseName(checkpoint.fileName)}-resultado`;
  const rows = toRows(checkpoint);
  const fullPath = path.join(outputDir, `${safeBase}.${format}`);

  if (format === "xlsx") {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resultados");
    XLSX.writeFile(wb, fullPath);
  } else {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    await fs.writeFile(fullPath, csv, "utf-8");
  }
  return `/output/${path.basename(fullPath)}`;
}
