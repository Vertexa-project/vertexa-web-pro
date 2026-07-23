-- =====================================================================================
-- WP-SEED · TROCA DOS E-MAILS DOS 6 PERFIS SEMEADOS
--
-- ⚠️ NÃO É MIGRATION (vive em supabase/seeds/, fora de supabase/migrations/, fora dos ledgers).
--
-- PARA QUE SERVE: o seed (`wp_seed_test_data.sql`) cria os 6 perfis de profissional com e-mails
-- placeholder `PREENCHA.*@exemplo.com`. Enquanto eles não forem trocados pelos e-mails Google REAIS,
-- NINGUÉM consegue entrar: o trigger `public.handle_new_user` vincula o perfil semeado casando o
-- e-mail do perfil com o e-mail da conta Google no PRIMEIRO login.
--
-- COMO USAR: preencha o bloco de CONFIGURAÇÃO abaixo e rode. Deixar em branco ('') PULA aquele
-- perfil — dá para preencher aos poucos.
--
-- REGRAS DE SEGURANÇA (o script RECUSA e não grava nada se qualquer uma falhar):
--   · identifica os perfis SÓ pela âncora determinística md5('wp-seed:v2:'||chave)::uuid — nunca por nome;
--   · valida o formato do e-mail;
--   · recusa e-mail repetido entre os 6 informados;
--   · recusa e-mail que já exista em OUTRO profile do banco (o trigger exige match ÚNICO — dois
--     profiles com o mesmo e-mail fariam o login criar um perfil pendente novo);
--   · recusa se o perfil já tiver `auth_user_id` preenchido (a pessoa JÁ logou; trocar o e-mail
--     agora não revincularia nada — resolva isso antes, à mão);
--   · NUNCA toca em `auth_user_id` — ele TEM de continuar NULL até o primeiro login. É exatamente
--     isso que permite o vínculo (comprovado: com id sintético o trigger ignora o perfil semeado e
--     cria outro, pendente — e como não há FK para auth.users, a falha é SILENCIOSA).
--
-- IDEMPOTENTE: rodar de novo com os mesmos valores não muda nada.
-- REVERSÍVEL: o bloco comentado no fim do arquivo devolve os placeholders originais.
--
-- ⚠️ Use EXATAMENTE as contas Google que serão usadas na demonstração, e cadastre cada uma como
--    usuária de teste no Google Cloud (OAuth consent screen → Test users). Ver docs/ops/SEED_TEST_DATA.md.
-- =====================================================================================
do $emails$
declare
  -- ════════════════════════════════════════════════════════════════════════════════
  -- CONFIGURAÇÃO — PREENCHA COM OS E-MAILS GOOGLE REAIS ('' = pular este perfil)
  -- ════════════════════════════════════════════════════════════════════════════════
  e_alfa_owner  text := '';   -- Ana Prado      — dona/ADMIN da Clínica Alfa (nutricionista)
  e_alfa_edu    text := '';   -- Bruno Salles   — educador físico
  e_alfa_med    text := '';   -- Clara Vieira   — médico + nutricionista
  e_alfa_nodisc text := '';   -- Diego Martins  — SEM disciplina
  e_alfa_ext    text := '';   -- Elisa Rocha    — externa (1 paciente só)
  e_beta_owner  text := '';   -- Felipe Antunes — profissional da Clínica Beta
  -- ════════════════════════════════════════════════════════════════════════════════

  ns constant text := 'wp-seed:v2:';
  alvos jsonb;
  item  jsonb;
  v_id uuid; v_email text; v_rotulo text;
  erros text := '';
  n_informados int := 0; n_atualizados int := 0; n_pulados int := 0;
