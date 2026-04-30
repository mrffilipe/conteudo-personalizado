export interface ScrapeResult {
  ok: boolean;
  summary?: string;
  title?: string;
  error?: string;
}

export async function scrapeWebsite(url: string): Promise<ScrapeResult> {
  if (!url || !url.trim()) {
    return { ok: false, error: "sem website" };
  }

  try {
    const response = await fetch("/api/scrape", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    return (await response.json()) as ScrapeResult;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "erro de rede",
    };
  }
}
