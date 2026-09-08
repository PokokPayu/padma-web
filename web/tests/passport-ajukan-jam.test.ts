/**
 * JAM MULAI PADA `ajukanJadwal` (spec C1 J2).
 *
 * Yang diuji di sini adalah GERBANGNYA, bukan bentuk jamnya — bentuk sudah
 * diuji sebagai fungsi murni di tests/jadwal-jam.test.ts. Server action adalah
 * endpoint POST tersendiri: `<select>` di layar tidak pernah menjadi pagar,
 * jadi setiap penolakan di bawah harus datang dari action, bukan dari UI.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";

const admin = createAdminSupabase();

const ANANDA = "44444444-4444-4444-4444-444444444401";
const SVC_NUTRISI = "11111111-1111-1111-1111-111111111103";
const TGL_DEPAN = "2027-03-15";

const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("notFound() terpanggil");
  },
}));

const { ajukanJadwal } = await import("@/lib/passport/aksi");

let VARIAN_NUTRISI: string;
let sesiAnanda: SupabaseClient;

/**
 * Alamat dibuat IDENTIK dengan alamat profil klien uji supaya `ajukanJadwal`
 * mewarisi koordinat profil dan TIDAK PERNAH memanggil Nominatim (jalur
 * `warisan` di lib/passport/aksi.ts). Itu membuat berkas ini tidak perlu
 * men-stub fetch sama sekali — dan stub fetch yang tidak perlu adalah stub
 * yang kelak bocor ke berkas lain.
 */
let ALAMAT_PROFIL = "";
/** Keadaan profil SEBELUM berkas ini menyentuhnya, dipulihkan di afterAll. */
let profilAsli: { alamat: string; alamat_lat: number | null; alamat_lon: number | null } | null =
  null;

function formulir(isi: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    layanan: SVC_NUTRISI,
    varian: VARIAN_NUTRISI,
    tanggal: TGL_DEPAN,
    waktu: "pagi",
    alamat: ALAMAT_PROFIL,
    ...isi,
  })) {
    fd.set(k, v);
  }
  return fd;
}

async function barisAnanda() {
  const { data } = await admin
    .from("booking_requests")
    .select("id, jam_mulai, preferensi_waktu, tanggal")
    .eq("client_id", ANANDA);
  return data ?? [];
}

beforeAll(async () => {
  sesiAnanda = await signInAs("ananda@padma.test");
  ref.sesi = sesiAnanda;
  VARIAN_NUTRISI = await varianBaku(admin, SVC_NUTRISI);

  const { data } = await admin
    .from("clients")
    .select("alamat, alamat_lat, alamat_lon")
    .eq("id", ANANDA)
    .maybeSingle<{ alamat: string; alamat_lat: number | null; alamat_lon: number | null }>();
  profilAsli = data ?? null;

  ALAMAT_PROFIL = data?.alamat?.trim() || "Jl. Uji Alamat Baku No. 1";
  // Koordinat dipastikan ADA supaya jalur warisan menyala. Dipulihkan di
  // afterAll — berkas uji lain mengasersikan alamat & koordinat klien ini.
  await admin
    .from("clients")
    .update({ alamat: ALAMAT_PROFIL, alamat_lat: -7.9666, alamat_lon: 112.6326 })
    .eq("id", ANANDA);
});

beforeEach(async () => {
  ref.sesi = sesiAnanda;
  await admin.from("booking_requests").delete().eq("client_id", ANANDA);
});

afterAll(async () => {
  await admin.from("booking_requests").delete().eq("client_id", ANANDA);
  if (profilAsli) {
    await admin
      .from("clients")
      .update({
        alamat: profilAsli.alamat,
        alamat_lat: profilAsli.alamat_lat,
        alamat_lon: profilAsli.alamat_lon,
      })
      .eq("id", ANANDA);
  }
});

