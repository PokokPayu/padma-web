-- ============================================================================
-- PENJAGA PRA-PASSPORT
-- ============================================================================
-- (1) booking_requests: policy "booking: klien ajukan" hanya memeriksa
--     KEPEMILIKAN, tidak NILAI. Terbukti hari ini: klien menyisipkan barisnya
--     sendiri dengan status='dikonfirmasi' (HTTP 201) — permintaan itu lenyap
--     dari antrean admin sambil tampil "dikonfirmasi" di passport.
--     Bentuk masalah yang sama dengan profiles.role dan clients.user_id, jadi
--     obatnya sama: trigger yang mengikat NILAI, bukan hak tabel.

create or replace function public.guard_booking_status()
returns trigger
language plpgsql
as $$
begin
  -- Bersarang, bukan `and`: plpgsql tidak menjamin short-circuit.
  if current_user in ('anon', 'authenticated', 'authenticator') then
    if user_role() = 'klien' then
      if tg_op = 'INSERT' and new.status is distinct from 'menunggu'::booking_status then
        raise exception 'permintaan jadwal baru selalu berstatus menunggu'
          using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and new.status is distinct from old.status then
        raise exception 'status permintaan jadwal hanya boleh diubah staf'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_booking_status() from public, anon;

create trigger trg_guard_booking_status
  before insert or update on public.booking_requests
  for each row execute function public.guard_booking_status();

-- (2) Nama bidan untuk klien, TANPA membuka no_hp.
--     Klien tidak punya hak baca `partners` (dan itu benar — no_hp mitra bukan
--     urusan klien). Riwayat sesi tetap perlu menyebut siapa yang datang, jadi
--     dibuka lewat view berkolom sempit. security_invoker=off disengaja:
--     view inilah batas kolomnya.
create view public.partner_publik
  with (security_invoker = off) as
  select id, nama from public.partners where aktif = true;

revoke all on public.partner_publik from anon;
grant select on public.partner_publik to authenticated;

-- (3) Invarian "satu auth user ↔ satu baris clients".
--     Rumus materi di aplikasi dan policy RLS hanya setara bila invarian ini
--     berlaku; sekarang clients.user_id hanya index biasa.
create unique index clients_user_id_unik
  on public.clients (user_id) where user_id is not null;
