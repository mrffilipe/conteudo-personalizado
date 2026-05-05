import sgMail from "@sendgrid/mail";
import { getCheckpoint, saveCheckpoint } from "./checkpoint-store";
import type { ProcessingResult } from "../types";

export interface EmailDispatchStats {
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

const dispatches = new Map<string, EmailDispatchStats>();

const htmlTemplate = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Potencialize suas Campanhas - Code By Mister</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=Raleway:wght@400;700&display=swap" rel="stylesheet">
    <style>
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        table { border-collapse: collapse !important; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #121212; }
        @media screen and (max-width: 600px) {
            .container { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; }
            .content-padding { padding: 30px 20px !important; }
            .hero-text { font-size: 22px !important; line-height: 30px !important; }
            .mac-bar { border-radius: 0 !important; }
            .banner-img { width: 100% !important; height: auto !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #121212; font-family: 'Poppins', 'Roboto', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #121212;">
        <tr>
            <td align="center" style="padding: 40px 10px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" max-width="600" class="container" style="background-color: #1e272e; max-width: 600px; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 1px solid #34495e;">
                    <tr>
                        <td class="mac-bar" align="left" style="background-color: #2d3e50; padding: 12px 15px; border-bottom: 1px solid #34495e;">
                            <table border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="background-color: #d32f2f; width: 12px; height: 12px; border-radius: 50%; font-size: 1px; line-height: 1px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);">&nbsp;</td>
                                    <td style="width: 8px;"></td>
                                    <td style="background-color: #e67e22; width: 12px; height: 12px; border-radius: 50%; font-size: 1px; line-height: 1px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);">&nbsp;</td>
                                    <td style="width: 8px;"></td>
                                    <td style="background-color: #4caf50; width: 12px; height: 12px; border-radius: 50%; font-size: 1px; line-height: 1px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);">&nbsp;</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 40px 20px 20px 20px;">
                            <a href="https://codebymister.com.br" target="_blank" style="text-decoration: none;">
                                <div style="font-family: 'Raleway', sans-serif; color: #4caf50; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; line-height: 1.6; text-decoration: none;">
                                    &lt;Code by Mister /&gt;
                                </div>
                            </a>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" class="content-padding" style="padding: 10px 40px 10px 40px;">
                            <h1 class="hero-text" style="margin: 0; font-family: 'Raleway', 'Roboto', sans-serif; font-size: 24px; font-weight: 700; color: #f1f1f1; line-height: 34px;">
                                Soluções de software <br>
                                <span style="color: #4caf50;">personalizadas.</span>
                            </h1>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" class="content-padding" style="padding: 20px 40px 15px 40px;">
                            __EMAIL_CONTENT__
                            <p style="margin: 20px 0 0 0; font-family: 'Poppins', 'Roboto', sans-serif; font-size: 15px; font-weight: 400; color: #f1f1f1; line-height: 26px; text-align: left;">
                                Um abraço,<br>
                                <strong style="color: #4caf50; font-weight: 600;">Filipe</strong><br>
                                <a href="https://codebymister.com.br" target="_blank" style="color: #a2d9b1; text-decoration: none; font-size: 13px;">codebymister.com.br</a>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" class="content-padding" style="padding: 10px 40px 25px 40px;">
                            <img src="https://firebasestorage.googleapis.com/v0/b/codebymister-prod.firebasestorage.app/o/gif_banner.gif?alt=media&token=8fff8735-e626-4fcb-bcde-c827b380898d" alt="Demonstração do Portfólio Code by Mister" class="banner-img" width="520" style="display: block; width: 100%; max-width: 520px; height: auto; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); border: 1px solid #34495e;">
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding: 10px 40px 50px 40px;">
                            <table border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="background-color: #4caf50; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
                                        <a href="https://wa.me/5564996459874?text=Ol%C3%A1%20Filipe%2C%20recebi%20seu%20e-mail%20e%20gostaria%20de%20bater%20um%20papo!" target="_blank" style="font-size: 15px; font-family: 'Poppins', 'Roboto', sans-serif; font-weight: 500; color: #121212; text-decoration: none; padding: 12px 28px; display: inline-block; border-radius: 8px; text-transform: none;">
                                            Fale comigo
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
                <table border="0" cellpadding="0" cellspacing="0" width="100%" max-width="600" style="max-width: 600px;">
                    <tr>
                        <td align="center" style="padding: 30px 20px;">
                            <p style="margin: 0 0 5px 0; font-family: 'Poppins', 'Roboto', sans-serif; font-size: 12px; color: #34495e; line-height: 18px;">© 2026 Code By Mister.</p>
                            <p style="margin: 0; font-family: 'Poppins', 'Roboto', sans-serif; font-size: 10px;">
                                <a href="https://codebymister.com.br/unsubscribe" style="color: #2a3b4c; text-decoration: none;">Cancelar inscrição</a>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;

function makeDispatchId(): string {
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildInjectedContent(rawContent: string): string {
  const normalized = rawContent.trim().replace(/^"(.*)"$/s, "$1");
  const safe = escapeHtml(normalized).replaceAll("\n", "<br>");
  return `<p style="margin: 0; font-family: 'Poppins', 'Roboto', sans-serif; font-size: 15px; font-weight: 400; color: #f1f1f1; line-height: 26px; text-align: left;">${safe}</p>`;
}

function buildEmailHtml(content: string): string {
  return htmlTemplate.replace("__EMAIL_CONTENT__", buildInjectedContent(content));
}

function updateDerivedStats(stats: EmailDispatchStats): void {
  stats.done = stats.sent + stats.failed;
  stats.remaining = Math.max(0, stats.total - stats.done);
  stats.successRate = stats.total > 0 ? (stats.sent / stats.total) * 100 : 0;
  stats.elapsedMs = Math.max(0, Date.now() - Date.parse(stats.startedAt));
  stats.avgMsPerEmail = stats.done > 0 ? stats.elapsedMs / stats.done : null;
  stats.emailsPerMinute = stats.done > 0 && stats.elapsedMs > 0 ? (stats.done / stats.elapsedMs) * 60_000 : null;
  stats.etaMs = stats.avgMsPerEmail != null && stats.remaining > 0 ? stats.avgMsPerEmail * stats.remaining : null;
}

function getRowValue(row: Record<string, unknown>, key: string): string {
  const direct = row[key];
  return direct == null ? "" : String(direct).trim();
}

function normalizeColumnName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findEmailOnLead(lead: Record<string, unknown>): string {
  const keys = Object.keys(lead);
  const exact = keys.find((k) => normalizeColumnName(k) === "email");
  const fuzzy = keys.find((k) => normalizeColumnName(k).includes("email"));
  const key = exact ?? fuzzy;
  if (!key) return "";
  return getRowValue(lead, key);
}

export function getEmailDispatch(dispatchId: string): EmailDispatchStats | null {
  const entry = dispatches.get(dispatchId);
  if (!entry) return null;
  updateDerivedStats(entry);
  return { ...entry, errorsSample: [...entry.errorsSample] };
}

export async function sendManualTestEmail(params: {
  sendgridApiKey: string;
  to: string;
  subject: string;
  content: string;
}): Promise<void> {
  const apiKey = params.sendgridApiKey.trim();
  const to = params.to.trim();
  const subject = params.subject.trim();
  const content = params.content.trim();
  if (!apiKey) throw new Error("API key do SendGrid obrigatoria.");
  if (!to) throw new Error("Email do destinatario obrigatorio.");
  if (!subject) throw new Error("Assunto obrigatorio.");
  if (!content) throw new Error("Conteudo obrigatorio.");

  sgMail.setApiKey(apiKey);
  await sgMail.send({
    to,
    from: { email: "contato@codebymister.com.br", name: "Filipe | Code by Mister" },
    subject,
    text: content,
    html: buildEmailHtml(content),
    replyTo: "codebymister@gmail.com",
    trackingSettings: {
      clickTracking: {
        enable: false,
        enableText: false,
      },
    },
  });
}

export async function startEmailDispatch(params: {
  fileId: string;
  sendgridApiKey: string;
  subject: string;
  limit: number;
}): Promise<{ dispatchId: string }> {
  const fileId = params.fileId.trim();
  const apiKey = params.sendgridApiKey.trim();
  const subject = params.subject.trim();
  const limit = params.limit > 0 ? Math.floor(params.limit) : 0;
  if (!fileId) throw new Error("fileId obrigatorio para envio em lote.");
  if (!apiKey) throw new Error("API key do SendGrid obrigatoria para envio.");
  if (!subject) throw new Error("Assunto obrigatorio para envio em lote.");

  const checkpoint = await getCheckpoint(fileId);
  if (!checkpoint) throw new Error("Checkpoint nao encontrado para envio em lote.");
  const ordered = [...checkpoint.results].sort((a, b) => a.index - b.index);
  const pendingRows = ordered.filter((result) => !result.emailSentSuccess);
  const rowsToProcess = limit > 0 ? pendingRows.slice(0, limit) : pendingRows;

  const dispatchId = makeDispatchId();
  const stats: EmailDispatchStats = {
    dispatchId,
    status: "running",
    total: rowsToProcess.length,
    sent: 0,
    failed: 0,
    done: 0,
    remaining: rowsToProcess.length,
    successRate: 0,
    elapsedMs: 0,
    etaMs: null,
    avgMsPerEmail: null,
    emailsPerMinute: null,
    startedAt: new Date().toISOString(),
    errorsSample: [],
  };
  dispatches.set(dispatchId, stats);

  sgMail.setApiKey(apiKey);

  void (async () => {
    try {
      for (const result of rowsToProcess) {
        const to = findEmailOnLead(result.lead);
        const content = (result.content ?? "").trim();
        const next: ProcessingResult = {
          ...result,
          emailSentAttempts: (result.emailSentAttempts ?? 0) + 1,
        };

        if (!to || !content) {
          stats.failed += 1;
          next.emailSentSuccess = false;
          next.emailSentError = "email ou conteudo_gerado ausente.";
          if (stats.errorsSample.length < 20) {
            stats.errorsSample.push(`Linha ${result.index + 2}: email ou conteudo_gerado ausente.`);
          }
          await saveCheckpoint(fileId, [next]);
          updateDerivedStats(stats);
          continue;
        }

        const html = buildEmailHtml(content);
        try {
          await sgMail.send({
            to,
            from: { email: "contato@codebymister.com.br", name: "Filipe | Code by Mister" },
            subject,
            text: content,
            html,
            replyTo: "codebymister@gmail.com",
            trackingSettings: {
              clickTracking: {
                enable: false,
                enableText: false,
              },
            },
          });
          stats.sent += 1;
          next.emailSentSuccess = true;
          next.emailSentAt = new Date().toISOString();
          next.emailSentError = "";
        } catch (error) {
          stats.failed += 1;
          next.emailSentSuccess = false;
          next.emailSentError = error instanceof Error ? error.message : "Erro desconhecido";
          if (stats.errorsSample.length < 20) {
            const message = error instanceof Error ? error.message : "Erro desconhecido";
            stats.errorsSample.push(`Linha ${result.index + 2} (${to}): ${message}`);
          }
        }
        await saveCheckpoint(fileId, [next]);
        updateDerivedStats(stats);
      }
      stats.status = "completed";
      stats.finishedAt = new Date().toISOString();
      updateDerivedStats(stats);
    } catch (error) {
      stats.status = "failed";
      stats.finishedAt = new Date().toISOString();
      if (stats.errorsSample.length < 20) {
        stats.errorsSample.push(error instanceof Error ? error.message : "Falha geral no disparo.");
      }
      updateDerivedStats(stats);
    }
  })();

  return { dispatchId };
}
