import { describe, it, expect } from "vitest";
import {
  STATUS_PERMINTAAN,
  STATUS_ANTRE,
  LABEL_PERMINTAAN,
  PERPINDAHAN_PERMINTAAN,
  bolehPindahPermintaan,
  STATUS_SESI,
  LABEL_SESI,
  PERPINDAHAN_SESI,
  bolehPindahSesi,
  type StatusPermintaan,
} from "@/lib/jadwal/status";

describe("daftar status permintaan", () => {
  it("persis enum booking_status sesudah C2 — tidak lebih, tidak kurang", () => {
    expect([...STATUS_PERMINTAAN].sort()).toEqual(
      [
        "dibatalkan_klien",
        "dibatalkan_tenggat",
        "dikonfirmasi",
        "diminta",
        "mencari_mitra",
        "menunggu_bayar",
        "mitra_siap",
        "ditolak",
      ].sort(),
    );
  });

  it("menunggu_bayar SEKARANG ada — C1 sengaja menundanya sampai jalan keluarnya lahir", () => {
    // Uji ini dulu menegaskan yang SEBALIKNYA. C1 menolak membuat nilai enum
    // yang belum dipakai ("keadaan mati yang tidak satu pun kode tahu cara
    // keluar darinya"); C2 membuatnya BERSAMAAN dengan jalan masuk dan dua
    // jalan keluarnya.
    expect(STATUS_PERMINTAAN).toContain("menunggu_bayar" as StatusPermintaan);
    expect(STATUS_PERMINTAAN).toContain("dibatalkan_tenggat" as StatusPermintaan);
  });

  it("antrean = EMPAT keadaan sebelum konfirmasi, termasuk menunggu_bayar", () => {
    // `menunggu_bayar` ikut mengisi kuota: klien masih menunggu jadwalnya
    // terkunci dan bidannya masih tertahan. Mengeluarkannya berarti klien bisa
    // menumpuk tagihan tak terbayar tanpa pernah menabrak batas antrean.
    expect([...STATUS_ANTRE]).toEqual([
      "diminta",
      "mencari_mitra",
      "mitra_siap",
      "menunggu_bayar",
    ]);
  });

  it("setiap status punya label untuk manusia", () => {
    for (const s of STATUS_PERMINTAAN) {
      expect(LABEL_PERMINTAAN[s]).toBeTruthy();
    }
  });
});

