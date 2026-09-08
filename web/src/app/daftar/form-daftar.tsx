"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { periksaPendaftaran } from "@/lib/auth/daftar";

export function FormDaftar() {
  const [nama, setNama] = useState("");
  const [email, setEmail] = useState("");
  const [noHp, setNoHp] = useState("");
  const [sandi, setSandi] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const supabase = createBrowserSupabase();

  async function daftarEmail(e: React.FormEvent) {
    e.preventDefault();
    setPesan(null);

    const hasil = periksaPendaftaran({ nama, email, noHp, sandi });
    if (!hasil.ok) {
      setPesan(hasil.pesan);
      return;
    }

    setSibuk(true);
    const { error } = await supabase.auth.signUp({
      email: hasil.nilai.email,
      password: sandi,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Nama mengalir ke profiles.nama lewat trigger handle_new_user yang
        // sudah ada; no_hp dibaca gerbang pastikanKlien saat menerbitkan
        // baris klien.
        data: { full_name: hasil.nilai.nama, no_hp: hasil.nilai.noHp },
      },
    });

    if (error) {
      // SATU kalimat untuk SEMUA sebab kegagalan — sengaja tidak dibedakan
      // "email sudah terdaftar" dari sebab lain. PADMA melayani perempuan
      // yang sedang hamil, nifas, atau menjalani program kehamilan; pesan
      // yang membedakan dua sebab itu mengubah halaman ini jadi alat
      // menebak siapa saja yang sudah jadi klien PADMA. JANGAN "perbaiki"
      // ini jadi pesan spesifik meski terasa lebih ramah pengguna.
      setPesan("Pendaftaran belum berhasil. Periksa kembali data Anda, atau coba masuk bila sudah punya akun.");
      setSibuk(false);
      return;
    }

    window.location.assign("/periksa-email");
  }

  async function daftarGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <form onSubmit={daftarEmail} className="space-y-4">
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Nama lengkap</span>
        <input
          type="text" required value={nama}
          onChange={(e) => setNama(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Email</span>
        <input
          type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">No. WhatsApp</span>
        <input
          type="tel" required value={noHp}
          onChange={(e) => setNoHp(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Kata sandi</span>
        <input
          type="password" required value={sandi}
          onChange={(e) => setSandi(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
        />
      </label>
      {pesan && <p className="text-sm text-clay">{pesan}</p>}
      <button
        type="submit" disabled={sibuk}
        className="w-full rounded-lg bg-night py-3 font-bold text-gold-pale disabled:opacity-50"
      >
        {sibuk ? "Memproses..." : "Daftar"}
      </button>
      <button
        type="button" onClick={daftarGoogle}
        className="w-full rounded-lg border border-black/15 bg-white py-3 font-bold"
      >
        Daftar dengan Google
      </button>
    </form>
  );
}
