import type { Monster } from "../models/monster";

/** Numeric value of a challenge rating string ("1/4" → 0.25). NaN if unreadable. */
export function crValue(cr: string): number {
  const text = cr.trim();
  if (/^\d+\/\d+$/.test(text)) {
    const [n, d] = text.split("/").map(Number);
    return d > 0 ? n / d : NaN;
  }
  return text !== "" && Number.isFinite(Number(text)) ? Number(text) : NaN;
}

export const isCustom = (m: Monster) => m.source.type === "homebrew";

/** Clamp a number input's value to a whole number in range. */
export function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && value.trim() !== "" ? Math.min(max, Math.max(min, n)) : fallback;
}
