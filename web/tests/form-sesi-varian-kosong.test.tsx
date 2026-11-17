/**
 * Formulir "+ Sesi baru" menahan simpan untuk layanan TANPA varian aktif.
 *
 * Penanda `kosong` dulu memeriksa varian aktif SELURUH layanan. Layanan yang
 * semua variannya nonaktif tetap bisa dipilih dan disimpan: pemilih varian
 * dinonaktifkan sehingga `variant_id` tidak terkirim, dan admin hanya
 * menerima pesan umum "Klien, layanan, varian, dan mitra wajib dipilih" dari
 * server tanpa tahu sebabnya.
 *
 * Keadaan yang dirender adalah keadaan AWAL (layanan pertama terpilih) —
 * `renderToStaticMarkup` tidak menjalankan `onChange`. Turunannya sama untuk
 * layanan mana pun yang terpilih, karena dihitung dari state `serviceId`.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
// Server action tidak pernah dipanggil di sini; impornya saja yang dievaluasi.
vi.mock("@/app/admin/sesi/aksi", () => ({ jadwalkanSesi: async () => ({ ok: true }) }));

const { FormJadwalSesi } = await import("@/app/admin/sesi/form-sesi");

const TANPA_VARIAN = { id: "svc-tanpa-varian", nama: "Pijat Laktasi" };
const DENGAN_VARIAN = { id: "svc-dengan-varian", nama: "Konsultasi Menyusui" };

function render(urutanLayanan: Array<{ id: string; nama: string }>) {
  return renderToStaticMarkup(
    <FormJadwalSesi
      klien={[{ id: "k1", nama: "Klien Sintetis", padmaId: "PAD-UJI-0001", alamatLat: null, alamatLon: null }]}
      layanan={urutanLayanan}
      varian={[{ id: "v1", serviceId: DENGAN_VARIAN.id, nama: "60 menit" }]}
      mitra={[{ id: "m1", nama: "Bidan Sintetis", lat: null, lon: null }]}
      tanggalAwal="2026-12-01"
      jamPilihan={["09:00"]}
      hrefTutup="/admin/sesi"
    />,
  );
}

/** Atribut tag tombol simpan saja, supaya `disabled` milik pemilih varian tidak ikut terbaca. */
function tombolSimpan(m: string): string {
  const cocok = /<button type="submit"[^>]*>/.exec(m);
  if (!cocok) throw new Error("tombol simpan tidak dirender");
  return cocok[0];
}

describe("FormJadwalSesi — layanan tanpa varian aktif", () => {
  it("layanan terpilih tanpa varian aktif: tombol simpan nonaktif dan sebabnya dikatakan", () => {
    const m = render([TANPA_VARIAN, DENGAN_VARIAN]);
    expect(tombolSimpan(m)).toMatch(/disabled=""/);
    expect(m).toContain("Layanan ini belum punya varian aktif");
  });

  it("kontrol: layanan terpilih punya varian aktif → tombol simpan aktif, tanpa peringatan", () => {
    const m = render([DENGAN_VARIAN, TANPA_VARIAN]);
    expect(tombolSimpan(m)).not.toMatch(/disabled=""/);
    expect(m).not.toContain("Layanan ini belum punya varian aktif");
  });
});
