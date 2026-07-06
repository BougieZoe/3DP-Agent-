import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // AMD Cloud代理:浏览器是HTTPS,AMD那台机器是HTTP,浏览器规则不让直连。
  // 这里让服务器代替浏览器去发请求,浏览器只跟自己的HTTPS域名说话。
  app.post("/api/amd-proxy", express.json(), async (req, res) => {
    try {
      const amdRes = await fetch("http://129.212.185.243:8000/v1/chat/completions", {
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