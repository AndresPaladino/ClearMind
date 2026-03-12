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
      {isTyping ? `#${number}` : `${date} #${number}`}
    </div>
  );
}
