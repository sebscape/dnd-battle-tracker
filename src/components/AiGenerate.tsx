import { useEffect, useRef, useState } from "react";
import type { Encounter, PartyMember } from "../models/battle";
import type { Monster } from "../models/monster";
import type { AiEncounter, Conversation, TargetDifficulty, ValidPick } from "../lib/aiEncounter";
import { AiError, MAX_SITUATION, OUTCOME_LABEL, buildRequest, fieldsToReplace, requestEncounter, setLatestConversation, toEncounterPatch, useAiSettings, useLatestConversation, validateAiEncounter } from "../lib/aiEncounter";
import { IncorrectPasswordError, NoTokenError, getToken, lock, reportOpenAiResult, unlock, useCredentials } from "../lib/credentials";
import { encounterDifficulty } from "../lib/difficulty";
import PasswordInput from "./PasswordInput";
import MonsterDetails from "./MonsterDetails";
import ConversationDialog from "./ConversationDialog";

interface Props {
  encounter: Encounter;
  /** Party members selected for this encounter. */
  party: PartyMember[];
  monsters: Monster[];
  byId: ReadonlyMap<string, Monster>;
  /** Approved artwork by monster ID, for stat blocks in the review. */
  artwork?: Record<string, string>;
  catalogReady: boolean;
  onChange: (patch: Partial<Encounter>) => void;
}

