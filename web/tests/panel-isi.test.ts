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

const { PALET_GRAFIK, WARNA_PERMUKAAN } = await import("@/app/_shell/panel/palet");
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
    // Kartu mewajibkan `children` di tipenya (bukan opsional), jadi
    // createElement TIDAK BISA menyimpulkan properti itu terpenuhi lewat
    // argumen posisi ketiga — TypeScript tetap menuntutnya di objek props.
    // Berkas ini berekstensi .ts (bukan .tsx) sehingga sintaks JSX
    // `<Kartu>{...}</Kartu>` tidak tersedia sebagai jalan keluar.
    const m = renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop
      createElement(Kartu, { children: createElement("p", null, "ISI") }),
    );
    expect(m).toContain("ISI");
    expect(m).not.toContain("<header");
  });

  it("dengan judul: kepala berisi judul dan aksinya", () => {
    const m = renderToStaticMarkup(
      // eslint-disable-next-line react/no-children-prop -- lihat alasan di test sebelumnya
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
      // eslint-disable-next-line react/no-children-prop -- lihat alasan di test pertama describe ini
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
        // `children` dioper POSISIONAL di bawah; TypeScript tidak
        // memperhitungkannya terhadap prop `children` yang wajib, dan berkas ini
        // ber-ekstensi .ts sehingga sintaks JSX tidak tersedia sebagai jalan
        // keluar. Pola `as never` yang sama sudah dipakai berkas test lain.
        { label: "Agenda hari ini" } as never,
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

const { batasAtas, GEOM, skalaY } = await import("@/app/_shell/panel/grafik-dasar");
const { GrafikBatang } = await import("@/app/_shell/panel/grafik-batang");

const DATA_BATANG = [
  { label: "1 Jul", nilai: 0 },
  { label: "8 Jul", nilai: 3 },
  { label: "15 Jul", nilai: 7 },
  { label: "22 Jul", nilai: 2 },
];

describe("batasAtas — sumbu Y", () => {
  it("selalu mulai dari nol dan naik ke angka bagus (1/2/2,5/5 × 10^n)", () => {
    expect(batasAtas([3])).toBe(4);
    // Bukan lagi kelipatan empat (dulu 12): 9 naik ke angka bagus terdekat
    // yang masih ≥ 9, yaitu 10 — satu kelipatan dari 1×10¹.
    expect(batasAtas([9])).toBe(10);
    expect(batasAtas([100])).toBe(100);
  });

  it("data kosong tetap punya kisi, bukan pembagian nol", () => {
    expect(batasAtas([])).toBe(4);
    expect(batasAtas([0, 0, 0])).toBe(4);
  });

  it("nilai negatif tidak menyeret batas ke bawah nol", () => {
    // Grafik batang panel ini menghitung kejadian; negatif tidak sah, tapi
    // membiarkannya memampatkan skala akan menyembunyikan seluruh data.
    expect(batasAtas([-5, 2])).toBe(4);
  });

  it("magnitudo rupiah realistis naik ke angka bagus, bukan gilingan kelipatan empat", () => {
    // Kelipatan-empat lama akan menghasilkan "Rp 462.500" sebagai gridline —
    // bulat bagi kalkulator, bukan bagi mata. Aturan baru naik ke 1/2/2,5/5×10ⁿ:
    // 462.500 naik ke 500.000 (5 × 10⁵).
    expect(batasAtas([462_500])).toBe(500_000);
    // Beberapa titik uji tambahan pada tiap slot pengali agar aturannya
    // benar-benar diuji, bukan hanya kebetulan cocok pada satu kasus.
    expect(batasAtas([180])).toBe(200); // 2 × 10²
    expect(batasAtas([220])).toBe(250); // 2,5 × 10²
    expect(batasAtas([260])).toBe(500); // 5 × 10²
  });
});

describe("skalaY", () => {
  it("nol berada di garis dasar, maksimum di tepi atas area plot", () => {
    const dasar = GEOM.tinggi - GEOM.pad.bawah;
    expect(skalaY(0, 10)).toBeCloseTo(dasar, 5);
    expect(skalaY(10, 10)).toBeCloseTo(GEOM.pad.atas, 5);
  });
});

describe("GrafikBatang", () => {
  function batang(tambahan: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(GrafikBatang, {
        judul: "Sesi selesai per pekan",
        data: DATA_BATANG,
        ...tambahan,
      } as never),
    );
  }

  it("satu bentuk batang per titik data", () => {
    const m = batang();
    expect([...m.matchAll(/data-batang="/g)]).toHaveLength(DATA_BATANG.length);
  });

  it("batang bernilai nol tetap ada sebagai titik data, bukan lubang", () => {
    // Pekan tanpa sesi adalah informasi. Menghilangkannya membuat delapan
    // pekan terlihat seperti enam, dan trennya berbohong.
    const m = batang();
    expect(m).toContain('data-batang="0"');
  });

  it("seri tunggal TIDAK memakai legenda — judulnya sudah menamai serinya", () => {
    expect(batang()).not.toContain("<ul");
  });

  it("label langsung bersifat selektif, bukan angka di setiap batang", () => {
    // Angka di setiap batang mengubah grafik menjadi tabel yang sulit dibaca.
    const m = batang();
    expect([...m.matchAll(/data-label-langsung/g)].length).toBeLessThan(
      DATA_BATANG.length,
    );
    expect([...m.matchAll(/data-label-langsung/g)].length).toBeGreaterThan(0);
  });

  it("punya padanan tabel — grafik bukan satu-satunya jalan ke angkanya", () => {
    const m = batang();
    // Diperiksa DI DALAM markup <table> itu sendiri, bukan di seluruh
    // dokumen: label pekan juga muncul di LabelX sumbu-X dan di aria-label
    // svg, jadi memeriksa `m` utuh akan tetap hijau walau <details>/tabelnya
    // dihapus — persis regresi yang ingin dicegah judul tes ini.
    const tabel = m.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
    expect(tabel).not.toBe("");
    for (const t of DATA_BATANG) {
      expect(tabel).toContain(t.label);
    }
  });

  it("svg menamai dirinya untuk pembaca layar", () => {
    const m = batang();
    expect(m).toMatch(/<svg[^>]*role="img"/);
    expect(m).toMatch(/<svg[^>]*aria-label="[^"]+"/);
  });

  it("memakai warna slot pertama palet tervalidasi", () => {
    expect(batang()).toContain(PALET_GRAFIK[0]);
  });

  it("format nilai datang dari prop — grafik tidak tahu satuan apa pun", () => {
    const m = batang({ format: (n: number) => `${n} sesi` });
    expect(m).toContain("7 sesi");
  });

  it("tidak memuat nominal maupun pemformat rupiah", () => {
    const sumber = baca("src/app/_shell/panel/grafik-batang.tsx");
    expect(sumber).not.toMatch(/Rp\s?\d|formatRupiah/);
  });
});

const { GrafikGaris } = await import("@/app/_shell/panel/grafik-garis");

const LABEL_PEKAN = ["1 Jul", "8 Jul", "15 Jul", "22 Jul"];
const SERI_UJI = [
  { nama: "Harga klien", nilai: [400000, 800000, 1200000, 900000] },
  { nama: "Honor mitra", nilai: [150000, 300000, 450000, 300000] },
  { nama: "Margin PADMA", nilai: [250000, 500000, 750000, 600000] },
];

describe("GrafikGaris", () => {
  function garis(tambahan: Record<string, unknown> = {}) {
    return renderToStaticMarkup(
      createElement(GrafikGaris, {
        judul: "Pendapatan, honor, dan margin",
        label: LABEL_PEKAN,
        seri: SERI_UJI,
        format: (n: number) => `Rp ${n.toLocaleString("id-ID")}`,
        ...tambahan,
      } as never),
    );
  }

  it("satu jalur per seri", () => {
    expect([...garis().matchAll(/data-seri="/g)]).toHaveLength(SERI_UJI.length);
  });

  it("pita sorot menyusun ubin plot area tanpa tumpang-tindih maupun meluber ke padding", () => {
    // Diperiksa dari markup yang benar-benar dirender (bukan dihitung ulang
    // secara terpisah): pita yang lebih lebar daripada slotnya mencuri hover
    // milik pekan tetangga persis di dekat batas, dan itu baru kentara kalau
    // ubin yang dirender diperiksa langsung, bukan diasumsikan benar.
    const m = garis();
    const pita = [...m.matchAll(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"[^>]*fill="transparent"/g)].map(
      ([, x, w]) => ({ kiri: Number(x), kanan: Number(x) + Number(w) }),
    );
    expect(pita).toHaveLength(LABEL_PEKAN.length);
    expect(pita[0].kiri).toBeGreaterThanOrEqual(GEOM.pad.kiri);
    expect(pita[pita.length - 1].kanan).toBeLessThanOrEqual(GEOM.lebar - GEOM.pad.kanan);
    for (let i = 0; i < pita.length - 1; i++) {
      expect(pita[i].kanan).toBeCloseTo(pita[i + 1].kiri, 5);
    }
  });

  it("legenda WAJIB ada untuk dua seri atau lebih", () => {
    const m = garis();
    // Dicocokkan pada isi <ul> itu sendiri — nama seri juga muncul sebagai
    // label langsung dan di tabel, jadi memeriksa `m` utuh akan tetap hijau
    // sekalipun <ul>-nya kosong.
    const legenda = m.match(/<ul[^>]*aria-label="[^"]*"[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(legenda).toMatch(/aria-label="[^"]*"/);
    for (const s of SERI_UJI) expect(legenda).toContain(s.nama);
  });

  it("identitas seri tidak pernah warna semata: tiap seri juga berlabel langsung", () => {
    expect([...garis().matchAll(/data-label-seri="/g)]).toHaveLength(SERI_UJI.length);
  });

  it("memakai ketiga slot palet tervalidasi, SESUAI urutannya", () => {
    const m = garis();
    const tag = (nama: string) =>
      (m.match(/<polyline[^>]*>/g) ?? []).find((t) => t.includes(`data-seri="${nama}"`));
    // Urutan slot ikut divalidasi — validator memeriksa pasangan yang
    // BERSEBELAHAN, jadi menukar dua seri mengubah pasangan yang diperiksa
    // dan bisa menjatuhkan pemisahan CVD-nya tanpa satu pun error.
    SERI_UJI.forEach((s, i) => {
      expect(tag(s.nama), s.nama).toContain(`stroke="${PALET_GRAFIK[i]}"`);
    });
  });

  it("penanda bertumpuk diberi cincin permukaan supaya tidak menyatu", () => {
    // Dua titik yang bertumpuk tanpa cincin terbaca sebagai satu titik, dan
    // dua seri yang berpotongan menjadi satu garis putus.
    expect(garis()).toContain(WARNA_PERMUKAAN);
  });

  it("satu sumbu saja — tiga seri berbagi skala yang sama", () => {
    // Dua sumbu Y adalah kesalahan grafik nomor satu: ia bisa membuat dua
    // seri apa pun terlihat berkorelasi.
    const sumber = baca("src/app/_shell/panel/grafik-garis.tsx");
    expect([...sumber.matchAll(/batasAtas\(/g)]).toHaveLength(1);
  });

  it("punya padanan tabel berisi seluruh seri", () => {
    const m = garis();
    expect(m).toContain("<table");
    // Dicocokkan pada isi <table> itu sendiri — dengan data uji ini nilai
    // maksimum juga muncul sebagai label kisi sumbu Y, jadi memeriksa `m`
    // utuh akan tetap hijau sekalipun tabelnya tidak memuat nilai tersebut.
    const tabel = m.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
    expect(tabel).toContain("Rp 1.200.000");
  });

  it("svg menamai dirinya untuk pembaca layar", () => {
    expect(garis()).toMatch(/<svg[^>]*role="img"/);
  });

  it("tidak mengimpor pemformat rupiah — formatnya selalu datang dari prop", () => {
    const sumber = baca("src/app/_shell/panel/grafik-garis.tsx");
    expect(sumber).not.toContain("formatRupiah");
    expect(sumber).not.toMatch(/Rp\s?\d/);
  });

  describe("keadaan kosong — seluruh seri bernilai nol", () => {
    // Ini persis keadaan data klinik yang sesungguhnya sekarang: pekan tanpa
    // satu pun sesi selesai. Menggambar grafik biasa di sini bukan cuma
    // kosong secara visual — label ujung KETIGA seri jatuh di titik yang
    // sama persis dan bertumpuk jadi coretan tak terbaca, dan sumbu Y
    // menampilkan "Rp 4 / Rp 3 / Rp 2 / Rp 1 / Rp 0" karena lantai
    // `batasAtas([])` berbentuk hitungan, bukan rupiah.
    const SERI_NOL = [
      { nama: "Harga klien", nilai: [0, 0, 0, 0] },
      { nama: "Honor mitra", nilai: [0, 0, 0, 0] },
      { nama: "Margin PADMA", nilai: [0, 0, 0, 0] },
    ];

    function garisNol() {
      return renderToStaticMarkup(
        createElement(GrafikGaris, {
          judul: "Pendapatan, honor, dan margin",
          label: LABEL_PEKAN,
          seri: SERI_NOL,
          format: (n: number) => `Rp ${n.toLocaleString("id-ID")}`,
        } as never),
      );
    }

    it("merender kalimat keadaan kosong, bukan sumbu atau label yang mengada-ada", () => {
      const m = garisNol();
      expect(m).toContain("Belum ada data delapan pekan terakhir.");
      expect(m).not.toContain("<polyline");
      // Tidak ada legenda: tidak ada garis untuk diidentifikasi warnanya.
      expect(m).not.toContain("<ul");
    });

    it("padanan tabel tetap ada, apa adanya, di keadaan kosong", () => {
      const m = garisNol();
      expect(m).toContain("Lihat sebagai tabel");
      const tabel = m.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
      expect(tabel).not.toBe("");
      for (const t of LABEL_PEKAN) expect(tabel).toContain(t);
      for (const s of SERI_NOL) expect(tabel).toContain(s.nama);
    });
  });
});
