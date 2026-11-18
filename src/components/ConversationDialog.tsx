import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../lib/aiEncounter";
import { OUTCOME_LABEL } from "../lib/aiEncounter";

const pretty = (text?: string) => {
  if (!text) return text;
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};
const time = (iso?: string) => iso ? new Date(iso).toLocaleTimeString() : "";

/** Plain-text version of the conversation, for Copy. */
export function conversationText(c: Conversation): string {
  const x = c.exchange;
  return [
    "AI conversation — " + OUTCOME_LABEL[c.outcome] + " — started " + c.startedAt + (c.finishedAt ? ", finished " + c.finishedAt : ""),
    "Model: " + c.request.model + " · Difficulty: " + c.request.difficulty + " · Environment: " + (c.request.environment || "any") + " · Monsters offered: " + c.request.catalogSize,
    "Party: " + c.request.party.map(p => p.name + " (level " + p.level + ")").join(", "),
    "", "=== Instructions ===", x?.instructions ?? c.request.instructions,
    "", "=== Prompt sent ===", x?.input ?? "(The server didn't answer, so the full prompt isn't available. Situation: " + c.request.situation + ")",
    "", "=== AI reply ===", x?.refusal ? "Refused: " + x.refusal : pretty(x?.output) ?? (x?.openai_error ? "OpenAI error (HTTP " + x.openai_status + "): " + x.openai_error : "(no reply)"),
    ...(x?.usage ? ["", "Tokens: " + (x.usage.input_tokens ?? "?") + " in, " + (x.usage.output_tokens ?? "?") + " out"] : []),
    ...(c.error || c.problems?.length ? ["", "=== Errors ===", ...(c.error ? [c.error] : []), ...(c.problems ?? [])] : []),
  ].join("\n");
}

/** The spyglass view: the latest request to the AI and everything that came back. */
export default function ConversationDialog({ conversation: c, onClose }: { conversation: Conversation; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const [copied, setCopied] = useState("");
  useEffect(() => { closeButton.current?.focus(); }, []);
  const x = c.exchange;
  const seconds = c.finishedAt ? ((new Date(c.finishedAt).getTime() - new Date(c.startedAt).getTime()) / 1000).toFixed(1) : null;
  async function copy() {
    try { await navigator.clipboard.writeText(conversationText(c)); setCopied("Copied."); }
    catch { setCopied("Couldn't copy: this browser blocked the clipboard."); }
  }
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal wide-modal conversation" role="dialog" aria-modal="true" aria-labelledby="convo-title" onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === "Escape") onClose(); }}>
      <h2 id="convo-title">Latest AI conversation</h2>
      <p className="small-text">
        <span className={"convo-outcome " + c.outcome}>{OUTCOME_LABEL[c.outcome]}</span>
        {" "}Started {time(c.startedAt)}{seconds ? " · took " + seconds + " s" : ""} · {c.request.model}
        {x?.usage ? " · " + (x.usage.input_tokens ?? "?").toLocaleString() + " tokens in, " + (x.usage.output_tokens ?? "?").toLocaleString() + " out" : ""}
      </p>
      <p className="small-text muted">Party: {c.request.party.map(p => p.name + " (" + p.level + ")").join(", ")} · Difficulty: {c.request.difficulty} · Environment: {c.request.environment || "any"} · {c.request.catalogSize} monsters offered</p>

      {(c.error || c.problems?.length) && <section className="convo-errors" aria-label="Errors">
        <h3>Errors</h3>
        {c.error && <p className="error">{c.error}</p>}
        {c.problems?.map((p, i) => <p key={i} className="error">{p}</p>)}
        {x?.openai_error && <p className="error">OpenAI said (HTTP {x.openai_status}): {x.openai_error}</p>}
      </section>}

      <details>
        <summary>Instructions sent ({(x?.instructions ?? c.request.instructions).length.toLocaleString()} characters)</summary>
        <pre>{x?.instructions ?? c.request.instructions}</pre>
      </details>
      <details open={!x?.output}>
        <summary>Prompt sent{x?.input ? " (" + x.input.length.toLocaleString() + " characters, including the monster list)" : ""}</summary>
        <pre>{x?.input ?? "The server didn't answer, so the full prompt isn't available here. Your situation was:\n\n" + c.request.situation}</pre>
      </details>
      <details open>
        <summary>AI reply</summary>
        <pre>{c.outcome === "waiting" ? "Waiting for the AI…"
          : x?.refusal ? "The model declined: " + x.refusal
          : pretty(x?.output) ?? "No reply was received."}</pre>
      </details>

      <div className="actions-left">
        <button type="button" onClick={() => void copy()}>Copy all</button>
        <button type="button" ref={closeButton} onClick={onClose}>Close</button>
        <span className="small-text" role="status">{copied}</span>
      </div>
    </div>
  </div>;
}
