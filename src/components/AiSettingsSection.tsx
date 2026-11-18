import { useState } from "react";
import { AI_DEFAULTS, DEFAULT_INSTRUCTIONS, MAX_INSTRUCTIONS, MODEL_PATTERN, SUGGESTED_MODELS, saveAiSettings, useAiSettings } from "../lib/aiEncounter";
import { MIN_PASSWORD, removeToken, saveToken, useCredentials } from "../lib/credentials";
import { CredentialStatus } from "./AiGenerate";
import PasswordInput from "./PasswordInput";

/**
 * Settings → AI Encounter Generation: this app's own OpenAI API token (same workflow
 * as Critter Codex's App Configuration), the model and the default instructions.
 */
export default function AiSettingsSection() {
  const saved = useAiSettings();
  const cred = useCredentials();
  const hasToken = cred.status !== "missing";
  const [instructions, setInstructions] = useState(saved.instructions);
  const [model, setModel] = useState(saved.model);
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [replaceToken, setReplaceToken] = useState(false);
  // Eye button: while the password is shown, the confirmation box is hidden and not needed.
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const enteringToken = replaceToken || (!hasToken && !!(token || password || confirmation));
  const settingsDirty = instructions !== saved.instructions || model.trim() !== saved.model;
  const dirty = settingsDirty || enteringToken;
  const modelOk = MODEL_PATTERN.test(model.trim());
  const instructionsOk = !!instructions.trim() && instructions.length <= MAX_INSTRUCTIONS;
  const clearTokenFields = () => { setToken(""); setPassword(""); setConfirmation(""); setReplaceToken(false); setShowPassword(false); };

  async function save() {
    if (saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      if (enteringToken) await saveToken(token, password, showPassword ? password : confirmation);
      if (settingsDirty) saveAiSettings({ instructions, model: model.trim() });
      setModel(model.trim());
      clearTokenFields();
      setMessage("AI settings saved in this browser. " + (enteringToken ? "API token stored encrypted." : hasToken ? "" : "No API token configured."));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the AI settings. This browser's storage may be full or blocked.");
    } finally { setSaving(false); }
  }
  function remove() {
    if (!window.confirm("Remove the saved encrypted API token? You will need to enter it again to generate encounters.")) return;
    try { removeToken(); clearTokenFields(); setMessage("Encrypted API token removed."); setError(""); }
    catch { setError("Could not remove the encrypted token."); }
  }

  return <section className="ai-settings" aria-labelledby="ai-settings-heading">
    <h2 id="ai-settings-heading">AI Encounter Generation</h2>
    <p className="muted">"Generate with AI $" on the Encounters tab sends your situation, the selected party and a compact list of your monsters to OpenAI with these instructions,
      using your own OpenAI API token. Requests are sent only when you press that button, and each one is charged to your OpenAI account.</p>

    <h3>OpenAI API token</h3>
    {hasToken && !replaceToken ? <>
      <div className="token-fields">
        <label>API Token<input type="password" value="************" readOnly aria-label="API Token saved (masked placeholder)" title="Encrypted token saved; displayed bullets are placeholders" /></label>
        <label>Encryption password<input type="password" value="************" readOnly aria-label="Encryption password configured (masked placeholder)" title="Password is not stored; displayed bullets are placeholders" /></label>
        <label>Confirm encryption password<input type="password" value="************" readOnly aria-label="Encryption password confirmation (masked placeholder)" title="Password is not stored; displayed bullets are placeholders" /></label>
      </div>
      <div className="actions-left">
        <button type="button" onClick={() => { setReplaceToken(true); setMessage(""); setError(""); }}>Replace API token / reset password</button>
        <button type="button" className="danger" onClick={remove}>Remove token</button>
      </div>
    </> : <>
      <div className="token-fields">
        <label>{hasToken ? "Replacement API Token" : "API Token"}<input type="password" autoComplete="off" spellCheck={false} value={token} placeholder="Enter API token" onChange={e => { setToken(e.target.value); setMessage(""); }} /></label>
        <label>Encryption password ({MIN_PASSWORD}+ characters)
          <PasswordInput value={password} visible={showPassword} onToggle={() => setShowPassword(v => !v)} autoComplete="new-password" placeholder="Enter encryption password" onChange={v => { setPassword(v); setMessage(""); }} /></label>
        {!showPassword && <label>Confirm encryption password
          <PasswordInput value={confirmation} visible={false} onToggle={() => setShowPassword(true)} autoComplete="new-password" placeholder="Confirm encryption password" onChange={v => { setConfirmation(v); setMessage(""); }} /></label>}
      </div>
      {replaceToken && <div className="actions-left"><button type="button" onClick={clearTokenFields}>Cancel token replacement</button></div>}
    </>}
    <p className="small-text"><CredentialStatus /></p>
    <p className="muted small-text">The token is encrypted with AES-256-GCM before being saved in this browser. Your encryption password is never saved. If forgotten, replace the token and choose a new password.
      Encryption protects stored data, but cannot protect an unlocked token from malicious scripts. An unlocked token is sent to Scrap Sheet's Netlify Function, over HTTPS, only when you generate an encounter; it is not stored there.
      This token is separate from Critter Codex's: each app has its own, so either works without the other. You may use the same OpenAI token in both.</p>

    <h3>Model and instructions</h3>
    <label>Model
      <input list="ai-models" value={model} spellCheck={false} onChange={e => { setModel(e.target.value); setMessage(""); }} aria-invalid={!modelOk} />
      <datalist id="ai-models">{SUGGESTED_MODELS.map(m => <option key={m} value={m} />)}</datalist>
    </label>
    <p className="muted small-text">Any OpenAI text model that supports structured JSON output. Requests run in the background on Netlify, so slower models are fine (up to 5 minutes). Default: {AI_DEFAULTS.model}.</p>
    <label>Default Encounter Instructions
      <textarea className="instructions" value={instructions} onChange={e => { setInstructions(e.target.value); setMessage(""); }} aria-invalid={!instructionsOk} />
    </label>
    <p className="muted small-text">{instructions.length.toLocaleString("en-US")} / {MAX_INSTRUCTIONS.toLocaleString("en-US")} characters. The app always asks for JSON in a fixed format and only accepts monsters from your catalog, whatever these instructions say.</p>
    <div className="actions-left">
      <button type="button" className="primary" disabled={saving || !dirty || !modelOk || !instructionsOk} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
      <button type="button" disabled={!settingsDirty} onClick={() => { setInstructions(saved.instructions); setModel(saved.model); setMessage("Changes discarded."); }}>Discard changes</button>
      <button type="button" disabled={instructions === DEFAULT_INSTRUCTIONS && model === AI_DEFAULTS.model} onClick={() => { setInstructions(DEFAULT_INSTRUCTIONS); setModel(AI_DEFAULTS.model); setMessage("Defaults restored — choose Save to keep them."); }}>Restore Default</button>
      <span className="small-text" role="status">{message || (dirty ? "Not saved yet." : "")}</span>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
