-- Artikel & testimoni situs publik, dikelola owner/admin dari panel.
--
-- README handoff landing v2: "Artikel ditulis sendiri oleh owner: siapkan
-- blog/CMS sederhana agar bisa menulis & menerbitkan tanpa coding", dan
-- "Testimoni: jangan tayang sebelum ada kutipan asli berizin".
--
-- Pola hak mengikuti katalog publik (baca_publik_katalog): anon hanya SELECT
-- baris yang terbit, staf mengelola semuanya lewat sesinya sendiri (RLS).
-- Berbeda dari materi, kedua tabel ini BOLEH dihapus staf — isinya konten
-- pemasaran, bukan riwayat klien yang dirujuk tabel lain.

-- ===== ARTIKEL =====
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  judul text not null check (length(btrim(judul)) between 2 and 200),
  kategori text not null default '' check (length(kategori) <= 60),
  -- Markdown terbatas, diurai `src/lib/artikel/urai.ts` (tanpa HTML mentah).
  isi text not null default '' check (length(isi) <= 60000),
  terbit boolean not null default false,
  diterbitkan_pada timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Artikel terbit tanpa isi adalah halaman kosong di situs yang sudah live.
  constraint articles_terbit_lengkap check (
    not terbit or (length(btrim(isi)) > 0 and length(btrim(kategori)) > 0 and diterbitkan_pada is not null)
  )
);

create trigger trg_articles_updated_at
  before update on public.articles
  for each row execute function public.sentuh_updated_at();

alter table public.articles enable row level security;
revoke all on public.articles from anon;
grant select on public.articles to anon;
grant delete on public.articles to authenticated;

create policy "articles: baca publik" on public.articles
  for select to anon using (terbit);
create policy "articles: baca terbit" on public.articles
  for select to authenticated using (terbit);
create policy "articles: staf kelola" on public.articles
  for all to authenticated
  using (user_role() in ('admin', 'owner'))
  with check (user_role() in ('admin', 'owner'));

-- ===== TESTIMONI =====
create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  nama text not null check (length(btrim(nama)) between 2 and 80),
  keterangan text not null default '' check (length(keterangan) <= 160),
  kutipan text not null default '' check (length(kutipan) <= 500),
  -- Kunci objek di bucket R2 privat `testimoni/<id>/<acak>.<ext>`; diputar
  -- lewat /api/testimoni/[id]/video yang menerbitkan presigned GET.
  video_objek text,
  video_mime text check (video_mime in ('video/mp4', 'video/webm')),
  izin_dikonfirmasi boolean not null default false,
  terbit boolean not null default false,
  urutan integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint testimonials_video_berpasangan check ((video_objek is null) = (video_mime is null)),
  -- Sama dengan material_videos_bentuk_objek: PATCH langsung PostgREST oleh
  -- admin tidak bisa menunjuk objek milik materi atau baris lain.
  constraint testimonials_bentuk_objek check (
    video_objek is null
    or (video_mime = 'video/mp4'  and video_objek ~ ('^testimoni/' || id::text || '/[A-Za-z0-9._-]{1,120}\.mp4$'))
    or (video_mime = 'video/webm' and video_objek ~ ('^testimoni/' || id::text || '/[A-Za-z0-9._-]{1,120}\.webm$'))
  ),
  -- Aturan handoff dijaga di basis data, bukan hanya di tombol panel.
  constraint testimonials_terbit_berizin check (
    not terbit or (izin_dikonfirmasi and video_objek is not null)
  )
);

create trigger trg_testimonials_updated_at
  before update on public.testimonials
  for each row execute function public.sentuh_updated_at();

alter table public.testimonials enable row level security;
revoke all on public.testimonials from anon;
grant select on public.testimonials to anon;
grant delete on public.testimonials to authenticated;

create policy "testimonials: baca publik" on public.testimonials
  for select to anon using (terbit);
create policy "testimonials: baca terbit" on public.testimonials
  for select to authenticated using (terbit);
create policy "testimonials: staf kelola" on public.testimonials
  for all to authenticated
  using (user_role() in ('admin', 'owner'))
  with check (user_role() in ('admin', 'owner'));

