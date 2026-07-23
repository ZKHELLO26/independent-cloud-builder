import { useEffect, useState } from "react";
import { fetchOrgs, type Org, type Access } from "@/lib/vitals-data";
import {
  fetchProducts, fetchOrgProducts, fetchUsage,
  type ScanProduct, type OrgProduct,
} from "@/lib/admin-data";
import { LinksModal } from "./LinksModal";

/**
 * Client view ("org_admin") — READ-ONLY. Clients can see their plan,
 * enabled AI tools, usage, and copy their scan links + QR codes.
 * All changes (limits, tools, links, logins) are made by the super admin.
 */
export function MyOrgTab({ access }: { access: Access }) {
  const orgCode = access.org_code!;
  const [org, setOrg] = useState<Org | null>(null);
  const [products, setProducts] = useState<ScanProduct[]>([]);
  const [assigned, setAssigned] = useState<OrgProduct[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [linksFor, setLinksFor] = useState<{ code: string; name: string; base: string | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [orgs, ps, ops] = await Promise.all([fetchOrgs(), fetchProducts(), fetchOrgProducts(orgCode)]);
      setOrg(orgs.find((o) => o.code === orgCode) ?? { code: orgCode, name: orgCode, active: true, monthly_scan_limit: null, valid_from: null, valid_to: null });
      setProducts(ps);
      const enabled = ops.filter((o) => o.enabled);
      setAssigned(enabled);
      const entries = await Promise.all(enabled.map(async (a) =>
        [a.product_code, await fetchUsage(orgCode, a.product_code, a.valid_from, a.valid_to)] as const));
      setUsage(Object.fromEntries(entries));
    })().catch((e) => setMsg(String((e as Error)?.message ?? e)));
  }, [orgCode]);

  const limit = org?.monthly_scan_limit ?? null;
  const usedTotal = Object.values(usage).reduce((s, n) => s + n, 0);

  return (
    <section className="admin-wrap">
      <div className="admin-head">
        <div>
          <h2>My organization</h2>
          <p className="hint">
            Your plan, enabled AI tools and scan links — all scoped to <b>{org?.name ?? orgCode}</b>.
            To change limits, tools or team logins, contact your account manager.
          </p>
        </div>
      </div>

      {msg && <div className="glass panel" style={{ borderColor: "rgba(225,29,72,0.35)" }}>{msg}</div>}

      <div className="glass panel">
        <h4>Plan</h4>
        <div className="form-row">
          <label>Scans used<input readOnly value={usedTotal.toLocaleString()} /></label>
          <label>Scan limit<input readOnly value={limit != null ? limit.toLocaleString() : "Unlimited"} /></label>
          <label>Valid from<input readOnly value={org?.valid_from ?? "—"} /></label>
          <label>Valid to<input readOnly value={org?.valid_to ?? "—"} /></label>
        </div>
      </div>

      <div className="glass panel" style={{ marginTop: 14 }}>
        <h4>Your AI tools</h4>
        {assigned.length === 0 && <p className="hint">No tools enabled yet.</p>}
        <div className="tool-list">
          {assigned.map((a) => {
            const meta = products.find((p) => p.code === a.product_code);
            const used = usage[a.product_code] ?? 0;
            const pct = Math.min(100, Math.round((used / Math.max(1, a.monthly_limit)) * 100));
            return (
              <div key={a.product_code} className="tool-row">
                <div className="tool-name"><span className="tool-ico">{meta?.icon ?? "🧪"}</span>{meta?.name ?? a.product_code}</div>
                <span className="tool-usage">
                  <span className="quota-bar mini"><span style={{ width: `${pct}%` }} /></span>
                  {used.toLocaleString()} / {a.monthly_limit.toLocaleString()}
                </span>
                <button className="btn" onClick={() => setLinksFor({ code: a.product_code, name: meta?.name ?? a.product_code, base: a.scan_url || meta?.default_url || null })}>
                  🔗 View links / QR
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {linksFor && (
        <LinksModal
          orgCode={orgCode}
          productCode={linksFor.code}
          productName={linksFor.name}
          defaultBase={linksFor.base}
          readOnly
          onClose={() => setLinksFor(null)}
        />
      )}
    </section>
  );
}
