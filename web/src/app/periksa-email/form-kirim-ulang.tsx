"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

/**
 * Tombol kirim ulang tautan konfirmasi email.
 *
 * Halaman ini dicapai dari DUA arah, dan itu yang menentukan bentuk formulir
 * ini:
 *   - baru saja mendaftar di `/daftar` — GoTrue TIDAK memberi sesi selama
 *     `enable_confirmations = true`, jadi tidak ada email yang bisa dibaca dari
 *     mana pun; pengguna harus mengetiknya;
 *   - login dengan akun yang emailnya belum terbukti — di sini ada sesi, dan
 *     mengetik ulang email yang sudah diketahui aplikasi hanya membuang waktu.
 * Karena itu medannya ada, tetapi diisikan lebih dulu bila sesinya ada.
 */
export function FormKirimUlang() {
  const [email, setEmail] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const supabase = createBrowserSupabase();

  useEffect(() => {
    let hidup = true;
    supabase.auth.getUser().then(({ data }) => {
      if (hidup && data.user?.email) setEmail(data.user.email);
    });
    return () => {
      hidup = false;
    };
  }, [supabase]);

  async function kirimUlang(e: React.FormEvent) {
    e.preventDefault();
    setSibuk(true);
    await supabase.auth.resend({ type: "signup", email });

    // SATU kalimat untuk semua hasil — persis alasan yang sama dengan pesan
    // kegagalan seragam di `/daftar`: membedakan "email itu ada" dari "tidak
    // ada" mengubah halaman ini menjadi alat menebak siapa saja klien PADMA.
    // Galatnya SENGAJA tidak dibaca. JANGAN "perbaiki" menjadi pesan spesifik
    // meski terasa lebih menolong.
    setPesan(
      "Bila alamat itu memang menunggu konfirmasi, tautan barunya sudah dikirim. Periksa kotak masuk dan folder spam Anda.",
    );
    setSibuk(false);
  }

  return (
    <form onSubmit={kirimUlang} className="space-y-4">
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
        {sibuk ? "Mengirim..." : "Kirim ulang tautan"}
      </button>
    </form>
  );
}
