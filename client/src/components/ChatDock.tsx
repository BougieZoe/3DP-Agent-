/**
 * ChatDock — collapsible chat launcher with three attachment entry points
 * (file picker / drag & drop / paste) and a detachable snap window.
 *
 * Self-contained: renders a floating dock in the corner of the viewport so it
 * does not disturb the existing tab layout. Attachments are broadcast via a
 * `chat:attach` CustomEvent so ChatPanel (or any listener) can consume them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getTranslation, type Language, type TranslationKey } from "@/lib/i18n";

interface ChatDockProps {
  language: Language;
  /** Start collapsed (default true) — the dock is an overlay, not a tab. */
  initiallyCollapsed?: boolean;
}

declare global {
  interface Window {
    desktopChatFloat?: {
      open: (origin?: string) => Promise<boolean>;
      close: () => Promise<boolean>;
      isOpen: () => Promise<boolean>;
    };
  }
}

const tr = (language: Language, key: TranslationKey, fallback: string): string => {
  try {
    const value = getTranslation(language, key);
    return value || fallback;
  } catch {
    return fallback;
  }
};

export function ChatDock({ language, initiallyCollapsed = true }: ChatDockProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [floatOpen, setFloatOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const emitAttach = useCallback((incoming: File[]) => {
    if (!incoming.length) return;
    setFiles((prev) => [...prev, ...incoming]);
    window.dispatchEvent(new CustomEvent("chat:attach", { detail: { files: incoming } }));
  }, []);

  // Paste entry: capture files from the clipboard anywhere in the document.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.files;
      if (!items || items.length === 0) return;
      emitAttach(Array.from(items));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [emitAttach]);

  // Drop entry: only active while the dock is expanded.
  useEffect(() => {
    const node = dropRef.current;
    if (!node || collapsed) return;
    const prevent = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onEnter = (event: DragEvent) => {
      prevent(event);
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      prevent(event);
      setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      prevent(event);
      setDragging(false);
      const dropped = event.dataTransfer?.files;
      if (dropped?.length) emitAttach(Array.from(dropped));
    };
    node.addEventListener("dragenter", onEnter);
    node.addEventListener("dragover", prevent);
    node.addEventListener("dragleave", onLeave);
    node.addEventListener("drop", onDrop);
    return () => {
      node.removeEventListener("dragenter", onEnter);
      node.removeEventListener("dragover", prevent);
      node.removeEventListener("dragleave", onLeave);
      node.removeEventListener("drop", onDrop);
    };
  }, [collapsed, emitAttach]);

  const openDetached = useCallback(async () => {
    const bridge = window.desktopChatFloat;
    if (bridge) {
      await bridge.open(window.location.origin);
      setFloatOpen(true);
      return;
    }
    window.open(`${window.location.origin}/?chatFloat=1`, "chat-float", "width=440,height=640");
    setFloatOpen(true);
  }, []);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title={tr(language, "chatAI" as TranslationKey, "Chat")}
        className="fixed bottom-4 right-4 z-40 rounded-full bg-neutral-900/90 px-4 py-3 text-xs font-semibold text-white shadow-lg ring-1 ring-white/10 backdrop-blur transition hover:bg-neutral-800"
      >
        {tr(language, "chatAI" as TranslationKey, "Chat").toUpperCase()}
        {files.length > 0 && (
          <span className="ml-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] text-black">
            {files.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 rounded-xl border border-white/10 bg-neutral-950/95 p-3 text-xs text-neutral-200 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold tracking-wide">
          {tr(language, "chatAI" as TranslationKey, "Chat").toUpperCase()}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void openDetached()}
            title="Detach"
            className={`rounded px-2 py-1 ${floatOpen ? "bg-emerald-600 text-black" : "bg-white/10 hover:bg-white/20"}`}
          >
            Float
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="Collapse"
            className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
          >
            —
          </button>
        </div>
      </div>

      <div
        ref={dropRef}
        className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-center transition ${
          dragging ? "border-emerald-400 bg-emerald-500/10" : "border-white/15 bg-white/[0.03]"
        }`}
      >
        <span className="text-[11px] leading-relaxed text-neutral-400">
          {tr(language, "uploadStlBegin" as TranslationKey, "Drop files")}
        </span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
          >
            Choose
          </button>
          <span className="text-[11px] text-neutral-500">drag &amp; drop · paste</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files;
            if (picked?.length) emitAttach(Array.from(picked));
            event.currentTarget.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-2 max-h-28 space-y-1 overflow-auto">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded bg-white/5 px-2 py-1">
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                className="text-neutral-500 hover:text-red-400"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ChatDock;
