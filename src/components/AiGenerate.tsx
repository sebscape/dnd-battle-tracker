import { useEffect, useRef, useState } from "react";
import type { Encounter, PartyMember } from "../models/battle";
import type { Monster } from "../models/monster";
import type { AiEncounter, TargetDifficulty, ValidPick } from "../lib/aiEncounter";
import { AiError, MAX_SITUATION, buildRequest, fieldsToReplace, requestEncounter, toEncounterPatch, useAiSettings, validateAiEncounter } from "../lib/aiEncounter";
import { IncorrectPasswordError, NoTokenError, getToken, lock, reportOpenAiResult, unlock, useCredentials } from "../lib/credentials";
import { encounterDifficulty } from "../lib/difficulty";

interface Props {
  encounter: Encounter;
  /** Party members selected for this encounter. */
  party: PartyMember[];
  monsters: Monster[];
  byId: ReadonlyMap<string, Monster>;
  catalogReady: boolean;
  onChange: (patch: Partial<Encounter>) => void;
}

type Phase =
  | { at: "idle" }
  | { at: "working"; step: "unlocking" | "generating" }
  | { at: "review"; result: AiEncounter; picks: ValidPick[] }
  | { at: "error"; message: string; canRetry: boolean };

const RATING_ORDER = ["none", "low", "moderate", "high", "beyond"] as const;
const DEFAULT_NAME = /^Encounter \d+$/;

/** Credential status in plain words. */
export function CredentialStatus() {
  const cred = useCredentials();
  const text = cred.status === "unlocked"
    ? cred.openai === "accepted" ? "API token unlocked · accepted by OpenAI"
      : cred.openai === "rejected" ? "API token unlocked, but OpenAI rejected it"
      : "API token unlocked · not yet checked with OpenAI"
    : cred.status === "locked" ? "API token locked"
    : "No API token saved — add one in Settings → AI Encounter Generation";
  return <span className={"cred-status " + cred.status + (cred.status === "unlocked" ? " " + cred.openai : "")} role="status">
    {text}
    {cred.status === "unlocked" && <button type="button" className="small" onClick={lock}>Lock</button>}
  </span>;
}

/** "Generate with AI $": describe the situation, review the result, then apply it. */
export default function AiGenerate({ encounter, party, monsters, byId, catalogReady, onChange }: Props) {
  const settings = useAiSettings();
  const cred = useCredentials();
  const [difficulty, setDifficulty] = useState<TargetDifficulty>("moderate");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [notice, setNotice] = useState("");
  // The request in flight. Anything that arrives after Cancel, a newer request or
  // closing this encounter is ignored.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const locked = cred.status !== "unlocked";
  const situation = encounter.situation ?? "";
  const working = phase.at === "working";

  async function generate() {
    setNotice("");
    const built = buildRequest({ settings, situation, party: party.map(p => ({ name: p.name, level: p.level })), difficulty, environment: encounter.environment, monsters });
    if ("error" in built) { setPhase({ at: "error", message: built.error, canRetry: false }); return; }
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const current = () => inFlight.current === controller && !controller.signal.aborted;
    try {
      if (!getToken()) {
        setPhase({ at: "working", step: "unlocking" });
        await unlock(password);
        if (!current()) return;
        setPassword("");
      }
      const token = getToken();
      if (!token) throw new IncorrectPasswordError();
      setPhase({ at: "working", step: "generating" });
      const raw = await requestEncounter(built.request, token, controller.signal);
      if (!current()) return;
      reportOpenAiResult(true);
      const v = validateAiEncounter(raw, byId);
      if (!v.ok) { setPhase({ at: "error", message: "The AI's answer couldn't be used: " + v.errors.join(" "), canRetry: true }); return; }
      setPhase({ at: "review", result: v.encounter, picks: v.picks });
    } catch (e) {
      if (!current()) return;
      if (e instanceof AiError && e.code === "canceled") return;
      if (e instanceof AiError && e.code === "invalid_token") reportOpenAiResult(false);
      const message = e instanceof IncorrectPasswordError || e instanceof NoTokenError || e instanceof AiError ? e.message : "Something went wrong. Try again.";
      // A wrong password made no paid request; asking again is free.
      setPhase({ at: "error", message, canRetry: e instanceof AiError && !["invalid_token", "unsupported_model", "insufficient_quota", "bad_request"].includes(e.code) });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  function cancel() {
    inFlight.current?.abort();
    inFlight.current = null;
    setPhase({ at: "idle" });
    setNotice("Canceled. If the request had already reached OpenAI, it may still finish there and be charged; its result will be ignored.");
  }

  function regenerate() {
    if (!window.confirm("Generate a new encounter? This makes another paid OpenAI request.")) return;
    void generate();
  }

  function use(result: AiEncounter, picks: ValidPick[]) {
    const replacing = fieldsToReplace(encounter);
    if (encounter.name.trim() && !DEFAULT_NAME.test(encounter.name.trim())) replacing.unshift("name");
    if (replacing.length && !window.confirm("Replace this encounter's " + replacing.join(", ") + " with the generated ones? The party, environment, notes and situation are kept.")) return;
    onChange(toEncounterPatch(result, picks));
    setPhase({ at: "idle" });
    setNotice("Encounter filled in. Everything below can still be edited.");
  }

  const canGenerate = !working && catalogReady && party.length > 0 && !!situation.trim() && (!locked || !!password) && cred.status !== "missing";
  const why = !catalogReady ? "Loading monsters (checking Critter Codex for custom monsters, a few seconds at most)."
    : party.length === 0 ? "Select party members above first — the encounter is sized to them."
    : !situation.trim() ? "Describe the situation first."
    : cred.status === "missing" ? "Add an OpenAI API token in Settings → AI Encounter Generation first."
    : locked && !password ? "Enter your encryption password to unlock your API token." : "";

  return <div className="auto-generate ai-generate" aria-busy={working}>
    <label>Encounter Situation
      <textarea className="situation" value={situation} maxLength={MAX_SITUATION} disabled={working}
        placeholder="e.g. The party is traveling down a road surrounded by woods. They are making camp for the night. I rolled a random monster encounter."
        onChange={e => onChange({ situation: e.target.value || undefined })} />
    </label>
    <div className="ai-row">
      <label>Difficulty<select value={difficulty} disabled={working} onChange={e => setDifficulty(e.target.value as TargetDifficulty)}>
        <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
      {locked && cred.status !== "missing" && <label className="grow">Encryption password (unlocks your API token)
        <input type="password" autoComplete="current-password" value={password} disabled={working}
          onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && canGenerate) void generate(); }} /></label>}
    </div>
    <div className="auto-actions">
      <button type="button" className="primary" disabled={!canGenerate} title={why || "Sends the situation, party and monster list to OpenAI. Each request is charged to your OpenAI account."} onClick={() => void generate()}>Generate with AI $</button>
      {working && <button type="button" onClick={cancel}>Cancel</button>}
      <CredentialStatus />
    </div>
    <p className="muted small-text">
      {why ? why + " " : ""}Uses your instructions and model from Settings ({settings.model}){encounter.environment ? ", the " + encounter.environment + " environment" : ""} and the monsters in your catalog. Nothing changes until you choose Use This Encounter.
    </p>
    {working && <p className="ai-progress" role="status"><span className="spinner" aria-hidden="true" />{phase.step === "unlocking" ? "Unlocking the API token…" : "Asking OpenAI for an encounter… this usually takes 10–30 seconds."}</p>}
    {notice && <p className="small-text" role="status">{notice}</p>}
    {phase.at === "error" && <div className="ai-error" role="alert">
      <p className="error">{phase.message}</p>
      {phase.canRetry && <button type="button" className="small" onClick={regenerate}>Try again ($)</button>}
    </div>}
    {phase.at === "review" && <Review result={phase.result} picks={phase.picks} party={party} target={difficulty}
      onUse={() => use(phase.result, phase.picks)} onRegenerate={regenerate}
      onCancel={() => { setPhase({ at: "idle" }); setNotice("Generated encounter discarded."); }} />}
  </div>;
}

