// server/index.ts
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var AMD_MACHINE_URL = process.env.AMD_MACHINE_URL || "http://localhost:8000/v1/chat/completions";
async function startServer() {
  const app = express();
  const server = createServer(app);
  app.post("/api/amd-proxy", express.json(), async (req, res) => {
    try {
      const amdRes = await fetch(AMD_MACHINE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body)
      });
      const data = await amdRes.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "AMD proxy failed", detail: String(err) });
    }
  });
  const staticPath = process.env.NODE_ENV === "production" ? path.resolve(__dirname, "public") : path.resolve(__dirname, "..", "dist", "public");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });
  const port = process.env.PORT || 3e3;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
