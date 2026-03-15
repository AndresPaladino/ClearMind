import { SaveStatus } from "../hooks/useAutoSave";

interface EntryIndicatorProps {
  date: string;
  number: number;
  isTyping: boolean;
  saveStatus: SaveStatus;
}

export default function EntryIndicator({
  date,
  number,
  isTyping,
  saveStatus,
}: EntryIndicatorProps) {
  const saveStatusLabel =
    saveStatus === "pending"
      ? "Saving"
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "error"
          ? "Save failed"
          : "";

  return (
    <div className={`entry-indicator ${isTyping ? "dimmed" : ""}`}>
      <span className={`entry-indicator-date ${isTyping ? "hidden" : ""}`}>{date} </span>
      #{number}
      {saveStatusLabel ? (
        <span className={`entry-save-status ${saveStatus}`} aria-live="polite">
          {saveStatusLabel}
        </span>
      ) : null}
    </div>
  );
}
