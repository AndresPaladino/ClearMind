import { useState, useEffect } from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

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
      return next;
    });
  };

  return {
    theme,
    resolvedTheme,
    handleThemeToggle,
  };
}
