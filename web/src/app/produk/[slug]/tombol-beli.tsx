"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { muatSkripSnap, PESAN_PEMBAYARAN_BELUM_AKTIF } from "@/lib/midtrans/snap-peramban";
import { PESANAN_BERUANG, PESANAN_TERBUKA } from "@/lib/pesanan/status";
import { BlokBuka, punyaProdukDiPeramban } from "./tombol-ambil";

/**
 * Keadaan tombol produk BERBAYAR, dari sudut pandang pengunjung. Urutan
 * pemeriksaannya MENGIKAT dan disebut spec supaya tidak ditebak:
 *
 *   "punya"    — entitlement hidup. Diperiksa DULUAN, karena kepemilikan adalah
 *                satu-satunya sumber kebenaran akses; status pesanan bukan.
 *   "menunggu" — punya pesanan yang belum mati dan belum melahirkan akses
 *                (`menunggu_bayar` ATAU `ditahan`). Orang ini SUDAH menyetor.
 *   "belum"    — pengunjung anon, atau klien yang memang belum memulai apa pun.
 *
 * Membalik dua yang pertama berarti orang yang baru mentransfer lewat VA
 * ditawari membeli lagi, dan sebagian dari mereka akan membayar dua kali.
 */
export type KeadaanBeli = "belum" | "punya" | "menunggu";

/** Satu kalimat, satu tempat — dipakai tiga jalur kegagalan yang berbeda. */
const PESAN_COBA_LAGI = "Pembayaran belum bisa dimulai. Coba lagi sebentar lagi.";
const PESAN_TIDAK_BISA_DIBUKA = "Pembayaran tidak bisa dibuka. Coba lagi sebentar lagi.";

/**
 * KEPUTUSAN URUTAN LAYAR, sebagai fungsi MURNI.
 *
 * ===== KENAPA DIEKSTRAK DARI `segarkan()` =====
 * Selama ia tinggal di dalam `useCallback`, ia tidak bisa dijalankan satu kali
 * pun oleh suite ini: `renderToStaticMarkup` tidak menjalankan efek dan repo
 * ini nol jsdom. Kelima uji `PanelBeli` MENERIMA `keadaan` sebagai prop —
 * mereka membuktikan tampilan untuk "menunggu" benar, bukan bahwa keadaan
 * "menunggu" pernah DIHITUNG. Seseorang boleh menukar dua blok di bawah, atau
 * menghapus cabang `punyaPesanan` sama sekali, dan tidak ada yang merah.
 *
 * Resep ini sudah dipakai Tugas 10 untuk masalah yang sama (`picu-periksa.ts`,
 * "supaya bisa dijalankan sungguhan"); di sini ia diterapkan ke keputusan yang
 * jauh lebih mahal bila terbalik. Tiga fungsi murni lain di berkas ini
 * (`mintaCheckout`, `mintaBatal`, `pesananYangBisaDibatalkan`) lahir dari
 * resep yang sama dan dengan alasan yang sama.
 *
 * ===== URUTANNYA MENGIKAT, DAN SPEC MENYEBUTNYA =====
 *   1. entitlement DULU — kepemilikan adalah satu-satunya sumber kebenaran
 *      akses; status pesanan bukan. Orang yang SUDAH punya produknya harus
 *      melihat "Buka", apa pun keadaan pesanannya.
 *   2. baru `punya_pesanan_menunggu` — "orang yang baru mentransfer lewat VA
 *      melihat 'Pembayaran Anda sedang diproses' alih-alih tombol beli, dan
 *      tidak membayar dua kali".
 *   3. baru tombol beli.
 *
 * `punyaPesanan` diterima sebagai FUNGSI, bukan sebagai boolean: itulah yang
 * membuat "tidak pernah dipanggil ketika sudah punya" bisa di-assert, dan
 * sekaligus yang menghemat satu perjalanan RPC untuk setiap pemilik produk.
 */
export async function keadaanBeli(
  punyaProduk: () => Promise<boolean>,
  punyaPesanan: () => Promise<boolean>,
): Promise<KeadaanBeli> {
  if (await punyaProduk()) return "punya";
  return (await punyaPesanan()) ? "menunggu" : "belum";
}

