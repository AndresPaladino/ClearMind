import { invoke } from "@tauri-apps/api/core";
import { Entry, EntrySummary } from "../types";

export async function getCurrentEntry(): Promise<Entry> {
  return invoke<Entry>("get_current_entry");
}

export async function getAllEntries(): Promise<Entry[]> {
  return invoke<Entry[]>("get_all_entries");
}

export async function getAllEntrySummaries(): Promise<EntrySummary[]> {
  return invoke<EntrySummary[]>("get_all_entry_summaries");
}

export async function saveEntry(entryId: string, content: string): Promise<boolean> {
  return invoke<boolean>("save_entry", { id: entryId, content });
}

export async function sealEntry(entryId: string, content: string): Promise<Entry> {
  return invoke<Entry>("seal_entry", { id: entryId, content });
}

export async function unsealEntry(entryId: string): Promise<boolean> {
  return invoke<boolean>("unseal_entry", { id: entryId });
}

export async function deleteEntry(entryId: string): Promise<boolean> {
  return invoke<boolean>("delete_entry", { id: entryId });
}
