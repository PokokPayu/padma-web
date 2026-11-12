/**
 * Seam `bacaPenjualan` — KUERI MANA yang ditembakkan, dan dengan saringan apa.
 *
 * Aturan agregasinya sudah diuji murni di `penjualan-hitung.test.ts`, dan
 * haknya diuji dengan Postgres sungguhan di `penjualan-db.test.ts`. Yang tidak
 * terlihat di keduanya adalah BENTUK PERMINTAANNYA: sebuah baris bisa hilang
 * dari laporan bukan karena salah hitung dan bukan karena RLS, melainkan
 * karena tidak ada satu pun kueri yang pernah memungutnya. Kegagalan itu sunyi
 * — tanpa galat, tanpa `terpotong`, tanpa `tanpaTanggal`.
 *
 * Karena itu berkas ini memakai KLIEN PALSU yang merekam setiap kueri dan
 * menjawabnya sesuai saringan yang terpasang. Tanpa DB, tanpa jaringan.
 */
import { describe, it, expect, vi } from "vitest";
import { bacaPenjualan, BATAS_BARIS_PENJUALAN } from "@/lib/penjualan/baca";
import { tanggalUang, nilaiBaris } from "@/lib/penjualan/hitung";

// Lihat `penjualan-layar.test.tsx`: `@/lib/supabase/server` menyeret
// `next/headers`. Di sini modulnya juga tidak pernah dipakai — setiap
// pemanggilan di bawah menyuntikkan `klien` sendiri.
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => {
    throw new Error("uji ini tidak boleh menyentuh Supabase");
  },
}));

type Panggilan = { tabel: string; metode: Array<{ nama: string; arg: unknown[] }> };
type KlienPenjualan = NonNullable<Parameters<typeof bacaPenjualan>[0]["klien"]>;

/**
 * Klien Supabase palsu: setiap metode pembangun memulangkan dirinya sendiri
 * dan mencatat namanya, lalu `await` memanggil `jawab` dengan seluruh jejak
 * kuerinya. Itulah yang membuat uji ini bisa membedakan kueri (a) dari kueri
 * (c): keduanya menyentuh tabel `orders`, dan yang memisahkannya hanya KOLOM
 * yang disaring.
 */
function klienPalsu(jawab: (p: Panggilan) => unknown[]) {
  const rekam: Panggilan[] = [];
  const from = (tabel: string) => {
    const p: Panggilan = { tabel, metode: [] };
    rekam.push(p);
    const pembangun: object = new Proxy(
      {},
      {
        get(_sasaran, kunci) {
          if (kunci === "then") {
            return (teruskan: (nilai: unknown) => unknown) =>
              teruskan({ data: jawab(p), error: null });
          }
          return (...arg: unknown[]) => {
            p.metode.push({ nama: String(kunci), arg });
            return pembangun;
          };
        },
      },
    );
    return pembangun;
  };
  return { rekam, klien: { from } as unknown as KlienPenjualan };
}

const kolom = (p: Panggilan, nama: string) =>
  p.metode.filter((m) => m.nama === nama).map((m) => m.arg[0]);

/**
 * Pesanan yang DITAHAN 28 September lalu diputuskan lunas 2 Oktober.
 *
 * `putuskan_pesanan_ditahan` menulis `lunas_pada = now()` tetapi
 * mempertahankan `ditutup_pada` yang lama — jadi kedua kolom ini memang BOLEH
 * berbeda bulan pada satu baris `lunas`.
 */
const PESANAN_LINTAS_BULAN = {
  id: "p-1",
  kode: "PSN-260928-AAAAAA",
  status: "lunas",
  lunas_pada: "2026-10-02T03:00:00Z",
  ditutup_pada: "2026-09-28T03:00:00Z",
  clients: { padma_id: "PDM-0001", nama: "Ibu A" },
};

const ITEM = {
  pesanan_id: "p-1",
  judul_beku: "Kelas Menyusui",
  harga_beku: 150_000,
  urutan: 1,
  product_id: "a",
};

const OKTOBER = { mulai: "2026-10-01T00:00:00+07:00", sampai: "2026-11-01T00:00:00+07:00" };
const SEPTEMBER = { mulai: "2026-09-01T00:00:00+07:00", sampai: "2026-10-01T00:00:00+07:00" };

