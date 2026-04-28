import * as XLSX from "xlsx";
import type { Lead } from "./ai-content-service";

const MAX_ROWS = 10000;

export async function parseSpreadsheet(
  file: File
): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isCSV = file.name.toLowerCase().endsWith(".csv");

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error("Erro ao ler arquivo"));
          return;
        }

        let workbook: XLSX.WorkBook;

        if (isCSV) {
          const text = data as string;
          workbook = XLSX.read(text, { type: "string", codepage: 65001 });
        } else {
          workbook = XLSX.read(data, { type: "binary" });
        }

        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          raw: false,
          defval: "",
        }) as Record<string, unknown>[];

        if (jsonData.length === 0) {
          reject(new Error("O arquivo está vazio"));
          return;
        }

        if (jsonData.length > MAX_ROWS) {
          reject(new Error(`Máximo de ${MAX_ROWS} linhas por arquivo`));
          return;
        }

        const columns = Object.keys(jsonData[0] || {});
        resolve({ rows: jsonData, columns });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Erro ao processar o arquivo"));
      }
    };

    reader.onerror = () => {
      reject(new Error("Erro ao ler arquivo"));
    };

    if (isCSV) {
      reader.readAsText(file, "UTF-8");
    } else {
      reader.readAsArrayBuffer(file);
    }
  });
}

export function rowsToLeads(
  rows: Record<string, unknown>[],
  selectedColumns: Set<string>
): Lead[] {
  return rows.map((row) => {
    const lead: Lead = {};
    selectedColumns.forEach((col) => {
      const v = row[col];
      if (v !== undefined && v !== null && v !== "") {
        lead[col] = String(v).trim();
      }
    });
    return lead;
  });
}
