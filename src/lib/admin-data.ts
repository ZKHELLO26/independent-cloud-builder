import { supabase } from "./vitals-data";

export type ScanProduct = {
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  active: boolean;
  /** Published URL of the scan app for this tool, e.g. https://scan.zeikon.app.
   *  Used as the base for all generated links (client-level Scan URL overrides it). */
  default_url?: string | null;
};

export type OrgProduct = {
  org_code: string;
  product_code: string;
  scan_url: string | null;
  monthly_limit: number;
  valid_from: string | null;
  valid_to: string | null;
  enabled: boolean;
};

export async function fetchProducts(): Promise<ScanProduct[]> {
  const { data, error } = await supabase.from("scan_products").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as ScanProduct[];
}

export async function upsertProduct(p: Partial<ScanProduct> & { code: string; name: string }) {
  const { error } = await supabase.from("scan_products").upsert(p, { onConflict: "code" });
  if (error) throw error;
}

export async function deleteProduct(code: string) {
  const { error } = await supabase.from("scan_products").delete().eq("code", code);
  if (error) throw error;
}

export async function fetchOrgProducts(org?: string): Promise<OrgProduct[]> {
  let q = supabase.from("org_products").select("*");
  if (org) q = q.eq("org_code", org);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OrgProduct[];
}

export async function upsertOrgProduct(op: OrgProduct) {
  const { error } = await supabase.from("org_products").upsert(op, {
    onConflict: "org_code,product_code",
  });
  if (error) throw error;
}

export async function removeOrgProduct(org: string, product: string) {
  const { error } = await supabase.from("org_products").delete()
    .eq("org_code", org).eq("product_code", product);
  if (error) throw error;
}

export async function upsertOrg(o: {
  code: string; name: string; active?: boolean;
  monthly_scan_limit?: number | null; valid_from?: string | null; valid_to?: string | null;
}) {
  const { error } = await supabase.from("organizations").upsert(o, { onConflict: "code" });
  if (error) throw error;
}

/** Count scans for org+product within an optional validity window (or all-time). */
export async function fetchUsage(
  org: string, product: string,
  validFrom?: string | null, validTo?: string | null,
): Promise<number> {
  let q = supabase
    .from("scan_submissions")
    .select("id", { count: "exact", head: true })
    .eq("org_code", org)
    .eq("scan_type", product);
  if (validFrom) q = q.gte("created_at", `${validFrom}T00:00:00`);
  if (validTo)   q = q.lte("created_at", `${validTo}T23:59:59`);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}
/** @deprecated use fetchUsage */
export const fetchMonthUsage = fetchUsage;

export type OrgUser = {
  user_id: string;
  email: string | null;
  role: "super_admin" | "org_admin" | "org_user";
  org_code: string | null;
};

export async function fetchOrgUsers(org?: string): Promise<OrgUser[]> {
  let q = supabase.from("dashboard_access").select("user_id, email, role, org_code");
  if (org) q = q.eq("org_code", org);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OrgUser[];
}

async function callUserApi(payload: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, error: "Not signed in" };
  try {
    const res = await fetch("/api/admin/invite-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export function setUserRole(user_id: string, role: OrgUser["role"], org_code: string | null) {
  return callUserApi({ action: "set_role", user_id, role, org_code });
}

export function removeUser(user_id: string) {
  return callUserApi({ action: "remove", user_id });
}

/** Delete a client entirely (org row cascades to tools & links). */
export async function deleteOrg(code: string) {
  await supabase.from("dashboard_access").delete().eq("org_code", code);
  const { error } = await supabase.from("organizations").delete().eq("code", code);
  if (error) throw error;
}

/** Invite / create a client login via server route. */
export async function inviteClientUser(payload: {
  email: string;
  org_code: string;
  role?: "org_admin" | "org_user" | "super_admin";
  mode: "invite" | "password";
  password?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, error: "Not signed in" };
  try {
    const res = await fetch("/api/admin/invite-user", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}
