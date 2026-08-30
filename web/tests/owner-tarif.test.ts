/**
 * Modul RATE CARD panel owner — `/owner/tarif`.
 *
 * Rate card adalah satu-satunya layar di PADMA tempat harga klien dan honor
 * mitra boleh ditulis, dan bentuknya INSERT-ONLY: menetapkan tarif baru
 * melahirkan BARIS BARU bertanggal berlaku, tidak pernah menimpa baris lama.
 * Lima kelas regresi yang dijaga berkas ini — semuanya berakhir dengan uang
 * yang salah dibayarkan, tanpa satu pun error di layar:
 *
 *  1. UPDATE ALIH-ALIH INSERT. Menimpa `service_rates` yang lama adalah cara
 *     paling wajar menulis "ubah tarif" — dan efeknya RETROAKTIF: rekap pekan
 *     yang honornya SUDAH dibayar ikut bergeser, karena rekap membaca tarif
 *     yang berlaku pada tanggal sesi. Spec bagian 5 menuntut sebaliknya:
 *     "Edit rate card = insert baris baru, tidak update baris lama."
 *
 *  2. TANGGAL BERLAKU MUNDUR. Insert-only saja TIDAK cukup: menyisipkan baris
 *     baru ber-`berlaku_sejak` 2020 memberi efek yang PERSIS sama dengan
 *     menimpa baris lama. Karena itu tanggal mundur ditolak, dan ditolak dengan
 *     KALIMAT — bukan kode Postgres di layar pemilik klinik.
 *
 *  3. PENJAGA PERAN HILANG DARI DALAM ACTION. Server action adalah endpoint
 *     POST tersendiri; `src/app/owner/layout.tsx` TIDAK pernah dilewati saat
 *     action dipanggil langsung — dibuktikan dengan mem-POST action panel admin
 *     dari rute lain sebagai admin, dan mutasinya berhasil. Penjaga di dalam
 *     action ini wajib `["owner"]`, BUKAN `["admin","owner"]`: satu kata
 *     kelebihan membuka penetapan harga PADMA untuk admin klinik.
 *
 *  4. TOMBOL HAPUS. Hak DELETE atas `service_rates` sudah dicabut dari peran
 *     aplikasi — owner pun dijawab 42501. Itu keadaan yang BENAR: tarif lama
 *     adalah bukti berapa honor yang seharusnya dibayarkan pekan lalu.
 *
 *  5. VIEW BERKOLOM UANG. View dimiliki `postgres` dan berjalan dengan hak
 *     PEMILIK, jadi ia MELEWATI RLS — terbukti: admin membaca 10 baris rate
 *     card lengkap lewat view biasa sementara SELECT langsung memulangkan 0.
 *     Seluruh agregasi modul ini karena itu dihitung di TypeScript.
 *
 * Data uji berprefiks `PAD-UJI` dan dibersihkan `afterAll`, termasuk baris
 * `jejak_status_bayar` (tabel SENGAJA tanpa foreign key, jadi tidak ikut
 * tersapu saat sesinya dihapus).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { awalPekan, geserHari } from "@/lib/owner/pekan";
import { hariIniJakarta } from "@/lib/passport/waktu";
import { signInAs } from "./helpers/as-user";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const admin = createAdminSupabase();

// Lapisan data & action memakai sesi pengguna (`createServerSupabase`). Di
// vitest tidak ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan: RLS dan
// requireRole tetap berjalan apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

const jejak = vi.hoisted(() => ({ revalidate: [] as string[] }));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    jejak.revalidate.push(p);
  },
}));

// `redirect` sengaja MELEMPAR: bila penjaga peran memanggilnya, test harus
// gagal keras, bukan diam-diam melanjutkan mutasi uang.
vi.mock("next/navigation", () => ({
  redirect: (ke: string) => {
    throw new Error(`REDIRECT ${ke}`);
  },
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  usePathname: () => "/owner/tarif",
}));

// --- Fixture -----------------------------------------------------------------

const LAYANAN_BARU = "11111111-1111-1111-1111-1111111111e1"; // belum bertarif
const LAYANAN_MUNDUR = "11111111-1111-1111-1111-1111111111e2"; // sudah bertarif
const LAYANAN_REKAP = "11111111-1111-1111-1111-1111111111e3"; // punya sesi pekan lalu
const LAYANAN_HANTU = "11111111-1111-1111-1111-1111111111ef"; // tidak pernah ada

const TARIF_MUNDUR = "99999999-9999-9999-9999-9999999999e2";
const TARIF_REKAP = "99999999-9999-9999-9999-9999999999e3";

const MITRA = "33333333-3333-3333-3333-3333333333e1";
const KLIEN = "44444444-4444-4444-4444-4444444444e1";
const PADMA_ID = "PAD-UJI-00E1";
const SESI = {
  lalu1: "66666666-6666-6666-6666-6666666661e1",
  lalu2: "66666666-6666-6666-6666-6666666662e1",
};

// Tarif fixture untuk pekan LALU: 400.000 / 150.000 -> margin 250.000 per sesi.
const HARGA_LAMA = 400_000;
const HONOR_LAMA = 150_000;
// Tarif BARU yang ditetapkan hari ini — sengaja jauh lebih tinggi supaya
// pergeseran rekap pekan lama, bila terjadi, mustahil luput dari assertion.
const HARGA_BARU = 900_000;
const HONOR_BARU = 400_000;

const HARI_INI = hariIniJakarta();
const SENIN = awalPekan(HARI_INI);
const SENIN_LALU = geserHari(SENIN, -7);

// `berlaku_sejak` jauh sebelum seluruh tanggal sesi fixture, sehingga tarif
// yang terpilih untuk pekan lalu selalu tarif ini — tidak bergantung pada
// tanggal `supabase db reset` (tarif seed lahir dengan berlaku_sejak hari itu).
const BERLAKU_LAMA = "2020-01-06"; // Senin
const MUNDUR_SEHARI = geserHari(BERLAKU_LAMA, -1);

async function bersihkan() {
  for (const id of Object.values(SESI)) {
    await admin.from("sessions").delete().eq("id", id);
    // Tabel jejak SENGAJA tanpa foreign key — penghapusan sesi di atas tidak
    // menyapunya, dan tanpa baris ini `npm test` menumpuk yatim tiap run.
    await admin.from("jejak_status_bayar").delete().eq("sesi_id", id);
  }
  await admin.from("clients").delete().eq("id", KLIEN);
  for (const svc of [LAYANAN_BARU, LAYANAN_MUNDUR, LAYANAN_REKAP]) {
    await admin.from("service_rates").delete().eq("service_id", svc);
  }
  await admin.from("partners").delete().eq("id", MITRA);
  for (const svc of [LAYANAN_BARU, LAYANAN_MUNDUR, LAYANAN_REKAP]) {
    await admin.from("services").delete().eq("id", svc);
  }
}

const { tetapkanTarif } = await import("@/app/owner/tarif/aksi");
const { ambilRateCard, ambilRekap } = await import("@/lib/owner/data");
const { default: TarifPage } = await import("@/app/owner/tarif/page");

const sumberAksi = baca("src/app/owner/tarif/aksi.ts");
const sumberHalaman = baca("src/app/owner/tarif/page.tsx");
const sumberForm = baca("src/app/owner/tarif/form-tarif.tsx");
const sumberStatus = baca("src/app/owner/tarif/status.ts");
const sumberData = baca("src/lib/owner/data.ts");
const SEMUA_SUMBER = [sumberAksi, sumberHalaman, sumberForm, sumberStatus, sumberData];

let sesiOwner: SupabaseClient;
let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isi)) fd.set(k, v);
  return fd;
}

type BarisTarif = {
  id: string;
  service_id: string;
  harga_klien: number;
  honor_mitra: number;
  berlaku_sejak: string;
};

/** Seluruh baris tarif satu layanan, dibaca lewat SERVICE ROLE (bukan RLS). */
async function tarifLayanan(serviceId: string): Promise<BarisTarif[]> {
  const { data } = await admin
    .from("service_rates")
    .select("id, service_id, harga_klien, honor_mitra, berlaku_sejak")
    .eq("service_id", serviceId)
    .order("berlaku_sejak")
    .returns<BarisTarif[]>();
  return data ?? [];
}

