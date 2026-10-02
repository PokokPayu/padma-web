"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { PANJANG_SANDI_MIN } from "@/lib/auth/daftar";
import { InputSandi } from "@/app/_auth/input-sandi";

export function FormAturSandi() {
  const [sandi, setSandi] = useState("");
  const [ulangi, setUlangi] = useState("");
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const supabase = createBrowserSupabase();

  async function simpanSandi(e: React.FormEvent) {
    e.preventDefault();
    setPesan(null);

    if (sandi.length < PANJANG_SANDI_MIN) {
      setPesan(`Kata sandi minimal ${PANJANG_SANDI_MIN} karakter.`);
      return;
    }
    if (sandi !== ulangi) {
      setPesan("Kedua kata sandi belum sama. Coba ketik ulang.");
      return;
    }

    setSibuk(true);
    const { error } = await supabase.auth.updateUser({ password: sandi });
    if (error) {
      // Sesi pemulihan ini datang dari tautan email yang berumur pendek;
      // kalau gagal, sebab paling mungkin adalah tautannya sudah kedaluwarsa
      // atau sudah dipakai — bukan sesuatu yang perlu dibedah ke pengguna,
      // cukup ajakan mengulang dari `/lupa-sandi`.
      setPesan("Tautan ini sudah kedaluwarsa atau sudah dipakai. Minta tautan baru dari halaman lupa sandi.");
      setSibuk(false);
      return;
    }

    window.location.assign("/setelah-masuk");
  }

  return (
    <form onSubmit={simpanSandi} className="space-y-4">
      <InputSandi label="Kata sandi baru" value={sandi} onChange={setSandi} />
      <InputSandi label="Ulangi kata sandi baru" value={ulangi} onChange={setUlangi} />
      {pesan && <p className="text-sm text-clay">{pesan}</p>}
      <button
        type="submit"
        disabled={sibuk}
        className="w-full rounded-lg bg-night py-3 font-bold text-gold-pale disabled:opacity-50"
      >
        {sibuk ? "Menyimpan..." : "Simpan kata sandi baru"}
      </button>
    </form>
  );
}
