"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import type { BabPublik, MateriPublik } from "@/lib/produk/katalog";
import { LABEL_JENIS_MATERI } from "@/lib/produk/status";
import { urlSampulPublik } from "@/lib/produk/objek";
import { titipTujuanDiPeramban } from "@/lib/auth/tujuan-produk";
import { punyaProdukDiPeramban } from "./tombol-ambil";

/**
 * Daftar bab & materi seperti referensi klien: bab bisa dibuka-tutup,
 * materi pratinjau berlabel "Lihat", sisanya bergembok.
 *
 * Halaman ini anon dan `revalidate = 300`, jadi siapa pemanggilnya hanya
 * diketahui di peramban — pola yang sama dengan `TombolAmbil`. Gembok di sini
 * hanyalah TAMPILAN; yang benar-benar menolak adalah RLS `boleh_buka_materi`
 * di balik penampil dan rute isi.
 */
type Pemanggil = "memuat" | "anon" | "login" | "pemilik";

function Thumbnail({ materi, terkunci }: { materi: MateriPublik; terkunci: boolean }) {
  const url = urlSampulPublik(materi.sampulObjek);
  return (
    <span className="relative h-14 w-14 flex-none overflow-hidden rounded-lg bg-paper">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- sampul datang dari bucket publik, bukan aset build.
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center text-[18px] text-ink-soft">
          {materi.jenis === "pdf" ? "📖" : "▶"}
        </span>
      )}
      {terkunci && (
        <span className="absolute inset-0 flex items-center justify-center bg-night/45 text-[18px]" aria-hidden>
          🔒
        </span>
      )}
    </span>
  );
}

export function DaftarBab({
  slug,
  productId,
  bab,
}: {
  slug: string;
  productId: string;
  bab: BabPublik[];
}) {
  const router = useRouter();
  const [pemanggil, setPemanggil] = useState<Pemanggil>("memuat");

  useEffect(() => {
    const sb = createBrowserSupabase();
    let hidup = true;
    void (async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) { if (hidup) setPemanggil("anon"); return; }
      const punya = await punyaProdukDiPeramban(sb, productId);
      if (hidup) setPemanggil(punya ? "pemilik" : "login");
    })();
    return () => { hidup = false; };
  }, [productId]);

  const total = bab.reduce((n, b) => n + b.materi.length, 0);
  if (total === 0) return null;

  // Fungsi render, bukan komponen bersarang: komponen yang didefinisikan di
  // dalam render lahir ulang tiap render dan kehilangan state/fokusnya.
  function baris(materi: MateriPublik) {
    const bolehBuka = pemanggil === "pemilik" || materi.pratinjau;
    const href = `/passport/produk/${slug}/${materi.id}`;
    const isi = (
      <>
        <span className={`w-12 flex-none text-center text-[11px] font-bold ${bolehBuka ? "text-clay" : "text-ink-soft/60"}`}>
          {bolehBuka ? (pemanggil === "pemilik" ? "Buka" : "Lihat") : LABEL_JENIS_MATERI[materi.jenis]}
        </span>
        <Thumbnail materi={materi} terkunci={!bolehBuka} />
        <span className="min-w-0">
          <b className="block text-[14px] text-night">{materi.judul}</b>
          {materi.keterangan !== "" && (
            <span className="line-clamp-2 text-[13px] text-ink-soft">{materi.keterangan}</span>
          )}
        </span>
      </>
    );
    const kelas = "flex min-h-[64px] items-center gap-3 rounded-xl p-2";

    if (!bolehBuka || pemanggil === "memuat") return <li key={materi.id} className={kelas}>{isi}</li>;
    if (pemanggil === "anon") {
      return (
        <li key={materi.id}>
          <button
            type="button"
            className={`${kelas} w-full text-left hover:bg-paper`}
            onClick={() => {
              titipTujuanDiPeramban(href);
              router.push("/masuk");
            }}
          >
            {isi}
          </button>
        </li>
      );
    }
    return (
      <li key={materi.id}>
        <Link href={href} className={`${kelas} hover:bg-paper`}>{isi}</Link>
      </li>
    );
  }

  return (
    <section className="mt-6">
      <p className="mb-3 text-[13px] font-semibold text-ink-soft">{total} Materi</p>
      {pemanggil === "anon" && bab.some((b) => b.materi.some((m) => m.pratinjau)) && (
        <p className="mb-3 text-[12.5px] text-ink-soft">Masuk untuk membuka materi pratinjau.</p>
      )}
      <div className="grid gap-3">
        {bab.map((b, i) => (
          <details key={b.id} open={i === 0} className="rounded-2xl border border-black/10 bg-white">
            <summary className="flex min-h-[56px] cursor-pointer items-center justify-between gap-3 px-5 py-3">
              <b className="text-[15px] text-night">{b.judul}</b>
              <span className="flex-none text-[12.5px] text-ink-soft">{b.materi.length} Materi</span>
            </summary>
            <ul className="grid gap-1 px-3 pb-3">
              {b.materi.map((m) => baris(m))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
