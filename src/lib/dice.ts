// Dice notation and rolling. Stat blocks write minus as "-", "–" or "−".

export interface DiceExpr { count: number; sides: number; modifier: number }

const DICE = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+\-–−])\s*(\d+))?\s*$/i;

/** Parses "2d6 + 3", "1d4 – 1", "3d8". Returns null if unreadable. */
export function parseDice(text: string): DiceExpr | null {
  const m = DICE.exec(text);
  if (!m) return null;
  const count = Number(m[1]), sides = Number(m[2]);
  if (count < 1 || count > 100 || sides < 1 || sides > 1000) return null;
  const modifier = m[3] ? (m[3] === "+" ? 1 : -1) * Number(m[4]) : 0;
  return { count, sides, modifier };
}

export function formatDice(d: DiceExpr): string {
  return d.count + "d" + d.sides + (d.modifier ? (d.modifier > 0 ? " + " : " − ") + Math.abs(d.modifier) : "");
}

/** Uniform integer in 1..sides using the browser's cryptographic random source. */
export function rollDie(sides: number): number {
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buf = new Uint32Array(1);
  let v: number;
  do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= limit);
  return (v % sides) + 1;
}

export interface DiceRoll { expr: DiceExpr; dice: number[]; total: number; manual: boolean }

/** Rolls an expression. If `manualDiceTotal` is given, it replaces the dice (physical roll). */
export function rollDice(expr: DiceExpr, manualDiceTotal?: number): DiceRoll {
  if (manualDiceTotal !== undefined) return { expr, dice: [manualDiceTotal], total: manualDiceTotal + expr.modifier, manual: true };
  const dice = Array.from({ length: expr.count }, () => rollDie(expr.sides));
  return { expr, dice, total: dice.reduce((a, b) => a + b, 0) + expr.modifier, manual: false };
}

/** Doubles the dice for a critical hit (SRD: roll the damage dice twice). */
export const critical = (d: DiceExpr): DiceExpr => ({ ...d, count: d.count * 2 });

export type Advantage = "normal" | "advantage" | "disadvantage";

export interface D20Roll { natural: number; rolls: number[]; bonus: number; total: number; mode: Advantage; manual: boolean }

/** d20 + bonus with advantage/disadvantage. A manual value is the natural d20 the DM rolled (already chosen for adv/dis). */
export function rollD20(bonus: number, mode: Advantage = "normal", manualNatural?: number): D20Roll {
  if (manualNatural !== undefined) return { natural: manualNatural, rolls: [manualNatural], bonus, total: manualNatural + bonus, mode, manual: true };
  const rolls = mode === "normal" ? [rollDie(20)] : [rollDie(20), rollDie(20)];
  const natural = mode === "advantage" ? Math.max(...rolls) : mode === "disadvantage" ? Math.min(...rolls) : rolls[0];
  return { natural, rolls, bonus, total: natural + bonus, mode, manual: false };
}

export const signed = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n);

export function describeD20(r: D20Roll): string {
  const dice = r.manual ? "rolled " + r.natural : r.rolls.length > 1 ? "d20 " + r.rolls.join(", ") + " → " + r.natural : "d20 " + r.natural;
  return dice + " " + signed(r.bonus) + " = " + r.total + (r.natural === 20 ? " (natural 20)" : r.natural === 1 ? " (natural 1)" : "");
}

export function describeDice(r: DiceRoll): string {
  const mod = r.expr.modifier ? " " + signed(r.expr.modifier) : "";
  return (r.manual ? "rolled " + r.dice[0] : formatDice({ ...r.expr, modifier: 0 }) + " [" + r.dice.join(", ") + "]") + mod + " = " + r.total;
}
