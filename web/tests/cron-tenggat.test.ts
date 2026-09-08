/**
 * RUTE PEMBATAL TERJADWAL (spec C2 P6).
 *
 * Pemanggilnya mesin, jadi tidak ada sesi maupun peran untuk diperiksa. Yang
 * menjaganya rahasia bersama — dan rute seperti itu punya satu cara gagal yang
 * khas: terbuka lebar ketika konfigurasinya lupa dipasang.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { POST } = await import("@/app/api/cron/tenggat/route");

function permintaan(header?: string): Request {
  return new Request("http://localhost/api/cron/tenggat", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

const rahasiaAsli = process.env.CRON_SECRET;

afterEach(() => {
  if (rahasiaAsli === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = rahasiaAsli;
});

describe("gerbang rahasia", () => {
  it("MENOLAK semua orang ketika CRON_SECRET tidak terpasang", async () => {
    // Fail-closed. Rute yang terbuka karena konfigurasinya lupa dipasang adalah
    // rute yang bisa dipakai siapa pun membatalkan pemesanan orang lain — dan
    // kelalaian konfigurasi tidak pernah menimbulkan galat yang terlihat.
    delete process.env.CRON_SECRET;
    const r = await POST(permintaan("Bearer apa pun"));
    expect(r.status).toBe(401);
  });

  it("menolak tanpa header", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan())).status).toBe(401);
  });

  it("menolak rahasia yang salah", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan("Bearer salah"))).status).toBe(401);
  });

  it("menolak rahasia yang benar TANPA skema Bearer", async () => {
    process.env.CRON_SECRET = "rahasia-uji";
    expect((await POST(permintaan("rahasia-uji"))).status).toBe(401);
  });

  it("menerima rahasia yang benar, dan memulangkan JUMLAH yang dibatalkan", async () => {
    // Jumlahnya penting: rute yang selalu menjawab "ok" tidak bisa dibedakan
    // dari rute yang tidak pernah menemukan apa pun, dan penjadwal tidak punya
    // apa pun untuk dicatat.
    process.env.CRON_SECRET = "rahasia-uji";
    const r = await POST(permintaan("Bearer rahasia-uji"));
    expect(r.status).toBe(200);
    const isi = (await r.json()) as { dibatalkan: number };
    expect(typeof isi.dibatalkan).toBe("number");
  });
});
