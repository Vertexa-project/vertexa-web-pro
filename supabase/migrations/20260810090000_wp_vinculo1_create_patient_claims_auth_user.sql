-- =====================================================================================
-- WP-VINCULO-1 — create_patient passa a PROCURAR a conta de auth e nascer JÁ VINCULADA.
--
-- O DEFEITO QUE ISTO FECHA (medido em produção, retorno-vinculo-paciente.txt):
-- o vínculo paciente<->conta só era tentado UMA VEZ na vida da conta, pelo gatilho
-- `on_auth_user_created` (AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users).
-- Login comum mexe em `last_sign_in_at`, NÃO em `email_confirmed_at` => login não dispara
-- o gatilho. Logo, se a conta Google já existia quando a paciente foi cadastrada no painel,
-- a janela de vínculo já tinha fechado e `create_patient` criava um profile órfão
-- (auth_user_id NULL) que permanecia órfão PARA SEMPRE. O app resolve identidade por
-- auth.uid() -> profiles.auth_user_id -> patients.profile_id, não achava `patients`, e caía
-- em "Acesso pendente" com o cadastro existindo, intacto e inalcançável.
--
-- A CORREÇÃO É SIMÉTRICA, não substitutiva: o gatilho continua cobrindo
-- cadastro-primeiro-login-depois (comprovado: outcome 'linked'); esta mudança passa a cobrir
-- login-primeiro-cadastro-depois. Os dois mecanismos se compõem e NÃO se sobrepõem — a busca
-- aqui exige `auth_user_id` LIVRE, e o gatilho só reivindica profile com `auth_user_id` NULL.
--
-- O GATILHO NÃO É TOCADO. `public.handle_new_user` é ÂNCORA (H3) e sai desta migration byte
-- a byte. Nenhuma policy, nenhuma tabela, nenhuma coluna, NENHUMA FK NOVA.
--
-- RECEITA DE NORMALIZAÇÃO — IDÊNTICA à do gatilho, não equivalente. O gatilho compara
--     lower(btrim(email)) = lower(btrim(new.email))
-- e aqui se compara
--     lower(btrim(u.email)) = lower(btrim(v_email))
-- mesma função, mesma ordem, mesmos dois lados normalizados. Qualquer divergência aqui
-- reabriria o defeito em outra forma (casaria no cadastro e não no login, ou o inverso).
--
-- ANTI-ESCALAÇÃO — o que MUDA e o que NÃO muda no invariante do WP-APP-1:
--   INALTERADO: role SEMPRE 'patient' (hardcoded); autorização interna intacta (o chamador
--     tem de ser profissional/admin da clínica-alvo); search_path=''; EXECUTE só authenticated.
--   RELAXADO, sob trava: "auth_user_id NUNCA setado" passa a ser "auth_user_id setado APENAS
--     quando existe EXATAMENTE UMA conta em auth.users que (i) casa no e-mail normalizado,
--     (ii) tem e-mail CONFIRMADO, (iii) é Google, e (iv) NÃO é reivindicada por nenhum profile".
--
--   ⚠️ (iv) É A TRAVA OBRIGATÓRIA E NÃO PODE SAIR. Sem ela, cadastrar uma paciente com o
--   e-mail de alguém que já tem profile criaria um SEGUNDO profile para o mesmo auth_user_id
--   — duas identidades para a mesma conta, agora no sentido inverso do defeito original.
--   `private.current_profile_id()` resolve com `limit 1` SEM `order by`: com dois profiles o
--   papel da vítima passaria a ser não-determinístico (uma admin poderia resolver para o
--   profile de paciente criado por outrem). É sequestro de identidade, não cosmético.
--
--   (ii)+(iii) espelham o portão do gatilho e existem por um motivo específico: vincular a
--   uma conta de e-mail NÃO CONFIRMADO é o vetor clássico de tomada de conta (o atacante
--   registra a conta com o e-mail da vítima e espera alguém cadastrá-la). Com o portão, o
--   conjunto reivindicável aqui é SUBCONJUNTO do que o gatilho já reivindicaria. Se a conta
--   ainda não confirmou, o profile nasce órfão e o gatilho a vincula quando ela confirmar
--   (UPDATE OF email_confirmed_at) — os dois caminhos se completam sem buraco.
--
-- NÃO É ORÁCULO: o retorno é `uuid` (patients.id) nos DOIS casos — achou conta ou não achou.
--   Mesmo tipo, mesmo formato, mesmo caminho de sucesso, zero exceções/avisos condicionais.
--   Nada na RESPOSTA distingue os dois casos. (Limite declarado, de TABELA e não da RPC: o
--   chamador é staff da clínica, logo `can_see_profile` o deixa ler depois o `profiles` da
--   paciente — inclusive `auth_user_id`. Esse canal é pré-existente e está registrado no
--   retorno do WP; fechá-lo seria recorte de coluna, outro escopo.)
--
-- CORRIDA (login simultâneo ao cadastro): entre o SELECT e o INSERT o gatilho pode reivindicar
--   o uid. `profiles_auth_user_id_key` (índice único parcial) transformaria isso em 23505 e
--   derrubaria o cadastro inteiro. O sub-bloco degrada para o comportamento de hoje (profile
--   órfão) em vez de falhar — e só quando havia reivindicação em curso; sem reivindicação a
--   violação é erro de verdade e SOBE.
--
-- KILL SWITCH / ROLLBACK: reaplicar a definição anterior (WP-KANBAN K1, arquivo
--   20260730090000_wp_kanban_a_journey.sql, linhas 199-236) — assinatura idêntica, corpo sem
--   o bloco de busca. Nada mais a desfazer: esta migration não cria objeto algum.
-- =====================================================================================