/** Baris `orders` yang boleh dibaca peramban — RLS "pesanan: klien baca miliknya". */
export type BarisPesananSaya = {
  id: string;
  status: string;
  sebab_tinjauan: string | null;
};

/**
 * Pesanan mana yang boleh ditawarkan untuk DIBATALKAN dari halaman produk ini
 * — atau `null` kalau jawabannya tidak bisa dipastikan.
 *
 * ===== KENAPA INI TIDAK SESEDERHANA "ambil pesanan terbuka saya" =====
 * `order_items` lahir dengan NOL grant dan NOL policy bagi `authenticated`
 * (`20260926110000:209-217`, dan ia masuk `SENGAJA_TERKUNCI` di
 * `tests/struktur-rls.test.ts`). Artinya peramban TIDAK BISA menautkan sebuah
 * pesanan ke produknya — dan begitu juga rute mana pun yang memakai sesi
 * pemanggil, karena hanya fungsi `security definer` yang boleh membaca tabel
 * itu. Yang tersedia di sisi klien hanyalah `orders` (status + penanda
 * tinjauan) dan boolean `punya_pesanan_menunggu` untuk SATU produk.
 *
 * Kalau keadaan "menunggu" lahir dari pesanan `menunggu_bayar`, maka unique
 * parsial `pesanan_terbuka_satu_per_klien` menjamin pesanan terbuka itu SATU
 * di seluruh basis data — jadi ia pasti pesanan produk ini, dan menawarkan
 * pembatalannya aman.
 *
 * Yang TIDAK aman adalah keadaan "menunggu" yang lahir dari pesanan `ditahan`,
 * `lunas` tanpa entitlement, atau ber-`sebab_tinjauan = 'lunas_setelah_tutup'`:
 * ketiganya TERTUTUP, jadi klien yang sama boleh sekaligus punya pesanan
 * terbuka untuk produk LAIN — dan tombol batal di halaman ini akan membatalkan
 * pesanan produk lain itu, diam-diam, sementara layar ini tidak berubah sama
 * sekali. Karena itu fungsi ini menolak menebak begitu ada satu saja baris
 * berstatus tinjauan.
 *
 * Konsekuensinya sadar dan searah: kadang tombol batal TIDAK muncul padahal
 * sebenarnya boleh (klien punya pesanan terbuka produk ini DAN pesanan ditahan
 * produk lain). Itu kehilangan satu jalan keluar; kebalikannya membatalkan
 * pesanan yang salah. Dari dua arah kegagalan, hanya satu yang bisa diterima.
 */
export function pesananYangBisaDibatalkan(baris: readonly BarisPesananSaya[]): string | null {
  const terbuka = baris.filter((b) => (PESANAN_TERBUKA as readonly string[]).includes(b.status));
  const tinjauan = baris.filter(
    (b) =>
      (PESANAN_BERUANG as readonly string[]).includes(b.status) ||
      // Kosakata `sebab_tinjauan` dikunci di §0.11 rencana; nilai inilah yang
      // menandai settlement yang mendarat sesudah pesanannya tertutup.
      b.sebab_tinjauan === "lunas_setelah_tutup",
  );
  if (terbuka.length !== 1 || tinjauan.length > 0) return null;
  return terbuka[0].id;
}

export type HasilCheckout =
  | { jenis: "token"; token: string }
  | { jenis: "masuk" }
  | { jenis: "pesan"; pesan: string };

