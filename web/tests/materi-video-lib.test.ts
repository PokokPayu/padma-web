import { describe, it, expect } from "vitest";
import {
  MAKS_BYTE_VIDEO, MIME_VIDEO, ekstensiDariMime, namaObjekVideo,
  periksaBerkasVideo, objekVideoSah,
} from "@/lib/materi/video";

const ID = "11111111-1111-1111-1111-111111111111";
const ACAK = "22222222-2222-2222-2222-222222222222";

describe("batas & tipe video", () => {
  it("batasnya 200 MB", () => {
    expect(MAKS_BYTE_VIDEO).toBe(200 * 1024 * 1024);
  });

  it("hanya dua MIME yang didukung", () => {
    expect([...MIME_VIDEO]).toEqual(["video/mp4", "video/webm"]);
  });

  it("menolak MIME lain, termasuk yang mirip", () => {
    for (const m of ["video/quicktime", "video/x-matroska", "text/html", ""]) {
      const r = periksaBerkasVideo(m, 1000);
      expect(r.ok).toBe(false);
    }
  });

  it("menolak berkas melebihi batas, dan pesannya memberi JALAN KELUAR", () => {
    // Tanpa transkode, admin harus mengompres sendiri berapa pun batasnya.
    // Pesan yang hanya menyebut angka meninggalkannya buntu.
    const r = periksaBerkasVideo("video/mp4", MAKS_BYTE_VIDEO + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.pesan).toContain("200");
      expect(r.pesan).toContain("720p");
    }
  });

  it("menolak berkas kosong", () => {
    expect(periksaBerkasVideo("video/mp4", 0).ok).toBe(false);
  });

  it("menerima berkas wajar dan mengembalikan MIME-nya", () => {
    const r = periksaBerkasVideo("video/webm", 5_000_000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nilai).toBe("video/webm");
  });

  it("menerima berkas PERSIS sebesar batas", () => {
    expect(periksaBerkasVideo("video/mp4", MAKS_BYTE_VIDEO).ok).toBe(true);
  });
});

describe("penamaan objek video", () => {
  it("berbentuk {materialId}/{acak}.{ext}", () => {
    expect(namaObjekVideo(ID, "video/mp4", ACAK)).toBe(`${ID}/${ACAK}.mp4`);
    expect(namaObjekVideo(ID, "video/webm", ACAK)).toBe(`${ID}/${ACAK}.webm`);
  });

  it("ekstensi diturunkan dari MIME, bukan dari nama berkas admin", () => {
    // Nama berkas asli sering memuat hal yang tidak perlu ikut tersebar —
    // judul draf, nama orang, nomor revisi.
    expect(ekstensiDariMime("video/mp4")).toBe("mp4");
    expect(ekstensiDariMime("video/webm")).toBe("webm");
    expect(ekstensiDariMime("video/quicktime")).toBeNull();
  });
});

describe("keabsahan objek yang dicatat browser", () => {
  it("menerima objek yang bentuknya benar untuk materi itu", () => {
    expect(objekVideoSah(ID, `${ID}/${ACAK}.mp4`, "video/mp4")).toBe(true);
  });

  it("MENOLAK objek milik materi lain", () => {
    // Inilah yang mencegah browser mencatat objek video materi lain sebagai
    // miliknya sendiri — pagar yang sama seperti pada halaman e-book.
    const lain = "99999999-9999-9999-9999-999999999999";
    expect(objekVideoSah(ID, `${lain}/${ACAK}.mp4`, "video/mp4")).toBe(false);
  });

  it("MENOLAK ekstensi yang tidak cocok dengan MIME-nya", () => {
    expect(objekVideoSah(ID, `${ID}/${ACAK}.webm`, "video/mp4")).toBe(false);
  });

  it("MENOLAK path bersarang dan traversal", () => {
    expect(objekVideoSah(ID, `${ID}/sub/${ACAK}.mp4`, "video/mp4")).toBe(false);
    expect(objekVideoSah(ID, `${ID}/../${ACAK}.mp4`, "video/mp4")).toBe(false);
  });

  it("MENOLAK bagian acak yang bukan UUID", () => {
    expect(objekVideoSah(ID, `${ID}/tebakan.mp4`, "video/mp4")).toBe(false);
  });
});
