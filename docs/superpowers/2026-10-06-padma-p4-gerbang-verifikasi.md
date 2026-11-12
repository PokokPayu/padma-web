# Gerbang verifikasi P4 — dijalankan SESUDAH Docker hidup

Dibuat 6 Okt 2026 di bawah Ruling R8 (mode tanpa-jalan-uji). Seluruh kode P4
ditulis tanpa ujinya pernah dijalankan. Berkas ini adalah satu-satunya hal yang
mengubah "sudah ditulis" menjadi "sudah terbukti".

Jalankan dari `/Users/arvinfairuz/Documents/padma/.worktrees/p4`.

## 0. Nyalakan infrastrukturnya

```bash
docker info >/dev/null 2>&1 && echo HIDUP || echo "Docker masih mati — berhenti di sini"
cd web && npx supabase start
```

## 1. Terapkan migrasi Tugas 1

```bash
cd web && npx supabase migration up --local
```

JANGAN `db reset` — basis data lokal dipakai bersama sesi lain.
Diharapkan: `20261006100000_pesanan_item_produk_id` diterapkan tanpa galat.

## 2. Uji murni lebih dulu (paling murah, paling mungkin merah)

```bash
cd web && npx vitest run tests/penjualan-bulan.test.ts tests/penjualan-hitung.test.ts
```

## 3. Uji render

```bash
cd web && npx vitest run tests/penjualan-layar.test.tsx
```

## 4. Uji ber-DB milik P4

```bash
cd web && npx vitest run tests/penjualan-db.test.ts
```

## 5. Pagar yang P4 SENGAJA sentuh

```bash
cd web && npx vitest run tests/pesanan-akses-tiga-keadaan.test.ts tests/inventaris-rute.test.ts
```

`pesanan-akses-tiga-keadaan` harus hijau dengan daftar TUJUH kolom.
`inventaris-rute` harus hijau dengan dua baris README baru.

## 6. Pagar yang P4 TIDAK BOLEH sentuh

```bash
cd web && npx vitest run tests/money-firewall-struktural.test.ts tests/grant-anon.test.ts tests/struktur-rls.test.ts tests/admin-shell.test.ts tests/owner-kerangka.test.ts tests/panel-primitif.test.ts tests/admin-pesanan.test.tsx
```

Ketiga yang pertama HARUS hijau tanpa satu pun disunting. Kemerahannya berarti
implementasi menyimpang dari spec — BUKAN berarti ujinya perlu diubah.

## 7. Tipe & lint

```bash
cd web && npx tsc --noEmit && npx eslint src
```

`tsc` di worktree punya garis dasar TEPAT 1 galat (`src/app/layout.tsx(28,50)
TS2304 LayoutProps`) — artefak worktree tanpa tipe Next tergenerasi; checkout
utama nol. Galat KEDUA apa pun adalah galat sungguhan.

## 8. Yang TIDAK bisa dipulihkan gerbang ini

Bukti merah-hijau. Setiap tugas punya langkah "jalankan untuk memastikan MERAH"
justru supaya "ujinya pasti gagal kalau kodenya salah" menjadi fakta yang
diamati. Sesudah kodenya ditulis, itu tidak bisa dibuktikan retroaktif.

Satu uji yang paling pantas dicurigai, dan cara memeriksanya dengan tangan:
`tests/penjualan-bulan.test.ts` — ganti badan `bulanJakarta` sementara menjadi
`return iso.slice(0, 7);` dan pastikan ujinya MERAH. Kembalikan sesudahnya.
Hal yang sama untuk `golongkan` di `hitung.ts`: ganti klausa pertama menjadi
`if (b.status === "lunas") return "omzet";` dan pastikan uji jebakan
chargeback MERAH.
