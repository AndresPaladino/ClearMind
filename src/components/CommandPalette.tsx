import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Entry } from "../types";

interface CommandPaletteProps {
  entries: Entry[];
  onSelect: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  onClose: () => void;
}

export default function CommandPalette({
  entries,
  onSelect,
  onDelete,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = entries.filter((entry) => {
    const label = `${entry.date} #${entry.number}`;
    const q = query.toLowerCase();
    return (
      label.toLowerCase().includes(q) ||
      entry.content.toLowerCase().includes(q)
    );
  });

  // Reverse to show newest first
  const sorted = [...filtered].reverse();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, sorted.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (sorted[selectedIndex]) {
          onSelect(sorted[selectedIndex]);
        }
      }
    },
    [sorted, selectedIndex, onSelect, onClose]
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
        <div className="command-palette-list">
          {sorted.length === 0 ? (
            <div className="command-palette-empty">No results</div>
          ) : (
            sorted.map((entry, i) => (
              <div
                key={entry.id}
                className={`command-palette-item ${i === selectedIndex ? "selected" : ""}`}
                onClick={() => onSelect(entry)}
              >
                <span className="entry-label">
                  {entry.date} #{entry.number}
                </span>
                <span className="entry-preview">
                  <ReactMarkdown>{entry.content.substring(0, 120)}</ReactMarkdown>
                </span>
                <button
                  className="delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(entry);
                  }}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
