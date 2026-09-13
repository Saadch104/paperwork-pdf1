// @vitest-environment jsdom
import React, { useEffect } from "react";
import { beforeAll, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  configure,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
configure({
  getElementError: (message) => new Error(message || "Element not found"),
});
import PdfEditor from "../frontend/src/components/PdfEditor";
import { applyEdits, downloadPdf } from "../frontend/src/utils/pdfEngine";
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children, onLoadSuccess, file }: any) => {
    useEffect(() => {
      onLoadSuccess?.({ numPages: 3 });
    }, [file]);
    return <div>{children}</div>;
  },
  Page: ({ pageNumber, onLoadSuccess }: any) => {
    useEffect(() => {
      let active = true;
      queueMicrotask(() => {
        if (!active) return;
        onLoadSuccess?.({
          pageNumber,
          getViewport: () => ({
            width: 595,
            height: 842,
            transform: [1, 0, 0, -1, 0, 842],
            rotation: 0,
          }),
          getTextContent: async () => ({
            items: [
              {
                str: "Hello, Alex.",
                transform: [17, 0, 0, 17, 48, 391],
                width: 90,
                fontName: "f1",
              },
            ],
            styles: {
              f1: { ascent: 0.8, descent: -0.2, fontFamily: "sans-serif" },
            },
          }),
          commonObjs: { get: () => ({ name: "Helvetica-Bold" }) },
        });
      });
      return () => {
        active = false;
      };
    }, [pageNumber]);
    return <canvas aria-label={`PDF page ${pageNumber}`} />;
  },
}));
vi.mock("../frontend/src/utils/pdfEngine", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../frontend/src/utils/pdfEngine")>();
  return {
    ...actual,
    applyEdits: vi.fn(actual.applyEdits),
    downloadPdf: vi.fn(),
  };
});
beforeAll(() => {
  Object.defineProperty(window, "ResizeObserver", {
    value: class {
      observe() {}
      disconnect() {}
    },
    configurable: true,
  });
  Element.prototype.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: (s: string) => ({ width: s.length * 9 }),
  })) as any;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function setup() {
  const user = userEvent.setup();
  render(<PdfEditor />);
  await screen.findByRole("button", { name: "Edit text: Hello, Alex." });
  return user;
}
it("opens the real sample and exposes all editor tools", async () => {
  await setup();
  for (const name of [
    "Text",
    "Links",
    "Forms",
    "Images",
    "Sign",
    "Whiteout",
    "Annotate",
    "Shapes",
  ])
    expect(screen.getByRole("button", { name, exact: true })).toBeDefined();
  expect(screen.getByText("Northline — Project proposal.pdf")).toBeDefined();
});
it("edits multiline text, changes formatting, undoes and redoes a transaction", async () => {
  const user = await setup();
  await user.click(
    screen.getByRole("button", { name: "Edit text: Hello, Alex." }),
  );
  await user.clear(screen.getByLabelText("Edit PDF text"));
  await user.type(
    screen.getByLabelText("Edit PDF text"),
    "Hello, Saad.{Enter}Second line",
  );
  await user.click(screen.getByRole("button", { name: "Italic", exact: true }));
  await user.click(screen.getByRole("button", { name: "Finish editing text" }));
  expect(screen.getByText("1 change to apply")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(
    screen.getByRole("button", { name: "Edit text: Hello, Alex." }),
  ).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Redo", exact: true }));
  expect(
    screen.getByRole("button", {
      name: /Select text: Hello, Saad.\s+Second line/,
    }),
  ).toBeDefined();
});
it("applies actual PDF bytes and resets undo history", async () => {
  const user = await setup();
  await user.click(
    screen.getByRole("button", { name: "Edit text: Hello, Alex." }),
  );
  await user.clear(screen.getByLabelText("Edit PDF text"));
  await user.type(screen.getByLabelText("Edit PDF text"), "Updated proposal");
  await user.click(
    screen.getByRole("button", { name: "Apply changes", exact: true }),
  );
  await screen.findByText("Changes applied to your PDF. Ready to download.");
  expect(applyEdits).toHaveBeenCalledOnce();
  expect(
    (
      screen.getByRole("button", {
        name: "Undo",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("preserves edits across page navigation and zoom", async () => {
  const user = await setup();
  await user.click(
    screen.getByRole("button", { name: "Edit text: Hello, Alex." }),
  );
  await user.clear(screen.getByLabelText("Edit PDF text"));
  await user.type(screen.getByLabelText("Edit PDF text"), "Keep this edit");
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(
    (
      screen.getByRole("spinbutton", {
        name: "Page number",
      }) as HTMLInputElement
    ).value,
  ).toBe("2");
  await user.click(screen.getByRole("button", { name: "Previous page" }));
  await screen.findByRole("button", { name: "Select text: Keep this edit" });
  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(
    screen.getByRole("button", { name: "Select text: Keep this edit" }),
  ).toBeDefined();
});
it("does not create an edit just by selecting unchanged text", async () => {
  const user = await setup();
  await user.click(
    screen.getByRole("button", { name: "Edit text: Hello, Alex." }),
  );
  await user.click(screen.getByRole("button", { name: "Finish editing text" }));
  expect(screen.getByText("Your workspace is ready")).toBeDefined();
  expect(
    (
      screen.getByRole("button", {
        name: "Apply changes",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("downloads a PDF and does not send it to a conversion server", async () => {
  const user = await setup();
  const fetchSpy = vi.spyOn(window, "fetch");
  await user.click(screen.getByRole("button", { name: "Download PDF" }));
  await screen.findByText("Your edited PDF has been downloaded.");
  expect(downloadPdf).toHaveBeenCalledOnce();
  expect(fetchSpy).not.toHaveBeenCalled();
});
it("shows a recoverable error for invalid PDF uploads", async () => {
  await setup();
  fireEvent.change(screen.getByLabelText("Open document"), {
    target: {
      files: [
        {
          name: "broken.pdf",
          size: 10,
          arrayBuffer: async () => new TextEncoder().encode("invalid").buffer,
        },
      ],
    },
  });
  await screen.findByRole("alert");
  expect(
    screen.getByText("This file does not appear to be a valid PDF."),
  ).toBeDefined();
  expect(screen.getByText("Northline — Project proposal.pdf")).toBeDefined();
});
it("exposes whiteout limitations and signature placement instructions", async () => {
  const user = await setup();
  await user.click(
    screen.getByRole("button", { name: "Whiteout", exact: true }),
  );
  expect(
    screen.getByText(
      "Drag over an area to cover it. This does not securely redact text.",
    ),
  ).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Sign", exact: true }));
  await user.type(screen.getByLabelText("Your name"), "Test Signature");
  await user.click(screen.getByRole("button", { name: "Use signature" }));
  expect(
    screen.getByText("Click the page to place your signature."),
  ).toBeDefined();
});
