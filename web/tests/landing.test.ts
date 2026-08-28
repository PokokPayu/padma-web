/**
 * Penjagaan landing publik (`/`).
 *
 * Kenapa test ini ada: kegagalan paling mahal di halaman ini BUKAN error, tapi
 * halaman yang tampil KOSONG. `phases`/`services` punya GRANT SELECT untuk anon
 * tetapi policy lamanya `using (auth.uid() is not null)` — pengunjung tanpa
 * login menerima `[]`, bukan 42501. Landing tetap 200, tetap tampak "jalan",
 * dan katalog layanan senyap menghilang. Karena itu test ini merender halaman
 * sungguhan (server component, tanpa sesi apa pun) lalu menuntut isi katalog
 * benar-benar sampai ke markup.
 *
 * Dua lapis, seperti `skrining-wizard.test.ts`:
 *  1. Render sungguhan (`react-dom/server`) — bukti halaman berisi tanpa login.
 *  2. Pembacaan sumber apa adanya — untuk pagar yang tidak terlihat di markup
 *     (nomor WA tidak ditulis keras, katalog tidak di-hardcode, dekorasi yang
 *     meluber wajib terkurung agar tidak lahir scroll horizontal di 390px).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "@/app/page";
import { bacaKatalog } from "@/lib/katalog";
import { bacaPengaturan } from "@/lib/settings";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");

const sumberHalaman = baca("src/app/page.tsx");
const berkasLanding = readdirSync(path.join(AKAR, "src/app/_landing"));
const sumberLanding = Object.fromEntries(
  berkasLanding.map((f) => [f, baca(path.join("src/app/_landing", f))]),
);
const semuaSumberLanding = sumberHalaman + Object.values(sumberLanding).join("\n");

const katalog = await bacaKatalog();
const pengaturan = await bacaPengaturan();
const markup = renderToStaticMarkup(await Home());

// React meng-escape teks (`&` -> `&amp;`), jadi teks DB harus di-escape juga
// sebelum dicari di markup — kalau tidak, "Nifas & Menyusui" tidak akan pernah
// ketemu dan test ini "hijau karena longgar" di kemudian hari.
const esc = (teks: string) =>
  teks.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("landing publik — berisi tanpa login", () => {
  it("halaman tidak dilindungi peran (rute publik)", () => {
    // Dicek sebagai PEMANGGILAN dan sebagai IMPOR — menyebut namanya di
    // komentar tidak menjadikan halaman terkunci, tapi keduanya di bawah ini
    // memang mengunci.
    for (const sumber of [sumberHalaman, semuaSumberLanding]) {
      expect(sumber).not.toMatch(/requireRole\s*\(/);
      expect(sumber).not.toContain("@/lib/auth/require-role");
      expect(sumber).not.toContain("redirect(");
    }
  });

  it("kelima fase katalog tampil beserta nama Sanskerta & label Indonesianya", () => {
    expect(katalog).toHaveLength(5);
    for (const fase of katalog) {
      expect(markup).toContain(esc(fase.namaSanskrit));
      expect(markup).toContain(esc(fase.nama));
    }
    // Shishu/Newborn dibatasi hanya di skrining; di landing ia tetap tampil.
    expect(markup).toContain("Shishu");
  });

  it("setiap layanan aktif dari DB benar-benar sampai ke markup (landing tidak kosong)", () => {
    const semuaLayanan = katalog.flatMap((f) => f.layanan);
    expect(semuaLayanan.length).toBeGreaterThanOrEqual(10);
    for (const nama of semuaLayanan) {
      expect(markup).toContain(esc(nama));
    }
  });

  it("katalog tidak dibekukan permanen di waktu build (ada revalidate)", async () => {
    // Tanpa ini `next build` memprerender `/` sebagai statis penuh: katalog
    // yang diubah admin tidak pernah muncul sampai deploy berikutnya, dan
    // katalog kosong saat build ikut terbekukan.
    const modul = (await import("@/app/page")) as { revalidate?: number };
    expect(typeof modul.revalidate).toBe("number");
    expect(modul.revalidate).toBeGreaterThan(0);
  });

  it("kartu katalog dirender dari DB, bukan ditulis keras di komponennya", () => {
    expect(sumberHalaman).toContain("bacaKatalog");
    // Perender kartu fase tidak boleh memuat satu pun nama fase atau nama
    // layanan sebagai literal: kalau ia menyalinnya, panel admin klien tidak
    // lagi mengubah landing dan katalog kosong pun tetap terlihat "penuh".
    const perenderKartu = sumberLanding["lini-layanan.tsx"];
    expect(perenderKartu).toBeTruthy();
    expect(perenderKartu).toContain("katalog.map");
    for (const fase of katalog) {
      expect(perenderKartu, "menulis keras nama fase").not.toContain(
        fase.namaSanskrit,
      );
      expect(perenderKartu, "menulis keras label fase").not.toContain(
        fase.nama,
      );
      for (const layanan of fase.layanan) {
        expect(perenderKartu, "menulis keras nama layanan").not.toContain(
          layanan,
        );
      }
    }
  });
});

describe("landing publik — jalur konversi", () => {
  it("mengarahkan ke skrining, bukan ke halaman lain", () => {
    expect(markup).toContain('href="/skrining"');
    expect(markup).toContain("Mulai Skrining");
  });

  it("nomor WA dibaca server dari app_settings, tidak ditulis keras", () => {
    expect(sumberHalaman).toContain("bacaPengaturan");
    expect(semuaSumberLanding).not.toMatch(/\b62\d{8,}\b/);
    expect(semuaSumberLanding).not.toMatch(/\b0\d{3}-\d{4}-\d{4}\b/);
  });

  it("satu sumber nomor, dua bentuk: tautan wa.me & tampilan lokal", () => {
    expect(markup).toContain(`https://wa.me/${pengaturan.nomorWaLink}`);
    expect(markup).toContain(pengaturan.nomorWaTampilan);
  });

  it("menyediakan pintu masuk Digital Care Passport", () => {
    expect(markup).toContain('href="/masuk"');
    expect(markup).toContain("Digital Care Passport");
  });
});

describe("landing publik — pagar konten & tata letak", () => {
  it("klaim kepatuhan tetap hanya ACOG & CDC", () => {
    expect(markup).toContain("ACOG");
    expect(markup).toContain("CDC");
    for (const sumberLain of ["NHS", "WHO", "POGI", "Kemenkes"]) {
      expect(semuaSumberLanding).not.toContain(sumberLain);
    }
  });

  it("tidak menjanjikan diagnosis/pengobatan (landing bukan klaim medis)", () => {
    expect(markup).not.toMatch(/diagnosis/i);
    expect(markup).not.toMatch(/menyembuhkan|pengobatan/i);
  });

  it("tidak ada nominal uang di landing (money firewall)", () => {
    expect(markup).not.toMatch(/Rp\s?\d/);
  });

  it("dekorasi yang meluber terkurung overflow-hidden (anti scroll horizontal 390px)", () => {
    // Lotus hero diposisikan absolut di luar kotak (-right-14, w-[420px]).
    // Tanpa pengurung, ia menambah lebar dokumen dan melahirkan scroll
    // horizontal di layar sempit.
    const hero = sumberLanding["hero.tsx"];
    expect(hero).toBeTruthy();
    expect(hero).toMatch(/overflow-hidden/);
    const posisiOverflow = hero.indexOf("overflow-hidden");
    const posisiLotusAbsolut = hero.indexOf("absolute");
    expect(posisiOverflow).toBeLessThan(posisiLotusAbsolut);
  });

  it("tidak memakai lebar viewport penuh yang mengabaikan scrollbar", () => {
    expect(semuaSumberLanding).not.toMatch(/w-screen|100vw/);
  });

  it("tidak menyentuh service role di komponen landing", () => {
    for (const [berkas, sumber] of Object.entries(sumberLanding)) {
      expect(sumber, berkas).not.toContain("createAdminSupabase");
      expect(sumber, berkas).not.toContain("SERVICE_ROLE");
      expect(sumber, berkas).not.toContain("use client");
    }
  });
});
