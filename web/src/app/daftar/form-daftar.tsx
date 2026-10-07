"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { InputSandi } from "@/app/_auth/input-sandi";
import { periksaPendaftaran } from "@/lib/auth/daftar";
import { titipPersetujuanDiPeramban } from "@/lib/persetujuan/cookie";

export function FormDaftar() {
  const [nama, setNama] = useState("");
  const [email, setEmail] = useState("");
  const [noHp, setNoHp] = useState("");
  const [sandi, setSandi] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [setuju, setSetuju] = useState(false);
  const supabase = createBrowserSupabase();

  async function daftarEmail(e: React.FormEvent) {
    e.preventDefault();
    setPesan(null);
    if (!setuju) {
      setPesan("Centang persetujuan Syarat & Ketentuan dan Kebijakan Privasi lebih dulu.");
      return;
    }

    const hasil = periksaPendaftaran({ nama, email, noHp, sandi });
    if (!hasil.ok) {
      setPesan(hasil.pesan);
      return;
    }

    setSibuk(true);
    // Dititipkan SEBELUM signUp: `/setelah-masuk` mencatatnya saat tautan
    // konfirmasi dibuka di peramban ini (spec 2026-10-06). Dibuka di perangkat
    // lain → cookie tidak ikut → gerbang /persetujuan yang menangkap.
    titipPersetujuanDiPeramban();
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
    if (!setuju) return;
    titipPersetujuanDiPeramban();
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
      <InputSandi label="Kata sandi" value={sandi} onChange={setSandi} />
      <label className="flex gap-3 text-sm text-ink-soft">
        <input
          type="checkbox" checked={setuju}
          onChange={(e) => setSetuju(e.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] shrink-0"
        />
        <span>
          Saya menyetujui{" "}
          <a href="/syarat-ketentuan" target="_blank" rel="noopener noreferrer" className="font-semibold text-leaf underline">
            Syarat & Ketentuan
          </a>{" "}
          dan{" "}
          <a href="/kebijakan-privasi" target="_blank" rel="noopener noreferrer" className="font-semibold text-leaf underline">
            Kebijakan Privasi
          </a>
          .
        </span>
      </label>
      {pesan && <p className="text-sm text-clay">{pesan}</p>}
      <button
        type="submit" disabled={sibuk || !setuju}
        className="w-full rounded-lg bg-night py-3 font-bold text-gold-pale disabled:opacity-50"
      >
        {sibuk ? "Memproses..." : "Daftar"}
      </button>
      <button
        type="button" onClick={daftarGoogle} disabled={!setuju}
        className="w-full rounded-lg border border-black/15 bg-white py-3 font-bold disabled:opacity-50"
      >
        Daftar dengan Google
      </button>
    </form>
  );
}
