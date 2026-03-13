import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type LexicalEditor } from "lexical";
import ReactMarkdown from "react-markdown";
import { Entry } from "./types";
import Editor from "./components/Editor";
import CommandPalette from "./components/CommandPalette";
import { showContextMenu } from "./components/ContextMenu";
import EntryIndicator from "./components/EntryIndicator";
import { createPortal } from "react-dom";
import { useTheme } from "./hooks/useTheme";
import { useCursorHide } from "./hooks/useCursorHide";
import { useAutoSave } from "./hooks/useAutoSave";
import { logError } from "./utils/logError";
import { getCurrentWebview } from "@tauri-apps/api/webview";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.1;

function App() {
  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [showPalette, setShowPalette] = useState(false);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  const { resolvedTheme, handleThemeToggle } = useTheme();
  const { isTyping, setIsTyping } = useCursorHide();
  const { contentRef, scheduleSave, flushSave, cancelSave } = useAutoSave();

  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const scrollSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollRestoredRef = useRef(false);
  const zoomRef = useRef(1);

  const applyZoom = useCallback(async (nextZoom: number) => {
    const boundedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    zoomRef.current = boundedZoom;

    try {
      await getCurrentWebview().setZoom(boundedZoom);
    } catch (err) {
      logError("App", "set_zoom", err, { zoom: boundedZoom });
    }
  }, []);

  useEffect(() => {
    loadCurrentEntry();
  }, []);

  const loadCurrentEntry = async () => {
    try {
      const entry = await invoke<Entry>("get_current_entry");
      setCurrentEntry(entry);
      contentRef.current = entry.content;
      loadAllEntries();
    } catch (err) {
      logError("App", "load_current_entry", err);
    }
  };

  const loadAllEntries = async () => {
    try {
      const entries = await invoke<Entry[]>("get_all_entries");
      setAllEntries(entries);
    } catch (err) {
      logError("App", "load_all_entries", err);
    }
  };

  // Restore scroll position before paint so there's no visible jump
  useLayoutEffect(() => {
    if (initialScrollRestoredRef.current || allEntries.length === 0) return;
    initialScrollRestoredRef.current = true;

    const container = document.querySelector(".scroll-container");
    const stored = localStorage.getItem("clearmind-scroll");
    if (container && stored) {
      container.scrollTop = parseInt(stored, 10);
    }
  }, [allEntries]);

  // Save scroll position on scroll (debounced)
  // Depends on currentEntry so it runs after .scroll-container is in the DOM.
  // Skips saves until initial scroll restore is done to avoid overwriting with wrong values.
  useEffect(() => {
    const container = document.querySelector(".scroll-container");
    if (!container) return;

    const saveScroll = () => {
      localStorage.setItem("clearmind-scroll", String(container.scrollTop));
    };

    const handleScroll = () => {
      if (!initialScrollRestoredRef.current) return;
      if (scrollSaveRef.current) clearTimeout(scrollSaveRef.current);
      scrollSaveRef.current = setTimeout(saveScroll, 300);
    };

    // Flush on close so the last position is always persisted
    const handleBeforeUnload = () => saveScroll();

    container.addEventListener("scroll", handleScroll);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (scrollSaveRef.current) clearTimeout(scrollSaveRef.current);
    };
  }, [currentEntry]);

  const handleContentChange = useCallback(
    (content: string) => {
      contentRef.current = content;

      if (!currentEntry) return;

      scheduleSave(currentEntry.id, contentRef.current);
    },
    [currentEntry, scheduleSave]
  );

  const handleSeal = useCallback(async () => {
    if (!currentEntry) return;

    try {
      await flushSave({
        entryId: currentEntry.id,
        content: contentRef.current,
      });

      const newEntry = await invoke<Entry>("seal_entry", {
        id: currentEntry.id,
        content: contentRef.current,
      });

      setCurrentEntry(newEntry);
      contentRef.current = newEntry.content;
      loadAllEntries();
    } catch (err) {
      logError("App", "seal_entry", err, { entryId: currentEntry.id });
    }
  }, [currentEntry, contentRef, flushSave]);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (lexicalEditorRef.current) {
        showContextMenu(e.clientX, e.clientY, lexicalEditorRef.current);
      }
    };

    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  const handlePaletteSelect = (entry: Entry) => {
    setShowPalette(false);

    if (!entry.sealed) {
      setCurrentEntry(entry);
      contentRef.current = entry.content;
    } else {
      setPendingScrollId(entry.id);
    }
  };

  useEffect(() => {
    if (!pendingScrollId) return;

    const el = document.getElementById(`entry-${pendingScrollId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingScrollId(null);
    }
  }, [pendingScrollId, allEntries]);

  const handlePaletteDelete = async (entry: Entry) => {
    try {
      if (currentEntry?.id === entry.id) {
        cancelSave();
      }
      await invoke("delete_entry", { id: entry.id });
      await loadCurrentEntry();
    } catch (err) {
      logError("App", "delete_entry", err, { entryId: entry.id });
    }
  };

  const handleSealedEntryDoubleClick = useCallback(
    async (entry: Entry) => {
      try {
        if (currentEntry?.id) {
          await flushSave({
            entryId: currentEntry.id,
            content: contentRef.current,
          });
        }

        await invoke("unseal_entry", { id: entry.id });
        const entries = await invoke<Entry[]>("get_all_entries");

        setAllEntries(entries);
        const reopened = entries.find((item) => item.id === entry.id);
        if (reopened) {
          setCurrentEntry(reopened);
          contentRef.current = reopened.content;
        }
      } catch (err) {
        logError("App", "unseal_entry", err, { entryId: entry.id });
      }
    },
    [currentEntry, flushSave, contentRef]
  );

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".editor-textarea") || target.closest(".entry-sealed")) return;

    const editor = document.querySelector(".editor-textarea") as HTMLDivElement;
    if (editor) editor.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((prev) => !prev);
        return;
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        void applyZoom(zoomRef.current + ZOOM_STEP);
        return;
      }

      if (e.key === "-") {
        e.preventDefault();
        void applyZoom(zoomRef.current - ZOOM_STEP);
        return;
      }

      if (e.key === "0") {
        e.preventDefault();
        void applyZoom(1);
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();

      const direction = e.deltaY < 0 ? 1 : -1;
      void applyZoom(zoomRef.current + direction * ZOOM_STEP);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("wheel", handleWheel, true);
    };
  }, [applyZoom]);

  if (!currentEntry) return null;

  const sealedEntries = allEntries.filter(
    (e) => e.sealed && e.id !== currentEntry.id
  );

  return (
    <div className="app-container">
      {createPortal(
        <div
          className={`theme-toggle-pill${resolvedTheme === "dark" ? " dark" : ""}`}
          title={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          onClick={handleThemeToggle}
        >
          <div className="theme-pill-track">
            <div className="theme-pill-ball" />
          </div>
        </div>,
        document.body
      )}

      <div className="scroll-container" onClick={handleContainerClick}>
        <div className="content-root">
          <div className="column">
            {sealedEntries.map((entry) => (
                <div
                  key={entry.id}
                  id={`entry-${entry.id}`}
                  className="entry-sealed"
                  title="Double-click to edit"
                  onDoubleClick={() => void handleSealedEntryDoubleClick(entry)}
                >
                  <div className="entry-date-inline">
                    <span>{entry.date} #{entry.number}</span>
                  </div>

                  <div className="entry-content-readonly">
                    <ReactMarkdown>{entry.content}</ReactMarkdown>
                  </div>
                </div>
            ))}

            <Editor
              entry={currentEntry}
              onContentChange={handleContentChange}
              onSeal={handleSeal}
              onTypingStart={() => setIsTyping(true)}
              onTypingStop={() => setIsTyping(false)}
              onEditorReady={(e) => {
                lexicalEditorRef.current = e;
              }}
            />
          </div>
        </div>
      </div>

      {createPortal(
        <div style={{ position: "fixed", bottom: 20, right: 24, zIndex: 1200, display: "flex", alignItems: "center", gap: 8 }}>
          <EntryIndicator
            date={currentEntry.date}
            number={currentEntry.number}
            isTyping={isTyping}
          />
        </div>,
        document.body
      )}

      {showPalette && (
        <CommandPalette
          entries={allEntries}
          onSelect={handlePaletteSelect}
          onDelete={handlePaletteDelete}
          onClose={() => setShowPalette(false)}
        />
      )}
    </div>
  );
}

export default App;
