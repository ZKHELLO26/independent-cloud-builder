import { supabase, fetchScans, discoverResultKeys, prettyKey } from "./vitals-data";

export type ParamVisibility = {
  id: string;
  org_code: string | null;
  param_key: string;
  hidden: boolean;
  label: string | null;
};

export async function fetchVisibility(orgCode: string | null): Promise<ParamVisibility[]> {
  let q = supabase.from("parameter_visibility").select("*");
  if (orgCode === null) q = q.is("org_code", null);
  else q = q.eq("org_code", orgCode);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ParamVisibility[];
}

/** Fetch all visibility rules (global + all orgs) for use by the current viewer. */
export async function fetchAllVisibility(): Promise<ParamVisibility[]> {
  const { data, error } = await supabase.from("parameter_visibility").select("*");
  if (error) return [];
  return (data ?? []) as ParamVisibility[];
}

export async function setVisibility(
  orgCode: string | null,
  param_key: string,
  hidden: boolean,
  label?: string | null,
) {
  // Delete first to avoid COALESCE conflict handling issues, then insert.
  let del = supabase.from("parameter_visibility").delete().eq("param_key", param_key);
  del = orgCode === null ? del.is("org_code", null) : del.eq("org_code", orgCode);
  await del;
  const { error } = await supabase
    .from("parameter_visibility")
    .insert({ org_code: orgCode, param_key, hidden, label: label ?? null });
  if (error) throw error;
}

/** Discover every param key that has ever been written to scan_submissions.results for the given scope. */
export async function discoverParams(orgCode: string | null, sampleDays = 365): Promise<string[]> {
  const to = new Date();
  const from = new Date(to.getTime() - sampleDays * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const scans = await fetchScans(iso(from), iso(to), orgCode ?? undefined);
  return discoverResultKeys(scans);
}

/**
 * Return the set of param_keys that should be HIDDEN for a viewer with the given org_code.
 * Super-admins pass null → nothing is hidden.
 */
export function hiddenSet(vis: ParamVisibility[], orgCode: string | null): Set<string> {
  if (!orgCode) return new Set();
  const s = new Set<string>();
  // Global defaults first
  for (const v of vis) if (v.org_code === null && v.hidden) s.add(v.param_key);
  // Org-specific overrides (both directions)
  for (const v of vis) {
    if (v.org_code === orgCode) {
      if (v.hidden) s.add(v.param_key);
      else s.delete(v.param_key);
    }
  }
  return s;
}

export { prettyKey };
