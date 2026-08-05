-- =====================================================================================
-- WP-VINCULO-2 — create_patient passa a REIVINDICAR o placeholder que o gatilho criou,
-- em vez de criar um SEGUNDO profile para a mesma pessoa.
--
-- O DEFEITO QUE ISTO FECHA (o de verdade, medido em produção)
-- O WP-VINCULO-1 ensinou create_patient a reivindicar uma CONTA de auth livre. Só que,
-- depois de qualquer login Google completo, NÃO EXISTE conta livre: o gatilho
-- handle_new_user cria um profile para toda conta que confirma o e-mail (histórico:
-- pending_patient=7, linked=1, 8 de 8). Ou seja, o caminho do VINCULO-1 tem hoje ZERO
-- linhas aplicáveis, e o cenário real — a pessoa loga ANTES de a clínica cadastrar —
-- continuava produzindo um segundo profile órfão e a tela "Acesso pendente" para sempre.
--
-- O estado real é este, e é o que o gatilho deixa:
--     profiles: role='patient', status='pending', auth_user_id preenchido,
--               SEM linha em patients, SEM linha em professionals.
-- É o estado de neemiasvanda@gmail.com e vandareginacarvalhosantos@gmail.com neste
-- momento. Este WP faz `create_patient` pendurar o `patients` NESSE profile.
--
-- ⚠️ AS SEIS TRAVAS, TODAS DENTRO DO PREDICADO DA BUSCA — nunca num `if` depois.
--   Estar no predicado não é estilo: um candidato que falhe QUALQUER uma delas não
--   aparece no conjunto, então não existe caminho de código que o alcance.
--     1. e-mail casa pela receita IDÊNTICA à do gatilho: lower(btrim(...)) nos dois lados
--     2. role = 'patient'
--     3. status = 'pending'
--     4. NÃO existe linha em `patients` para aquele profile
--     5. NÃO existe linha em `professionals` para aquele profile
--     6. auth_user_id IS NOT NULL   <-- ACRESCENTADA POR MIM, ver nota abaixo
--   E, fora do predicado, a exigência de CARDINALIDADE: exatamente UM candidato.
--   Zero ou dois-ou-mais => NÃO reivindica, cria órfão (o comportamento de hoje).
--
--   NOTA SOBRE A TRAVA 6 (declarada porque não estava na lista do escopo): ela é
--   ESTRITAMENTE MAIS RESTRITIVA, e existe por dois motivos. (a) "o profile que o
--   GATILHO criou" é, por definição, um profile COM auth_user_id — o gatilho sempre o
--   preenche com new.id. (b) É ela que torna DEMONSTRÁVEL a disjunção com o VINCULO-1
--   (ver bloco ORDEM abaixo). Sem ela, um profile pendente e SEM uid seria reivindicado
--   aqui e sairia do alcance do VINCULO-1 — reusaríamos a linha sem vincular ninguém, e
--   a pessoa continuaria sem entrar. Hoje não existe profile assim (0 linhas), mas a
--   trava impede que a combinação nasça no futuro.
--
--   O QUE É INTOCÁVEL, e por quê: profile que já virou paciente (trava 4), que é
--   profissional (trava 5), ou que está ativo (trava 3). Reivindicar profile de gente é
--   o pior erro possível deste WP — seria pendurar o prontuário de uma paciente na
--   identidade de outra pessoa.
--
-- ORDEM ENTRE OS DOIS CAMINHOS, E POR QUE NÃO SE SOBREPÕEM
--   1º VINCULO-2 (placeholder). 2º VINCULO-1 (conta livre), só se o 1º não reivindicou.
--   A disjunção é por construção, não por sorte:
--     · candidato do VINCULO-2 tem auth_user_id NOT NULL (trava 6) => aquele uid está
--       OCUPADO => ele nunca satisfaz o predicado do VINCULO-1, que exige
--       `not exists (select 1 from public.profiles p where p.auth_user_id = u.id)`;
--     · candidato do VINCULO-1 é uma conta SEM profile nenhum => não há placeholder dela
--       para o VINCULO-2 achar.
--   Os conjuntos são disjuntos. A ordem existe só para o caso degenerado de e-mails
--   repetidos entre contas distintas: reusar a identidade que já existe é sempre melhor
--   do que criar mais uma linha.
--
-- O QUE A REIVINDICAÇÃO ESCREVE, e o que ela NÃO TOCA
--   ESCREVE: full_name (o nome que a clínica digitou é o do prontuário) e status
--            ('pending' -> 'active', porque a pessoa deixou de estar pendente).
--   NÃO TOCA: auth_user_id (é o vínculo do gatilho — mexer nele seria trocar a
--            identidade), role (já é 'patient'), email (fica a forma canônica que veio
--            do Google, não a que o staff digitou).
--
-- CORRIDA (dois cadastros simultâneos do mesmo e-mail): o SELECT do id usa FOR UPDATE.
--   O segundo cadastro fica bloqueado até o primeiro comitar e, ao reavaliar a linha
--   travada, vê status='active' — a trava 3 falha, ele não reivindica e cria órfão.
--   Isso importa porque `patients` NÃO tem unique em profile_id: sem essa serialização,
--   dois `patients` poderiam nascer apontando para o MESMO profile.
--
-- NÃO É ORÁCULO: o retorno é `uuid` (patients.id) reivindicando ou não. Mesmo tipo,
--   mesmo caminho de saída, zero exceção ou aviso condicional.
--
-- handle_new_user (ÂNCORA) NÃO É TOCADA. Nenhuma policy, tabela, coluna, privilégio ou
-- FK nova. Só o corpo de create_patient muda; a assinatura fica idêntica.
--
-- KILL SWITCH / ROLLBACK: reaplicar a definição do WP-VINCULO-1 (arquivo
--   20260810090000_wp_vinculo1_create_patient_claims_auth_user.sql) — assinatura
--   idêntica, corpo sem o bloco de reivindicação. Nada mais a desfazer.
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
  v_claim_count int;
  v_claim_profile uuid;
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

  -- WP-VINCULO-2 (1º): a pessoa pode já ter logado, e nesse caso o gatilho deixou um
  -- PLACEHOLDER. Reivindica esse profile em vez de criar um segundo. As seis travas estão
  -- todas no predicado; a cardinalidade (exatamente 1) fica no `if`, como no gatilho.
  if v_email is not null then
    select count(*)
      into v_claim_count
    from public.profiles p
    where p.email is not null
      and lower(btrim(p.email)) = lower(btrim(v_email))
      and p.auth_user_id is not null
      and p.role = 'patient'
      and p.status = 'pending'
      and not exists (select 1 from public.patients pt where pt.profile_id = p.id)
      and not exists (select 1 from public.professionals pr where pr.profile_id = p.id);

    if v_claim_count = 1 then
      -- FOR UPDATE serializa contra outro cadastro do mesmo e-mail: o perdedor reavalia
      -- a linha travada, vê status='active' e cai fora (vira órfão), em vez de pendurar
      -- um segundo `patients` no mesmo profile.
      select p.id
        into v_claim_profile
      from public.profiles p
      where p.email is not null
        and lower(btrim(p.email)) = lower(btrim(v_email))
        and p.auth_user_id is not null
        and p.role = 'patient'
        and p.status = 'pending'
        and not exists (select 1 from public.patients pt where pt.profile_id = p.id)
        and not exists (select 1 from public.professionals pr where pr.profile_id = p.id)
      limit 1
      for update;
    end if;
  end if;

  if v_claim_profile is not null then
    -- REIVINDICA. auth_user_id, role e email ficam como estão: o vínculo é o do gatilho.
    update public.profiles
       set full_name = btrim(p_full_name),
           status    = 'active'
     where id = v_claim_profile
    returning id into v_profile_id;
  else
    -- WP-VINCULO-1 (2º): não havia placeholder. A conta pode existir e estar LIVRE —
    -- mesma receita de normalização do gatilho; só reivindica uid que nenhum profile usa.
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

    -- profile do paciente. role SEMPRE 'patient'. auth_user_id só quando reivindicado acima.
    begin
      insert into public.profiles (auth_user_id, role, full_name, email, status)
      values (v_auth_user_id, 'patient', btrim(p_full_name), v_email, 'active')
      returning id into v_profile_id;
    exception when unique_violation then
      -- Sem reivindicação em curso, 23505 aqui é erro de verdade: propaga.
      if v_auth_user_id is null then raise; end if;
      -- Corrida com o gatilho: o uid foi tomado entre o SELECT e o INSERT. Degrada para
      -- o comportamento de hoje em vez de derrubar o cadastro.
      v_auth_user_id := null;
      insert into public.profiles (auth_user_id, role, full_name, email, status)
      values (null, 'patient', btrim(p_full_name), v_email, 'active')
      returning id into v_profile_id;
    end;
  end if;

  insert into public.patients (profile_id, clinic_id, goal, birth_date, sex, height_cm, start_weight, current_weight, target_weight, start_date)
  values (v_profile_id, p_clinic_id, nullif(btrim(coalesce(p_goal,'')),''), p_birth_date, p_sex, p_height_cm, p_start_weight, p_start_weight, p_target_weight, coalesce(p_start_date, current_date)) returning id into v_patient_id;
  if v_caller_prof is not null then insert into public.professional_patient_links (professional_id, patient_id, is_external, status) values (v_caller_prof, v_patient_id, false, 'active'); end if;
  if p_anamnese_weight is not null or p_anamnese_body_fat_pct is not null or nullif(btrim(coalesce(p_anamnese_method,'')),'') is not null or nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then
    insert into public.body_assessments (patient_id, professional_id, method, weight, body_fat_pct, measurements)
    values (v_patient_id, v_caller_prof, nullif(btrim(coalesce(p_anamnese_method,'')),''), p_anamnese_weight, p_anamnese_body_fat_pct,
            case when nullif(btrim(coalesce(p_anamnese_notes,'')),'') is not null then jsonb_build_object('notes', btrim(p_anamnese_notes)) else null end);
  end if;
  -- Retorno IDÊNTICO reivindicando ou não: patients.id, sempre.
  return v_patient_id;
