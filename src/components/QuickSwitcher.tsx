import { useState, useEffect, useRef, useCallback } from "react";
import { Entry } from "../types";
import { extractTags } from "../utils/extractTags";
import { getTagColorToken, type ColorTheme } from "../utils/tagColors";

interface QuickSwitcherProps {
  entries: Entry[];
  theme: ColorTheme;
  currentEntryId: string;
  onSelect: (entry: Entry) => void;
  onDelete: (entry: Entry) => Promise<void>;
  onClose: () => void;
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

export default function QuickSwitcher({
  entries,
  theme,
  currentEntryId,
  onSelect,
  onDelete,
  onClose,
}: QuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [blockedDeleteEntryId, setBlockedDeleteEntryId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const blockedDeleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = "entry-switcher-listbox";
  const hintId = "entry-switcher-hint";

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const filtered = entries.filter((entry) => {
    const label = `${entry.date} #${entry.number}`;
    const q = query.toLowerCase();

    if (q.startsWith("#") && q.length > 1) {
      // Tag mode: only match against extracted tags (prefix match)
      return extractTags(entry.content).some((tag) => tag.startsWith(q));
    }

    const plainContent = stripMarkdown(entry.content).toLowerCase();
    return label.toLowerCase().includes(q) || plainContent.includes(q);
  });

  const sorted = [...filtered].reverse();

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  useEffect(() => {
    setSelectedIndex(0);
    setPendingDeleteIndex(null);
    setBlockedDeleteEntryId(null);
  }, [query]);

  useEffect(() => {
    setSelectedIndex((prev) => {
      if (sorted.length === 0) return 0;
      return Math.min(prev, sorted.length - 1);
    });
  }, [sorted.length]);

  useEffect(() => {
    focusInput();
  }, [sorted.length, focusInput]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    if (!item) return;
    item.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    return () => {
      if (blockedDeleteTimeoutRef.current) {
        clearTimeout(blockedDeleteTimeoutRef.current);
      }
    };
  }, []);

  const triggerBlockedDelete = useCallback((entryId: string) => {
    if (blockedDeleteTimeoutRef.current) {
      clearTimeout(blockedDeleteTimeoutRef.current);
    }

    setPendingDeleteIndex(null);
    setBlockedDeleteEntryId(entryId);
    blockedDeleteTimeoutRef.current = setTimeout(() => {
      setBlockedDeleteEntryId(null);
      blockedDeleteTimeoutRef.current = null;
    }, 360);
  }, []);

  const deleteEntry = useCallback(
    async (index: number) => {
      const entry = sorted[index];
      if (!entry) return;
      if (entry.id === currentEntryId) {
        triggerBlockedDelete(entry.id);
        focusInput();
        return;
      }

      const nextIndexAfterDelete =
        index >= sorted.length - 1 ? Math.max(0, index - 1) : index;

      await onDelete(entry);
      setPendingDeleteIndex(null);

      setSelectedIndex(nextIndexAfterDelete);
      focusInput();
    },
    [sorted, onDelete, focusInput, currentEntryId, triggerBlockedDelete]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
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
          void deleteEntry(pendingDeleteIndex);
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
    [sorted, selectedIndex, pendingDeleteIndex, onSelect, deleteEntry, onClose]
  );

  return (
    <div className="quick-switcher-overlay" onClick={onClose}>
      <div
        className="quick-switcher"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to entry"
        aria-describedby={hintId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="quick-switcher-input"
          type="text"
          placeholder="Go to entry or #tag..."
          value={query}
          aria-controls={listboxId}
          aria-activedescendant={`entry-switcher-option-${selectedIndex}`}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="quick-switcher-list" ref={listRef} role="listbox" id={listboxId}>
          {sorted.length === 0 ? (
            <div className="quick-switcher-empty">No results</div>
          ) : (
            sorted.map((entry, i) => (
              <div
                key={entry.id}
                id={`entry-switcher-option-${i}`}
                role="option"
                aria-selected={i === selectedIndex}
                className={`quick-switcher-item ${i === selectedIndex ? "selected" : ""} ${i === pendingDeleteIndex ? "confirm-delete" : ""} ${entry.id === currentEntryId ? "current-entry" : ""} ${entry.id === blockedDeleteEntryId ? "blocked-delete" : ""}`}
                onClick={() => onSelect(entry)}
              >
                {i === pendingDeleteIndex ? (
                  <span className="confirm-delete-label">
                    Delete this entry? Press Enter to confirm
                  </span>
                ) : (
                  <>
                    <div className="quick-switcher-item-row">
                      <span className="entry-label">
                        {entry.date} #{entry.number}
                        {entry.id === currentEntryId && (
                          <span className="entry-current-badge">Currently opened</span>
                        )}
                      </span>
                      <span className="entry-preview">
                        {stripMarkdown(entry.content).substring(0, 120)}
                      </span>
                    </div>
                    {(() => {
                      const tags = extractTags(entry.content);
                      if (tags.length === 0) return null;
                      const q = query.toLowerCase();
                      const isTagMode = q.startsWith("#") && q.length > 1;
                      return (
                        <div className="quick-switcher-item-tags">
                          {tags.slice(0, 5).map((tag) => (
                            <span
                              key={tag}
                              className={`entry-tag${
                                isTagMode && tag.startsWith(q) ? " entry-tag-match" : ""
                              }`}
                              style={(() => {
                                const token = getTagColorToken(tag, theme);
                                return {
                                  color: token.text,
                                  backgroundColor:
                                    isTagMode && tag.startsWith(q)
                                      ? token.matchBg
                                      : token.bg,
                                };
                              })()}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            ))
          )}
        </div>
        <div className="quick-switcher-footer" id={hintId}>
          <span>
            <kbd>↵</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
          <span>
            <kbd>⌘</kbd>
            <kbd>⌫</kbd> Delete
          </span>
        </div>
      </div>
    </div>
  );
}
