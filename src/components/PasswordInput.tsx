interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Shown as plain text when true. */
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
  placeholder?: string;
  disabled?: boolean;
  onEnter?: () => void;
}

/** A password box with an eye button inside it that shows or hides what's typed. */
export default function PasswordInput({ value, onChange, visible, onToggle, autoComplete, placeholder, disabled, onEnter }: Props) {
  return <span className="password-field">
    <input type={visible ? "text" : "password"} value={value} autoComplete={autoComplete} placeholder={placeholder} disabled={disabled}
      spellCheck={false} autoCapitalize="off" autoCorrect="off"
      onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && onEnter) onEnter(); }} />
    <button type="button" className="eye" disabled={disabled} aria-label={visible ? "Hide password" : "Show password"} title={visible ? "Hide password" : "Show password"}
      aria-pressed={visible} onClick={onToggle}>
      {visible
        ? <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.1A9.7 9.7 0 0 1 12 5c6 0 10 7 10 7a17.6 17.6 0 0 1-3.2 3.9M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.4 9.4 0 0 0 5.4-1.6" /></svg>
        : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>}
    </button>
  </span>;
}
