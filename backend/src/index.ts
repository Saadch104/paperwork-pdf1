import path from "node:path";
import { createApp } from "./app.js";
const port = Number(process.env.PORT || 4000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid port number.");
const app = await createApp({
  uploadDir: path.resolve(process.env.UPLOAD_DIR || "uploads"),
  origins: (
    process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:4173"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  gotenbergUrl: process.env.GOTENBERG_URL || "http://127.0.0.1:3001",
  concurrency: Number(process.env.CONVERSION_CONCURRENCY || 2),
  trustProxy: Number(process.env.TRUST_PROXY_HOPS || 0),
});
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`Paperwork conversion API listening on port ${port}`),
);
server.requestTimeout = 100_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5000;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 100_000).unref();
  });
