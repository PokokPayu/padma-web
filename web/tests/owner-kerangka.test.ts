/**
 * Penjagaan KERANGKA (shell) panel owner — `src/app/owner/layout.tsx`,
 * `src/app/owner/_shell/nav-owner.tsx`, `src/app/owner/page.tsx`, dan lapisan
 * data `src/lib/owner/data.ts`.
 *
 * Kenapa berkas ini ada — empat kelas regresi yang TIDAK menghasilkan error,
 * hanya panel yang "kelihatan jalan" sambil berbohong:
 *
 *  1. Argumen penjaga peran. `src/app/owner/layout.tsx` wajib memanggil
 *     `requireRole` TEPAT SATU KALI dengan daftar peran PERSIS `["owner"]`.
 *     Menuliskannya `["admin","owner"]` (meniru panel admin, godaan paling
 *     wajar saat menyalin shell-nya) membuka seluruh nominal uang PADMA kepada
 *     admin tanpa satu pun test lain merah selain access-matrix-layouts.
 *  2. Jalur data. Rekap owner wajib memakai SESI PENGGUNA. Di bawah service
 *     role `user_role()` mengembalikan 'klien' dan RLS money firewall tidak
 *     pernah ikut diperiksa — angkanya tetap keluar, tetapi keluar untuk
 *     SIAPA PUN yang memanggil, dan halaman yang bocor akan terlihat benar.
 *  3. Pekan berjalan. Ringkasan beranda mengelompokkan honor menurut Senin
 *     kalender Jakarta. Sesi pekan LALU yang bocor ke kartu "pekan ini" tidak
 *     menghasilkan error apa pun — hanya angka honor yang salah dibayarkan.
 *  4. Sesi tak bertarif. Sesi yang lebih tua dari tarif paling awal TIDAK
 *     boleh dihitung nol diam-diam: itu uang yang hilang tanpa jejak. Beranda
 *     wajib menghitungnya sebagai peringatan, bukan menelannya.
 *
 * Ditambah pagar produk Task 3: owner hari ini tidak punya satu pun tautan
 * klik dari `/owner` ke `/admin` (terverifikasi: 0 tautan) walau ia superset
 * admin — jalan pulang itu dikunci di sini supaya tidak hilang lagi.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { awalPekan, geserHari, rentangPekan } from "@/lib/owner/pekan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { formatRupiah } from "@/lib/owner/rupiah";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Semua berkas .ts/.tsx di bawah src/app/owner, rekursif. */