beforeAll(async () => {
  await bersihkan();
  sesiOwner = await signInAs("owner@padma.test");
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiOwner;

  await admin.from("services").insert([
    {
      id: LAYANAN_BARU,
      phase_id: "prekonsepsi",
      nama: "PAD-UJI Tarif Layanan Baru",
      aktif: true,
    },
    {
      id: LAYANAN_MUNDUR,
      phase_id: "kehamilan",
      nama: "PAD-UJI Tarif Layanan Mundur",
      aktif: true,
    },
    {
      id: LAYANAN_REKAP,
      phase_id: "nifas",
      nama: "PAD-UJI Tarif Layanan Rekap",
      aktif: true,
    },
  ]);
  await admin.from("partners").insert({
    id: MITRA,
    nama: "PAD-UJI Bidan Tarif",
    no_hp: "0811-0000-9101",
  });
  await admin.from("service_rates").insert([
    {
      id: TARIF_MUNDUR,
      service_id: LAYANAN_MUNDUR,
      harga_klien: HARGA_LAMA,
      honor_mitra: HONOR_LAMA,
      berlaku_sejak: BERLAKU_LAMA,
    },
    {
      id: TARIF_REKAP,
      service_id: LAYANAN_REKAP,
      harga_klien: HARGA_LAMA,
      honor_mitra: HONOR_LAMA,
      berlaku_sejak: BERLAKU_LAMA,
    },
  ]);
  await admin.from("clients").insert({
    id: KLIEN,
    padma_id: PADMA_ID,
    nama: "Uji Rate Card",
    email: "uji-rate-card@padma.test",
    phase_id: "nifas",
  });
  await admin.from("sessions").insert([
    {
      id: SESI.lalu1,
      client_id: KLIEN,
      service_id: LAYANAN_REKAP,
      partner_id: MITRA,
      tanggal: SENIN_LALU,
      status: "selesai",
      status_bayar: "belum",
      catatan: "",
      rekomendasi: "",
    },
    {
      id: SESI.lalu2,
      client_id: KLIEN,
      service_id: LAYANAN_REKAP,
      partner_id: MITRA,
      tanggal: SENIN_LALU,
      status: "selesai",
      status_bayar: "belum",
      catatan: "",
      rekomendasi: "",
    },
  ]);
});

