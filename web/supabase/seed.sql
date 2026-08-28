insert into phases (id, nama_sanskrit, nama, urutan) values
  ('prekonsepsi','Sankalpa','Prekonsepsi / Promil',1),
  ('kehamilan','Garbha','Kehamilan',2),
  ('nifas','Purnama','Nifas & Menyusui',3),
  ('menopause','Sandhya','Menopause',4),
  ('newborn','Shishu','Newborn Care',5);

-- Katalog DUMMY (keputusan #12) — client mengganti sendiri lewat panel saat live.
insert into services (id, phase_id, nama) values
  ('11111111-1111-1111-1111-111111111101','prekonsepsi','Sankalpa Fertility Massage'),
  ('11111111-1111-1111-1111-111111111102','prekonsepsi','PADMA Flow Yoga - Prekonsepsi'),
  ('11111111-1111-1111-1111-111111111103','prekonsepsi','Konsultasi Nutrisi Prekonsepsi'),
  ('11111111-1111-1111-1111-111111111104','kehamilan','Garbha Relief Massage'),
  ('11111111-1111-1111-1111-111111111105','kehamilan','Prenatal Gentle Yoga'),
  ('11111111-1111-1111-1111-111111111106','nifas','Lactation Hero'),
  ('11111111-1111-1111-1111-111111111107','nifas','Purnama Recovery Massage'),
  ('11111111-1111-1111-1111-111111111108','menopause','Sandhya Balance Care'),
  ('11111111-1111-1111-1111-111111111109','newborn','Shishu Parent Touch'),
  ('11111111-1111-1111-1111-111111111110','newborn','Baby Massage Class');

insert into service_rates (service_id, harga_klien, honor_mitra) values
  ('11111111-1111-1111-1111-111111111101',425000,190000),
  ('11111111-1111-1111-1111-111111111102',250000,100000),
  ('11111111-1111-1111-1111-111111111103',300000,130000),
  ('11111111-1111-1111-1111-111111111104',350000,150000),
  ('11111111-1111-1111-1111-111111111105',275000,110000),
  ('11111111-1111-1111-1111-111111111106',450000,200000),
  ('11111111-1111-1111-1111-111111111107',400000,175000),
  ('11111111-1111-1111-1111-111111111108',375000,160000),
  ('11111111-1111-1111-1111-111111111109',400000,180000),
  ('11111111-1111-1111-1111-111111111110',300000,125000);

insert into packages (id, service_id, nama, jumlah_sesi) values
  ('22222222-2222-2222-2222-222222222201','11111111-1111-1111-1111-111111111101','Sankalpa Prima',8);

insert into partners (id, nama, no_hp) values
  ('33333333-3333-3333-3333-333333333301','Bidan Sri Wahyuni','0811-0000-0001'),
  ('33333333-3333-3333-3333-333333333302','Bidan Dewi Lestari','0811-0000-0002');

insert into app_settings (key, value) values ('nomor_wa','6287778400200');
