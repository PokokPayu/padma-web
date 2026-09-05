/**
 * Primitif kerangka panel staf (`src/app/_shell/panel/**`) dan token visualnya.
 *
 * Berkas ini tidak menyentuh basis data sama sekali: ia membaca sumber dan
 * merender komponen. Yang dijaga adalah tiga hal yang hilang tanpa error:
 *
 *  1. Token PADMA lama tidak boleh ikut terhapus saat token panel lahir —
 *     landing, skrining, dan /passport masih memakainya, dan hilangnya baru
 *     terlihat sebagai halaman klien yang berubah warna.
 *  2. Primitif panel wajib BUTA PERAN. Begitu satu berkas di sana tahu
 *     bedanya admin dan owner, pemisahan fisik money firewall berubah menjadi
 *     satu kondisional yang bisa salah tulis.
 *  3. Badge antrean hilang saat nol — alarm yang dinormalkan berhenti berarti.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// usePathname hanya hidup di dalam App Router. `vi.mock` diangkat ke atas
// berkas oleh Vitest, jadi letaknya di sini tetap berlaku untuk seluruh
// `await import(...)` di atasnya.
const rute = vi.hoisted(() => ({ kini: "/uji" }));
vi.mock("next/navigation", () => ({
  usePathname: () => rute.kini,
}));

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

/** Semua berkas .ts/.tsx di bawah src/app/_shell/panel, rekursif — house idiom
 *  yang sama dengan `berkasAdmin()` di tests/admin-shell.test.ts. Primitif
 *  yang lahir belakangan otomatis ikut terjaga, tanpa perlu menambahkannya
 *  dengan tangan ke daftar test di sini. */
function berkasPanel(rel = "src/app/_shell/panel"): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(path.join(AKAR, rel), { withFileTypes: true })) {
    const anak = `${rel}/${entri.name}`;
    if (entri.isDirectory()) hasil.push(...berkasPanel(anak));
    else if (/\.tsx?$/.test(entri.name)) hasil.push(anak);
  }
  return hasil;
}

