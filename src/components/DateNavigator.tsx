import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getTagColorToken, type ColorTheme } from "../utils/tagColors";

interface DateNavigatorDay {
  key: string;
  label: string;
  count: number;
  tags: string[];
}

interface DateNavigatorProps {
  days: DateNavigatorDay[];
  activeDayKey: string | null;
  onSelectDay: (dayKey: string) => void;
  theme: ColorTheme;
}

interface CalendarCell {
  id: string;
  dayNumber: number | null;
  dayKey: string | null;
}

const HEATMAP_PAST_DAYS = 132;
const HEATMAP_FUTURE_DAYS = 7;
const HEATMAP_TOTAL_DAYS = HEATMAP_PAST_DAYS + HEATMAP_FUTURE_DAYS + 1;
const PANEL_ANIMATION_MS = 180;

function parseDayKey(dayKey: string): Date | null {
  const [day, month, year] = dayKey.split("-").map((part) => Number(part));
  if (!day || !month || Number.isNaN(year)) return null;

  const fullYear = 2000 + year;
  const parsed = new Date(fullYear, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
}

function formatMonthId(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatDayKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

function monthLabel(monthId: string): string {
  const [year, month] = monthId.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("es", { month: "short", year: "numeric" }).format(date);
}

function buildCalendarCells(monthId: string): CalendarCell[] {
  const [year, month] = monthId.split("-").map((part) => Number(part));
  const firstDate = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const mondayFirstOffset = (firstDate.getDay() + 6) % 7;

  const cells: CalendarCell[] = [];

  for (let i = 0; i < mondayFirstOffset; i += 1) {
    cells.push({ id: `pad-start-${i}`, dayNumber: null, dayKey: null });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month - 1, day);
    cells.push({
      id: `day-${day}`,
      dayNumber: day,
      dayKey: formatDayKey(date),
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ id: `pad-end-${cells.length}`, dayNumber: null, dayKey: null });
  }

  return cells;
}

function clampHeatLevel(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

function normalizeTagQuery(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function DateNavigator({ days, activeDayKey, onSelectDay, theme }: DateNavigatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPanelMounted, setIsPanelMounted] = useState(false);
  const [tagQueryInput, setTagQueryInput] = useState("");
  const [isTagInputFocused, setIsTagInputFocused] = useState(false);
  const [isTagSuggestionsDismissed, setIsTagSuggestionsDismissed] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0);
  const [heatmapWeekOffset, setHeatmapWeekOffset] = useState(0);

  const daysByKey = useMemo(() => {
    const map = new Map<string, DateNavigatorDay>();
    for (const day of days) {
      map.set(day.key, day);
    }
    return map;
  }, [days]);

  const tagQuery = useMemo(() => normalizeTagQuery(tagQueryInput), [tagQueryInput]);

  const tagSuggestions = useMemo(() => {
    const counts = new Map<string, number>();

    for (const day of days) {
      const uniqueTags = new Set(day.tags);
      for (const tag of uniqueTags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    const ordered = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);

    return ordered
      .filter((tag) => tag.includes(tagQuery))
      .slice(0, 8);
  }, [days, tagQuery]);

  useEffect(() => {
    setHighlightedSuggestion(0);
  }, [tagQueryInput]);

  useEffect(() => {
    if (!isOpen) {
      setIsTagSuggestionsDismissed(false);
    }
  }, [isOpen]);

  const monthIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();

    for (const day of days) {
      const parsed = parseDayKey(day.key);
      if (!parsed) continue;
      const id = formatMonthId(parsed);
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }

    return ids;
  }, [days]);

  const fallbackMonthId = monthIds[monthIds.length - 1] ?? formatMonthId(new Date());
  const activeMonthId = useMemo(() => {
    const parsed = activeDayKey ? parseDayKey(activeDayKey) : null;
    if (!parsed) return fallbackMonthId;
    return formatMonthId(parsed);
  }, [activeDayKey, fallbackMonthId]);

  const [monthCursor, setMonthCursor] = useState(activeMonthId);

  useEffect(() => {
    if (!monthIds.includes(monthCursor)) {
      setMonthCursor(activeMonthId);
    }
  }, [monthIds, monthCursor, activeMonthId]);

  useEffect(() => {
    if (!isOpen) return;
    setMonthCursor(activeMonthId);
  }, [isOpen, activeMonthId]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (panelCloseTimerRef.current) {
        clearTimeout(panelCloseTimerRef.current);
        panelCloseTimerRef.current = null;
      }
      setIsPanelMounted(true);
      return;
    }

    if (!isPanelMounted) return;

    panelCloseTimerRef.current = setTimeout(() => {
      setIsPanelMounted(false);
      panelCloseTimerRef.current = null;
    }, PANEL_ANIMATION_MS);

    return () => {
      if (panelCloseTimerRef.current) {
        clearTimeout(panelCloseTimerRef.current);
        panelCloseTimerRef.current = null;
      }
    };
  }, [isOpen, isPanelMounted]);

  useEffect(() => {
    return () => {
      if (panelCloseTimerRef.current) {
        clearTimeout(panelCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleDocClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const calendarCells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);

  const monthCursorIndex = monthIds.indexOf(monthCursor);
  const canGoPrevMonth = monthCursorIndex > 0;
  const canGoNextMonth = monthCursorIndex >= 0 && monthCursorIndex < monthIds.length - 1;

  const heatmapRows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(today);
    startDate.setDate(today.getDate() - HEATMAP_PAST_DAYS + heatmapWeekOffset * 7);

    const items: Array<{
      dayKey: string;
      label: string;
      count: number;
      level: number;
      isActive: boolean;
      tags: string[];
      hasTagMatch: boolean;
    }> = [];

    for (let i = 0; i < HEATMAP_TOTAL_DAYS; i += 1) {
      const current = new Date(startDate);
      current.setDate(startDate.getDate() + i);
      const dayKey = formatDayKey(current);
      const dayData = daysByKey.get(dayKey);
      const count = dayData?.count ?? 0;
      const tags = dayData?.tags ?? [];
      const hasTagMatch = tagQuery.length > 0 && tags.includes(tagQuery);

      items.push({
        dayKey,
        label: dayData?.label ?? current.toLocaleDateString("es"),
        count,
        level: clampHeatLevel(count),
        isActive: dayKey === activeDayKey,
        tags,
        hasTagMatch,
      });
    }

    return items;
  }, [activeDayKey, daysByKey, heatmapWeekOffset, tagQuery]);

  const heatmapRangeLabel = useMemo(() => {
    if (heatmapRows.length === 0) return "";
    const start = heatmapRows[0].label;
    const end = heatmapRows[heatmapRows.length - 1].label;
    return `${start} - ${end}`;
  }, [heatmapRows]);

  const canGoNewerHeatmapRange = heatmapWeekOffset < 0;

  const tagMatchColor = useMemo(() => {
    if (!tagQuery) return null;
    return getTagColorToken(tagQuery, theme);
  }, [tagQuery, theme]);

  const handleSelectDay = (dayKey: string) => {
    if (!daysByKey.has(dayKey)) return;
    onSelectDay(dayKey);
    setIsOpen(false);
  };

  const shouldShowTagSuggestions =
    isTagInputFocused &&
    !isTagSuggestionsDismissed &&
    tagQueryInput.trim().length > 0 &&
    tagSuggestions.length > 0;

  const handleTagInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!shouldShowTagSuggestions) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSuggestion((prev) => (prev + 1) % tagSuggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSuggestion((prev) =>
        prev === 0 ? tagSuggestions.length - 1 : prev - 1
      );
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const selected = tagSuggestions[highlightedSuggestion];
      if (!selected) return;
      setTagQueryInput(selected);
      setIsTagSuggestionsDismissed(true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsTagInputFocused(false);
    }
  };

  return (
    <div className="date-navigator" ref={containerRef}>
      <button
        type="button"
        className={`date-navigator-trigger${isOpen ? " open" : ""}`}
        data-tooltip="Browse dates"
        data-tooltip-placement="left"
        aria-label="Open date navigator"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        cal
      </button>

      {isPanelMounted && (
        <div
          className={`date-navigator-panel${isOpen ? " open" : " closing"}`}
          role="dialog"
          aria-label="Date navigator"
          aria-hidden={!isOpen}
        >
          <section className="date-navigator-calendar" aria-label="Mini calendar">
            <div className="date-navigator-tag-search-row">
              <input
                type="text"
                className="date-navigator-tag-input"
                placeholder="#tag"
                value={tagQueryInput}
                aria-label="Filter by tag"
                onChange={(event) => {
                  setTagQueryInput(event.target.value);
                  setIsTagSuggestionsDismissed(false);
                }}
                onFocus={() => {
                  setIsTagInputFocused(true);
                  setIsTagSuggestionsDismissed(false);
                }}
                onBlur={() => {
                  // Delay so suggestion click can be registered.
                  setTimeout(() => setIsTagInputFocused(false), 100);
                }}
                onKeyDown={handleTagInputKeyDown}
              />
              {tagQueryInput.trim() && (
                <button
                  type="button"
                  className="date-navigator-tag-clear"
                  aria-label="Clear tag filter"
                  onClick={() => {
                    setTagQueryInput("");
                    setHighlightedSuggestion(0);
                    setIsTagSuggestionsDismissed(false);
                  }}
                >
                  clear
                </button>
              )}
            </div>

            {shouldShowTagSuggestions && (
              <div className="date-navigator-tag-suggestions" role="listbox" aria-label="Tag suggestions">
                {tagSuggestions.map((tag, index) => {
                  const isHighlighted = index === highlightedSuggestion;
                  const token = getTagColorToken(tag, theme);

                  return (
                    <button
                      key={tag}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      className={`date-navigator-tag-suggestion${isHighlighted ? " active" : ""}`}
                      style={
                        {
                          "--tag-match-bg": token.matchBg,
                          "--tag-match-text": token.text,
                        } as CSSProperties
                      }
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setTagQueryInput(tag);
                        setHighlightedSuggestion(index);
                        setIsTagSuggestionsDismissed(true);
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}

            <header className="date-navigator-month-header">
              <button
                type="button"
                className="date-navigator-month-btn"
                disabled={!canGoPrevMonth}
                aria-label="Previous month"
                onClick={() => {
                  if (!canGoPrevMonth) return;
                  setMonthCursor(monthIds[monthCursorIndex - 1]);
                }}
              >
                  {"<"}
              </button>

              <span className="date-navigator-month-label">{monthLabel(monthCursor)}</span>

              <button
                type="button"
                className="date-navigator-month-btn"
                disabled={!canGoNextMonth}
                aria-label="Next month"
                onClick={() => {
                  if (!canGoNextMonth) return;
                  setMonthCursor(monthIds[monthCursorIndex + 1]);
                }}
              >
                  {">"}
              </button>
            </header>

            <div className="date-navigator-weekdays" aria-hidden="true">
              <span>lu</span>
              <span>ma</span>
              <span>mi</span>
              <span>ju</span>
              <span>vi</span>
              <span>sa</span>
              <span>do</span>
            </div>

            <div className="date-navigator-grid">
              {calendarCells.map((cell) => {
                if (!cell.dayNumber || !cell.dayKey) {
                  return <span key={cell.id} className="date-cell pad" aria-hidden="true" />;
                }

                const dayData = daysByKey.get(cell.dayKey);
                const hasEntry = Boolean(dayData);
                const isActive = cell.dayKey === activeDayKey;
                const hasTagMatch =
                  Boolean(dayData) && tagQuery.length > 0 && (dayData?.tags ?? []).includes(tagQuery);

                return (
                  <button
                    key={cell.id}
                    type="button"
                    className={`date-cell${hasEntry ? " has-entry" : ""}${isActive ? " active" : ""}${hasTagMatch ? " tag-match" : ""}${
                      tagQuery.length > 0 && hasEntry && !hasTagMatch ? " tag-dimmed" : ""
                    }`}
                    aria-label={
                      dayData
                        ? `${dayData.label}. ${dayData.count} ${dayData.count === 1 ? "entry" : "entries"}`
                        : `${cell.dayNumber}`
                    }
                    style={
                      hasTagMatch && tagMatchColor
                        ? ({
                            "--tag-match-bg": tagMatchColor.matchBg,
                            "--tag-match-text": tagMatchColor.text,
                          } as CSSProperties)
                        : undefined
                    }
                    disabled={!hasEntry}
                    onClick={() => {
                      if (!cell.dayKey) return;
                      handleSelectDay(cell.dayKey);
                    }}
                  >
                    {cell.dayNumber}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="date-navigator-heatmap" aria-label="Date heatmap">
            <div className="date-navigator-heatmap-grid">
              {heatmapRows.map((item) => (
                <button
                  key={item.dayKey}
                  type="button"
                  className={`heat-cell level-${item.level}${item.isActive ? " active" : ""}${item.hasTagMatch ? " tag-match" : ""}${
                    tagQuery.length > 0 && item.count > 0 && !item.hasTagMatch ? " tag-dimmed" : ""
                  }`}
                  data-tooltip={
                    item.count > 0
                      ? `${item.label} - ${item.count} ${item.count === 1 ? "entry" : "entries"}${
                          item.tags.length > 0 ? ` - ${item.tags.join(" ")}` : ""
                        }`
                      : item.label
                  }
                  data-tooltip-placement="left"
                  aria-label={
                    item.count > 0
                      ? `${item.label}. ${item.count} ${item.count === 1 ? "entry" : "entries"}`
                      : `${item.label}. No entries.`
                  }
                  style={
                    item.hasTagMatch && tagMatchColor
                      ? ({
                          "--tag-match-bg": tagMatchColor.matchBg,
                          "--tag-match-text": tagMatchColor.text,
                        } as CSSProperties)
                      : undefined
                  }
                  disabled={item.count === 0}
                  onClick={() => handleSelectDay(item.dayKey)}
                />
              ))}
            </div>

            <div className="date-navigator-heatmap-nav" role="group" aria-label="Navigate heatmap range">
              <button
                type="button"
                className="date-navigator-heatmap-nav-btn"
                data-tooltip="Ver semanas anteriores"
                data-tooltip-placement="left"
                aria-label="Show older heatmap days"
                onClick={() => setHeatmapWeekOffset((prev) => prev - 1)}
              >
                {"<"}
              </button>

              <span className="date-navigator-heatmap-range" aria-live="polite">
                {heatmapRangeLabel}
              </span>

              <button
                type="button"
                className="date-navigator-heatmap-nav-btn"
                data-tooltip="Volver hacia hoy"
                data-tooltip-placement="left"
                aria-label="Show newer heatmap days"
                disabled={!canGoNewerHeatmapRange}
                onClick={() => {
                  if (!canGoNewerHeatmapRange) return;
                  setHeatmapWeekOffset((prev) => prev + 1);
                }}
              >
                {">"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default DateNavigator;
