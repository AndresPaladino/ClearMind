interface EntryIndicatorProps {
  date: string;
  number: number;
  isTyping: boolean;
}

export default function EntryIndicator({
  date,
  number,
  isTyping,
}: EntryIndicatorProps) {
  return (
    <div className={`entry-indicator ${isTyping ? "dimmed" : ""}`}>
      <span className={`entry-indicator-date ${isTyping ? "hidden" : ""}`}>{date} </span>
      #{number}
    </div>
  );
}
