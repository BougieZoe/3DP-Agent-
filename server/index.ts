import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The real address of the AMD machine, read from an environment variable
// instead of hardcoded. Every time you spin up a new Droplet, you only
// need to change this one env var in Vercel's dashboard — no code edits,
// no commit, no push.
const AMD_MACHINE_URL =
  process.env.AMD_MACHINE_URL || "http://localhost:8000/v1/chat/completions";

async function startServer() {
  const app = express();
  const server = createServer(app);

  // AMD Cloud proxy: your site is HTTPS, the AMD machine is HTTP, and
  // browsers block that combination. The server makes the request instead —
  // the browser only ever talks to your own HTTPS domain.
  app.post("/api/amd-proxy", express.json(), async (req, res) => {
    try {
      const amdRes = await fetch(AMD_MACHINE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await amdRes.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "AMD proxy failed", detail: String(err) });
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);