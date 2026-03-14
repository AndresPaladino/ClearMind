import { useState, useEffect } from "react";
import lightSound from "../assets/sounds/light.mp3";
import darkSound from "../assets/sounds/dark.mp3";
import fontSound from "../assets/sounds/font.mp3";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
type SoundName = "light" | "dark" | "font";

const SOUND_VOLUME = 0.14;

const SOUND_FILES: Record<SoundName, string> = {
  light: lightSound,
  dark: darkSound,
  font: fontSound,
};

const playSound = (name: SoundName) => {
  const audio = new Audio(SOUND_FILES[name]);
  audio.volume = SOUND_VOLUME;
  audio.play().catch(() => {});
};

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("clearmind-theme");
    if (stored === "light" || stored === "dark") return stored;
    return "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    const stored = localStorage.getItem("clearmind-theme");
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    return localStorage.getItem("clearmind-sounds-muted") === "true";
  });

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.classList.remove("dark-theme");
      document.documentElement.classList.remove("light-theme");
    } else {
      document.documentElement.classList.toggle("dark-theme", theme === "dark");
      document.documentElement.classList.toggle("light-theme", theme === "light");
    }
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      setResolvedTheme(mq.matches ? "dark" : "light");
      document.documentElement.classList.toggle("dark-theme", mq.matches);
      document.documentElement.classList.toggle("light-theme", !mq.matches);
    };

    mq.addEventListener("change", update);
    update();

    return () => mq.removeEventListener("change", update);
  }, [theme]);

  useEffect(() => {
    if (theme === "system") return;
    setResolvedTheme(theme);
  }, [theme]);

  const handleThemeToggle = () => {
    setTheme((prev) => {
      const next: ResolvedTheme = prev === "dark" ? "light" : "dark";
      localStorage.setItem("clearmind-theme", next);
      if (!isMuted) {
        playSound(next);
      }
      return next;
    });
  };

  // Para el cambio de font desde App
  const playFontToggleSound = () => {
    if (isMuted) return;
    playSound("font");
  };

  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      localStorage.setItem("clearmind-sounds-muted", String(next));
      return next;
    });
  };

  return {
    theme,
    resolvedTheme,
    isMuted,
    handleThemeToggle,
    playFontToggleSound,
    toggleMute,
  };
}
