-- Komentar tabel `digital_products` masih menyebut `boleh_unduh` yang sudah
-- pindah ke tingkat materi (migrasi bab & materi). Hanya komentar — tidak ada
-- perubahan skema maupun data.
comment on table public.digital_products is
  'Katalog produk digital yang dijual; isinya tersusun bab (digital_product_sections) '
  'lalu materi (digital_product_materials) — jenis video/pdf, pratinjau, dan izin '
  'unduh hidup di tingkat materi. TANPA kolom nominal — harga hidup di '
  'digital_product_prices, di balik money firewall. `aktif` default false: yang '
  'terpajang adalah keputusan sadar, bukan keadaan bawaan. `aktif = false` berarti '
  'BERHENTI DIJUAL, bukan mencabut akses: pemegang entitlement yang belum dicabut '
  'tetap membaca barisnya lewat policy "produk: pemilik entitlement baca". '
  '`masa_berlaku_bulan` (NULL = selamanya) hanya bisa diubah owner. '
  'Pencabutan akses hanya lewat digital_entitlements.dicabut_pada.';
