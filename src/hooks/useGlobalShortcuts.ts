import { useEffect } from "react";

interface UseGlobalShortcutsOptions {
  isQuickSwitcherOpen: boolean;
  openQuickSwitcher: () => Promise<void>;
  closeQuickSwitcher: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

export function useGlobalShortcuts({
  isQuickSwitcherOpen,
  openQuickSwitcher,
  closeQuickSwitcher,
  zoomIn,
  zoomOut,
  zoomReset,
}: UseGlobalShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "k") {
        e.preventDefault();

        if (isQuickSwitcherOpen) {
          closeQuickSwitcher();
          return;
        }

        void openQuickSwitcher();
        return;
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
        return;
      }

      if (e.key === "-") {
        e.preventDefault();
        zoomOut();
        return;
      }

      if (e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    closeQuickSwitcher,
    isQuickSwitcherOpen,
    openQuickSwitcher,
    zoomIn,
    zoomOut,
    zoomReset,
  ]);
}