end $function$;

revoke all     on function public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date) from public, anon;
grant  execute on function public.create_patient(uuid,text,text,date,text,numeric,text,numeric,numeric,text,numeric,numeric,text,date) to authenticated;

-- Ledger humano.
insert into public.schema_migration_log (version, filename, description, session)
values ('20260812090000','20260812090000_wp_vinculo2_create_patient_claims_placeholder.sql',
  'WP-VINCULO-2: create_patient passa a REIVINDICAR o placeholder do gatilho (role=patient, '
  'status=pending, com auth_user_id, SEM patients e SEM professionals) em vez de criar um segundo '
  'profile. Seis travas dentro do predicado + cardinalidade exatamente 1 (0 ou 2+ => orfao). '
  'FOR UPDATE serializa cadastros simultaneos do mesmo e-mail (patients nao tem unique em '
  'profile_id). Reivindicar escreve SO full_name e status; auth_user_id, role e email ficam. '
  'Fecha o caso real login-antes-do-cadastro, que o VINCULO-1 nao alcanca porque depois de um '
  'login completo nao existe uid livre. Os dois caminhos sao DISJUNTOS: candidato do VINCULO-2 '
  'tem uid ocupado, candidato do VINCULO-1 nao tem profile nenhum. handle_new_user (ANCORA) '
  'intocada; nenhuma policy, tabela, coluna, privilegio ou FK nova; assinatura inalterada.',
  'WP-VINCULO-2')
on conflict (version) do nothing;
