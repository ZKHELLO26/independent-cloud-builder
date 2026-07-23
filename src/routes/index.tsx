import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/vitals-data";
import Dashboard from "@/features/Dashboard";
import "@/dashboard.css";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "OneView Dashboard" },
      { name: "description", content: "OneView — unified admin dashboard for every AI health scan. KPIs, clients, tools, and exports in one place." },
      { property: "og:title", content: "OneView Dashboard" },
      { property: "og:description", content: "OneView — unified admin dashboard for every AI health scan. KPIs, clients, tools, and exports in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="aurora" />;
  return session ? <Dashboard /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setErr(error.code === "invalid_credentials"
        ? "Invalid email or password. Confirm the user exists in Supabase Authentication → Users and reset the password if needed."
        : `Sign in failed: ${error.message}`);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="aurora" />
      <div className="login-hero">
        <form className="glass login-card rise"
          onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
          <div className="brand" style={{ justifyContent: "center" }}>
            <div>
              <h1 style={{ fontSize: 28, textAlign: "center" }}>
                <span className="grad-text">OneView</span>
              </h1>
              <small style={{ display: "block", textAlign: "center" }}>Analytics dashboard</small>
            </div>
          </div>
          <p>Sign in to view scan analytics</p>
          <input type="email" placeholder="Email" value={email} autoComplete="username" onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
          {err && <div className="err">{err}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </>
  );
}