/**
 * SATU percobaan checkout, sebagai fungsi murni yang menerima `fetch`-nya.
 *
 * ===== `orderIdTerbakar` ADALAH SELURUH ALASAN FUNGSI INI ADA =====
 * Midtrans menolak `order_id` kembar SELAMANYA. Begitu sebuah `order_id`
 * pernah dikirim ke Snap, satu-satunya jalan keluar adalah menaikkan
 * `percobaan` — dan itu persis yang dilakukan `buat_pesanan(p_ulang := true)`
 * (`20260926130000:210-222`, yang komentarnya sendiri berbunyi "`percobaan`
 * dinaikkan HANYA di sini: saat Snap menolak menerbitkan token dan
 * order_id-nya sudah terbakar").
 *
 * Tanpa pulangan ini, percobaan berikutnya mengirim `ulang: false`,
 * `buat_pesanan` memulangkan pesanan terbuka yang SAMA berikut `kode` dan
 * `percobaan` yang sama, rute merakit `order_id` yang sama, Snap menolaknya
 * lagi, dan 502 itu berulang SELAMANYA. Pembeli terkunci sampai tenggat 24
 * jamnya lewat, sementara layarnya berkata "Pembayaran Anda sedang diproses"
 * — kalimat yang tidak benar untuk orang yang tidak pernah membayar.
 *
 * Yang membakar, dan kenapa masing-masing:
 *   - `200` — token terbit, jadi Snap PASTI sudah memegang `order_id` itu.
 *   - `502` — rute sudah memanggil Snap dan Snap menolak. Ia mungkin sempat
 *     mencatat `order_id`-nya; peramban tidak punya cara tahu.
 *   - jaringan mati — tidak ada jawaban sama sekali, jadi tidak ada yang bisa
 *     disimpulkan. Pesanannya mungkin sudah lahir dan tokennya mungkin sudah
 *     terbit.
 * Menaikkan `percobaan` pada `order_id` yang ternyata BELUM terbakar hanya
 * memakai satu dari sembilan jatah (dan percobaan kesepuluh pun sudah punya
 * jalan keluarnya sendiri di RPC). Tidak menaikkannya pada yang SUDAH terbakar
 * mengunci pembeli. Dari dua arah salah, hanya satu yang murah.
 *
 * `400`/`401`/`409` TIDAK membakar: ketiganya berhenti sebelum Snap disentuh.
 */
export async function mintaCheckout(
  productId: string,
  ulang: boolean,
  ambil: typeof fetch = (...argumen) => fetch(...argumen),
): Promise<{ hasil: HasilCheckout; orderIdTerbakar: boolean }> {
  let jawab: Response;
  try {
    jawab = await ambil("/api/pesanan/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId, ulang }),
    });
  } catch {
    // Sambungan putus. Pesanannya MUNGKIN sudah lahir di server — diam di sini
    // berarti klik berikutnya tidak melakukan apa-apa yang terlihat.
    return { hasil: { jenis: "pesan", pesan: PESAN_COBA_LAGI }, orderIdTerbakar: true };
  }

  if (jawab.status === 401) {
    return { hasil: { jenis: "masuk" }, orderIdTerbakar: false };
  }

  const isi = (await jawab.json().catch(() => null)) as
    | { token?: string; pesan?: string }
    | null;

  if (!jawab.ok || !isi?.token) {
    return {
      hasil: { jenis: "pesan", pesan: isi?.pesan ?? PESAN_COBA_LAGI },
      orderIdTerbakar: jawab.status === 502,
    };
  }

  return { hasil: { jenis: "token", token: isi.token }, orderIdTerbakar: true };
}

export type HasilBatal =
  | { jenis: "dibatalkan" }
  | { jenis: "masuk" }
  | { jenis: "pesan"; pesan: string };

/**
 * Pembatalan mandiri, fungsi murni dengan `fetch`-nya dioper.
 *
 * `{ dibatalkan: false }` BUKAN galat menurut rutenya — ia jawaban jujur untuk
 * "tidak ada pesanan yang cocok dengan itu milik Anda". Tapi bagi PEMBELI yang
 * baru saja menekan tombol batal, tidak terjadi apa-apa adalah kejadian yang
 * harus diberi kalimat: tanpa itu tombolnya terlihat rusak.
 */