afterAll(bersihkan);

beforeEach(() => {
  ref.sesi = sesiOwner;
  jejak.revalidate.length = 0;
});

// ---------------------------------------------------------------------------
// INSERT-only: tarif lama tidak pernah berubah
// ---------------------------------------------------------------------------

describe("tetapkanTarif — menetapkan tarif menyisipkan BARIS BARU", () => {
  it("layanan yang belum bertarif memperoleh baris pertamanya", async () => {
    expect(await tarifLayanan(LAYANAN_BARU)).toHaveLength(0);

    const hasil = await tetapkanTarif(
      formulir({
        layanan: LAYANAN_BARU,
        harga: String(HARGA_LAMA),
        honor: String(HONOR_LAMA),
        mulai: HARI_INI,
      }),
    );
    expect(hasil.ok).toBe(true);

    const baris = await tarifLayanan(LAYANAN_BARU);
    expect(baris).toHaveLength(1);
    expect(baris[0]).toMatchObject({
      harga_klien: HARGA_LAMA,
      honor_mitra: HONOR_LAMA,
      berlaku_sejak: HARI_INI,
    });
  });

  it("tarif LAMA tetap utuh — baris baru berdampingan, bukan menimpa", async () => {
    // Inilah janji spec bagian 5: "Edit rate card = insert baris baru, tidak
    // update baris lama." Baris lama adalah bukti berapa honor yang seharusnya
    // dibayarkan pekan lalu; menimpanya menghapus bukti itu selamanya.
    const sebelum = await tarifLayanan(LAYANAN_MUNDUR);
    expect(sebelum).toHaveLength(1);

    const hasil = await tetapkanTarif(
      formulir({
        layanan: LAYANAN_MUNDUR,
        harga: String(HARGA_BARU),
        honor: String(HONOR_BARU),
        mulai: HARI_INI,
      }),
    );
    expect(hasil.ok).toBe(true);

    const sesudah = await tarifLayanan(LAYANAN_MUNDUR);
    expect(sesudah).toHaveLength(2);

    const lama = sesudah.find((b) => b.id === TARIF_MUNDUR);
    expect(lama, "baris tarif lama LENYAP — modul ini menimpa, bukan menyisipkan").toBeDefined();
    expect(lama).toMatchObject({
      harga_klien: HARGA_LAMA,
      honor_mitra: HONOR_LAMA,
      berlaku_sejak: BERLAKU_LAMA,
    });
  });

  it("menyegarkan rekap & beranda owner, bukan hanya halaman tarifnya", async () => {
    // Tarif baru yang tidak merambat ke rekap adalah tarif yang belum berlaku
    // bagi satu-satunya layar yang membayarkan honor.
    await tetapkanTarif(
      formulir({
        layanan: LAYANAN_BARU,
        harga: String(HARGA_BARU),
        honor: String(HONOR_BARU),
        mulai: geserHari(HARI_INI, 30),
      }),
    );
    for (const p of ["/owner/tarif", "/owner/rekap", "/owner"]) {
      expect(jejak.revalidate, `lupa merevalidasi ${p}`).toContain(p);
    }
  });

  it("tanggal berlaku kosong berarti HARI INI menurut kalender Jakarta", async () => {
    const hasil = await tetapkanTarif(
      formulir({
        layanan: LAYANAN_REKAP,
        harga: String(HARGA_BARU),
        honor: String(HONOR_BARU),
        mulai: "",
      }),
    );
    expect(hasil.ok).toBe(true);
    const baris = await tarifLayanan(LAYANAN_REKAP);
    expect(baris.map((b) => b.berlaku_sejak)).toContain(HARI_INI);
  });
});

