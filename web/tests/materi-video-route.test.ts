import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ROUTE = readFileSync("src/app/api/materi/[id]/video/route.ts", "utf8");
const PEMUTAR = readFileSync(
  "src/app/passport/materi/[id]/pemutar-video.tsx", "utf8",
);

describe("route penerbit URL tonton", () => {
  it("berjalan di runtime Node, bukan Edge", () => {
    expect(ROUTE).toContain('export const runtime = "nodejs"');
  });

  it("memeriksa hak lewat sesi pengguna, BUKAN service role", () => {
    // Presigned URL menembus segala pagar begitu terbit; RLS-lah hakimnya.
    expect(ROUTE).toContain("createServerSupabase");
    expect(ROUTE).not.toContain("createAdminSupabase");
  });

  it("menerbitkan URL SESUDAH query hak, bukan sebelumnya", () => {
    const iQuery = ROUTE.indexOf("material_videos");
    const iTerbit = ROUTE.indexOf("urlTontonVideo");
    expect(iQuery).toBeGreaterThan(-1);
    expect(iTerbit).toBeGreaterThan(iQuery);
  });

  it("mencetak nama & pesan galat kegagalan presigned GET, TAPI tidak pernah URL-nya", () => {
    // Sebelum fix F3 (video-r2 fix wave), catch-nya kosong TANPA log sama
    // sekali — kegagalan produksi pertama (CORS bucket belum memuat domain
    // produksi, spec §13b A-5, atau secret R2 salah) diam total: pasien
    // melihat "Gagal menyiapkan video.", log server kosong. Sekarang HARUS
    // ada log, tapi asersinya tidak boleh melarang console.* SELURUHNYA
    // (itu justru menolak fix-nya) — yang dilarang hanyalah mencetak URL
    // presigned itu SENDIRI, sebab itu tautan unduhan videonya.
    expect(ROUTE).toMatch(/console\.(log|error|warn)/);
    expect(ROUTE).not.toMatch(/console\.(log|error|warn)\s*\([^)]*\burl\b/i);
  });

  it("melarang cache pada jawabannya", () => {
    // Jawaban ini memuat tautan unduhan milik SATU pasien; ter-cache berarti
    // tersaji ke pasien lain.
    expect(ROUTE).toMatch(/no-store/);
  });
});

describe("pemutar pasien", () => {
  it("elemen <video> dirender TANPA atribut src", () => {
    // URL dipasang lewat PROPERTI sesudah halaman hidup, sehingga ia tidak
    // pernah muncul di view-source (Ctrl+U) maupun di RSC payload — klaim ini
    // SENGAJA dibatasi (spec §7): `src` adalah atribut IDL yang MEREFLEKSI,
    // jadi menugaskan `video.src = url` menulis balik ke atribut DOM-nya dan
    // URL-nya TETAP terlihat di panel Elements DevTools begitu elemennya
    // diinspeksi. Klaim "tidak pernah muncul di panel Elements" itu SALAH
    // dan sempat tertulis di sini sebelum dikoreksi — properti tidak menutup
    // jalur itu, ia hanya menutup view-source & RSC payload.
    expect(PEMUTAR).not.toMatch(/<video[^>]*\ssrc=/);
    expect(PEMUTAR).toMatch(/\.src\s*=/);
  });

  it("memasang pengerasan pemutar yang disebut spec §7", () => {
    expect(PEMUTAR).toContain('controlsList="nodownload"');
    expect(PEMUTAR).toContain("disablePictureInPicture");
    // Klik-kanan ditutup karena Firefox & Safari mengabaikan controlsList —
    // tanpa ini pertahanan justru bocor tepat di dua peramban itu.
    expect(PEMUTAR).toMatch(/onContextMenu/);
  });
});
