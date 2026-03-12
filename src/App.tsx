import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type LexicalEditor } from "lexical";
import ReactMarkdown from "react-markdown";
import { Entry } from "./types";
import Editor from "./components/Editor";
import CommandPalette from "./components/CommandPalette";
import { showContextMenu } from "./components/ContextMenu";
import EntryIndicator from "./components/EntryIndicator";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useTheme } from "./hooks/useTheme";
import { useFontScale, FONT_SCALE_STEP, DEFAULT_FONT_SCALE } from "./hooks/useFontScale";
import { useCursorHide } from "./hooks/useCursorHide";
import { useAutoSave } from "./hooks/useAutoSave";


function App() {
  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [showPalette, setShowPalette] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem("clearmind-onboarded");
  });
  const [reopenClicks, setReopenClicks] = useState<{ entryId: string; count: number; mouseX?: number; mouseY?: number; lastTime: number } | null>(null);

  const { theme, handleThemeToggle } = useTheme();
  const { fontScale, updateFontScale } = useFontScale();
  const { isTyping, setIsTyping } = useCursorHide();
  const { saveTimeoutRef, contentRef, scheduleSave } = useAutoSave(currentEntry);

  const lexicalEditorRef = useRef<LexicalEditor | null>(null);
  const idleHintRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);

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
      console.error("Failed to load current entry:", err);
    }
  };

  const loadAllEntries = async () => {
    try {
      const entries = await invoke<Entry[]>("get_all_entries");
      setAllEntries(entries);
    } catch (err) {
      console.error("Failed to load entries:", err);
    }
  };

  useEffect(() => {
    if (idleHintRef.current) clearTimeout(idleHintRef.current);
    if (!currentEntry || currentEntry.content.trim().length > 0 || showOnboarding) return;

    idleHintRef.current = setTimeout(() => {
      if (!contentRef.current.trim()) {
        setShowOnboarding(true);
      }
    }, 3000);

    return () => {
      if (idleHintRef.current) clearTimeout(idleHintRef.current);
    };
  }, [currentEntry, showOnboarding]);

  const handleContentChange = useCallback(
    (content: string) => {
      contentRef.current = content;

      if (showOnboarding) {
        setShowOnboarding(false);
      }

      if (!localStorage.getItem("clearmind-onboarded") && content.trim()) {
        localStorage.setItem("clearmind-onboarded", "1");
      }

      if (!currentEntry) return;

      scheduleSave(currentEntry.id, contentRef.current);
    },
    [currentEntry, showOnboarding, scheduleSave]
  );

  const handleSeal = useCallback(async () => {
    if (!currentEntry) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    try {
      await invoke("save_entry", {
        id: currentEntry.id,
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
      console.error("Failed to seal entry:", err);
    }
  }, [currentEntry, saveTimeoutRef, contentRef]);

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
      setTimeout(() => {
        const el = document.getElementById(`entry-${entry.id}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 50);
    }
  };

  const handlePaletteDelete = async (entry: Entry) => {
    try {
      await invoke("delete_entry", { id: entry.id });
      await loadCurrentEntry();
    } catch (err) {
      console.error("Failed to delete entry:", err);
    }
  };

  const handleSealedEntryClick = useCallback(
    (entry: Entry, e?: React.MouseEvent) => {
      setReopenClicks((prev) => {
        const isSame = prev && prev.entryId === entry.id;
        const now = Date.now();
        const lastTime = prev?.lastTime || 0;
        // Reset if more than 2 seconds between clicks
        if (!isSame || (now - lastTime > 2000)) {
          // First click or timeout
          return {
            entryId: entry.id,
            count: 1,
            mouseX: e ? e.clientX : prev?.mouseX,
            mouseY: e ? e.clientY : prev?.mouseY,
            lastTime: now
          };
        }
        const nextCount = prev.count + 1;
        const mouseX = e ? e.clientX : prev?.mouseX;
        const mouseY = e ? e.clientY : prev?.mouseY;
        if (nextCount >= 3) {
          (async () => {
            try {
              if (currentEntry && contentRef.current) {
                await invoke("save_entry", {
                  id: currentEntry.id,
                  content: contentRef.current,
                });
              }
              await invoke("unseal_entry", { id: entry.id });
              const entries = await invoke<Entry[]>("get_all_entries");
              setAllEntries(entries);
              const reopened = entries.find((e) => e.id === entry.id);
              if (reopened) {
                setCurrentEntry(reopened);
                contentRef.current = reopened.content;
              }
            } catch (err) {
              console.error("Failed to unseal entry:", err);
            }
          })();
          return null;
        }
        return {
          entryId: entry.id,
          count: nextCount,
          mouseX,
          mouseY,
          lastTime: now
        };
      });
    },
    [currentEntry, contentRef]
  );

  // Tooltip follows the mouse while open; resets after 2 seconds of inactivity
  useEffect(() => {
    if (!reopenClicks || reopenClicks.count < 1) return;
    const handleMouseMove = (e: MouseEvent) => {
      setReopenClicks((prev) => prev ? { ...prev, mouseX: e.clientX, mouseY: e.clientY } : prev);
    };
    window.addEventListener("mousemove", handleMouseMove);
    // Reset after 2 seconds of inactivity
    const timer = setInterval(() => {
      if (reopenClicks && reopenClicks.lastTime && Date.now() - reopenClicks.lastTime > 2000) {
        setReopenClicks(null);
      }
    }, 200);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      clearInterval(timer);
    };
  }, [reopenClicks]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".editor-textarea") || target.closest(".entry-sealed")) return;

    const editor = document.querySelector(".editor-textarea") as HTMLDivElement;
    if (editor) editor.focus();
  }, []);

  useEffect(() => {
    const scrollCursorAfterReflow = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const node = sel.getRangeAt(0).startContainer;
          const el = node instanceof HTMLElement ? node : node.parentElement;
          el?.scrollIntoView({ block: "center" });
        }
      }, 0);
    };

    const flashZoomIndicator = () => {
      if (zoomIndicatorTimeoutRef.current) clearTimeout(zoomIndicatorTimeoutRef.current);
      setShowZoomIndicator(true);
      zoomIndicatorTimeoutRef.current = setTimeout(() => setShowZoomIndicator(false), 800);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Command palette
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((prev) => !prev);
        return;
      }

      // Increase reading size
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        updateFontScale((prev) => prev + FONT_SCALE_STEP);
        //scrollCursorAfterReflow();
        flashZoomIndicator();
        return;
      }

      // Decrease reading size
      if (e.key === "-") {
        e.preventDefault();
        updateFontScale((prev) => prev - FONT_SCALE_STEP);
        //scrollCursorAfterReflow();
        flashZoomIndicator();
        return;
      }

      // Reset reading size
      if (e.key === "0") {
        e.preventDefault();
        updateFontScale(DEFAULT_FONT_SCALE);
        //scrollCursorAfterReflow();
        flashZoomIndicator();
      }
    };

    // Pinch-to-zoom via trackpad (browsers report pinch as wheel + ctrlKey)
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.01;
      updateFontScale((prev) => prev + delta);
      scrollCursorAfterReflow();
      flashZoomIndicator();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("wheel", handleWheel);
    };
  }, [updateFontScale]);

  if (!currentEntry) return null;

  const sealedEntries = allEntries.filter(
    (e) => e.sealed && e.id !== currentEntry.id
  );

  const contentRootStyle = {
    fontSize: `${18 * fontScale}px`,
    lineHeight: '1.6em',
    ["--editor-paragraph-spacing" as string]: `${0.9 * fontScale}rem`,
  } as CSSProperties;

  return (
    <div className="app-container">
      {createPortal(
        <div
          className={`theme-toggle-pill${theme === "dark" ? " dark" : ""}`}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          onClick={handleThemeToggle}
        >
          <div className="theme-pill-track">
            <div className="theme-pill-ball" />
          </div>
        </div>,
        document.body
      )}

      <div className="resize-edge resize-n" onMouseDown={() => getCurrentWindow().startResizeDragging("North")} />
      <div className="resize-edge resize-s" onMouseDown={() => getCurrentWindow().startResizeDragging("South")} />
      <div className="resize-edge resize-e" onMouseDown={() => getCurrentWindow().startResizeDragging("East")} />
      <div className="resize-edge resize-w" onMouseDown={() => getCurrentWindow().startResizeDragging("West")} />
      <div className="resize-edge resize-ne" onMouseDown={() => getCurrentWindow().startResizeDragging("NorthEast")} />
      <div className="resize-edge resize-nw" onMouseDown={() => getCurrentWindow().startResizeDragging("NorthWest")} />
      <div className="resize-edge resize-se" onMouseDown={() => getCurrentWindow().startResizeDragging("SouthEast")} />
      <div className="resize-edge resize-sw" onMouseDown={() => getCurrentWindow().startResizeDragging("SouthWest")} />

      <div className="scroll-container" onClick={handleContainerClick}>
        <div className="content-root" style={contentRootStyle}>
          <div className="column">
            {sealedEntries.map((entry) => (
                <div
                  key={entry.id}
                  id={`entry-${entry.id}`}
                  className="entry-sealed"
                  onClick={(e) => handleSealedEntryClick(entry, e)}
                >
                  <div className="entry-date-inline">
                    <span>{entry.date} #{entry.number}</span>
                  </div>

                  <div className="entry-content-readonly">
                    <ReactMarkdown>{entry.content}</ReactMarkdown>
                  </div>
                </div>
            ))}

      {/* Reopen dots tooltip */}
      {reopenClicks && reopenClicks.count > 0 && typeof reopenClicks.mouseX === "number" && typeof reopenClicks.mouseY === "number" && (
        createPortal(
          <div
            className={`reopen-dots tooltip-dots${document.documentElement.classList.contains('dark-theme') ? ' dark-theme' : ''}`}
            style={{
              position: "fixed",
              left: reopenClicks.mouseX - 24,
              top: reopenClicks.mouseY - 32,
              zIndex: 1300,
            }}
          >
            <span className={`reopen-dot${reopenClicks.count >= 1 ? " active" : ""}`} />
            <span className={`reopen-dot${reopenClicks.count >= 2 ? " active" : ""}`} />
            <span className={`reopen-dot${reopenClicks.count >= 3 ? " active" : ""}`} />
          </div>,
          document.body
        )
      )}

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

            {showOnboarding && (
              <div className="onboarding-hint">
                <p>Start writing...</p>
                <p><kbd>Shift</kbd> + <kbd>Enter</kbd> to finish this entry</p>
                <p><kbd>⌘</kbd> + <kbd>K</kbd> for commands</p>
                <p>  Right click for formatting</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {createPortal(
        <div style={{ position: "fixed", bottom: 20, right: 24, zIndex: 1200, display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`zoom-indicator${showZoomIndicator ? " visible" : ""}`}>
            {Math.round(fontScale * 100)}%
          </span>
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