export async function mintaBatal(
  pesananId: string,
  ambil: typeof fetch = (...argumen) => fetch(...argumen),
): Promise<HasilBatal> {
  let jawab: Response;
  try {
    jawab = await ambil(`/api/pesanan/${pesananId}/batal`, { method: "POST" });
  } catch {
    return { jenis: "pesan", pesan: "Pembatalan belum bisa diproses. Coba lagi sebentar lagi." };
  }

  if (jawab.status === 401) return { jenis: "masuk" };

  const isi = (await jawab.json().catch(() => null)) as
    | { dibatalkan?: boolean; pesan?: string }
    | null;

  if (isi?.dibatalkan === true) return { jenis: "dibatalkan" };

  return {
    jenis: "pesan",
    pesan: isi?.pesan ?? "Pesanan ini tidak bisa dibatalkan sekarang.",
  };
}

/**
 * Bagian yang MURNI tampilan — dipisahkan supaya ketiga keadaannya bisa diuji
 * dengan render sungguhan (`tests/produk-tombol-beli.test.tsx`), bukan lewat
 * pembacaan teks sumber. Efek, jaringan, dan popup Snap tinggal di `TombolBeli`.
 */
export function PanelBeli({
  slug,
  keadaan,
  pending,
  pesan,
  bisaDibatalkan,
  onBeli,
  onBatal,
}: {
  slug: string;
  keadaan: KeadaanBeli;
  pending: boolean;
  pesan: string | null;
  bisaDibatalkan: boolean;
  onBeli: () => void;
  onBatal: () => void;
}) {
  if (keadaan === "punya") return <BlokBuka slug={slug} />;

  if (keadaan === "menunggu") {
    return (
      <div className="mt-4 rounded-xl bg-gold/10 px-4 py-3">
        <p className="text-[13.5px] font-bold text-night">
          Pembayaran Anda sedang diproses.
        </p>
        <p className="mt-1 text-[13px] text-ink-soft">
          Transfer bank dan VA kadang butuh beberapa menit. Begitu pembayarannya
          diterima, produk ini muncul di{" "}
          <Link href="/passport/produk" className="font-semibold text-leaf underline">
            Pembelian Saya
          </Link>
          . Halaman ini tidak perlu dimuat ulang terus-menerus.
        </p>
        {/* Pesan galat dirender DI SINI juga, bukan hanya di cabang "belum".
            `onError` Snap menulis pesannya lalu membaca ulang keadaan, dan
            pembacaan itu memindahkan panel ke sini — kalau kalimatnya hanya
            hidup di cabang "belum", ia lenyap tepat pada kejadian yang paling
            butuh dijelaskan. */}
        {pesan && <p className="mt-2 text-sm text-clay">{pesan}</p>}
        {bisaDibatalkan && (
          <>
            {/* Satu-satunya jalan keluar yang dimiliki pembeli yang macet.
                Tanpa tombol ini, orang yang pembayarannya gagal harus menunggu
                tenggat 24 jam sebelum bisa memesan apa pun lagi — unique
                parsial `pesanan_terbuka_satu_per_klien` yang menahannya. */}
            <button
              type="button"
              onClick={onBatal}
              disabled={pending}
              className="mt-3 min-h-[44px] rounded-lg border border-night/25 px-4 py-2 text-[13px] font-bold text-night disabled:opacity-60"
            >
              {pending ? "Membatalkan..." : "Batalkan pesanan ini"}
            </button>
            <p className="mt-1 text-[12.5px] text-ink-soft">
              Batalkan bila pembayarannya tidak bisa diselesaikan atau Anda
              berubah pikiran. Sesudah itu Anda bisa memesan lagi.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={onBeli}
        disabled={pending}
        className="min-h-[44px] rounded-lg bg-night px-5 py-3 font-bold text-gold-pale disabled:opacity-60"
      >
        {pending ? "Menyiapkan pembayaran..." : "Beli sekarang"}
      </button>
      {pesan && <p className="mt-2 text-sm text-clay">{pesan}</p>}
    </div>
  );
}

/**
 * `produksi` dan `clientKey` DIOPER dari server (`page.tsx`), tidak dibaca di
 * sini. `MIDTRANS_PRODUKSI` tidak berprefix `NEXT_PUBLIC_`; membacanya dari
 * komponen klien memberi `undefined`, yang berarti sandbox — selamanya, di
 * produksi, tanpa satu pun galat.
 */
export function TombolBeli({
  slug,
  productId,
  produksi,
  clientKey,
}: {
  slug: string;
  productId: string;
  produksi: boolean;
  clientKey: string;
}) {
  const [keadaan, setKeadaan] = useState<KeadaanBeli>("belum");
  const [pesananId, setPesananId] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  // "order_id pesanan terbuka saya sudah pernah dikirim ke Snap" — lihat
  // dokblok `mintaCheckout`. Sekali menyala, setiap percobaan berikutnya minta
  // nomor percobaan baru, dan itulah satu-satunya jalan keluar dari 502 yang
  // berulang.
  const [orderIdTerpakai, setOrderIdTerpakai] = useState(false);
  const [pending, mulai] = useTransition();
  const router = useRouter();

  /**
   * Keadaan dibaca DARI PERAMBAN, bukan dari server: `/produk/[slug]` sengaja
   * anon dan ter-cache (`revalidate = 300`), dan membaca cookie di sana akan
   * membuat SELURUH etalase dynamic demi satu tombol.
   *
   * MEMULANGKAN keadaannya, tidak memasangnya. Pemisahan itu bukan selera:
   * `react-hooks/set-state-in-effect` menolak `setState` di BADAN efek sebagai
   * galat, jadi yang dipanggil efek di bawah adalah pembaca murni ini dan
   * pemasangannya hidup di `.then()` — pola yang sudah dipakai `TombolAmbil`
   * di `tombol-ambil.tsx`.
   */
  const bacaKeadaan = useCallback(async (): Promise<{
    keadaan: KeadaanBeli;
    pesananId: string | null;
  }> => {
    const sb = createBrowserSupabase();
    // Tanpa sesi tidak ada yang perlu ditanyakan, dan bertanya hanya melahirkan
    // 42501 di konsol pengunjung: `anon` tidak memegang hak atas
    // `digital_entitlements` maupun RPC pesanan.
    const { data: sesi } = await sb.auth.getSession();
    if (!sesi.session) return { keadaan: "belum", pesananId: null };

    // Urutannya hidup di `keadaanBeli`, bukan di sini — lihat dokbloknya.
    const hasil = await keadaanBeli(
      () => punyaProdukDiPeramban(sb, productId),
      async () => {
        const { data } = await sb.rpc("punya_pesanan_menunggu", { p_product_id: productId });
        return data === true;
      },
    );

    // Perjalanan KETIGA ini hanya dibayar oleh yang memang macet. Yang belum
    // memesan dan yang sudah memiliki produknya tidak membayarnya sama sekali.
    if (hasil !== "menunggu") return { keadaan: hasil, pesananId: null };

    const { data: baris } = await sb.from("orders").select("id, status, sebab_tinjauan");
    return {
      keadaan: hasil,
      pesananId: pesananYangBisaDibatalkan((baris ?? []) as BarisPesananSaya[]),
    };
  }, [productId]);

  /** Pembacaan ulang yang dipicu callback Snap, bukan oleh pemasangan komponen. */
  const segarkan = useCallback(async () => {
    const { keadaan: baru, pesananId: id } = await bacaKeadaan();
    setKeadaan(baru);
    setPesananId(id);
  }, [bacaKeadaan]);

  // Bendera `hidup` disalin dari `TombolAmbil`: jawaban yang mendarat sesudah
  // pengunjung meninggalkan halaman dibuang, bukan dipasang ke komponen yang
  // sudah tidak ada.
  useEffect(() => {
    let hidup = true;
    void bacaKeadaan().then(({ keadaan: baru, pesananId: id }) => {
      if (!hidup) return;
      setKeadaan(baru);
      setPesananId(id);
    });
    return () => {
      hidup = false;
    };
  }, [bacaKeadaan]);

  function klik() {
    mulai(async () => {
      setPesan(null);

      // FAIL CLOSED. `muatSkripSnap` menolak kunci kosong juga (di sanalah
      // ujinya hidup); baris ini hanya memastikan pembeli mendapat kalimat
      // yang SAMA dengan yang dipakai adapter server untuk keadaan yang sama
      // persis — Midtrans belum dipasang.
      if (clientKey.trim() === "") {
        setPesan(PESAN_PEMBAYARAN_BELUM_AKTIF);
        return;
      }

      try {
        await muatSkripSnap(clientKey, produksi);
      } catch {
        setPesan(PESAN_TIDAK_BISA_DIBUKA);
        return;
      }

      const { hasil, orderIdTerbakar } = await mintaCheckout(productId, orderIdTerpakai);
      if (orderIdTerbakar) setOrderIdTerpakai(true);

      if (hasil.jenis === "masuk") {
        // `/masuk` tidak membaca parameter lanjutan apa pun di repo ini, jadi
        // tidak ada janji "kembali ke sini" yang dibuat lalu dilanggar.
        router.push("/masuk");
        return;
      }

      if (hasil.jenis === "pesan") {
        // SENGAJA tidak membaca ulang keadaan. Pesanannya mungkin sudah lahir,
        // dan membacanya sekarang memindahkan panel ke "menunggu" — yang
        // MENGHILANGKAN tombol beli, satu-satunya jalan pembeli mencoba lagi
        // dengan nomor percobaan baru. Ia tetap di "belum", tombolnya hidup,
        // dan klik berikutnya membawa `ulang: true`.
        setPesan(hasil.pesan);
        return;
      }

      if (!window.snap) {
        // `muatSkripSnap` selesai tanpa galat tapi `window.snap` tidak ada:
        // skrip diblokir pemblokir iklan, atau gagal memasang dirinya.
        // `window.snap?.pay(...)` di sini akan menjadi no-op SENYAP — popup
        // tidak terbuka, tidak ada pesan, tidak ada yang berubah, dan pembeli
        // menekan tombol yang sudah terlanjur melahirkan pesanan.
        setPesan(PESAN_TIDAK_BISA_DIBUKA);
        return;
      }

      window.snap.pay(hasil.token, {
        // `onSuccess` BUKAN sumber kebenaran pembayaran — yang memutuskan lunas
        // hanyalah notifikasi bertanda tangan. Ia hanya memicu pembacaan ulang.
        // Pada metode yang membawa pengguna keluar aplikasi (deeplink e-wallet)
        // ia bisa tidak pernah menyala sama sekali, dan itu diterima sadar:
        // pembeli menemukan produknya di Pembelian Saya saat ia kembali.
        onSuccess: () => {
          void segarkan();
          router.refresh();
        },
        onPending: () => setKeadaan("menunggu"),
        onClose: () => void segarkan(),
        onError: () => {
          setPesan("Pembayaran gagal. Silakan coba lagi.");
          // Membaca ulang seperti `onClose`. Tanpa ini panel tetap "belum"
          // dengan tombol beli yang hidup, dan menekannya memakai pesanan
          // terbuka yang sama — `order_id` yang sudah terbakar, 502, selamanya.
          // Sesudah pembacaan ini panel pindah ke "menunggu", kalimat di atas
          // ikut terbawa, dan tombol batal memberi jalan keluar.
          void segarkan();
        },
      });
    });
  }

  function batal() {
    const id = pesananId;
    if (id === null) return;

    mulai(async () => {
      setPesan(null);
      const hasil = await mintaBatal(id);

      if (hasil.jenis === "masuk") {
        router.push("/masuk");
        return;
      }
      if (hasil.jenis === "pesan") setPesan(hasil.pesan);
      // Pesanan lama mati, jadi pesanan berikutnya lahir dengan `kode` dan
      // `order_id` yang benar-benar baru.
      if (hasil.jenis === "dibatalkan") setOrderIdTerpakai(false);

      // Dibaca ulang APA PUN hasilnya: kalau berhasil panel kembali ke "belum"
      // dan tombol beli hidup lagi; kalau gagal karena pesanannya memang sudah
      // tidak terbuka, pembacaan inilah yang memperbaiki layarnya.
      await segarkan();
      router.refresh();
    });
  }

  return (
    <PanelBeli
      slug={slug}
      keadaan={keadaan}
      pending={pending}
      pesan={pesan}
      bisaDibatalkan={pesananId !== null}
      onBeli={klik}
      onBatal={batal}
    />
  );
}
