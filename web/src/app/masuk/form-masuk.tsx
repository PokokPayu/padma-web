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
      <div className="text-right -mt-2">
        <a href="/lupa-sandi" className="text-[12.5px] font-semibold text-leaf underline">
          Lupa kata sandi?
        </a>
      </div>
      {pesan && <p className="text-sm text-clay">{pesan}</p>}
      {/*
        DITAMPILKAN TANPA SYARAT — dan itu bukan kemalasan, melainkan syaratnya.

        Sejak `enable_confirmations = true`, `signInWithPassword` atas akun yang
        belum dikonfirmasi memulangkan `email_not_confirmed` tanpa sesi. Orang
        yang mendaftar kemarin, menutup tabnya, dan kembali hari ini karena itu
        hanya membaca "Email atau kata sandi salah" lalu menelepon klinik —
        sementara /periksa-email yang dibuat untuknya tidak ditaut dari mana
        pun kecuali pengalihan sesudah pendaftaran.

        Yang TIDAK boleh dilakukan: memunculkan baris ini hanya ketika galatnya
        `email_not_confirmed`. Itu akan membuat halaman ini bisa membedakan
        "alamat ini terdaftar tapi belum dikonfirmasi" dari "alamat ini tidak
        dikenal" — kanal penghitungan akun yang sama persis dengan yang
        dihindari /lupa-sandi (K6) dengan menyamakan seluruh balasannya. PADMA
        melayani perempuan yang sedang hamil, nifas, atau menjalani promil;
        daftar siapa saja kliennya bukan sesuatu yang boleh ditanyakan lewat
        formulir login. Karena tampil untuk SEMUA orang, ia tidak menyatakan
        apa pun tentang alamat yang diketik.
      */}
      <p className="text-center text-[12.5px] text-ink-soft">
        Sudah mendaftar tapi belum mengonfirmasi email?{" "}
        <a href="/periksa-email" className="font-semibold text-leaf underline">
          Kirim ulang tautannya
        </a>
        .
      </p>
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
      <p className="text-center text-[13px] text-ink-soft">
        Belum punya akun?{" "}
        <a href="/daftar" className="font-semibold text-leaf underline">Daftar</a>
      </p>
    </form>
  );
}
