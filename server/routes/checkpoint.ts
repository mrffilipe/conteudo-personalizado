import { Router } from "express";
import {
  getCheckpoint,
  restartCheckpoint,
  saveCheckpoint,
  startCheckpoint,
} from "../services/checkpoint-store";
import { getEmailDispatch, sendManualTestEmail, startEmailDispatch } from "../services/email-sender";
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

router.post("/checkpoint/import-email", async (req, res) => {
  const fileId = String(req.body?.fileId ?? "");
  const fileName = String(req.body?.fileName ?? "");
  const rows = (req.body?.rows ?? []) as Record<string, unknown>[];
  if (!fileId || !fileName || !Array.isArray(rows)) {
    res.status(400).json({ error: "payload invalido" });
    return;
  }
  const columnsOriginal = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];
  const started = await startCheckpoint({
    fileId,
    fileName,
    columnsOriginal,
    total: rows.length,
  });
  if (started.partialResults.length === 0 && rows.length > 0) {
    const now = new Date().toISOString();
    const imported = rows.map((row, index) => {
      const content = String(row["conteudo_gerado"] ?? "").trim();
      return {
        rowId: `r-${String(index + 1).padStart(6, "0")}`,
        success: content.length > 0,
        lead: row,
        content,
        error: content.length > 0 ? "" : "conteudo_gerado ausente",
        timestamp: now,
        aiModel: "importado-email",
        temperature: 0,
        index,
      } satisfies ProcessingResult;
    });
    await saveCheckpoint(fileId, imported);
  }
  const checkpoint = await getCheckpoint(fileId);
  res.json({
    found: true,
    completed: checkpoint?.results.length ?? 0,
    total: checkpoint?.total ?? rows.length,
  });
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
  const sendgridApiKey = String(req.body?.sendgridApiKey ?? "").trim();
  const emailSubject = String(req.body?.emailSubject ?? "").trim();
  const emailLimitRaw = Number(req.body?.emailLimit ?? 0);
  const emailLimit = Number.isFinite(emailLimitRaw) && emailLimitRaw > 0 ? Math.floor(emailLimitRaw) : 0;
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
  let emailDispatchId: string | null = null;
  let emailDispatchError: string | null = null;

  if (format === "xlsx" && sendgridApiKey) {
    try {
      const dispatch = await startEmailDispatch({
        fileId,
        sendgridApiKey,
        subject: emailSubject,
        limit: emailLimit,
      });
      emailDispatchId = dispatch.dispatchId;
    } catch (error) {
      emailDispatchError = error instanceof Error ? error.message : "Falha ao iniciar envio.";
    }
  }

  res.json({ ok: true, downloadUrl, emailDispatchId, emailDispatchError });
});

router.get("/email-dispatch/:dispatchId", (req, res) => {
  const dispatch = getEmailDispatch(String(req.params.dispatchId ?? ""));
  if (!dispatch) {
    res.status(404).json({ error: "disparo nao encontrado" });
    return;
  }
  res.json(dispatch);
});

router.post("/email-send-test", async (req, res) => {
  const sendgridApiKey = String(req.body?.sendgridApiKey ?? "");
  const to = String(req.body?.to ?? "");
  const subject = String(req.body?.subject ?? "");
  const content = String(req.body?.content ?? "");
  try {
    await sendManualTestEmail({ sendgridApiKey, to, subject, content });
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao enviar email de teste.";
    res.status(400).json({ error: message });
  }
});

export default router;
