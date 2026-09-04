# Runbook — Memulihkan Database PADMA dari Backup

> **BACA LEBIH DULU: objek Supabase Storage TIDAK ikut ter-backup.**
> Sesudah pemulihan, setiap e-book akan tampil rusak karena `material_pages`
> menunjuk objek gambar yang tidak ada. Admin **wajib mengunggah ulang seluruh
> PDF materi**. Ini keputusan sadar (spec B3), bukan kegagalan pemulihan.

## Yang Anda butuhkan

- Kunci privat `age` dari password manager. **Tanpa ini tidak ada backup yang
  bisa dibuka** — tidak oleh GitHub, tidak oleh Cloudflare, tidak oleh siapa pun.
- Kredensial R2 yang bisa membaca bucket `padma-backup`: `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (token yang sama disebut spec §10;
  minta dari password manager, sama seperti kunci `age`).
- Klien PostgreSQL 17 (`psql`, `pg_restore`), `age`, dan AWS CLI (`aws`) —
  atau, bila `aws` tidak tersedia, Node.js dengan checkout repo ini (dipakai
  lewat `npx tsx`, lihat langkah 2).
- Akses ke sebuah project Supabase tujuan (baru atau yang sudah ada) tempat
  memulihkan.

## 1. Pilih backup

Objek bernama `db/<tahun>/<bulan>/padma-YYYYMMDD-HHMMSSZ.dump.age`, cap waktunya
**UTC**. 03:00 WIB = 20:00 UTC hari sebelumnya — perhatikan ini saat memilih
"backup kemarin".

## 2. Unduh dan dekripsi

Unduh dulu objeknya dari R2 — bucket dan bentuk endpoint-nya sama seperti yang
dipakai `web/scripts/backup/unggah-r2.ts` untuk mengunggah
(`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, bucket dari
`R2_BUCKET_BACKUP`, biasanya `padma-backup`):

```bash
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
aws s3api get-object \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
  --bucket "$R2_BUCKET_BACKUP" \
  --key "db/2026/09/padma-YYYYMMDD-HHMMSSZ.dump.age" \
  padma-YYYYMMDD-HHMMSSZ.dump.age
```

Tanpa `aws` CLI, dari root repo ini, `@aws-sdk/client-s3` yang sama dipakai
`unggah-r2.ts` bekerja sama baiknya lewat potongan Node singkat:

```bash
cd web && R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  npx tsx -e '
    import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
    import { writeFileSync } from "node:fs";
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const kunci = "db/2026/09/padma-YYYYMMDD-HHMMSSZ.dump.age";
    const r = await s3.send(new GetObjectCommand({ Bucket: "padma-backup", Key: kunci }));
    writeFileSync(kunci.split("/").pop()!, await r.Body!.transformToByteArray());
  '
```

Baru sesudah berkasnya ada di disk, dekripsi:

```bash
age -d -i kunci-privat.txt -o padma.dump padma-YYYYMMDD-HHMMSSZ.dump.age
```

Bila langkah ini gagal, hentikan dan cari kunci yang benar. Jangan menghapus
apa pun sampai satu backup terbukti bisa dibuka.

## 3. Pulihkan ke database KOSONG

Jangan pernah memulihkan ke database yang masih berisi data yang ingin
diselamatkan. Buat yang baru, pulihkan ke sana, periksa, baru alihkan.

```bash
pg_restore --no-owner --dbname "$URL_TUJUAN" padma.dump
```

**`--no-privileges` SENGAJA tidak dipakai di sini** — beda dari verifikasi CI.
Dump ini membawa GRANT ke `anon`/`authenticated` (lihat komentar di langkah
`pg_dump` pada `.github/workflows/backup-db.yml`), dan skema ini hanya pernah
GRANT ke `anon`, `authenticated`, dan `public` (bawaan Postgres) — ketiganya
**selalu ada** di project Supabase mana pun sejak project itu dibuat.

Karena itu, pada pemulihan ke project Supabase **sungguhan**, galat
`role ... does not exist` **BUKAN hal wajar dan TIDAK boleh diabaikan begitu
saja**. Bila muncul, kemungkinan besar artinya `$URL_TUJUAN` bukan project
Supabase yang terprovisi penuh (mis. Postgres polos, seperti yang sengaja
dipakai verifikasi CI) — cari tahu penyebabnya sebelum lanjut. Errornya juga
diam-diam menjatuhkan korban yang lebih berbahaya daripada GRANT yang gagal:
`CREATE POLICY ... TO authenticated` yang menyasar peran tak ada juga gagal
dibuat, dan itu berarti kebijakan RLS hilang — lihat query hitung di
langkah 4, yang **wajib** dijalankan meski restore-nya "tampak" mulus.

Sesudah restore, selaraskan skema dengan migrasi terbaru di repo. Dump adalah
jepretan skema saat backup diambil — bisa sampai 24 jam lebih tua daripada
`main` (RPO, spec §2) — sementara `web/supabase/migrations` adalah sumber
kebenaran untuk kebijakan RLS dan GRANT yang berlaku **sekarang**:

```bash
cd web && npx supabase db push --db-url "$URL_TUJUAN"
```

Jalankan ini SESUDAH restore, bukan sebelum — migrasinya tidak idempoten
(`create table` tanpa `if not exists`), jadi menjalankannya ke database yang
sudah punya skema dari dump akan menyalak "already exists" untuk objek yang
memang sudah identik; yang benar-benar penting adalah migrasi yang lebih baru
dari tanggal backup, yang akan berhasil menambah policy/kolom yang belum ada.

## 4. Periksa sebelum mengalihkan trafik

```sql
select count(*) from auth.users;
select count(*) from public.clients;
select count(*) from public.sessions;
select count(*) from public.materials;
select count(*) from public.profiles;
select max(created_at) from public.sessions;

-- WAJIB: bukti bahwa RLS tidak diam-diam hilang selama restore (lihat
-- langkah 3). Bandingkan hasilnya dengan jumlah policy di lingkungan sehat
-- (`select count(*) from pg_policies where schemaname = 'public';` di
-- staging/dev) — per commit ini angkanya 36. Kurang dari itu berarti
-- BERHENTI: jangan alihkan trafik ke database ini sampai penyebabnya jelas
-- dan policy yang hilang sudah dipulihkan (langkah "selaraskan skema" di
-- atas biasanya cukup untuk ini).
select count(*) from pg_policies where schemaname = 'public';
```

Baris terakhir sebelum query RLS memberi tahu sampai kapan data ini
mutakhir — bandingkan dengan kapan kerusakan terjadi.

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
