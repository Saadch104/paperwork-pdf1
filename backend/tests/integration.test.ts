import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
// Real service integration gate: never label mocked conversion as Gotenberg validation.
describe.runIf(process.env.RUN_GOTENBERG_TESTS === "1")(
  "real Gotenberg conversions",
  () => {
    let dir: string, app: Awaited<ReturnType<typeof createApp>>;
    beforeAll(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), "paperwork-integration-"));
      app = await createApp({
        uploadDir: dir,
        origins: [],
        gotenbergUrl: process.env.GOTENBERG_URL || "http://127.0.0.1:3001",
        concurrency: 2,
      });
    }, 15000);
    afterAll(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
    });
    it.each(["docx", "pptx", "html", "md", "txt"])(
      "converts %s to an extractable PDF",
      async (ext) => {
        const result = await request(app)
          .post("/api/convert")
          .attach("file", path.resolve("tests/fixtures/sample." + ext))
          .buffer(true)
          .parse((res, cb) => {
            const data: Buffer[] = [];
            res.on("data", (chunk) => data.push(chunk));
            res.on("end", () => cb(null, Buffer.concat(data)));
          });
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        expect(result.headers["content-type"]).toContain("application/pdf");
        const bytes = new Uint8Array(result.body);
        expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(
          0,
        );
        const pdf = await getDocument({
          data: bytes.slice(),
          useSystemFonts: true,
        }).promise;
        const text = await (await pdf.getPage(1)).getTextContent();
        expect(
          text.items.map((i) => ("str" in i ? i.str : "")).join(" "),
        ).toContain("Paperwork conversion test");
        await pdf.destroy();
      },
      100000,
    );
  },
);
