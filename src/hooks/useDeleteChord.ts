import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface UseDeleteChordOptions {
  existingEntryIds: string[];
  armTimeoutMs?: number;
}

export function useDeleteChord({ existingEntryIds, armTimeoutMs = 1600 }: UseDeleteChordOptions) {
  const [isDeleteChordPressed, setIsDeleteChordPressed] = useState(false);
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string | null>(null);
  const deleteArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const existingIdSet = useMemo(() => new Set(existingEntryIds), [existingEntryIds]);

  const clearDeleteArm = useCallback(() => {
    if (deleteArmTimeoutRef.current) {
      clearTimeout(deleteArmTimeoutRef.current);
      deleteArmTimeoutRef.current = null;
    }
    setPendingDeleteEntryId(null);
  }, []);

  const armDeleteEntry = useCallback(
    (entryId: string) => {
      if (deleteArmTimeoutRef.current) {
        clearTimeout(deleteArmTimeoutRef.current);
      }

      setPendingDeleteEntryId(entryId);
      deleteArmTimeoutRef.current = setTimeout(() => {
        setPendingDeleteEntryId(null);
        deleteArmTimeoutRef.current = null;
      }, armTimeoutMs);
    },
    [armTimeoutMs]
  );

  useEffect(() => {
    const updateDeleteChordState = (e: KeyboardEvent) => {
      setIsDeleteChordPressed(e.metaKey || e.ctrlKey);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      setIsDeleteChordPressed(e.metaKey || e.ctrlKey);
    };

    const handleWindowBlur = () => {
      setIsDeleteChordPressed(false);
    };

    window.addEventListener("keydown", updateDeleteChordState, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", updateDeleteChordState, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!pendingDeleteEntryId) return;
    if (existingIdSet.has(pendingDeleteEntryId)) return;
    clearDeleteArm();
  }, [clearDeleteArm, existingIdSet, pendingDeleteEntryId]);

  useEffect(() => {
    return () => {
      if (deleteArmTimeoutRef.current) {
        clearTimeout(deleteArmTimeoutRef.current);
      }
    };
  }, []);

  return {
    isDeleteChordPressed,
    pendingDeleteEntryId,
    clearDeleteArm,
    armDeleteEntry,
  };
}