type Phase =
  | { at: "idle" }
  | { at: "working"; step: "unlocking" | "generating" }
  | { at: "review"; result: AiEncounter; picks: ValidPick[] }
  | { at: "error"; message: string; answer?: string };

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
export default function AiGenerate({ encounter, party, monsters, byId, artwork, catalogReady, onChange }: Props) {
  const settings = useAiSettings();
  const cred = useCredentials();
  const [difficulty, setDifficulty] = useState<TargetDifficulty>("moderate");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [notice, setNotice] = useState("");
  // The request in flight. Anything that arrives after Cancel, a newer request or
  // closing this encounter is ignored.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);
  // The latest conversation with the AI (shown by the spyglass), shared by all encounters.
  const conversation = useLatestConversation();
  const [showConversation, setShowConversation] = useState(false);
  const convoRef = useRef<Conversation | null>(null);
  const record = (patch: Partial<Conversation>) => {
    if (!convoRef.current) return;
    convoRef.current = { ...convoRef.current, ...patch, finishedAt: patch.outcome && patch.outcome !== "waiting" ? new Date().toISOString() : convoRef.current.finishedAt };
    setLatestConversation(convoRef.current);
  };

  const locked = cred.status !== "unlocked";
  const situation = encounter.situation ?? "";
  const working = phase.at === "working";

  async function generate() {
    setNotice("");
    const built = buildRequest({ settings, situation, party: party.map(p => ({ name: p.name, level: p.level })), difficulty, environment: encounter.environment, monsters });
    if ("error" in built) { setPhase({ at: "error", message: built.error }); return; }
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
      const r = built.request;
      convoRef.current = { startedAt: new Date().toISOString(), outcome: "waiting",
        request: { model: r.model, difficulty: r.difficulty, environment: r.environment, situation: r.situation, party: r.party, catalogSize: r.catalog.length, instructions: r.instructions } };
      setLatestConversation(convoRef.current);
      const { encounter: raw, exchange } = await requestEncounter(built.request, token, controller.signal);
      if (!current()) return;
      reportOpenAiResult(true);
      const v = validateAiEncounter(raw, byId);
      if (!v.ok) {
        record({ outcome: "rejected", exchange, problems: v.errors, error: "The AI's answer couldn't be used." });
        setPhase({ at: "error", message: "The AI's answer couldn't be used: " + v.errors.join(" "), answer: JSON.stringify(raw, null, 2) });
        return;
      }
      record({ outcome: "received", exchange });
      setPhase({ at: "review", result: v.encounter, picks: v.picks });
    } catch (e) {
      if (!current()) return;
      if (e instanceof AiError && e.code === "canceled") return;
      if (e instanceof AiError && e.code === "invalid_token") reportOpenAiResult(false);
      // OpenAI answered (even if the answer was unusable), so it accepted the token.
      if (e instanceof AiError && (e.code === "invalid_response" || e.code === "refused")) reportOpenAiResult(true);
      const message = e instanceof IncorrectPasswordError || e instanceof NoTokenError || e instanceof AiError ? e.message : "Something went wrong. Try again.";
      // Only requests that were sent are conversations; a wrong password never reaches the AI.
      if (e instanceof AiError) record(e.code === "invalid_response"
        ? { outcome: "rejected", exchange: e.exchange, problems: [message], error: "The AI's answer couldn't be used." }
        : { outcome: "error", exchange: e.exchange, error: message });
      // A wrong password made no paid request; asking again is free.
      setPhase({ at: "error", message: e instanceof AiError && e.code === "invalid_response" ? "The AI's answer couldn't be used: " + message : message, answer: e instanceof AiError ? e.answer : undefined });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  function cancel() {
    if (phase.at === "working" && phase.step === "generating") record({ outcome: "canceled", error: "Canceled while waiting. Any later answer was ignored." });
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
    <div className="situation-tools">
      <button type="button" className="icon-button small-icon" disabled={!conversation} onClick={() => setShowConversation(true)}
        aria-label="View the latest AI conversation" title={conversation ? "View the latest AI conversation: the prompt sent, the AI's reply and any errors" : "No AI conversation yet"}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14.5 15 8.5l2 4-12 6z" /><path d="M15 8.5 19.5 6.3l2 4L17 12.5" /><path d="M9 17l-3 5M11 16l3 6" /><path d="M2.4 13.3l2 4" /></svg>
      </button>
      {conversation && <span className="muted small-text">{conversation.outcome === "waiting" ? "Waiting for the AI…" : "Last AI conversation: " + OUTCOME_LABEL[conversation.outcome]}</span>}
    </div>
    {showConversation && conversation && <ConversationDialog conversation={conversation} onClose={() => setShowConversation(false)} />}
    <div className="ai-row">
      <label>Difficulty<select value={difficulty} disabled={working} onChange={e => setDifficulty(e.target.value as TargetDifficulty)}>
        <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
      {locked && cred.status !== "missing" && <label className="grow">Encryption password (unlocks your API token)
        <PasswordInput value={password} visible={showPassword} onToggle={() => setShowPassword(v => !v)} autoComplete="current-password" disabled={working}
          onChange={setPassword} onEnter={() => { if (canGenerate) void generate(); }} /></label>}
    </div>
    <div className="auto-actions">
      <button type="button" className="primary" disabled={!canGenerate} title={why || "Sends the situation, party and monster list to OpenAI. Each request is charged to your OpenAI account."} onClick={() => void generate()}>Generate with AI $</button>
      {working && <button type="button" onClick={cancel}>Cancel</button>}
      <CredentialStatus />
    </div>
    <p className="muted small-text">
      {why ? why + " " : ""}Uses your instructions and model from Settings, the gear button ({settings.model}){encounter.environment ? ", the " + encounter.environment + " environment" : ""} and the monsters in your catalog. Nothing changes until you choose Use This Encounter.
    </p>
    {working && <p className="ai-progress" role="status"><span className="spinner" aria-hidden="true" />{phase.step === "unlocking" ? "Unlocking the API token…" : "Asking OpenAI for an encounter… this usually takes 10–30 seconds."}</p>}
    {notice && <p className="small-text" role="status">{notice}</p>}
    {phase.at === "error" && <div className="ai-error" role="alert">
      <p className="error">{phase.message}</p>
      {phase.answer && <details className="ai-answer"><summary>Show the AI's answer</summary><pre>{phase.answer}</pre></details>}
    </div>}
    {phase.at === "review" && <Review result={phase.result} picks={phase.picks} party={party} target={difficulty} artwork={artwork ?? {}}
      onUse={() => use(phase.result, phase.picks)} onRegenerate={regenerate}
      onCancel={() => { setPhase({ at: "idle" }); setNotice("Generated encounter discarded."); }} />}
  </div>;
}

function Review({ result, picks, party, target, artwork, onUse, onRegenerate, onCancel }: {
  result: AiEncounter; picks: ValidPick[]; party: PartyMember[]; target: TargetDifficulty; artwork: Record<string, string>;
  onUse: () => void; onRegenerate: () => void; onCancel: () => void;
}) {
  // One stat block open at a time.
  const [open, setOpen] = useState<string | null>(null);
  const diff = encounterDifficulty(party.map(p => p.level), picks.map(p => ({ name: p.monster.name, cr: p.monster.challenge_rating, count: p.count })));
  const tooHard = diff && RATING_ORDER.indexOf(diff.rating) > RATING_ORDER.indexOf(target);
  return <section className="ai-review" aria-label="Generated encounter for review">
    <h4>{result.encounter_name}</h4>
    <ul className="ai-monsters">{picks.map(p => <li key={p.monster.id} className={open === p.monster.id ? "expanded" : ""}>
      <button type="button" className="monster-toggle" aria-expanded={open === p.monster.id} title={open === p.monster.id ? "Hide stat block" : "Show stat block"}
        onClick={() => setOpen(o => o === p.monster.id ? null : p.monster.id)}>
        <strong>{p.count} × {p.monster.name}</strong><small>CR {p.monster.challenge_rating} · {p.monster.size} {p.monster.type}</small>
      </button>
      {open === p.monster.id && <MonsterDetails monster={p.monster} artwork={artwork[p.monster.id]} />}
    </li>)}</ul>
    <p className="muted small-text">Click a creature for its stat block. Every person or creature in the encounter is listed here, hostile or not, in case the characters attack.</p>
    {diff && <p>Difficulty: <span className={"rating " + diff.rating}>{diff.rating === "beyond" ? "Beyond High" : diff.rating[0].toUpperCase() + diff.rating.slice(1)}</span>
      <span className="muted"> · {diff.totalXp.toLocaleString("en-US")} XP (target: {target}, budget {diff.budget[target].toLocaleString("en-US")} XP)</span></p>}
    {tooHard && <p className="warn-text" role="alert">This is harder than the {target} difficulty you asked for.</p>}
    <h5>Read-aloud</h5><p className="read-aloud">{result.read_aloud}</p>
    <h5>Motivation</h5><p>{result.motivation}</p>
    {result.avoiding_combat.length > 0 && <><h5>Ways to avoid combat</h5>
      <ul className="ai-options">{result.avoiding_combat.map((o, i) => <li key={i}><strong>{o.action}</strong> — {o.check && o.dc ? o.check + ", DC " + o.dc : "no check needed"}
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