create or replace function public.create_patient(
  p_clinic_id uuid, p_full_name text, p_email text default null, p_birth_date date default null,
  p_sex text default null, p_height_cm numeric default null, p_goal text default null,
  p_start_weight numeric default null, p_target_weight numeric default null,
  p_anamnese_method text default null, p_anamnese_weight numeric default null,
  p_anamnese_body_fat_pct numeric default null, p_anamnese_notes text default null,
  p_start_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller_profile uuid := private.current_profile_id();
  v_caller_prof uuid;
  v_profile_id uuid;
  v_patient_id uuid;
  v_email text;
  v_match_count int;
  v_auth_user_id uuid;
begin
  if v_caller_profile is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if btrim(coalesce(p_full_name,'')) = '' then raise exception 'full_name required' using errcode = '22023'; end if;
  if p_clinic_id is null then raise exception 'clinic_id required' using errcode = '22023'; end if;
  -- K1: data de início informada não pode ser FUTURA (marcos 30/60/90 nasceriam errados).
  if p_start_date is not null and p_start_date > current_date then
    raise exception 'create_patient: p_start_date cannot be in the future' using errcode = '22023';
  end if;
  select pr.id into v_caller_prof from public.professionals pr where pr.clinic_id = p_clinic_id and pr.profile_id = v_caller_profile limit 1;
  if v_caller_prof is null and not private.is_clinic_admin(p_clinic_id) then raise exception 'forbidden: caller is not staff of clinic' using errcode = '42501'; end if;

  v_email := nullif(btrim(coalesce(p_email,'')),'');

  -- WP-VINCULO-1: a conta pode já existir. Procura por e-mail com a receita do gatilho e,
  -- se achar UMA e ela estiver LIVRE, o profile nasce vinculado. Espelha handle_new_user:
  -- conta primeiro, só reivindica com count = 1 (0 ou 2+ => órfão, como hoje).
  if v_email is not null then
    select count(*)
      into v_match_count
    from auth.users u
    where u.email is not null
      and lower(btrim(u.email)) = lower(btrim(v_email))
      and u.email_confirmed_at is not null
      and (coalesce(u.raw_app_meta_data ->> 'provider' = 'google', false)
           or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google')
      and not exists (select 1 from public.profiles p where p.auth_user_id = u.id);

    if v_match_count = 1 then
      select u.id
        into v_auth_user_id
      from auth.users u
      where u.email is not null
        and lower(btrim(u.email)) = lower(btrim(v_email))
        and u.email_confirmed_at is not null
        and (coalesce(u.raw_app_meta_data ->> 'provider' = 'google', false)
             or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google')
        and not exists (select 1 from public.profiles p where p.auth_user_id = u.id)
      limit 1;
    end if;
  end if;

  -- 1) profile do paciente. role SEMPRE 'patient'. auth_user_id só quando reivindicado acima.
  begin
    insert into public.profiles (auth_user_id, role, full_name, email, status)
    values (v_auth_user_id, 'patient', btrim(p_full_name), v_email, 'active')
    returning id into v_profile_id;
  exception when unique_violation then
    -- Sem reivindicação em curso, 23505 aqui é erro de verdade: propaga.
    if v_auth_user_id is null then raise; end if;
    -- Corrida com o gatilho (ou com outro cadastro do mesmo e-mail): o uid foi tomado entre
    -- o SELECT e o INSERT. Degrada para o comportamento de hoje em vez de derrubar o cadastro.
    v_auth_user_id := null;
    insert into public.profiles (auth_user_id, role, full_name, email, status)
    values (null, 'patient', btrim(p_full_name), v_email, 'active')
    returning id into v_profile_id;
  end;

  insert into public.patients (profile_id, clinic_id, goal, birth_date, sex, height_cm, start_weight, current_weight, target_weight, start_date)
  values (v_profile_id, p_clinic_id, nullif(btrim(coalesce(p_goal,'')),''), p_birth_date, p_sex, p_height_cm, p_start_weight, p_start_weight, p_target_weight, coalesce(p_start_date, current_date)) returning id into v_patient_id;
  if v_caller_prof is not null then insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values (v_caller_prof, v_patient_id, false, 'active'); end if;
  if p_anamnese_weight is not null or p_anamnese_body_fat_pct is not null or nullif(btrim(coalesce(p_anamnese_method,'')),'') is not null or nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then
    insert into public.body_assessments (patient_id, professional_id, method, weight, body_fat_pct, measurements)
    values (v_patient_id, v_caller_prof, nullif(btrim(coalesce(p_anamnese_method,'')),''), p_anamnese_weight, p_anamnese_body_fat_pct,
            case when nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then jsonb_build_object('notes', btrim(p_anamnese_notes)) else null end);
  end if;
  -- Retorno IDÊNTICO nos dois casos (achou conta ou não): patients.id, sempre.
  return v_patient_id;
end $function$;

revoke all     on function public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date) from public, anon;
grant  execute on function public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date) to authenticated;

-- Ledger humano.
insert into public.schema_migration_log (version, filename, description, session)
values ('20260810090000','20260810090000_wp_vinculo1_create_patient_claims_auth_user.sql',
  'WP-VINCULO-1: create_patient passa a procurar a conta em auth.users por e-mail normalizado com a '
  'receita IDENTICA a do gatilho (lower(btrim(...))) e nasce JA VINCULADA quando acha exatamente uma '
  'conta confirmada, Google e LIVRE (nenhum profile com aquele auth_user_id) - trava obrigatoria contra '
  'criar segunda identidade para a mesma conta. Fecha a janela login-primeiro-cadastro-depois, que o '
  'gatilho nao cobre (ele so dispara em INSERT/UPDATE OF email_confirmed_at; login nao mexe nisso). '
  'Corrida com o gatilho degrada para profile orfao (comportamento de hoje) em vez de 23505. Retorno '
  'inalterado (patients.id) nos dois casos: nao vira oraculo de existencia de conta. handle_new_user '
  '(ANCORA) intocada; nenhuma policy, tabela, coluna ou FK nova; assinatura inalterada.',
  'WP-VINCULO')
on conflict (version) do nothing;
