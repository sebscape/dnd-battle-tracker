import { useCallback, useEffect, useRef, useState } from "react";
import type { Battle } from "../models/combat";
import { isBattle } from "../models/combat";
import { endBattle } from "./combat";

const ACTIVE_KEY = "dnd-battle-tracker-active-v1";
export const HISTORY_KEY = "dnd-battle-tracker-history-v1";
const UNDO_LIMIT = 30;      // kept in memory
const UNDO_SAVED = 10;      // kept across a refresh
const HISTORY_LIMIT = 30;

interface Stored { battle: Battle | null; undo: Battle[] }

function load(): Stored {
  try {
    const data = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? "null") as Partial<Stored> | null;
    if (data && isBattle(data.battle)) return { battle: data.battle, undo: Array.isArray(data.undo) ? data.undo.filter(isBattle) : [] };
  } catch { /* start fresh */ }
  return { battle: null, undo: [] };
}

export function loadHistory(): Battle[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(data) ? data.filter(isBattle) : [];
  } catch { return []; }
}

/** The battle in progress, saved after every change, with step-by-step undo. */
export function useBattle() {
  const [state, setState] = useState<Stored>(load);
  const [error, setError] = useState("");
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({ battle: state.battle, undo: state.undo.slice(-UNDO_SAVED) }));
      setError("");
    } catch { setError("Saving the battle failed. This browser's storage may be full."); }
  }, [state]);

  /** Applies a change; the previous state can be restored with undo. */
  const apply = useCallback((change: (b: Battle) => Battle) => {
    setState(s => {
      if (!s.battle) return s;
      const next = change(s.battle);
      return next === s.battle ? s : { battle: next, undo: [...s.undo, s.battle].slice(-UNDO_LIMIT) };
    });
  }, []);

  const undo = useCallback(() => setState(s => s.undo.length ? { battle: s.undo[s.undo.length - 1], undo: s.undo.slice(0, -1) } : s), []);
  const start = useCallback((battle: Battle) => setState({ battle, undo: [] }), []);

  // Latest state for event handlers; side effects stay out of state updaters
  // (React may run updaters twice in development).
  const current = useRef(state);
  current.current = state;

  /** Ends the battle and moves it to history. */
  const finish = useCallback(() => {
    const battle = current.current.battle;
    if (!battle) return;
    const ended = endBattle(battle);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify([...loadHistory(), ended].slice(-HISTORY_LIMIT))); }
    catch { setError("The finished battle couldn't be saved to history."); }
    setState({ battle: null, undo: [] });
  }, []);

  return { battle: state.battle, canUndo: state.undo.length > 0, apply, undo, start, finish, error };
}