describe("perpindahan status permintaan", () => {
  it("jalur wajar C2: diminta -> mencari_mitra -> mitra_siap -> menunggu_bayar -> dikonfirmasi", () => {
    expect(bolehPindahPermintaan("diminta", "mencari_mitra")).toBe(true);
    expect(bolehPindahPermintaan("mencari_mitra", "mitra_siap")).toBe(true);
    expect(bolehPindahPermintaan("mitra_siap", "menunggu_bayar")).toBe(true);
    expect(bolehPindahPermintaan("menunggu_bayar", "dikonfirmasi")).toBe(true);
  });

  it("mitra_siap -> dikonfirmasi LANGSUNG kini DITUTUP — itu seluruh inti C2", () => {
    // Sampai C1-c panah ini adalah jalur wajar. C2 menghapusnya: konfirmasi
    // tidak lagi bisa terjadi tanpa uang berpindah dan diverifikasi.
    expect(bolehPindahPermintaan("mitra_siap", "dikonfirmasi")).toBe(false);
  });

  it("tenggat lewat punya keadaan SENDIRI, bukan menumpang pembatalan klien", () => {
    // Nilai status adalah catatan tentang SIAPA. Orang yang lupa membayar bukan
    // orang yang memutuskan membatalkan — dan hanya yang PERTAMA yang
    // mengembalikan skriningnya (spec C2 P5).
    expect(bolehPindahPermintaan("menunggu_bayar", "dibatalkan_tenggat")).toBe(true);
    expect(bolehPindahPermintaan("mitra_siap", "dibatalkan_tenggat")).toBe(false);
    expect(bolehPindahPermintaan("diminta", "dibatalkan_tenggat")).toBe(false);
  });

  it("dari menunggu_bayar, bidan boleh dilepas tanpa membatalkan pengajuan klien", () => {
    expect(bolehPindahPermintaan("menunggu_bayar", "mencari_mitra")).toBe(true);
  });

  it("MELOMPAT ditolak — tidak ada jalan pintas ke dikonfirmasi", () => {
    expect(bolehPindahPermintaan("diminta", "dikonfirmasi")).toBe(false);
    expect(bolehPindahPermintaan("mencari_mitra", "dikonfirmasi")).toBe(false);
    expect(bolehPindahPermintaan("mitra_siap", "dikonfirmasi")).toBe(false);
  });

  it("mundur satu langkah boleh — mitra membatalkan, admin mencari lagi", () => {
    expect(bolehPindahPermintaan("mitra_siap", "mencari_mitra")).toBe(true);
    expect(bolehPindahPermintaan("mencari_mitra", "diminta")).toBe(true);
  });

  it("klien boleh membatalkan dari ketiga keadaan antrean (spec J8)", () => {
    for (const dari of STATUS_ANTRE) {
      expect(bolehPindahPermintaan(dari, "dibatalkan_klien")).toBe(true);
    }
  });

  it("yang sudah dikonfirmasi tidak bisa dibatalkan lewat jalur permintaan", () => {
    expect(bolehPindahPermintaan("dikonfirmasi", "dibatalkan_klien")).toBe(false);
  });

  it("TIDAK ADA panah mundur dari dikonfirmasi — konfirmasi atomik (lihat Tugas 9)", () => {
    // Draf pertama rencana ini menyahkan `dikonfirmasi -> mitra_siap` sebagai
    // jalur PEMULIHAN, karena konfirmasi adalah dua tulisan (status permintaan,
    // lalu baris sesi) dan tulisan kedua bisa gagal. Itu ditolak saat tinjauan
    // penulis spec, dengan alasan yang lebih baik: jangan memperlebar mesin
    // status secara permanen untuk menampung operasi yang tidak atomik —
    // jadikan operasinya atomik. Tugas 9 memindahkan konfirmasi ke satu fungsi
    // Postgres (pola `klaim_sudah_bayar` yang sudah dipakai repo ini), sehingga
    // kegagalan parsial lenyap sebagai KELAS masalah dan panah ini tidak
    // pernah dibutuhkan.
    expect(bolehPindahPermintaan("dikonfirmasi", "mitra_siap")).toBe(false);
    expect(PERPINDAHAN_PERMINTAAN.dikonfirmasi).toEqual([]);
  });

  it("keadaan akhir benar-benar akhir", () => {
    expect(PERPINDAHAN_PERMINTAAN.dikonfirmasi).toEqual([]);
    expect(PERPINDAHAN_PERMINTAAN.dibatalkan_klien).toEqual([]);
    expect(PERPINDAHAN_PERMINTAAN.dibatalkan_tenggat).toEqual([]);
    expect(PERPINDAHAN_PERMINTAAN.ditolak).toEqual([]);
  });

  it("tidak ada perpindahan ke dirinya sendiri", () => {
    for (const s of STATUS_PERMINTAAN) {
      expect(PERPINDAHAN_PERMINTAAN[s]).not.toContain(s);
    }
  });

  it("setiap tujuan yang terdaftar adalah status yang benar-benar ada", () => {
    for (const s of STATUS_PERMINTAAN) {
      for (const tujuan of PERPINDAHAN_PERMINTAAN[s]) {
        expect(STATUS_PERMINTAAN).toContain(tujuan);
      }
    }
  });
});

describe("status sesi", () => {
  it("enam keadaan, memakai ejaan Indonesia", () => {
    // `dibatalkan_klien` (C3) berdampingan dengan `dibatalkan_padma` sejak
    // enam keadaan ini bertambah dari lima: status adalah catatan tentang
    // SIAPA yang membatalkan, dan keduanya sengaja tidak disatukan.
    expect([...STATUS_SESI].sort()).toEqual(
      [
        "berjalan",
        "dibatalkan_klien",
        "dibatalkan_padma",
        "selesai",
        "terjadwal",
        "tidak_hadir",
      ].sort(),
    );
  });

  it("setiap status sesi punya label", () => {
    for (const s of STATUS_SESI) expect(LABEL_SESI[s]).toBeTruthy();
  });

  it("jalur wajar sesi", () => {
    expect(bolehPindahSesi("terjadwal", "berjalan")).toBe(true);
    expect(bolehPindahSesi("berjalan", "selesai")).toBe(true);
    expect(bolehPindahSesi("terjadwal", "tidak_hadir")).toBe(true);
    expect(bolehPindahSesi("terjadwal", "dibatalkan_padma")).toBe(true);
    expect(bolehPindahSesi("terjadwal", "dibatalkan_klien")).toBe(true);
  });

  it("dibatalkan_klien tidak bisa diputar balik", () => {
    expect(bolehPindahSesi("dibatalkan_klien", "terjadwal")).toBe(false);
    expect(PERPINDAHAN_SESI.dibatalkan_klien).toEqual([]);
  });

  it("sesi selesai tidak bisa diputar balik", () => {
    expect(bolehPindahSesi("selesai", "berjalan")).toBe(false);
    expect(bolehPindahSesi("selesai", "dibatalkan_padma")).toBe(false);
    expect(PERPINDAHAN_SESI.selesai).toEqual([]);
  });

  it("terjadwal -> selesai TETAP boleh: belum ada akun mitra yang menekan 'berangkat'", () => {
    // Spec "Di luar ruang lingkup": akun & panel mitra belum ada, jadi
    // `berjalan` ditandai admin dan seringkali dilewati sama sekali.
    expect(bolehPindahSesi("terjadwal", "selesai")).toBe(true);
  });
});
