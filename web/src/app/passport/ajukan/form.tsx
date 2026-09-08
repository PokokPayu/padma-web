"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ajukanJadwal } from "@/lib/passport/aksi";
import { formatJam } from "@/lib/jadwal/jam";

// Formulir hanya mengirim keinginan klien (layanan, tanggal, preferensi waktu,
// catatan). Status permintaan bukan urusan formulir ini: ia ditetapkan server
// dan dikunci trigger basis data.
const WAKTU = ["pagi", "siang", "sore"] as const;

export type VarianPilihan = { id: string; serviceId: string; label: string };

export function FormAjukan({
  layanan,
  varian,
  jamPilihan,
  tanggalPalingAwal,
  alamatDefault,
}: {
  layanan: Array<{ id: string; nama: string }>;
  // Varian AKTIF seluruh layanan, disaring per layanan terpilih di klien —
  // wizard butuh keduanya bersamaan supaya pilihan kedua bisa berubah tanpa
  // round-trip ke server saat layanan diganti.
  varian: VarianPilihan[];
  // Jam mulai yang boleh dipilih, dari `app_settings.jam_layanan` (spec J2).
  // Dibaca di server dan dipakai ULANG sebagai pagar di `ajukanJadwal`, jadi
  // apa yang ditawarkan di sini dan apa yang diterima server tidak pernah bisa
  // berselisih. Tidak pernah kosong: `uraikanDaftarJam()` menjamin itu.
  jamPilihan: string[];
  // String 'YYYY-MM-DD' menurut kalender Jakarta, dirakit di server. Jangan
  // menghitungnya di browser: jam perangkat pemakai bisa apa saja.
  tanggalPalingAwal: string;
  // Alamat PROFIL klien (bisa "" bila belum pernah diisi) — hanya isian AWAL
  // (Ruling 9 T6). Medan tetap `<textarea>` biasa yang bisa diketik ulang;
  // apa pun yang terkirim di FormData saat submit itulah yang tersimpan,
  // bukan nilai prop ini.
  alamatDefault: string;
}) {
  const [pending, mulai] = useTransition();
  const [waktu, setWaktu] = useState<(typeof WAKTU)[number]>("pagi");
  const [jam, setJam] = useState(jamPilihan[0] ?? "");
  const [layananId, setLayananId] = useState(layanan[0]?.id ?? "");
  const varianLayanan = varian.filter((v) => v.serviceId === layananId);
  const [varianId, setVarianId] = useState(varianLayanan[0]?.id ?? "");
  const [selesai, setSelesai] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  if (selesai) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-8 text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-leaf/25 bg-leaf-soft text-2xl text-leaf">
          ✓
        </span>
        <h1 className="font-serif text-xl text-night">Permintaan terkirim</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] text-[#415247]">
          Tim PADMA akan menghubungi Anda via WhatsApp untuk mengonfirmasi jadwal dan
          bidan yang datang.
        </p>
        <Link
          href="/passport"
          className="mt-5 inline-block rounded-xl border border-black/10 px-5 py-2.5 text-sm font-bold"
        >
          Kembali ke Beranda
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-6">
      <h1 className="mb-4 font-serif text-xl text-night">
        Ajukan Jadwal{" "}
        <span className="font-sans text-xs font-semibold text-ink-soft">
          tim PADMA mengonfirmasi via WhatsApp
        </span>
      </h1>

      <form
        action={(fd) => {
          fd.set("waktu", waktu);
          fd.set("varian", varianId);
          fd.set("jam", jam);
          mulai(async () => {
            const r = await ajukanJadwal(fd);
            if (r.ok) setSelesai(true);
            else setPesan(r.pesan);
          });
        }}
      >
        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Layanan</span>
          <select
            name="layanan"
            required
            value={layananId}
            onChange={(e) => {
              const id = e.target.value;
              setLayananId(id);
              // Varian terpilih ikut direset ke pilihan pertama layanan baru
              // — varian layanan sebelumnya tidak sah untuk layanan ini (FK
              // gabungan bakal menolaknya, dan pesannya sebaiknya tidak pernah
              // sampai lahir dari kombinasi yang tidak pernah dimaksud klien).
              setVarianId(varian.find((v) => v.serviceId === id)?.id ?? "");
            }}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-black/15 px-3 py-2.5"
          >
            {layanan.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nama}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Varian</span>
          <select
            name="varian"
            required
            value={varianId}
            onChange={(e) => setVarianId(e.target.value)}
            disabled={varianLayanan.length === 0}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-black/15 px-3 py-2.5"
          >
            {varianLayanan.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label === "" ? "Standar" : v.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Tanggal yang diinginkan</span>
          <input
            type="date"
            name="tanggal"
            min={tanggalPalingAwal}
            required
            className="mt-1 min-h-[44px] w-full rounded-lg border border-black/15 px-3 py-2.5"
          />
        </label>

        {/* Urutan medan mengikuti gambar alur klien: durasi -> tanggal -> JAM ->
            alamat -> catatan (spec J2). Jam berdiri SESUDAH tanggal karena
            keduanya satu keputusan: "kapan", dan memisahkannya dengan medan
            lain membuat klien memilih tanggal, lupa jam, lalu kembali. */}
        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Jam mulai</span>
          <select
            name="jam"
            required
            value={jam}
            onChange={(e) => setJam(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border border-black/15 px-3 py-2.5"
          >
            {jamPilihan.map((j) => (
              <option key={j} value={j}>
                {formatJam(j)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="mb-4">
          <legend className="text-sm font-semibold text-ink-soft">
            Kalau jam itu penuh, saya lebih suka
          </legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {WAKTU.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWaktu(w)}
                aria-pressed={waktu === w}
                className={`min-h-[44px] rounded-xl border px-2 py-3 text-[13px] font-semibold capitalize ${
                  waktu === w
                    ? "border-night bg-leaf-soft text-night"
                    : "border-black/15 bg-white text-ink-soft"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          {/* Arti medan ini BERUBAH di C1 (spec J2): dulu ia satu-satunya
              keterangan waktu, sekarang ia alternatif bila jam yang diminta
              tidak bisa. Kalimat di bawah ada supaya klien tidak mengira ia
              sedang memilih waktunya dua kali. */}
          <span className="mt-2 block text-[11.5px] text-ink-soft">
            Tim PADMA memakai ini saat menawarkan jam pengganti — jadwal Anda tetap jam yang
            dipilih di atas.
          </span>
        </fieldset>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Alamat kunjungan</span>
          {/* `defaultValue`, bukan `value` terkendali: sekali diisi dari
              profil, klien tetap mengetik bebas di atasnya — apa pun yang ada
              di medan ini saat submit itulah yang tersimpan (lihat komentar
              prop `alamatDefault`). */}
          <textarea
            name="alamat"
            required
            minLength={10}
            rows={2}
            defaultValue={alamatDefault}
            placeholder="Alamat lengkap tempat mitra datang"
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
          />
          <span className="mt-1 block text-xs text-ink-soft">
            {alamatDefault
              ? "Diisi otomatis dari alamat profil Anda — boleh diganti khusus untuk kunjungan ini."
              : "Belum ada alamat tersimpan di profil Anda — isi alamat tempat mitra datang untuk kunjungan ini."}
          </span>
        </label>

        <label className="mb-4 block text-sm">
          <span className="font-semibold text-ink-soft">Catatan (opsional)</span>
          <textarea
            name="catatan"
            rows={2}
            maxLength={300}
            placeholder="mis. tolong dengan Bidan Sri seperti biasa"
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5"
          />
        </label>

        {pesan && <p className="mb-3 text-sm text-clay">{pesan}</p>}

        <button
          type="submit"
          disabled={pending}
          className="min-h-[44px] w-full rounded-xl bg-gold py-3.5 font-bold text-[#FFF8EA] disabled:opacity-60"
        >
          {pending ? "Mengirim…" : "Kirim Permintaan Jadwal"}
        </button>
        <p className="mt-3 text-center text-xs text-ink-soft">
          Ini permintaan, bukan booking final — jadwal pasti dikonfirmasi tim PADMA
          bersama Anda via WhatsApp.
        </p>
      </form>
    </section>
  );
}
