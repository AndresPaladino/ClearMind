import { useState, useEffect } from "react";

type Theme = "light" | "dark" | "system";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("clearmind-theme");
    if (stored === "light" || stored === "dark") return stored;
    return "system";
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
      document.documentElement.classList.toggle("dark-theme", mq.matches);
      document.documentElement.classList.toggle("light-theme", !mq.matches);
    };

    mq.addEventListener("change", update);
    update();

    return () => mq.removeEventListener("change", update);
  }, [theme]);

  const handleThemeToggle = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("clearmind-theme", next);
      return next;
    });
  };

  return { theme, handleThemeToggle };
}