describe("bacaPenjualan: pesanan ditahan lintas bulan lalu diputuskan lunas", () => {
  it("MUNCUL di bulan `lunas_pada`, dipungut kueri ketiga", async () => {
    // Kueri (a) menyaring `ditutup_pada` (September) dan karenanya pulang
    // kosong untuk Oktober; tanpa kueri (c) baris ini tidak ada di bulan mana
    // pun, dan uang yang sudah dikonfirmasi lenyap tanpa jejak.
    const { klien, rekam } = klienPalsu((p) => {
      if (p.tabel === "orders") {
        return kolom(p, "gte").includes("lunas_pada") ? [PESANAN_LINTAS_BULAN] : [];
      }
      if (p.tabel === "pesanan_item_staf") return [ITEM];
      return [];
    });

    const { baris } = await bacaPenjualan({ ...OKTOBER, klien });

    expect(baris).toHaveLength(1);
    expect(baris[0].kode).toBe("PSN-260928-AAAAAA");
    expect(tanggalUang(baris[0])).toBe("2026-10-02T03:00:00Z");
    expect(nilaiBaris(baris[0])).toBe(150_000);

    // Kueri ketiga itu benar-benar ada, dan ia menyaring `lunas_pada` pada
    // KEDUA ujung rentangnya — bukan hanya salah satunya.
    const lunas = rekam.filter(
      (p) => p.tabel === "orders" && kolom(p, "gte").includes("lunas_pada"),
    );
    expect(lunas).toHaveLength(1);
    expect(kolom(lunas[0], "lt")).toContain("lunas_pada");
  });

  it("TIDAK muncul di bulan `ditutup_pada` — klip rentang tetap memegangnya", async () => {
    // Sisi lain dari uji di atas: baris ini milik SATU bulan, bukan dua.
    // Bucket yang memuatnya dua kali lebih buruk daripada yang kehilangannya,
    // sebab dua laporan lalu menyebut angka berbeda untuk uang yang sama.
    const { klien } = klienPalsu((p) => {
      if (p.tabel === "orders") {
        return kolom(p, "gte").includes("ditutup_pada") ? [PESANAN_LINTAS_BULAN] : [];
      }
      if (p.tabel === "pesanan_item_staf") return [ITEM];
      return [];
    });

    const { baris } = await bacaPenjualan({ ...SEPTEMBER, klien });

    expect(baris).toHaveLength(0);
  });

  it("tutupnya kueri ketiga ikut dilaporkan lewat `terpotong`", async () => {
    const banyak = Array.from({ length: BATAS_BARIS_PENJUALAN }, (_, i) => ({
      ...PESANAN_LINTAS_BULAN,
      id: `p-${i}`,
      kode: `PSN-260928-${String(i).padStart(6, "0")}`,
    }));
    const { klien } = klienPalsu((p) => {
      if (p.tabel === "orders") {
        return kolom(p, "gte").includes("lunas_pada") ? banyak : [];
      }
      return [];
    });

    const { terpotong } = await bacaPenjualan({ ...OKTOBER, klien });

    expect(terpotong).toBe(true);
  });
});

describe("bacaPenjualan: riwayat satu klien tanpa rentang", () => {
  it("TIDAK menembak notifikasi_pesanan di putaran 1", async () => {
    // Putaran 1(b) tidak punya saringan klien (notifikasi tak memikul
    // `client_id`); tanpa rentang ia juga kehilangan saringan tanggalnya, lalu
    // memulangkan 500 notifikasi terbaru MILIK SEMUA KLIEN. Id-id itu menyeret
    // belasan permintaan putaran 2 atas data klien lain — beban dan radius
    // ledakan untuk baris yang akhirnya dibuang lagi.
    const { klien, rekam } = klienPalsu(() => []);

    const { baris } = await bacaPenjualan({ clientId: "k-1", klien });

    expect(baris).toEqual([]);
    expect(rekam.map((p) => p.tabel)).toEqual(["orders", "orders"]);
    // Dan kedua kueri yang tersisa benar-benar terkunci pada kliennya.
    for (const p of rekam) {
      expect(
        p.metode.some(
          (m) => m.nama === "eq" && m.arg[0] === "client_id" && m.arg[1] === "k-1",
        ),
        p.tabel,
      ).toBe(true);
    }
  });

  it("dengan RENTANG, putaran 1(b) tetap dijalankan", async () => {
    // Yang membuat (b) perlu adalah rentangnya: uang yang mendarat di dalam
    // rentang pada pesanan yang ditutup sebelumnya. Melewatkannya di sini akan
    // menjadi perbaikan yang membuang baris sungguhan.
    const { klien, rekam } = klienPalsu(() => []);

    await bacaPenjualan({ clientId: "k-1", ...OKTOBER, klien });

    expect(rekam.map((p) => p.tabel)).toContain("notifikasi_pesanan");
  });

  it("tanpa clientId (periode \"semua\"), putaran 1(b) tetap dijalankan", async () => {
    const { klien, rekam } = klienPalsu(() => []);

    await bacaPenjualan({ klien });

    expect(rekam.map((p) => p.tabel)).toContain("notifikasi_pesanan");
  });
});
