# Runbook — Memulihkan Database PADMA dari Backup

> **BACA LEBIH DULU: objek Supabase Storage TIDAK ikut ter-backup.**
> Sesudah pemulihan, setiap e-book akan tampil rusak karena `material_pages`
> menunjuk objek gambar yang tidak ada. Admin **wajib mengunggah ulang seluruh
> PDF materi**. Ini keputusan sadar (spec B3), bukan kegagalan pemulihan.

## Yang Anda butuhkan

- Kunci privat `age` dari password manager. **Tanpa ini tidak ada backup yang
  bisa dibuka** — tidak oleh GitHub, tidak oleh Cloudflare, tidak oleh siapa pun.
- Kredensial R2 yang bisa membaca bucket `padma-backup`.
- Klien PostgreSQL 17 (`psql`, `pg_restore`) dan `age`.

## 1. Pilih backup

Objek bernama `db/<tahun>/<bulan>/padma-YYYYMMDD-HHMMSSZ.dump.age`, cap waktunya
**UTC**. 03:00 WIB = 20:00 UTC hari sebelumnya — perhatikan ini saat memilih
"backup kemarin".

## 2. Unduh dan dekripsi

```bash
age -d -i kunci-privat.txt -o padma.dump padma-YYYYMMDD-HHMMSSZ.dump.age
```

Bila langkah ini gagal, hentikan dan cari kunci yang benar. Jangan menghapus
apa pun sampai satu backup terbukti bisa dibuka.

## 3. Pulihkan ke database KOSONG

Jangan pernah memulihkan ke database yang masih berisi data yang ingin
diselamatkan. Buat yang baru, pulihkan ke sana, periksa, baru alihkan.

```bash
pg_restore --no-owner --no-privileges --dbname "$URL_TUJUAN" padma.dump
```

Galat `role ... does not exist` wajar dan boleh diabaikan: dump sengaja dibuat
`--no-owner --no-privileges`, dan peran Supabase tidak ada di Postgres polos.

## 4. Periksa sebelum mengalihkan trafik

```sql
select count(*) from auth.users;
select count(*) from public.clients;
select count(*) from public.sessions;
select max(created_at) from public.sessions;
```

Baris terakhir memberi tahu sampai kapan data ini mutakhir — bandingkan dengan
kapan kerusakan terjadi.

## 5. Sesudah pulih

1. Unggah ulang seluruh PDF materi (lihat peringatan paling atas).
2. Pastikan satu pasien bisa login dan membuka passport-nya.
3. Jalankan backup manual (`workflow_dispatch`) supaya ada salinan baru dari
   keadaan yang sudah pulih.

## Latihan berkala (WAJIB, tiap kuartal)

Unduh satu backup dan jalankan langkah 2 sampai 4 di database sekali pakai.

Ini bukan formalitas: CI **sengaja** tidak bisa mendekripsi apa pun, jadi
kesalahan pada kunci publik yang terpasang tidak akan pernah membuat satu pun
job merah. Latihan ini satu-satunya cara menemukannya sebelum hari terburuk.
