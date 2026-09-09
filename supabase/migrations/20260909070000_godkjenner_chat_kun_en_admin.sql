-- Chatten mellom admin og godkjennere skal kun være mellom Jan Henrik (ansatt-id 17) og
-- godkjennerne - den andre admin-kontoen (Jan Børre) skal ikke se eller kunne sende
-- meldinger her. Se samme sperre i js/arkiv-mer.js (GODKJENNER_CHAT_ADMIN_ID) og i
-- send-push-funksjonens varsling for 'godkjenner_melding'.
drop policy if exists "lese_godkjenner_meldinger" on godkjenner_meldinger;
drop policy if exists "sende_godkjenner_melding" on godkjenner_meldinger;

create policy "lese_godkjenner_meldinger" on godkjenner_meldinger for select
  using (exists (
    select 1 from current_ansatt()
    where rolle = 'godkjenner' or (rolle = 'admin' and id = 17)
  ));

create policy "sende_godkjenner_melding" on godkjenner_meldinger for insert
  with check (
    exists (
      select 1 from current_ansatt()
      where (rolle = 'godkjenner' or (rolle = 'admin' and id = 17))
        and id = godkjenner_meldinger.avsender_id
    )
  );
