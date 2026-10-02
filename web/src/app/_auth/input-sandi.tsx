"use client";

import { useState } from "react";

/**
 * KOLOM KATA SANDI DENGAN TOMBOL MATA — dipakai /masuk, /daftar, /atur-sandi.
 *
 * Dua pagar uji yang mengikat bentuknya:
 *
 * - `tests/panggung-auth.test.tsx` mencocokkan `<label><span>…</span><input`
 *   berurutan, jadi `<input>` harus anak langsung `<label>` tepat sesudah
 *   `<span>`-nya. Tombolnya karena itu diletakkan SESUDAH input dan
 *   diposisikan absolut terhadap `<label>`, bukan dibungkus `<div>` bersama
 *   input.
 * - Belasan skrip E2E mengisi formulir lewat `getByLabel("Kata sandi")`, yang
 *   mencocokkan sebagian teks dan juga membaca `aria-label`. Kalau label
 *   tombolnya memuat "kata sandi" (mis. "Tampilkan kata sandi"), pencari itu
 *   menemukan dua elemen dan Playwright gagal karena mode ketat. Karena itu
 *   labelnya cukup "Tampilkan sandi" / "Sembunyikan sandi".
 */
export function InputSandi({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (nilai: string) => void;
}) {
  const [terlihat, setTerlihat] = useState(false);

  return (
    <label className="relative block text-sm">
      <span className="font-semibold text-ink-soft">{label}</span>
      <input
        type={terlihat ? "text" : "password"}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-black/15 py-2.5 pl-3 pr-11"
      />
      <button
        type="button"
        onClick={() => setTerlihat((t) => !t)}
        aria-label={terlihat ? "Sembunyikan sandi" : "Tampilkan sandi"}
        className="absolute bottom-[3px] right-[3px] flex size-9 items-center justify-center rounded-md text-ink-soft hover:text-leaf focus-visible:outline-2 focus-visible:outline-leaf"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {terlihat && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </label>
  );
}
