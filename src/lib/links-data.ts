import { supabase } from "./vitals-data";

export type LinkFields = Record<string, boolean>;

/** Form fields a scan link can show. Order matters for display. */
export const LINK_FIELD_DEFS: Array<{ key: string; label: string; def: boolean }> = [
  { key: "name",     label: "Name",            def: true },
  { key: "mobile",   label: "Mobile number",   def: true },
  { key: "email",    label: "Email",           def: false },
  { key: "age",      label: "Age",             def: true },
  { key: "gender",   label: "Gender",          def: true },
  { key: "height",   label: "Height",          def: true },
  { key: "weight",   label: "Weight",          def: true },
  { key: "waist",    label: "Waist",           def: true },
  { key: "employee", label: "Employee code (field-force)", def: false },
  { key: "doctor",   label: "Doctor selection (field-force)", def: false },
];

export function defaultLinkFields(): LinkFields {
  return Object.fromEntries(LINK_FIELD_DEFS.map((f) => [f.key, f.def]));
}

export type ScanLink = {
  id: string;
  token: string;
  org_code: string;
  product_code: string;
  label: string | null;
  expires_at: string | null;
  max_scans: number | null;
  used_scans: number;
  active: boolean;
  fields: LinkFields | null;
  created_at: string;
};

function randomToken(len = 10): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function fetchLinks(orgCode: string, productCode?: string): Promise<ScanLink[]> {
  let q = supabase
    .from("scan_links")
    .select("*")
    .eq("org_code", orgCode)
    .order("created_at", { ascending: false });
  if (productCode) q = q.eq("product_code", productCode);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ScanLink[];
}

export async function createLink(input: {
  org_code: string;
  product_code: string;
  label?: string | null;
  days_valid?: number | null;
  max_scans?: number | null;
  fields?: LinkFields | null;
}): Promise<ScanLink> {
  const expires_at = input.days_valid && input.days_valid > 0
    ? new Date(Date.now() + input.days_valid * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const row = {
    token: randomToken(10),
    org_code: input.org_code,
    product_code: input.product_code,
    label: input.label ?? null,
    expires_at,
    max_scans: input.max_scans && input.max_scans > 0 ? input.max_scans : null,
    fields: input.fields ?? defaultLinkFields(),
    active: true,
  };
  const { data, error } = await supabase.from("scan_links").insert(row).select().single();
  if (error) throw error;
  return data as ScanLink;
}

export async function updateLink(id: string, patch: Partial<Pick<ScanLink, "active" | "expires_at" | "max_scans" | "label" | "product_code" | "fields">>) {
  const { error } = await supabase.from("scan_links").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteLink(id: string) {
  const { error } = await supabase.from("scan_links").delete().eq("id", id);
  if (error) throw error;
}

/** Build the public scan URL. Set VITE_SCAN_HOST to your ScanHost app root. */
export function scanUrlFor(token: string, baseOverride?: string | null): string {
  const base = baseOverride
    || (import.meta.env.VITE_SCAN_HOST as string | undefined)
    || `${window.location.origin}`;
  return `${base.replace(/\/$/, "")}/s/${token}`;
}
