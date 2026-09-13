import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { HttpError } from "../src/errors";
import { cleanHtml, escapeText } from "../src/convert";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "paperwork-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const fakePdf = Buffer.from("%PDF-1.7\nmock converter response");
const config = () => ({
  uploadDir: dir,
  origins: ["http://localhost:5173"],
  gotenbergUrl: "http://localhost:3001",
  concurrency: 2,
  rateLimitMax: 100,
  convertFn: vi.fn(async () => fakePdf),
});
describe("conversion API request guards", () => {
  it("reports health without disclosing paths", async () => {
    const app = await createApp(config());
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok", activeConversions: 0, capacity: 2 });
    expect(r.headers["cache-control"]).toBe("no-store");
  });
  it("accepts UTF-8 text and deletes the private upload after responding", async () => {
    const c = config(),
      app = await createApp(c);
    const r = await request(app)
      .post("/api/convert")
      .attach("file", Buffer.from("Hello"), "hello.txt");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("application/pdf");
    expect(c.convertFn).toHaveBeenCalledOnce();
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
  });
  it("returns controlled missing-file and wrong-encoding errors", async () => {
    const app = await createApp(config());
    expect(
      (
        await request(app)
          .post("/api/convert")
          .set("Content-Type", "multipart/form-data; boundary=X")
          .send("--X--\r\n")
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post("/api/convert").send({ file: "test" })).status,
    ).toBe(415);
  });
  it.each([
    ["evil.exe", "MZ", 415],
    ["empty.txt", "", 400],
    ["fake.pdf", "not PDF", 415],
    ["fake.docx", "not zip", 415],
    ["binary.txt", "hello\0world", 415],
  ])("rejects %s", async (name, content, status) => {
    const c = config(),
      app = await createApp(c);
    const r = await request(app)
      .post("/api/convert")
      .attach("file", Buffer.from(content as string), name as string);
    expect(r.status).toBe(status);
    expect(c.convertFn).not.toHaveBeenCalled();
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
  });
  it("rejects invalid UTF-8", async () => {
    const app = await createApp(config());
    const r = await request(app)
      .post("/api/convert")
      .attach("file", Buffer.from([0xff, 0xfe, 0x80]), "bad.txt");
    expect(r.status).toBe(415);
  });
  it("rejects unknown origins before receiving upload data", async () => {
    const app = await createApp(config());
    const r = await request(app)
      .post("/api/convert")
      .set("Origin", "https://attacker.example")
      .attach("file", Buffer.from("hi"), "x.txt");
    expect(r.status).toBe(403);
    expect(await readdir(dir)).toEqual([]);
  });
  it("allows the configured cross-origin frontend", async () => {
    const app = await createApp(config());
    const r = await request(app)
      .options("/api/convert")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST");
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );
  });
  it("limits text input size", async () => {
    const app = await createApp(config());
    const r = await request(app)
      .post("/api/convert")
      .attach("file", Buffer.alloc(5 * 1024 * 1024 + 1, 97), "big.txt");
    expect(r.status).toBe(413);
  });
  it("rejects multiple files and cleans up partial uploads", async () => {
    const app = await createApp(config());
    const r = await request(app)
      .post("/api/convert")
      .attach("file", Buffer.from("a"), "a.txt")
      .attach("file", Buffer.from("b"), "b.txt");
    expect(r.status).toBe(400);
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
  });
  it("cleans up on converter failures", async () => {
    const app = await createApp({
      ...config(),
      convertFn: async () => {
        throw new HttpError(503, "Converter unavailable");
      },
    });
    const r = await request(app)
      .post("/api/convert")
      .attach("file", Buffer.from("hi"), "a.txt");
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("Converter unavailable");
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
  });
  it("limits conversion requests", async () => {
    const app = await createApp({ ...config(), rateLimitMax: 1 });
    await request(app)
      .post("/api/convert")
      .attach("file", Buffer.from("a"), "a.txt");
    const r = await request(app)
      .post("/api/convert")
      .attach("file", Buffer.from("a"), "a.txt");
    expect(r.status).toBe(429);
  });
  it("bounds concurrent uploads and jobs", async () => {
    let release!: () => void;
    let started!: () => void;
    const start = new Promise<void>((r) => (started = r));
    const wait = new Promise<void>((r) => (release = r));
    const app = await createApp({
      ...config(),
      concurrency: 1,
      convertFn: async () => {
        started();
        await wait;
        return fakePdf;
      },
    });
    const first = request(app)
      .post("/api/convert")
      .attach("file", Buffer.from("a"), "a.txt")
      .then((r) => r);
    await start;
    const second = await request(app)
      .post("/api/convert")
      .attach("file", Buffer.from("b"), "b.txt");
    expect(second.status).toBe(503);
    expect(second.headers["retry-after"]).toBe("5");
    release();
    expect((await first).status).toBe(200);
  });
  it("does not serve uploads as public URLs", async () => {
    const app = await createApp(config());
    expect((await request(app).get("/uploads/anything.pdf")).status).toBe(404);
  });
});
describe("HTML sanitization", () => {
  it("removes scripts, event handlers, iframes and remote image fetches", () => {
    const html = cleanHtml(
      '<script>alert(1)</script><img src="http://169.254.169.254/latest" onerror="alert(2)"><iframe src="file:///etc/passwd"></iframe><p onclick="x()">Keep this</p>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("169.254");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Keep this");
  });
  it("removes CSS network requests while preserving simple formatting", () => {
    const html = cleanHtml(
      '<p style="color:#ff0000;background-image:url(http://secret/);font-size:20px">Title</p><style>@import "http://secret/";</style>',
    );
    expect(html).not.toContain("http://secret");
    expect(html).toContain("color:#ff0000");
    expect(html).toContain("font-size:20px");
  });
  it("removes javascript links and SVG data images", () => {
    const html = cleanHtml(
      '<a href="javascript:alert(1)">Link</a><img src="data:image/svg+xml;base64,abc">',
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:image/svg");
  });
  it("escapes plain text as literal content", () =>
    expect(escapeText('<script>"&"</script>')).toBe(
      "&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;",
    ));
});
