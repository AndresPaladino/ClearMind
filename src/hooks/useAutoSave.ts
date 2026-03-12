import { useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Entry } from "../types";

export function useAutoSave(currentEntry: Entry | null) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<string>("");

  const scheduleSave = useCallback(
    (entryId: string, content: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await invoke("save_entry", { id: entryId, content });
        } catch (err) {
          console.error("Failed to save entry:", err);
        }
      }, 1000);
    },
    []
  );

  const flushSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (currentEntry && contentRef.current) {
      invoke("save_entry", {
        id: currentEntry.id,
        content: contentRef.current,
      }).catch((err) => console.error("Failed to flush save:", err));
    }
  }, [currentEntry]);

  useEffect(() => {
    const handleBeforeUnload = () => flushSave();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushSave();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushSave]);

  return { saveTimeoutRef, contentRef, scheduleSave, flushSave };
}
