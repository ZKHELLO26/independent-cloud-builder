import { useEffect, useMemo, useState } from "react";
import { format, startOfMonth, subDays, subMonths, endOfMonth, startOfYear } from "date-fns";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList, Legend,
} from "recharts";
import {
  supabase, fetchScans, fetchEmployees, fetchAccess, fetchOrgs, applyFilters,
  discoverResultKeys, resultValue, prettyKey, AGE_BANDS,
  type Scan, type Employee, type Filters, type Access, type Org,
} from "@/lib/vitals-data";
import { ClientsTab, ToolsTab } from "./AdminPanel";
import { MyOrgTab } from "./MyOrgTab";
import { ParametersTab } from "./ParametersTab";
import { fetchAllVisibility, hiddenSet, type ParamVisibility } from "@/lib/params-data";

const MODULE_META: Record<string, { label: string; icon: string }> = {
  face: { label: "Face Vitals", icon: "😊" },
  skin: { label: "Skin Scan", icon: "✨" },
  hair: { label: "Hair & Scalp", icon: "💇" },
  posture: { label: "Posture", icon: "🧍" },
};
import { exportExcel } from "@/lib/exportExcel";

const SCAN_TARGET = 10000;
const COLORS = ["#2dd4bf", "#38bdf8", "#8b5cf6", "#fb7185", "#fbbf24", "#34d399", "#f472b6", "#a3e635"];
const today = () => format(new Date(), "yyyy-MM-dd");

const emptyFilters = (): Filters => ({
  from: format(startOfYear(new Date()), "yyyy-MM-dd"),
  to: today(),
  zone: "", region: "", hq: "", empCode: "", designation: "",
  speciality: "", gender: "", ageBand: "",
});

