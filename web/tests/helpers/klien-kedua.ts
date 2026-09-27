import { createAdminSupabase } from "@/lib/supabase/admin";

/**
 * KLIEN KEDUA BER-AKUN AUTH — fixture yang dibuat sendiri, bukan seed.
 *
 * ===== KENAPA IA HARUS ADA =====
 * `scripts/seed-users.ts` hanya punya SATU klien ber-akun auth: Ananda. Rina
 * sengaja `user_id: null`, dan admin/owner tidak punya baris `clients` sama
 * sekali. Akibatnya setiap kali rencana P1 ingin menulis "orang lain tidak
 * bisa menyentuh pesanan saya", ia terpaksa memakai `admin@padma.test` — dan
 * gerbang PERTAMA ketiga RPC klien adalah `v_client_id is null -> 42501`,
 * bukan pemeriksaan kepemilikan baris. Yang teruji jadi "akun tanpa rekam
 * klien ditolak", BUKAN "klien B ditolak atas pesanan klien A": klausa
 * `and o.client_id = v_client_id` di `catat_token_snap` dan
 * `batalkan_pesanan_saya` boleh dihapus hari ini tanpa satu pun uji merah.
 *
 * ===== KENAPA BUKAN MENAUTKAN RINA =====
 * Rina adalah bahan uji PENAUTAN, dan seed menegakkan dua syarat sekaligus:
 * barisnya belum bertuan DAN tidak ada akun auth atas alamatnya
 * (`pastikanRinaBelumDiaktifkan`). Menautkannya memerahkan seluruh berkas uji
 * penautan — merah di berkas ORANG LAIN, dengan sebab yang tidak disebut di
 * mana pun. Pelajaran repo yang sudah dibayar sekali pada koordinat mitra:
 * fixture yang dibagi berubah jadi fixture yang saling memerahkan. Buat
 * sendiri, bongkar sendiri.
 *
 * Pola `createUser` + `deleteUser` ini sudah dipakai rumah:
 * tests/link-client.test.ts:49, tests/penautan-undangan.test.ts:106,
 * tests/penautan-kolom-terkunci.test.ts:83.
 */
const svc = createAdminSupabase();

export const EMAIL_KLIEN_KEDUA = "klien-kedua@padma.test";
/** Sandi seragam fixture repo ini — `signInAs()` memakainya untuk semua akun. */
export const KLIEN_KEDUA_ID = "44444444-4444-4444-4444-4444444444c2";
const PADMA_ID_KLIEN_KEDUA = "PAD-2609-9002";

/**
 * Dipanggil di `beforeAll`. Menyapu sisa run sebelumnya lebih dulu:
 * `clients.padma_id` unik, dan akun auth yatim menahan penghapusan barisnya.
 */
export async function siapkanKlienKedua(): Promise<string> {
  await bongkarKlienKedua();

  const { data, error } = await svc.auth.admin.createUser({
    email: EMAIL_KLIEN_KEDUA,
    password: "padma-dev-123",
    email_confirm: true,
  });
  if (error) throw error;

  const { error: eKlien } = await svc.from("clients").insert({
    id: KLIEN_KEDUA_ID,
    padma_id: PADMA_ID_KLIEN_KEDUA,
    nama: "Klien Kedua (uji)",
    email: EMAIL_KLIEN_KEDUA,
    no_hp: "0899-0000-0002",
    phase_id: "prekonsepsi",
    user_id: data.user!.id,
    linked_at: new Date().toISOString(),
  });
  if (eKlien) throw eKlien;

  return KLIEN_KEDUA_ID;
}

/**
 * Dipanggil di `afterAll`. Urutannya MENGIKAT:
 *   entitlement → jejak & notifikasi → orders → clients → akun auth.
 * `digital_entitlements.pesanan_id` dan `orders.client_id` keduanya
 * `on delete restrict`, `jejak_pesanan`/`notifikasi_pesanan` sengaja tanpa FK
 * (jadi tidak ada cascade, dan tests/pesanan-jejak-yatim.test.ts akan merah di
 * berkas orang lain), dan `clients.user_id -> auth.users(id)` tidak punya
 * ON DELETE sama sekali.
 */
export async function bongkarKlienKedua(): Promise<void> {
  await svc.from("digital_entitlements").delete().eq("client_id", KLIEN_KEDUA_ID);

  const { data: pesanan } = await svc
    .from("orders")
    .select("id")
    .eq("client_id", KLIEN_KEDUA_ID);
  for (const p of pesanan ?? []) {
    await svc.from("jejak_pesanan").delete().eq("pesanan_id", p.id);
    await svc.from("notifikasi_pesanan").delete().eq("pesanan_id", p.id);
  }
  await svc.from("orders").delete().eq("client_id", KLIEN_KEDUA_ID);
  await svc.from("clients").delete().eq("id", KLIEN_KEDUA_ID);

  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data?.users ?? []) {
    if (u.email?.toLowerCase() === EMAIL_KLIEN_KEDUA) {
      await svc.auth.admin.deleteUser(u.id);
    }
  }
}