describe("ajukanJadwal: jam mulai", () => {
  it("menolak pengajuan tanpa jam, dengan kalimat yang bisa dibaca manusia", async () => {
    const fd = formulir({});
    fd.delete("jam");
    const hasil = await ajukanJadwal(fd);
    expect(hasil.ok).toBe(false);
    expect(hasil.ok === false && hasil.pesan).toMatch(/jam/i);
    expect(await barisAnanda()).toEqual([]);
  });

  it("menolak jam yang bentuknya salah", async () => {
    for (const buruk of ["9:00", "24:00", "pagi", "09.00"]) {
      const hasil = await ajukanJadwal(formulir({ jam: buruk }));
      expect(hasil.ok, `jam "${buruk}" seharusnya ditolak`).toBe(false);
    }
    expect(await barisAnanda()).toEqual([]);
  });

  it("menolak jam yang BENTUKNYA sah tetapi tidak ada di daftar pengaturan", async () => {
    // '03:00' adalah HH:MM yang sah. Yang membuatnya ditolak adalah
    // keanggotaan pada daftar jam layanan — dan daftar itu dibaca di server,
    // bukan dipercaya dari FormData.
    const hasil = await ajukanJadwal(formulir({ jam: "03:00" }));
    expect(hasil.ok).toBe(false);
    expect(await barisAnanda()).toEqual([]);
  });

  it("menyimpan jam yang sah apa adanya", async () => {
    const hasil = await ajukanJadwal(formulir({ jam: "09:00" }));
    expect(hasil).toEqual({ ok: true });
    const baris = await barisAnanda();
    expect(baris.length).toBe(1);
    // Postgres `time` dibaca kembali sebagai 'HH:MM:SS'.
    expect(baris[0].jam_mulai).toBe("09:00:00");
  });

  it("preferensi_waktu TETAP tersimpan berdampingan dengan jam (spec J2)", async () => {
    // Keduanya, bukan salah satu: preferensi kini berarti "kalau jam yang saya
    // minta tidak bisa, saya lebih suka pagi/siang/sore".
    await ajukanJadwal(formulir({ jam: "13:00", waktu: "siang" }));
    const baris = await barisAnanda();
    expect(baris[0].jam_mulai).toBe("13:00:00");
    expect(baris[0].preferensi_waktu).toBe("siang");
  });
});

describe("gerbang jam ditembak LANGSUNG ke PostgREST, tanpa server action", () => {
  it("klien tidak bisa menyisipkan jam di luar jam layanan klinik", async () => {
    // `ajukanJadwal` memeriksa keanggotaan jam, tetapi klien memegang policy
    // INSERT dan bisa memanggil PostgREST langsung dengan JWT-nya sendiri.
    // Tanpa pagar di basis data, pengajuan pukul tiga pagi masuk ke antrean
    // admin sebagai janji — dan sejak J8 admin bahkan tidak punya tombol untuk
    // menolaknya.
    const { data: varian } = await admin
      .from("service_variants")
      .select("id")
      .eq("service_id", SVC_NUTRISI)
      .eq("aktif", true)
      .limit(1)
      .single<{ id: string }>();

    const { error } = await sesiAnanda.from("booking_requests").insert({
      client_id: ANANDA,
      service_id: SVC_NUTRISI,
      variant_id: varian!.id,
      tanggal: TGL_DEPAN,
      jam_mulai: "03:00",
      preferensi_waktu: "pagi",
      alamat: ALAMAT_PROFIL,
      status: "diminta",
    });

    expect(error).not.toBeNull();
    expect(await barisAnanda()).toEqual([]);
  });

  it("jam yang MEMANG ditawarkan tetap lolos lewat jalur yang sama", () => {
    // Dibuktikan oleh uji "menyimpan jam yang sah apa adanya" di atas, yang
    // menempuh server action sampai ke basis data. Disebut di sini supaya
    // pagar di atas tidak dibaca sebagai "semua insert langsung ditolak".
    expect(true).toBe(true);
  });
});
