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

  const { resolvedTheme, handleThemeToggle, playFontToggleSound, isMuted, toggleMute } = useTheme();
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

  const flushCurrentEntrySave = useCallback(async () => {
    if (!currentEntry) return;

    await flushSave({
      entryId: currentEntry.id,
      content: contentRef.current,
    });
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

  const handleQuickSwitcherSelect = async (entry: Entry) => {
    setShowQuickSwitcher(false);

    await flushCurrentEntrySave();

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

        if (showQuickSwitcher) {
          setShowQuickSwitcher(false);
          return;
        }

        void (async () => {
          await flushCurrentEntrySave();
          setShowQuickSwitcher(true);
        })();
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
  }, [applyZoom, flushCurrentEntrySave, showQuickSwitcher]);

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

    playFontToggleSound();
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
  }, [fontMode, isFontSwitching, playFontToggleSound]);

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

          <button
            type="button"
            className="font-toggle-button sound-toggle-button"
            onClick={toggleMute}
            data-tooltip={isMuted ? "Unmute sounds" : "Mute sounds"}
            data-tooltip-placement="left"
            aria-label={isMuted ? "Unmute sounds" : "Mute sounds"}
          >
            {isMuted ? (
              <svg
                className="sound-toggle-icon"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path d="M18,11.2928932 L20.1464466,9.14644661 C20.3417088,8.95118446 20.6582912,8.95118446 20.8535534,9.14644661 C21.0488155,9.34170876 21.0488155,9.65829124 20.8535534,9.85355339 L18.7071068,12 L20.8535534,14.1464466 C21.0488155,14.3417088 21.0488155,14.6582912 20.8535534,14.8535534 C20.6582912,15.0488155 20.3417088,15.0488155 20.1464466,14.8535534 L18,12.7071068 L15.8535534,14.8535534 C15.6582912,15.0488155 15.3417088,15.0488155 15.1464466,14.8535534 C14.9511845,14.6582912 14.9511845,14.3417088 15.1464466,14.1464466 L17.2928932,12 L15.1464466,9.85355339 C14.9511845,9.65829124 14.9511845,9.34170876 15.1464466,9.14644661 C15.3417088,8.95118446 15.6582912,8.95118446 15.8535534,9.14644661 L18,11.2928932 L18,11.2928932 Z M13,5.5 L13,18.5 C13,18.7761424 12.7761424,19 12.5,19 L10.5,19 C10.310614,19 10.1374824,18.8929988 10.0527864,18.7236068 L9.39442719,17.4068884 C8.65687709,15.9317882 7.14921216,15 5.5,15 L5,15 C3.34314575,15 2,13.6568542 2,12 C2,10.3431458 3.34314575,9 5,9 L5.5,9 C7.14921216,9 8.65687709,8.06821183 9.39442719,6.59311163 L10.0527864,5.2763932 C10.1374824,5.10700119 10.310614,5 10.5,5 L12.5,5 C12.7761424,5 13,5.22385763 13,5.5 Z M12,6 L10.809017,6 L10.2888544,7.04032522 C9.38191227,8.85420946 7.52798422,10 5.5,10 L5,10 C3.8954305,10 3,10.8954305 3,12 C3,13.1045695 3.8954305,14 5,14 L5.5,14 C7.52798422,14 9.38191227,15.1457905 10.2888544,16.9596748 L10.809017,18 L12,18 L12,6 Z" />
              </svg>
            ) : (
              <svg
                className="sound-toggle-icon"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path d="M13,5.5 L13,18.5 C13,18.7761424 12.7761424,19 12.5,19 L10.5,19 C10.310614,19 10.1374824,18.8929988 10.0527864,18.7236068 L9.39442719,17.4068884 C8.65687709,15.9317882 7.14921216,15 5.5,15 L5,15 C3.34314575,15 2,13.6568542 2,12 C2,10.3431458 3.34314575,9 5,9 L5.5,9 C7.14921216,9 8.65687709,8.06821183 9.39442719,6.59311163 L10.0527864,5.2763932 C10.1374824,5.10700119 10.310614,5 10.5,5 L12.5,5 C12.7761424,5 13,5.22385763 13,5.5 Z M12,6 L10.809017,6 L10.2888544,7.04032522 C9.38191227,8.85420946 7.52798422,10 5.5,10 L5,10 C3.8954305,10 3,10.8954305 3,12 C3,13.1045695 3.8954305,14 5,14 L5.5,14 C7.52798422,14 9.38191227,15.1457905 10.2888544,16.9596748 L10.809017,18 L12,18 L12,6 Z M14.1429857,9.8500583 C13.9496539,9.65288477 13.9527682,9.3363176 14.1499417,9.14298574 C14.3471152,8.94965387 14.6636824,8.95276816 14.8570143,9.1499417 C16.409204,10.7329748 16.409204,13.2670252 14.8570143,14.8500583 C14.6636824,15.0472318 14.3471152,15.0503461 14.1499417,14.8570143 C13.9527682,14.6636824 13.9496539,14.3471152 14.1429857,14.1499417 C15.3138802,12.9557806 15.3138802,11.0442194 14.1429857,9.8500583 Z M16.1652488,7.87140492 C15.9601275,7.68652692 15.9437171,7.37037004 16.1285951,7.16524877 C16.3134731,6.9601275 16.62963,6.94371708 16.8347512,7.12859508 C19.5251539,9.55348383 19.7403954,13.7002468 17.3155067,16.3906495 C17.1636751,16.5591059 17.0032077,16.7195733 16.8347512,16.8714049 C16.62963,17.0562829 16.3134731,17.0398725 16.1285951,16.8347512 C15.9437171,16.62963 15.9601275,16.3134731 16.1652488,16.1285951 C16.3080183,15.9999153 16.4440171,15.8639166 16.5726968,15.721147 C18.6278296,13.4409869 18.4454089,9.92653766 16.1652488,7.87140492 Z" />
              </svg>
            )}
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
          onSelect={(entry) => {
            void handleQuickSwitcherSelect(entry);
          }}
          onDelete={handleQuickSwitcherDelete}
          onClose={() => setShowQuickSwitcher(false)}
        />
      )}
    </div>
  );
}

export default App;