-- ===== ISI AWAL =====
-- Lima artikel pertama dari owner (salinan utuh di docs/articles/). Judul &
-- kategori dipisah dari markdown; urutan tampil = diterbitkan_pada terbaru.
insert into public.articles (slug, judul, kategori, isi, terbit, diterbitkan_pada) values
  ('kenapa-orang-tua-perlu-belajar', 'Kenapa Orang Tua Perlu Belajar Sebelum Bayi Lahir, dan Kenapa Bukan Hanya Ibu', 'Persiapan menjadi orang tua', $isi$Merawat bayi tidak harus langsung mahir pada hari pertama. Menggendong, mengganti popok, mengenali tanda lapar, dan menenangkan bayi adalah keterampilan yang bisa dipelajari bersama.

## Belajar sebelum bayi lahir, untuk apa?

Setelah kelahiran, keluarga perlu menyesuaikan diri sambil menghadapi kurang tidur dan banyak nasihat. Studi terhadap ibu baru menunjukkan bahwa saran perawatan bayi yang diterima dapat berbeda dari rekomendasi yang berlaku, termasuk saran dari keluarga maupun tenaga kesehatan [1]. Karena itu, pilih informasi yang jelas sumbernya dan latih langkah dasarnya sebelum dibutuhkan.

Edukasi antenatal dalam sejumlah penelitian berkaitan dengan meningkatnya keyakinan ibu menghadapi persalinan dan berkurangnya rasa takut melahirkan [2]. Penelitian ini terutama tentang persiapan persalinan. Untuk keterampilan merawat bayi, praktik dengan umpan balik memberi kesempatan keluarga mencoba, bertanya, dan mengulang.

## Ayah dan pengasuh utama juga perlu ikut

Dalam satu studi pada ayah yang baru pertama memiliki bayi, sesi edukasi 50 menit yang mencakup video, penjelasan, demonstrasi, dan praktik meningkatkan pengetahuan serta rasa percaya diri perawatan bayi pada satu bulan setelah kelahiran dibanding kelompok pembanding [3]. Sebuah meta-analisis juga menemukan angka ASI eksklusif yang lebih tinggi hingga usia tiga bulan pada kelompok dengan intervensi dukungan ayah [4].

Bagi pasangan, perannya bisa konkret: belajar menggendong dan mengganti popok, menyiapkan kebutuhan ibu, serta mengetahui kapan bayi perlu diperiksa. Anggota keluarga lain yang akan merawat bayi sebaiknya mempelajari langkah yang sama.

## Saat memilih kelas

Cari kesempatan untuk mencoba keterampilan dasar, menerima koreksi yang jelas, melibatkan pengasuh utama, dan membawa pulang bahan yang bisa dibaca ulang. Di PADMA, **Shishu Nurturing Academy** mengajak orang tua dan pengasuh mempraktikkan perawatan bayi baru lahir dengan panduan fasilitator.

### Referensi

1. Eisenberg SR, et al. Maternal report of advice received for infant care. *Pediatrics*. 2015;136:e315–e322. https://pubmed.ncbi.nlm.nih.gov/26216322/
2. Zaman A, et al. The role of antenatal education on maternal self-efficacy, fear of childbirth, and birth outcomes: a systematic review and meta-analysis. *Eur J Midwifery*. 2025;9:13. https://doi.org/10.18332/ejm/200747
3. An HS, Bang KS. Effects of newborn care education for first-time fathers on their knowledge and confidence in newborn care at postpartum one month. *J Korean Acad Nurs*. 2014;44:428–436. https://pubmed.ncbi.nlm.nih.gov/25231808/
4. Zhou SS, et al. The role of paternal support in breastfeeding outcomes: a meta-analytic review. *Int Breastfeed J*. 2024;19:84. https://doi.org/10.1186/s13006-024-00694-1
$isi$, true, now() - interval '0 minutes'),
  ('kenapa-ibu-hamil-mudah-lelah', 'Kenapa Ibu Hamil Mudah Lelah, dan Apa yang Bisa Membantu', 'Kehamilan', $isi$Lelah saat hamil umum terjadi dan bukan tanda Anda kurang kuat. Namun, lelah yang berat atau berubah mendadak tetap perlu dinilai.

## Mengapa energi terasa berbeda?

Perubahan hormon, kebutuhan tubuh selama kehamilan, dan tidur yang terganggu dapat berperan. Keluhan dapat muncul pada trimester mana pun: sebagian ibu lebih nyaman pada trimester kedua, sementara yang lain tetap lelah. Dalam penelitian terhadap 605 ibu hamil di Tabriz, 94,2% melaporkan kelelahan [1].

## Kapan perlu diperiksa?

Hubungi dokter atau bidan bila lelah sangat berat, mengganggu kegiatan, menetap meski sudah beristirahat, atau disertai pucat, berdebar, pusing, sesak, atau suasana hati yang terus menurun. Pemeriksaan dapat menilai apakah ada kondisi seperti anemia atau masalah lain yang membutuhkan penanganan. **Segera cari pertolongan** bila sesak berat, nyeri dada, atau pingsan.

## Langkah yang bisa dicoba

Beristirahat ketika memungkinkan, makan teratur, cukup minum, dan lakukan gerak ringan sesuai kondisi kehamilan. Untuk tidur, gunakan bantal penyangga dan pilih posisi miring yang nyaman. Bila dokter memberikan pembatasan aktivitas, ikuti petunjuk tersebut.

Pijat relaksasi dapat menjadi pilihan untuk kenyamanan, bukan pengobatan penyebab kelelahan. Tinjauan atas uji klinis menunjukkan potensi manfaat untuk stres, nyeri punggung atau tungkai, dan suasana hati, meski kualitas bukti masih terbatas [2,3]. Sebelum sesi, sampaikan usia kehamilan, keluhan, dan komplikasi kepada terapis; bila ada komplikasi atau gejala baru, mintalah penilaian dokter lebih dulu. Gunakan posisi miring atau duduk bersandar dan hentikan bila tidak nyaman.

Di PADMA, **Garbha Relief** menawarkan pijat relaksasi kehamilan oleh terapis. Melalui **Garbha Partner Lab**, pasangan belajar sentuhan nyaman yang bisa dipraktikkan di rumah.

### Referensi

1. Effati-Daryani F, et al. Fatigue and sleep quality in different trimesters of pregnancy. *Sleep Sci*. 2021;14(Spec 1):69–74. https://pmc.ncbi.nlm.nih.gov/articles/PMC8663733/
2. Mueller SM, et al. Effects, side effects and contraindications of relaxation massage during pregnancy: a systematic review of randomized controlled trials. *J Clin Med*. 2021. https://pubmed.ncbi.nlm.nih.gov/34441781/
3. Hall HG, et al. The effectiveness of massage for reducing pregnant women's anxiety and depression: systematic review and meta-analysis. *Midwifery*. 2020. https://pubmed.ncbi.nlm.nih.gov/32827841/
$isi$, true, now() - interval '1 minutes'),
  ('bergerak-selama-hamil-yoga-flow', 'Tetap Bergerak Selama Hamil: Yoga dan Gerak yang Aman', 'Kehamilan', $isi$Pada kehamilan tanpa komplikasi, aktivitas fisik umumnya dianjurkan. Pilih gerak yang nyaman dan sesuaikan dengan keadaan Anda, bukan mengejar posisi yang sulit.

## Berapa banyak gerak?

ACOG menganjurkan sekitar **150 menit aktivitas aerobik intensitas sedang per minggu** selama kehamilan tanpa kontraindikasi, dapat dibagi menjadi sesi lebih singkat. Anda seharusnya masih bisa bercakap-cakap saat bergerak. Jika sebelumnya jarang berolahraga, mulai perlahan. Cukup minum, hindari kepanasan dan *hot yoga*, serta berhenti bila tubuh terasa tidak nyaman [1].

Yoga kehamilan dapat menjadi salah satu cara bergerak dan melatih napas. Tinjauan penelitian menemukan kemungkinan manfaat untuk beberapa gejala psikologis, meski bentuk kelas dan kualitas studi beragam [2]. Yoga bukan cara untuk menjamin jenis persalinan, mempercepat pembukaan, atau mengubah posisi bayi.

## Contoh gerak yang bisa disesuaikan

- **Duduk bersandar dan bernapas perlahan:** tambahkan bantal agar panggul nyaman.
- **Cat–cow dalam posisi merangkak:** lakukan dengan rentang gerak kecil, tanpa memaksa punggung.
- **Child's pose dengan lutut cukup lebar:** beri ruang untuk perut dan gunakan bantal bila perlu.
- **Berdiri dengan tumpuan atau squat dangkal:** pegang kursi yang kokoh; lewati bila menyebabkan nyeri atau tidak stabil.
- **Relaksasi miring ke kiri atau kanan:** pilih sisi yang nyaman dan gunakan bantal penyangga.

Hindari gerakan yang menekan perut, berisiko jatuh, atau memaksa kelenturan. Setelah sekitar 20 minggu, jangan berlama-lama telentang saat latihan; bila pusing, segera ubah posisi [1]. Tidak semua gerak di atas cocok untuk semua orang, sehingga penyesuaian perlu dilakukan berdasarkan kondisi kehamilan.

**Hentikan latihan dan hubungi tenaga kesehatan** bila muncul perdarahan, cairan keluar dari vagina, kontraksi teratur yang nyeri, pusing atau hampir pingsan, sakit kepala, nyeri dada, sesak sebelum beraktivitas, kelemahan yang mengganggu keseimbangan, atau nyeri dan bengkak betis [1]. Bila ada preeklamsia, ketuban pecah, perdarahan, masalah plasenta, atau risiko persalinan prematur, konsultasikan dulu aktivitas dengan dokter yang merawat.

Di PADMA, **Garbha Flow** memandu gerak dan napas kehamilan dengan pilihan modifikasi, melalui PADMA Home atau PADMA Live. Sebelum sesi di rumah, ada **Cek Kesiapan Sesi** singkat untuk menyesuaikan gerakan.

### Referensi

1. ACOG. Physical Activity and Exercise During Pregnancy and the Postpartum Period. Committee Opinion No. 804. *Obstet Gynecol*. 2020;135:e178–e188. https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2020/04/physical-activity-and-exercise-during-pregnancy-and-the-postpartum-period
2. The characteristics and effectiveness of pregnancy yoga interventions: a systematic review and meta-analysis. *BMC Pregnancy Childbirth*. 2022;22:250. https://doi.org/10.1186/s12884-022-04474-9
$isi$, true, now() - interval '2 minutes'),
  ('merawat-newborn-dan-pijat-bayi', 'Merawat Newborn dan Sentuhan Bayi: Orang Tua Bisa Belajar', 'Setelah melahirkan', $isi$Takut salah saat pertama kali menggendong atau memandikan bayi adalah hal yang wajar. Keterampilan itu dapat dilatih pelan-pelan bersama orang yang akan merawat bayi sehari-hari.

## Mulai dari keterampilan dasar

Coba cara menopang kepala dan leher, mengganti popok, menyiapkan lingkungan tidur yang aman, serta mengenali tanda bayi lapar dan tanda bahaya. Dalam studi pada ayah yang baru pertama memiliki bayi, edukasi dengan demonstrasi dan praktik meningkatkan pengetahuan serta rasa percaya diri satu bulan setelah kelahiran dibanding kelompok pembanding [1]. Saran dari berbagai sumber juga dapat berbeda; bila menyangkut kesehatan bayi, utamakan petunjuk tenaga kesehatan yang memeriksanya [2].

## Bagaimana dengan pijat bayi?

Tinjauan Cochrane pada bayi sehat di bawah enam bulan belum menemukan bukti yang cukup kuat bahwa pijat meningkatkan kesehatan atau perkembangan bayi berisiko rendah [3]. Di PADMA, orang tua mempelajari sentuhan yang lembut dan responsif, tanpa klaim manfaat medis atau tumbuh kembang tertentu.

Pilih saat bayi terjaga, tenang, dan bersedia disentuh. Gunakan tekanan lembut, amati reaksinya, dan berhenti bila bayi menghindar, rewel, atau menangis. Hindari pijat bila bayi demam atau sakit, jangan tekan area yang nyeri atau baru disuntik, dan jangan memaksa bayi menyelesaikan sesi. Untuk bayi prematur atau yang memiliki kondisi medis, tanyakan lebih dahulu kepada dokter yang merawat.

## Tanda bayi perlu segera diperiksa

Segera bawa bayi ke fasilitas kesehatan bila ia tidak mau atau sulit menyusu, sangat lemas atau sulit dibangunkan, mengalami kejang, demam atau terasa dingin, bernapas sulit atau cepat, kuning pada 24 jam pertama, atau telapak tangan dan kaki tampak kuning [4].

Di PADMA, **Shishu Nurturing Academy** membantu keluarga mempraktikkan perawatan bayi baru lahir. **Shishu Parents Touch** mengajak orang tua belajar sentuhan lembut sambil membaca isyarat bayi.

### Referensi

1. An HS, Bang KS. Effects of newborn care education for first-time fathers on their knowledge and confidence in newborn care at postpartum one month. *J Korean Acad Nurs*. 2014;44:428–436. https://pubmed.ncbi.nlm.nih.gov/25231808/
2. Eisenberg SR, et al. Maternal report of advice received for infant care. *Pediatrics*. 2015;136:e315–e322. https://pubmed.ncbi.nlm.nih.gov/26216322/
3. Bennett C, Underdown A, Barlow J. Massage for promoting mental and physical health in typically developing infants under the age of six months. *Cochrane Database Syst Rev*. 2013;(4):CD005038. https://doi.org/10.1002/14651858.CD005038.pub3
4. WHO. Newborns: improving survival and well-being. https://www.who.int/news-room/fact-sheets/detail/newborns-reducing-mortality/
$isi$, true, now() - interval '3 minutes'),
  ('asi-bukan-kompetisi', 'ASI Bukan Kompetisi: Mengapa Menyusui Bisa Terasa Sulit?', 'Menyusui', $isi$“Dulu semua ibu bisa menyusui, kenapa sekarang banyak yang gagal?” Anggapan bahwa semua ibu dulu berhasil tidak didukung data yang memadai. Kesulitan menyusui bukan ukuran kekuatan atau kasih sayang seorang ibu.

## Apa yang membuat perjalanan menyusui berbeda?

Ibu dan bayi perlu belajar bersama. Pelekatan, kenyamanan ibu, kondisi bayi, dukungan keluarga, serta waktu dan fasilitas saat kembali bekerja dapat memengaruhi pengalaman menyusui. Di sisi lain, pemasaran susu formula dapat menambah kebingungan: dalam survei WHO–UNICEF di delapan negara yang diterbitkan pada 2022, **51% orang tua dan ibu hamil yang disurvei** mengatakan pernah menjadi sasaran pemasaran formula [1].

Banyak ibu yang berhenti menyusui menyebut *merasa* ASI tidak cukup. Sebuah tinjauan terhadap 27 studi menemukan sekitar separuh ibu yang menghentikan menyusui melaporkan persepsi tersebut sebagai alasan [2]. Perasaan ASI kurang perlu didengarkan, lalu dinilai bersama kondisi bayi. Bila bayi sulit menyusu, tampak lemas, atau pertambahan berat badannya dikhawatirkan, mintalah penilaian tenaga kesehatan.

## Mengapa angka ASI eksklusif bisa berbeda?

SKI 2023 melaporkan **55,5% anak usia 6–23 bulan** pernah mendapat ASI eksklusif selama enam bulan penuh [3]. BPS mengukur pemberian ASI eksklusif pada **bayi yang saat survei berusia di bawah enam bulan** [4]. Perbedaan kelompok usia dan indikator ini menjelaskan mengapa angkanya bisa berbeda.

## Menyusui adalah kerja tim

Pasangan dapat mengambil alih pekerjaan rumah, membantu kebutuhan ibu, mendampingi kunjungan bila ada masalah menyusu, dan ikut menyusun rencana ketika ibu kembali bekerja. Meta-analisis menemukan angka ASI eksklusif yang lebih tinggi pada usia tiga bulan dalam kelompok dengan intervensi dukungan ayah [5].

ASI bukan kompetisi. Bila perlu tambahan susu karena alasan medis atau pilihan pemberian makan perlu diubah, diskusikan kebutuhan bayi dengan tenaga kesehatan tanpa menyalahkan ibu. Di PADMA, **Lactation Hero** membantu keluarga mempersiapkan prinsip dan praktik umum menyusui; **Return to Work** membantu menyusun rencana memerah ASI dan koordinasi pengasuh.

### Referensi

1. WHO dan UNICEF. *How the marketing of formula milk influences our decisions on infant feeding*. 2022. https://www.who.int/publications/i/item/9789240044609
2. Huang Y, et al. The rates and factors of perceived insufficient milk supply: a systematic review. *Matern Child Nutr*. 2022;18:e13255. https://doi.org/10.1111/mcn.13255
3. Kementerian Kesehatan RI. Hasil Utama SKI 2023: definisi dan proporsi ASI eksklusif enam bulan. https://www.badankebijakan.kemkes.go.id/daftar-frequently-asked-question-seputar-hasil-utama-ski-2023/hasil-utama-ski-2023/
4. Badan Pusat Statistik. Persentase bayi usia kurang dari enam bulan yang mendapat ASI eksklusif menurut provinsi. https://www.bps.go.id/id/statistics-table/2/MTM0MCMy/persentase-bayi-usia-kurang-dari-6-bulan-yang-mendapatkan-asi-eksklusif-menurut-provinsi--persen-.html
5. Zhou SS, et al. The role of paternal support in breastfeeding outcomes: a meta-analytic review. *Int Breastfeed J*. 2024;19:84. https://doi.org/10.1186/s13006-024-00694-1
$isi$, true, now() - interval '4 minutes')
on conflict (slug) do nothing;
