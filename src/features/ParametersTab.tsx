import { useEffect, useState } from "react";
import { fetchOrgs, type Org } from "@/lib/vitals-data";
import {
  discoverParams, fetchVisibility, setVisibility, prettyKey,
  type ParamVisibility,
} from "@/lib/params-data";

type Scope = "__global__" | string;

export function ParametersTab() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [scope, setScope] = useState<Scope>("__global__");
  const [keys, setKeys] = useState<string[]>([]);
  const [rules, setRules] = useState<ParamVisibility[]>([]);
  const [globals, setGlobals] = useState<ParamVisibility[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const orgCode = scope === "__global__" ? null : scope;

  useEffect(() => { fetchOrgs().then(setOrgs).catch(() => {}); }, []);
  useEffect(() => { fetchVisibility(null).then(setGlobals).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true); setErr(null);
    Promise.all([discoverParams(orgCode), fetchVisibility(orgCode)])
      .then(([k, r]) => { setKeys(k); setRules(r); })
      .catch((e) => setErr(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false));
  }, [scope]);

  const globalMap = new Map(globals.map((g) => [g.param_key, g] as const));
  const ruleMap = new Map(rules.map((r) => [r.param_key, r] as const));

  const effectiveHidden = (k: string): boolean => {
    if (orgCode === null) return ruleMap.get(k)?.hidden ?? false;
    const local = ruleMap.get(k);
    if (local) return local.hidden;
    return globalMap.get(k)?.hidden ?? false;
  };

  const toggle = async (k: string) => {
    const current = effectiveHidden(k);
    try {
      await setVisibility(orgCode, k, !current, prettyKey(k));
      setRules(await fetchVisibility(orgCode));
      if (orgCode === null) setGlobals(await fetchVisibility(null));
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  };

  const filtered = keys.filter((k) => !q || k.toLowerCase().includes(q.toLowerCase()) || prettyKey(k).toLowerCase().includes(q.toLowerCase()));

  return (
    <section className="admin-wrap">
      <div className="admin-head">
        <div>
          <h2>Parameters</h2>
          <p className="hint">
            Every parameter your scan tools write into <code>results</code> is auto-detected.
            Tick <b>Hide</b> to prevent a client from seeing that column (e.g. mobile number for pharma clients).
            No SQL or code changes needed — new parameters appear here automatically as soon as the tool starts sending them.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="__global__">🌐 Global defaults</option>
            {orgs.map((o) => <option key={o.code} value={o.code}>🏢 {o.name} ({o.code})</option>)}
          </select>
          <input placeholder="Search parameter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
        </div>
      </div>

      {err && <div className="glass panel" style={{ borderColor: "rgba(225,29,72,0.35)" }}>{err}</div>}

      <div className="glass panel">
        {loading ? <div className="skeleton" style={{ height: 200 }} />
          : keys.length === 0 ? (
            <div className="empty">No parameters detected yet. Once the scan tool writes a submission, its fields show up here.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Parameter</th>
                  <th style={{ textAlign: "left" }}>Internal key</th>
                  <th>Global default</th>
                  <th>{orgCode ? "This client" : "Effective"}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((k) => {
                  const g = globalMap.get(k);
                  const local = ruleMap.get(k);
                  const effHidden = effectiveHidden(k);
                  return (
                    <tr key={k}>
                      <td>{prettyKey(k)}</td>
                      <td><code>{k}</code></td>
                      <td style={{ textAlign: "center" }}>{g?.hidden ? "🚫 Hidden" : "👁 Visible"}</td>
                      <td style={{ textAlign: "center" }}>
                        <button className="btn" onClick={() => toggle(k)}>
                          {effHidden ? "🚫 Hidden — click to show" : "👁 Visible — click to hide"}
                        </button>
                        {orgCode && local && (
                          <div className="hint" style={{ fontSize: 11 }}>overrides global</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
    </section>
  );
}