function Review({ result, picks, party, target, onUse, onRegenerate, onCancel }: {
  result: AiEncounter; picks: ValidPick[]; party: PartyMember[]; target: TargetDifficulty;
  onUse: () => void; onRegenerate: () => void; onCancel: () => void;
}) {
  const diff = encounterDifficulty(party.map(p => p.level), picks.map(p => ({ name: p.monster.name, cr: p.monster.challenge_rating, count: p.count })));
  const tooHard = diff && RATING_ORDER.indexOf(diff.rating) > RATING_ORDER.indexOf(target);
  return <section className="ai-review" aria-label="Generated encounter for review">
    <h4>{result.encounter_name}</h4>
    <ul className="ai-monsters">{picks.map(p => <li key={p.monster.id}><strong>{p.count} × {p.monster.name}</strong> <small className="muted">CR {p.monster.challenge_rating} · {p.monster.size} {p.monster.type}</small></li>)}</ul>
    {diff && <p>Difficulty: <span className={"rating " + diff.rating}>{diff.rating === "beyond" ? "Beyond High" : diff.rating[0].toUpperCase() + diff.rating.slice(1)}</span>
      <span className="muted"> · {diff.totalXp.toLocaleString("en-US")} XP (target: {target}, budget {diff.budget[target].toLocaleString("en-US")} XP)</span></p>}
    {tooHard && <p className="warn-text" role="alert">This is harder than the {target} difficulty you asked for.</p>}
    <h5>Read-aloud</h5><p className="read-aloud">{result.read_aloud}</p>
    <h5>Motivation</h5><p>{result.motivation}</p>
    {result.avoiding_combat.length > 0 && <><h5>Ways to avoid combat</h5>
      <ul className="ai-options">{result.avoiding_combat.map((o, i) => <li key={i}><strong>{o.action}</strong> — {o.check}, DC {o.dc}
        <br /><span className="muted">Success:</span> {o.success}<br /><span className="muted">Failure:</span> {o.failure}</li>)}</ul></>}
    <h5>DM tactics</h5><p>{result.dm_tactics}</p>
    <h5>Treasure</h5><p>{result.treasure || "None."}</p>
    <div className="actions-left">
      <button type="button" className="primary" onClick={onUse}>Use This Encounter</button>
      <button type="button" onClick={onRegenerate} title="Makes another paid OpenAI request">Regenerate ($)</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}