// ---------------------------------------------------------------------------
// PAGAR UTAMA: rekap pekan lama tidak bergeser saat tarif naik
// ---------------------------------------------------------------------------

describe("menaikkan tarif TIDAK menggeser rekap pekan yang sudah lewat", () => {
  it("total honor, harga, dan margin pekan lalu persis sama sesudah tarif naik", async () => {
    // Dua sesi selesai milik satu mitra di pekan LALU, dihargai tarif 2020.
    const sebelum = (await ambilRekap()).find((p) => p.senin === SENIN_LALU);
    expect(sebelum, "pekan lalu tidak muncul di rekap — fixture gagal").toBeDefined();
    const barisSebelum = sebelum!.perMitra.find((m) => m.partnerId === MITRA);
    expect(barisSebelum?.jumlahSesi).toBe(2);
    expect(barisSebelum?.totalHonor).toBe(2 * HONOR_LAMA);

    const honorSebelum = sebelum!.totalHonor;
    const hargaSebelum = sebelum!.totalHarga;
    const marginSebelum = sebelum!.margin;

    // Tarif naik lebih dari dua kali lipat, berlaku HARI INI.
    const hasil = await tetapkanTarif(
      formulir({
        layanan: LAYANAN_REKAP,
        harga: String(HARGA_BARU * 2),
        honor: String(HONOR_BARU * 2),
        mulai: geserHari(HARI_INI, 1),
      }),
    );
    expect(hasil.ok).toBe(true);

    const sesudah = (await ambilRekap()).find((p) => p.senin === SENIN_LALU)!;
    expect(sesudah.totalHonor, "honor pekan lalu bergeser").toBe(honorSebelum);
    expect(sesudah.totalHarga, "harga pekan lalu bergeser").toBe(hargaSebelum);
    expect(sesudah.margin, "margin pekan lalu bergeser").toBe(marginSebelum);
    expect(
      sesudah.perMitra.find((m) => m.partnerId === MITRA)?.totalHonor,
    ).toBe(2 * HONOR_LAMA);
  });
});

// ---------------------------------------------------------------------------
// Penolakan — dengan KALIMAT, bukan kode Postgres
// ---------------------------------------------------------------------------