function berkasOwner(rel = "src/app/owner"): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(path.join(AKAR, rel), { withFileTypes: true })) {
    const anak = `${rel}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasOwner(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

// `createServerSupabase()` membaca cookies() dari next/headers, yang hanya
// bermakna di dalam request scope. Seperti tests/admin-shell.test.ts, modulnya
// diganti klien Supabase ber-SESI NYATA: seluruh query di bawah tetap melewati
// RLS sebagai owner yang login — persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

// usePathname hanya hidup di dalam App Router. `redirect` sengaja melempar:
// bila requireRole sampai memanggilnya, test harus GAGAL keras, bukan diam-diam
// merender panel uang untuk pengguna yang ditolak.
const rute = vi.hoisted(() => ({ kini: "/owner" }));
vi.mock("next/navigation", () => ({
  usePathname: () => rute.kini,
  redirect: (ke: string) => {
    throw new Error(`redirect tak terduga ke ${ke}`);
  },
}));

const admin = createAdminSupabase();

// Fixture berprefiks PAD-UJI + dibersihkan afterAll (Global Constraints).
const LAYANAN_UJI = "11111111-1111-1111-1111-1111111111f3";
const LAYANAN_TANPA_TARIF = "11111111-1111-1111-1111-1111111112f3";
// Harga menempel di VARIAN sejak Task 3 — setiap layanan fixture di atas
// memperoleh varian BAKU sendiri (label kosong, sama seperti backfill Task 1).
const VARIAN_UJI = "11111111-1111-1111-1111-2111111111f3";
const VARIAN_TANPA_TARIF = "11111111-1111-1111-1111-2111111112f3";
const MITRA_A = "33333333-3333-3333-3333-3333333333f3";
const MITRA_B = "33333333-3333-3333-3333-3333333334f3";
const TARIF_UJI = "99999999-9999-9999-9999-9999999999f3";
const KLIEN_UJI = "44444444-4444-4444-4444-4444444444f3";
const PADMA_ID_UJI = "PAD-UJI-0003";
const SESI = {
  a1: "66666666-6666-6666-6666-6666666661f3",
  a2: "66666666-6666-6666-6666-6666666662f3",
  b1: "66666666-6666-6666-6666-6666666663f3",
  pekanLalu: "66666666-6666-6666-6666-6666666664f3",
  terjadwal: "66666666-6666-6666-6666-6666666665f3",
  batal: "66666666-6666-6666-6666-6666666666f3",
  takBertarif: "66666666-6666-6666-6666-6666666667f3",
};

// Tarif fixture: harga 400.000, honor 150.000 -> margin 250.000 per sesi.
const HARGA = 400_000;
const HONOR = 150_000;

// Pekan berjalan menurut kalender Jakarta. SENIN dipakai sebagai tanggal sesi
// (bukan hari acak dalam pekan) supaya tanggalnya tidak pernah jatuh di masa
// depan — sesi "selesai" bertanggal besok akan menjadi fixture yang mustahil.
const HARI_INI = hariIniJakarta();
const SENIN = awalPekan(HARI_INI);
const SENIN_LALU = geserHari(SENIN, -7);

// `berlaku_sejak` jauh sebelum seluruh tanggal sesi fixture, sehingga tarif
// yang terpilih selalu tarif ini — tidak bergantung pada tanggal `db reset`
// (tarif seed lahir dengan `berlaku_sejak = current_date`).
const BERLAKU_SEJAK = "2020-01-06";

async function bersihkan() {
  for (const id of Object.values(SESI)) {
    await admin.from("sessions").delete().eq("id", id);
    // Tabel jejak SENGAJA tanpa foreign key, jadi penghapusan sesi di atas
    // TIDAK menyapunya. Sesi fixture lahir berstatus 'belum' (yang menurut
    // migration tutup_celah_red_team bukan keputusan uang dan tidak dicatat),
    // tetapi pembersihan ini tetap dijalankan: bila perilaku itu berubah,
    // `npm test` tidak boleh menumpuk baris yatim tiap run.
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", id);
  }
  await admin.from("clients").delete().eq("id", KLIEN_UJI);
  await admin.from("variant_rates").delete().eq("id", TARIF_UJI);
  await admin.from("variant_rates").delete().eq("variant_id", VARIAN_UJI);
  await admin.from("partners").delete().eq("id", MITRA_A);
  await admin.from("partners").delete().eq("id", MITRA_B);
  // `service_variants` dulu — FK-nya menunjuk `services`, urutan penghapusan
  // terbalik dari urutan penyisipan. Disapu per SERVICE_ID (bukan per id
  // varian yang kita catat sendiri): trigger `trg_terbitkan_varian_baku`
  // menerbitkan satu varian baku OTOMATIS begitu tiap layanan fixture
  // disisipkan, dengan id acak yang tidak pernah kita tahu — menyapu hanya
  // `VARIAN_UJI` dkk. meninggalkan varian otomatis itu yatim, dan FK-nya
  // menahan penghapusan `services` di bawah.
  await admin.from("service_variants").delete().eq("service_id", LAYANAN_UJI);
  await admin.from("service_variants").delete().eq("service_id", LAYANAN_TANPA_TARIF);
  await admin.from("services").delete().eq("id", LAYANAN_UJI);
  await admin.from("services").delete().eq("id", LAYANAN_TANPA_TARIF);
}

const { ambilRekap, ringkasanPekanIni } = await import("@/lib/owner/data");
const { NavOwner } = await import("@/app/owner/_shell/nav-owner");

type Ringkasan = Awaited<ReturnType<typeof ringkasanPekanIni>>;

function markupNav(pathname: string): string {
  rute.kini = pathname;
  return renderToStaticMarkup(
    // NavOwner mewajibkan `children` di tipenya (bukan opsional), jadi
    // createElement TIDAK BISA menyimpulkan properti itu terpenuhi lewat
    // argumen posisi ketiga — TypeScript tetap menuntutnya di objek props.
    // Berkas ini berekstensi .ts (bukan .tsx) sehingga sintaks JSX
    // `<NavOwner>{null}</NavOwner>` tidak tersedia sebagai jalan keluar.
    // eslint-disable-next-line react/no-children-prop
    createElement(NavOwner, { nama: "Pemilik PADMA", children: null }),
  );
}

let dasar: Ringkasan;
let sesudah: Ringkasan;

beforeAll(async () => {
  await bersihkan();
  ref.sesi = await signInAs("owner@padma.test");

  // Diukur SEBELUM fixture masuk: seluruh assertion di bawah memakai SELISIH,
  // sehingga angkanya tidak bergantung pada isi seed maupun tanggal db reset.
  dasar = await ringkasanPekanIni(HARI_INI);

  await admin.from("services").insert([
    {
      id: LAYANAN_UJI,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Rekap",
      aktif: true,
    },
    {
      id: LAYANAN_TANPA_TARIF,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Layanan Tanpa Tarif",
      aktif: true,
    },
  ]);
  // Setiap layanan wajib punya minimal satu varian (V3) — inilah yang dulu
  // menempel di `services`, sejak Task 1 hidup terpisah di sini.
  await admin.from("service_variants").insert([
    { id: VARIAN_UJI, service_id: LAYANAN_UJI, label: "" },
    { id: VARIAN_TANPA_TARIF, service_id: LAYANAN_TANPA_TARIF, label: "" },
  ]);
  await admin.from("partners").insert([
    { id: MITRA_A, nama: "PAD-UJI Bidan Alfa", no_hp: "0811-0000-9001" },
    { id: MITRA_B, nama: "PAD-UJI Bidan Beta", no_hp: "0811-0000-9002" },
  ]);
  await admin.from("variant_rates").insert({
    id: TARIF_UJI,
    variant_id: VARIAN_UJI,
    harga_klien: HARGA,
    honor_mitra: HONOR,
    berlaku_sejak: BERLAKU_SEJAK,
  });
  await admin.from("clients").insert({
    id: KLIEN_UJI,
    padma_id: PADMA_ID_UJI,
    nama: "Uji Rekap Owner",
    email: "uji-rekap-owner@padma.test",
    phase_id: "prekonsepsi",
  });

  const dasarSesi = {
    client_id: KLIEN_UJI,
    service_id: LAYANAN_UJI,
    variant_id: VARIAN_UJI,
    // 'belum' = kelahiran tanpa keputusan uang; tidak menulis jejak audit.
    status_bayar: "belum" as const,
    catatan: "",
    rekomendasi: "",
  };
  await admin.from("sessions").insert([
    // Tiga sesi SELESAI di pekan berjalan: dua mitra A, satu mitra B.
    { ...dasarSesi, id: SESI.a1, partner_id: MITRA_A, tanggal: SENIN, status: "selesai" },
    { ...dasarSesi, id: SESI.a2, partner_id: MITRA_A, tanggal: SENIN, status: "selesai" },
    { ...dasarSesi, id: SESI.b1, partner_id: MITRA_B, tanggal: SENIN, status: "selesai" },
    // Pekan LALU — tidak boleh bocor ke kartu "pekan ini".
    {
      ...dasarSesi,
      id: SESI.pekanLalu,
      partner_id: MITRA_A,
      tanggal: SENIN_LALU,
      status: "selesai",
    },
    // Belum/tidak pernah dikerjakan — tidak menghasilkan honor.
    { ...dasarSesi, id: SESI.terjadwal, partner_id: MITRA_A, tanggal: SENIN, status: "terjadwal" },
    { ...dasarSesi, id: SESI.batal, partner_id: MITRA_A, tanggal: SENIN, status: "batal" },
    // Selesai, tetapi layanannya tidak punya satu baris tarif pun.
    {
      ...dasarSesi,
      id: SESI.takBertarif,
      service_id: LAYANAN_TANPA_TARIF,
      variant_id: VARIAN_TANPA_TARIF,
      partner_id: MITRA_B,
      tanggal: SENIN,
      status: "selesai",
    },
  ]);

  sesudah = await ringkasanPekanIni(HARI_INI);
});

afterAll(bersihkan);

describe("ringkasan pekan berjalan — dihitung dari data, lewat RLS sesi owner", () => {
  it("menghitung SENIN pekan berjalan menurut kalender Jakarta", () => {
    expect(sesudah.senin).toBe(SENIN);
    expect(sesudah.rentang).toBe(rentangPekan(SENIN));
  });

  it("hanya sesi SELESAI pekan ini yang dihitung (terjadwal & batal diabaikan)", () => {
    // Empat sesi selesai ditambahkan di pekan ini (tiga bertarif + satu tak
    // bertarif); terjadwal, batal, dan sesi pekan lalu TIDAK boleh ikut.
    expect(sesudah.jumlahSesi).toBe(dasar.jumlahSesi + 4);
  });

  it("honor & harga memakai tarif yang berlaku pada tanggal sesi", () => {
    expect(sesudah.totalHonor).toBe(dasar.totalHonor + 3 * HONOR);
    expect(sesudah.totalHarga).toBe(dasar.totalHarga + 3 * HARGA);
  });

  it("margin adalah angka PADMA per pekan: harga klien − honor mitra", () => {
    expect(sesudah.margin).toBe(sesudah.totalHarga - sesudah.totalHonor);
    expect(sesudah.margin).toBe(dasar.margin + 3 * (HARGA - HONOR));
  });

  it("sesi tak bertarif DILAPORKAN, bukan dihitung nol diam-diam", () => {
    expect(sesudah.jumlahTakBertarif).toBe(dasar.jumlahTakBertarif + 1);
  });

  it("menghitung jumlah mitra yang bekerja pekan ini", () => {
    expect(sesudah.jumlahMitra).toBe(dasar.jumlahMitra + 2);
  });

  it("sesi pekan LALU tidak bocor ke pekan berjalan", async () => {
    const rekap = await ambilRekap();
    const pekanLalu = rekap.find((p) => p.senin === SENIN_LALU);
    expect(pekanLalu, "pekan lalu hilang dari rekap").toBeDefined();
    // Satu sesi mitra A di pekan lalu — honornya berdiri di embernya sendiri.
    const barisA = pekanLalu!.perMitra.find((m) => m.partnerId === MITRA_A);
    expect(barisA?.totalHonor).toBe(HONOR);
    expect(barisA?.jumlahSesi).toBe(1);
  });

  it("pekan terbaru berada di atas", async () => {
    const rekap = await ambilRekap();
    const senin = rekap.map((p) => p.senin);
    expect([...senin].sort().reverse()).toEqual(senin);
  });

  it("dihitung lewat sesi pengguna: admin tidak melihat satu nominal pun", async () => {
    const sebelumnya = ref.sesi;
    ref.sesi = await signInAs("admin@padma.test");
    const milikAdmin = await ringkasanPekanIni(HARI_INI);
    ref.sesi = sebelumnya;

    // Bila lapisan data memakai service role, angka ini akan sama dengan angka
    // owner. RLS money firewall memulangkan 0 baris tarif untuk admin, jadi
    // seluruh nominalnya wajib nol.
    expect(milikAdmin.totalHonor).toBe(0);
    expect(milikAdmin.totalHarga).toBe(0);
    expect(milikAdmin.margin).toBe(0);
  });

  it("tidak ada service role di lapisan data owner", () => {
    const sumber = baca("src/lib/owner/data.ts");
    expect(sumber).toContain("createServerSupabase");
    expect(sumber).not.toContain("createAdminSupabase");
    expect(sumber).not.toContain("SERVICE_ROLE");
  });
});

describe("navigasi owner", () => {
  const sumberNav = baca("src/app/owner/_shell/nav-owner.tsx");

  it("client component (butuh usePathname lewat KerangkaPanel)", () => {
    expect(sumberNav.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("memuat empat tujuan berbahasa Indonesia", () => {
    const m = markupNav("/owner");
    for (const [href, label] of [
      ["/owner", "Beranda"],
      ["/owner/rekap", "Rekap"],
      ["/owner/tarif", "Tarif"],
      ["/owner/transport", "Transport"],
    ]) {
      expect(m).toContain(`href="${href}"`);
      expect(m).toContain(label);
    }
  });

  it("menyediakan sidebar DAN bar bawah, masing-masing berlabel", () => {
    const m = markupNav("/owner");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect([...m.matchAll(/aria-label="[^"]+"/g)].length).toBeGreaterThanOrEqual(2);
    expect(m).toContain("lg:hidden");
    expect(m).toContain("lg:translate-x-0");
    // Panel owner hanya punya tiga tujuan, jadi bar bawah memuat KETIGANYA —
    // tidak ada yang perlu diringkas.
    expect([...m.matchAll(/href="\/owner\/rekap"/g)]).toHaveLength(2);
  });

  it("JALAN PULANG: owner punya tautan klik ke /admin di sidebar dan bar bawah", () => {
    // Sebelum Task 3 rencana owner ada NOL tautan dari /owner ke /admin walau
    // owner adalah superset admin — satu-satunya jalan adalah mengetik URL.
    const m = markupNav("/owner");
    expect([...m.matchAll(/href="\/admin"/g)]).toHaveLength(2);
    expect(m).toContain("Buka Panel Admin");
  });

  it("jumlah tautan dikunci persis (tujuan baru tidak boleh lolos diam-diam)", () => {
    const m = markupNav("/owner");
    // Empat tujuan × dua nav + dua tautan jalan pulang.
    expect([...m.matchAll(/<a\b/g)]).toHaveLength(4 * 2 + 2);
  });

  it("hanya SATU tujuan yang aktif per nav di beranda", () => {
    const m = markupNav("/owner");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
  });

  it("sub-rute menyalakan tujuannya sendiri, bukan Beranda", () => {
    const m = markupNav("/owner/rekap");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(2);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/owner"') && !tag.includes("/owner/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("tautan /admin tidak pernah ditandai sebagai tujuan aktif", () => {
    for (const p of ["/owner", "/owner/rekap", "/owner/tarif", "/owner/transport"]) {
      for (const tag of markupNav(p).match(/<a[^>]*>/g) ?? []) {
        if (tag.includes('href="/admin"')) {
          expect(tag).not.toContain('aria-current="page"');
        }
      }
    }
  });
});

describe("layout owner", () => {
  const sumberLayout = baca("src/app/owner/layout.tsx");

  it("memanggil requireRole TEPAT SATU KALI dengan peran PERSIS owner", () => {
    // Dikunci juga oleh access-matrix-layouts.test.ts; ditegaskan di sini
    // karena Task 3 menyentuh persis berkas ini, dan "salin saja shell admin"
    // membawa serta `["admin","owner"]` — yang berarti seluruh nominal PADMA
    // terbuka untuk admin.
    expect([...sumberLayout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(sumberLayout).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    expect(sumberLayout).not.toContain('"admin"');
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
    const { default: OwnerLayout } = await import("@/app/owner/layout");
    rute.kini = "/owner";
    const m = renderToStaticMarkup(
      await OwnerLayout({ children: createElement("p", null, "ISI-UJI") }),
    );
    expect(m).toContain("ISI-UJI");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
    expect(m).toContain('href="/owner/rekap"');
    expect(m).toContain('href="/admin"');
  });

  it("menyebut identitas pemakai dari nilai kembalian penjaga peran", async () => {
    const { default: OwnerLayout } = await import("@/app/owner/layout");
    rute.kini = "/owner";
    const m = renderToStaticMarkup(await OwnerLayout({ children: null }));
    expect(m).toContain("Masuk sebagai");
    expect(m).toContain("Owner");
  });

  it("catatan money firewall DIBALIK: panel ini satu-satunya tempat nominal hidup", async () => {
    const { default: OwnerLayout } = await import("@/app/owner/layout");
    rute.kini = "/owner";
    const m = renderToStaticMarkup(await OwnerLayout({ children: null }));
    expect(m).toContain("satu-satunya");
    // Catatan admin ("tidak ada angka uang di panel ini") tidak boleh ikut
    // tersalin — di sini justru sebaliknya.
    expect(m).not.toContain("tidak ada angka uang di panel ini");
  });

  it("tidak ada service role di seluruh src/app/owner/**", () => {
    for (const berkas of berkasOwner()) {
      expect(baca(berkas), `${berkas} memakai service role`).not.toContain(
        "createAdminSupabase",
      );
      expect(baca(berkas), `${berkas} memakai service role`).not.toContain("SERVICE_ROLE");
    }
  });
});

describe("beranda owner", () => {
  const sumberBeranda = baca("src/app/owner/page.tsx");

  async function markupBeranda(): Promise<string> {
    const { default: OwnerPage } = await import("@/app/owner/page");
    rute.kini = "/owner";
    return renderToStaticMarkup(await OwnerPage());
  }

  /**
   * Nilai `StatTile` yang berdiri TEPAT sesudah `label`-nya di markup
   * (`<small>label</small><span>nilai</span>` — struktur `StatTile` yang
   * sama persis dipakai baik dibungkus `<a>` maupun `<div>`).
   *
   * Dipakai alih-alih dua `toContain` terpisah (satu untuk label, satu untuk
   * nilai): dua `toContain` lolos walau labelnya tertukar dengan nilai kartu
   * SEBELAHNYA — mis. kartu "Honor" menampilkan angka margin. Mengikat nilai
   * ke label yang tepat di depannya menutup celah itu.
   */
  function nilaiStatTile(m: string, label: string): string {
    const cocok = m.match(
      new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</small><span[^>]*>([^<]*)</span>`),
    );
    if (!cocok) throw new Error(`StatTile berlabel "${label}" tidak ditemukan di markup`);
    return cocok[1];
  }

  it("judulnya mengikuti template `%s · PADMA` (bukan judul penuh sendiri)", () => {
    expect(sumberBeranda).toMatch(/metadata\s*=\s*\{\s*title:\s*"Panel Owner"\s*\}/);
  });

  it('teks "Panel Owner" tetap ada (dikunci tests/e2e/access-matrix.e2e.ts)', async () => {
    expect(await markupBeranda()).toContain("Panel Owner");
  });

  it("menampilkan ketiga angka pekan berjalan apa adanya", async () => {
    const m = await markupBeranda();
    const kini = await ringkasanPekanIni(HARI_INI);
    // Nilainya, bukan cuma labelnya — dan diikat ke labelnya masing-masing,
    // bukan sekadar "muncul di suatu tempat di halaman": dua kartu bertukar
    // angka (mis. "Honor" menampilkan margin) akan lolos `toContain` biasa
    // karena kedua nilai tetap sama-sama hadir di markup, hanya di kartu yang
    // salah. Halaman ini menurunkan angkanya dari elemen TERAKHIR
    // deretPekanTerakhir, sementara ringkasanPekanIni menghitungnya lewat
    // jalur lain — kalau keduanya berbeda, salah satu sedang berbohong, dan
    // yang dipertaruhkan adalah honor yang dibayarkan.
    expect(nilaiStatTile(m, "Sesi selesai pekan ini")).toBe(String(kini.jumlahSesi));
    expect(nilaiStatTile(m, "Honor dibayar Sabtu ini")).toBe(formatRupiah(kini.totalHonor));
    expect(nilaiStatTile(m, "Margin PADMA pekan ini")).toBe(formatRupiah(kini.margin));
    // Label rentang pekan berjalan wajib tampil juga — bukan cuma angkanya.
    // Tanpa ini, "pekan yang mana" hanya bisa ditebak dari tanggal hari ini.
    expect(m).toContain(kini.rentang);
  });

  it("nominal HIDUP di sini — panel ini memang satu-satunya tempatnya", async () => {
    expect(await markupBeranda()).toMatch(/Rp\s?\d/);
  });

  it("grafik tren memuat delapan pekan dan ketiga serinya", async () => {
    const m = await markupBeranda();
    expect([...m.matchAll(/data-seri="/g)]).toHaveLength(3);
    expect([...m.matchAll(/data-label-seri="/g)]).toHaveLength(3);
    // Legenda WAJIB untuk dua seri atau lebih.
    expect(m).toMatch(/<ul[^>]*aria-label="Legenda/);
    // "Delapan pekan" tidak terbukti hanya dari tiga `data-seri` di atas —
    // itu tetap 3 walau `deretPekanTerakhir` dipanggil dengan panjang lain.
    // Tiap seri menggambar satu `<circle>` per titik, jadi 8 pekan × 3 seri
    // wajib menghasilkan tepat 24 titik.
    expect([...m.matchAll(/<circle\b/g)]).toHaveLength(8 * 3);
  });

  it("grafik punya padanan tabel", async () => {
    expect(await markupBeranda()).toContain("Lihat sebagai tabel");
  });

  it("menampilkan mitra teraktif pekan ini", async () => {
    expect(await markupBeranda()).toContain("Mitra teraktif pekan ini");
  });

  it("memperingatkan sesi tak bertarif, tidak menelannya diam-diam", async () => {
    // Sesi yang lebih tua dari tarif paling awal layanannya adalah uang yang
    // hilang tanpa jejak; ia wajib tampil sebagai peringatan yang menautkan
    // langsung ke perbaikannya. Diperiksa pada MARKUP yang benar-benar
    // dirender — bukan cuma sumbernya — supaya kondisi mati (mis. `false &&`)
    // tidak lolos hanya karena teksnya masih tertulis di berkas.
    const kini = await ringkasanPekanIni(HARI_INI);
    // Fixture menaruh tepat satu sesi tanpa tarif di pekan berjalan.
    expect(kini.jumlahTakBertarif).toBeGreaterThan(0);
    const m = await markupBeranda();
    expect(m).toContain("belum bertarif");
    expect(m).toContain('href="/owner/tarif"');
    // Sumbernya tetap ditegaskan juga: bila peringatannya lenyap dari markup
    // DAN dari sumber sekaligus, dua asersi ini menjawab pertanyaan yang
    // berbeda — satu soal kondisinya benar-benar terpicu, satu soal tautan
    // perbaikannya belum diam-diam dihapus.
    expect(sumberBeranda).toContain("belum bertarif");
    expect(sumberBeranda).toContain('href="/owner/tarif"');
  });

  it("penjaga peran tepat satu kali dengan peran PERSIS owner", () => {
    expect([...sumberBeranda.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(sumberBeranda).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
  });

  it("hari ini menurut kalender Jakarta, bukan jam server", () => {
    expect(sumberBeranda).toContain("hariIniJakarta");
    expect(sumberBeranda).not.toContain("new Date()");
  });
});
