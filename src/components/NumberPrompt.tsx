import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export interface PromptRequest { title: string; min: number; max: number; resolve: (value: number | null) => void }

/** Modal asking for one whole number, used when the DM rolls physical dice. */
export default function NumberPrompt({ request }: { request: PromptRequest }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(n) && n >= request.min && n <= request.max;
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid) request.resolve(n); };
  return <div className="modal-backdrop" onClick={() => request.resolve(null)}>
    <form className="modal" role="dialog" aria-modal="true" aria-label={request.title} onSubmit={submit} onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === "Escape") request.resolve(null); }}>
      <label>{request.title}
        <input ref={input} type="number" inputMode="numeric" min={request.min} max={request.max} value={value} onChange={e => setValue(e.target.value)} />
      </label>
      <p className="muted small-text">Enter a number from {request.min} to {request.max}.</p>
      <div className="actions">
        <button type="button" onClick={() => request.resolve(null)}>Cancel</button>
        <button type="submit" disabled={!valid}>Use this roll</button>
      </div>
    </form>
  </div>;
}
