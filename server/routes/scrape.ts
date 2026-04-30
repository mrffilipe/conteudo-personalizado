import { Router } from "express";
import { scrapeUrl } from "../services/scraper";

const router = Router();

router.post("/scrape", async (req, res) => {
  const url = String(req.body?.url ?? "").trim();
  if (!url) {
    res.status(400).json({ ok: false, error: "url obrigatoria" });
    return;
  }
  const result = await scrapeUrl(url);
  res.json(result);
});

export default router;
