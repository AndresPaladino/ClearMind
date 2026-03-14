import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type LexicalEditor } from "lexical";
import ReactMarkdown from "react-markdown";
import { Entry } from "./types";
import Editor from "./components/Editor";
import QuickSwitcher from "./components/QuickSwitcher";
import { showContextMenu } from "./components/ContextMenu";
import EntryIndicator from "./components/EntryIndicator";
import { createPortal } from "react-dom";
import { useTheme } from "./hooks/useTheme";
import { useCursorHide } from "./hooks/useCursorHide";
import { useAutoSave } from "./hooks/useAutoSave";
import { logError } from "./utils/logError";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { colorizeReadonlyTags } from "./utils/colorizeReadonlyTags";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.1;
type FontMode = "sans" | "serif";

function App() {
  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [isLoadingEntry, setIsLoadingEntry] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [isDeleteChordPressed, setIsDeleteChordPressed] = useState(false);
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string | null>(null);
  const [isFontSwitching, setIsFontSwitching] = useState(false);
  const [fontMode, setFontMode] = useState<FontMode>(() => {
    const stored = localStorage.getItem("clearmind-font-family");
    return stored === "serif" ? "serif" : "sans";
  });

  const { resolvedTheme, handleThemeToggle } = useTheme();
  const { isTyping, setIsTyping } = useCursorHide();
  const { contentRef, scheduleSave, flushSave, cancelSave } = useAutoSave();

  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const scrollSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontSwitchApplyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontSwitchEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollRestoredRef = useRef(false);
  const zoomRef = useRef(1);

  useEffect(() => {
    document.documentElement.classList.toggle("font-serif", fontMode === "serif");
    document.documentElement.classList.toggle("font-sans", fontMode === "sans");
    localStorage.setItem("clearmind-font-family", fontMode);
  }, [fontMode]);

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
      setLoadError(null);
      const entry = await invoke<Entry>("get_current_entry");
      setCurrentEntry(entry);
      contentRef.current = entry.content;
      loadAllEntries();
    } catch (err) {
      logError("App", "load_current_entry", err);
      setLoadError("Could not load your current entry. Try again.");
    } finally {
      setIsLoadingEntry(false);
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

  const handleQuickSwitcherSelect = (entry: Entry) => {
    setShowQuickSwitcher(false);

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

  const handleQuickSwitcherDelete = async (entry: Entry) => {
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

  const clearDeleteArm = useCallback(() => {
    if (deleteArmTimeoutRef.current) {
      clearTimeout(deleteArmTimeoutRef.current);
      deleteArmTimeoutRef.current = null;
    }
    setPendingDeleteEntryId(null);
  }, []);

  const armDeleteEntry = useCallback((entryId: string) => {
    if (deleteArmTimeoutRef.current) {
      clearTimeout(deleteArmTimeoutRef.current);
    }

    setPendingDeleteEntryId(entryId);
    deleteArmTimeoutRef.current = setTimeout(() => {
      setPendingDeleteEntryId(null);
      deleteArmTimeoutRef.current = null;
    }, 1600);
  }, []);

  const handleSealedEntryClick = (e: React.MouseEvent, entry: Entry) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    e.preventDefault();
    e.stopPropagation();

    if (pendingDeleteEntryId === entry.id) {
      clearDeleteArm();
      void handleQuickSwitcherDelete(entry);
      return;
    }

    armDeleteEntry(entry.id);
  };

  useEffect(() => {
    const updateDeleteChordState = (e: KeyboardEvent) => {
      setIsDeleteChordPressed(e.metaKey || e.ctrlKey);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      setIsDeleteChordPressed(e.metaKey || e.ctrlKey);
    };

    const handleWindowBlur = () => {
      setIsDeleteChordPressed(false);
    };

    window.addEventListener("keydown", updateDeleteChordState, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", updateDeleteChordState, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!pendingDeleteEntryId) return;
    if (allEntries.some((entry) => entry.id === pendingDeleteEntryId)) return;
    clearDeleteArm();
  }, [allEntries, pendingDeleteEntryId, clearDeleteArm]);

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        clearTimeout(deleteArmTimeoutRef.current);
      }
    };
  }, []);

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
        setShowQuickSwitcher((prev) => !prev);
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

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [applyZoom]);

  const sealedEntries = allEntries.filter(
    (e) => e.sealed && e.id !== currentEntry?.id
  );

  const handleFontToggle = useCallback(() => {
    if (isFontSwitching) return;

    if (fontSwitchApplyTimeoutRef.current) {
      clearTimeout(fontSwitchApplyTimeoutRef.current);
      fontSwitchApplyTimeoutRef.current = null;
    }

    if (fontSwitchEndTimeoutRef.current) {
      clearTimeout(fontSwitchEndTimeoutRef.current);
      fontSwitchEndTimeoutRef.current = null;
    }

    const nextFontMode: FontMode = fontMode === "sans" ? "serif" : "sans";

    setIsFontSwitching(true);
    // Apply the actual font swap after the whiteout is already visible.
    fontSwitchApplyTimeoutRef.current = setTimeout(() => {
      setFontMode(nextFontMode);
      fontSwitchApplyTimeoutRef.current = null;
    }, 320);

    fontSwitchEndTimeoutRef.current = setTimeout(() => {
      setIsFontSwitching(false);
      fontSwitchEndTimeoutRef.current = null;
    }, 1450);
  }, [fontMode, isFontSwitching]);

  useEffect(() => {
    return () => {
      if (fontSwitchApplyTimeoutRef.current) {
        clearTimeout(fontSwitchApplyTimeoutRef.current);
      }

      if (fontSwitchEndTimeoutRef.current) {
        clearTimeout(fontSwitchEndTimeoutRef.current);
      }
    };
  }, []);

  const markdownComponents = useMemo(
    () => ({
      p: ({ children, ...props }: any) => (
        <p {...props}>{colorizeReadonlyTags(children, resolvedTheme, "p")}</p>
      ),
      li: ({ children, ...props }: any) => (
        <li {...props}>{colorizeReadonlyTags(children, resolvedTheme, "li")}</li>
      ),
      blockquote: ({ children, ...props }: any) => (
        <blockquote {...props}>{colorizeReadonlyTags(children, resolvedTheme, "blockquote")}</blockquote>
      ),
      h1: ({ children, ...props }: any) => (
        <h1 {...props}>{colorizeReadonlyTags(children, resolvedTheme, "h1")}</h1>
      ),
      h2: ({ children, ...props }: any) => (
        <h2 {...props}>{colorizeReadonlyTags(children, resolvedTheme, "h2")}</h2>
      ),
      h3: ({ children, ...props }: any) => (
        <h3 {...props}>{colorizeReadonlyTags(children, resolvedTheme, "h3")}</h3>
      ),
    }),
    [resolvedTheme]
  );

  if (isLoadingEntry) {
    return (
      <div className="app-loading-state" role="status" aria-live="polite">
        Loading your writing session...
      </div>
    );
  }

  if (!currentEntry) {
    return (
      <div className="app-loading-state" role="alert" aria-live="assertive">
        <p>{loadError ?? "Could not open the current session."}</p>
        <button
          type="button"
          className="app-retry-button"
          onClick={() => {
            setIsLoadingEntry(true);
            void loadCurrentEntry();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`app-container${isFontSwitching ? " font-switching" : ""}`}>
      {isFontSwitching && <div className="font-switch-screen-overlay" aria-hidden="true" />}

      {createPortal(
        <>
          <div
            className={`theme-toggle-pill${resolvedTheme === "dark" ? " dark" : ""}`}
            data-tooltip={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            data-tooltip-placement="left"
            onClick={handleThemeToggle}
          >
            <div className="theme-pill-track">
              <div className="theme-pill-ball" />
            </div>
          </div>

          <button
            type="button"
            className={`font-toggle-button${fontMode === "serif" ? " serif" : " sans"}`}
            onClick={handleFontToggle}
            data-tooltip={fontMode === "sans" ? "Sans-serif" : "Serif"}
            data-tooltip-placement="left"
            aria-label={
              fontMode === "sans"
                ? "Switch to Source Serif 4"
                : "Switch to Inter"
            }
          >
            <span className="font-toggle-letter" aria-hidden="true">
              a
            </span>
          </button>
        </>
      ,
        document.body
      )}

      <div className="scroll-container" onClick={handleContainerClick}>
        <div className="content-root">
          <div className="column">
            {sealedEntries.map((entry) => (
                <div
                  key={entry.id}
                  id={`entry-${entry.id}`}
                  className={`entry-sealed${isDeleteChordPressed ? " delete-mode" : ""}${
                    pendingDeleteEntryId === entry.id ? " delete-armed" : ""
                  }`}
                  onClick={(e) => handleSealedEntryClick(e, entry)}
                  onDoubleClick={() => void handleSealedEntryDoubleClick(entry)}
                >
                  <div className="entry-date-inline">
                    <span className="entry-gesture-anchor">
                      {entry.date} #{entry.number}
                      <span className="entry-gesture-tooltip" role="tooltip">
                        Double-click to edit. Hold ⌘ and click to arm delete
                      </span>
                    </span>
                    <span
                      className={`entry-delete-hint${
                        isDeleteChordPressed || pendingDeleteEntryId === entry.id
                          ? " visible"
                          : ""
                      }`}
                    >
                      {pendingDeleteEntryId === entry.id
                        ? "Click again to delete"
                        : "⌘ Click to delete"}
                    </span>
                  </div>

                  <div className="entry-content-readonly">
                    <ReactMarkdown components={markdownComponents}>{entry.content}</ReactMarkdown>
                  </div>
                </div>
            ))}

            <Editor
              entry={currentEntry}
              theme={resolvedTheme}
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

      {showQuickSwitcher && (
        <QuickSwitcher
          entries={allEntries}
          theme={resolvedTheme}
          currentEntryId={currentEntry.id}
          onSelect={handleQuickSwitcherSelect}
          onDelete={handleQuickSwitcherDelete}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}
    </div>
  );
}

export default App;
