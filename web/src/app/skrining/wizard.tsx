"use client";

import { useMemo, useState } from "react";
import {
  daftarSoal, levelSoal, LABEL_FASE, SOAL_UMUM,
  type FaseSkrining,
} from "@/lib/skrining/bank-soal";
// Modul murni tanpa dependensi server — aman diimpor di komponen klien.
// Dipakai HANYA untuk menampilkan hasil bila server gagal dihubungi;
// nilai yang tersimpan di DB tetap yang dihitung server (keputusan A).
import { nilaiSkrining } from "@/lib/skrining/evaluasi";

type Layar = "intro" | "soal" | "hasil";

type Hasil = {
  hasil: "hijau" | "merah";
  urgent: boolean;
  flags: string[];
  kode: string | null; // null = gagal simpan, funnel tetap jalan (keputusan C)
};

const FASE_PILIHAN: FaseSkrining[] = ["prekonsepsi", "kehamilan", "nifas", "menopause"];

export function Wizard({ nomorWaLink }: { nomorWaLink: string }) {
  const [layar, setLayar] = useState<Layar>("intro");
  const [nama, setNama] = useState("");
  const [hp, setHp] = useState("");
  const [jujur, setJujur] = useState(false);
  const [fase, setFase] = useState<FaseSkrining | null>(null);
  const [indeks, setIndeks] = useState(0);
  const [jawaban, setJawaban] = useState<Record<string, boolean>>({});
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const soal = useMemo(() => (fase ? daftarSoal(fase) : []), [fase]);
  const bolehMulai = Boolean(fase && nama.trim() && hp.trim() && jujur);

  async function selesai(jawabanFinal: Record<string, boolean>) {
    if (!fase) return;
    setSibuk(true);
    // Hitung tampilan lokal agar hasil tetap bisa ditampilkan walau server gagal.
    const lokal = nilaiSkrining(fase, jawabanFinal);
    let kode: string | null = null;
    try {
      const res = await fetch("/api/skrining", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nama, no_hp: hp, fase, jawaban: jawabanFinal }),
      });
      if (res.ok) kode = (await res.json()).kode;
    } catch {
      // Funnel tidak boleh mati (spec §8) — hasil tetap ditampilkan.
    }
    setHasil({
      hasil: lokal.hasil,
      urgent: lokal.urgent,
      flags: lokal.flags.map((f) => f.teks),
      kode,
    });
    setLayar("hasil");
    setSibuk(false);
  }

  function jawab(ya: boolean) {
    if (!fase) return;
    const s = soal[indeks];
    const baru = { ...jawaban, [s.id]: ya };
    setJawaban(baru);
    if (ya && levelSoal(s, fase) === "urgent") return void selesai(baru);
    if (indeks < soal.length - 1) setIndeks(indeks + 1);
    else void selesai(baru);
  }

  function kembali() {
    if (indeks === 0) return;
    const sebelumnya = soal[indeks - 1];
    const salinan = { ...jawaban };
    delete salinan[sebelumnya.id]; // hapus berdasarkan id, bukan teks
    setJawaban(salinan);
    setIndeks(indeks - 1);
  }

  if (layar === "intro") {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-7">
        <h2 className="font-serif text-xl text-night">Sebelum layanan dijadwalkan</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Skrining singkat ini membantu menentukan apakah layanan PADMA dapat
          dijadwalkan sekarang, atau sebaiknya diperiksa dokter lebih dulu demi
          keselamatan Anda.
        </p>

        <p className="mt-4 rounded-xl border border-black/10 bg-paper p-3.5 text-[13px]">
          <b>Bukan diagnosis medis.</b> Skrining ini hanya alat keselamatan awal
          untuk layanan wellness/homecare.
        </p>
        <p className="mt-3 rounded-xl border border-leaf/25 bg-leaf-soft p-3.5 text-[13px] text-[#28513C]">
          <b>Jawaban jujur tidak merugikan Anda.</b> Bila ada kondisi yang perlu
          perhatian, kami justru membantu mengarahkan agar layanan tetap aman —
          bukan menghukum atau mempersulit.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Nama panggilan</span>
            <input value={nama} onChange={(e) => setNama(e.target.value)}
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5" />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">No. WhatsApp</span>
            <input value={hp} onChange={(e) => setHp(e.target.value)} inputMode="tel"
              className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2.5" />
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink-soft">Tahap kehidupan Anda</legend>
          <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {FASE_PILIHAN.map((f) => (
              <button key={f} type="button" onClick={() => setFase(f)}
                aria-pressed={fase === f}
                className={`min-h-[52px] rounded-xl border px-3 py-3 text-sm font-semibold ${
                  fase === f ? "border-night bg-leaf-soft text-night" : "border-black/15 bg-white"
                }`}>
                {LABEL_FASE[f]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="mt-4 flex gap-3 rounded-xl border border-black/10 bg-paper-warm p-3.5 text-[13px]">
          <input type="checkbox" checked={jujur} onChange={(e) => setJujur(e.target.checked)}
            className="mt-0.5 h-[18px] w-[18px]" />
          <span>
            Saya menyatakan jawaban akan diisi sesuai kondisi saya <b>saat ini</b>,
            dan memahami bahwa tim PADMA tetap memverifikasi kondisi sebelum layanan.
          </span>
        </label>

        <button type="button" disabled={!bolehMulai} onClick={() => setLayar("soal")}
          className="mt-5 w-full rounded-xl bg-gold py-3.5 font-bold text-[#FFF8EA] disabled:opacity-45">
          Mulai Skrining
        </button>
      </section>
    );
  }

  if (layar === "soal" && fase) {
    const s = soal[indeks];
    const persen = Math.round(((indeks + 1) / soal.length) * 100);
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-7">
        <div className="mb-2 flex justify-between text-xs text-ink-soft">
          <span>Pertanyaan {indeks + 1} dari {soal.length}</span>
          <span>{persen}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
          <div className="h-full bg-gold transition-all" style={{ width: `${persen}%` }} />
        </div>

        <p className="mt-5 inline-block rounded-full border border-black/10 bg-paper px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-soft">
          {indeks < SOAL_UMUM.length ? "Skrining umum" : LABEL_FASE[fase]}
        </p>
        <p className="mt-3 font-serif text-xl leading-snug text-ink">{s.teks}</p>
        <p className="mt-2 min-h-[1.4em] text-[13px] text-ink-soft">{s.hint}</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => jawab(true)} disabled={sibuk}
            className="min-h-[56px] rounded-xl border border-black/15 bg-white font-extrabold hover:border-clay hover:bg-clay/10 hover:text-clay">
            Ya
          </button>
          <button type="button" onClick={() => jawab(false)} disabled={sibuk}
            className="min-h-[56px] rounded-xl border border-black/15 bg-white font-extrabold hover:border-leaf hover:bg-leaf-soft hover:text-leaf">
            Tidak
          </button>
        </div>

        <button type="button" onClick={kembali} disabled={indeks === 0}
          className="mt-4 text-sm font-bold text-leaf underline underline-offset-4 disabled:opacity-40">
          ← Kembali
        </button>
      </section>
    );
  }

  if (layar === "hasil" && hasil && fase) {
    const hijau = hasil.hasil === "hijau";
    const pesanWa = [
      "Halo PADMA, saya sudah mengisi Skrining Awal Klien.",
      "",
      hasil.kode ? `Kode: ${hasil.kode}` : "(kode tidak tersimpan)",
      `Nama: ${nama}`,
      `Tahap: ${LABEL_FASE[fase]}`,
      `Hasil: ${hijau ? "HIJAU — dapat dijadwalkan" : "MERAH — belum dapat dijadwalkan"}`,
      "",
      hijau
        ? "Saya ingin melanjutkan booking. Mohon dibantu jadwalnya ya 🙏"
        : "Saya akan memeriksakan diri ke dokter lebih dulu sesuai arahan skrining.",
    ].join("\n");

    return (
      <section className="rounded-2xl border border-black/10 bg-white p-7 text-center">
        <div className={`inline-block -rotate-3 rounded-lg border-[2.5px] px-5 py-3 font-serif text-base uppercase tracking-widest ${
          hijau ? "border-leaf text-leaf" : "border-clay text-clay"
        }`}>
          {hijau ? "Hijau · Dapat Dijadwalkan" : "Merah · Perlu Evaluasi Dokter"}
        </div>

        <h2 className="mt-4 font-serif text-2xl text-night">
          {hijau ? "Layanan dapat dijadwalkan" : "Layanan belum dapat dijadwalkan"}
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-[#415247]">
          {hijau
            ? "Dari jawaban Anda tidak ditemukan alasan untuk menunda layanan. Tim PADMA tetap akan mengonfirmasi kondisi Anda sebelum layanan dimulai."
            : hasil.urgent
              ? "Jawaban Anda memuat tanda yang perlu penanganan medis. Untuk keselamatan Anda, hentikan dulu rencana treatment dan segera hubungi dokter. Ini penundaan demi keselamatan — bukan penolakan."
              : "Ada jawaban yang sebaiknya diperiksa tenaga kesehatan lebih dulu. Setelah dinyatakan aman, layanan PADMA dapat dijadwalkan kembali."}
        </p>

        {hasil.kode && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-dashed border-gold px-4 py-1.5 text-xs font-semibold text-[#6B5A2E]">
            ✓ Tersimpan di sistem PADMA · Kode <span className="font-mono">{hasil.kode}</span>
          </p>
        )}

        {hasil.flags.length > 0 && (
          <div className="mt-4 rounded-xl border border-black/10 bg-paper p-4 text-left">
            <h3 className="text-[13px] font-extrabold">Hal yang perlu diperhatikan</h3>
            <ul className="mt-2 list-disc pl-5 text-[13px] text-[#54463C]">
              {hasil.flags.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
        )}

        {hasil.urgent && (
          <p className="mt-4 rounded-lg border-l-4 border-clay bg-[#FDF3EF] p-3.5 text-left text-[13px] text-[#77321F]">
            Bila gejala berat atau memburuk cepat — sesak napas, perdarahan banyak,
            pingsan, kejang, atau nyeri hebat — cari pertolongan gawat darurat atau
            hubungi <b>119</b> sekarang, jangan menunggu.
          </p>
        )}

        <a href={`https://wa.me/${nomorWaLink}?text=${encodeURIComponent(pesanWa)}`}
          target="_blank" rel="noopener"
          className="mt-5 block w-full rounded-xl bg-[#1FAF57] py-3.5 font-bold text-white">
          {hijau ? "Lanjut booking via WhatsApp" : "Beri tahu tim PADMA (opsional)"}
        </a>

        <p className="mt-4 text-[11.5px] text-ink-soft">
          Hasil ini adalah pra-skrining, bukan izin medis. Tim PADMA memverifikasi
          kondisi sebelum layanan.
        </p>
      </section>
    );
  }

  return null;
}
