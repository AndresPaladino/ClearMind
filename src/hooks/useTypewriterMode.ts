import { useState, useCallback } from "react";

export function useTypewriterMode() {
  const [isTypewriterMode, setIsTypewriterMode] = useState<boolean>(() => {
    return localStorage.getItem("clearmind-typewriter") === "1";
  });

  const toggleTypewriterMode = useCallback(() => {
    setIsTypewriterMode((prev) => {
      const next = !prev;
      localStorage.setItem("clearmind-typewriter", next ? "1" : "0");
      return next;
    });
  }, []);

  return { isTypewriterMode, toggleTypewriterMode };
}
