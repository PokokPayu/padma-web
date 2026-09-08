import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiniLayanan } from "@/app/_landing/lini-layanan";
import type { FaseKatalog } from "@/lib/katalog";

/**
 * Fase yang katalognya belum terisi TIDAK boleh muncul di landing.
 *
 * Pagar ini ada karena kegagalannya berbentuk diam: kartu kosong tetap
 * merender rapi, tidak melempar galat, dan tidak memerahkan satu pun uji lain
 * — ia hanya memberi tahu pengunjung bahwa lini itu tidak punya apa-apa.
 * Katalog produksi 8 September memang lahir tanpa layanan untuk Sankalpa dan
 * Sandhya, jadi ini bukan kasus hipotetis.
 *
 * Diuji lewat prop yang dirakit sendiri, bukan lewat markup landing: seed
 * lokal mengisi kelima fase, sehingga cabang "fase kosong" tidak pernah
 * tersentuh oleh data yang ada.
 */

function fase(id: string, namaSanskrit: string, jumlahLayanan: number): FaseKatalog {
  return {
    id,
    namaSanskrit,
    nama: `Label ${id}`,
    urutan: 1,
    layanan: Array.from({ length: jumlahLayanan }, (_, i) => ({
      id: `${id}-${i}`,
      nama: `Layanan ${id} ${i}`,
      varian: [{ label: "60 menit · Private", hargaKlien: 139000, hargaCoret: 159000 }],
    })),
  };
}

describe("landing — fase tanpa layanan", () => {
  it("tidak merender kartu fase yang katalognya kosong", () => {
    const markup = renderToStaticMarkup(
      <LiniLayanan katalog={[fase("terisi", "Garbha", 2), fase("hampa", "Sandhya", 0)]} />,
    );
    expect(markup).toContain("Garbha");
    expect(markup).not.toContain("Sandhya");
  });

  it("merender fase yang terisi — kontrol positif, supaya uji di atas tidak lulus karena komponennya diam", () => {
    const markup = renderToStaticMarkup(
      <LiniLayanan katalog={[fase("terisi", "Garbha", 1)]} />,
    );
    expect(markup).toContain("Garbha");
    expect(markup).toContain("Rp 139.000");
  });

  it("seluruh fase kosong berarti seksinya hilang, bukan judul menggantung tanpa kartu", () => {
    const markup = renderToStaticMarkup(
      <LiniLayanan katalog={[fase("hampa", "Sandhya", 0)]} />,
    );
    expect(markup).toBe("");
  });

  it("badge Soft Launch muncul sekali per layanan, bukan sekali per baris harga", () => {
    const dua: FaseKatalog = {
      id: "f", namaSanskrit: "Garbha", nama: "Kehamilan", urutan: 1,
      layanan: [{
        id: "l", nama: "Garbha Relief",
        varian: [
          { label: "60 menit · Private", hargaKlien: 139000, hargaCoret: 159000 },
          { label: "90 menit · Private", hargaKlien: 179000, hargaCoret: 199000 },
          { label: "120 menit · Private", hargaKlien: 219000, hargaCoret: 239000 },
        ],
      }],
    };
    const markup = renderToStaticMarkup(<LiniLayanan katalog={[dua]} />);
    expect(markup.match(/Soft Launch/g) ?? []).toHaveLength(1);
    // Harga coret tetap per baris — yang dikurangi badge-nya, bukan datanya.
    expect(markup.match(/<s\b[^>]*>/g) ?? []).toHaveLength(3);
  });
});
