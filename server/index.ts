import express from "express";
import cors from "cors";
import path from "node:path";
import scrapeRoutes from "./routes/scrape";
import checkpointRoutes from "./routes/checkpoint";

const app = express();
const port = Number(process.env.API_PORT ?? 5000);

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/api", scrapeRoutes);
app.use("/api", checkpointRoutes);
app.use("/output", express.static(path.resolve(process.cwd(), process.env.OUTPUT_DIR ?? "./data/output")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
