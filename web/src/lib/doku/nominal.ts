/**
 * Menormalkan `order.amount` dari DOKU menjadi rupiah bulat, atau `null`.
 *
 * DOKU memulangkan nominal dalam bentuk yang berbeda per channel: angka (VA),
 * string (gerai), dan `"20000.00"` (QRIS) [spec §4.2]. Hanya tiga bentuk itu
 * yang diterima: bilangan bulat >= 0, string digit, atau string digit dengan
 * pecahan yang SELURUHNYA nol.
 *
 * Pecahan bukan nol (`150000.5`, `"150000.50"`) sengaja `null`, bukan
 * dibulatkan: pemanggil menahan pesanan (`selisih_nominal`) alih-alih
 * menyatakan lunas atas jumlah yang tidak persis sama dengan tagihan.
 * Notasi ilmiah, tanda minus, string kosong, dan non-angka juga `null`.
 */
export function normalisasiNominal(nilai: unknown): number | null {
  if (typeof nilai === "number") {
    return Number.isSafeInteger(nilai) && nilai >= 0 ? nilai : null;
  }
  if (typeof nilai === "string") {
    if (!/^\d+(\.0+)?$/.test(nilai)) return null;
    const bulat = Number(nilai.split(".")[0]);
    return Number.isSafeInteger(bulat) ? bulat : null;
  }
  return null;
}
