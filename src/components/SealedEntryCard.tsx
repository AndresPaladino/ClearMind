import { memo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Entry } from "../types";

interface SealedEntryCardProps {
  entry: Entry;
  hasDayAnchor: boolean;
  isDeleteChordPressed: boolean;
  isDeleteArmed: boolean;
  onRequestDelete: (entry: Entry) => void;
  onRequestUnseal: (entry: Entry) => void;
  markdownComponents: any;
}

function SealedEntryCardComponent({
  entry,
  hasDayAnchor,
  isDeleteChordPressed,
  isDeleteArmed,
  onRequestDelete,
  onRequestUnseal,
  markdownComponents,
}: SealedEntryCardProps) {
  const dayKey = entry.id.split("_")[0];

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      e.preventDefault();
      e.stopPropagation();
      onRequestDelete(entry);
    },
    [entry, onRequestDelete]
  );

  const handleDoubleClick = useCallback(() => {
    onRequestUnseal(entry);
  }, [entry, onRequestUnseal]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();

      const mod = e.metaKey || e.ctrlKey;
      if (mod) {
        onRequestDelete(entry);
      } else {
        onRequestUnseal(entry);
      }
    },
    [entry, onRequestDelete, onRequestUnseal]
  );

  return (
    <div>
      {hasDayAnchor && (
        <div
          id={`day-${dayKey}`}
          className="day-anchor"
          data-day-anchor="true"
          data-day-key={dayKey}
          aria-hidden="true"
        />
      )}
      <div
        id={`entry-${entry.id}`}
        className={`entry-sealed${isDeleteChordPressed ? " delete-mode" : ""}${
          isDeleteArmed ? " delete-armed" : ""
        }`}
        tabIndex={0}
        role="article"
        aria-label={`Entry ${entry.date} #${entry.number}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      >
        <div className="entry-date-inline">
          <span className="entry-gesture-anchor">
            {entry.date} #{entry.number}
            <span className="entry-gesture-tooltip" role="tooltip">
              Double-click to edit. Hold ⌘ and click to arm delete
            </span>
          </span>
          <span className={`entry-delete-hint${isDeleteChordPressed || isDeleteArmed ? " visible" : ""}`}>
            {isDeleteArmed ? "Click again to delete" : "⌘ Click to delete"}
          </span>
        </div>

        <div className="entry-content-readonly">
          <ReactMarkdown components={markdownComponents}>{entry.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default memo(SealedEntryCardComponent, (prev, next) => {
  return (
    prev.entry.id === next.entry.id &&
    prev.entry.content === next.entry.content &&
    prev.entry.sealed === next.entry.sealed &&
    prev.entry.number === next.entry.number &&
    prev.hasDayAnchor === next.hasDayAnchor &&
    prev.isDeleteChordPressed === next.isDeleteChordPressed &&
    prev.isDeleteArmed === next.isDeleteArmed &&
    prev.markdownComponents === next.markdownComponents
  );
});
