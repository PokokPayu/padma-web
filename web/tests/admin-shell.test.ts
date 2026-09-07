/**
 * Penjagaan shell panel admin (`src/app/admin/layout.tsx`, `_shell/nav-admin.tsx`,
 * `src/app/admin/page.tsx`) dan hitungan antrean (`src/lib/admin/antrean.ts`).
 *
 * Kenapa test ini ada — tiga kelas regresi yang TIDAK menghasilkan error,
 * hanya panel yang "kelihatan jalan" sambil berbohong:
 *
 *  1. Jalur data. `hitungAntrean()` wajib memakai SESI PENGGUNA. Di bawah
 *     service role `user_role()` mengembalikan 'klien' dan `auth.uid()` NULL,
 *     sehingga hitungan tetap keluar (bahkan lebih besar) tetapi RLS tidak
 *     pernah ikut diperiksa. Karena itu hitungan diuji dengan klien ber-sesi
 *     nyata: admin melihat antrean, klien melihat nol.
 *  2. Badge antrean. Badge "0" yang tetap tampil membuat panel selalu terlihat
 *     punya pekerjaan — alarm yang dinormalkan berhenti berarti. Badge wajib
 *     hilang saat nol, dan angkanya wajib datang dari data, bukan literal.
 *  3. Penanda tab aktif. `pathname.startsWith("/admin")` cocok untuk SELURUH
 *     sub-rute, jadi "semua tab menyala" adalah bug yang paling gampang lolos.
 *
 * Ditambah dua pagar yang sudah dikunci berkas lain dan sengaja ditegaskan
 * ulang di sini karena Task ini menyentuh persis kedua berkas itu:
 * `layout.tsx` tepat satu `requireRole(["admin","owner"])`, dan dashboard tetap
 * menautkan `/admin/skrining`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { nominalDalam } from "./helpers/nominal";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Semua berkas .ts/.tsx di bawah src/app/admin, rekursif. */