describe("tetapkanTarif — penolakan yang bisa dibaca pemilik klinik", () => {
  /** Tidak satu pun pesan boleh berupa/berisi kode SQLSTATE mentah. */
  function pesanManusiawi(pesan: string) {
    expect(pesan).not.toMatch(/\b(23505|23514|42501|23503|22P02)\b/);
    expect(pesan.length).toBeGreaterThan(10);
  }

  it("tanggal berlaku MUNDUR ditolak tanpa menyentuh basis data", async () => {
    // Insert-only saja tidak cukup: baris baru bertanggal mundur berefek PERSIS
    // sama dengan menimpa baris lama — rekap pekan yang sudah dibayar bergeser.
    const sebelum = await tarifLayanan(LAYANAN_MUNDUR);

    const hasil = await tetapkanTarif(
      formulir({
        layanan: LAYANAN_MUNDUR,
        harga: String(HARGA_BARU),
        honor: String(HONOR_BARU),
        mulai: MUNDUR_SEHARI,
      }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/setelah tarif terakhir/i);
    pesanManusiawi(hasil.pesan);

    expect(await tarifLayanan(LAYANAN_MUNDUR)).toEqual(sebelum);
  });

  it("tarif KEMBAR pada tanggal yang sama ditolak", async () => {
    // Tanpa penolakan ini, pemilihan "berlaku_sejak terbesar" menjadi
    // non-deterministik: tidak ada created_at pemecah seri.
    const sebelum = await tarifLayanan(LAYANAN_MUNDUR);
    const tanggalTerpakai = sebelum.at(-1)!.berlaku_sejak;

    const hasil = await tetapkanTarif(
      formulir({
        layanan: LAYANAN_MUNDUR,
        harga: String(HARGA_BARU + 1),
        honor: String(HONOR_BARU),
        mulai: tanggalTerpakai,
      }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/sudah ada tarif/i);
    pesanManusiawi(hasil.pesan);

    expect(await tarifLayanan(LAYANAN_MUNDUR)).toEqual(sebelum);
  });

  it("honor mitra melebihi harga klien ditolak (margin negatif)", async () => {
    const hasil = await tetapkanTarif(
      formulir({
        layanan: LAYANAN_BARU,
        harga: "100000",
        honor: "150000",
        mulai: geserHari(HARI_INI, 60),
      }),
    );
    expect(hasil.ok).toBe(false);
    if (hasil.ok) return;
    expect(hasil.pesan).toMatch(/honor/i);
    pesanManusiawi(hasil.pesan);
  });

  it("nominal kosong, negatif, pecahan, dan bukan angka semuanya ditolak", async () => {
    // `Number("")` adalah 0 dan lolos `>= 0` — nol rupiah yang tidak pernah
    // diketik siapa pun, tetapi ikut menghitung honor setiap pekan sesudahnya.
    const sebelum = await tarifLayanan(LAYANAN_BARU);
    for (const nilai of ["", " ", "-1", "12.5", "abc", "1e6", "400_000"]) {
      const hasil = await tetapkanTarif(
        formulir({
          layanan: LAYANAN_BARU,
          harga: nilai,
          honor: "1000",
          mulai: geserHari(HARI_INI, 90),
        }),
      );
      expect(hasil.ok, `harga="${nilai}" seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      pesanManusiawi(hasil.pesan);
    }
    expect(await tarifLayanan(LAYANAN_BARU)).toEqual(sebelum);
  });

  it("honor pun diperiksa sebagai TEKS, bukan hanya harga", async () => {
    for (const nilai of ["", "-1", "12.5", "abc"]) {
      const hasil = await tetapkanTarif(
        formulir({
          layanan: LAYANAN_BARU,
          harga: "500000",
          honor: nilai,
          mulai: geserHari(HARI_INI, 91),
        }),
      );
      expect(hasil.ok, `honor="${nilai}" seharusnya ditolak`).toBe(false);
    }
  });

  it("tanggal tidak sah — termasuk tanggal yang tidak ada di kalender", async () => {
    for (const tgl of ["30-08-2026", "2026-8-1", "besok", "2026-02-31", "2026-13-01"]) {
      const hasil = await tetapkanTarif(
        formulir({
          layanan: LAYANAN_BARU,
          harga: "500000",
          honor: "100000",
          mulai: tgl,
        }),
      );
      expect(hasil.ok, `mulai="${tgl}" seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      expect(hasil.pesan).toMatch(/tanggal/i);
    }
  });

  it("layanan kosong & layanan yang tidak ada ditolak dengan kalimat", async () => {
    for (const id of ["", LAYANAN_HANTU, "bukan-uuid"]) {
      const hasil = await tetapkanTarif(
        formulir({ layanan: id, harga: "500000", honor: "100000", mulai: HARI_INI }),
      );
      expect(hasil.ok, `layanan="${id}" seharusnya ditolak`).toBe(false);
      if (hasil.ok) continue;
      expect(hasil.pesan).toMatch(/layanan/i);
      pesanManusiawi(hasil.pesan);
    }
  });
});

// ---------------------------------------------------------------------------
// PENJAGA PERAN: layout TIDAK menjaga server action
// ---------------------------------------------------------------------------

describe("penjaga peran di DALAM action — layout tidak menjaga server action", () => {
  it("ADMIN yang login DITOLAK, dan tidak satu baris pun tersisip", async () => {
    // Dibuktikan sebelumnya bahwa action panel admin bisa di-POST dari rute
    // lain dan mutasinya jadi; `/owner/layout.tsx` karena itu tidak melindungi
    // apa pun di sini. Penjaga peran wajib hidup di dalam action ini sendiri.
    const sebelum = await tarifLayanan(LAYANAN_BARU);

    ref.sesi = sesiAdmin;
    await expect(
      tetapkanTarif(
        formulir({
          layanan: LAYANAN_BARU,
          harga: "1",
          honor: "0",
          mulai: geserHari(HARI_INI, 120),
        }),
      ),
    ).rejects.toThrow(/REDIRECT/);

    expect(await tarifLayanan(LAYANAN_BARU)).toEqual(sebelum);
  });

  it("KLIEN yang login DITOLAK", async () => {
    ref.sesi = sesiKlien;
    await expect(
      tetapkanTarif(
        formulir({
          layanan: LAYANAN_BARU,
          harga: "1",
          honor: "0",
          mulai: geserHari(HARI_INI, 121),
        }),
      ),
    ).rejects.toThrow(/REDIRECT/);
  });

  it("admin TETAP dijawab 0 baris oleh RLS bahkan lewat REST langsung", async () => {
    // Penjaga di action adalah lapisan kedua. Lapisan pertamanya adalah RLS,
    // dan lapisan pertama itu harus tetap berdiri sendiri.
    const { data, error } = await sesiAdmin.from("service_rates").select("id, harga_klien");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("admin yang menyisipkan tarif langsung lewat REST ditolak RLS", async () => {
    const { error } = await sesiAdmin.from("service_rates").insert({
      service_id: LAYANAN_BARU,
      harga_klien: 1,
      honor_mitra: 0,
      berlaku_sejak: geserHari(HARI_INI, 122),
    });
    expect(error?.code).toBe("42501");
  });
});

// ---------------------------------------------------------------------------
// Lapisan data rate card
// ---------------------------------------------------------------------------

describe("ambilRateCard — tarif berlaku + riwayat, dihitung di TypeScript", () => {
  it("memuat SELURUH layanan, termasuk yang belum punya tarif", async () => {
    const kartu = await ambilRateCard(HARI_INI);
    const id = kartu.map((b) => b.serviceId);
    for (const svc of [LAYANAN_BARU, LAYANAN_MUNDUR, LAYANAN_REKAP]) {
      expect(id, "layanan hilang dari rate card").toContain(svc);
    }
  });

  it("tarif BERLAKU adalah berlaku_sejak terbesar yang masih ≤ hari ini", async () => {
    const baris = (await ambilRateCard(HARI_INI)).find((b) => b.serviceId === LAYANAN_MUNDUR)!;
    expect(baris.berlaku).not.toBeNull();
    expect(baris.berlaku!.berlakuSejak).toBe(HARI_INI);
    expect(baris.berlaku!.hargaKlien).toBe(HARGA_BARU);
    expect(baris.berlaku!.honorMitra).toBe(HONOR_BARU);
    expect(baris.berlaku!.margin).toBe(HARGA_BARU - HONOR_BARU);
  });

  it("dibaca pada tanggal LAMA, tarif yang berlaku pun tarif lama", async () => {
    // Bukti bahwa riwayat benar-benar hidup: fungsi yang sama, tanggal berbeda.
    const baris = (await ambilRateCard(BERLAKU_LAMA)).find(
      (b) => b.serviceId === LAYANAN_MUNDUR,
    )!;
    expect(baris.berlaku!.berlakuSejak).toBe(BERLAKU_LAMA);
    expect(baris.berlaku!.hargaKlien).toBe(HARGA_LAMA);
  });

  it("riwayat memuat seluruh baris, terbaru di atas", async () => {
    const baris = (await ambilRateCard(HARI_INI)).find((b) => b.serviceId === LAYANAN_MUNDUR)!;
    expect(baris.riwayat.length).toBe(2);
    const tanggal = baris.riwayat.map((r) => r.berlakuSejak);
    expect([...tanggal].sort().reverse()).toEqual(tanggal);
  });

  it("tarif yang berlaku di MASA DEPAN ditandai, bukan disamarkan sebagai berlaku", async () => {
    // LAYANAN_BARU menerima satu tarif bertanggal +30 hari di test sebelumnya.
    const baris = (await ambilRateCard(HARI_INI)).find((b) => b.serviceId === LAYANAN_BARU)!;
    const depan = baris.riwayat.filter((r) => r.belumBerlaku);
    expect(depan.length).toBeGreaterThan(0);
    for (const r of depan) {
      expect(r.berlakuSejak > HARI_INI).toBe(true);
      expect(r.berlakuSekarang).toBe(false);
    }
    expect(baris.berlaku!.berlakuSejak <= HARI_INI).toBe(true);
  });

  it("layanan tanpa satu pun tarif dijawab null, bukan nol diam-diam", async () => {
    const kartu = await ambilRateCard("2019-01-01");
    const baris = kartu.find((b) => b.serviceId === LAYANAN_BARU)!;
    expect(baris.berlaku).toBeNull();
  });

  it("dibaca lewat sesi pengguna: admin tidak memperoleh satu nominal pun", async () => {
    ref.sesi = sesiAdmin;
    const kartu = await ambilRateCard(HARI_INI);
    // Layanannya tetap terbaca (tabel `services` memang publik bagi staf);
    // yang WAJIB kosong adalah nominalnya — itu RLS yang menjawab.
    expect(kartu.length).toBeGreaterThan(0);
    for (const b of kartu) {
      expect(b.berlaku, `${b.namaLayanan} membocorkan tarif ke admin`).toBeNull();
      expect(b.riwayat).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Halaman /owner/tarif
// ---------------------------------------------------------------------------

describe("halaman rate card (/owner/tarif)", () => {
  let markup = "";

  beforeAll(async () => {
    ref.sesi = sesiOwner;
    markup = renderToStaticMarkup(await TarifPage());
  });

  it("menampilkan nama layanan beserta nominal yang berlaku", async () => {
    expect(markup).toContain("PAD-UJI Tarif Layanan Mundur");
    expect(markup).toContain(`Rp ${HARGA_BARU.toLocaleString("id-ID")}`);
    expect(markup).toContain(`Rp ${HONOR_BARU.toLocaleString("id-ID")}`);
  });

  it("menampilkan margin per layanan (harga klien − honor mitra)", async () => {
    expect(markup).toContain(`Rp ${(HARGA_BARU - HONOR_BARU).toLocaleString("id-ID")}`);
  });

  it("menampilkan tanggal berlaku tarif, bukan hanya angkanya", () => {
    // Tanpa tanggal berlaku, rate card menjadi angka tanpa riwayat — dan
    // seluruh janji "rekap lama tidak berubah" kehilangan penjelasannya.
    expect(markup).toMatch(/berlaku/i);
  });

  it("riwayat tarif lama TERBUKA tanpa JavaScript (details/summary)", async () => {
    // Riwayat yang bersembunyi di balik state React tidak pernah sampai ke
    // markup, dan karenanya tidak pernah bisa dibuktikan ada.
    expect(markup).toContain("<details");
    expect(markup).toMatch(/Riwayat/i);
    // Tarif 2020 milik LAYANAN_MUNDUR wajib ikut tercetak.
    expect(markup).toContain(`Rp ${HARGA_LAMA.toLocaleString("id-ID")}`);
  });

  it("memperingatkan bahwa tarif baru TIDAK mengubah rekap pekan lalu", () => {
    const teks = markup + sumberForm;
    expect(teks).toMatch(/pekan/i);
    expect(teks).toMatch(/tidak (akan )?meng(ubah|geser)/i);
  });

  it("menyediakan form penetapan tarif dengan medan tanggal berlaku", () => {
    expect(sumberForm).toContain('name="layanan"');
    expect(sumberForm).toContain('name="harga"');
    expect(sumberForm).toContain('name="honor"');
    expect(sumberForm).toContain('name="mulai"');
  });

  it("TIDAK ada tombol/label Hapus — DELETE memang sudah dicabut", () => {
    for (const sumber of [sumberHalaman, sumberForm]) {
      expect(sumber).not.toMatch(/>\s*Hapus/);
    }
    expect(markup).not.toMatch(/>\s*Hapus/);
  });

  it("owner pun ditolak 42501 saat menghapus tarif — itu keadaan yang BENAR", async () => {
    const { error } = await sesiOwner
      .from("service_rates")
      .delete()
      .eq("id", TARIF_MUNDUR);
    expect(error?.code).toBe("42501");
    expect(await tarifLayanan(LAYANAN_MUNDUR)).not.toHaveLength(0);
  });

  it("judul mengandalkan template `%s · PADMA`", () => {
    expect(sumberHalaman).toMatch(/metadata\s*=\s*\{\s*title:\s*"[^"]+"\s*\}/);
    expect(sumberHalaman).not.toMatch(/title:\s*"[^"]*PADMA/);
  });

  it("halaman menjaga perannya sendiri dengan requireRole(['owner'])", () => {
    expect(sumberHalaman).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    expect(sumberHalaman).not.toContain('"admin"');
  });
});

// ---------------------------------------------------------------------------
// Bentuk berkas server action
// ---------------------------------------------------------------------------

describe("berkas server action rate card", () => {
  it('diawali "use server"', () => {
    expect(sumberAksi.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("hanya mengekspor fungsi async (syarat Next)", () => {
    const ekspor = [...sumberAksi.matchAll(/^export\s+(?!type\b)(\w+)/gm)].map((m) => m[1]);
    expect(ekspor.length).toBeGreaterThan(0);
    expect([...new Set(ekspor)]).toEqual(["async"]);
  });

  it("SETIAP action memanggil requireRole(['owner']) — BUKAN admin+owner", () => {
    const jumlahAction = [
      ...sumberAksi.matchAll(/^export\s+async\s+function\s+\w+/gm),
    ].length;
    const jumlahGuard = [
      ...sumberAksi.matchAll(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/g),
    ].length;
    expect(jumlahAction).toBeGreaterThan(0);
    expect(jumlahGuard).toBe(jumlahAction);
    // Satu kata kelebihan di sini membuka penetapan harga PADMA untuk admin.
    expect(sumberAksi).not.toContain('"admin"');
  });

  it("penjaga peran adalah baris PERTAMA setiap action", () => {
    // Validasi yang berjalan lebih dulu berarti pemanggil tak berwenang tetap
    // memperoleh jawaban yang membocorkan bentuk data.
    const badan = [
      ...sumberAksi.matchAll(/export\s+async\s+function\s+\w+\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g),
    ];
    expect(badan.length).toBeGreaterThan(0);
    for (const m of badan) {
      const pernyataanPertama = m[1]
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && !b.startsWith("//") && !b.startsWith("*") && !b.startsWith("/*"))[0];
      expect(pernyataanPertama).toMatch(/^await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
    }
  });

  it("memeriksa panjang hasil .select('id') — 200 + [] bukan keberhasilan", () => {
    // UPDATE/INSERT yang tertahan RLS dijawab PostgREST 200 + [], bukan error.
    // Melaporkan "berhasil" tanpa memeriksa panjangnya adalah kebohongan senyap.
    expect(sumberAksi).toContain('.select("id")');
    expect(sumberAksi).toMatch(/\.length\s*===\s*0/);
  });

  it("memakai sesi pengguna, bukan service role", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("createAdminSupabase");
      expect(sumber).not.toContain("SERVICE_ROLE");
    }
    expect(sumberAksi).toContain("createServerSupabase");
  });

  it("tidak ada satu pun .delete() di seluruh berkas modul", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain(".delete(");
    }
  });

  it("tidak ada .update() ke service_rates — modul ini INSERT-only", () => {
    expect(sumberAksi).not.toContain(".update(");
  });

  it("tidak melahirkan VIEW berkolom uang (view melewati RLS)", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toMatch(/create\s+(or\s+replace\s+)?view/i);
    }
    // Nama view uang tidak boleh muncul sebagai TABEL yang dibaca modul ini.
    // `src/lib/owner/data.ts` sengaja tidak ikut dipindai: catatannya menyebut
    // `rekap_honor` justru untuk menjelaskan mengapa view itu TIDAK dibuat.
    for (const sumber of [sumberAksi, sumberHalaman, sumberForm, sumberStatus]) {
      expect(sumber).not.toContain("rekap_honor");
      expect(sumber).not.toContain("rate_card");
    }
    expect(sumberData).not.toMatch(/\.from\(\s*["'](rekap_honor|rate_card)["']/);
  });

  it("pencocokan identitas memakai operator setara, tidak pernah pola", () => {
    for (const sumber of [sumberAksi, sumberHalaman, sumberData]) {
      expect(sumber).not.toContain(".ilike(");
      expect(sumber).not.toContain(".like(");
    }
  });

  it("tidak menuliskan nominal ke log", () => {
    for (const sumber of SEMUA_SUMBER) {
      expect(sumber).not.toContain("console.");
    }
  });

  it("daftar putih & label tinggal di status.ts, bukan di berkas action", () => {
    expect(sumberStatus).not.toContain('"use server"');
    expect(sumberAksi).toMatch(/from\s+["']\.\/status["']/);
  });

  it("tanggal dihitung tanpa toISOString/setDate/getDay", () => {
    // mondayOf prototipe TERBUKTI salah di zona barat justru karena ketiganya.
    for (const sumber of SEMUA_SUMBER) {
      for (const terlarang of ["toISOString", "setDate(", "getDay(", "getMonth("]) {
        expect(sumber, `${terlarang} dipakai untuk logika tanggal`).not.toContain(terlarang);
      }
    }
  });

  it("layout owner TIDAK ikut berubah (matriks peran tetap satu panggilan)", () => {
    const layout = baca("src/app/owner/layout.tsx");
    expect([...layout.matchAll(/requireRole\(/g)]).toHaveLength(1);
    expect(layout).toMatch(/await\s+requireRole\(\s*\[\s*"owner"\s*\]\s*\)/);
  });

  it("navigasi owner menautkan modul ini", () => {
    expect(baca("src/app/owner/_shell/nav-owner.tsx")).toContain('href: "/owner/tarif"');
  });
});
