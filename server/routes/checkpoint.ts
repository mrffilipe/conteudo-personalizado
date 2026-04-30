import { Router } from "express";
import {
  getCheckpoint,
  restartCheckpoint,
  saveCheckpoint,
  startCheckpoint,
} from "../services/checkpoint-store";
import { writeOutput } from "../services/output-writer";
import type { ProcessingResult } from "../types";

const router = Router();

router.get("/checkpoint/:fileId", async (req, res) => {
  const checkpoint = await getCheckpoint(req.params.fileId);
  if (!checkpoint) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(checkpoint);
});

router.post("/checkpoint/start", async (req, res) => {
  const { fileId, fileName, columnsOriginal, total } = req.body ?? {};
  if (!fileId || !fileName || !Array.isArray(columnsOriginal)) {
    res.status(400).json({ error: "payload invalido" });
    return;
  }
  const data = await startCheckpoint({
    fileId: String(fileId),
    fileName: String(fileName),
    columnsOriginal: columnsOriginal.map(String),
    total: Number(total ?? 0),
  });
  res.json(data);
});

router.post("/checkpoint/save", async (req, res) => {
  const fileId = String(req.body?.fileId ?? "");
  const results = (req.body?.results ?? []) as ProcessingResult[];
  if (!fileId || !Array.isArray(results)) {
    res.status(400).json({ error: "payload invalido" });
    return;
  }
  await saveCheckpoint(fileId, results);
  res.json({ ok: true });
});

router.post("/checkpoint/restart", async (req, res) => {
  const fileId = String(req.body?.fileId ?? "");
  if (!fileId) {
    res.status(400).json({ error: "fileId obrigatorio" });
    return;
  }
  await restartCheckpoint(fileId);
  res.json({ ok: true });
});

router.post("/checkpoint/finish", async (req, res) => {
  const fileId = String(req.body?.fileId ?? "");
  const format = req.body?.format === "csv" ? "csv" : "xlsx";
  if (!fileId) {
    res.status(400).json({ error: "fileId obrigatorio" });
    return;
  }
  const checkpoint = await getCheckpoint(fileId);
  if (!checkpoint) {
    res.status(404).json({ error: "checkpoint nao encontrado" });
    return;
  }
  const downloadUrl = await writeOutput(checkpoint, format);
  res.json({ ok: true, downloadUrl });
});

export default router;
