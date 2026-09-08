"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function FormLupaSandi() {
  const [email, setEmail] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const supabase = createBrowserSupabase();

  async function kirimTautan(e: React.FormEvent) {
    e.preventDefault();
    setSibuk(true);

    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/atur-sandi`,
    });

    // SATU kalimat untuk SEMUA hasil — galatnya SENGAJA tidak dibaca, entah
    // email itu terdaftar, tidak terdaftar, atau permintaannya gagal karena
    // sebab lain. PADMA melayani perempuan yang sedang hamil, nifas, atau
    // menjalani program kehamilan; balasan yang membedakan "terdaftar" dari
    // "tidak" mengubah halaman ini jadi alat menebak siapa saja yang sudah
    // jadi klien PADMA — pola yang sama dengan pesan seragam di `/daftar`
    // dan `/periksa-email`. JANGAN "perbaiki" ini jadi pesan spesifik meski
    // terasa lebih ramah.
    setPesan(
      "Bila email itu terdaftar, tautan pemulihan sudah kami kirim. Periksa kotak masuk dan folder spam Anda.",
    );
    setSibuk(false);
  }

  return (
    <form onSubmit={kirimTautan} className="space-y-4">
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      {pesan && <p className="text-sm text-ink-soft">{pesan}</p>}
      <button
        type="submit"
        disabled={sibuk}
        className="w-full rounded-lg bg-night py-3 font-bold text-gold-pale disabled:opacity-50"
      >
        {sibuk ? "Mengirim..." : "Kirim tautan pemulihan"}
      </button>
    </form>
  );
}
