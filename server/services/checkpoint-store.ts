import { promises as fs } from "node:fs";
import path from "node:path";
import type { CheckpointData, ProcessingResult } from "../types";

const checkpointDir = path.resolve(process.cwd(), process.env.CHECKPOINT_DIR ?? "./data/checkpoints");

async function ensureDir(): Promise<void> {
  await fs.mkdir(checkpointDir, { recursive: true });
}

function checkpointPath(fileId: string): string {
  return path.join(checkpointDir, `${fileId}.json`);
}

async function writeAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function getCheckpoint(fileId: string): Promise<CheckpointData | null> {
  await ensureDir();
  const filePath = checkpointPath(fileId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as CheckpointData;
  } catch {
    return null;
  }
}

export async function startCheckpoint(params: {
  fileId: string;
  fileName: string;
  columnsOriginal: string[];
  total: number;
}) {
  await ensureDir();
  const existing = await getCheckpoint(params.fileId);
  if (existing) {
    return {
      resumeFromIndex: existing.results.length,
      completedRowIds: existing.results.map((r) => r.rowId),
      partialResults: existing.results,
    };
  }

  const now = new Date().toISOString();
  const data: CheckpointData = {
    fileId: params.fileId,
    fileName: params.fileName,
    createdAt: now,
    updatedAt: now,
    total: params.total,
    columnsOriginal: params.columnsOriginal,
    results: [],
  };
  await writeAtomic(checkpointPath(params.fileId), data);
  return { resumeFromIndex: 0, completedRowIds: [], partialResults: [] };
}

export async function saveCheckpoint(fileId: string, newResults: ProcessingResult[]): Promise<void> {
  const current = await getCheckpoint(fileId);
  if (!current) {
    return;
  }
  const byRowId = new Map(current.results.map((r) => [r.rowId, r]));
  newResults.forEach((result) => byRowId.set(result.rowId, result));
  current.results = Array.from(byRowId.values()).sort((a, b) => a.index - b.index);
  current.updatedAt = new Date().toISOString();
  await writeAtomic(checkpointPath(fileId), current);
}

export async function restartCheckpoint(fileId: string): Promise<void> {
  await ensureDir();
  await fs.rm(checkpointPath(fileId), { force: true });
}
