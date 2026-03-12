import { useState, useEffect, useRef, useCallback } from "react";
import { Entry } from "../types";

interface CommandPaletteProps {
  entries: Entry[];
  onSelect: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  onClose: () => void;
}

interface ContextMenu {
  x: number;
  y: number;
  entryIndex: number;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*{1,3}|_{1,3}|~~)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

export default function CommandPalette({
  entries,
  onSelect,
  onDelete,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = entries.filter((entry) => {
    const label = `${entry.date} #${entry.number}`;
    const q = query.toLowerCase();
    return (
      label.toLowerCase().includes(q) ||
      entry.content.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].reverse();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
    setPendingDeleteIndex(null);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    if (!item) return;
    item.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Close context menu on any click or scroll
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    listRef.current?.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      listRef.current?.removeEventListener("scroll", close);
    };
  }, [contextMenu]);

  const deleteEntry = useCallback(
    (index: number) => {
      const entry = sorted[index];
      if (!entry) return;
      onDelete(entry);
      setPendingDeleteIndex(null);
      setContextMenu(null);
      // Reposition: stay at same index, clamp if it was the last item
      setSelectedIndex((prev) => {
        const newLength = sorted.length - 1;
        if (newLength <= 0) return 0;
        return Math.min(prev, newLength - 1);
      });
    },
    [sorted, onDelete]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Close context menu on any key
      if (contextMenu) {
        setContextMenu(null);
      }

      if (e.key === "Escape") {
        if (pendingDeleteIndex !== null) {
          setPendingDeleteIndex(null);
        } else {
          onClose();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setPendingDeleteIndex(null);
        setSelectedIndex((i) => Math.min(i + 1, sorted.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setPendingDeleteIndex(null);
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (pendingDeleteIndex !== null) {
          deleteEntry(pendingDeleteIndex);
        } else if (sorted[selectedIndex]) {
          onSelect(sorted[selectedIndex]);
        }
      } else if (
        e.key === "Backspace" &&
        (e.metaKey || e.ctrlKey) &&
        sorted[selectedIndex]
      ) {
        e.preventDefault();
        setPendingDeleteIndex(selectedIndex);
      }
    },
    [sorted, selectedIndex, pendingDeleteIndex, contextMenu, onSelect, deleteEntry, onClose]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, entryIndex: index });
    },
    []
  );

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="command-palette-input"
          type="text"
          placeholder="Search entries..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="command-palette-list" ref={listRef}>
          {sorted.length === 0 ? (
            <div className="command-palette-empty">No results</div>
          ) : (
            sorted.map((entry, i) => (
              <div
                key={entry.id}
                className={`command-palette-item ${i === selectedIndex ? "selected" : ""} ${i === pendingDeleteIndex ? "confirm-delete" : ""}`}
                onClick={() => onSelect(entry)}
                onContextMenu={(e) => handleContextMenu(e, i)}
              >
                {i === pendingDeleteIndex ? (
                  <span className="confirm-delete-label">
                    Delete this entry? Press Enter to confirm
                  </span>
                ) : (
                  <>
                    <span className="entry-label">
                      {entry.date} #{entry.number}
                    </span>
                    <span className="entry-preview">
                      {stripMarkdown(entry.content).substring(0, 120)}
                    </span>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item context-menu-item--danger"
            onClick={() => deleteEntry(contextMenu.entryIndex)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
