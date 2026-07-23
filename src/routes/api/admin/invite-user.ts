import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.ONEVIEW_SERVICE_ROLE_KEY ?? "";
const PUBLISHABLE = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

type Payload = {
  action?: "create" | "set_role" | "remove";
  user_id?: string;
  email?: string;
  org_code?: string;
  role?: "org_admin" | "org_user" | "super_admin";
  mode?: "invite" | "password";
  password?: string;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function getAdmin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE_URL or ONEVIEW_SERVICE_ROLE_KEY");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const Route = createFileRoute("/api/admin/invite-user")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Server missing SUPABASE_URL or ONEVIEW_SERVICE_ROLE_KEY" });

        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return json(401, { error: "Missing Authorization bearer token" });

        // Verify caller with the public anon client
        const publicClient = createClient(SUPABASE_URL, PUBLISHABLE, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: userData, error: userErr } = await publicClient.auth.getUser(token);
        if (userErr || !userData?.user) return json(401, { error: "Invalid session" });
        const me = userData.user;

        // Look up caller access
        const admin = getAdmin();
        const { data: daRows, error: daErr } = await admin
          .from("dashboard_access")
          .select("role,org_code")
          .eq("user_id", me.id)
          .single();
        if (daErr || !daRows) return json(403, { error: "No dashboard access" });
        const callerRole: string = daRows.role;
        const callerOrg: string | null = daRows.org_code ?? null;
        if (callerRole !== "super_admin") {
          return json(403, { error: "Only the super admin can manage logins" });
        }

        // Validate input
        let body: Payload = {};
        try { body = (await request.json()) as Payload; } catch { return json(400, { error: "Invalid JSON" }); }
        const action = body.action ?? "create";

        if (action === "set_role") {
          const uid = (body.user_id ?? "").trim();
          const newRole = body.role ?? "org_admin";
          if (!uid) return json(400, { error: "user_id required" });
          const { error } = await admin.from("dashboard_access").update({
            role: newRole,
            org_code: newRole === "super_admin" ? null : (body.org_code ?? callerOrg),
          }).eq("user_id", uid);
          if (error) return json(500, { error: error.message });
          return json(200, { ok: true });
        }

        if (action === "remove") {
          const uid = (body.user_id ?? "").trim();
          if (!uid) return json(400, { error: "user_id required" });
          if (uid === me.id) return json(400, { error: "You cannot remove your own super admin login" });
          await admin.from("dashboard_access").delete().eq("user_id", uid);
          const { error } = await admin.auth.admin.deleteUser(uid);
          if (error) return json(500, { error: error.message });
          return json(200, { ok: true });
        }

        const email = (body.email ?? "").trim().toLowerCase();
        const org_code = (body.org_code ?? "").trim();
        const role = body.role ?? "org_admin";
        const mode = body.mode ?? "invite";
        if (!email) return json(400, { error: "Email required" });
        if ((role === "org_admin" || role === "org_user") && !org_code) return json(400, { error: "Org code required" });

        // Only super_admin reaches here (guarded above), so no per-org scoping needed.
        void callerOrg;


        if (mode === "password" && (!body.password || body.password.length < 8)) {
          return json(400, { error: "Password must be 8+ chars" });
        }

        // 4) Create or find the auth user
        let userId: string | null = null;
        if (mode === "password") {
          const { data: cData, error: cError } = await admin.auth.admin.createUser({
            email,
            password: body.password,
            email_confirm: true,
          });
          if (cError) {
            const msg = cError.message.toLowerCase();
            if (msg.includes("already") || msg.includes("exists") || msg.includes("duplicate")) {
              const { data: list, error: listErr } = await admin.auth.admin.listUsers();
              if (listErr) return json(500, { error: listErr.message });
              const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
              if (!existing) return json(500, { error: "User reported as existing but could not be found" });
              userId = existing.id;
              const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
                password: body.password,
                email_confirm: true,
              });
              if (updErr) return json(500, { error: updErr.message });
            } else {
              return json(500, { error: cError.message });
            }
          } else {
            userId = cData.user?.id ?? null;
          }
        } else {
          const { data: iData, error: iError } = await admin.auth.admin.inviteUserByEmail(email);
          if (iError) return json(500, { error: iError.message });
          userId = iData?.user?.id ?? null;
        }

        if (!userId) return json(500, { error: "Could not resolve user id" });

        // 5) Upsert dashboard_access
        const { error: upErr } = await admin.from("dashboard_access").upsert(
          { user_id: userId, role, org_code: role === "super_admin" ? null : org_code, email },
          { onConflict: "user_id" },
        );
        if (upErr) return json(500, { error: upErr.message });

        return json(200, { ok: true, user_id: userId, mode });
      },
    },
  },
});
