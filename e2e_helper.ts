import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const KEY = process.env.ONEVIEW_SERVICE_ROLE_KEY ?? "";

if (!URL || !KEY) {
  console.error("Missing VITE_SUPABASE_URL or ONEVIEW_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function findUserByEmail(email: string) {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  return (data?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
}

async function cleanup(email: string, orgCode: string) {
  const user = await findUserByEmail(email);
  if (user) {
    await admin.from("dashboard_access").delete().eq("user_id", user.id);
    await admin.auth.admin.deleteUser(user.id);
  }
  await admin.from("scan_submissions").delete().eq("org_code", orgCode);
  await admin.from("scan_links").delete().eq("org_code", orgCode);
  await admin.from("org_products").delete().eq("org_code", orgCode);
  await admin.from("organizations").delete().eq("code", orgCode);
  console.log("cleaned", email, orgCode);
}

async function insertScan(orgCode: string, productCode: string) {
  const row = {
    org_code: orgCode,
    scan_type: productCode,
    ref_code: `REF-E2E-${Date.now()}`,
    consent_version: "v1.0",
    consented: true,
    age: 34,
    sex: "M",
    height_cm: 175,
    weight_kg: 72,
    waist_in: 32,
    employee_code: "E2E001",
    employee_name: "E2E Test Employee",
    employee_hq: "Mumbai",
    employee_region: "West",
    doctor_code: "DR001",
    doctor_name: "Dr. E2E",
    doctor_speciality: "Cardiology",
    doctor_city: "Mumbai",
    results: {
      bloodPressure: "120/80",
      heartRate: 72,
      spO2: 98,
      respiratoryRate: 16,
      temperature: 98.6,
      stress: "low",
      bmi: 23.5,
      hemoglobin: 13.5,
      glucose: 92,
      cholesterol: 180,
      hrv: 55,
      sdnn: 45,
      riskScore: 2,
    },
  };
  const { data, error } = await admin.from("scan_submissions").insert(row).select().single();
  if (error) throw error;
  console.log("inserted", data.id);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "cleanup" && args.length === 2) await cleanup(args[0], args[1]);
  else if (cmd === "insert" && args.length === 2) await insertScan(args[0], args[1]);
  else {
    console.error("Usage: bun run e2e_helper.ts cleanup <email> <orgCode> | insert <orgCode> <productCode>");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
