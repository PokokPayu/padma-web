-- ============================================================================
-- KOMENTAR PENAUTAN MENYUSUL KENYATAAN: DUA JALUR SAH, BUKAN SATU
-- ============================================================================
-- Migration ini TIDAK mengubah satu pun aturan. Ia hanya memperbarui teks yang
-- MENYATAKAN aturan itu — dan justru karena itu ia perlu ada.
--
-- Migration `20260828235000_kunci_kolom_penautan_klien` menulis sendiri, dalam
-- kalimatnya sendiri, bahwa komentar kolom `clients.user_id` adalah "tempat
-- pertama orang berikutnya melihat sebelum melonggarkan policy". Komentar itu
-- masih berbunyi: kolom ini hanya boleh ditulis service role "lewat
-- linkClientByInvite() (token undangan sekali pakai + email cocok)".
--
-- Sejak spec 8 September 2026 (K1/K14) kalimat itu SALAH, dan salah dengan cara
-- yang paling mahal: ia menyebut SATU penulis padahal ada TIGA, sehingga
-- pembaca yang menuruti nasihatnya akan menyimpulkan bahwa dua penulis lain
-- adalah pelanggaran — lalu "merapikannya". Ketiga penulis itu semuanya
-- service-role di `src/lib/auth/link-client.ts`:
--
--   1. `linkClientByInvite()`                  — token undangan sekali pakai
--                                                DAN email cocok persis;
--   2. `tautkanKlienLewatEmailTerverifikasi()` — email yang sudah TERBUKTI
--                                                (`email_confirmed_at` terisi)
--                                                cocok dengan baris yang belum
--                                                tertaut;
--   3. `terbitkanKlienMandiri()`               — INSERT baris klien baru yang
--                                                sudah bertuan sejak lahir,
--                                                juga menuntut email terbukti.
--
-- Yang TIDAK berubah, dan itulah inti komentar ini: penulisnya tetap HANYA
-- service role. Trigger `trg_guard_client_link` masih menolak setiap perubahan
-- `user_id`/`linked_at` dari peran API — admin dan owner sekalipun. Yang
-- bertambah bukan siapa yang boleh menulis, melainkan berapa banyak fungsi
-- server yang berhak memerintahkannya, dan masing-masing membawa penjaganya
-- sendiri.
--
-- Riwayatnya sengaja DIBAWA SERTA di dalam teks barunya, bukan diganti bersih.
-- Nilai komentar ini bukan pada pernyataan "aman", melainkan pada penjelasan
-- BAGAIMANA dua celah terdahulu ditutup — dan kenapa jalur kedua bukan
-- pengulangan celah yang kedua.
--
-- Migration lama TIDAK disunting: berkas yang sudah pernah dijalankan di mesin
-- orang lain hanya boleh disusul, tidak boleh ditulis ulang.

comment on column public.clients.user_id is
  'Akun auth pemilik baris klien ini; dasar RLS "clients: milik sendiri" '
  '(user_id = auth.uid()) dan karenanya penentu siapa yang boleh membaca rekam '
  'medisnya. HANYA boleh ditulis service role dari server. Peran API — admin & '
  'owner sekalipun — ditolak trigger trg_guard_client_link. '
  'ADA TIGA penulis sah, semuanya di src/lib/auth/link-client.ts dan '
  'masing-masing membawa penjaganya sendiri: (1) linkClientByInvite() — token '
  'undangan sekali pakai DAN email cocok persis; (2) '
  'tautkanKlienLewatEmailTerverifikasi() — email yang sudah TERBUKTI '
  '(email_confirmed_at terisi) cocok dengan baris yang belum tertaut; (3) '
  'terbitkanKlienMandiri() — INSERT baris baru yang bertuan sejak lahir, juga '
  'menuntut email terbukti. Urutan ketiganya dipegang satu tempat, '
  'src/lib/auth/pastikan-klien.ts. '
  'SEJARAH: mencocokkan email pernah CUKUP untuk merebut rekam medis, karena '
  'saat itu email tidak pernah dibuktikan (enable_confirmations = false '
  'membuat GoTrue meng-auto-confirm pendaftaran mandiri). Yang membuat (2) & '
  '(3) sah bukan kecocokan alamatnya melainkan KONFIRMASINYA; mematikan '
  'enable_confirmations menghidupkan celah itu utuh seperti semula.';

comment on column public.clients.linked_at is
  'Waktu akun auth tertaut ke baris klien ini — lewat token undangan '
  '(public.client_invites), lewat email terverifikasi, atau sejak INSERT untuk '
  'klien yang mendaftar sendiri. NULL = belum ada akun yang memilikinya. Bukan '
  'rahasia (klien berhak tahu, admin perlu melihat siapa yang belum aktif), '
  'tetapi HANYA boleh ditulis service role bersama user_id — dijaga trigger '
  'trg_guard_client_link agar tidak ada jejak tautan palsu.';

comment on function public.guard_client_link() is
  'Menolak perubahan clients.user_id / clients.linked_at dari peran API '
  '(anon, authenticated, authenticator) — termasuk admin & owner. Penautan '
  'hanya sah lewat service role di server, dan hanya lewat tiga fungsi di '
  'src/lib/auth/link-client.ts yang masing-masing menuntut buktinya sendiri: '
  'linkClientByInvite (token undangan sekali pakai + email cocok), '
  'tautkanKlienLewatEmailTerverifikasi dan terbitkanKlienMandiri (keduanya '
  'menuntut email_confirmed_at terisi). Lihat komentar kolom clients.user_id.';