function berkasAdmin(rel = "src/app/admin"): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(path.join(AKAR, rel), { withFileTypes: true })) {
    const anak = `${rel}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasAdmin(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

// `createServerSupabase()` membaca cookies() dari next/headers, yang hanya
// bermakna di dalam request scope. Seperti tests/passport-data.test.ts,
// modulnya diganti klien Supabase ber-SESI NYATA: seluruh query di bawah tetap
// melewati RLS sebagai pengguna yang login — persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// usePathname hanya hidup di dalam App Router. `redirect` sengaja diberi
// implementasi yang melempar: bila requireRole sampai memanggilnya, test harus
// GAGAL keras, bukan diam-diam merender halaman untuk pengguna yang ditolak.
const rute = vi.hoisted(() => ({ kini: "/admin" }));
vi.mock("next/navigation", () => ({
  usePathname: () => rute.kini,
  redirect: (ke: string) => {
    throw new Error(`redirect tak terduga ke ${ke}`);
  },
}));

const admin = createAdminSupabase();

const KLIEN_UJI = "44444444-4444-4444-4444-4444444444f4";
const PAKET_UJI = "55555555-5555-5555-5555-5555555555f4";
const SESI_UJI = "66666666-6666-6666-6666-6666666666f4";
const PERMINTAAN_UJI = "88888888-8888-8888-8888-8888888888f4";
const KODE_SKRINING = "PDM-UJI-ANTREAN-0004";
const PADMA_ID_UJI = "PAD-UJI-0004";
const SVC = "11111111-1111-1111-1111-111111111101";
const MITRA = "33333333-3333-3333-3333-333333333301";
const PAKET = "22222222-2222-2222-2222-222222222201";

async function bersihkan() {
  await admin.from("screenings").delete().eq("kode", KODE_SKRINING);
  await admin.from("booking_requests").delete().eq("id", PERMINTAAN_UJI);
  await admin.from("sessions").delete().eq("id", SESI_UJI);
  await admin.from("client_packages").delete().eq("id", PAKET_UJI);
  await admin.from("clients").delete().like("padma_id", "PAD-UJI%");

  // Jejak audit fixture ikut disapu — lihat tests/jejak-yatim.test.ts.
  //
  // Sesi dan paket di atas LAHIR berstatus 'menunggu_verifikasi', dan sejak
  // migration 20260829180000 pencatat jejak menutup jalur INSERT juga. Jadi
  // kedua penyisipan itu menulis dua baris `jejak_status_bayar`. Tabel jejak
  // SENGAJA tanpa foreign key (cascade akan menghapus tepat bukti yang
  // menjelaskan penghapusan), sehingga penghapusan di atas TIDAK menyapunya:
  // tanpa dua baris ini, `npm test` menumpuk +2 baris yatim per run, selamanya.
  //
  // Wajib lewat `admin` (SERVICE ROLE): `authenticated` sengaja tidak memegang
  // DELETE atas tabel jejak — baris audit tidak boleh dihapus oleh peran yang
  // sedang diaudit. Pagar hak itu properti keamanan, bukan kerepotan yang
  // boleh dilonggarkan supaya pembersihan ini lebih ringkas.
  await admin.from("jejak_status_bayar").delete().eq("sesi_id", SESI_UJI);
  await admin.from("jejak_status_bayar").delete().eq("paket_klien_id", PAKET_UJI);
}

const { hitungAntrean, hitungMenungguJenjangTransport } = await import("@/lib/admin/antrean");
const { NavAdmin } = await import("@/app/admin/_shell/nav-admin");

type Antrean = Awaited<ReturnType<typeof hitungAntrean>>;

const NOL: Antrean = {
  skriningBaru: 0,
  permintaanMenunggu: 0,
  klaimMenunggu: 0,
  klienBelumAktif: 0,
  // `hitungMenungguTarifTransport()` menghitung angka yang BENAR untuk admin
  // maupun owner (Ruling 12 mencabut gerbang peran itu — lihat
  // `lib/admin/antrean.ts`). Tidak ada tujuan menu yang memakainya sebagai
  // badge SIDEBAR di sini (ia tampil sebagai StatTile dashboard, bukan badge
  // nav), jadi NOL sudah cukup untuk fixture ini.
  menungguTarifTransport: 0,
  menungguJenjangTransport: 0,
};

function markupNav(pathname: string, antrean: Antrean = NOL): string {
  rute.kini = pathname;
  return renderToStaticMarkup(
    // NavAdmin mewajibkan `children` di tipenya (bukan opsional), jadi
    // createElement TIDAK BISA menyimpulkan properti itu terpenuhi lewat
    // argumen posisi ketiga — TypeScript tetap menuntutnya di objek props.
    // Berkas ini berekstensi .ts (bukan .tsx) sehingga sintaks JSX
    // `<NavAdmin>{null}</NavAdmin>` tidak tersedia sebagai jalan keluar.
    // eslint-disable-next-line react/no-children-prop
    createElement(NavAdmin, {
      antrean,
      nama: "Admin PADMA",
      peran: "Admin",
      children: null,
    }),
  );
}

let dasar: Antrean;
let sesudah: Antrean;

beforeAll(async () => {
  await bersihkan();
  ref.sesi = await signInAs("admin@padma.test");
  dasar = await hitungAntrean();

  // Klien uji SENGAJA bukan Ananda: rls-firewall.test.ts dan
  // passport-beranda.test.ts meng-assert jumlah baris Ananda secara PERSIS.
  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "Uji Antrean",
    email: "uji-antrean@padma.test",
    phase_id: "prekonsepsi",
  });
  await admin.from("screenings").insert({
    kode: KODE_SKRINING,
    nama: "Uji Antrean",
    no_hp: "0812-0000-4444",
    fase: "prekonsepsi",
    jawaban: {},
    hasil: "hijau",
    status_tindak_lanjut: "baru",
  });
  const varianSvc = await varianBaku(admin, SVC);
  await admin.from("booking_requests").insert({
    id: PERMINTAAN_UJI,
    client_id: KLIEN_UJI,
    service_id: SVC,
    variant_id: varianSvc,
    tanggal: "2026-12-24",
    preferensi_waktu: "pagi",
    status: "menunggu",
  });
  await admin.from("sessions").insert({
    id: SESI_UJI,
    client_id: KLIEN_UJI,
    service_id: SVC,
    variant_id: varianSvc,
    partner_id: MITRA,
    tanggal: "2026-12-24",
    status: "terjadwal",
    status_bayar: "menunggu_verifikasi",
  });
  await admin.from("client_packages").insert({
    id: PAKET_UJI,
    client_id: KLIEN_UJI,
    package_id: PAKET,
    status_bayar: "menunggu_verifikasi",
  });

  sesudah = await hitungAntrean();
});

afterAll(bersihkan);

describe("hitungAntrean — angka datang dari data, lewat RLS sesi pengguna", () => {
  it("skrining baru bertambah tepat satu", () => {
    expect(sesudah.skriningBaru).toBe(dasar.skriningBaru + 1);
  });

  it("permintaan jadwal menunggu bertambah tepat satu", () => {
    expect(sesudah.permintaanMenunggu).toBe(dasar.permintaanMenunggu + 1);
  });

  it("klaim menunggu menjumlahkan DUA sumber: sesi dan paket klien", () => {
    // Satu sesi + satu paket klien ditambahkan; bila salah satu sumber
    // terlupa, selisihnya hanya 1 dan antrean pembayaran diam-diam separuh.
    expect(sesudah.klaimMenunggu).toBe(dasar.klaimMenunggu + 2);
  });

  it("klien belum aktif bertambah tepat satu", () => {
    expect(sesudah.klienBelumAktif).toBe(dasar.klienBelumAktif + 1);
  });

  it("dihitung lewat sesi pengguna: klien tidak melihat antrean siapa pun", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = await signInAs("ananda@padma.test");
    const milikKlien = await hitungAntrean();
    ref.sesi = sebelumnya;

    // Bila hitungan memakai service role, angka ini akan sama dengan angka
    // admin — bukan nol. Skrining adalah pembeda paling tajam: klien tidak
    // pernah boleh melihat satu baris pun.
    expect(milikKlien.skriningBaru).toBe(0);
    // Klien hanya melihat baris clients miliknya sendiri, yang sudah tertaut.
    expect(milikKlien.klienBelumAktif).toBe(0);
  });

  it("tidak ada service role di lapisan hitungan", () => {
    const sumber = baca("src/lib/admin/antrean.ts");
    expect(sumber).toContain("createServerSupabase");
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });

  // --- Ruling 26 (gelombang perbaikan akhir): satu galat baca tidak boleh ---
  // --- menjatuhkan SELURUH shell admin (/admin/bayar, /sesi, /skrining) -----

  /**
   * Ganjalan tipis di atas klien Supabase SUNGGUHAN — sama polanya dengan
   * `klienGalatMenungguTransport` di tests/admin-bayar.test.ts: setiap tabel
   * LAIN tetap lewat ke klien asli, hanya query ke
   * `sesi_menunggu_tarif_transport` yang dipaksa memulangkan galat.
   * `ambilSesiMenungguTarif()` (lib/owner/data.ts) mem-paginasi lewat
   * `.order().order().range().returns()` di atas tabel itu — proxy generik
   * ini menampung rantai method APA PUN, bukan cuma satu bentuk pemanggilan.
   */
  function klienGalatMenungguTransport(asli: SupabaseClient): SupabaseClient {
    const hasilGalat = { data: null, error: { message: "galat paksa (uji Ruling 26)" } };
    const stub: unknown = new Proxy(() => {}, {
      apply: () => stub,
      get: (_t, prop) =>
        prop === "then" ? (resolve: (v: unknown) => void) => resolve(hasilGalat) : () => stub,
    });
    return new Proxy(asli, {
      get(target, prop, receiver) {
        if (prop === "from") {
          return (tabel: string) =>
            tabel === "sesi_menunggu_tarif_transport"
              ? stub
              : Reflect.get(target, "from").call(target, tabel);
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as SupabaseClient;
  }

  it("hitungAntrean() TIDAK throw saat sesi_menunggu_tarif_transport gagal dibaca — degradasi ke 0 (Ruling 26)", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = klienGalatMenungguTransport(sebelumnya!);

    let hasil: Awaited<ReturnType<typeof hitungAntrean>> | undefined;
    await expect(
      (async () => {
        hasil = await hitungAntrean();
      })(),
    ).resolves.not.toThrow();

    ref.sesi = sebelumnya;

    // Degradasi ke 0 — sama seperti empat saudaranya (skriningBaru dkk. sudah
    // memakai `.count ?? 0`), BUKAN gerbang peran yang mengembalikan 0 secara
    // permanen: pada request BERIKUTNYA yang berhasil, angkanya kembali benar
    // (dibuktikan `dasar`/`sesudah` di describe ini datang dari klien yang
    // sama, tidak pernah lewat proxy galat).
    expect(hasil?.menungguTarifTransport).toBe(0);
    // Empat angka lain TIDAK ikut jatuh — satu tabel gagal bukan alasan
    // seluruh antrean kosong. Dibandingkan ke `sesudah` (bukan `dasar`):
    // fixture beforeAll sudah menambahkan baris-barisnya pada titik ini.
    expect(hasil?.skriningBaru).toBe(sesudah.skriningBaru);
    expect(hasil?.klienBelumAktif).toBe(sesudah.klienBelumAktif);
  });

  it("ambilSesiMenungguTarif() SENDIRI (dipakai /owner/transport) tetap THROW pada galat yang sama — disiplin berbeda disengaja (Ruling 26)", async () => {
    const { ambilSesiMenungguTarif } = await import("@/lib/owner/data");
    const sebelumnya = ref.sesi;
    ref.sesi = klienGalatMenungguTransport(sebelumnya!);

    await expect(ambilSesiMenungguTarif()).rejects.toThrow();

    ref.sesi = sebelumnya;
  });

  // --- Ruling 24 (gelombang perbaikan akhir): antrean sesi selesai tanpa ---
  // --- jenjang — lubang honor yang sebelumnya sama sekali tidak terlihat --

  it("hitungMenungguJenjangTransport() menghitung sesi SELESAI ber-jenjang null, mengabaikan yang terjadwal/berjenjang (Ruling 24)", async () => {
    const varianSvc = await varianBaku(admin, SVC);
    const SESI_JENJANG_NULL = "66666666-6666-6666-6666-6666666666f5";
    const SESI_TERJADWAL_NULL = "66666666-6666-6666-6666-6666666666f6";

    const sebelum = await hitungMenungguJenjangTransport();
    try {
      const { error: galatInsert } = await admin.from("sessions").insert([
        {
          id: SESI_JENJANG_NULL,
          client_id: KLIEN_UJI,
          service_id: SVC,
          variant_id: varianSvc,
          partner_id: MITRA,
          tanggal: "2026-12-24",
          // SELESAI + jenjang null: persis kasus geocoding gagal pada sesi
          // baru (Ruling 24) — inilah satu-satunya baris yang harus terhitung.
          status: "selesai",
          catatan: "Kunjungan selesai, alamat tidak dikenali OSM.",
          jenjang: null,
        },
        {
          id: SESI_TERJADWAL_NULL,
          client_id: KLIEN_UJI,
          service_id: SVC,
          variant_id: varianSvc,
          partner_id: MITRA,
          tanggal: "2026-12-25",
          // TERJADWAL + jenjang null: wajar (belum ada yang perlu dihitung),
          // TIDAK boleh ikut masuk antrean ini.
          status: "terjadwal",
          catatan: "",
          jenjang: null,
        },
      ]);
      expect(galatInsert, galatInsert?.message).toBeNull();

      const sesudahInsert = await hitungMenungguJenjangTransport();
      expect(sesudahInsert).toBe(sebelum + 1);

      const antreanBaru = await hitungAntrean();
      expect(antreanBaru.menungguJenjangTransport).toBe(sesudahInsert);
    } finally {
      const IDS = [SESI_JENJANG_NULL, SESI_TERJADWAL_NULL];
      // Sesi ini lahir dengan status_bayar default (bukan menunggu_verifikasi
      // via update), tapi jejaknya tetap disapu mengikuti pola `bersihkan()`
      // di atas — tabel jejak sengaja tanpa FK, jadi tidak akan tersapu
      // otomatis oleh penghapusan sesi di bawah.
      await admin.from("jejak_status_bayar").delete().in("sesi_id", IDS);
      await admin.from("sessions").delete().in("id", IDS);
    }
  });
});

describe("navigasi admin", () => {
  const sumberNav = baca("src/app/admin/_shell/nav-admin.tsx");

  it("client component (butuh usePathname lewat KerangkaPanel)", () => {
    expect(sumberNav.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("memuat sembilan tujuan berbahasa Indonesia di sidebar", () => {
    const m = markupNav("/admin");
    const tujuan = [
      ["/admin", "Beranda"],
      ["/admin/skrining", "Inbox"],
      ["/admin/klien", "Klien"],
      ["/admin/sesi", "Sesi"],
      ["/admin/bayar", "Bayar"],
      ["/admin/mitra", "Mitra"],
      ["/admin/layanan", "Layanan"],
      ["/admin/materi", "Materi"],
      ["/admin/pengaturan", "Setelan"],
    ];
    for (const [href, label] of tujuan) {
      expect(m).toContain(`href="${href}"`);
      expect(m).toContain(label);
    }
    // Sembilan tautan sidebar + empat tautan bar bawah. Dikunci PERSIS:
    // tujuan yang lahir tanpa memperbarui daftar di atas akan lolos dari
    // seluruh assertion `toContain` tanpa satu pun test merah.
    expect([...m.matchAll(/<a\b/g)]).toHaveLength(9 + 4);
  });

  it("bar bawah memuat empat tujuan tersibuk, bukan salinan seluruh menu", () => {
    const m = markupNav("/admin");
    // Empat tujuan tersibuk hadir DUA kali (sidebar + bar bawah);
    // sisanya sekali, hanya di sidebar yang di layar kecil jadi drawer.
    for (const href of ["/admin/skrining", "/admin/klien", "/admin/sesi", "/admin/bayar"]) {
      expect([...m.matchAll(new RegExp(`href="${href}"`, "g"))], href).toHaveLength(2);
    }
    for (const href of ["/admin/mitra", "/admin/layanan", "/admin/materi", "/admin/pengaturan"]) {
      expect([...m.matchAll(new RegExp(`href="${href}"`, "g"))], href).toHaveLength(1);
    }
  });

  it("menyediakan sidebar DAN bar bawah, masing-masing berlabel", () => {
    const m = markupNav("/admin");
    // Sidebar dirender sekali dan menjadi drawer di layar kecil; bar bawah
    // adalah nav kedua. Tiga nav berarti sidebar tersalin dua kali.
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect([...m.matchAll(/aria-label="[^"]+"/g)].length).toBeGreaterThanOrEqual(2);
    expect(m).toContain("lg:hidden"); // bar bawah & tombol drawer
    expect(m).toContain("lg:translate-x-0"); // sidebar menetap di layar besar
  });

  it("badge HILANG saat antrean nol (alarm tidak dinormalkan)", () => {
    const m = markupNav("/admin", NOL);
    expect(m).not.toContain("menunggu");
    expect(m).not.toMatch(/>0</);
  });

  it("badge menampilkan angka nyata untuk tiap tujuan yang punya antrean", () => {
    const m = markupNav("/admin", {
      skriningBaru: 3,
      permintaanMenunggu: 5,
      klaimMenunggu: 9,
      klienBelumAktif: 7,
      menungguTarifTransport: 0,
      menungguJenjangTransport: 0,
    });
    // Keempat tujuan berbadge ada di sidebar DAN bar bawah -> dua kali.
    expect([...m.matchAll(/aria-label="3 menunggu"/g)]).toHaveLength(2); // Inbox
    expect([...m.matchAll(/aria-label="7 menunggu"/g)]).toHaveLength(2); // Klien
    expect([...m.matchAll(/aria-label="5 menunggu"/g)]).toHaveLength(2); // Sesi
    expect([...m.matchAll(/aria-label="9 menunggu"/g)]).toHaveLength(2); // Bayar
    for (const tag of m.match(/<a[^>]*>[\s\S]*?<\/a>/g) ?? []) {
      if (tag.includes('aria-label="9 menunggu"')) {
        expect(tag).toContain('href="/admin/bayar"');
      }
    }
  });

  it("badge nol tetap hilang walau tujuan lain punya antrean", () => {
    const m = markupNav("/admin", { ...NOL, skriningBaru: 2 });
    expect([...m.matchAll(/aria-label="\d+ menunggu"/g)]).toHaveLength(2);
  });

  it("angka badge datang dari prop, bukan literal di dalam nav", () => {
    // Nav adalah client component: ia tidak boleh mengambil datanya sendiri,
    // dan tidak boleh menuliskan angka antrean sebagai konstanta.
    expect(sumberNav).not.toContain("hitungAntrean");
    expect(sumberNav).toContain("antrean[");
  });

  it("hanya SATU tujuan yang aktif di beranda", () => {
    const m = markupNav("/admin");
    // Beranda hanya ada di sidebar (bukan tujuan bar bawah), jadi satu.
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(1);
  });

  it("sub-rute menyalakan tujuannya sendiri, bukan Beranda", () => {
    const m = markupNav("/admin/skrining");
    // Inbox hadir di sidebar dan bar bawah -> dua penanda aktif.
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/admin"') && !tag.includes("/admin/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("rute anak (detail klien) tetap menyalakan tujuan Klien", () => {
    const m = markupNav(`/admin/klien/${KLIEN_UJI}`);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/admin/klien"')) {
        expect(tag).toContain('aria-current="page"');
      }
    }
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
  });

  it("tidak ada nominal uang di navigasi (money firewall)", () => {
    const m = markupNav("/admin", {
      skriningBaru: 1,
      permintaanMenunggu: 1,
      klaimMenunggu: 1,
      klienBelumAktif: 1,
      menungguTarifTransport: 1,
      menungguJenjangTransport: 1,
    });
    expect(nominalDalam(m), "nominal bocor").toEqual([]);
    expect(nominalDalam(sumberNav), "nominal bocor").toEqual([]);
  });
});

describe("layout admin", () => {
  const sumberLayout = baca("src/app/admin/layout.tsx");

  it("memanggil requireRole TEPAT SATU KALI dengan peran persis admin+owner", () => {
    // Dikunci juga oleh access-matrix-layouts.test.ts & admin-inbox.test.ts;
    // ditegaskan di sini karena Task ini menyentuh persis berkas itu, dan
    // "ambil ulang perannya saja untuk dapat nama" adalah godaan paling wajar.
    expect([...sumberLayout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(sumberLayout).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("mengambil antrean di server lalu meneruskannya ke nav sebagai prop", () => {
    expect(sumberLayout).toMatch(
      /import\s*\{[^}]*\bhitungAntrean\b[^}]*\}\s*from\s*["']@\/lib\/admin\/antrean["']/,
    );
    expect(sumberLayout).toContain("await hitungAntrean()");
    expect(sumberLayout).toMatch(/<NavAdmin\s+antrean=\{antrean\}/);
    expect(baca("src/app/admin/_shell/nav-admin.tsx")).not.toContain("hitungAntrean");
  });

  // Logout tidak lagi ditulis di layout: ia pindah ke komponen shell bersama —
  // menu akun di dalam kartu nav, dan tombol versi mobile di halaman akun.
  // Penjaganya ikut pindah ke sana; yang dijaga tetap sama persis, yaitu
  // navigasi dokumen penuh, bukan navigasi sisi klien yang menyisakan Client
  // Cache milik pemakai sebelumnya.
  it("logout tetap <form method=\"post\">, bukan navigasi sisi klien", () => {
    for (const berkas of [
      "src/app/_shell/menu-akun.tsx",
      "src/app/_shell/tombol-keluar.tsx",
    ]) {
      const sumber = baca(berkas);
      expect(sumber, berkas).toMatch(
        /<form[^>]*action="\/auth\/keluar"[^>]*method="post"/,
      );
      expect(sumber, berkas).not.toContain("router.push");
    }
    // Dan layout tidak boleh menumbuhkan jalan keluarnya sendiri lagi.
    expect(sumberLayout).not.toContain("/auth/keluar");
  });

  // Keluhan yang memicu perubahan ini: ada satu baris teks mengapung di atas
  // kartu nav yang tidak pernah ada di prototipe. Identitas tetap WAJIB tampil
  // — owner adalah superset admin dan boleh membuka /admin, jadi ia perlu tahu
  // sedang memakai akun apa — tetapi tempatnya kini di dalam kartu nav.
  it("identitas tidak lagi berupa strip terpisah di atas kartu nav", () => {
    expect(sumberLayout).not.toContain("Masuk sebagai");
    expect(baca("src/app/_shell/menu-akun.tsx")).toContain("Masuk sebagai");
  });

  it("benar-benar merender navigasi di sekitar isi halaman", async () => {
    const { default: AdminLayout } = await import("@/app/admin/layout");
    rute.kini = "/admin";
    const m = renderToStaticMarkup(
      await AdminLayout({ children: createElement("p", null, "ISI-UJI") }),
    );
    expect(m).toContain("ISI-UJI");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect(m).toContain('href="/admin/skrining"');
  });

  it("tidak ada service role di seluruh src/app/admin/**, kecuali titik yang plan sebut eksplisit", () => {
    // Rencana materi-ebook-pdf (Global Constraints) menulis ulang pagar ini
    // sendiri: "createAdminSupabase() hanya boleh dipakai di titik yang
    // disebut eksplisit oleh task, dan hanya SESUDAH hak diputuskan RLS."
    // `unggah.ts` (Task 7) adalah titik itu — BUKAN pelonggaran pagar ini.
    //
    // Bucket `materi-halaman` SENGAJA lahir tanpa satu pun policy
    // storage.objects (migration materi_halaman_pdf): authenticated dan anon
    // tidak punya hak apa pun di sana sama sekali, jadi tidak ada RLS untuk
    // "dilewati" — service role satu-satunya cara menyentuh objeknya, titik.
    // Hak yang MEMANG diputuskan RLS (materi ini ada & terlihat peran staf)
    // tetap dicek lewat createServerSupabase() lebih dulu; admin.storage baru
    // lahir sesudahnya. Lihat komentar di dalam unggah.ts sendiri.
    const DIKECUALIKAN = new Set(["src/app/admin/materi/unggah.ts"]);
    for (const berkas of berkasAdmin()) {
      if (DIKECUALIKAN.has(berkas)) continue;
      expect(baca(berkas), `${berkas} memakai service role`).not.toContain(
        "createAdminSupabase",
      );
      expect(baca(berkas), `${berkas} memakai service role`).not.toContain(
        "SERVICE_ROLE",
      );
    }
  });
});

describe("dashboard admin", () => {
  const sumberDashboard = baca("src/app/admin/page.tsx");

  async function markupDashboard(): Promise<string> {
    const { default: AdminPage } = await import("@/app/admin/page");
    rute.kini = "/admin";
    return renderToStaticMarkup(await AdminPage());
  }

  it("tetap menautkan inbox skrining (pagar lama, jangan dilepas)", () => {
    expect(sumberDashboard).toContain('href="/admin/skrining"');
  });

  it("menampilkan kelima angka antrean apa adanya", async () => {
    const m = await markupDashboard();
    for (const [label, angka] of [
      ["Skrining baru", sesudah.skriningBaru],
      ["Permintaan jadwal", sesudah.permintaanMenunggu],
      ["Klaim pembayaran", sesudah.klaimMenunggu],
      ["Klien belum aktif", sesudah.klienBelumAktif],
      // Task 8, Ruling 12: dihitung dari VIEW sesi_menunggu_tarif_transport
      // (nol nominal), dan sungguhan dirender di sini — bukan sekadar
      // dihitung lalu dibuang. Label dicocokkan dengan "&gt;" (bentuk ESCAPED
      // React untuk ">" pada markup HTML mentah), bukan literal ">".
      ["Sesi &gt;20 km menunggu tarif", sesudah.menungguTarifTransport],
    ] as const) {
      expect(m, `stat tile "${label}" tidak ada`).toContain(label);
      expect(m).toContain(`>${angka}<`);
    }
  });

  it("setiap angka antrean menautkan modul yang menanganinya", async () => {
    const m = await markupDashboard();
    for (const href of [
      "/admin/skrining",
      "/admin/klien",
      "/admin/sesi",
      "/admin/bayar",
    ]) {
      expect(m).toContain(`href="${href}"`);
    }
  });

  // StatTile "Sesi >20 km
  // menunggu tarif" adalah SATU-SATUNYA yang tautannya bergantung peran —
  // owner bisa menuntaskannya di /owner/transport, admin biasa tidak berhak
  // sama sekali (tetapkanTarifKhusus menuntut requireRole(["owner"])), jadi
  // memberinya href yang sama untuk admin hanya memantulkannya keluar tanpa
  // penjelasan. Dua uji terpisah membuktikan KEDUA sisi perilaku ini —
  // bukan hanya "href ada", karena "href ada" untuk admin justru salah.
  it("StatTile transport TIDAK bertaut untuk admin biasa", async () => {
    const m = await markupDashboard(); // ref.sesi default: admin@padma.test
    expect(m).not.toContain('href="/owner/transport"');
    // Angkanya tetap tampil — hanya tautannya yang hilang.
    expect(m).toContain("Sesi &gt;20 km menunggu tarif");
  });

  it("StatTile transport bertaut ke /owner/transport untuk OWNER", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = await signInAs("owner@padma.test");
    const m = await markupDashboard();
    ref.sesi = sebelumnya;
    expect(m).toContain('href="/owner/transport"');
  });

  it("membawa grafik tren delapan pekan, lengkap dengan padanan tabelnya", async () => {
    const m = await markupDashboard();
    expect([...m.matchAll(/data-batang="/g)]).toHaveLength(8);
    expect(m).toContain("Lihat sebagai tabel");
  });

  it("membawa agenda hari ini dan aktivitas terbaru", async () => {
    const m = await markupDashboard();
    expect(m).toContain("Agenda hari ini");
    expect(m).toContain("Aktivitas terbaru");
  });

  it("aksi cepat menuju formulir yang sebenarnya, bukan tautan mati", async () => {
    const m = await markupDashboard();
    // Diperiksa pada TAG yang membawa label itu sendiri, bukan pada seluruh
    // dokumen: kedua href ini SUDAH muncul lebih dulu lewat StatTile antrean
    // ("Klien belum aktif" -> /admin/klien, "Permintaan jadwal" -> /admin/sesi),
    // jadi `toContain('href="/admin/klien"')` polos akan tetap hijau sekalipun
    // tombol aksi cepatnya sendiri tidak pernah dirender — persis regresi yang
    // memicu perbaikan ini. Mengikat pemeriksaan ke tag yang memuat label
    // tombol menutup celah itu.
    for (const [label, href] of [
      ["+ Klien baru", "/admin/klien"],
      ["+ Sesi baru", "/admin/sesi"],
    ] as const) {
      const tag = (m.match(/<a[^>]*>[\s\S]*?<\/a>/g) ?? []).find((t) => t.includes(label));
      expect(tag, `tombol aksi cepat "${label}" tidak ditemukan`).toBeTruthy();
      expect(tag).toContain(`href="${href}"`);
    }
  });

  it("TIDAK ada nominal uang di dashboard (money firewall)", async () => {
    const m = await markupDashboard();
    expect(nominalDalam(m), "nominal bocor").toEqual([]);
    expect(nominalDalam(sumberDashboard), "nominal bocor").toEqual([]);
    expect(sumberDashboard).not.toContain("formatRupiah");
    expect(sumberDashboard).not.toContain("@/lib/owner/rupiah");
  });

  it("penjaga peran tepat satu kali dengan daftar peran persis", () => {
    expect([...sumberDashboard.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(sumberDashboard).toMatch(
      /await\s+requireRole\(\s*\[\s*"admin"\s*,\s*"owner"\s*\]\s*\)/,
    );
  });

  it("hari ini menurut kalender Jakarta, bukan jam server", () => {
    expect(sumberDashboard).toContain("hariIniJakarta");
    expect(sumberDashboard).not.toContain("new Date()");
  });
});
