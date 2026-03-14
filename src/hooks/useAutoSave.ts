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
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback(async ({ entryId, content }: SavePayload) => {
    await invoke("save_entry", { id: entryId, content });
  }, []);

  const enqueuePersist = useCallback(
    async (payload: SavePayload, operation: string) => {
      const next = persistQueueRef.current
        .catch(() => {
          // Keep the save queue alive even if a previous write failed.
        })
        .then(async () => {
          try {
            await persist(payload);
          } catch (err) {
            logError("AutoSave", operation, err, { entryId: payload.entryId });
          }
        });

      persistQueueRef.current = next;
      await next;
    },
    [persist]
  );

  const scheduleSave = useCallback(
    (entryId: string, content: string) => {
      const pending = pendingSaveRef.current;
      if (pending && pending.entryId !== entryId) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }

        pendingSaveRef.current = null;
        void enqueuePersist(pending, "flush_save_on_entry_change");
      }

      pendingSaveRef.current = { entryId, content };

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        const payload = pendingSaveRef.current;
        if (!payload) return;

        pendingSaveRef.current = null;
        saveTimeoutRef.current = null;

        await enqueuePersist(payload, "save_entry");
      }, 1000);
    },
    [enqueuePersist]
  );

  const flushSave = useCallback(
    async (payload?: SavePayload) => {
      if (payload) {
        const pending = pendingSaveRef.current;
        if (pending && pending.entryId === payload.entryId) {
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
          }
          pendingSaveRef.current = null;
        }

        await enqueuePersist(payload, "flush_save");
        return;
      }

      const pending = pendingSaveRef.current;
      if (!pending) return;

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      pendingSaveRef.current = null;
      await enqueuePersist(pending, "flush_save");
    },
    [enqueuePersist]
  );

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

      void enqueuePersist(payload, "flush_before_unload");
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
  }, [flushSave, enqueuePersist]);

  return { saveTimeoutRef, contentRef, scheduleSave, flushSave, cancelSave };
}
