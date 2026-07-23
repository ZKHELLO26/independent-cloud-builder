import { useEffect, useMemo, useState } from "react";
import { fetchOrgs, friendlyError, type Org } from "@/lib/vitals-data";
import {
  fetchProducts, upsertProduct, deleteProduct,
  fetchOrgProducts, upsertOrgProduct, removeOrgProduct,
  upsertOrg, fetchUsage, inviteClientUser,
  fetchOrgUsers, setUserRole, removeUser, deleteOrg,
  type ScanProduct, type OrgProduct, type OrgUser,
} from "@/lib/admin-data";
import { LinksModal } from "./LinksModal";

export function ClientsTab() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [products, setProducts] = useState<ScanProduct[]>([]);
  const [orgProducts, setOrgProducts] = useState<OrgProduct[]>([]);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = async () => {
    const [o, p, op] = await Promise.all([fetchOrgs(), fetchProducts(), fetchOrgProducts()]);
    setOrgs(o); setProducts(p); setOrgProducts(op);
  };
  useEffect(() => { reload().catch((e) => setMsg(String(e?.message ?? e))); }, []);

  const opsFor = (code: string) => orgProducts.filter((x) => x.org_code === code);

  return (
    <section className="admin-wrap">
      <div className="admin-head">
        <div>
          <h2>Clients</h2>
          <p className="hint">Manage organizations, scan quotas, validity windows, AI tools, and logins.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New client</button>
      </div>

      {msg && <div className="glass panel" style={{ borderColor: "rgba(225,29,72,0.35)" }}>{msg}</div>}
      {!msg && orgs.length === 0 && (
        <div className="glass panel">
          <em>No clients found yet.</em> If you already created one (like Alkem) in Supabase, make sure the row
          exists in <code>public.organizations</code> and that the <code>dashboard_read_orgs</code> policy is in place
          (part of <code>DASHBOARD_ACCESS.sql</code>). You can also just click <b>+ New client</b> above to add one from here.
        </div>
      )}

      {creating && (
        <NewClientForm
          products={products}
          onCancel={() => setCreating(false)}
          onDone={async () => { setCreating(false); await reload(); }}
        />
      )}

      <div className="client-grid">
        {orgs.map((o) => (
          <ClientCard
            key={o.code}
            org={o}
            products={products}
            assigned={opsFor(o.code)}
            open={openCode === o.code}
            onToggle={() => setOpenCode((v) => (v === o.code ? null : o.code))}
            onChange={async (patch) => {
              setSaving(true);
              try { await upsertOrg({ code: o.code, name: o.name, ...patch }); await reload(); }
              catch (e) { setMsg(friendlyError(e)); }
              finally { setSaving(false); }
            }}
            onAssign={async (op) => { await upsertOrgProduct(op); await reload(); }}
            onUnassign={async (code) => { await removeOrgProduct(o.code, code); await reload(); }}
            onDelete={async () => {
              try { await deleteOrg(o.code); setOpenCode(null); await reload(); setMsg(`Client ${o.name} deleted.`); }
              catch (e) { setMsg(friendlyError(e)); }
            }}
            onInvite={async (payload) => {
              const res = await inviteClientUser({ ...payload, org_code: o.code });
              setMsg(res.ok
                ? payload.mode === "invite"
                  ? `Invite email sent to ${payload.email}.`
                  : `Login ${payload.email} created with password.`
                : `Invite failed: ${res.error}`);
            }}
          />
        ))}
      </div>
      {saving && <p className="hint">Saving…</p>}
    </section>
  );
}

