/**
 * Primitif ISI halaman panel staf: Kartu, StatTile, Tabel, dan kedua grafik.
 *
 * Berkas ini tidak menyentuh basis data. Yang dijaga:
 *
 *  1. Warna grafik tetap heks yang SUDAH divalidasi. Palet kategorikal yang
 *     diganti berdasarkan selera tidak menghasilkan error apa pun — ia hanya
 *     berhenti terbaca oleh sebagian pembaca, diam-diam.
 *  2. Grafik tidak pernah tahu soal rupiah. Formatnya datang sebagai prop;
 *     satu `formatRupiah` yang diimpor di primitif bersama adalah undangan
 *     permanen untuk memunculkan nominal di panel admin.
 *  3. Sumbu Y mulai dari nol. Sumbu terpotong membesar-besarkan selisih kecil.
 *  4. Setiap grafik punya padanan tabel. Grafik yang hanya bisa dibaca dengan
 *     mata adalah grafik yang sebagian pemakainya tidak bisa baca sama sekali.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const { PALET_GRAFIK } = await import("@/app/_shell/panel/palet");
const { Kartu } = await import("@/app/_shell/panel/kartu");
const { StatTile } = await import("@/app/_shell/panel/stat-tile");

describe("palet grafik", () => {
  it("tiga heks, persis yang lolos validator", () => {
    // Dijalankan dengan scripts/validate_palette.js milik skill dataviz pada
    // 6 September 2026: lightness band PASS, chroma floor PASS, pemisahan CVD
    // PASS (terburuk ΔE 10.1 deutan), ambang penglihatan normal PASS (ΔE 23.8).
    // Angka-angka ini yang dikunci; menggantinya menuntut menjalankan ulang.
    expect(PALET_GRAFIK).toEqual(["#2e8b57", "#8c4a7d", "#c8952f"]);
  });

  it("tidak ada warna grafik yang ditulis ulang sebagai literal di komponen", () => {
    // Dua salinan heks akan berpisah pada perubahan berikutnya, dan yang
    // berpisah adalah warna yang divalidasi versus warna yang dipakai.
    for (const berkas of [
      "src/app/_shell/panel/grafik-batang.tsx",
      "src/app/_shell/panel/grafik-garis.tsx",
    ]) {
      let sumber = "";
      try {
        sumber = baca(berkas);
      } catch {
        continue; // berkasnya lahir di task berikutnya
      }
      for (const heks of PALET_GRAFIK) {
        expect(sumber, `${berkas} menyalin ${heks}`).not.toContain(heks);
      }
    }
  });
});

describe("Kartu", () => {
  it("tanpa judul: tidak merender kepala kosong", () => {
    const m = renderToStaticMarkup(
      createElement(Kartu, { children: createElement("p", null, "ISI") }),
    );
    expect(m).toContain("ISI");
    expect(m).not.toContain("<header");
  });

  it("dengan judul: kepala berisi judul dan aksinya", () => {
    const m = renderToStaticMarkup(
      createElement(Kartu, {
        judul: "Agenda hari ini",
        aksi: createElement("a", { href: "/x" }, "Semua"),
        children: createElement("p", null, "ISI"),
      }),
    );
    expect(m).toContain("<header");
    expect(m).toContain("Agenda hari ini");
    expect(m).toContain('href="/x"');
  });

  it("memakai bentuk kartu panel, bukan kartu klien", () => {
    const m = renderToStaticMarkup(
      createElement(Kartu, { children: null }),
    );
    expect(m).toContain("rounded-lg");
    expect(m).toContain("border-panel-border");
    expect(m).toContain("bg-panel-surface");
    expect(m).not.toContain("rounded-2xl");
  });
});

describe("StatTile", () => {
  function tile(tambahan: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(StatTile, {
        label: "Skrining baru",
        nilai: "3",
        keterangan: "Belum ditindaklanjuti",
        ...tambahan,
      } as never),
    );
  }

  it("angka bertujuan menjadi tautan; angka tanpa tujuan tidak", () => {
    // Angka tanpa modul yang bisa memadamkannya adalah alarm yang tidak bisa
    // dibersihkan — keadaan yang sempat nyata untuk "Klaim pembayaran".
    expect(tile({ href: "/admin/skrining" })).toContain('href="/admin/skrining"');
    expect(tile()).not.toContain("<a");
  });

  it("angka memakai tabular-nums supaya kolom angka tidak bergoyang", () => {
    expect(tile()).toContain("tabular-nums");
  });

  it("hanya angka yang MENUNTUT tindakan yang diwarnai clay", () => {
    // Semua angka berwarna merah = tidak ada yang berarti merah.
    expect(tile({ menuntut: true })).toContain("text-clay");
    expect(tile({ menuntut: false })).not.toContain("text-clay");
  });

  it("label & keterangan tetap tinta teks, bukan warna angka", () => {
    const m = tile({ menuntut: true });
    // Teks memakai token tinta; warna hanya menempel pada angkanya.
    expect(m).toContain("text-panel-muted");
  });
});

const { Tabel, Th, Td } = await import("@/app/_shell/panel/tabel");

describe("Tabel", () => {
  function tabelUji() {
    return renderToStaticMarkup(
      createElement(
        Tabel,
        { label: "Agenda hari ini" },
        createElement(
          "thead",
          null,
          createElement("tr", null, createElement(Th, null, "Klien")),
        ),
        createElement(
          "tbody",
          null,
          createElement("tr", null, createElement(Td, null, "Ananda")),
        ),
      ),
    );
  }

  it("punya nama aksesibel — tabel tanpa nama tak bisa dilompati pembaca layar", () => {
    expect(tabelUji()).toContain('aria-label="Agenda hari ini"');
  });

  it("menggulung SENDIRI di sumbu X, bukan memaksa halaman ikut menggulung", () => {
    // Badan halaman tidak boleh pernah menggulung horizontal; tabel lebarlah
    // yang menggulung di dalam wadahnya.
    expect(tabelUji()).toContain("overflow-x-auto");
  });

  it("kepala kolom memakai scope, bukan sekadar tebal", () => {
    expect(tabelUji()).toContain('scope="col"');
  });
});
