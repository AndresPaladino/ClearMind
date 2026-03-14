export type ColorTheme = "light" | "dark";

type TagHueMap = Record<string, number>;

type TagColorToken = {
  text: string;
  bg: string;
  matchBg: string;
};

const STORAGE_KEY = "clearmind-tag-hues-v1";
let hueMapCache: TagHueMap | null = null;
const tokenCache = new Map<string, TagColorToken>();

function normalizeTag(tag: string): string {
  const clean = tag.trim().toLowerCase();
  if (!clean) return "#";
  return clean.startsWith("#") ? clean : `#${clean}`;
}

function hashTagToHue(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function readHueMap(): TagHueMap {
  if (hueMapCache) {
    return hueMapCache;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      hueMapCache = {};
      return hueMapCache;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      hueMapCache = {};
      return hueMapCache;
    }

    const cleaned: TagHueMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        cleaned[key] = ((Math.round(value) % 360) + 360) % 360;
      }
    }
    hueMapCache = cleaned;
    return hueMapCache;
  } catch {
    hueMapCache = {};
    return hueMapCache;
  }
}

function writeHueMap(map: TagHueMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore write failures; fallback hash still guarantees deterministic color.
  }
}

export function getOrCreateTagHue(tag: string): number {
  const normalized = normalizeTag(tag);

  if (typeof window === "undefined") {
    return hashTagToHue(normalized);
  }

  const map = readHueMap();
  const existing = map[normalized];
  if (typeof existing === "number") {
    return existing;
  }

  const nextHue = hashTagToHue(normalized);
  map[normalized] = nextHue;
  writeHueMap(map);
  return nextHue;
}

export function getTagColorToken(tag: string, theme: ColorTheme): TagColorToken {
  const normalized = normalizeTag(tag);
  const cacheKey = `${theme}:${normalized}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const hue = getOrCreateTagHue(normalized);

  if (theme === "dark") {
    const token = {
      text: `hsl(${hue} 92% 76%)`,
      bg: `hsl(${hue} 46% 25%)`,
      matchBg: `hsl(${hue} 52% 32%)`,
    };
    tokenCache.set(cacheKey, token);
    return token;
  }

  const token = {
    text: `hsl(${hue} 72% 34%)`,
    bg: `hsl(${hue} 88% 91%)`,
    matchBg: `hsl(${hue} 88% 85%)`,
  };
  tokenCache.set(cacheKey, token);
  return token;
}
