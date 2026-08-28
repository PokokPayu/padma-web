"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function FormMasuk() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const supabase = createBrowserSupabase();

  async function masukEmail(e: React.FormEvent) {
    e.preventDefault();
    setSibuk(true);
    setPesan(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setPesan("Email atau kata sandi salah. Coba lagi, atau hubungi admin PADMA.");
      setSibuk(false);
      return;
    }
    window.location.assign("/setelah-masuk");
  }

  async function masukGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <form onSubmit={masukEmail} className="space-y-4">
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Email</span>
        <input
          type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Kata sandi</span>
        <input
          type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      {pesan && <p className="text-sm text-clay">{pesan}</p>}
      <button
        type="submit" disabled={sibuk}
        className="w-full rounded-lg bg-night py-3 font-bold text-gold-pale disabled:opacity-50"
      >
        {sibuk ? "Memproses..." : "Masuk"}
      </button>
      <button
        type="button" onClick={masukGoogle}
        className="w-full rounded-lg border border-black/15 bg-white py-3 font-bold"
      >
        Masuk dengan Google
      </button>
    </form>
  );
}