function NewClientForm({
  products, onCancel, onDone,
}: { products: ScanProduct[]; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [limit, setLimit] = useState(10000);
  const [picked, setPicked] = useState<Record<string, { url: string; qty: number }>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMode, setInviteMode] = useState<"invite" | "password">("invite");
  const [invitePw, setInvitePw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (c: string) => setPicked((p) => {
    const n = { ...p };
    if (n[c]) delete n[c]; else n[c] = { url: "", qty: 10000 };
    return n;
  });

  const submit = async () => {
    if (!name || !code) { setErr("Name and code required"); return; }
    setBusy(true); setErr(null);
    try {
      await upsertOrg({
        code, name, active: true,
        monthly_scan_limit: limit,
        valid_from: validFrom || null, valid_to: validTo || null,
      });
      for (const [pc, cfg] of Object.entries(picked)) {
        await upsertOrgProduct({
          org_code: code, product_code: pc,
          scan_url: cfg.url || null, monthly_limit: cfg.qty,
          valid_from: validFrom || null, valid_to: validTo || null,
          enabled: true,
        });
      }
      if (inviteEmail) {
        const res = await inviteClientUser({
          email: inviteEmail, org_code: code, role: "org_admin",
          mode: inviteMode, password: inviteMode === "password" ? invitePw : undefined,
        });
        if (!res.ok) { setErr(`Client saved but invite failed: ${res.error}`); setBusy(false); return; }
      }
      onDone();
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="glass panel new-client">
      <h3>New client</h3>
      <div className="form-row">
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Pharma" /></label>
        <label>Org code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ACME" /></label>
        <label>Scan limit (total)<input type="number" value={limit} onChange={(e) => setLimit(+e.target.value || 0)} /></label>
        <label>Valid from<input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></label>
        <label>Valid to<input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></label>
      </div>

      <h4 style={{ marginTop: 14 }}>AI tools to enable</h4>
      <p className="hint" style={{ marginTop: -4 }}>
        <b>Scan URL is optional.</b> Data flows automatically through Supabase — you don't need a URL for it to work.
        Only fill it in if you want to give this client a branded link to the scan (e.g. <code>https://scan.acmepharma.com</code>)
        to embed on their site or share with their team.
      </p>
      <div className="tool-picker">
        {products.filter((p) => p.active).map((p) => {
          const on = !!picked[p.code];
          return (
            <div key={p.code} className={`tool-card ${on ? "on" : ""}`}>
              <button className="tool-toggle" onClick={() => toggle(p.code)}>
                <span className="tool-ico">{p.icon ?? "🧪"}</span>
                <span>{p.name}</span>
                <span className="tool-check">{on ? "✓" : "+"}</span>
              </button>
              {on && (
                <>
                  <input
                    placeholder="Scan URL (client's branded link)"
                    value={picked[p.code].url}
                    onChange={(e) => setPicked((s) => ({ ...s, [p.code]: { ...s[p.code], url: e.target.value } }))}
                  />
                  <input
                    type="number" placeholder="Scan quota (total)"
                    value={picked[p.code].qty}
                    onChange={(e) => setPicked((s) => ({ ...s, [p.code]: { ...s[p.code], qty: +e.target.value || 0 } }))}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      <h4 style={{ marginTop: 14 }}>Invite a login (optional)</h4>
      <div className="form-row">
        <label>Email<input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="client@example.com" /></label>
        <label>Method
          <select value={inviteMode} onChange={(e) => setInviteMode(e.target.value as "invite" | "password")}>
            <option value="invite">Send email invite</option>
            <option value="password">Set password now</option>
          </select>
        </label>
        {inviteMode === "password" && (
          <label>Password<input type="text" value={invitePw} onChange={(e) => setInvitePw(e.target.value)} placeholder="min 8 characters" /></label>
        )}
      </div>

      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Create client"}</button>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

export function ClientCard({
  org, products, assigned, open, onToggle, onChange, onAssign, onUnassign, onInvite, onDelete, readOnly,
}: {
  org: Org;
  products: ScanProduct[];
  assigned: OrgProduct[];
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Org>) => void;
  onAssign: (op: OrgProduct) => Promise<void>;
  onUnassign: (product: string) => Promise<void>;
  onInvite: (p: { email: string; mode: "invite" | "password"; password?: string; role?: "org_admin" | "org_user" }) => Promise<void>;
  onDelete?: () => Promise<void>;
  readOnly?: boolean;
}) {
  const [usage, setUsage] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!open) return;
    Promise.all(assigned.map(async (a) => [a.product_code, await fetchUsage(org.code, a.product_code, a.valid_from, a.valid_to)] as const))
      .then((entries) => setUsage(Object.fromEntries(entries)));
  }, [open, assigned, org.code]);

  // Draft settings — nothing saves until "Save changes" is pressed.
  const [draft, setDraft] = useState({
    name: org.name,
    active: org.active !== false,
    limit: org.monthly_scan_limit ?? 10000,
    validFrom: org.valid_from ?? "",
    validTo: org.valid_to ?? "",
  });
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [savingCard, setSavingCard] = useState(false);
  useEffect(() => {
    setDraft({
      name: org.name,
      active: org.active !== false,
      limit: org.monthly_scan_limit ?? 10000,
      validFrom: org.valid_from ?? "",
      validTo: org.valid_to ?? "",
    });
  }, [org.code, org.name, org.active, org.monthly_scan_limit, org.valid_from, org.valid_to]);
  const dirty =
    draft.name !== org.name ||
    draft.active !== (org.active !== false) ||
    draft.limit !== (org.monthly_scan_limit ?? 10000) ||
    draft.validFrom !== (org.valid_from ?? "") ||
    draft.validTo !== (org.valid_to ?? "");

  const saveCard = async () => {
    setSavingCard(true);
    setSavedMsg(null);
    await onChange({
      name: draft.name,
      active: draft.active,
      monthly_scan_limit: draft.limit,
      valid_from: draft.validFrom || null,
      valid_to: draft.validTo || null,
    });
    setSavingCard(false);
    setSavedMsg("Saved ✓");
    setTimeout(() => setSavedMsg(null), 2500);
  };

  const [confirmDelete, setConfirmDelete] = useState("");
  const [hubOpen, setHubOpen] = useState(false);
  const hubBase =
    assigned.find((a) => a.product_code === "face")?.scan_url ||
    products.find((p) => p.code === "face")?.default_url ||
    assigned.map((a) => a.scan_url).find(Boolean) ||
    products.map((p) => p.default_url).find(Boolean) ||
    null;
  const usedTotal = Object.values(usage).reduce((s, n) => s + n, 0);
  const limit = org.monthly_scan_limit ?? 10000;
  const pct = Math.min(100, Math.round((usedTotal / Math.max(1, limit)) * 100));

  return (
    <div className="glass client-card">
      <div className="client-card-head" onClick={onToggle} role="button">
        <div>
          <div className="client-name">{org.name}{org.active === false && <span className="chip" style={{ marginLeft: 8 }}>Suspended</span>}</div>
          <div className="client-sub">{org.code} · {assigned.length} tool{assigned.length === 1 ? "" : "s"}</div>
        </div>
        <div className="client-quota">
          <div className="quota-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="quota-num">{usedTotal.toLocaleString()} / {limit.toLocaleString()}</div>
        </div>
        <button className="btn" onClick={(e) => { e.stopPropagation(); onToggle(); }}>{open ? "Close" : readOnly ? "View" : "Manage"}</button>
      </div>

      {open && (
        <div className="client-body">
          <h4>Client settings</h4>
          <div className="form-row">
            <label>Client name<input value={draft.name} disabled={readOnly} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Status
              <select value={draft.active ? "yes" : "no"} disabled={readOnly} onChange={(e) => setDraft({ ...draft, active: e.target.value === "yes" })}>
                <option value="yes">Active</option><option value="no">Suspended</option>
              </select>
            </label>
            <label>Scan limit (total)<input type="number" min={0} value={draft.limit} disabled={readOnly} onChange={(e) => setDraft({ ...draft, limit: +e.target.value || 0 })} /></label>
            <label>Valid from<input type="date" value={draft.validFrom} disabled={readOnly} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} /></label>
            <label>Valid to<input type="date" value={draft.validTo} disabled={readOnly} onChange={(e) => setDraft({ ...draft, validTo: e.target.value })} /></label>
          </div>
          {!readOnly && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4 }}>
              <button className="btn btn-primary" disabled={!dirty || savingCard} onClick={saveCard}>
                {savingCard ? "Saving…" : "💾 Save changes"}
              </button>
              {dirty && !savingCard && <span className="hint">Unsaved changes</span>}
              {savedMsg && <span className="chip">{savedMsg}</span>}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0 }}>AI tools</h4>
            <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); setHubOpen(true); }}>
              🧭 Landing page link (all tools)
            </button>
          </div>
          <ToolAssignments
            org={org} products={products} assigned={assigned} usage={usage}
            onAssign={onAssign} onUnassign={onUnassign} readOnly={readOnly}
            onResetOrg={async () => { await onChange({ valid_from: new Date().toISOString().slice(0, 10) }); }}
          />

          <h4 style={{ marginTop: 16 }}>Dashboard logins</h4>
          <UsersSection orgCode={org.code} readOnly={readOnly} onInvite={onInvite} />

          {hubOpen && (
            <LinksModal
              orgCode={org.code}
              productCode="hub"
              productName="Client landing page (all enabled tools as tiles)"
              defaultBase={hubBase}
              products={products}
              onClose={() => setHubOpen(false)}
            />
          )}

          {!readOnly && onDelete && (
            <>
              <h4 style={{ marginTop: 16, color: "#e11d48" }}>Danger zone</h4>
              <div className="form-row">
                <label>Type the client code <b>{org.code}</b> to confirm
                  <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder={org.code} />
                </label>
                <button
                  className="btn btn-danger"
                  disabled={confirmDelete.trim().toUpperCase() !== org.code.toUpperCase()}
                  onClick={() => onDelete()}
                >🗑 Delete client permanently</button>
              </div>
              <p className="hint">Deleting removes the client, their tool assignments, scan links and dashboard logins. Their historical scan data stays in the database. Prefer "Suspended" if you just want to pause them.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UsersSection({ orgCode, readOnly, onInvite }: {
  orgCode: string;
  readOnly?: boolean;
  onInvite: (p: { email: string; mode: "invite" | "password"; password?: string; role?: "org_admin" | "org_user" }) => Promise<void>;
}) {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reload = () => fetchOrgUsers(orgCode).then(setUsers).catch((e) => setMsg(String(e?.message ?? e)));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [orgCode]);

  return (
    <div>
      {msg && <p className="hint" style={{ color: "#fda4af" }}>{msg}</p>}
      {users.length === 0 && <p className="hint">No logins yet for this client.</p>}
      {users.map((u) => (
        <div key={u.user_id} className="tool-row">
          <div className="tool-name" style={{ minWidth: 220 }}>👤 {u.email ?? u.user_id.slice(0, 8)}</div>
          <select
            value={u.role}
            disabled={readOnly || busyId === u.user_id}
            onChange={async (e) => {
              const role = e.target.value as OrgUser["role"];
              setBusyId(u.user_id);
              const res = await setUserRole(u.user_id, role, orgCode);
              setBusyId(null);
              if (!res.ok) setMsg(res.error); else { setMsg(null); reload(); }
            }}
          >
            <option value="org_admin">Client owner</option>
            <option value="org_user">Staff (view only)</option>
          </select>
          {!readOnly && (
            <button
              className="btn btn-danger"
              disabled={busyId === u.user_id}
              onClick={async () => {
                if (!confirm(`Remove login ${u.email ?? ""}? They will no longer be able to sign in.`)) return;
                setBusyId(u.user_id);
                const res = await removeUser(u.user_id);
                setBusyId(null);
                if (!res.ok) setMsg(res.error); else reload();
              }}
            >Remove</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <>
          <p className="hint" style={{ marginTop: 10 }}>Add a login</p>
          <InviteRow onInvite={async (p) => { await onInvite(p); reload(); }} />
        </>
      )}
    </div>
  );
}

function ToolAssignments({
  org, products, assigned, usage, onAssign, onUnassign, readOnly, onResetOrg,
}: {
  org: Org; products: ScanProduct[]; assigned: OrgProduct[]; usage: Record<string, number>;
  onAssign: (op: OrgProduct) => Promise<void>;
  onUnassign: (product: string) => Promise<void>;
  readOnly?: boolean;
  onResetOrg?: () => Promise<void>;
}) {
  const [addPc, setAddPc] = useState("");
  const [linksFor, setLinksFor] = useState<{ code: string; name: string; base: string | null } | null>(null);
  const map = useMemo(() => new Map(assigned.map((a) => [a.product_code, a])), [assigned]);
  const available = products.filter((p) => p.active && p.code !== "hub" && !map.has(p.code));

  return (
    <div className="tool-list">
      {assigned.length === 0 && <p className="hint">No AI tools enabled for this client yet.{readOnly ? "" : " Add one below."}</p>}
      {assigned.map((a) => (
        <ToolRow
          key={a.product_code}
          a={a}
          meta={products.find((p) => p.code === a.product_code)}
          used={usage[a.product_code] ?? 0}
          readOnly={readOnly}
          onSave={onAssign}
          onRemove={() => onUnassign(a.product_code)}
          onResetOrg={onResetOrg}
          onLinks={(base) => {
            const metaP = products.find((p) => p.code === a.product_code);
            setLinksFor({ code: a.product_code, name: metaP?.name ?? a.product_code, base: base || metaP?.default_url || null });
          }}
        />
      ))}

      {!readOnly && available.length > 0 && (
        <div className="tool-row" style={{ background: "rgba(13,148,136,0.06)" }}>
          <select value={addPc} onChange={(e) => setAddPc(e.target.value)}>
            <option value="">+ Add tool…</option>
            {available.map((p) => <option key={p.code} value={p.code}>{p.icon ?? "🧪"} {p.name}</option>)}
          </select>
          <button
            className="btn btn-primary"
            disabled={!addPc}
            onClick={async () => {
              if (!addPc) return;
              await onAssign({
                org_code: org.code, product_code: addPc,
                scan_url: null, monthly_limit: 10000,
                valid_from: org.valid_from ?? null, valid_to: org.valid_to ?? null,
                enabled: true,
              });
              setAddPc("");
            }}
          >Add</button>
        </div>
      )}

      {linksFor && (
        <LinksModal
          orgCode={org.code}
          productCode={linksFor.code}
          productName={linksFor.name}
          defaultBase={linksFor.base}
          readOnly={readOnly}
          products={products}
          onClose={() => setLinksFor(null)}
        />
      )}
    </div>
  );
}

function ToolRow({ a, meta, used, readOnly, onSave, onRemove, onLinks, onResetOrg }: {
  a: OrgProduct;
  meta?: ScanProduct;
  used: number;
  readOnly?: boolean;
  onSave: (op: OrgProduct) => Promise<void>;
  onRemove: () => void;
  onLinks: (base: string | null) => void;
  onResetOrg?: () => Promise<void>;
}) {
  const [d, setD] = useState({ url: a.scan_url ?? "", qty: a.monthly_limit, to: a.valid_to ?? "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setD({ url: a.scan_url ?? "", qty: a.monthly_limit, to: a.valid_to ?? "" }),
    [a.scan_url, a.monthly_limit, a.valid_to]);
  const dirty = d.url !== (a.scan_url ?? "") || d.qty !== a.monthly_limit || d.to !== (a.valid_to ?? "");
  const pct = Math.min(100, Math.round((used / Math.max(1, a.monthly_limit)) * 100));

  return (
    <div className="tool-row">
      <div className="tool-name"><span className="tool-ico">{meta?.icon ?? "🧪"}</span>{meta?.name ?? a.product_code}</div>
      <input
        placeholder="Scan app URL (e.g. https://scan.zeikon.app)"
        value={d.url} disabled={readOnly}
        onChange={(e) => setD({ ...d, url: e.target.value })}
      />
      <input
        type="number" style={{ maxWidth: 110 }} min={0}
        value={d.qty} disabled={readOnly}
        onChange={(e) => setD({ ...d, qty: +e.target.value || 0 })}
      />
      <input
        type="date" style={{ maxWidth: 140 }}
        value={d.to} disabled={readOnly}
        onChange={(e) => setD({ ...d, to: e.target.value })}
      />
      <span className="tool-usage">
        <span className="quota-bar mini"><span style={{ width: `${pct}%` }} /></span>
        {used.toLocaleString()} / {a.monthly_limit.toLocaleString()}
      </span>
      {!readOnly && (
        <button
          className="btn btn-primary" disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            await onSave({ ...a, scan_url: d.url || null, monthly_limit: d.qty, valid_to: d.to || null });
            setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
          }}
        >{saving ? "…" : saved ? "✓" : "💾 Save"}</button>
      )}
      <button className="btn" onClick={() => onLinks(a.scan_url ?? null)}>🔗 Links / QR</button>
      {!readOnly && (
        <button
          className="btn"
          title="Reset the used-scan counter to zero. Restarts the quota window from today; historical scans are kept."
          onClick={async () => {
            if (!confirm(`Reset scan usage for ${meta?.name ?? a.product_code} to 0?\n\nThis restarts the quota window from today for this tool AND for the client's overall Scan Balance. Historical scan data is kept.`)) return;
            setSaving(true);
            const today = new Date().toISOString().slice(0, 10);
            await onSave({ ...a, valid_from: today });
            if (onResetOrg) { try { await onResetOrg(); } catch { /* ignore */ } }
            setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
          }}
        >🔄 Reset usage</button>
      )}
      {!readOnly && <button className="btn btn-danger" onClick={onRemove}>Remove</button>}
    </div>
  );
}

function InviteRow({
  onInvite,
}: { onInvite: (p: { email: string; mode: "invite" | "password"; password?: string; role?: "org_admin" | "org_user" }) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"invite" | "password">("invite");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<"org_admin" | "org_user">("org_admin");
  const [busy, setBusy] = useState(false);
  return (
    <div className="form-row">
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@company.com" /></label>
      <label>Role
        <select value={role} onChange={(e) => setRole(e.target.value as "org_admin" | "org_user")}>
          <option value="org_admin">Client owner</option>
          <option value="org_user">Staff (read-only)</option>
        </select>
      </label>
      <label>Method
        <select value={mode} onChange={(e) => setMode(e.target.value as "invite" | "password")}>
          <option value="invite">Email invite</option>
          <option value="password">Set password now</option>
        </select>
      </label>
      {mode === "password" && (
        <label>Password<input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="min 8 chars" /></label>
      )}
      <button
        className="btn btn-primary"
        disabled={busy || !email || (mode === "password" && pw.length < 8)}
        onClick={async () => { setBusy(true); await onInvite({ email, mode, password: pw, role }); setBusy(false); setEmail(""); setPw(""); }}
      >{busy ? "Sending…" : mode === "invite" ? "Send invite" : "Create login"}</button>
    </div>
  );
}

export function ToolsTab() {
  const [products, setProducts] = useState<ScanProduct[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const reload = () => fetchProducts().then((ps) => setProducts(ps.filter((x) => x.code !== "hub"))).catch((e) => setMsg(friendlyError(e)));
  useEffect(() => { reload(); }, []);

  return (
    <section className="admin-wrap">
      <div className="admin-head">
        <div>
          <h2>AI Tools</h2>
          <p className="hint">Your global tool catalog. Add a tool once here; then enable it per client on the Clients tab.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New tool</button>
      </div>

      {msg && <div className="glass panel" style={{ borderColor: "rgba(225,29,72,0.35)" }}>{msg}</div>}

      {creating && (
        <ToolForm
          initial={{ code: "", name: "", category: "", description: "", icon: "🧪", color: "#0d9488", active: true }}
          onCancel={() => setCreating(false)}
          onSave={async (p) => { await upsertProduct(p); setCreating(false); reload(); }}
        />
      )}

      <div className="tool-grid">
        {products.map((p) => (
          <ToolForm
            key={p.code} initial={p}
            onSave={async (v) => { await upsertProduct(v); reload(); }}
            onDelete={async () => { if (confirm(`Delete tool "${p.name}"?`)) { await deleteProduct(p.code); reload(); } }}
          />
        ))}
      </div>
    </section>
  );
}

function ToolForm({
  initial, onSave, onCancel, onDelete,
}: {
  initial: ScanProduct;
  onSave: (p: ScanProduct) => Promise<void>;
  onCancel?: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [p, setP] = useState<ScanProduct>(initial);
  const [busy, setBusy] = useState(false);
  const isNew = !initial.code;
  return (
    <div className="glass panel tool-editor" style={{ borderTop: `3px solid ${p.color ?? "#0d9488"}` }}>
      <div className="form-row">
        <label>Code<input value={p.code} disabled={!isNew} onChange={(e) => setP({ ...p, code: e.target.value.toLowerCase() })} placeholder="face" /></label>
        <label>Name<input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
        <label>Category<input value={p.category ?? ""} onChange={(e) => setP({ ...p, category: e.target.value })} placeholder="vitals" /></label>
        <label>Icon<input value={p.icon ?? ""} onChange={(e) => setP({ ...p, icon: e.target.value })} placeholder="😊" /></label>
        <label>Color<input type="color" value={p.color ?? "#0d9488"} onChange={(e) => setP({ ...p, color: e.target.value })} /></label>
        <label>Active
          <select value={p.active ? "yes" : "no"} onChange={(e) => setP({ ...p, active: e.target.value === "yes" })}>
            <option value="yes">Active</option><option value="no">Hidden</option>
          </select>
        </label>
      </div>
      <label style={{ display: "block", marginTop: 8 }}>
        Scan app URL <span className="hint">(REQUIRED for links to work — the published address of this tool's scan app)</span>
        <input
          value={p.default_url ?? ""}
          onChange={(e) => setP({ ...p, default_url: e.target.value })}
          placeholder="https://your-face-scan.lovable.app"
        />
      </label>
      <label style={{ display: "block", marginTop: 8 }}>Description
        <textarea value={p.description ?? ""} onChange={(e) => setP({ ...p, description: e.target.value })} rows={2} />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn btn-primary" disabled={busy || !p.code || !p.name}
          onClick={async () => { setBusy(true); await onSave(p); setBusy(false); }}>
          {busy ? "Saving…" : isNew ? "Create tool" : "Save"}
        </button>
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
        {onDelete && <button className="btn btn-danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
