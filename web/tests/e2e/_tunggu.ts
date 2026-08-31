import type { Page } from "playwright";

/**
 * Menunggu ISI halaman, bukan sekadar jaringan.
 *
 * Sejak tiap panel punya `loading.tsx`, Next memindahkan URL SEKETIKA lalu
 * menampilkan kerangka muat sementara datanya menyusul. Itu memang perilaku
 * yang diinginkan — perpindahan halaman terasa langsung menjawab — tetapi ia
 * mematahkan pola tunggu yang lama:
 *
 *   await Promise.all([page.waitForURL(...), tautan.click()]);
 *   await page.waitForLoadState("networkidle");
 *
 * Pada navigasi sisi klien tidak ada muat dokumen baru, sehingga "networkidle"
 * praktis langsung hijau; dan `waitForURL` kini selesai saat layar masih berisi
 * kerangka. Test yang membaca DOM tepat sesudahnya membaca kerangka itu, bukan
 * isinya — persis yang terjadi pada pemeriksaan 2b di admin-pelengkap.
 *
 * Penungguan yang benar karena itu: tunggu kerangkanya PERGI.
 */
export async function tungguIsi(page: Page, timeout = 20_000): Promise<void> {
  await page.waitForLoadState("networkidle");
  // Bukan `.catch(() => {})`: kerangka yang tidak pernah hilang adalah bug
  // sungguhan, dan test harus merah karenanya, bukan diam-diam lanjut.
  await page.waitForFunction(
    () => document.querySelector('[data-kerangka="muat"]') === null,
    undefined,
    { timeout },
  );
}
