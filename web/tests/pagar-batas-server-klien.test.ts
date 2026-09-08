/**
 * Pagar batas Server → Client: prop berisi arrow function tidak boleh
 * dikirim dari sebuah berkas `.tsx` di `src/app` yang BUKAN `"use client"`.
 *
 * KENAPA pagar ini perlu ada, bukan sekadar "sudah hati-hati": kelas cacat
 * ini sudah menggigit proyek ini TIGA KALI, dan yang ketiga sempat sampai ke
 * `main` — `/admin/materi/[id]` mengirim `labelUntuk={(nama) => …}` ke
 * `CentangLayanan`, komponen `"use client"`, dan SETIAP kunjungan ke halaman
 * detail materi gagal di runtime dengan "Functions cannot be passed directly
 * to Client Components" (digest 747457518) sebelum diperbaiki — lihat
 * dokblok prop `labelAkhiran` di `src/app/admin/materi/form-materi.tsx`.
 *
 * Suite unit proyek ini TIDAK BISA melihat cacat ini sendiri: satu-satunya
 * alat render yang dimiliki suite yang berjalan tanpa jsdom adalah
 * `renderToStaticMarkup`, dan fungsi itu tidak tahu apa-apa tentang batas
 * server/klien React Server Components — ia merender pohon React biasa,
 * bukan payload RSC yang diserialkan lewat jaringan. Merender
 * `<CentangLayanan labelAkhiran={(nama) => ...} />` langsung dengan
 * `renderToStaticMarkup` BERHASIL tanpa keluhan, karena tidak pernah ada
 * proses serialisasi RSC yang sungguhan dilewati. Tiga tinjauan kode yang
 * membaca prop itu dalam isolasi pun lolos, dan `npm run build` sukses —
 * kompilasi Next.js memeriksa apakah suatu berkas BOLEH memakai hook klien,
 * bukan apakah NILAI yang dikirim ke sebuah Client Component gagal
 * diserialkan. Cacatnya hanya kelihatan saat membuka halamannya sungguhan di
 * peramban. Pagar ini mengubah pemindaian sumber satu-kali yang menemukan
 * cacat itu menjadi pengujian permanen, supaya kejadian yang sama tidak
 * perlu ditemukan lewat peramban lagi kali keempat.
 *
 * YANG TIDAK DIJAGA: pagar ini hanya memindai berkas `.tsx` langsung di
 * bawah `src/app` (rute & komponennya) yang tidak diawali `"use client"` di
 * baris pertama. Ia tidak melacak APAKAH prop itu benar-benar diterima oleh
 * sebuah komponen `"use client"` — sebuah server action, atau prop yang
 * diteruskan ke komponen server lain, memang boleh berupa fungsi. Ini pagar
 * yang sengaja LEBIH LUAS dari cacatnya (melarang arrow function di prop JSX
 * mana pun pada berkas server), karena pola yang sungguh sah untuk berkas
 * server (fungsi biasa yang diteruskan sebagai prop JSX) belum pernah
 * ditemukan di proyek ini, dan longgarnya syarat itu berarti false-negative
 * yang tidak kelihatan sampai kejadian keempat.
 *
 * Klasifikasi klien/server sendiri bersandar pada `"use client"` sebagai
 * BARIS PERTAMA berkas (sesudah `trimStart()`). Berkas yang menaruh
 * direktif itu sesudah komentar atau baris kosong — sah secara JavaScript —
 * akan salah digolongkan SERVER dan ikut dipindai, berpotensi melahirkan
 * positif-palsu. Diperiksa 2026-09-08: nol dari 106 berkas `.tsx` di
 * `src/app` berbentuk begitu hari ini — ini batas yang DIKETAHUI, bukan
 * bug hidup.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Semua berkas `.tsx` di bawah sebuah direktori, rekursif. */
