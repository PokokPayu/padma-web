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

const { hitungAntrean } = await import("@/lib/admin/antrean");
const { NavAdmin } = await import("@/app/admin/_shell/nav-admin");

type Antrean = Awaited<ReturnType<typeof hitungAntrean>>;

const NOL: Antrean = {
  skriningBaru: 0,
  permintaanMenunggu: 0,
  klaimMenunggu: 0,
  klienBelumAktif: 0,
};

function markupNav(pathname: string, antrean: Antrean = NOL): string {
  rute.kini = pathname;
  return renderToStaticMarkup(createElement(NavAdmin, { antrean }));
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
  await admin.from("booking_requests").insert({
    id: PERMINTAAN_UJI,
    client_id: KLIEN_UJI,
    service_id: SVC,
    tanggal: "2026-12-24",
    preferensi_waktu: "pagi",
    status: "menunggu",
  });
  await admin.from("sessions").insert({
    id: SESI_UJI,
    client_id: KLIEN_UJI,
    service_id: SVC,
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
});

describe("navigasi admin", () => {
  const sumberNav = baca("src/app/admin/_shell/nav-admin.tsx");

  it("client component (butuh usePathname)", () => {
    expect(sumberNav.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("memuat enam tujuan berbahasa Indonesia", () => {
    const m = markupNav("/admin");
    for (const [href, label] of [
      ["/admin", "Beranda"],
      ["/admin/skrining", "Inbox"],
      ["/admin/klien", "Klien"],
      ["/admin/sesi", "Sesi"],
      ["/admin/bayar", "Bayar"],
      ["/admin/mitra", "Mitra"],
    ]) {
      expect(m).toContain(`href="${href}"`);
      expect(m).toContain(label);
    }
  });

  it("menyediakan tab desktop DAN bottom bar mobile", () => {
    const m = markupNav("/admin");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect(m).toContain("sm:hidden"); // bottom bar mobile
    expect(m).toContain("sm:flex"); // tab desktop (hidden di mobile)
    expect([...m.matchAll(/href="\/admin\/sesi"/g)]).toHaveLength(2);
  });

  it("kedua nav punya label aksesibilitas", () => {
    const m = markupNav("/admin");
    expect([...m.matchAll(/aria-label="[^"]+"/g)].length).toBeGreaterThanOrEqual(2);
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
    });
    // Dua nav -> tiap badge muncul dua kali.
    expect([...m.matchAll(/aria-label="3 menunggu"/g)]).toHaveLength(2); // Inbox
    expect([...m.matchAll(/aria-label="7 menunggu"/g)]).toHaveLength(2); // Klien
    expect([...m.matchAll(/aria-label="5 menunggu"/g)]).toHaveLength(2); // Sesi
    // klaimMenunggu SUDAH punya tujuannya sendiri sejak modul /admin/bayar
    // lahir. Sebelumnya angka ini sengaja tidak dirender sebagai badge —
    // menandai bahwa modulnya belum ada — dan yang dijaga adalah agar ia tidak
    // nyasar ke tab lain. Sekarang yang dijaga MENGUAT: ia wajib muncul, tepat
    // dua kali (tab desktop + bottom bar), dan tetap hanya di tab Bayar.
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

  it("hanya SATU tujuan yang aktif di beranda", () => {
    const m = markupNav("/admin");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
  });

  it("sub-rute menyalakan tabnya sendiri, bukan Beranda", () => {
    const m = markupNav("/admin/skrining");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/admin"') && !tag.includes("/admin/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("rute anak (detail klien) tetap menyalakan tab Klien", () => {
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
    });
    expect(m).not.toMatch(/Rp\s?\d/);
    expect(sumberNav).not.toMatch(/Rp\s?\d/);
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
    // Nav adalah client component: ia tidak boleh mengambil datanya sendiri.
    expect(baca("src/app/admin/_shell/nav-admin.tsx")).not.toContain(
      "hitungAntrean",
    );
  });

  it("logout tetap <form method=\"post\">, bukan navigasi sisi klien", () => {
    expect(sumberLayout).toMatch(
      /<form[^>]*action="\/auth\/keluar"[^>]*method="post"/,
    );
    expect(sumberLayout).not.toContain("router.push");
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

  it("tidak ada service role di seluruh src/app/admin/**", () => {
    for (const berkas of berkasAdmin()) {
      expect(baca(berkas), `${berkas} memakai service role`).not.toContain(
        "createAdminSupabase",
      );
      expect(baca(berkas), `${berkas} memakai service role`).not.toContain(
        "SERVICE_ROLE",
      );
    }
  });
});

describe("dashboard antrean admin", () => {
  const sumberDashboard = baca("src/app/admin/page.tsx");

  it("tetap menautkan inbox skrining (pagar lama, jangan dilepas)", () => {
    expect(sumberDashboard).toContain('href="/admin/skrining"');
  });

  it("menampilkan keempat angka antrean apa adanya", async () => {
    const { default: AdminPage } = await import("@/app/admin/page");
    rute.kini = "/admin";
    const m = renderToStaticMarkup(await AdminPage());

    for (const [label, angka] of [
      ["Skrining baru", sesudah.skriningBaru],
      ["Permintaan jadwal", sesudah.permintaanMenunggu],
      ["Klaim pembayaran", sesudah.klaimMenunggu],
      ["Klien belum aktif", sesudah.klienBelumAktif],
    ] as const) {
      expect(m, `kartu "${label}" tidak ada`).toContain(label);
      expect(m).toContain(`>${angka}<`);
    }
  });

  it("kartu antrean menautkan ke modul yang menanganinya", async () => {
    const { default: AdminPage } = await import("@/app/admin/page");
    rute.kini = "/admin";
    const m = renderToStaticMarkup(await AdminPage());
    // Keempat angka — termasuk "Klaim pembayaran", yang sejak modul
    // /admin/bayar lahir tidak boleh lagi menjadi angka tanpa tujuan.
    for (const href of [
      "/admin/skrining",
      "/admin/klien",
      "/admin/sesi",
      "/admin/bayar",
    ]) {
      expect(m).toContain(`href="${href}"`);
    }
  });

  it("tidak ada nominal uang di dashboard (money firewall)", async () => {
    const { default: AdminPage } = await import("@/app/admin/page");
    rute.kini = "/admin";
    const m = renderToStaticMarkup(await AdminPage());
    expect(m).not.toMatch(/Rp\s?\d/);
    expect(sumberDashboard).not.toMatch(/Rp\s?\d/);
  });
});
