import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { convert } from "./convert.js";
import { extensions, MAX_UPLOAD, validateFile } from "./validate.js";
import { HttpError } from "./errors.js";

export interface AppConfig {
  uploadDir: string;
  origins: string[];
  gotenbergUrl: string;
  concurrency: number;
  convertFn?: typeof convert;
  rateLimitMax?: number;
  trustProxy?: number;
}
export async function createApp(config: AppConfig) {
  if (
    !Number.isInteger(config.concurrency) ||
    config.concurrency < 1 ||
    config.concurrency > 16
  )
    throw new Error("CONVERSION_CONCURRENCY must be an integer from 1 to 16.");
  const upstream = new URL(config.gotenbergUrl);
  if (
    !["http:", "https:"].includes(upstream.protocol) ||
    upstream.username ||
    upstream.password
  )
    throw new Error(
      "GOTENBERG_URL must be an HTTP(S) service URL without credentials.",
    );
  await mkdir(config.uploadDir, { recursive: true, mode: 0o700 });
  // Only delete our own abandoned uploads, never arbitrary files in the directory.
  for (const file of await readdir(config.uploadDir)) {
    if (!/^upload-[0-9a-f-]{36}$/.test(file)) continue;
    const p = path.join(config.uploadDir, file);
    if (Date.now() - (await stat(p)).mtimeMs > 10 * 60 * 1000)
      await unlink(p).catch(() => {});
  }
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin)) {
      next(
        new HttpError(
          403,
          "This origin is not allowed to use the conversion service.",
        ),
      );
      return;
    }
    next();
  });
  app.use(
    cors({
      origin: config.origins,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
      exposedHeaders: ["Content-Disposition"],
      credentials: false,
      maxAge: 600,
    }),
  );
  const limits = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.rateLimitMax ?? 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many conversions. Please try again in 15 minutes." },
  });
  const storage = multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, _file, cb) => cb(null, "upload-" + randomUUID()),
  });
  // Busboy signals partsLimit at the boundary itself; allow the closing boundary.
  // files:1 and fields:0 independently enforce the one-file-only contract.
  const upload = multer({
    storage,
    limits: {
      fileSize: MAX_UPLOAD,
      files: 1,
      fields: 0,
      parts: 2,
      fieldNameSize: 50,
      headerPairs: 100,
    },
    fileFilter: (_req, file, cb) => {
      if (!extensions.has(path.extname(file.originalname).toLowerCase()))
        cb(new HttpError(415, "Unsupported file type."));
      else cb(null, true);
    },
  }).single("file");
  let active = 0;
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      activeConversions: active,
      capacity: config.concurrency,
    }),
  );
  app.get("/api/ready", async (_req, res) => {
    try {
      const r = await fetch(
        config.gotenbergUrl.replace(/\/$/, "") + "/health",
        { signal: AbortSignal.timeout(2500), redirect: "error" },
      );
      await r.body?.cancel();
      res
        .status(r.ok ? 200 : 503)
        .json({ status: r.ok ? "ready" : "unavailable" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.post("/api/convert", limits, async (req, res, next) => {
    if (active >= config.concurrency) {
      res.setHeader("Retry-After", "5");
      next(
        new HttpError(
          503,
          "The conversion service is busy. Try again in a moment.",
        ),
      );
      return;
    }
    active++;
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    req.once("aborted", () => abort.abort());
    res.once("close", onClose);
    try {
      if (!req.is("multipart/form-data"))
        throw new HttpError(415, "Upload a file using multipart/form-data.");
      await new Promise<void>((resolve, reject) =>
        upload(req, res, (err) => (err ? reject(err) : resolve())),
      );
      if (!req.file) throw new HttpError(400, "Choose one file to convert.");
      const ext = await validateFile(
        req.file.path,
        req.file.originalname,
        req.file.size,
      );
      const result = await (config.convertFn ?? convert)(
        req.file.path,
        ext,
        abort.signal,
        config.gotenbergUrl,
      );
      if (abort.signal.aborted) return;
      res
        .status(200)
        .set({
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="converted.pdf"',
          "X-Content-Type-Options": "nosniff",
        })
        .send(result);
    } catch (err) {
      if (!res.destroyed) next(err);
    } finally {
      if (req.file?.path) await unlink(req.file.path).catch(() => {});
      active--;
      res.removeListener("close", onClose);
    }
  });
  app.use((_req, _res, next) => next(new HttpError(404, "Route not found.")));
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof multer.MulterError) {
      res
        .status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({
          error:
            err.code === "LIMIT_FILE_SIZE"
              ? "Files must be 25 MB or smaller."
              : "Upload exactly one file in the file field, with no other fields.",
        });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Never log user filenames, file contents, service URLs, or stack traces to API clients.
    console.error(
      JSON.stringify({
        event: "conversion_error",
        type: err instanceof Error ? err.name : "unknown",
      }),
    );
    res
      .status(500)
      .json({ error: "Conversion failed unexpectedly. Please try again." });
  };
  app.use(errorHandler);
  return app;
}