export default function Dashboard() {
  const [access, setAccess] = useState<Access | null | "loading">("loading");
  const [accessErr, setAccessErr] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgsErr, setOrgsErr] = useState<string | null>(null);
  const [org, setOrg] = useState<string>("");
  const [module, setModule] = useState<string>("all");
  const [tab, setTab] = useState<"overview" | "clients" | "tools" | "fields" | "params" | "myorg">("overview");
  const [filters, setFilters] = useState<Filters>(emptyFilters());
  const [scans, setScans] = useState<Scan[]>([]);
  const [allTime, setAllTime] = useState<Scan[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [visibility, setVisibility] = useState<ParamVisibility[]>([]);

  // Resolve my access level first
  useEffect(() => {
    fetchAccess()
      .then((a) => {
        setAccess(a);
        if (a && a.role !== "super_admin" && a.org_code) setOrg(a.org_code);
        if (a?.role === "super_admin" || a?.role === "org_admin") {
          fetchOrgs()
            .then((rows) => { setOrgs(rows); setOrgsErr(null); })
            .catch((error) => setOrgsErr(String(error?.message ?? error)));
        }
      })
      .catch((error) => {
        setAccessErr(String(error?.message ?? error));
        setAccess(null);
      });
    fetchAllVisibility().then(setVisibility).catch(() => {});
  }, [reloadKey]);

  const orgFilter = org || undefined;

  useEffect(() => {
    if (access === "loading" || !access) return;
    fetchEmployees(orgFilter)
      .then(setEmployees)
      .catch((error) => setLoadErr(String(error?.message ?? error)));
  }, [access, org, reloadKey]);

  // All-time slice for the headline counters (independent of date filter).
  useEffect(() => {
    if (access === "loading" || !access) return;
    fetchScans("2020-01-01", today(), orgFilter)
      .then(setAllTime)
      .catch((error) => setLoadErr(String(error?.message ?? error)));
  }, [access, org, reloadKey]);

  useEffect(() => {
    if (access === "loading" || !access) return;
    setLoading(true);
    setLoadErr(null);
    fetchScans(filters.from, filters.to, orgFilter)
      .then(setScans)
      .catch((e) => setLoadErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [access, org, filters.from, filters.to, reloadKey]);

  const empIndex = useMemo(() => new Map(employees.map((e) => [e.emp_code, e])), [employees]);
  const moduleRows = useMemo(
    () => (module === "all" ? scans : scans.filter((s) => (s.scan_type ?? "face") === module)),
    [scans, module],
  );
  const rows = useMemo(() => applyFilters(moduleRows, filters, empIndex), [moduleRows, filters, empIndex]);
  const viewerHidden = useMemo(() => {
    if (access === "loading" || !access) return new Set<string>();
    if (access.role === "super_admin") return new Set<string>();
    return hiddenSet(visibility, access.org_code);
  }, [access, visibility]);
  const modulesPresent = useMemo(() => {
    const set = new Set(allTime.map((s) => s.scan_type ?? "face"));
    return Array.from(set);
  }, [allTime]);
  const kpiAllTime = useMemo(
    () => (module === "all" ? allTime : allTime.filter((s) => (s.scan_type ?? "face") === module)),
    [allTime, module],
  );

  const opts = useMemo(() => {
    const uniq = (xs: (string | null | undefined)[]) =>
      Array.from(new Set(xs.filter((x): x is string => !!x))).sort();
    return {
      zones: uniq(employees.map((e) => e.zone)),
      regions: uniq([...employees.map((e) => e.region), ...scans.map((s) => s.employee_region)]),
      hqs: uniq([...employees.map((e) => e.hq), ...scans.map((s) => s.employee_hq)]),
      designations: uniq(employees.map((e) => e.designation)),
      specialities: uniq(scans.map((s) => s.doctor_speciality)),
    };
  }, [employees, scans]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const activeChips = (Object.entries(filters) as Array<[keyof Filters, string]>)
    .filter(([k, v]) => v && k !== "from" && k !== "to")
    .map(([k, v]) => ({
      k,
      label:
        k === "empCode"
          ? `Employee: ${empIndex.get(v)?.emp_name ?? v}`
          : `${{ zone: "Zone", region: "Region", hq: "HQ", designation: "Level", speciality: "Speciality", gender: "Gender", ageBand: "Age" }[k as string] ?? k}: ${v}`,
    }));

  const periodLabel = `${format(new Date(filters.from), "dd MMM yyyy")} – ${format(new Date(filters.to), "dd MMM yyyy")}`;

  if (access === "loading") {
    return (
      <>
        <div className="aurora" />
        <div className="shell"><div className="skeleton" style={{ height: 120, marginTop: 40 }} /></div>
      </>
    );
  }

  if (!access) {
    const permissionError = accessErr?.toLowerCase().includes("permission denied");
    return (
      <>
        <div className="aurora" />
        <div className="login-hero">
          <div className="glass login-card">
            <h2>{permissionError ? "Database setup required" : "No administrator access yet"}</h2>
            <p>{permissionError
              ? "Your login works, but this database has not granted the dashboard permission. Run ONEVIEW_FINAL_PERMISSION_FIX_V9.sql in the SQL Editor, then refresh this page."
              : "Your login works, but this account is not assigned as an administrator. Add it as super_admin in dashboard_access, then refresh this page."}</p>
            {accessErr && (
              <pre style={{
                marginTop: 12, padding: 12, borderRadius: 8,
                background: "rgba(0,0,0,0.05)", color: "#b00020",
                fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word",
                textAlign: "left",
              }}>
                Exact database error:{"\n"}{accessErr}
              </pre>
            )}
            <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </>
    );
  }


  return (
    <>
      <div className="aurora" />
      <div className="shell">
        <header className="topbar rise">
          <div className="brand">
            <div>
              <h1>
                <span className="grad-text">OneView</span> Dashboard <span className="chip" style={{ fontSize: 11, verticalAlign: "middle" }}>2.0</span>
              </h1>
              <small>Analytics · {access.role === "super_admin" ? "Super admin" : access.role === "org_admin" ? "Client owner" : "Client staff"}</small>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {access.role === "super_admin" && tab === "overview" && (
              <div className="field" style={{ minWidth: 180 }}>
                <label>Client</label>
                <select value={org} onChange={(e) => setOrg(e.target.value)}>
                  <option value="">All clients</option>
                  {orgs.map((o) => (
                    <option key={o.code} value={o.code}>{o.name}</option>
                  ))}
                </select>
              </div>
            )}
            {access.role !== "super_admin" && (
              <span className="chip" style={{ cursor: "default" }}>
                {orgs.find((o) => o.code === org)?.name ?? org}
              </span>
            )}
            {tab === "overview" && (
              <button className="btn btn-primary" onClick={() => exportExcel(rows, periodLabel, viewerHidden)} disabled={!rows.length}>
                ⬇ Export to Excel
              </button>
            )}
            <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </header>

        {access.role === "super_admin" && (
          <div className="seg rise" style={{ marginBottom: 16 }}>
            <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>📊 Overview</button>
            <button className={tab === "clients" ? "on" : ""} onClick={() => setTab("clients")}>🏢 Clients</button>
            <button className={tab === "tools" ? "on" : ""} onClick={() => setTab("tools")}>🧪 AI Tools</button>
            <button className={tab === "params" ? "on" : ""} onClick={() => setTab("params")}>👁 Parameters</button>
          </div>
        )}

        {access.role === "org_admin" && (
          <div className="seg rise" style={{ marginBottom: 16 }}>
            <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>📊 Overview</button>
            <button className={tab === "myorg" ? "on" : ""} onClick={() => setTab("myorg")}>🏢 My organization</button>
          </div>
        )}

        {tab === "clients" && <ClientsTab />}
        {tab === "tools" && <ToolsTab />}
        {tab === "params" && <ParametersTab />}
        {tab === "myorg" && access.role === "org_admin" && <MyOrgTab access={access} />}
        {tab === "overview" && <>

        {(orgsErr || loadErr) && (
          <div className="err" role="alert" style={{ marginBottom: 16 }}>
            <strong>Dashboard data could not be loaded.</strong>{" "}
            {orgsErr ?? loadErr}
            <button className="btn" type="button" onClick={() => setReloadKey((key) => key + 1)} style={{ marginLeft: 12 }}>
              Retry
            </button>
          </div>
        )}

        {(modulesPresent.length > 1 || module !== "all") && (
          <div className="seg rise" style={{ marginBottom: 16 }}>
            <button className={module === "all" ? "on" : ""} onClick={() => setModule("all")}>
              All modules
            </button>
            {modulesPresent.map((m) => (
              <button key={m} className={module === m ? "on" : ""} onClick={() => setModule(m)}>
                {MODULE_META[m]?.icon ?? "🧪"} {MODULE_META[m]?.label ?? m}
              </button>
            ))}
          </div>
        )}



        <Kpis allTime={kpiAllTime} filtered={rows} showBalance={access.role === "org_admin" || !!org} orgLimit={orgs.find((o) => o.code === org)?.monthly_scan_limit ?? null} orgValidFrom={orgs.find((o) => o.code === org)?.valid_from ?? null} />

        <section className="glass filters rise">
          <div className="field" style={{ maxWidth: 150 }}>
            <label>From</label>
            <input type="date" value={filters.from} max={filters.to} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label>To</label>
            <input type="date" value={filters.to} min={filters.from} max={today()} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>Preset</label>
            <select
              value=""
              onChange={(e) => {
                const now = new Date();
                const v = e.target.value;
                if (v === "today") set({ from: today(), to: today() });
                if (v === "7d") set({ from: format(subDays(now, 6), "yyyy-MM-dd"), to: today() });
                if (v === "month") set({ from: format(startOfMonth(now), "yyyy-MM-dd"), to: today() });
                if (v === "prev") {
                  const p = subMonths(now, 1);
                  set({ from: format(startOfMonth(p), "yyyy-MM-dd"), to: format(endOfMonth(p), "yyyy-MM-dd") });
                }
                if (v === "ytd") set({ from: format(startOfYear(now), "yyyy-MM-dd"), to: today() });
              }}
            >
              <option value="">Quick select…</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="month">This month</option>
              <option value="prev">Previous month</option>
              <option value="ytd">Year to date</option>
            </select>
          </div>
          <Select label="Zone" value={filters.zone} onChange={(v) => set({ zone: v })} options={opts.zones} />
          <Select label="Region" value={filters.region} onChange={(v) => set({ region: v })} options={opts.regions} />
          <Select label="HQ" value={filters.hq} onChange={(v) => set({ hq: v })} options={opts.hqs} />
          <div className="field" style={{ minWidth: 200 }}>
            <label>Employee</label>
            <select value={filters.empCode} onChange={(e) => set({ empCode: e.target.value })}>
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.emp_code} value={e.emp_code}>
                  {e.emp_name} — {e.emp_code}
                </option>
              ))}
            </select>
          </div>
          <Select label="Level" value={filters.designation} onChange={(v) => set({ designation: v })} options={opts.designations} />
          <Select label="Speciality" value={filters.speciality} onChange={(v) => set({ speciality: v })} options={opts.specialities} />
          <div className="field" style={{ maxWidth: 120 }}>
            <label>Gender</label>
            <select value={filters.gender} onChange={(e) => set({ gender: e.target.value })}>
              <option value="">All</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: 130 }}>
            <label>Age band</label>
            <select value={filters.ageBand} onChange={(e) => set({ ageBand: e.target.value })}>
              <option value="">All ages</option>
              {AGE_BANDS.map((b) => (
                <option key={b.key} value={b.key}>{b.label}</option>
              ))}
            </select>
          </div>
          {activeChips.length > 0 && (
            <div className="chips">
              {activeChips.map((c) => (
                <button key={c.k} className="chip" onClick={() => set({ [c.k]: "" } as Partial<Filters>)}>
                  {c.label} ✕
                </button>
              ))}
              <button className="chip" onClick={() => setFilters(emptyFilters())}>Clear all</button>
            </div>
          )}
        </section>

        {loadErr && (
          <div className="glass panel" style={{ borderColor: "rgba(251,113,133,0.4)", marginBottom: 14 }}>
            <h3>Couldn't load data</h3>
            <p className="hint">{loadErr}. Check that the dashboard access SQL has been run in Supabase.</p>
          </div>
        )}

        {loading ? (
          <div className="grid-2">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 280 }} />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="glass empty rise">No scans in this period yet. Adjust the filters or run a scan in the field app.</div>
        ) : (
          <Charts rows={rows} empIndex={empIndex} hidden={viewerHidden} />
        )}

        {!loading && rows.length > 0 && <ScanTable rows={rows} hidden={viewerHidden} />}
        </>}
      </div>
    </>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="field" style={{ maxWidth: 180 }}>
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

