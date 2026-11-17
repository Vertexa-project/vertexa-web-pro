-- Lista de Pacientes: "última atividade" passa a contar também a mensagem do PACIENTE na conversa,
-- o mesmo sinal que o reengajamento (A6, private.patient_last_interaction_at) já usa.
-- Só objetos novos. Devolve só pacientes que quem chama pode ver (private.can_access_patient).
create or replace function public.patients_last_message_at()
returns table (patient_id uuid, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.patient_id, m.created_at
  from public.chat_channels c
  cross join lateral (
    select mm.created_at from public.chat_messages mm
    where mm.channel_id = c.id and mm.sender_role = 'patient'::public.user_role
    order by mm.created_at desc limit 1
  ) m
  where c.patient_id is not null and private.can_access_patient(c.patient_id)
$$;
revoke all on function public.patients_last_message_at() from public, anon;
grant execute on function public.patients_last_message_at() to authenticated;
