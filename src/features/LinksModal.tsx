import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  fetchLinks, createLink, updateLink, deleteLink, scanUrlFor,
  LINK_FIELD_DEFS, defaultLinkFields,
  type ScanLink, type LinkFields,
} from "@/lib/links-data";
import type { ScanProduct } from "@/lib/admin-data";

function FieldPicker({ value, onChange, disabled }: {
  value: LinkFields; onChange: (v: LinkFields) => void; disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
      {LINK_FIELD_DEFS.map((f) => (
        <label key={f.key} className="chip" style={{ cursor: disabled ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={value[f.key] ?? f.def}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.checked })}
          />
          {f.label}
        </label>
      ))}
    </div>
  );
}

export function LinksModal({
  orgCode, productCode, productName, defaultBase, onClose, readOnly, products,
}: {
  orgCode: string;
  productCode: string;
  productName: string;
  defaultBase?: string | null;
  onClose: () => void;
  readOnly?: boolean;
  products?: ScanProduct[];
}) {
  const [links, setLinks] = useState<ScanLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number | "">("");
  const [maxScans, setMaxScans] = useState<number | "">("");
  const [fields, setFields] = useState<LinkFields>(defaultLinkFields());
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    try { setLinks(await fetchLinks(orgCode, productCode)); }
    catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [orgCode, productCode]);

  const onCreate = async () => {
    setBusy(true); setErr(null);
    try {
      await createLink({
        org_code: orgCode,
        product_code: productCode,
        label: label || null,
        days_valid: days === "" ? null : Number(days),
        max_scans: maxScans === "" ? null : Number(maxScans),
        fields,
      });
      setLabel(""); setDays(""); setMaxScans(""); setFields(defaultLinkFields());
      await reload();
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="admin-head">
          <div>
            <h2>Scan links &amp; QR codes</h2>
            <p className="hint">{productName} · {orgCode}</p>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        {!readOnly && <div className="glass panel">
          <h4>Create a new link</h4>
          <div className="form-row">
            <label>Label (optional)<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Camp - Mumbai Oct" /></label>
            <label>Valid for (days)<input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value === "" ? "" : +e.target.value)} placeholder="e.g. 10" /></label>
            <label>Max scans<input type="number" min={1} value={maxScans} onChange={(e) => setMaxScans(e.target.value === "" ? "" : +e.target.value)} placeholder="e.g. 50" /></label>
            <button className="btn btn-primary" disabled={busy} onClick={onCreate}>{busy ? "Creating…" : "+ Generate link + QR"}</button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>Form fields this link will show:</p>
          <FieldPicker value={fields} onChange={setFields} />
          <p className="hint" style={{ marginTop: 6 }}>
            Leave days or max scans blank for no limit. The link stops working automatically when either limit is hit.
          </p>
        </div>}

        {!defaultBase && (
          <div className="glass panel" style={{ borderColor: "rgba(245,158,11,0.5)" }}>
            ⚠️ <b>No scan app URL is set for this tool.</b> Links below will point at this dashboard
            and will NOT open the scan. Fix: AI Tools tab → edit this tool → paste its published
            scan app URL in "Scan app URL" → Save. (Or set a client-specific URL on the tool row.)
          </div>
        )}
        {err && <div className="glass panel" style={{ borderColor: "rgba(225,29,72,0.35)" }}>{err}</div>}

        {loading ? (
          <div className="skeleton" style={{ height: 100 }} />
        ) : links.length === 0 ? (
          <div className="glass empty">No links yet. Create one above.</div>
        ) : (
          <div className="client-grid">
            {links.map((l) => (
              <LinkCard key={l.id} link={l} base={defaultBase ?? null} onChange={reload} readOnly={readOnly} products={products} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LinkCard({ link, base, onChange, readOnly, products }: {
  link: ScanLink; base: string | null; onChange: () => void; readOnly?: boolean; products?: ScanProduct[];
}) {
  const [qr, setQr] = useState<string>("");
  const [f, setF] = useState<LinkFields>({ ...defaultLinkFields(), ...(link.fields ?? {}) });
  const [pc, setPc] = useState(link.product_code);
  const [exp, setExp] = useState(link.expires_at ? link.expires_at.slice(0, 16) : "");
  const [mx, setMx] = useState<string>(link.max_scans != null ? String(link.max_scans) : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty =
    JSON.stringify(f) !== JSON.stringify({ ...defaultLinkFields(), ...(link.fields ?? {}) }) ||
    pc !== link.product_code ||
    exp !== (link.expires_at ? link.expires_at.slice(0, 16) : "") ||
    mx !== (link.max_scans != null ? String(link.max_scans) : "");
  const saveAll = async () => {
    setSaving(true);
    await updateLink(link.id, {
      fields: f,
      product_code: pc,
      expires_at: exp ? new Date(exp).toISOString() : null,
      max_scans: mx ? +mx : null,
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
    onChange();
  };
  const url = scanUrlFor(link.token, base);
  useEffect(() => { QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setQr).catch(() => setQr("")); }, [url]);
  const expiredByDate = !!(link.expires_at && new Date(link.expires_at) < new Date());
  const expiredByQuota = !!(link.max_scans && link.used_scans >= link.max_scans);
  const dead = !link.active || expiredByDate || expiredByQuota;
  const status = dead ? (!link.active ? "Revoked" : expiredByQuota ? "Quota reached" : "Expired") : "Active";

  return (
    <div className="glass client-card">
      <div className="client-body">
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          {qr ? <img src={qr} alt="QR" style={{ borderRadius: 12, background: "white", padding: 6 }} /> : <div className="skeleton" style={{ width: 220, height: 220 }} />}
          <div style={{ flex: "1 1 260px", minWidth: 260 }}>
            <div className="client-name">{link.label || "Untitled link"} <span className="chip" style={{ marginLeft: 8 }}>{status}</span></div>
            <div className="client-sub">Token: <code>{link.token}</code></div>
            <div className="form-row" style={{ marginTop: 10 }}>
              <label style={{ flex: "1 1 100%" }}>Shareable URL
                <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              </label>
            </div>
            <div className="form-row">
              {products && products.length > 0 && (
                <label>AI tool on this link
                  <select value={pc} disabled={readOnly} onChange={(e) => setPc(e.target.value)}>
                    {products.filter((p) => p.active && (p.code !== "hub" || link.product_code === "hub")).map((p) => (
                      <option key={p.code} value={p.code}>{p.icon ?? "🧪"} {p.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>Expires<input type="datetime-local" value={exp} disabled={readOnly}
                onChange={(e) => setExp(e.target.value)}
              /></label>
              <label>Max scans<input type="number" value={mx} disabled={readOnly}
                onChange={(e) => setMx(e.target.value)}
              /></label>
              <label>Used<input readOnly value={link.used_scans} /></label>
            </div>
            <p className="hint" style={{ marginTop: 6 }}>Form fields shown by this link:</p>
            <FieldPicker value={f} onChange={setF} disabled={readOnly} />
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {!readOnly && (
                <button className="btn btn-primary" disabled={!dirty || saving} onClick={saveAll}>
                  {saving ? "Saving…" : saved ? "Saved ✓" : "💾 Save changes"}
                </button>
              )}
              <button className="btn" onClick={() => navigator.clipboard.writeText(url)}>Copy URL</button>
              <a className="btn" href={qr} download={`qr-${link.token}.png`}>Download QR</a>
              {!readOnly && (link.active
                ? <button className="btn" onClick={async () => { await updateLink(link.id, { active: false }); onChange(); }}>Pause link</button>
                : <button className="btn" onClick={async () => { await updateLink(link.id, { active: true }); onChange(); }}>Resume link</button>)}
              {!readOnly && <button className="btn btn-danger" onClick={async () => { if (confirm("Delete this link?")) { await deleteLink(link.id); onChange(); } }}>Delete</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
