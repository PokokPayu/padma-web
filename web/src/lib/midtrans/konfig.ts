/**
 * Pemilihan lingkungan Midtrans — satu tempat, dan hanya satu.
 *
 * SENGAJA bukan `NODE_ENV`: pratinjau Vercel berjalan dengan
 * `NODE_ENV=production` dan akan menembak Midtrans PRODUKSI, yaitu uang
 * sungguhan dari lingkungan yang dibuat untuk coba-coba. Yang memilih adalah
 * env terpisah, dan HANYA nilai `"true"` persis — bukan `"1"`, bukan `"TRUE"`,
 * bukan "apa pun yang truthy". Env yang salah ketik harus jatuh ke sandbox,
 * karena arah kegagalan yang aman di sini hanya satu.
 *
 * TANPA `server-only`: `urlSkripSnap()` dipanggil dari komponen klien. Yang
 * TIDAK boleh dipanggil dari peramban adalah `midtransProduksi()` dan
 * `serverKeyMidtrans()` — `MIDTRANS_PRODUKSI` tidak berprefix `NEXT_PUBLIC_`,
 * jadi di peramban ia `undefined` dan hasilnya SELALU sandbox, tanpa satu pun
 * galat. Karena itu `urlSkripSnap` menerima pilihannya sebagai PARAMETER, dan
 * yang membacanya adalah server (lihat `/produk/[slug]/page.tsx`).
 */

/** `true` hanya untuk nilai `"true"` persis. Apa pun selain itu = sandbox. */
export function midtransProduksi(): boolean {
  return process.env.MIDTRANS_PRODUKSI === "true";
}

/**
 * `""` bila tidak terpasang — penelepon yang memutuskan artinya, dan keputusan
 * itu berbeda per penelepon. Webhook memutuskan 503 (Midtrans WAJIB mengirim
 * ulang); adapter memutuskan menolak menerbitkan token.
 */
export function serverKeyMidtrans(): string {
  return process.env.MIDTRANS_SERVER_KEY ?? "";
}

export function basisSnap(): string {
  return midtransProduksi()
    ? "https://app.midtrans.com/snap/v1"
    : "https://app.sandbox.midtrans.com/snap/v1";
}

export function basisApiMidtrans(): string {
  return midtransProduksi()
    ? "https://api.midtrans.com/v2"
    : "https://api.sandbox.midtrans.com/v2";
}

/**
 * URL skrip Snap untuk peramban. Pilihannya DIOPER, tidak dibaca dari env di
 * sini — lihat dokblok berkas. Fungsi ini sengaja tidak memanggil
 * `midtransProduksi()`; kalau ia melakukannya, komponen klien yang memanggilnya
 * akan selalu mendapat sandbox dan tidak ada yang tahu sampai pembayaran
 * produksi pertama gagal.
 */
export function urlSkripSnap(produksi: boolean): string {
  return produksi
    ? "https://app.midtrans.com/snap/snap.js"
    : "https://app.sandbox.midtrans.com/snap/snap.js";
}
