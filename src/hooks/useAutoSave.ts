import { useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "../utils/logError";

type SavePayload = {
  entryId: string;
  content: string;
};

export function useAutoSave() {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<string>("");
  const pendingSaveRef = useRef<SavePayload | null>(null);

  const persist = useCallback(async ({ entryId, content }: SavePayload) => {
    await invoke("save_entry", { id: entryId, content });
  }, []);

  const scheduleSave = useCallback(
    (entryId: string, content: string) => {
      pendingSaveRef.current = { entryId, content };

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        const payload = pendingSaveRef.current;
        if (!payload) return;

        pendingSaveRef.current = null;
        saveTimeoutRef.current = null;

        try {
          await persist(payload);
        } catch (err) {
          logError("AutoSave", "save_entry", err, { entryId: payload.entryId });
        }
      }, 1000);
    },
    [persist]
  );

  const flushSave = useCallback(async (payload?: SavePayload) => {
    const nextPayload = payload ?? pendingSaveRef.current;

    if (!nextPayload) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    pendingSaveRef.current = null;

    try {
      await persist(nextPayload);
    } catch (err) {
      logError("AutoSave", "flush_save", err, { entryId: nextPayload.entryId });
    }
  }, [persist]);

  const cancelSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    pendingSaveRef.current = null;
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const payload = pendingSaveRef.current;
      if (!payload) return;

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      pendingSaveRef.current = null;

      invoke("save_entry", {
        id: payload.entryId,
        content: payload.content,
      }).catch((err) =>
        logError("AutoSave", "flush_before_unload", err, { entryId: payload.entryId })
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushSave();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushSave]);

  return { saveTimeoutRef, contentRef, scheduleSave, flushSave, cancelSave };
}
