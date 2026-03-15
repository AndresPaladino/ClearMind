import { MutableRefObject, useCallback, useEffect, useState } from "react";
import { Entry, EntrySummary } from "../types";
import {
  deleteEntry,
  getAllEntries,
  getAllEntrySummaries,
  getCurrentEntry,
  sealEntry,
  unsealEntry,
} from "../api/entriesApi";
import { logError } from "../utils/logError";
import { extractTags } from "../utils/extractTags";

type SavePayload = {
  entryId: string;
  content: string;
};

interface UseEntryStoreOptions {
  contentRef: MutableRefObject<string>;
  flushSave: (payload?: SavePayload) => Promise<void>;
  cancelSave: () => void;
}

export function useEntryStore({ contentRef, flushSave, cancelSave }: UseEntryStoreOptions) {
  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [allEntrySummaries, setAllEntrySummaries] = useState<EntrySummary[]>([]);
  const [isLoadingEntry, setIsLoadingEntry] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadCurrentEntry = useCallback(async () => {
    try {
      setLoadError(null);
      const [entry, entries, summaries] = await Promise.all([
        getCurrentEntry(),
        getAllEntries(),
        getAllEntrySummaries(),
      ]);
      setCurrentEntry(entry);
      setAllEntries(entries);
      setAllEntrySummaries(summaries);
      contentRef.current = entry.content;
    } catch (err) {
      logError("EntryStore", "load_current_entry", err);
      setLoadError("Could not load your current entry. Try again.");
    } finally {
      setIsLoadingEntry(false);
    }
  }, [contentRef]);

  useEffect(() => {
    void loadCurrentEntry();
  }, [loadCurrentEntry]);

  const reloadCurrentSession = useCallback(async () => {
    setIsLoadingEntry(true);
    await loadCurrentEntry();
  }, [loadCurrentEntry]);

  const flushCurrentEntrySave = useCallback(async () => {
    if (!currentEntry) return;

    await flushSave({
      entryId: currentEntry.id,
      content: contentRef.current,
    });
  }, [currentEntry, contentRef, flushSave]);

  const selectOpenEntry = useCallback(
    (entry: Entry) => {
      setCurrentEntry(entry);
      contentRef.current = entry.content;
    },
    [contentRef]
  );

  const sealCurrentEntry = useCallback(async () => {
    if (!currentEntry) return;

    try {
      await flushSave({
        entryId: currentEntry.id,
        content: contentRef.current,
      });

      const sealedContent = contentRef.current;
      const newEntry = await sealEntry(currentEntry.id, sealedContent);

      setCurrentEntry(newEntry);
      contentRef.current = newEntry.content;

      setAllEntries((prev) => {
        const sealedPrevious: Entry = {
          ...currentEntry,
          content: sealedContent,
          sealed: true,
        };

        let hasPrevious = false;
        let hasNew = false;

        const next = prev.map((item) => {
          if (item.id === sealedPrevious.id) {
            hasPrevious = true;
            return sealedPrevious;
          }

          if (item.id === newEntry.id) {
            hasNew = true;
            return newEntry;
          }

          return item;
        });

        if (!hasPrevious) {
          next.push(sealedPrevious);
        }

        if (!hasNew) {
          next.push(newEntry);
        }

        return next;
      });

      setAllEntrySummaries((prev) => {
        const sealedPreviousSummary: EntrySummary = {
          id: currentEntry.id,
          date: currentEntry.date,
          number: currentEntry.number,
          sealed: true,
          tags: extractTags(sealedContent),
        };

        const newSummary: EntrySummary = {
          id: newEntry.id,
          date: newEntry.date,
          number: newEntry.number,
          sealed: false,
          tags: [],
        };

        let hasPrevious = false;
        let hasNew = false;

        const next = prev.map((item) => {
          if (item.id === sealedPreviousSummary.id) {
            hasPrevious = true;
            return sealedPreviousSummary;
          }

          if (item.id === newSummary.id) {
            hasNew = true;
            return newSummary;
          }

          return item;
        });

        if (!hasPrevious) {
          next.push(sealedPreviousSummary);
        }

        if (!hasNew) {
          next.push(newSummary);
        }

        return next;
      });
    } catch (err) {
      logError("EntryStore", "seal_entry", err, { entryId: currentEntry.id });
    }
  }, [currentEntry, contentRef, flushSave]);

  const unsealStoredEntry = useCallback(
    async (entry: Entry) => {
      try {
        await flushCurrentEntrySave();
        await unsealEntry(entry.id);

        const reopened: Entry = {
          ...entry,
          sealed: false,
        };

        const reopenedSummary: EntrySummary = {
          id: reopened.id,
          date: reopened.date,
          number: reopened.number,
          sealed: false,
          tags: extractTags(reopened.content),
        };

        setAllEntries((prev) => prev.map((item) => (item.id === entry.id ? reopened : item)));
        setAllEntrySummaries((prev) =>
          prev.map((item) => (item.id === entry.id ? reopenedSummary : item))
        );
        setCurrentEntry(reopened);
        contentRef.current = reopened.content;
      } catch (err) {
        logError("EntryStore", "unseal_entry", err, { entryId: entry.id });
      }
    },
    [contentRef, flushCurrentEntrySave]
  );

  const deleteStoredEntry = useCallback(
    async (entry: Entry) => {
      try {
        if (currentEntry?.id === entry.id) {
          cancelSave();
        }

        await deleteEntry(entry.id);
        await loadCurrentEntry();
      } catch (err) {
        logError("EntryStore", "delete_entry", err, { entryId: entry.id });
      }
    },
    [cancelSave, currentEntry?.id, loadCurrentEntry]
  );

  return {
    currentEntry,
    allEntries,
    allEntrySummaries,
    isLoadingEntry,
    loadError,
    reloadCurrentSession,
    flushCurrentEntrySave,
    selectOpenEntry,
    sealCurrentEntry,
    unsealStoredEntry,
    deleteStoredEntry,
  };
}