describe("token visual panel", () => {
  const css = baca("src/app/globals.css");

  it("token panel lahir di @theme", () => {
    for (const token of [
      "--color-panel-bg",
      "--color-panel-surface",
      "--color-panel-border",
      "--color-panel-ink",
      "--color-panel-muted",
      "--color-panel-rail",
      "--color-panel-rail-ink",
      "--color-panel-rail-aktif",
    ]) {
      expect(css, `${token} tidak ada`).toContain(token);
    }
  });

  it("token PADMA lama TETAP ada (landing, skrining & /passport memakainya)", () => {
    for (const token of [
      "--color-paper",
      "--color-paper-warm",
      "--color-night",
      "--color-pine",
      "--color-leaf",
      "--color-leaf-soft",
      "--color-gold",
      "--color-gold-bright",
      "--color-gold-pale",
      "--color-ink",
      "--color-ink-soft",
      "--color-clay",
    ]) {
      // Bukan sekadar toContain(token): nama-nama ini juga muncul di komentar
      // (beberapa ditambahkan branch ini sendiri) dan di aturan `body`, jadi
      // menghapus deklarasi `--color-paper: #fbf8f0;` dari @theme akan tetap
      // lolos toContain — persis regresi yang ingin dicegah test ini. Yang
      // diwajibkan adalah DEKLARASI sungguhan: nama token diikuti `:` lalu `#`.
      expect(css, `${token} ikut terhapus`).toMatch(new RegExp(`${token}:\\s*#`));
    }
  });

  it("latar panel BUKAN krem paper — ruang kerja dan halaman klien memang beda", () => {
    expect(css).toMatch(/--color-panel-bg:\s*#f5f6f4/i);
    expect(css).not.toMatch(/--color-panel-bg:\s*var\(--color-paper\)/);
  });
});

const { Ikon, NAMA_IKON } = await import("@/app/_shell/panel/ikon");

describe("peta ikon panel", () => {
  it("setiap nama ikon menghasilkan SVG", () => {
    for (const nama of NAMA_IKON) {
      const m = renderToStaticMarkup(createElement(Ikon, { nama }));
      expect(m, `ikon "${nama}" tidak merender svg`).toContain("<svg");
      // Ikon adalah bentuk, bukan informasi: labelnya hidup di teks tautan.
      expect(m, `ikon "${nama}" tidak aria-hidden`).toContain('aria-hidden="true"');
    }
  });

  it("teratai dipakai ulang dari komponen bersama, path-nya tidak disalin", () => {
    const sumber = baca("src/app/_shell/panel/ikon.tsx");
    expect(sumber).toMatch(/from\s+["']@\/app\/_landing\/lotus["']/);
    // Potongan path teratai milik komponen bersama; kemunculannya di sini
    // berarti path-nya disalin, dan dua salinan akan berpisah diam-diam.
    expect(sumber).not.toContain("M32 6 C37.5 13");
  });
});

const { aktifkan } = await import("@/app/_shell/panel/aktif");
const { Badge } = await import("@/app/_shell/panel/badge");
const { Sidebar } = await import("@/app/_shell/panel/sidebar");

const MENU_UJI = [
  { href: "/uji", label: "Beranda", ikon: "lotus" as const },
  { href: "/uji/kotak", label: "Kotak", ikon: "inbox" as const, jumlah: 3 },
  { href: "/uji/orang", label: "Orang", ikon: "user" as const, jumlah: 0 },
];

function markupSidebar(pathname: string, tambahan: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(Sidebar, {
      menu: MENU_UJI,
      akar: "/uji",
      pathname,
      namaPanel: "Panel Uji",
      labelNav: "Menu panel uji",
      terbuka: false,
      ...tambahan,
    } as never),
  );
}

describe("aktifkan — penanda tujuan aktif", () => {
  it("akar hanya menyala pada kecocokan PERSIS", () => {
    expect(aktifkan("/uji", "/uji", "/uji")).toBe(true);
    // Tanpa perlakuan khusus, startsWith membuat akar menyala di SEMUA sub-rute
    // — "semua tab menyala" adalah bug yang paling gampang lolos.
    expect(aktifkan("/uji/kotak", "/uji", "/uji")).toBe(false);
  });

  it("sub-rute menyalakan tujuan induknya", () => {
    expect(aktifkan("/uji/kotak", "/uji/kotak", "/uji")).toBe(true);
    expect(aktifkan("/uji/kotak/123", "/uji/kotak", "/uji")).toBe(true);
  });

  it("kecocokan segmen, bukan awalan string", () => {
    // "/uji/kotakan" TIDAK boleh menyalakan "/uji/kotak".
    expect(aktifkan("/uji/kotakan", "/uji/kotak", "/uji")).toBe(false);
  });
});

describe("Badge antrean", () => {
  it("HILANG saat nol — alarm yang dinormalkan berhenti berarti", () => {
    expect(renderToStaticMarkup(createElement(Badge, { jumlah: 0 }))).toBe("");
    expect(renderToStaticMarkup(createElement(Badge, { jumlah: -2 }))).toBe("");
  });

  it("menyebut jumlahnya untuk pembaca layar", () => {
    const m = renderToStaticMarkup(createElement(Badge, { jumlah: 4 }));
    expect(m).toContain('aria-label="4 menunggu"');
    expect(m).toContain(">4<");
  });
});

describe("Sidebar", () => {
  it("client component (butuh Link & kelas interaktif)", () => {
    const sumber = baca("src/app/_shell/panel/sidebar.tsx");
    expect(sumber.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("merender SATU nav berlabel, berisi satu tautan per tujuan", () => {
    const m = markupSidebar("/uji");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(1);
    expect(m).toContain('aria-label="Menu panel uji"');
    expect([...m.matchAll(/<a\b/g)]).toHaveLength(MENU_UJI.length);
    for (const item of MENU_UJI) {
      expect(m).toContain(`href="${item.href}"`);
      expect(m).toContain(item.label);
    }
  });

  it("hanya SATU tujuan aktif, dan bukan akar saat berada di sub-rute", () => {
    const m = markupSidebar("/uji/kotak");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/uji"') && !tag.includes("/uji/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("badge muncul hanya untuk tujuan yang punya antrean", () => {
    const m = markupSidebar("/uji");
    expect([...m.matchAll(/aria-label="\d+ menunggu"/g)]).toHaveLength(1);
    expect(m).toContain('aria-label="3 menunggu"');
  });

  it("tergeser keluar layar saat tertutup, dan masuk saat terbuka", () => {
    // Sidebar dirender SEKALI lalu digeser — bukan dirender dua kali untuk
    // desktop dan drawer. Dua salinan berarti tautan ganda dan fokus yang
    // bisa mendarat di elemen tak terlihat.
    expect(markupSidebar("/uji")).toContain("-translate-x-full");
    expect(markupSidebar("/uji", { terbuka: true })).not.toContain("-translate-x-full");
    expect(markupSidebar("/uji")).toContain("lg:translate-x-0");
  });

  it("jalan keluar bukan tujuan: tidak pernah ber-aria-current", () => {
    const keluar = { href: "/luar", label: "Buka Panel Lain", ikon: "keluar" as const };
    for (const p of ["/uji", "/uji/kotak", "/uji/orang"]) {
      const m = markupSidebar(p, { jalanKeluar: keluar });
      expect(m).toContain('href="/luar"');
      for (const tag of m.match(/<a[^>]*>/g) ?? []) {
        if (tag.includes('href="/luar"')) {
          expect(tag).not.toContain('aria-current="page"');
        }
      }
    }
  });
});

const { Topbar } = await import("@/app/_shell/panel/topbar");

function markupTopbar(tambahan: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(Topbar, {
      judul: "Klien",
      nama: "Admin PADMA",
      peran: "Admin",
      drawerBuka: false,
      onToggleDrawer: () => {},
      ...tambahan,
    } as never),
  );
}

/** Tag pembuka tombol drawer saja — MenuAkun ikut memancarkan
 *  aria-expanded, jadi memeriksa seluruh markup akan lolos tanpa syarat. */
function tagTombolDrawer(m: string): string {
  const tag = (m.match(/<button[^>]*>/g) ?? []).find((t) =>
    t.includes('aria-controls="sidebar-panel"'),
  );
  if (!tag) throw new Error("tombol drawer tidak ditemukan");
  return tag;
}

describe("Topbar", () => {
  it("membawa identitas & jalan keluar lewat MenuAkun yang sudah ada", () => {
    const m = markupTopbar();
    // Frasa utuhnya hidup sebagai nama aksesibel tombol MenuAkun.
    expect(m).toContain("Masuk sebagai Admin PADMA · Admin");
    const sumber = baca("src/app/_shell/panel/topbar.tsx");
    expect(sumber).toMatch(/from\s+["']@\/app\/_shell\/menu-akun["']/);
    // Jalan keluar tidak boleh ditulis ulang di sini: logout WAJIB tetap
    // <form method="post"> supaya Client Cache pemakai sebelumnya terhapus.
    expect(sumber).not.toContain("/auth/keluar");
  });

  it("tombol drawer mengumumkan apa yang ia kendalikan dan keadaannya", () => {
    const tutup = markupTopbar();
    const tagTutup = tagTombolDrawer(tutup);
    expect(tagTutup).toContain('aria-controls="sidebar-panel"');
    expect(tagTutup).toContain('aria-expanded="false"');
    expect(tagTutup).toContain('aria-label="Buka menu"');
    const buka = markupTopbar({ drawerBuka: true });
    const tagBuka = tagTombolDrawer(buka);
    expect(tagBuka).toContain('aria-expanded="true"');
    expect(tagBuka).toContain('aria-label="Tutup menu"');
  });

  it("tombol drawer hanya untuk layar kecil", () => {
    expect(tagTombolDrawer(markupTopbar())).toContain("lg:hidden");
  });

  it("menyebut tujuan yang sedang dibuka — di layar kecil sidebar tidak terlihat", () => {
    expect(markupTopbar({ judul: "Pembayaran" })).toContain("Pembayaran");
  });

  it("BUKAN <h1>: judul halaman milik halaman, bukan milik kerangka", () => {
    // Setiap halaman panel sudah merender <main><h1> sendiri. <h1> kedua di
    // kerangka membuat dua judul tingkat satu di setiap halaman.
    expect(markupTopbar()).not.toContain("<h1");
  });
});

const { BottomBar } = await import("@/app/_shell/panel/bottom-bar");

function markupBottomBar(pathname: string, tambahan: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(BottomBar, {
      menu: MENU_UJI,
      akar: "/uji",
      pathname,
      labelNav: "Navigasi panel uji",
      ...tambahan,
    } as never),
  );
}

describe("BottomBar", () => {
  it("satu nav berlabel, hanya untuk layar kecil", () => {
    const m = markupBottomBar("/uji");
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(1);
    expect(m).toContain('aria-label="Navigasi panel uji"');
    expect(m).toContain("lg:hidden");
  });

  it("memakai penanda aktif yang sama dengan sidebar", () => {
    const m = markupBottomBar("/uji/kotak");
    expect([...m.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/uji"') && !tag.includes("/uji/")) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });

  it("badge ikut tampil di sini — antrean tidak boleh hanya terlihat di desktop", () => {
    const m = markupBottomBar("/uji");
    expect(m).toContain('aria-label="3 menunggu"');
    expect([...m.matchAll(/aria-label="\d+ menunggu"/g)]).toHaveLength(1);
  });

  it("jalan keluar ikut tersedia dan tetap bukan tujuan aktif", () => {
    const keluar = { href: "/luar", label: "Buka Panel Lain", ikon: "keluar" as const };
    const m = markupBottomBar("/uji", { jalanKeluar: keluar });
    expect(m).toContain('href="/luar"');
    for (const tag of m.match(/<a[^>]*>/g) ?? []) {
      if (tag.includes('href="/luar"')) {
        expect(tag).not.toContain('aria-current="page"');
      }
    }
  });
});

const { pasangPenutup } = await import("@/app/_shell/panel/tutup-drawer");
const { KerangkaPanel } = await import("@/app/_shell/panel/kerangka");

/** Dokumen palsu: mencatat listener yang dipasang & dilepas — termasuk
 *  REFERENSI fungsinya sendiri, supaya tes pembersihan bisa membuktikan
 *  bahwa yang dilepas adalah fungsi yang sama persis dengan yang dipasang,
 *  bukan sekadar "sesuatu" untuk jenis "keydown". */
function dokumenPalsu() {
  const listener = new Map<string, (e: Event) => void>();
  const dilepas: string[] = [];
  const dilepasFn = new Map<string, (e: Event) => void>();
  return {
    listener,
    dilepas,
    dilepasFn,
    addEventListener: (jenis: string, fn: (e: Event) => void) => {
      listener.set(jenis, fn);
    },
    removeEventListener: (jenis: string, fn: (e: Event) => void) => {
      dilepas.push(jenis);
      dilepasFn.set(jenis, fn);
    },
  };
}

describe("pasangPenutup — perilaku drawer", () => {
  it("Escape menutup drawer", () => {
    const dok = dokumenPalsu();
    let tertutup = 0;
    pasangPenutup(dok, () => (tertutup += 1));
    dok.listener.get("keydown")?.({ key: "Escape" } as unknown as Event);
    expect(tertutup).toBe(1);
  });

  it("tombol lain tidak menutup apa pun", () => {
    const dok = dokumenPalsu();
    let tertutup = 0;
    pasangPenutup(dok, () => (tertutup += 1));
    dok.listener.get("keydown")?.({ key: "a" } as unknown as Event);
    dok.listener.get("keydown")?.({ key: "Enter" } as unknown as Event);
    expect(tertutup).toBe(0);
  });

  it("melepas listener-nya saat dibersihkan — drawer bisa dibuka-tutup berkali-kali", () => {
    const dok = dokumenPalsu();
    const lepas = pasangPenutup(dok, () => {});
    const terpasang = dok.listener.get("keydown");
    lepas();
    expect(dok.dilepas).toContain("keydown");
    // Bukan sekadar "sesuatu dilepas" — REFERENSI fungsinya harus identik
    // dengan yang dipasang. Cleanup yang membuat closure baru (kebocoran
    // nyata di DOM sungguhan) akan lolos tanpa asersi ini.
    expect(dok.dilepasFn.get("keydown")).toBe(terpasang);
  });
});

describe("KerangkaPanel", () => {
  const sumber = baca("src/app/_shell/panel/kerangka.tsx");

  function markupKerangka(pathname: string, tambahan: Record<string, unknown> = {}) {
    rute.kini = pathname;
    return renderToStaticMarkup(
      createElement(KerangkaPanel, {
        menu: MENU_UJI,
        menuRingkas: MENU_UJI.slice(1),
        akar: "/uji",
        namaPanel: "Panel Uji",
        labelSidebar: "Menu panel uji",
        labelBottomBar: "Navigasi panel uji",
        nama: "Pemakai Uji",
        peran: "Uji",
        catatan: "CATATAN-UJI",
        children: createElement("p", null, "ISI-UJI"),
        ...tambahan,
      } as never),
    );
  }

  /** Isi <header> saja — sidebar ikut merender setiap label menu dan nama
   *  panel, jadi memeriksa seluruh markup akan lolos tanpa syarat. */
  function isiTopbar(m: string): string {
    const cocok = m.match(/<header[\s\S]*?<\/header>/);
    if (!cocok) throw new Error("topbar tidak ditemukan");
    return cocok[0];
  }

  it("merender isi halaman, sidebar, bottom bar, dan catatan kaki", () => {
    const m = markupKerangka("/uji");
    expect(m).toContain("ISI-UJI");
    expect(m).toContain("CATATAN-UJI");
    // Tepat dua nav: sidebar (yang sekaligus jadi drawer) + bottom bar.
    expect([...m.matchAll(/<nav\b/g)]).toHaveLength(2);
  });

  it("judul topbar mengikuti tujuan yang sedang dibuka", () => {
    expect(isiTopbar(markupKerangka("/uji/kotak"))).toContain("Kotak");
    // Di luar seluruh tujuan, jatuh kembali ke nama panel — bukan string
    // kosong, dan bukan label tujuan mana pun.
    const luar = isiTopbar(markupKerangka("/uji/entah"));
    expect(luar).toContain("Panel Uji");
    expect(luar).not.toContain("Kotak");
  });

  it("drawer tertutup saat rute berganti", () => {
    // Tanpa ini, mengetuk satu tujuan meninggalkan panel gelap menutupi
    // halaman yang baru saja dibuka. Dikunci lewat sumber: repo ini berjalan
    // tanpa jsdom, jadi klik sungguhan tidak bisa disimulasikan.
    //
    // Bentuknya bukan lagi useEffect(() => setBuka(false), [pathname]):
    // react-hooks/set-state-in-effect menandai setState sinkron di dalam efek
    // sebagai pemicu render berantai, jadi ia diganti pola "menyesuaikan state
    // ketika prop berubah" React sendiri — dibandingkan dan disetel langsung
    // di badan render. Maksudnya sama persis: setBuka(false) tetap berjalan
    // begitu pathname berbeda dari render sebelumnya.
    expect(sumber).toMatch(
      /if\s*\(\s*pathname\s*!==\s*pathnameSebelumnya\s*\)\s*\{\s*setPathnameSebelumnya\(pathname\);\s*setBuka\(false\);\s*\}/,
    );
  });

  it("BUTA PERAN: primitif panel tidak tahu bedanya admin dan owner", () => {
    // Begitu satu berkas di sini tahu peran, pemisahan fisik money firewall
    // berubah menjadi satu kondisional yang bisa salah tulis dalam satu
    // karakter — dan yang bocor adalah seluruh nominal PADMA.
    for (const berkas of berkasPanel()) {
      const isi = baca(berkas);
      // Flag `i`: kedua shell meneruskan "Admin"/"Owner" (huruf besar di
      // depan) sebagai prop `peran`, bukan "admin"/"owner". Tanpa `i`, sebuah
      // primitif yang menuliskan `const peran = "Owner"` lolos tanpa terdeteksi.
      expect(isi, `${berkas} menyebut peran`).not.toMatch(/"(admin|owner)"/i);
      expect(isi, `${berkas} mengimpor penjaga peran`).not.toContain("requireRole");
      expect(isi, `${berkas} memakai service role`).not.toContain("createAdminSupabase");
      expect(isi, `${berkas} menyebut nominal`).not.toMatch(/Rp\s?\d|formatRupiah/);
    }
  });
});
