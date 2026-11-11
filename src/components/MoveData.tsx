import { useState } from "react";
import type { Found } from "../lib/moveData";
import { NEW_HOST, NEW_ORIGIN, OLD_HOST, OLD_ORIGIN, OldSite, copyToThisSite, describeThisSite, readOldSite } from "../lib/moveData";

/** On the old address: says where the app moved. Elsewhere: nothing. */
export function MovedNotice() {
  if (location.origin !== OLD_ORIGIN || import.meta.env.DEV) return null;
  return <p className="moved-notice" role="status">
    <strong>This app is now Scrap Sheet.</strong> Its new address is <a href={NEW_ORIGIN + "/"}>{NEW_HOST}</a>.
    {" "}Open it and choose <em>Bring over my data</em> in Settings to copy what you saved here.
  </p>;
}

type Step = { at: "idle" } | { at: "checking" } | { at: "found"; found: Found; here: string[] } | { at: "copying"; done: number; total: number } | { at: "done" } | { at: "error"; message: string };

/** On the new address: copies everything saved at the old address into this one. */
export default function MoveData() {
  const [step, setStep] = useState<Step>({ at: "idle" });
  const [site, setSite] = useState<OldSite | null>(null);
  if (location.origin === OLD_ORIGIN) return null;

  async function check() {
    setStep({ at: "checking" });
    try {
      const s = site ?? await OldSite.connect();
      setSite(s);
      setStep({ at: "found", found: await readOldSite(s), here: await describeThisSite() });
    } catch (e) { setStep({ at: "error", message: e instanceof Error ? e.message : String(e) }); }
  }
  async function copy(found: Found) {
    if (!site) return;
    setStep({ at: "copying", done: 0, total: 1 });
    try {
      await copyToThisSite(site, found, (done, total) => setStep({ at: "copying", done, total }));
      site.close(); setSite(null); setStep({ at: "done" });
    } catch (e) { setStep({ at: "error", message: "Copying stopped: " + (e instanceof Error ? e.message : String(e)) + " Nothing at the old address was changed; you can try again." }); }
  }

  return <fieldset className="move-data">
    <legend>Bring over my data from {OLD_HOST}</legend>
    <p className="muted">Scrap Sheet used to live at {OLD_HOST}. What you saved there stays in this browser under that address. This copies it here; nothing at the old address is changed or deleted.</p>
    {step.at === "idle" && <button type="button" onClick={() => void check()}>Check the old address</button>}
    {step.at === "checking" && <p role="status">Checking {OLD_HOST}…</p>}
    {step.at === "found" && (step.found.lines.length === 0
      ? <p role="status">Nothing is saved at {OLD_HOST} in this browser, so there is nothing to bring over.</p>
      : <>
        <p><strong>Found at {OLD_HOST}:</strong> {step.found.lines.join(", ")}.</p>
        {step.here.length > 0 && <p className="move-warning" role="alert"><strong>This address already has:</strong> {step.here.join(", ")}. Copying replaces these with the old address's versions (images are replaced only where both have one for the same item).</p>}
        <div className="move-actions">
          <button type="button" onClick={() => void copy(step.found)}>{step.here.length ? "Replace with the old address's data" : "Copy to this address"}</button>
          <button type="button" onClick={() => setStep({ at: "idle" })}>Cancel</button>
        </div>
      </>)}
    {step.at === "copying" && <p role="status">Copying… {step.done} of {step.total}</p>}
    {step.at === "done" && <><p className="move-done" role="status">Everything was copied.</p><button type="button" onClick={() => location.reload()}>Reload to see it</button></>}
    {step.at === "error" && <><p className="error" role="alert">{step.message}</p><button type="button" onClick={() => void check()}>Try again</button></>}
  </fieldset>;
}
