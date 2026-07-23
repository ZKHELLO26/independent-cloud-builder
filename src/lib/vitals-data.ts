import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

export type Access = { role: "super_admin" | "org_admin" | "org_user"; org_code: string | null };
export type Org = {
  code: string;
  name: string;
  active?: boolean;
  monthly_scan_limit?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
};

export type Scan = {
  id: string;
  created_at: string;
  scan_type: string | null;
  org_code: string | null;
  age: number | null;
  sex: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  waist_in: number | null;
  employee_code: string | null;
  employee_name: string | null;
  employee_hq: string | null;
  employee_region: string | null;
  doctor_code: string | null;
  doctor_name: string | null;
  doctor_speciality: string | null;
  doctor_city: string | null;
  results: Record<string, unknown> | null;
  over_limit?: boolean;
  over_expiry?: boolean;
};

export type Employee = {
  emp_code: string;
  emp_name: string;
  designation: string | null;
  hq: string | null;
  region: string | null;
  zone: string | null;
};

export type Filters = {
  from: string; to: string;
  zone: string; region: string; hq: string;
  empCode: string; designation: string;
  speciality: string; gender: string; ageBand: string;
};

export const AGE_BANDS = [
  { key: "18-30", label: "18–30", min: 18, max: 30 },
  { key: "31-40", label: "31–40", min: 31, max: 40 },
  { key: "41-50", label: "41–50", min: 41, max: 50 },
  { key: "51-60", label: "51–60", min: 51, max: 60 },
  { key: "60+",   label: "60+",   min: 61, max: 200 },
] as const;

const SCAN_COLUMNS =
  "id, created_at, scan_type, org_code, age, sex, height_cm, weight_kg, waist_in, employee_code, employee_name, employee_hq, employee_region, doctor_code, doctor_name, doctor_speciality, doctor_city, results, over_limit, over_expiry";

export async function fetchAccess(): Promise<Access | null> {
  const { data, error } = await supabase.from("dashboard_access").select("role, org_code");
  if (error) throw error;
  const accessRows = (data ?? []) as Access[];
  return accessRows.find((row) => row.role === "super_admin")
    ?? accessRows.find((row) => row.role === "org_admin")
    ?? accessRows.find((row) => row.role === "org_user")
    ?? null;
}

export async function fetchOrgs(): Promise<Org[]> {
  const { data, error } = await supabase
    .from("organizations")
    .select("code, name, active, monthly_scan_limit, valid_from, valid_to")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Org[];
}

export async function fetchScans(from: string, to: string, org?: string): Promise<Scan[]> {
  const all: Scan[] = [];
  const page = 1000;
  for (let i = 0; i < 12; i++) {
    let q = supabase
      .from("scan_submissions")
      .select(SCAN_COLUMNS)
      .gte("created_at", `${from}T00:00:00`)
      .lte("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false })
      .range(i * page, i * page + page - 1);
    if (org) q = q.eq("org_code", org);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...((data ?? []) as Scan[]));
    if (!data || data.length < page) break;
  }
  return all;
}

export async function fetchEmployees(org?: string): Promise<Employee[]> {
  let q = supabase
    .from("employees_master")
    .select("emp_code, emp_name, designation, hq, region, zone")
    .order("emp_name");
  if (org) q = q.eq("org_code", org);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Employee[];
}

export function applyFilters(rows: Scan[], f: Filters, empIndex: Map<string, Employee>): Scan[] {
  const band = AGE_BANDS.find((b) => b.key === f.ageBand);
  return rows.filter((r) => {
    const emp = r.employee_code ? empIndex.get(r.employee_code) : undefined;
    if (f.zone && emp?.zone !== f.zone) return false;
    if (f.region && (r.employee_region || emp?.region) !== f.region) return false;
    if (f.hq && (r.employee_hq || emp?.hq) !== f.hq) return false;
    if (f.empCode && r.employee_code !== f.empCode) return false;
    if (f.designation && emp?.designation !== f.designation) return false;
    if (f.speciality && r.doctor_speciality !== f.speciality) return false;
    if (f.gender && r.sex !== f.gender) return false;
    if (band && !(r.age != null && r.age >= band.min && r.age <= band.max)) return false;
    return true;
  });
}

export function discoverResultKeys(rows: Scan[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) {
    if (!r.results) continue;
    for (const [k, v] of Object.entries(r.results)) {
      if (v == null) continue;
      if (typeof v === "object" && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          if (v2 != null && typeof v2 !== "object") keys.add(`${k}.${k2}`);
        }
      } else if (typeof v !== "object") keys.add(k);
    }
  }
  return Array.from(keys).sort();
}

export function resultValue(r: Scan, key: string): unknown {
  if (!r.results) return null;
  const [a, b] = key.split(".");
  const top = r.results[a];
  if (b == null) return typeof top === "object" ? null : top;
  if (top && typeof top === "object") return (top as Record<string, unknown>)[b] ?? null;
  return null;
}

export function prettyKey(k: string): string {
  return k.replace(/\./g, " · ").replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}


/** Translate raw database errors into plain-English guidance. */
export function friendlyError(raw: unknown): string {
  const m = String((raw as Error)?.message ?? raw ?? "Unknown error");
  const low = m.toLowerCase();
  if (low.includes("infinite recursion"))
    return "Database access rules are tangled. Fix: run ONEVIEW2_SETUP.sql once in Supabase → SQL Editor.";
  if (low.includes("permission denied") || low.includes("row-level security"))
    return "Your login doesn't have permission for this action. Fix: run ONEVIEW2_SETUP.sql once in Supabase → SQL Editor (with your email in the bottom section), then refresh.";
  if (low.includes("failed to fetch") || low.includes("network"))
    return "Couldn't reach the database. Check your internet connection and refresh.";
  if (low.includes("jwt") || low.includes("token"))
    return "Your session expired. Sign out and sign in again.";
  if (low.includes("duplicate key"))
    return "This already exists (duplicate). Use a different code/name.";
  return m;
}
