import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tanda tangan non-SNAP DOKU:
 *   Digest   = base64(SHA-256(badan))
 *   Komponen = Client-Id / Request-Id / Request-Timestamp / Request-Target /
 *              Digest, digabung "\n", TANPA baris baru di akhir
 *   Signature = "HMACSHA256=" + base64(HMAC-SHA256(komponen, secretKey))
 */

/** Digest atas badan MENTAH (UTF-8). Serialisasi ulang JSON mengubah byte-nya. */
export function hitungDigest(badan: string): string {
  return createHash("sha256").update(badan, "utf8").digest("base64");
}

/**
 * Baris `Digest` dihilangkan bila `digest` null: permintaan GET tidak
 * bertubuh, jadi tidak ada Digest yang ditandatangani. Baris baru di akhir
 * akan menggeser tanda tangan, dan kegagalannya terlihat persis seperti
 * "DOKU salah".
 */
export function rakitKomponenTandaTangan(k: {
  clientId: string;
  requestId: string;
  requestTimestamp: string;
  requestTarget: string;
  digest: string | null;
}): string {
  const baris = [
    `Client-Id:${k.clientId}`,
    `Request-Id:${k.requestId}`,
    `Request-Timestamp:${k.requestTimestamp}`,
    `Request-Target:${k.requestTarget}`,
  ];
  if (k.digest !== null) baris.push(`Digest:${k.digest}`);
  return baris.join("\n");
}

export function hitungTandaTangan(komponen: string, secretKey: string): string {
  return (
    "HMACSHA256=" +
    createHmac("sha256", secretKey).update(komponen, "utf8").digest("base64")
  );
}

/**
 * Banding waktu-tetap.
 *
 * `timingSafeEqual` MELEMPAR ketika panjang kedua buffer berbeda — bukan
 * memulangkan false. Header `Signature` pendek, kosong, atau tanpa awalan
 * `HMACSHA256=` harus menjadi 401, bukan 500.
 *
 * Panjang tidak membocorkan rahasia: sisi yang dihitung selalu berpanjang
 * TETAP (awalan + 44 karakter base64).
 */
export function tandaTanganCocok(dikirim: string, dihitung: string): boolean {
  const a = Buffer.from(dikirim, "utf8");
  const b = Buffer.from(dihitung, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Sidik idempotensi notifikasi DOKU.
 *
 * `sumber` ikut supaya webhook dan Check Status atas fakta yang sama tidak
 * saling menolak sebagai duplikat tanpa sengaja, dan `status` ikut supaya dua
 * status berbeda untuk invoice yang sama adalah dua keputusan berbeda.
 * Dipisah `\u0000`, BUKAN `"|"`: `invoice` dan `status` datang dari luar, dan
 * `"a|b"+"c"` bertabrakan dengan `"a"+"b|c"` bila pemisahnya bisa muncul di
 * dalam medan. NUL tidak muncul di status atau invoice yang sah.
 */
export function hitungSidikDoku(s: {
  sumber: "webhook" | "status_api";
  invoice: string;
  status: string;
  pembeda: string;
}): string {
  return createHash("sha256")
    .update([s.sumber, s.invoice, s.status, s.pembeda].join("\u0000"), "utf8")
    .digest("hex");
}
