"use client";

import { useState, useTransition } from "react";
import { nilaiSesi } from "@/lib/passport/aksi";

/**
 * Kartu penilaian sesudah sesi selesai (spec C1 J10).
 *
 * DUA baris bintang, bukan satu: "Bagaimana sesinya?" dan "Bagaimana bidannya?"
 * Dilebur jadi satu angka, layanan yang salah rancang terbaca sebagai bidan
 * yang buruk — dan di tim sekecil ini satu bidan mengerjakan banyak layanan,
 * jadi angka tercampur tidak adil pada orang yang nyata.
 *
 * Kartu ini BISA DIABAIKAN. Ia tidak menghadang apa pun, tidak muncul sebagai
 * dialog, dan hilang sendiri setelah 30 hari. Penilaian yang dipaksa adalah
 * penilaian yang diisi asal supaya layarnya pergi.
 *
 * TIDAK ADA rating aplikasi. Klien sempat memintanya; ditolak dan klien setuju.
 * Bintang untuk perangkat lunak tidak menunjuk apa pun yang bisa dikerjakan,
 * dan menit sesudah sesi di rumah klien adalah milik perawatannya.
 */
export function KartuNilai({
  sesiId,
  namaLayanan,
  namaMitra,
  tanggal,
}: {
  sesiId: string;
  namaLayanan: string;
  namaMitra: string;
  /** Sudah diformat untuk manusia di server. */
  tanggal: string;
}) {
  const [pending, mulai] = useTransition();
  const [layanan, setLayanan] = useState(0);
  const [bidan, setBidan] = useState(0);
  const [selesai, setSelesai] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  if (selesai) {
    return (
      <div className="mb-3.5 rounded-2xl border-[1.6px] border-leaf/30 bg-leaf-soft p-4 text-[13px]">
        <b className="block text-sm text-night">Terima kasih — penilaian Anda tersimpan</b>
        <span className="text-[#415247]">
          Hanya tim PADMA yang membacanya, dan ia dipakai untuk memperbaiki layanan.
        </span>
      </div>
    );
  }

  return (
    <form
      className="mb-3.5 rounded-2xl border-[1.6px] border-dotted border-gold bg-[#FDFAF1] p-4"
      data-kartu-nilai={sesiId}
      action={(fd) => {
        fd.set("sesi", sesiId);
        fd.set("bintang_layanan", String(layanan));
        fd.set("bintang_bidan", String(bidan));
        mulai(async () => {
          const r = await nilaiSesi(fd);
          if (r.ok) setSelesai(true);
          else setPesan(r.pesan);
        });
      }}
    >
      <b className="block text-sm text-night">Bagaimana sesi {namaLayanan} kemarin?</b>
      <span className="mb-3 block text-[11.5px] text-ink-soft">
        {tanggal} · bersama {namaMitra} — boleh dilewati
      </span>

      <BarisBintang
        label="Bagaimana sesinya?"
        nilai={layanan}
        setNilai={setLayanan}
        nama={`layanan-${sesiId}`}
      />
      <BarisBintang
        label={`Bagaimana ${namaMitra}?`}
        nilai={bidan}
        setNilai={setBidan}
        nama={`bidan-${sesiId}`}
      />

      <label className="mt-2 block text-[12.5px]">
        <span className="text-ink-soft">Ada yang ingin disampaikan? (opsional)</span>
        <textarea
          name="komentar"
          rows={2}
          maxLength={1000}
          className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2 text-[13px]"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-3 min-h-[40px] rounded-xl bg-gold px-5 py-2 text-[13px] font-bold text-night disabled:opacity-60"
      >
        {pending ? "Mengirim…" : "Kirim penilaian"}
      </button>
      {pesan && <p className="mt-2 text-[12px] font-semibold text-clay">{pesan}</p>}
    </form>
  );
}

/**
 * Satu baris bintang. `radio` sungguhan, bukan tombol ber-`onClick`: pembaca
 * layar mengumumkannya sebagai pilihan 1 dari 5, dan keyboard bisa
 * memindahkannya dengan panah tanpa kode tambahan.
 */
function BarisBintang({
  label,
  nilai,
  setNilai,
  nama,
}: {
  label: string;
  nilai: number;
  setNilai: (n: number) => void;
  nama: string;
}) {
  return (
    <fieldset className="mb-2">
      <legend className="text-[12.5px] text-ink-soft">{label}</legend>
      <div className="mt-1 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input
              type="radio"
              name={nama}
              value={n}
              checked={nilai === n}
              onChange={() => setNilai(n)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={`text-[22px] leading-none ${n <= nilai ? "text-gold" : "text-black/20"}`}
            >
              ★
            </span>
            <span className="sr-only">{`${n} bintang`}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
