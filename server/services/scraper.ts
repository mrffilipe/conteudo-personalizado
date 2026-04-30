import * as cheerio from "cheerio";

export interface ScrapeResult {
  ok: boolean;
  summary?: string;
  title?: string;
  error?: string;
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const timeoutMs = Number(process.env.SCRAPE_TIMEOUT_MS ?? 8000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "conteudo-personalizado/1.0",
      },
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();

    const title = $("title").first().text().trim();
    const meta = $('meta[name="description"]').attr("content")?.trim() ?? "";
    const h1 = $("h1").first().text().trim();
    const paragraphs = $("p")
      .slice(0, 8)
      .map((_idx, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .join(" ");
    const summary = [title, meta, h1, paragraphs].filter(Boolean).join(" | ").slice(0, 6000);
    return { ok: true, title, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "erro de scraping" };
  } finally {
    clearTimeout(timer);
  }
}
