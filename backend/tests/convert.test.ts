import { afterEach, it, expect, vi } from "vitest";
import path from "node:path";
import { convert } from "../src/convert";
const fixture = (ext: string) => path.resolve("tests/fixtures/sample." + ext);
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
it("sends Office to LibreOffice with the correct multipart filename", async () => {
  const mock = vi.fn(
    async () =>
      new Response("%PDF-1.7\nfixture", {
        headers: { "content-type": "application/pdf" },
      }),
  );
  vi.stubGlobal("fetch", mock);
  await convert(fixture("docx"), ".docx", signal(), "http://converter:3000");
  const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://converter:3000/forms/libreoffice/convert");
  expect(((init.body as FormData).get("files") as File).name).toBe(
    "document.docx",
  );
});
it("renders Markdown into sanitized HTML before sending it to Chromium", async () => {
  const mock = vi.fn(
    async () =>
      new Response("%PDF-1.7\nfixture", {
        headers: { "content-type": "application/pdf" },
      }),
  );
  vi.stubGlobal("fetch", mock);
  await convert(fixture("md"), ".md", signal(), "http://converter:3000/");
  const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://converter:3000/forms/chromium/convert/html");
  const file = (init.body as FormData).get("files") as File;
  expect(file.name).toBe("index.html");
  expect(await file.text()).toContain("<h1>Paperwork conversion test</h1>");
});
it("rejects non-PDF upstream content types", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("bad", { headers: { "content-type": "text/html" } }),
    ),
  );
  await expect(
    convert(fixture("txt"), ".txt", signal(), "http://converter"),
  ).rejects.toMatchObject({ status: 502 });
});
it("rejects fake PDF bytes even with a PDF content type", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("bad", { headers: { "content-type": "application/pdf" } }),
    ),
  );
  await expect(
    convert(fixture("txt"), ".txt", signal(), "http://converter"),
  ).rejects.toMatchObject({ status: 502 });
});
it("returns a service-unavailable error without exposing network internals", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("connection to secret-internal-address failed");
    }),
  );
  await expect(
    convert(fixture("txt"), ".txt", signal(), "http://converter"),
  ).rejects.toMatchObject({ status: 503 });
});
it("maps upstream timeouts to 504", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    }),
  );
  await expect(
    convert(fixture("txt"), ".txt", signal(), "http://converter"),
  ).rejects.toMatchObject({ status: 504 });
});
it("maps upstream overload to 503 and document rejection to 422", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("busy", { status: 429 })),
  );
  await expect(
    convert(fixture("txt"), ".txt", signal(), "http://converter"),
  ).rejects.toMatchObject({ status: 503 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("bad file", { status: 400 })),
  );
  await expect(
    convert(fixture("txt"), ".txt", signal(), "http://converter"),
  ).rejects.toMatchObject({ status: 422 });
});