/* ───────────────────────── KPI CARDS ───────────────────────── */

function counts(rows: Scan[]) {
  const now = new Date();
  const mStart = startOfMonth(now);
  const pStart = startOfMonth(subMonths(now, 1));
  const pEnd = endOfMonth(subMonths(now, 1));
  const t = format(now, "yyyy-MM-dd");
  const inRange = (r: Scan, a: Date, b: Date) => {
    const d = new Date(r.created_at);
    return d >= a && d <= b;
  };
  return {
    total: rows.length,
    month: rows.filter((r) => inRange(r, mStart, now)).length,
    prev: rows.filter((r) => inRange(r, pStart, pEnd)).length,
    today: rows.filter((r) => r.created_at.slice(0, 10) === t).length,
  };
}

function Kpis({ allTime, filtered, showBalance, orgLimit, orgValidFrom }: { allTime: Scan[]; filtered: Scan[]; showBalance: boolean; orgLimit: number | null; orgValidFrom?: string | null }) {
  const scanC = counts(allTime);
  const docSet = (rows: Scan[]) => new Set(rows.map((r) => r.doctor_code || r.doctor_name).filter(Boolean)).size;
  const now = new Date();
  const mStart = startOfMonth(now);
  const pStart = startOfMonth(subMonths(now, 1));
  const pEnd = endOfMonth(subMonths(now, 1));
  const t = format(now, "yyyy-MM-dd");
  const docs = {
    total: docSet(allTime),
    month: docSet(allTime.filter((r) => new Date(r.created_at) >= mStart)),
    prev: docSet(allTime.filter((r) => { const d = new Date(r.created_at); return d >= pStart && d <= pEnd; })),
    today: docSet(allTime.filter((r) => r.created_at.slice(0, 10) === t)),
  };
  const limit = orgLimit ?? SCAN_TARGET;
  // Balance counts scans only since the org's valid_from (reset window).
  const sinceTs = orgValidFrom ? new Date(`${orgValidFrom}T00:00:00`).getTime() : 0;
  const usedSince = sinceTs
    ? allTime.filter((r) => new Date(r.created_at).getTime() >= sinceTs).length
    : scanC.total;
  const balance = Math.max(0, limit - usedSince);
  const pctUsed = Math.min(100, (usedSince / Math.max(1, limit)) * 100);
  const R = 40, C = 2 * Math.PI * R;

  return (
    <div className="kpi-grid rise">
      <div className="glass kpi" style={{ ["--kpi-accent" as string]: "linear-gradient(90deg,#2dd4bf,#38bdf8)" }}>
        <div className="label">Total scans</div>
        <div className="value">{scanC.total.toLocaleString()}</div>
        <div className="subs">
          <span>This month <b>{scanC.month}</b></span>
          <span>Prev <b>{scanC.prev}</b></span>
          <span>Today <b>{scanC.today}</b></span>
        </div>
      </div>
      <div className="glass kpi" style={{ ["--kpi-accent" as string]: "linear-gradient(90deg,#8b5cf6,#fb7185)" }}>
        <div className="label">Doctors engaged</div>
        <div className="value">{docs.total.toLocaleString()}</div>
        <div className="subs">
          <span>This month <b>{docs.month}</b></span>
          <span>Prev <b>{docs.prev}</b></span>
          <span>Today <b>{docs.today}</b></span>
        </div>
      </div>
      <div className="glass kpi" style={{ ["--kpi-accent" as string]: "linear-gradient(90deg,#fbbf24,#fb7185)" }}>
        <div className="label">In current view</div>
        <div className="value">{filtered.length.toLocaleString()}</div>
        <div className="subs"><span>Scans matching the active filters</span></div>
      </div>
      {showBalance && (
        <div className="glass kpi" style={{ ["--kpi-accent" as string]: "linear-gradient(90deg,#38bdf8,#8b5cf6)" }}>
          <div className="label">Scans balance</div>
          <div className="ring-wrap" style={{ marginTop: 6 }}>
            <div className="ring">
              <svg width="92" height="92" viewBox="0 0 92 92">
                <defs>
                  <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#2dd4bf" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
                <circle cx="46" cy="46" r={R} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="9" />
                <circle
                  cx="46" cy="46" r={R} fill="none" stroke="url(#ringGrad)" strokeWidth="9"
                  strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pctUsed / 100)}
                  style={{ transition: "stroke-dashoffset 0.8s ease" }}
                />
              </svg>
              <div className="ring-num">{Math.round(pctUsed)}%</div>
            </div>
            <div>
              <div className="value" style={{ fontSize: 26 }}>{balance.toLocaleString()}</div>
              <div className="subs"><span>remaining of <b>{limit.toLocaleString()}</b></span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── CHARTS ───────────────────────── */

const tooltipStyle = {
  background: "#ffffff", border: "1px solid rgba(11,18,38,0.12)",
  borderRadius: 12, color: "#0b1226", fontSize: 12.5,
};

function Charts({ rows, empIndex, hidden }: { rows: Scan[]; empIndex: Map<string, Employee>; hidden?: Set<string> }) {
  const [gran, setGran] = useState<"day" | "week" | "month">("day");

  const trend = useMemo(() => {
    const bucket = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.created_at);
      const key =
        gran === "day" ? format(d, "dd MMM") :
        gran === "week" ? `W${format(d, "II · MMM")}` :
        format(d, "MMM yyyy");
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    }
    return Array.from(bucket, ([name, scansN]) => ({ name, scans: scansN })).reverse();
  }, [rows, gran]);

  const byField = (get: (r: Scan) => string | null | undefined, top = 10) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = get(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, top);
  };

  const regions = byField((r) => r.employee_region);
  const hqs = byField((r) => r.employee_hq);
  const leaders = byField((r) => (r.employee_name ? `${r.employee_name}` : r.employee_code), 15);
  const doctors = byField((r) => r.doctor_name, 10);
  const specs = byField((r) => r.doctor_speciality, 8);
  const gender = byField((r) => (r.sex === "M" ? "Male" : r.sex === "F" ? "Female" : null), 2);
  const ages = AGE_BANDS.map((b) => ({
    name: b.label,
    count: rows.filter((r) => r.age != null && r.age >= b.min && r.age <= b.max).length,
  }));

  const vitalsTrend = useMemo(() => {
    const keys = discoverResultKeys(rows)
      .filter((k) => !hidden?.has(k))
      .filter((k) => rows.some((r) => typeof resultValue(r, k) === "number"))
      .slice(0, 3);
    if (!keys.length) return { keys: [] as string[], data: [] as Record<string, unknown>[] };
    const bucket = new Map<string, { n: number; sums: number[] }>();
    for (const r of rows) {
      const day = format(new Date(r.created_at), "dd MMM");
      const e = bucket.get(day) ?? { n: 0, sums: keys.map(() => 0) };
      let counted = false;
      keys.forEach((k, i) => {
        const v = resultValue(r, k);
        if (typeof v === "number") { e.sums[i] += v; counted = true; }
      });
      if (counted) e.n += 1;
      bucket.set(day, e);
    }
    const data = Array.from(bucket, ([name, e]) => {
      const row: Record<string, unknown> = { name };
      keys.forEach((k, i) => { row[prettyKey(k)] = e.n ? +(e.sums[i] / e.n).toFixed(1) : null; });
      return row;
    }).reverse();
    return { keys: keys.map(prettyKey), data };
  }, [rows]);

  return (
    <>
      <div className="grid-2 rise">
        <div className="glass panel" style={{ gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <h3>Scans over time</h3>
              <p className="hint">Every completed face vitals scan in the selected period</p>
            </div>
            <div className="seg">
              {(["day", "week", "month"] as const).map((g) => (
                <button key={g} className={gran === g ? "on" : ""} onClick={() => setGran(g)}>
                  {g[0].toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trend} margin={{ left: -18, right: 8, top: 10 }}>
              <defs>
                <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(11,18,38,0.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#0b1226", fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#0b1226", fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="scans" stroke="#2dd4bf" strokeWidth={2.5} fill="url(#areaG)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <BarPanel title="Scans by region" hint="Employee region on each scan" data={regions} color="#38bdf8" />
        <BarPanel title="Scans by HQ" hint="Top headquarters by scan count" data={hqs} color="#8b5cf6" />
        <BarPanel title="Employee leaderboard" hint="Top 15 field employees by scans" data={leaders} color="#2dd4bf" tall />
        <BarPanel title="Top doctors engaged" hint="Clinics with the most scans" data={doctors} color="#fb7185" tall />

        <div className="glass panel">
          <h3>Speciality split</h3>
          <p className="hint">Doctor speciality across scans</p>
          <DonutChart data={specs} />
        </div>
        <div className="glass panel">
          <h3>Patients</h3>
          <p className="hint">Gender and age distribution</p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: "1 1 180px", minWidth: 180 }}>
              <DonutChart data={gender} height={180} />
            </div>
            <div style={{ flex: "1 1 220px", minWidth: 220 }}>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={ages} margin={{ left: -22, top: 8 }}>
                  <CartesianGrid stroke="rgba(11,18,38,0.08)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#0b1226", fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#0b1226", fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {ages.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {vitalsTrend.keys.length > 0 && (
          <div className="glass panel" style={{ gridColumn: "1 / -1" }}>
            <h3>Average vitals trend</h3>
            <p className="hint">Daily average of the top measured parameters</p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={vitalsTrend.data} margin={{ left: -18, right: 8, top: 10 }}>
                <CartesianGrid stroke="rgba(11,18,38,0.08)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#0b1226", fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#0b1226", fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                {vitalsTrend.keys.map((k, i) => (
                  <Area key={k} type="monotone" dataKey={k} stroke={COLORS[i]} strokeWidth={2} fill="transparent" />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}

function BarPanel({ title, hint, data, color, tall }: { title: string; hint: string; data: Array<{ name: string; count: number }>; color: string; tall?: boolean }) {
  return (
    <div className="glass panel">
      <h3>{title}</h3>
      <p className="hint">{hint}</p>
      <ResponsiveContainer width="100%" height={tall ? 330 : 240}>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
          <CartesianGrid stroke="rgba(11,18,38,0.08)" horizontal={false} />
          <XAxis type="number" tick={{ fill: "#0b1226", fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fill: "#0b1226", fontSize: 12, fontWeight: 600 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="count" fill={color} radius={[0, 6, 6, 0]} barSize={16}>
            <LabelList dataKey="count" position="right" style={{ fill: "#0b1226", fontSize: 12, fontWeight: 700 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DonutChart({ data, height = 220 }: { data: Array<{ name: string; count: number }>; height?: number }) {
  if (!data.length) return <div className="empty">No data yet</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="name"
          innerRadius="48%"
          outerRadius="78%"
          paddingAngle={2}
          stroke="none"
          label={({ name, value }) => `${name}: ${value}`}
          labelLine={{ stroke: "#0b1226", strokeWidth: 1 }}
          style={{ fontSize: 12, fontWeight: 600, fill: "#0b1226" }}
        >
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 600, color: "#0b1226" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ───────────────────────── TABLE ───────────────────────── */

function ScanTable({ rows, hidden }: { rows: Scan[]; hidden?: Set<string> }) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const perPage = 25;

  const resultKeys = useMemo(() => discoverResultKeys(rows).filter((k) => !hidden?.has(k)).slice(0, 12), [rows, hidden]);

  const val = (r: Scan, k: string): unknown => {
    if (k.startsWith("res:")) return resultValue(r, k.slice(4));
    return (r as unknown as Record<string, unknown>)[k];
  };

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = val(a, sortKey), bv = val(b, sortKey);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  useEffect(() => setPage(0), [rows]);

  const pages = Math.ceil(sorted.length / perPage);
  const slice = sorted.slice(page * perPage, (page + 1) * perPage);

  const header = (label: string, key: string) => (
    <th
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
        else { setSortKey(key); setSortDir(-1); }
      }}
    >
      {label} {sortKey === key ? (sortDir === -1 ? "↓" : "↑") : ""}
    </th>
  );

  return (
    <section className="glass rise" style={{ overflow: "hidden" }}>
      <div style={{ padding: "18px 18px 6px" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: 15 }}>Individual scans</h3>
        <p className="hint" style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 8px" }}>
          {rows.length.toLocaleString()} scans in the current view · click a column to sort
        </p>
      </div>
      <div className="table-wrap" style={{ maxHeight: 560, overflowY: "auto" }}>
        <table>
          <thead>
            <tr>
              {header("Date", "created_at")}
              {header("Employee", "employee_name")}
              {header("Code", "employee_code")}
              {header("HQ", "employee_hq")}
              {header("Doctor", "doctor_name")}
              {header("Speciality", "doctor_speciality")}
              {header("City", "doctor_city")}
              {header("Age", "age")}
              {header("Sex", "sex")}
              {header("Ht", "height_cm")}
              {header("Wt", "weight_kg")}
              {header("Waist", "waist_in")}
              {resultKeys.map((k) => header(prettyKey(k), `res:${k}`))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id}>
                <td>{format(new Date(r.created_at), "dd MMM · hh:mm a")}</td>
                <td>{r.employee_name ?? "—"}</td>
                <td>{r.employee_code ?? "—"}</td>
                <td>{r.employee_hq ?? "—"}</td>
                <td>{r.doctor_name ?? "—"}</td>
                <td>{r.doctor_speciality ?? "—"}</td>
                <td>{r.doctor_city ?? "—"}</td>
                <td>{r.age ?? "—"}</td>
                <td>{r.sex ?? "—"}</td>
                <td>{r.height_cm ?? "—"}</td>
                <td>{r.weight_kg ?? "—"}</td>
                <td>{r.waist_in ?? "—"}</td>
                {resultKeys.map((k) => {
                  const v = resultValue(r, k);
                  return <td key={k}>{v == null ? "—" : String(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>Page {page + 1} of {Math.max(1, pages)}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>← Prev</button>
          <button className="btn" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>Next →</button>
        </div>
      </div>
    </section>
  );
}
