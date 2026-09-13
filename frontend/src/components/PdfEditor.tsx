import {
  useState,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useCallback,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import {
  FileText,
  Upload,
  Download,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  Maximize,
  Type,
  Link2,
  TextCursorInput,
  ImagePlus,
  PenLine,
  Eraser,
  Highlighter,
  Shapes,
  Undo2,
  Redo2,
  Check,
  ShieldCheck,
  HelpCircle,
  X,
  Bold,
  Italic,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUpRight,
  MousePointer2,
  Move,
  Layers,
  CheckCheck,
  Square,
  Circle,
  RotateCw,
  LoaderCircle,
} from "lucide-react";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import type {
  Edit,
  TextBlock,
  PageInfo,
  Tool,
  FontFamily,
  Matrix,
} from "../types";
import {
  extractText,
  screenMatrix,
  matrixAt,
  cssFamily,
  multiply,
} from "../utils/textExtractor";
import { downloadPdf, safeLink } from "../utils/pdfEngine";
import { exportPdf } from "../utils/exportClient";
import { createSamplePdf } from "../utils/samplePdf";
import { historyReducer, emptyHistory } from "../utils/history";
import Modal from "./Modal";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
const options = {
  cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}standard_fonts/`,
  wasmUrl: `${import.meta.env.BASE_URL}wasm/`,
  isEvalSupported: false,
};
const toolsList = [
  { id: "text", name: "Text", icon: Type },
  { id: "links", name: "Links", icon: Link2 },
  { id: "forms", name: "Forms", icon: TextCursorInput },
  { id: "images", name: "Images", icon: ImagePlus },
  { id: "sign", name: "Sign", icon: PenLine },
  { id: "whiteout", name: "Whiteout", icon: Eraser },
  { id: "annotate", name: "Annotate", icon: Highlighter },
  { id: "shapes", name: "Shapes", icon: Shapes },
] as const;
const hints: Record<Tool, string> = {
  text: "Click existing text to edit, or click anywhere to add text.",
  links: "Drag a box over the area you want to turn into a link.",
  forms: "Drag to add a fillable text field to your PDF.",
  images: "Upload an image, then click the page to place it.",
  sign: "Type your signature, then click the page to place it.",
  whiteout:
    "Drag over an area to cover it. This does not securely redact text.",
  annotate: "Drag across an area to highlight it.",
  shapes: "Drag on the page to draw your shape.",
};
const baseEdit = {
  text: "",
  size: 14,
  color: "#202824",
  background: "#ffffff",
  family: "Helvetica" as FontFamily,
  bold: false,
  italic: false,
};
const uid = () => crypto.randomUUID();
const isText = (e: Edit) => e.kind === "text" || e.kind === "signature";
function displayStyle(edit: Edit, info: PageInfo): CSSProperties {
  const ascent = isText(edit) ? edit.size * 0.85 : edit.height;
  const t = screenMatrix(edit.matrix, info.transform, ascent);
  return {
    position: "absolute",
    left: 0,
    top: 0,
    transformOrigin: "0 0",
    transform: `matrix(${t.join(",")})`,
    width: edit.width,
    height: isText(edit)
      ? Math.max(edit.height, edit.size * 1.2 * edit.text.split("\n").length)
      : edit.height,
    fontSize: edit.size,
    lineHeight: "1.2",
    fontFamily: cssFamily(edit.family),
    fontWeight: edit.bold ? 700 : 400,
    fontStyle: edit.italic ? "italic" : "normal",
    color: edit.color,
  };
}
function TextArea({
  edit,
  style,
  onChange,
  onDone,
}: {
  edit: Edit;
  style: CSSProperties;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [edit.id]);
  return (
    <textarea
      ref={ref}
      wrap="off"
      aria-label="Edit PDF text"
      className="active-text"
      style={style}
      value={edit.text}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (
          e.key === "Escape" ||
          (e.key === "Enter" && (e.ctrlKey || e.metaKey))
        ) {
          e.preventDefault();
          onDone();
        }
      }}
    />
  );
}

export default function PdfEditor() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null),
    [fileName, setFileName] = useState("Northline — Project proposal.pdf"),
    [sample, setSample] = useState(true);
  const [pageNum, setPageNum] = useState(1),
    [numPages, setNumPages] = useState(0),
    [zoom, setZoom] = useState(0.9),
    [fit, setFit] = useState(true);
  const [tool, setTool] = useState<Tool>("text"),
    [sideOpen, setSideOpen] = useState(true),
    [help, setHelp] = useState(false),
    [uploadOpen, setUploadOpen] = useState(false);
  const [history, dispatch] = useReducer(historyReducer, emptyHistory),
    [draft, setDraft] = useState<Edit | null>(null),
    [defaults, setDefaults] = useState(baseEdit);
  const [blocks, setBlocks] = useState<TextBlock[]>([]),
    [info, setInfo] = useState<PageInfo | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [imageData, setImageData] = useState<{ url: string; ratio: number } | null>(
      null,
    ),
    [signature, setSignature] = useState(""),
    [signOpen, setSignOpen] = useState(false),
    [shape, setShape] = useState<"rectangle" | "ellipse">("rectangle");
  const [drag, setDrag] = useState<{
      start: [number, number];
      end: [number, number];
    } | null>(null),
    [linkEdit, setLinkEdit] = useState<Edit | null>(null),
    [linkUrl, setLinkUrl] = useState("https://");
  const [pendingFile, setPendingFile] = useState<File | null>(null),
    [pageInput, setPageInput] = useState("1");
  const fileInput = useRef<HTMLInputElement>(null),
    imageInput = useRef<HTMLInputElement>(null),
    stage = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null),
    pageProxy = useRef<PDFPageProxy | null>(null);
  const importId = useRef(0),
    conversionAbort = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const bytesFile = useMemo(
    () => (bytes ? { data: bytes.slice() } : null),
    [bytes],
  );
  const pending = useMemo(() => {
    if (!draft) return history.present;
    const others = history.present.filter((e) => e.id !== draft.id);
    return [...others, draft];
  }, [history.present, draft]);
  const draftChanged =
    !!draft &&
    JSON.stringify(history.present.find((e) => e.id === draft.id)) !==
      JSON.stringify(draft);
  const hasChanges =
    history.present.length > 0 ||
    !!(
      draft &&
      (!draft.original || draft.text !== draft.original.text || draftChanged)
    );
  const activeFormat = draft ?? defaults;
  useEffect(() => {
    mounted.current = true;
    createSamplePdf()
      .then((b) => {
        if (mounted.current) setBytes(b);
      })
      .catch(() =>
        setError("Could not open the sample PDF. Please upload a file."),
      );
    return () => {
      mounted.current = false;
      conversionAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    setPageInput(String(pageNum));
    setBlocks([]);
    setInfo(null);
    pageProxy.current = null;
  }, [pageNum, bytes]);
  useEffect(() => {
    if (!fit || !info || !stage.current) return;
    const el = stage.current;
    const update = () =>
      setZoom(
        Math.min(
          1.15,
          Math.max(
            0.25,
            (el.clientWidth - (el.clientWidth < 600 ? 28 : 96)) / info.width,
          ),
        ),
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit, info, sideOpen]);
  useEffect(() => {
    if (!hasChanges) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [hasChanges]);
  const commitDraft = useCallback(() => {
    let edits = history.present;
    if (draft) {
      const unchanged =
        draft.original &&
        draft.text === draft.original.text &&
        draft.size === draft.original.size &&
        draft.color === draft.original.color &&
        draft.family === draft.original.family &&
        draft.bold === draft.original.bold &&
        draft.italic === draft.original.italic &&
        JSON.stringify(draft.matrix) === JSON.stringify(draft.original.matrix);
      edits = unchanged
        ? history.present.filter((e) => e.id !== draft.id)
        : pending;
      if (JSON.stringify(edits) !== JSON.stringify(history.present))
        dispatch({ type: "commit", edits });
    }
    setDraft(null);
    return edits;
  }, [draft, history.present, pending]);
  const undo = useCallback(() => {
    if (draft) {
      commitDraft();
    }
    dispatch({ type: "undo" });
    setDraft(null);
  }, [draft, commitDraft]);
  const redo = useCallback(() => {
    commitDraft();
    dispatch({ type: "redo" });
  }, [commitDraft]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (e.key === "Escape" && !typing) {
        setDraft(null);
        setDrag(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [undo, redo]);
  const changeFormat = (patch: Partial<Edit>) => {
    if (draft)
      setDraft({
        ...draft,
        ...patch,
        ...(patch.size
          ? {
              width: Math.max(
                draft.original?.width || 40,
                (draft.width * patch.size) / draft.size,
              ),
            }
          : {}),
      });
    else setDefaults({ ...defaults, ...patch });
  };
  function selectBlock(block: TextBlock) {
    if (busy || draft?.id === block.id) return;
    const edits = commitDraft();
    const existing = edits.find((e) => e.id === block.id);
    setDraft(
      existing ?? {
        ...baseEdit,
        ...block,
        id: block.id,
        kind: "text",
        height: block.size * 1.2,
        original: block,
        background: "#ffffff",
      },
    );
  }
  function changeTool(next: Tool) {
    commitDraft();
    setTool(next);
    setDrag(null);
    if (next === "images" && !imageData) imageInput.current?.click();
    if (next === "sign" && !signature) setSignOpen(true);
  }
  function goPage(n: number) {
    commitDraft();
    setPageNum(Math.max(1, Math.min(numPages, Math.round(n))));
    stage.current?.scrollTo({ top: 0 });
  }
  function localPoint(e: PointerEvent): [number, number] {
    const r = surface.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(info!.width, (e.clientX - r.left) / zoom)),
      Math.max(0, Math.min(info!.height, (e.clientY - r.top) / zoom)),
    ];
  }
  function startDraw(e: PointerEvent<HTMLDivElement>) {
    if (!info || busy || e.button !== 0 || e.target !== e.currentTarget) return;
    commitDraft();
    const [x, y] = localPoint(e);
    if (tool === "text") {
      setDraft({
        ...baseEdit,
        ...defaults,
        id: uid(),
        page: pageNum,
        kind: "text",
        text: "Your text",
        matrix: matrixAt(info, x, y + defaults.size * 0.85),
        width: Math.min(210, Math.max(40, info.width - x)),
        height: defaults.size * 1.2,
      });
      return;
    }
    if (tool === "images") {
      if (!imageData) {
        imageInput.current?.click();
        return;
      }
      const width = Math.min(180, info.width - x),
        height = width / imageData.ratio;
      setDraft({
        ...baseEdit,
        id: uid(),
        page: pageNum,
        kind: "image",
        matrix: matrixAt(info, x, y + height),
        width,
        height,
        dataUrl: imageData.url,
      });
      return;
    }
    if (tool === "sign") {
      if (!signature.trim()) {
        setSignOpen(true);
        return;
      }
      setDraft({
        ...baseEdit,
        id: uid(),
        page: pageNum,
        kind: "signature",
        text: signature.trim(),
        family: "Times",
        italic: true,
        size: 28,
        matrix: matrixAt(info, x, y + 24),
        width: Math.min(300, info.width - x),
        height: 36,
      });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ start: [x, y], end: [x, y] });
  }
  function endDraw(e: PointerEvent<HTMLDivElement>) {
    if (!drag || !info) return;
    const end = localPoint(e);
    const x = Math.min(drag.start[0], end[0]),
      y = Math.min(drag.start[1], end[1]),
      width = Math.abs(end[0] - drag.start[0]),
      height = Math.abs(end[1] - drag.start[1]);
    setDrag(null);
    if (width < 4 || height < 4) return;
    const kind =
      tool === "whiteout"
        ? "whiteout"
        : tool === "annotate"
          ? "highlight"
          : tool === "links"
            ? "link"
            : tool === "forms"
              ? "form"
              : shape;
    const edit: Edit = {
      ...baseEdit,
      ...defaults,
      id: uid(),
      page: pageNum,
      kind,
      matrix: matrixAt(info, x, y + height),
      width,
      height,
      color: kind === "highlight" ? "#f5cf4a" : defaults.color,
    };
    if (kind === "link") {
      setLinkEdit(edit);
      setLinkUrl("https://");
      return;
    }
    if (kind === "form") {
      edit.fieldName = "Text field";
      edit.text = "";
    }
    setDraft(edit);
  }
  async function loadFile(file: File) {
    const token = ++importId.current;
    conversionAbort.current?.abort();
    const controller = new AbortController();
    conversionAbort.current = controller;
    setError("");
    setBusy("Opening your document…");
    setUploadOpen(false);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (
        !["pdf", "docx", "pptx", "html", "htm", "md", "txt"].includes(ext || "")
      )
        throw new Error(
          "Choose a PDF, Word, PowerPoint, HTML, Markdown, or text file.",
        );
      if (!file.size) throw new Error("This file is empty.");
      if (file.size > 25 * 1024 * 1024)
        throw new Error("Files must be 25 MB or smaller.");
      let result: Uint8Array;
      if (ext === "pdf") {
        result = new Uint8Array(await file.arrayBuffer());
        if (!new TextDecoder().decode(result.slice(0, 1024)).includes("%PDF-"))
          throw new Error("This file does not appear to be a valid PDF.");
      } else {
        setBusy("Converting your document to PDF…");
        const form = new FormData();
        form.append("file", file);
        const timeout = setTimeout(() => controller.abort(), 95000);
        let response: Response;
        try {
          response = await fetch(
            `${import.meta.env.VITE_API_URL || ""}/api/convert`,
            {
              method: "POST",
              body: form,
              signal: controller.signal,
              credentials: "omit",
            },
          );
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) {
          let message =
            "Document conversion is unavailable. Start the included backend and Gotenberg, then try again.";
          try {
            const body = await response.json();
            if (body.error) message = body.error;
          } catch {
            /* Static-host fallback is HTML. */
          }
          throw new Error(message);
        }
        if (!response.headers.get("content-type")?.includes("application/pdf"))
          throw new Error(
            "The conversion service is not connected. Run the self-hosted backend to open Office, HTML, Markdown, and text files. PDF editing works here now.",
          );
        result = new Uint8Array(await response.arrayBuffer());
      }
      // Validate before replacing the current document and its unsaved edits.
      const parsed = await PDFDocument.load(result.slice(), {
        updateMetadata: false,
      });
      if (parsed.isEncrypted)
        throw new Error(
          "Password-protected PDFs are not supported. Unlock the file first.",
        );
      if (parsed.getPageCount() < 1) throw new Error("The PDF has no pages.");
      if (parsed.getPageCount() > 500)
        throw new Error("This editor supports up to 500 pages per document.");
      for (const p of parsed.getPages()) {
        const unit =
          p.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber)?.asNumber() ||
          1;
        const box = p.getCropBox();
        if (
          !Number.isFinite(unit) ||
          unit <= 0 ||
          ![box.width, box.height].every(
            (n) => Number.isFinite(n) && n > 0 && n * unit <= 14400,
          )
        )
          throw new Error(
            "This PDF contains a page larger than the supported 200-inch canvas.",
          );
      }
      if (token !== importId.current) return;
      setDraft(null);
      dispatch({ type: "reset" });
      setBytes(result);
      setDoc(null);
      setNumPages(0);
      setPageNum(1);
      setFileName(file.name.replace(/\.[^.]+$/, "") + ".pdf");
      setSample(false);
      setNotice("Your document is ready to edit.");
      setFit(true);
    } catch (e) {
      if (token === importId.current)
        setError(
          e instanceof Error
            ? e.name === "AbortError"
              ? "Conversion timed out. Please try a smaller file."
              : e.message
            : "Could not open this file.",
        );
    } finally {
      if (token === importId.current) setBusy("");
    }
  }
  function requestFile(file?: File) {
    if (!file) return;
    if (hasChanges) {
      setPendingFile(file);
      setUploadOpen(false);
    } else void loadFile(file);
  }
  async function importImage(file?: File) {
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Images must be 8 MB or smaller.");
      const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const png =
        head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71;
      const jpg = head[0] === 255 && head[1] === 216;
      if (!png && !jpg) throw new Error("Use a PNG or JPEG image.");
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(
          new Blob([file], { type: png ? "image/png" : "image/jpeg" }),
        );
      });
      const img = new Image();
      img.src = data;
      await img.decode();
      if (img.width * img.height > 25_000_000)
        throw new Error("Choose an image under 25 megapixels.");
      setImageData({ url: data, ratio: img.width / img.height });
      setTool("images");
      setNotice("Click the page to place your image.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open image.");
    }
  }
  async function apply(download = false) {
    if (!bytes || busy) return;
    const edits = commitDraft();
    setBusy(download ? "Preparing your download…" : "Applying your changes…");
    setError("");
    try {
      const output = edits.length ? await exportPdf(bytes, edits) : bytes;
      if (download) downloadPdf(output, fileName);
      if (edits.length) {
        setDoc(null);
        setBytes(output);
        dispatch({ type: "reset" });
        setDraft(null);
      }
      setNotice(
        download
          ? "Your edited PDF has been downloaded."
          : "Changes applied to your PDF. Ready to download.",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not apply changes. Your edits are still here.",
      );
    } finally {
      setBusy("");
    }
  }
  async function loadedPage(p: PDFPageProxy) {
    pageProxy.current = p;
    try {
      const result = await extractText(p);
      if (pageProxy.current === p) {
        setBlocks(result.blocks);
        setInfo(result.info);
      }
    } catch {
      setError(
        "Text extraction failed on this page. You can still add text and annotations.",
      );
    }
  }
  function deleteDraft() {
    if (!draft) return;
    const edits = history.present.filter((e) => e.id !== draft.id);
    if (draft.original) {
      setDraft({ ...draft, text: "" });
      commitDeletion({ ...draft, text: "" });
    } else {
      dispatch({ type: "commit", edits });
      setDraft(null);
    }
  }
  function commitDeletion(edit: Edit) {
    dispatch({
      type: "commit",
      edits: [...history.present.filter((e) => e.id !== edit.id), edit],
    });
    setDraft(null);
  }
  const pageEdits = pending.filter((e) => e.page === pageNum);
  const changedCount =
    history.present.length +
    (draft && !history.present.some((e) => e.id === draft.id) ? 1 : 0);
  const canUndo = history.past.length > 0 || draftChanged;
  const thumbPages = Array.from(
    { length: Math.min(numPages, 7) },
    (_, i) => Math.max(1, Math.min(pageNum - 3, numPages - 6)) + i,
  ).filter((n) => n <= numPages);
  return (
    <div className="app-shell">
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.pptx,.html,.htm,.md,.txt"
        aria-label="Open document"
        onChange={(e) => {
          requestFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={imageInput}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg"
        aria-label="Open image"
        onChange={(e) => {
          void importImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <header className="app-header">
        <a
          href="#"
          className="brand"
          onClick={(e) => e.preventDefault()}
          aria-label="Paperwork PDF editor"
        >
          <span className="brand-mark">
            <FileText size={22} strokeWidth={1.8} />
          </span>
          paperwork<span className="brand-dot">.</span>
        </a>
        <span className="header-divider" />
        <span className="product-label">PDF Editor</span>
        <div className="header-right">
          <span className="open-source">
            <span />
            Free & open source
          </span>
          <button
            className="icon-btn help-btn"
            aria-label="Help and keyboard shortcuts"
            onClick={() => setHelp(true)}
          >
            <HelpCircle size={20} />
          </button>
          <span className="avatar" aria-label="Local workspace">
            P
          </span>
        </div>
      </header>
      <div className="document-bar">
        <div className="document-title">
          <span className="pdf-icon">
            <FileText size={20} />
            <small>PDF</small>
          </span>
          <div>
            <div className="file-name">
              {fileName}
              {sample && <span className="sample-badge">Sample</span>}
            </div>
            <div className="file-meta">
              {numPages || "—"} pages<span>·</span>
              {bytes
                ? `${Math.max(1, Math.round(bytes.length / 1024))} KB`
                : "Loading"}
              <span>·</span>
              <ShieldCheck size={12} /> PDF stays on your device
            </div>
          </div>
        </div>
        <div className="document-actions">
          <button
            className="secondary upload-btn"
            onClick={() => setUploadOpen(true)}
            disabled={!!busy}
          >
            <Upload size={16} />
            <span>Open file</span>
          </button>
          <button
            className="primary"
            onClick={() => void apply(true)}
            disabled={!bytes || !!busy}
          >
            <Download size={16} />
            <span>Download PDF</span>
          </button>
        </div>
      </div>
      <nav className="tools-bar" aria-label="PDF editing tools">
        <div className="tools-list">
          {toolsList.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${tool === t.id ? "selected" : ""}`}
              aria-pressed={tool === t.id}
              onClick={() => changeTool(t.id)}
              disabled={!!busy}
            >
              <t.icon size={18} />
              {t.name}
              {["sign", "annotate", "shapes"].includes(t.id) && (
                <ChevronDown size={12} className="tool-chevron" />
              )}
            </button>
          ))}
        </div>
        <div className="undo-tools">
          <button
            className="icon-btn"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={!canUndo || !!busy}
            onClick={undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!history.future.length || !!busy}
            onClick={redo}
          >
            <Redo2 size={18} />
          </button>
        </div>
      </nav>
      {error && (
        <div role="alert" className="error-banner">
          <span>{error}</span>
          <button
            className="icon-btn"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <main className={`workspace ${!sideOpen ? "collapsed" : ""}`}>
        <aside className="pages-sidebar">
          <div className="sidebar-heading">
            <span>
              Pages <small>{numPages}</small>
            </span>
            <button
              className="icon-btn"
              aria-label={
                sideOpen ? "Hide page thumbnails" : "Show page thumbnails"
              }
              onClick={() => setSideOpen(!sideOpen)}
            >
              {sideOpen ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </button>
          </div>
          {sideOpen && (
            <>
              <div className="thumbnail-scroll">
                {doc && (
                  <>
                    {thumbPages.map((n) => (
                      <button
                        key={n}
                        aria-label={`Go to page ${n}`}
                        aria-current={pageNum === n ? "page" : undefined}
                        className={`thumbnail-button ${pageNum === n ? "current" : ""}`}
                        onClick={() => goPage(n)}
                      >
                        <div className="thumbnail-paper">
                          <Page
                            pdf={doc}
                            pageNumber={n}
                            width={116}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            devicePixelRatio={1}
                            loading={
                              <div style={{ width: 116, height: 164 }} />
                            }
                          />
                          {history.present.some((e) => e.page === n) && (
                            <span
                              className="edited-dot"
                              title="Unapplied edits"
                            />
                          )}
                        </div>
                        <span>{n}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
              <div className="sidebar-bottom">
                <ShieldCheck size={16} />
                <span>Private by design</span>
              </div>
            </>
          )}
        </aside>
        <section className="editor-area">
          <div className="view-bar">
            <div className="page-navigation">
              <span className="page-word">Page</span>
              <input
                type="number"
                aria-label="Page number"
                min="1"
                max={numPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => {
                  const n = Number(pageInput);
                  goPage(Number.isFinite(n) && n > 0 ? n : pageNum);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <span className="muted">of {numPages || "—"}</span>
              <div className="navigation-arrows">
                <button
                  className="icon-btn"
                  aria-label="Previous page"
                  disabled={pageNum <= 1}
                  onClick={() => goPage(pageNum - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Next page"
                  disabled={pageNum >= numPages}
                  onClick={() => goPage(pageNum + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="zoom-controls">
              <button
                className="icon-btn"
                aria-label="Zoom out"
                onClick={() => {
                  setFit(false);
                  setZoom(Math.max(0.25, zoom - 0.1));
                }}
                disabled={zoom <= 0.25}
              >
                <Minus size={16} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                className="icon-btn"
                aria-label="Zoom in"
                onClick={() => {
                  setFit(false);
                  setZoom(Math.min(3, zoom + 0.1));
                }}
                disabled={zoom >= 3}
              >
                <Plus size={16} />
              </button>
              <span className="mini-divider" />
              <button
                className={`icon-btn ${fit ? "fit-active" : ""}`}
                aria-label="Fit to width"
                title="Fit to width"
                onClick={() => setFit(true)}
              >
                <Maximize size={16} />
              </button>
            </div>
          </div>
          <div className="context-hint">
            <MousePointer2 size={14} />
            <span>{hints[tool]}</span>
            {tool === "shapes" && (
              <div className="inline-options">
                <button
                  className={shape === "rectangle" ? "active" : ""}
                  aria-label="Rectangle"
                  onClick={() => setShape("rectangle")}
                >
                  <Square size={14} />
                </button>
                <button
                  className={shape === "ellipse" ? "active" : ""}
                  aria-label="Ellipse"
                  onClick={() => setShape("ellipse")}
                >
                  <Circle size={14} />
                </button>
              </div>
            )}
            {tool === "images" && imageData && (
              <button
                className="text-link"
                onClick={() => imageInput.current?.click()}
              >
                Change image
              </button>
            )}
            {tool === "sign" && signature && (
              <button className="text-link" onClick={() => setSignOpen(true)}>
                Change signature
              </button>
            )}
          </div>
          <div ref={stage} className="canvas-stage">
            {draft && isText(draft) && (
              <div className="floating-format" aria-label="Text formatting">
                <select
                  aria-label="Font family"
                  value={draft.family}
                  onChange={(e) =>
                    changeFormat({ family: e.target.value as FontFamily })
                  }
                >
                  <option value="Helvetica">Helvetica</option>
                  <option value="Times">Times Roman</option>
                  <option value="Courier">Courier</option>
                </select>
                <span className="mini-divider" />
                <button
                  className={`icon-btn ${draft.bold ? "format-on" : ""}`}
                  aria-label="Bold"
                  aria-pressed={draft.bold}
                  onClick={() => changeFormat({ bold: !draft.bold })}
                >
                  <Bold size={16} />
                </button>
                <button
                  className={`icon-btn ${draft.italic ? "format-on" : ""}`}
                  aria-label="Italic"
                  aria-pressed={draft.italic}
                  onClick={() => changeFormat({ italic: !draft.italic })}
                >
                  <Italic size={16} />
                </button>
                <input
                  aria-label="Font size"
                  type="number"
                  min="4"
                  max="200"
                  value={draft.size}
                  onChange={(e) =>
                    changeFormat({
                      size: Math.max(
                        4,
                        Math.min(200, Number(e.target.value) || 14),
                      ),
                    })
                  }
                />
                <label className="color-control" title="Text color">
                  <span style={{ color: draft.color }}>A</span>
                  <input
                    type="color"
                    aria-label="Text color"
                    value={draft.color}
                    onChange={(e) => changeFormat({ color: e.target.value })}
                  />
                </label>
                <span className="mini-divider" />
                <button
                  className="icon-btn danger"
                  aria-label="Delete selected text"
                  onClick={deleteDraft}
                >
                  <Trash2 size={16} />
                </button>
                <button
                  className="done-text"
                  aria-label="Finish editing text"
                  onClick={commitDraft}
                >
                  <Check size={17} />
                </button>
              </div>
            )}
            <div
              className="page-container"
              style={{
                width: info ? info.width * zoom : 595 * zoom,
                minHeight: info ? info.height * zoom : 842 * zoom,
              }}
            >
              {bytesFile && (
                <Document
                  key={bytes?.byteLength + "-" + fileName}
                  file={bytesFile}
                  options={options}
                  onLoadSuccess={(pdf) => {
                    setNumPages(pdf.numPages);
                    setDoc(pdf);
                  }}
                  onLoadError={(e) =>
                    setError(`This PDF could not be displayed: ${e.message}`)
                  }
                  onPassword={() =>
                    setError(
                      "Password-protected PDFs are not supported. Unlock your PDF first.",
                    )
                  }
                  loading={
                    <div className="page-loading">
                      <LoaderCircle className="spin" />
                      Loading PDF…
                    </div>
                  }
                >
                  <Page
                    pageNumber={pageNum}
                    scale={zoom}
                    renderTextLayer
                    renderAnnotationLayer={false}
                    devicePixelRatio={Math.min(
                      window.devicePixelRatio || 1,
                      2,
                      Math.sqrt(
                        12000000 /
                          ((info?.width || 595) *
                            zoom *
                            (info?.height || 842) *
                            zoom),
                      ),
                    )}
                    onLoadSuccess={loadedPage}
                    onRenderSuccess={() => {
                      if (pageProxy.current) void loadedPage(pageProxy.current);
                    }}
                    loading={
                      <div className="page-loading">
                        <LoaderCircle className="spin" />
                        Rendering page…
                      </div>
                    }
                  />
                </Document>
              )}
              {info && (
                <div
                  ref={surface}
                  className={`edit-surface tool-${tool}`}
                  style={{
                    width: info.width,
                    height: info.height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "0 0",
                  }}
                  onPointerDown={startDraw}
                  onPointerMove={(e) => {
                    if (drag) setDrag({ ...drag, end: localPoint(e) });
                  }}
                  onPointerUp={endDraw}
                  onPointerCancel={() => setDrag(null)}
                >
                  {tool === "text" &&
                    blocks
                      .filter((b) => !pageEdits.some((e) => e.id === b.id))
                      .map((block) => {
                        const t = screenMatrix(
                          block.matrix,
                          info.transform,
                          block.ascent,
                        );
                        return (
                          <button
                            key={block.id}
                            className="text-hit"
                            aria-label={`Edit text: ${block.text}`}
                            title="Click to edit text"
                            style={{
                              width: block.width,
                              height: block.ascent + block.descent,
                              transform: `matrix(${t.join(",")})`,
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => selectBlock(block)}
                          />
                        );
                      })}
                  {pageEdits.map((edit) => (
                    <div
                      key={edit.id}
                      className="edit-item"
                      style={{ pointerEvents: "none" }}
                    >
                      {edit.original && (
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            transformOrigin: "0 0",
                            transform: `matrix(${screenMatrix(edit.original.matrix, info.transform, edit.original.ascent + 1.5).join(",")}) translateX(-1.5px)`,
                            width: edit.original.width + 3,
                            height:
                              edit.original.ascent + edit.original.descent + 3,
                            background: edit.background,
                            pointerEvents: "none",
                          }}
                        />
                      )}
                      {draft?.id === edit.id && isText(edit) ? (
                        <TextArea
                          edit={edit}
                          style={{
                            ...displayStyle(edit, info),
                            width: Math.max(edit.width, 60),
                            background: "transparent",
                            pointerEvents: "auto",
                          }}
                          onChange={(text) => {
                            const canvas = document.createElement("canvas");
                            const ctx = canvas.getContext("2d");
                            if (ctx)
                              ctx.font = `${edit.italic ? "italic " : ""}${edit.bold ? "bold " : ""}${edit.size}px ${cssFamily(edit.family)}`;
                            const width = Math.max(
                              edit.original?.width || 40,
                              ...text
                                .split("\n")
                                .map(
                                  (line) =>
                                    (ctx?.measureText(line).width ||
                                      line.length * edit.size * 0.6) + 4,
                                ),
                            );
                            setDraft({ ...edit, text, width });
                          }}
                          onDone={commitDraft}
                        />
                      ) : (
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`Select ${edit.kind}${edit.text ? ": " + edit.text : ""}`}
                          className={`drawn-edit ${edit.kind} ${draft?.id === edit.id ? "active-object" : ""}`}
                          style={{
                            ...displayStyle(edit, info),
                            pointerEvents:
                              tool === "text" || draft?.id === edit.id
                                ? "auto"
                                : "none",
                            background:
                              edit.kind === "whiteout"
                                ? edit.background
                                : edit.kind === "highlight"
                                  ? `${edit.color}4d`
                                  : undefined,
                            borderColor: edit.color,
                            whiteSpace: "pre",
                            borderRadius:
                              edit.kind === "ellipse" ? "50%" : undefined,
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            commitDraft();
                            setDraft(edit);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              commitDraft();
                              setDraft(edit);
                            }
                          }}
                        >
                          {edit.kind === "image" ? (
                            <img
                              src={edit.dataUrl}
                              alt="Inserted image"
                              draggable={false}
                            />
                          ) : isText(edit) ? (
                            edit.text
                          ) : edit.kind === "form" ? (
                            <span>{edit.text || "Text field"}</span>
                          ) : edit.kind === "link" ? (
                            <Link2 size={Math.min(18, edit.height - 2)} />
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                  {drag && (
                    <div
                      className="drag-preview"
                      style={{
                        left: Math.min(drag.start[0], drag.end[0]),
                        top: Math.min(drag.start[1], drag.end[1]),
                        width: Math.abs(drag.end[0] - drag.start[0]),
                        height: Math.abs(drag.end[1] - drag.start[1]),
                      }}
                    />
                  )}
                </div>
              )}
            </div>
            <div className="page-caption">
              {pageNum} / {numPages || "—"}
            </div>
          </div>
          <footer className="apply-bar">
            <div>
              <span
                className={`change-indicator ${changedCount ? "unsaved" : ""}`}
              >
                <CheckCheck size={16} />
              </span>
              <span>
                {changedCount
                  ? `${changedCount} ${changedCount === 1 ? "change" : "changes"} to apply`
                  : "Your workspace is ready"}
                <small>
                  {changedCount
                    ? "Apply to save edits into the PDF"
                    : "Original files are always kept safe"}
                </small>
              </span>
            </div>
            <button
              className="primary apply-button"
              disabled={!bytes || !!busy || !hasChanges}
              onClick={() => void apply(false)}
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Check size={17} />
              )}
              Apply changes
            </button>
          </footer>
        </section>
        <aside className="inspector">
          <div className="inspector-title">
            <span>{draft ? "Edit properties" : "Make it your own"}</span>
            {draft ? <Layers size={17} /> : <PenLine size={17} />}
          </div>
          {draft ? (
            <>
              <div className="property-panel">
                <label>
                  Selected object
                  <span className="object-type">{draft.kind}</span>
                </label>
                {!isText(draft) && (
                  <>
                    <label>
                      Width <span>pt</span>
                      <input
                        aria-label="Object width"
                        type="number"
                        min="4"
                        max="2000"
                        value={Math.round(draft.width)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            width: Math.max(
                              4,
                              Math.min(2000, Number(e.target.value) || 4),
                            ),
                            height:
                              draft.kind === "image"
                                ? (Math.max(
                                    4,
                                    Math.min(2000, Number(e.target.value) || 4),
                                  ) *
                                    draft.height) /
                                  draft.width
                                : draft.height,
                          })
                        }
                      />
                    </label>
                    <label>
                      Height <span>pt</span>
                      <input
                        aria-label="Object height"
                        type="number"
                        min="4"
                        max="2000"
                        value={Math.round(draft.height)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            height: Math.max(
                              4,
                              Math.min(2000, Number(e.target.value) || 4),
                            ),
                          })
                        }
                      />
                    </label>
                  </>
                )}
                {draft.kind === "form" && (
                  <>
                    <label>
                      Field name
                      <input
                        aria-label="Field name"
                        value={draft.fieldName || ""}
                        onChange={(e) =>
                          setDraft({ ...draft, fieldName: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Default value
                      <input
                        aria-label="Field default value"
                        value={draft.text}
                        onChange={(e) =>
                          setDraft({ ...draft, text: e.target.value })
                        }
                      />
                    </label>
                  </>
                )}
                {draft.kind === "link" && (
                  <label>
                    Destination
                    <input
                      aria-label="Link destination"
                      value={draft.url || ""}
                      onChange={(e) =>
                        setDraft({ ...draft, url: e.target.value })
                      }
                    />
                  </label>
                )}
                {draft.kind !== "image" && (
                  <label>
                    {draft.kind === "whiteout" ? "Cover color" : "Color"}
                    <input
                      type="color"
                      aria-label="Object color"
                      value={
                        draft.kind === "whiteout"
                          ? draft.background
                          : draft.color
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [draft.kind === "whiteout" ? "background" : "color"]:
                            e.target.value,
                        })
                      }
                    />
                  </label>
                )}
                {draft.original && (
                  <label>
                    Background cover
                    <input
                      type="color"
                      aria-label="Background cover color"
                      value={draft.background}
                      onChange={(e) =>
                        setDraft({ ...draft, background: e.target.value })
                      }
                    />
                  </label>
                )}
                <label>
                  Move <span>2 pt</span>
                </label>
                <div className="move-controls">
                  {[
                    ["←", -2, 0],
                    ["↑", 0, 2],
                    ["↓", 0, -2],
                    ["→", 2, 0],
                  ].map(([label, x, y]) => (
                    <button
                      key={String(label)}
                      className="secondary"
                      aria-label={`Move ${label}`}
                      onClick={() => {
                        if (!info) return;
                        const delta = matrixAt(info, Number(x), -Number(y)),
                          origin = matrixAt(info, 0, 0);
                        setDraft({
                          ...draft,
                          matrix: [
                            ...draft.matrix.slice(0, 4),
                            draft.matrix[4] + delta[4] - origin[4],
                            draft.matrix[5] + delta[5] - origin[5],
                          ] as Matrix,
                        });
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!draft.original &&
                  draft.kind !== "form" &&
                  draft.kind !== "link" && (
                    <button
                      className="secondary full"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          matrix: multiply(draft.matrix, [0, 1, -1, 0, 0, 0]),
                        })
                      }
                    >
                      <RotateCw size={15} /> Rotate 90°
                    </button>
                  )}
                <div className="property-actions">
                  <button className="secondary danger" onClick={deleteDraft}>
                    <Trash2 size={15} />
                    Remove
                  </button>
                  <button className="primary" onClick={commitDraft}>
                    <Check size={15} />
                    Done
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="inspector-intro">
                A few small edits.
                <br />A document that’s all you.
              </p>
              <div className="guide-step">
                <span>1</span>
                <div>
                  <strong>Choose a tool</strong>
                  <p>Everything you need, right at the top.</p>
                </div>
              </div>
              <div className="guide-step">
                <span>2</span>
                <div>
                  <strong>Make your edits</strong>
                  <p>Click text on the page and start typing.</p>
                </div>
              </div>
              <div className="guide-step">
                <span>3</span>
                <div>
                  <strong>Apply & download</strong>
                  <p>Your updated PDF, ready to go.</p>
                </div>
              </div>
              <div className="tip-card">
                <span>
                  <MousePointer2 size={16} />A little tip
                </span>
                <p>
                  Text gets a blue outline when you select it. Use the floating
                  toolbar to make it just right.
                </p>
              </div>
              <div className="shortcuts">
                <span>Keyboard shortcuts</span>
                <div>
                  Undo<kbd>⌘ / Ctrl Z</kbd>
                </div>
                <div>
                  Finish editing<kbd>Esc</kbd>
                </div>
                <button onClick={() => setHelp(true)}>
                  View editor guide <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <strong>Your files. Your business.</strong>
            <p>PDF editing happens in your browser. No account needed.</p>
          </div>
        </aside>
      </main>
      {busy && (
        <div className="busy-overlay" role="status">
          <div>
            <LoaderCircle className="spin" size={24} />
            {busy}
          </div>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {uploadOpen && (
        <Modal title="Open a document" onClose={() => setUploadOpen(false)}>
          <div
            className="dropzone"
            role="button"
            tabIndex={0}
            onClick={() => fileInput.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ")
                fileInput.current?.click();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              requestFile(e.dataTransfer.files[0]);
            }}
          >
            <span className="upload-circle">
              <Upload size={28} />
            </span>
            <h3>Drop your file here</h3>
            <p>or click to browse your device</p>
            <span className="secondary">Choose file</span>
            <small>PDF, DOCX, PPTX, HTML, Markdown, TXT · Up to 25 MB</small>
          </div>
          <div className="upload-note">
            <ShieldCheck size={17} />
            <p>
              PDFs stay on your device. Other formats are sent to your
              configured conversion service and deleted after conversion.
            </p>
          </div>
        </Modal>
      )}
      {pendingFile && (
        <Modal
          title="Open another document?"
          onClose={() => setPendingFile(null)}
        >
          <p className="modal-copy">
            You have unapplied edits. Download your current PDF first if you
            want to keep them.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setPendingFile(null)}>
              Keep editing
            </button>
            <button
              className="primary"
              onClick={() => {
                const file = pendingFile;
                setPendingFile(null);
                void loadFile(file);
              }}
            >
              Discard & open
            </button>
          </div>
        </Modal>
      )}
      {signOpen && (
        <Modal title="Create your signature" onClose={() => setSignOpen(false)}>
          <label className="modal-label">
            Your name
            <input
              autoFocus
              value={signature}
              maxLength={80}
              placeholder="e.g. Alex Morgan"
              onChange={(e) => setSignature(e.target.value)}
            />
          </label>
          <div className="signature-preview">
            {signature || "Your signature"}
          </div>
          <p className="modal-copy">
            A visual signature, placed as text. This does not create a
            certificate-based digital signature.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setSignOpen(false)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!signature.trim()}
              onClick={() => {
                setSignOpen(false);
                setTool("sign");
                setNotice("Click the page to place your signature.");
              }}
            >
              Use signature
            </button>
          </div>
        </Modal>
      )}
      {linkEdit && (
        <Modal title="Add a link" onClose={() => setLinkEdit(null)}>
          <label className="modal-label">
            Destination URL
            <input
              autoFocus
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </label>
          <p className="modal-copy">
            The area you selected will be clickable in the downloaded PDF.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setLinkEdit(null)}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => {
                try {
                  const url = safeLink(linkUrl);
                  setDraft({ ...linkEdit, url });
                  setLinkEdit(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Add link
            </button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="Your editor, at a glance" onClose={() => setHelp(false)}>
          <div className="help-content">
            <a
              className="secondary source-link"
              href={`${import.meta.env.BASE_URL}paperwork-pdf-source.zip`}
              download
            >
              <Download size={16} />
              Download source code (MIT)
            </a>
            <p>
              <strong>Edit text.</strong> Choose Text, click a line, and type.
              Use the floating bar for font, size, weight, and color. Click Done
              to keep the edit in your workspace.
            </p>
            <p>
              <strong>Add to your PDF.</strong> Click empty space for new text,
              an image, or a typed signature. Drag to create highlights, shapes,
              links, whiteout areas, and fillable text fields. Select added
              objects with the Text tool.
            </p>
            <p>
              <strong>Save your work.</strong> Apply changes writes edits into
              the PDF and resets undo history. Download PDF applies pending
              edits and downloads your file.
            </p>
            <p>
              <strong>Privacy.</strong> PDFs and images are processed locally.
              Other formats use your self-hosted conversion service. Files are
              never saved between browser sessions.
            </p>
            <p>
              <strong>Know the limits.</strong> Whiteout covers text visually;
              covered text can still be extracted. It is not secure redaction.
              Standard fonts support Latin text; scanned pages need OCR in
              another tool. Complex fonts, vertical writing, and text drawn as
              paths cannot be reproduced exactly. Existing digital signatures
              may become invalid after editing.
            </p>
            <div className="shortcut-row">
              <span>Undo / Redo</span>
              <kbd>Ctrl Z / Ctrl Shift Z</kbd>
            </div>
            <div className="shortcut-row">
              <span>Finish text edit</span>
              <kbd>Esc / Ctrl Enter</kbd>
            </div>
            <div className="shortcut-row">
              <span>Select text & controls</span>
              <kbd>Tab / Enter</kbd>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
