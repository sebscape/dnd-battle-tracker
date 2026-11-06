import { useEffect, useRef, useState } from "react";

export const PARTY_KEY = "dnd-battle-tracker-party-v1";
export const ENCOUNTERS_KEY = "dnd-battle-tracker-encounters-v1";

/** Reads a list from localStorage, keeping only records that pass the guard. */
export function loadList<T>(key: string, guard: (v: unknown) => v is T): T[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(data) ? data.filter(guard) : [];
  } catch {
    return [];
  }
}

/** A list kept in localStorage. Returns [items, setItems, saveError]. */
export function useStoredList<T>(key: string, guard: (v: unknown) => v is T) {
  const [items, setItems] = useState<T[]>(() => loadList(key, guard));
  const [error, setError] = useState("");
  const first = useRef(true);
  useEffect(() => {
    // Skip the initial render so a failed read is never written back as an empty list.
    if (first.current) { first.current = false; return; }
    try { localStorage.setItem(key, JSON.stringify(items)); setError(""); }
    catch { setError("Saving failed. This browser's storage may be full or blocked."); }
  }, [key, items]);
  return [items, setItems, error] as const;
}
