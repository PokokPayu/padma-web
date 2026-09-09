/**
 * Detail sesi admin — lapisan data `ambilDetailSesi`.
 *
 * Halaman ini menjawab satu pertanyaan yang selama ini tidak bisa dijawab dari
 * layar mana pun: SKRINING MANA yang menopang sesi ini. Rantainya dua lompatan
 * — `sessions.booking_request_id` → `booking_requests.screening_id` →
 * `screenings` — dan justru karena tidak langsung, ia gampang putus tanpa satu
 * pun galat: PostgREST yang gagal menyusun embed bersarang tidak melempar, ia
 * memulangkan `null`, dan layarnya berbunyi "tidak ada skrining" untuk sesi
 * yang skriningnya baik-baik saja. Test pertama di bawah ada untuk itu.
 *
 * Tiga bentuk kegagalan lain yang dijaga di sini:
 *
 *  1. SESI ORANG LAIN. Halaman menarik satu baris MENURUT ID dari URL. Bila
 *     lapisan ini memakai service role, id yang ditebak seseorang memulangkan
 *     riwayat perawatan klien mana pun. Ia karena itu memakai sesi pengguna,
 *     dan test terakhir membuktikannya dengan sesi KLIEN sungguhan.
 *
 *  2. SESI TANPA PENGAJUAN. Sesi yang dijadwalkan admin langsung memang tidak
 *     punya skrining (`booking_request_id` NULL). Itu keadaan SAH, bukan galat
 *     — dan harus terbedakan dari "skriningnya gagal terbaca".
 *
 *  3. BENDERA HILANG. `flags` adalah satu-satunya isi skrining yang berguna
 *     bagi bidan. Embed yang lupa menyebut kolomnya memulangkan skrining
 *     lengkap dengan kode dan hasilnya — hanya jawabannya yang raib.
 *
 * Data uji memakai tanggal khusus (2026-12-29) dan dibersihkan di `afterAll`:
 * `passport-beranda.test.ts` meng-assert jumlah stempel Ananda PERSIS, jadi
 * tidak boleh ada sesi sisa yang menempel padanya.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { signInAs } from "./helpers/as-user";
import { varianBaku } from "./helpers/varian";
import { skriningHijau } from "./helpers/skrining";

const admin = createAdminSupabase();

const KLIEN = "44444444-4444-4444-4444-444444444401"; // Ananda
const KLIEN_LAIN = "44444444-4444-4444-4444-444444444402"; // Rina
const SVC = "11111111-1111-1111-1111-111111111101"; // Fertility Massage
const MITRA = "33333333-3333-3333-3333-333333333301"; // Bidan Sri Wahyuni
const TGL = "2026-12-29";
const HANTU = "00000000-0000-0000-0000-000000000000";

// Lapisan data memakai sesi pengguna (`createServerSupabase`). Di vitest tidak
// ada cookie, jadi klien ber-SESI SUNGGUHAN disuntikkan: RLS tetap berjalan
// apa adanya, persis seperti di server.
const ref = vi.hoisted(() => ({ sesi: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ref.sesi!,
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => "admin" }));

// `notFound()` melempar di dalam request Next. Di test ia dijadikan error yang
// bisa dibaca supaya "penjaga id hilang" menjadi MERAH, bukan senyap.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOTFOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  usePathname: () => "/admin/sesi",
  useRouter: () => ({ push: () => {} }),
}));

const { ambilDetailSesi } = await import("@/lib/admin/sesi-detail");
const { default: HalamanDetailSesi } = await import("@/app/admin/sesi/[id]/page");
const { default: HalamanDetailKlien } = await import("@/app/admin/klien/[id]/page");

const renderSesi = async (id: string) =>
  renderToStaticMarkup(await HalamanDetailSesi({ params: Promise.resolve({ id }) }));

let sesiAdmin: SupabaseClient;
let sesiKlien: SupabaseClient;
let idSesiDariPengajuan = "";
let idSesiLangsung = "";
let idSesiKlienLain = "";
let idSkrining = "";

async function bersihkan() {
  const { data } = await admin.from("sessions").select("id").eq("tanggal", TGL);
  const ids = (data ?? []).map((s) => s.id as string);
  if (ids.length) await admin.from("jejak_status_bayar").delete().in("sesi_id", ids);
  // Sesi DULU, baru permintaannya: `sessions.booking_request_id` menahan
  // penghapusan permintaan yang sudah menjadi sesi (FK tanpa on delete).
  await admin.from("sessions").delete().eq("tanggal", TGL);
  await admin.from("booking_requests").delete().eq("tanggal", TGL);
  // SESUDAH booking_requests: FK screening_id menahan penghapusan selama masih
  // ditunjuk baris permintaan.
  //
  // MENURUT ID, bukan `like("kode", "UJI-%")`. Prefiks itu milik BERSAMA —
  // `skriningHijau` memakainya untuk setiap berkas uji — dan vitest
  // menjalankan berkas secara paralel. Menghapus menurut prefiks berarti
  // berkas ini mencabut skrining yang sedang dipakai berkas lain di
  // pertengahan jalan, dan yang merah adalah berkas SEBELAH: enam test di
  // `admin-sesi-catatan` gagal dengan "sesi tidak ditemukan" sementara berkas
  // ini sendiri hijau. Yang dibersihkan hanyalah yang diterbitkan di sini.
  if (idSkrining) await admin.from("screenings").delete().eq("id", idSkrining);
}

beforeAll(async () => {
  sesiAdmin = await signInAs("admin@padma.test");
  sesiKlien = await signInAs("ananda@padma.test");
  ref.sesi = sesiAdmin;
  await bersihkan();

  const varian = await varianBaku(admin, SVC);
  idSkrining = await skriningHijau(admin, KLIEN, {
    flags: [
      { id: "demam", level: "urgent", teks: "Demam di atas 38°C dalam 3 hari terakhir" },
      { id: "nyeri", level: "perhatian", teks: "Nyeri punggung bawah yang menetap" },
    ],
  });

  const { data: permintaan, error: galatPermintaan } = await admin
    .from("booking_requests")
    .insert({
      client_id: KLIEN,
      service_id: SVC,
      variant_id: varian,
      partner_id: MITRA,
      screening_id: idSkrining,
      tanggal: TGL,
      jam_mulai: "09:00",
      preferensi_waktu: "pagi",
      status: "dikonfirmasi",
    })
    .select("id")
    .single<{ id: string }>();
  if (galatPermintaan) throw galatPermintaan;

  const { data: tiga, error: galatSesi } = await admin
    .from("sessions")
    .insert([
      {
        client_id: KLIEN,
        service_id: SVC,
        variant_id: varian,
        partner_id: MITRA,
        tanggal: TGL,
        jam_mulai: "09:00",
        status: "terjadwal",
        alamat: "Jl. Ijen 5, Malang",
        booking_request_id: permintaan.id,
      },
      {
        client_id: KLIEN,
        service_id: SVC,
        variant_id: varian,
        partner_id: MITRA,
        tanggal: TGL,
        jam_mulai: "13:00",
        status: "terjadwal",
        alamat: "Jl. Ijen 5, Malang",
      },
      // Milik klien LAIN. Di seed hanya Ananda yang punya sesi, jadi tanpa
      // baris ini tidak ada apa pun untuk diuji-tembus pada test terakhir.
      {
        client_id: KLIEN_LAIN,
        service_id: SVC,
        variant_id: varian,
        partner_id: MITRA,
        tanggal: TGL,
        jam_mulai: "15:00",
        status: "terjadwal",
        alamat: "Jl. Kawi 9, Malang",
      },
    ])
    .select("id, client_id, booking_request_id")
    .returns<{ id: string; client_id: string; booking_request_id: string | null }[]>();
  if (galatSesi) throw galatSesi;

  const milikAnanda = tiga.filter((s) => s.client_id === KLIEN);
  idSesiDariPengajuan = milikAnanda.find((s) => s.booking_request_id !== null)!.id;
  idSesiLangsung = milikAnanda.find((s) => s.booking_request_id === null)!.id;
  idSesiKlienLain = tiga.find((s) => s.client_id === KLIEN_LAIN)!.id;
});

afterAll(async () => {
  await bersihkan();
});

describe("ambilDetailSesi — skrining penopang", () => {
  it("memulangkan skrining beserta benderanya untuk sesi yang lahir dari pengajuan", async () => {
    ref.sesi = sesiAdmin;
    const detail = await ambilDetailSesi(idSesiDariPengajuan);

    expect(detail?.skrining?.id).toBe(idSkrining);
    expect(detail?.skrining?.hasil).toBe("hijau");
    // Bendera adalah satu-satunya isi skrining yang berguna bagi bidan; embed
    // yang lupa menyebut kolomnya memulangkan skrining tanpa jawabannya.
    expect(detail?.skrining?.flags.map((f) => f.id)).toEqual(["demam", "nyeri"]);
  });

  it("memulangkan skrining null untuk sesi yang dijadwalkan admin langsung", async () => {
    ref.sesi = sesiAdmin;
    const detail = await ambilDetailSesi(idSesiLangsung);

    // Bukan null karena gagal — sesinya ADA dan terbaca.
    expect(detail?.id).toBe(idSesiLangsung);
    expect(detail?.skrining).toBeNull();
  });

  it("memulangkan null untuk id yang tidak ada", async () => {
    ref.sesi = sesiAdmin;
    expect(await ambilDetailSesi(HANTU)).toBeNull();
  });

  it("klien tidak bisa membaca sesi lewat lapisan ini kecuali miliknya", async () => {
    // Ananda MEMANG pemilik dua sesi di atas, jadi yang diuji adalah sesi
    // milik Rina: bila lapisan ini diam-diam memakai service role, baris itu
    // tetap terbaca dan riwayat perawatan orang lain bocor lewat URL tebakan.
    ref.sesi = sesiKlien;
    expect(await ambilDetailSesi(idSesiKlienLain)).toBeNull();
    // Dan pembanding yang membuktikan sesi klien itu memang hidup: miliknya
    // sendiri tetap terbaca, jadi `null` di atas bukan sekadar sesi mati.
    expect((await ambilDetailSesi(idSesiLangsung))?.id).toBe(idSesiLangsung);
  });
});

describe("halaman /admin/sesi/[id]", () => {
  it("menampilkan kode skrining, hasilnya, dan jawaban berbendera", async () => {
    ref.sesi = sesiAdmin;
    const m = await renderSesi(idSesiDariPengajuan);

    const { data: s } = await admin
      .from("screenings")
      .select("kode")
      .eq("id", idSkrining)
      .single<{ kode: string }>();

    expect(m).toContain(s!.kode);
    expect(m).toContain("HIJAU");
    // Teks benderanya, bukan sekadar jumlahnya: yang dibaca bidan adalah
    // kalimatnya.
    expect(m).toContain("Demam di atas 38");
    expect(m).toContain("Nyeri punggung bawah yang menetap");
  });

  it("menandai bendera urgent, bukan menyamakannya dengan bendera lain", async () => {
    ref.sesi = sesiAdmin;
    // Penanda URGENT dihitung dari LEVEL bendera, bukan dari warna hasil —
    // aturan yang sama sudah berlaku di Inbox Skrining, dan dua layar yang
    // menampilkan data sama dengan aturan berbeda adalah cara paling halus
    // membuat staf salah membaca.
    expect(await renderSesi(idSesiDariPengajuan)).toContain("URGENT");
  });

  it("mengatakan sesi TANPA pengajuan tidak punya skrining, bukan diam", async () => {
    ref.sesi = sesiAdmin;
    const m = await renderSesi(idSesiLangsung);

    expect(m).toContain("dijadwalkan admin langsung");
    // Dan TIDAK meminjam skrining sesi lain: bagian ini pernah menjadi tempat
    // paling gampang untuk menampilkan baris skrining klien yang sama.
    expect(m).not.toContain("Demam di atas 38");
  });

  it("id yang tidak ada berakhir notFound, bukan halaman kosong", async () => {
    ref.sesi = sesiAdmin;
    await expect(renderSesi(HANTU)).rejects.toThrow("NOTFOUND");
  });

  it("menaut balik ke klien pemilik sesi", async () => {
    ref.sesi = sesiAdmin;
    expect(await renderSesi(idSesiDariPengajuan)).toContain(`/admin/klien/${KLIEN}`);
  });

  it("TIDAK menampilkan satu nominal rupiah pun", async () => {
    ref.sesi = sesiAdmin;
    // Modul sesi adalah sisi LOGISTIK dari money firewall: jenjang transport
    // tampil sebagai jarak, tidak pernah sebagai rupiah.
    expect(await renderSesi(idSesiDariPengajuan)).not.toMatch(/Rp\s?[\d.]/);
  });
});

describe("riwayat sesi di /admin/klien/[id]", () => {
  it("setiap sesi menaut ke halaman detail sesinya", async () => {
    ref.sesi = sesiAdmin;
    const m = renderToStaticMarkup(
      await HalamanDetailKlien({ params: Promise.resolve({ id: KLIEN }) }),
    );

    expect(m).toContain(`href="/admin/sesi/${idSesiDariPengajuan}"`);
  });

  it("menawarkan jalan ke SELURUH sesi klien, bukan berhenti di 8 terakhir", async () => {
    ref.sesi = sesiAdmin;
    const m = renderToStaticMarkup(
      await HalamanDetailKlien({ params: Promise.resolve({ id: KLIEN }) }),
    );

    const { data: k } = await admin
      .from("clients")
      .select("padma_id")
      .eq("id", KLIEN)
      .single<{ padma_id: string }>();

    // Daftar dipotong 8 baris. Tanpa tautan ini, sesi ke-9 dan seterusnya
    // tidak bisa dicapai dari layar klien sama sekali.
    expect(m).toContain(`cari=${k!.padma_id}`);
  });
});
