"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { ambilProdukGratis } from "./ambil";

/**
 * Keadaan tombol, dari sudut pandang PENGUNJUNG:
 *   "belum"  — pengunjung anon, atau klien yang memang belum punya.
 *   "punya"  — entitlement hidup: yang ditawarkan bukan "ambil" lagi,
 *              melainkan jalan MASUK ke produknya.
 *   "cabut"  — pernah punya, lalu dicabut admin. Pengambilan ulang TIDAK
 *              menghidupkannya (`on conflict do nothing` di RPC), jadi layar
 *              tidak boleh mengaku berhasil.
 */
export type KeadaanAmbil = "belum" | "punya" | "cabut";

/** Satu bentuk "sudah dimiliki", dipakai dua pemanggil — gratis dan berbayar. */
function BlokBuka({ slug }: { slug: string }) {
  return (
    <div className="mt-4">
      <Link
        href={`/passport/produk/${slug}`}
        className="inline-block min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale"
      >
        Buka
      </Link>
      <p className="mt-2 text-[13px] text-ink-soft">
        Produk ini sudah ada di{" "}
        <Link href="/passport/produk" className="font-semibold text-leaf underline">
          Pembelian Saya
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * Bagian yang MURNI tampilan — dipisahkan supaya ketiga keadaannya bisa diuji
 * dengan render sungguhan (`tests/produk-tombol-ambil.test.tsx`), bukan lewat
 * pembacaan teks sumber. Efek & pemanggilan server action tinggal di
 * `TombolAmbil` di bawah.
 */
export function PanelAmbil({
  slug,
  keadaan,
  pending,
  pesan,
  onAmbil,
}: {
  slug: string;
  keadaan: KeadaanAmbil;
  pending: boolean;
  pesan: string | null;
  onAmbil: () => void;
}) {
  if (keadaan === "punya") return <BlokBuka slug={slug} />;

  if (keadaan === "cabut") {
    // Jujur, bukan "berhasil": aksesnya sedang dicabut, dan mengklik apa pun
    // di layar ini tidak akan mengembalikannya.
    return (
      <p className="mt-4 rounded-lg bg-clay/10 px-4 py-3 text-[13.5px] font-semibold text-clay">
        Akses Anda ke produk ini sedang tidak aktif. Hubungi tim PADMA bila ini
        tidak semestinya.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onAmbil}
        disabled={pending}
        className="min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale disabled:opacity-60"
      >
        {pending ? "Memproses..." : "Ambil gratis"}
      </button>
      {pesan && <p className="mt-2 text-sm text-clay">{pesan}</p>}
    </div>
  );
}

/**
 * Membaca kepemilikan DARI PERAMBAN, bukan dari server.
 *
 * Halaman `/produk/[slug]` sengaja dibaca anon dan di-cache
 * (`export const revalidate = 300`): isinya sama untuk semua pengunjung, dan
 * itulah yang membuat etalase murah. Membaca cookie di sana akan membuat
 * SELURUH halaman dynamic demi satu tombol. Karena itu kepemilikan ditanyakan
 * dari sisi klien, sesudah halamannya tayang.
 *
 * RLS "entitlement: klien baca miliknya" yang menjawab — bukan filter
 * `client_id` yang dirakit di sini, yang tetap akan memulangkan daftar kosong
 * seandainya gerbangnya sendiri mati. `dicabut_pada is null` disaring eksplisit
 * karena entitlement yang dicabut BUKAN kepemilikan.
 */
export async function punyaProdukDiPeramban(
  sb: SupabaseClient,
  productId: string,
): Promise<boolean> {
  // Tanpa sesi, tidak ada yang perlu ditanyakan: `anon` tidak punya hak tabel
  // atas `digital_entitlements` sama sekali, jadi permintaannya hanya akan
  // melahirkan 42501 di konsol pengunjung tanpa menjawab apa pun.
  const { data } = await sb.auth.getSession();
  if (!data.session) return false;

  const { data: baris } = await sb
    .from("digital_entitlements")
    .select("id")
    .eq("product_id", productId)
    .is("dicabut_pada", null)
    .maybeSingle();
  return baris !== null;
}

/**
 * Jalan masuk untuk produk BERBAYAR yang ternyata sudah dimiliki — mis. hadiah
 * admin (`sumber = 'pemberian_admin'`). Tahap 1 belum punya checkout, jadi di
 * sini tidak ada tombol beli apa pun: yang belum memiliki tidak melihat
 * SEPATAH KATA pun tambahan, dan layar pengunjung anon karena itu persis sama
 * seperti sebelumnya.
 */
export function TautanBuka({ slug, productId }: { slug: string; productId: string }) {
  const [punya, setPunya] = useState(false);

  useEffect(() => {
    let hidup = true;
    void punyaProdukDiPeramban(createBrowserSupabase(), productId).then((ada) => {
      if (hidup && ada) setPunya(true);
    });
    return () => {
      hidup = false;
    };
  }, [productId]);

  if (!punya) return null;
  return <BlokBuka slug={slug} />;
}

// Tombol hanya mengirim slug produk. Sisanya — sesi ada atau tidak, produknya
// tayang, harganya benar-benar nol, client_id-nya siapa — diputuskan server
// action lalu RPC di basis data (lihat komentar `ambil.ts`).
export function TombolAmbil({ slug, productId }: { slug: string; productId: string }) {
  const [pending, mulai] = useTransition();
  const [pesan, setPesan] = useState<string | null>(null);
  const [keadaan, setKeadaan] = useState<KeadaanAmbil>("belum");
  const router = useRouter();

  // Keadaan awal "belum" disengaja: itulah yang dilihat pengunjung anon, dan
  // pemeriksaan di bawah tidak pernah mengubahnya untuk mereka.
  useEffect(() => {
    let hidup = true;
    void punyaProdukDiPeramban(createBrowserSupabase(), productId).then((punya) => {
      if (hidup && punya) setKeadaan("punya");
    });
    return () => {
      hidup = false;
    };
  }, [productId]);

  function klik() {
    mulai(async () => {
      setPesan(null);
      const hasil = await ambilProdukGratis(slug);
      if (!hasil.ok) {
        setPesan(hasil.pesan);
        return;
      }
      // `hasil.punya` dibaca server SESUDAH RPC, bukan disimpulkan dari
      // ketiadaan galat — lihat komentar tipe `Hasil` di `ambil.ts`.
      setKeadaan(hasil.punya ? "punya" : "cabut");
      router.refresh();
    });
  }

  return (
    <PanelAmbil
      slug={slug}
      keadaan={keadaan}
      pending={pending}
      pesan={pesan}
      onAmbil={klik}
    />
  );
}
