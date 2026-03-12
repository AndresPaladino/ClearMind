import { useState, useCallback } from "react";

const FONT_SCALE_MIN = 0.85;
const FONT_SCALE_MAX = 1.8;
export const FONT_SCALE_STEP = 0.1;
export const DEFAULT_FONT_SCALE = 1;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function useFontScale() {
  const [fontScale, setFontScale] = useState<number>(() => {
    const stored = localStorage.getItem("clearmind-font-scale");
    const parsed = stored ? Number(stored) : DEFAULT_FONT_SCALE;
    return Number.isFinite(parsed)
      ? clamp(parsed, FONT_SCALE_MIN, FONT_SCALE_MAX)
      : DEFAULT_FONT_SCALE;
  });

  const updateFontScale = useCallback(
    (next: number | ((prev: number) => number)) => {
      setFontScale((prev) => {
        const raw = typeof next === "function" ? next(prev) : next;
        const clamped = clamp(raw, FONT_SCALE_MIN, FONT_SCALE_MAX);
        localStorage.setItem("clearmind-font-scale", String(clamped));
        return clamped;
      });
    },
    []
  );

  return { fontScale, updateFontScale };
}
