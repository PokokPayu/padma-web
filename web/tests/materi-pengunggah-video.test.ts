// tests/materi-pengunggah-video.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const AKAR = path.resolve(__dirname, "..");
const baca = (rel: string) => readFileSync(path.join(AKAR, rel), "utf8");
const s = baca("src/app/admin/materi/pengunggah-video.tsx");

describe("pengunggah video — pagar struktural", () => {
  it("komponen pengunggah adalah client component", () => {
    expect(s.trimStart()).toMatch(/^"use client"/);
  });

  it("unggahan lewat XMLHttpRequest, BUKAN fetch — hanya XHR yang memberi progres", () => {
    // "toContain" nama kelasnya saja TIDAK CUKUP: mengimpornya tanpa dipakai
    // tetap lolos. Yang dijaga adalah dipakainya XHR SUNGGUHAN untuk
    // mengunggah (event progres upload-nya sendiri, bukan sekadar disebut).
    expect(s).toContain("new XMLHttpRequest()");
    expect(s).toMatch(/xhr\.upload\.onprogress\s*=/);
    expect(s).toMatch(/xhr\.send\(\s*berkas\s*\)/);

    // Menukar XHR dengan fetch() TIDAK menghasilkan satu pun galat pada
    // berkas kecil — fetch juga bisa PUT — tapi bilah progres pada berkas
    // 200 MB diam-diam hilang, sebab fetch() tidak punya event progres
    // upload. Berkas ini karena itu TIDAK BOLEH memanggil fetch() sama
    // sekali: satu-satunya jalur jaringan untuk PUT unggahan adalah XHR.
    expect(s).not.toMatch(/\bfetch\(/);
  });

  it("berkas yang gagal DIPERTAHANKAN — mengulang cukup satu klik, bukan pilih ulang", () => {
    expect(s).toContain("useRef<File | null>(null)");
    // Disimpan di AWAL jalannya unggahan (sebelum satu pun validasi/jaringan),
    // supaya kegagalan pada tahap manapun tetap menyisakan berkasnya.
    expect(s).toMatch(/berkasRef\.current\s*=\s*berkas/);

    // Tombol "Coba lagi" hanya muncul ketika ada berkas tersimpan, DAN
    // memanggil ULANG jalannya unggahan memakai berkas yang sama — bukan
    // sekadar tombol dekoratif. "toContain" saja tidak cukup (dibuktikan
    // lewat mutasi): nama fungsi "jalankan" tetap muncul lewat definisinya
    // sendiri walau tombolnya tidak pernah memanggilnya. Dihitung: SATU
    // pemanggilan dari <input onChange>, SATU lagi dari tombol "Coba lagi" —
    // menghapus salah satunya membuat baris ini merah.
    const pemanggilJalankan = [...s.matchAll(/void jalankan\(/g)].length;
    expect(pemanggilJalankan).toBe(2);

    // Kelayakan tombol dilacak lewat STATE (`adaBerkas`), BUKAN dengan
    // membaca `berkasRef.current` saat render (itu persis error
    // `react-hooks/refs`: ref hanya boleh dibaca dari event handler/effect,
    // bukan selama render). `useState(false)` cocok dengan `berkasRef.current`
    // yang mulai `null` — keduanya "belum ada berkas" di keadaan awal.
    expect(s).toContain("const [adaBerkas, setAdaBerkas] = useState(false)");
    expect(s).toMatch(/setAdaBerkas\(true\)/);
    expect(s).toMatch(/\{adaBerkas &&/);

    // `.current` HANYA BOLEH muncul di DUA tempat: disimpan
    // (`berkasRef.current = berkas`, dalam fungsi, bukan render) dan dibaca
    // ulang di dalam `onClick` tombol "Coba lagi" (event handler, bukan
    // render). Regex ini menghitung SEMUA kemunculan `.current` — bila
    // render kembali membacanya langsung (mis. `{berkasRef.current !== null
    // && ...}`), jumlahnya naik jadi 3 dan baris ini memerah.
    const pemakaianCurrent = [...s.matchAll(/berkasRef\.current/g)].length;
    expect(pemakaianCurrent).toBe(2);
    expect(s).toMatch(/const b = berkasRef\.current;\s*\n\s*if \(b\) void jalankan\(b\);/);
  });

  it("onSelesai dipanggil sesudah catatVideoMateri sukses — bukan sebelum", () => {
    // Tanpa ini, panel induk (`IsiVideo` di form-materi.tsx) tidak tahu kapan
    // harus router.refresh(): statusnya sendiri ("Belum ada video…") tetap
    // stale sementara komponen ini sudah menampilkan "Video tersimpan.",
    // sampai admin berpindah halaman. Pola sama dengan `PengunggahPdf`
    // (`onSelesai?: () => void`, dipanggil sesudah unggahan sukses).
    expect(s).toMatch(/onSelesai\?:\s*\(\)\s*=>\s*void/);
    const posCatat = s.search(/const catat = await catatVideoMateri\(/);
    const posOnSelesai = s.indexOf("onSelesai?.();", posCatat);
    expect(posCatat).toBeGreaterThan(-1);
    expect(posOnSelesai).toBeGreaterThan(posCatat);

    // Dan TIDAK dipanggil pada cabang gagal: antara `catatVideoMateri` dan
    // `onSelesai?.()`, satu-satunya `return` yang boleh ada adalah yang
    // berpasangan dengan `!catat.ok` (jalur gagal keluar duluan, tidak
    // pernah sampai ke `onSelesai?.()`).
    const antaraCatatDanSelesai = s.slice(posCatat, posOnSelesai);
    const jumlahReturn = [...antaraCatatDanSelesai.matchAll(/\breturn;/g)].length;
    expect(jumlahReturn).toBe(1);
  });

  it("moovDiDepan(...) === false MEMPERINGATKAN, TIDAK memblokir unggahan", () => {
    // Perbandingan wajib PERSIS `=== false`. `!moovDiDepan(...)` juga akan
    // bernilai true untuk `null` ("tidak tahu") — dan memperingatkan atas
    // ketidaktahuan kita sendiri adalah cara cepat membuat peringatan
    // diabaikan (lihat komentar di moov.ts).
    expect(s).toContain("moovDiDepan(kepala) === false");
    expect(s).not.toMatch(/!moovDiDepan\(/);

    // Cabang itu TIDAK BOLEH menghentikan unggahan: dari titik pemeriksaan
    // sampai unggahan sungguhan dimulai (`setKeadaan({ fase: "unggah"`),
    // tidak boleh ada satu pun `return` yang bisa dituju SEBELUM peringatan
    // itu ditulis (mis. lewat pemindahan urutan atau `if (...) { return; }`).
    const posIf = s.search(/if \(moovDiDepan\(kepala\) === false\)/);
    const posLanjutUnggah = s.indexOf('setKeadaan({ fase: "unggah"', posIf);
    expect(posIf).toBeGreaterThan(-1);
    expect(posLanjutUnggah).toBeGreaterThan(posIf);
    const antara = s.slice(posIf, posLanjutUnggah);
    expect(antara).not.toMatch(/\breturn;/);
  });

  it("batas ukuran berasal dari MAKS_BYTE_VIDEO, bukan angka yang ditulis ulang", () => {
    expect(s).toMatch(
      /import\s*\{[^}]*MAKS_BYTE_VIDEO[^}]*\}\s*from\s*["']@\/lib\/materi\/video["']/,
    );
    expect(s).toMatch(/Math\.round\(\s*MAKS_BYTE_VIDEO\s*\/\s*\(1024 \* 1024\)\s*\)/);
    // Tidak menulis ulang angka 200 MB dalam bentuk apa pun — satu-satunya
    // sumber batasnya adalah konstanta yang diimpor.
    expect(s).not.toMatch(/200\s*\*\s*1024\s*\*\s*1024/);

    // Dan batasnya diperiksa SEBELUM unggahan dimulai (pola yang sama dengan
    // pengunggah-pdf.tsx): periksaBerkasVideo() mendahului
    // terbitkanUrlUnggahVideo() dalam urutan panggilan sungguhan.
    const posPeriksa = s.search(/periksaBerkasVideo\(\s*berkas\.type/);
    const posTerbitkan = s.search(/terbitkanUrlUnggahVideo\(\s*\n?\s*materiId/);
    expect(posPeriksa).toBeGreaterThan(-1);
    expect(posTerbitkan).toBeGreaterThan(-1);
    expect(posPeriksa).toBeLessThan(posTerbitkan);
  });
});