begin
  alvos := jsonb_build_array(
    jsonb_build_object('k','prof:alfa:owner' ,'e', btrim(e_alfa_owner) ,'r','Alfa/dona-admin'),
    jsonb_build_object('k','prof:alfa:edu'   ,'e', btrim(e_alfa_edu)   ,'r','Alfa/educador-fisico'),
    jsonb_build_object('k','prof:alfa:med'   ,'e', btrim(e_alfa_med)   ,'r','Alfa/medico-nutri'),
    jsonb_build_object('k','prof:alfa:nodisc','e', btrim(e_alfa_nodisc),'r','Alfa/sem-disciplina'),
    jsonb_build_object('k','prof:alfa:ext'   ,'e', btrim(e_alfa_ext)   ,'r','Alfa/externa'),
    jsonb_build_object('k','prof:beta:owner' ,'e', btrim(e_beta_owner) ,'r','Beta/profissional'));

  -- ─── VALIDAÇÕES (nada é gravado antes de todas passarem) ───
  for item in select * from jsonb_array_elements(alvos) loop
    v_email := item->>'e'; v_rotulo := item->>'r'; v_id := md5(ns||(item->>'k'))::uuid;
    if v_email = '' then n_pulados := n_pulados + 1; continue; end if;
    n_informados := n_informados + 1;

    -- formato
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
      erros := erros||format('[%s] formato invalido (%s); ', v_rotulo, v_email);
    end if;
    -- ainda com placeholder? (aviso de uso indevido)
    if lower(v_email) like 'preencha%' then
      erros := erros||format('[%s] ainda e placeholder; ', v_rotulo);
    end if;
    -- o perfil semeado existe?
    if not exists (select 1 from public.profiles where id = v_id) then
      erros := erros||format('[%s] perfil semeado nao existe (rode o seed antes); ', v_rotulo);
    end if;
    -- a pessoa ja logou? entao nao adianta trocar o e-mail
    if exists (select 1 from public.profiles where id = v_id and auth_user_id is not null) then
      erros := erros||format('[%s] perfil JA tem auth_user_id (a pessoa ja logou) - resolva a mao; ', v_rotulo);
    end if;
    -- e-mail repetido entre os informados?
    if (select count(*) from jsonb_array_elements(alvos) x
         where x->>'e' <> '' and lower(x->>'e') = lower(v_email)) > 1 then
      erros := erros||format('[%s] e-mail repetido entre os informados; ', v_rotulo);
    end if;
    -- e-mail ja usado por OUTRO profile do banco?
    if exists (select 1 from public.profiles p
                where lower(btrim(p.email)) = lower(v_email) and p.id <> v_id) then
      erros := erros||format('[%s] e-mail ja pertence a outro profile; ', v_rotulo);
    end if;
  end loop;

  if length(erros) > 0 then
    raise exception 'WP-SEED SET EMAILS: NADA foi gravado. %', erros;
  end if;
  if n_informados = 0 then
    raise notice 'WP-SEED SET EMAILS: nenhum e-mail informado - nada a fazer (preencha o bloco de CONFIGURACAO).';
    return;
  end if;

  -- ─── APLICAÇÃO (auth_user_id NUNCA aparece no SET: continua NULL) ───
  for item in select * from jsonb_array_elements(alvos) loop
    v_email := item->>'e';
    if v_email = '' then continue; end if;
    v_id := md5(ns||(item->>'k'))::uuid;
    update public.profiles
       set email = v_email
     where id = v_id
       and auth_user_id is null                      -- trava dupla: só mexe em perfil ainda não vinculado
       and coalesce(email,'') is distinct from v_email;   -- idempotente: não reescreve o que já está certo
    n_atualizados := n_atualizados + coalesce((select count(*) from public.profiles
      where id = v_id and lower(btrim(email)) = lower(v_email)), 0);
  end loop;

  -- ─── GARANTIA FINAL: os 6 continuam com auth_user_id NULL ───
  if exists (select 1 from public.profiles
              where id in (md5(ns||'prof:alfa:owner')::uuid, md5(ns||'prof:alfa:edu')::uuid,
                           md5(ns||'prof:alfa:med')::uuid,   md5(ns||'prof:alfa:nodisc')::uuid,
                           md5(ns||'prof:alfa:ext')::uuid,   md5(ns||'prof:beta:owner')::uuid)
                and auth_user_id is not null) then
    raise exception 'WP-SEED SET EMAILS: algum perfil ficou com auth_user_id preenchido - ABORTADO.';
  end if;

  raise notice 'WP-SEED SET EMAILS OK: % informados, % pulados (em branco). auth_user_id segue NULL nos 6.',
    n_informados, n_pulados;
end
$emails$;

-- =====================================================================================
-- REVERTER (devolve os placeholders originais do seed) — descomente e rode:
--
-- do $rev$
-- declare ns constant text := 'wp-seed:v2:';
-- begin
--   update public.profiles set email='PREENCHA.alfa.admin@exemplo.com'    where id=md5(ns||'prof:alfa:owner')::uuid  and auth_user_id is null;
--   update public.profiles set email='PREENCHA.alfa.educador@exemplo.com' where id=md5(ns||'prof:alfa:edu')::uuid    and auth_user_id is null;
--   update public.profiles set email='PREENCHA.alfa.medico@exemplo.com'   where id=md5(ns||'prof:alfa:med')::uuid    and auth_user_id is null;
--   update public.profiles set email='PREENCHA.alfa.semdisc@exemplo.com'  where id=md5(ns||'prof:alfa:nodisc')::uuid and auth_user_id is null;
--   update public.profiles set email='PREENCHA.alfa.externo@exemplo.com'  where id=md5(ns||'prof:alfa:ext')::uuid    and auth_user_id is null;
--   update public.profiles set email='PREENCHA.beta.prof@exemplo.com'     where id=md5(ns||'prof:beta:owner')::uuid  and auth_user_id is null;
-- end $rev$;
--
-- CONFERIR a qualquer momento (deve mostrar os 6 com auth_user_id NULL):
-- select id, full_name, email, auth_user_id, status from public.profiles
--  where id in (md5('wp-seed:v2:prof:alfa:owner')::uuid, md5('wp-seed:v2:prof:alfa:edu')::uuid,
--               md5('wp-seed:v2:prof:alfa:med')::uuid,   md5('wp-seed:v2:prof:alfa:nodisc')::uuid,
--               md5('wp-seed:v2:prof:alfa:ext')::uuid,   md5('wp-seed:v2:prof:beta:owner')::uuid)
--  order by full_name;
-- =====================================================================================