function berkasSumber(rel: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(path.join(AKAR, rel), { withFileTypes: true })) {
    const anak = `${rel}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasSumber(anak));
    else if (/\.tsx$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

/** Berkas yang baris pertamanya (sesudah spasi) BUKAN `"use client"`. */
function berkasServer(berkas: string[]): string[] {
  return berkas.filter((f) => !baca(f).trimStart().startsWith('"use client"'));
}

/**
 * Nama prop JSX yang nilainya sebuah arrow function: `nama={(a, b) => ...}`,
 * `nama={async (a) => ...}`, atau `nama={a => ...}` (satu parameter tanpa
 * kurung). `=>` disyaratkan TEPAT sesudah tutup kurung parameter (atau
 * sesudah satu identifier), bukan "muncul di suatu tempat" pada sisa berkas
 * — tanpa jangkar itu, type cast berkurung seperti
 * `layanan={(layanan ?? []) as Array<{ id: string }>}` di
 * `src/app/passport/ajukan/page.tsx` akan tertuduh sebagai fungsi hanya
 * karena berkas yang sama kebetulan punya `=>` di tempat lain.
 *
 * Pembatas `[^()]*` untuk isi kurung parameter berarti destrukturisasi
 * sederhana (`({ id, nama }) => …`) tertangkap, tapi parameter dengan kurung
 * BERSARANG (mis. default value berupa pemanggilan fungsi) tidak — cakupan
 * yang cukup untuk pola yang sejauh ini pernah muncul di proyek ini.
 */
export function propArrowFungsi(isi: string): string[] {
  const pola = /(\w+)=\{\s*(?:async\s+)?(?:\([^()]*\)|\w+)\s*=>/g;
  return [...new Set([...isi.matchAll(pola)].map((m) => m[1]))];
}

const SEMUA_TSX_APP = berkasSumber("src/app");
const BERKAS_KLIEN = SEMUA_TSX_APP.filter((f) => baca(f).trimStart().startsWith('"use client"'));
const BERKAS_SERVER = berkasServer(SEMUA_TSX_APP);

describe("pagar batas Server → Client (prop fungsi)", () => {
  it("ada berkas .tsx yang dipindai di src/app (anti-hampa)", () => {
    expect(SEMUA_TSX_APP.length).toBeGreaterThan(0);
  });

  it("pemindaian benar-benar membedakan berkas klien dari berkas server (anti-hampa)", () => {
    // Bila salah satu sisi jadi nol, pagar ini memindai HANYA satu populasi
    // berkas dan tidak pernah berhasil membedakan apa pun.
    expect(BERKAS_KLIEN.length).toBeGreaterThan(0);
    expect(BERKAS_SERVER.length).toBeGreaterThan(0);
  });

  it("tidak ada berkas server yang mengirim prop berisi arrow function", () => {
    const pelanggar: string[] = [];
    for (const berkas of BERKAS_SERVER) {
      for (const prop of propArrowFungsi(baca(berkas))) {
        pelanggar.push(`${berkas}: prop "${prop}"`);
      }
    }
    expect(
      pelanggar,
      "prop berisi arrow function pada berkas server — ini akan crash di runtime " +
        'bila prop itu diterima komponen "use client" ("Functions cannot be passed ' +
        'directly to Client Components")',
    ).toEqual([]);
  });
});

describe("propArrowFungsi — bergigi", () => {
  it("menandai arrow function berkurung, dengan atau tanpa async", () => {
    expect(propArrowFungsi('labelUntuk={(nama) => `x ${nama}`}')).toEqual(["labelUntuk"]);
    expect(propArrowFungsi("onPilih={async (x) => { await f(x); }}")).toEqual(["onPilih"]);
  });

  it("menandai arrow function satu parameter tanpa kurung", () => {
    expect(propArrowFungsi("onClick={x => x + 1}")).toEqual(["onClick"]);
  });

  it("TIDAK menandai type cast berkurung — bentuk persis di passport/ajukan/page.tsx", () => {
    expect(
      propArrowFungsi("layanan={(layanan ?? []) as Array<{ id: string }>}"),
    ).toEqual([]);
  });

  it("TIDAK menandai berkas server SEKARANG — pagar ini harus hijau di tree saat ini", () => {
    for (const berkas of BERKAS_SERVER) {
      expect(propArrowFungsi(baca(berkas)), berkas).toEqual([]);
    }
  });
});
