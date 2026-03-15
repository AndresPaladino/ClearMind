import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { type LexicalEditor } from "lexical";
import { Entry, EntrySummary } from "./types";
import Editor from "./components/Editor";
const QuickSwitcher = lazy(() => import("./components/QuickSwitcher"));
import DateNavigator from "./components/DateNavigator";
import SealedEntryCard from "./components/SealedEntryCard";
import { showContextMenu } from "./components/ContextMenu";
import EntryIndicator from "./components/EntryIndicator";
import { createPortal } from "react-dom";
import { useTheme } from "./hooks/useTheme";
import { useCursorHide } from "./hooks/useCursorHide";
import { useAutoSave } from "./hooks/useAutoSave";
import { useDeleteChord } from "./hooks/useDeleteChord";
import { useEntryStore } from "./hooks/useEntryStore";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { logError } from "./utils/logError";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { colorizeReadonlyTags } from "./utils/colorizeReadonlyTags";
import { extractTags } from "./utils/extractTags";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.1;
type FontMode = "sans" | "serif";

interface RailDay {
  key: string;
  label: string;
  firstEntryId: string;
  count: number;
  tags: string[];
}

function App() {
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null);
  const [isFontSwitching, setIsFontSwitching] = useState(false);
  const [fontMode, setFontMode] = useState<FontMode>(() => {
    const stored = localStorage.getItem("clearmind-font-family");
    return stored === "serif" ? "serif" : "sans";
  });

  const { resolvedTheme, handleThemeToggle } = useTheme();
  const { isTyping, setIsTyping } = useCursorHide();
  const { contentRef, scheduleSave, flushSave, cancelSave, saveStatus } = useAutoSave();
  const {
    currentEntry,
    allEntries,
    allEntrySummaries,
    isLoadingEntry,
    loadError,
    reloadCurrentSession,
    flushCurrentEntrySave,
    selectOpenEntry,
    sealCurrentEntry,
    unsealStoredEntry,
    deleteStoredEntry,
  } = useEntryStore({ contentRef, flushSave, cancelSave });
  const existingEntryIds = useMemo(() => allEntries.map((entry) => entry.id), [allEntries]);
  const { isDeleteChordPressed, pendingDeleteEntryId, clearDeleteArm, armDeleteEntry } =
    useDeleteChord({ existingEntryIds });

  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const scrollSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontSwitchApplyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fontSwitchEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialScrollRestoredRef = useRef(false);
  const zoomRef = useRef(1);
  const scrollSyncFrameRef = useRef<number | null>(null);

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

  const handleSeal = useCallback(() => {
    void sealCurrentEntry();
  }, [sealCurrentEntry]);

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
      selectOpenEntry(entry);
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
      await deleteStoredEntry(entry);
    } catch (err) {
      logError("App", "delete_entry", err, { entryId: entry.id });
    }
  };

  const handleSealedEntryDeleteGesture = useCallback((entry: Entry) => {
    if (pendingDeleteEntryId === entry.id) {
      clearDeleteArm();
      void handleQuickSwitcherDelete(entry);
      return;
    }

    armDeleteEntry(entry.id);
  }, [armDeleteEntry, clearDeleteArm, handleQuickSwitcherDelete, pendingDeleteEntryId]);

  const handleSealedEntryDoubleClick = useCallback(
    async (entry: Entry) => {
      await unsealStoredEntry(entry);
    },
    [unsealStoredEntry]
  );

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".editor-textarea") || target.closest(".entry-sealed")) return;

    const editor = document.querySelector(".editor-textarea") as HTMLDivElement;
    if (editor) editor.focus();
  }, []);

  const openQuickSwitcher = useCallback(async () => {
    await flushCurrentEntrySave();
    setShowQuickSwitcher(true);
  }, [flushCurrentEntrySave]);

  const closeQuickSwitcher = useCallback(() => {
    setShowQuickSwitcher(false);
  }, []);

  const zoomIn = useCallback(() => {
    void applyZoom(zoomRef.current + ZOOM_STEP);
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    void applyZoom(zoomRef.current - ZOOM_STEP);
  }, [applyZoom]);

  const zoomReset = useCallback(() => {
    void applyZoom(1);
  }, [applyZoom]);

  useGlobalShortcuts({
    isQuickSwitcherOpen: showQuickSwitcher,
    openQuickSwitcher,
    closeQuickSwitcher,
    zoomIn,
    zoomOut,
    zoomReset,
  });

  const sealedEntries = allEntries.filter(
    (e) => e.sealed && e.id !== currentEntry?.id
  );

  const summariesForNavigator = useMemo<EntrySummary[]>(() => {
    if (!currentEntry || currentEntry.sealed) {
      return allEntrySummaries;
    }

    const currentTags = extractTags(contentRef.current);
    return allEntrySummaries.map((summary) => {
      if (summary.id !== currentEntry.id) return summary;
      return {
        ...summary,
        tags: currentTags,
      };
    });
  }, [allEntrySummaries, contentRef, currentEntry]);

  const railDays = useMemo<RailDay[]>(() => {
    const dayMap = new Map<string, RailDay>();

    for (const summary of summariesForNavigator) {
      const dayKey = summary.id.split("_")[0];
      const existing = dayMap.get(dayKey);
      if (!existing) {
        dayMap.set(dayKey, {
          key: dayKey,
          label: summary.date,
          firstEntryId: summary.id,
          count: 1,
          tags: summary.tags,
        });
      } else {
        existing.count += 1;
        const mergedTags = new Set([...existing.tags, ...summary.tags]);
        existing.tags = Array.from(mergedTags);
      }
    }

    return Array.from(dayMap.values());
  }, [summariesForNavigator]);

  const firstRenderedEntryByDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of railDays) {
      map.set(day.key, day.firstEntryId);
    }
    return map;
  }, [railDays]);

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

      if (scrollSyncFrameRef.current !== null) {
        cancelAnimationFrame(scrollSyncFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (railDays.length === 0) {
      setActiveDayKey(null);
      return;
    }

    const container = document.querySelector(".scroll-container");
    if (!container) return;

    const syncActiveDay = () => {
      const anchors = Array.from(
        container.querySelectorAll<HTMLElement>("[data-day-anchor='true']")
      );
      if (anchors.length === 0) {
        const firstDay = railDays[0]?.key ?? null;
        setActiveDayKey((prev) => (prev === firstDay ? prev : firstDay));
        return;
      }

      const containerRect = container.getBoundingClientRect();
      let nextActive = anchors[0].dataset.dayKey ?? railDays[0]?.key ?? null;

      for (const anchor of anchors) {
        const anchorTop = anchor.getBoundingClientRect().top - containerRect.top;
        if (anchorTop <= 112) {
          nextActive = anchor.dataset.dayKey ?? nextActive;
        } else {
          break;
        }
      }

      setActiveDayKey((prev) => (prev === nextActive ? prev : nextActive));
    };

    const handleScroll = () => {
      if (scrollSyncFrameRef.current !== null) return;

      scrollSyncFrameRef.current = requestAnimationFrame(() => {
        syncActiveDay();
        scrollSyncFrameRef.current = null;
      });
    };

    syncActiveDay();
    container.addEventListener("scroll", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollSyncFrameRef.current !== null) {
        cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = null;
      }
    };
  }, [railDays]);

  const handleRailDaySelect = useCallback((dayKey: string) => {
    const target = document.getElementById(`day-${dayKey}`);
    if (!target) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
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
            void reloadCurrentSession();
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
              <SealedEntryCard
                key={entry.id}
                entry={entry}
                hasDayAnchor={firstRenderedEntryByDay.get(entry.id.split("_")[0]) === entry.id}
                isDeleteChordPressed={isDeleteChordPressed}
                isDeleteArmed={pendingDeleteEntryId === entry.id}
                onRequestDelete={handleSealedEntryDeleteGesture}
                onRequestUnseal={(entryToOpen) => {
                  void handleSealedEntryDoubleClick(entryToOpen);
                }}
                markdownComponents={markdownComponents}
              />
            ))}

            {firstRenderedEntryByDay.get(currentEntry.id.split("_")[0]) === currentEntry.id && (
              <div
                id={`day-${currentEntry.id.split("_")[0]}`}
                className="day-anchor"
                data-day-anchor="true"
                data-day-key={currentEntry.id.split("_")[0]}
                aria-hidden="true"
              />
            )}

            <div id={`entry-${currentEntry.id}`}>
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
      </div>

      <DateNavigator
        days={railDays}
        activeDayKey={activeDayKey}
        onSelectDay={handleRailDaySelect}
        theme={resolvedTheme}
      />

      {createPortal(
        <div style={{ position: "fixed", bottom: 20, right: 24, zIndex: 1200, display: "flex", alignItems: "center", gap: 8 }}>
          <EntryIndicator
            date={currentEntry.date}
            number={currentEntry.number}
            isTyping={isTyping}
            saveStatus={saveStatus}
          />
        </div>,
        document.body
      )}

      {showQuickSwitcher && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </div>
  );
}

export default App;
