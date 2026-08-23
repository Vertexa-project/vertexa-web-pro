# Migrations e os DOIS ledgers

Status: `VIGENTE` desde 2026-07-30 (WP-LEDGER-1). Vale para toda migration daqui em diante.

Incidente, restore, isolamento e RPO/RTO: `docs/ops/DISASTER_RECOVERY.md`. Este arquivo cobre só os dois ledgers e o apply.

Este projeto tem **dois** registros de migration, e eles não são intercambiáveis:

| Registro | O que é | Quem escreve |
|---|---|---|
| `supabase_migrations.schema_migrations` | ledger **da CLI Supabase**. É por ele que `db push`, `db reset` e `migration list` decidem o que já foi aplicado. Colunas: `version`, `name`, `statements`, `created_by`, `idempotency_key`, `rollback`. **Não tem `applied_at`.** | a ferramenta que aplica |
| `public.schema_migration_log` | ledger **nosso**, legível. Colunas: `version`, `filename`, `description`, `session`, `applied_at`. | a própria migration, no bloco final |

Os dois divergiram em silêncio por semanas. O conserto (WP-LEDGER-1) moveu 6 linhas para a
versão certa e removeu 2 órfãs; o retrato pré-conserto está em `retorno-ledger-diag.txt` e
`ledger-backup-pre.txt` (fora do repo, na raiz do workspace). O que segue existe para o
problema não voltar.

---

## 1. Ao aplicar migration pela ferramenta do Supabase, CORRIJA A VERSÃO na mesma sessão

**O fato:** quando a migration é aplicada pela ferramenta do Supabase (`apply_migration` via
MCP), a linha do ledger da CLI **não nasce com a versão do arquivo**. Ela nasce com a
**versão de relógio** — o timestamp UTC do instante em que a aplicação rodou.

Foi medido, não suposto: nas 6 migrations de 28/07 a 30/07, a versão gravada no ledger é
exatamente o `applied_at` que o nosso log registrou, ao segundo, seis de seis.

| arquivo | versão gravada pela ferramenta |
|---|---|
| `20260803090000_wp_join1_clinic_join_requests.sql` | `20260728131742` |
| `20260804090000_wp_chat_fix_channel_rpc.sql` | `20260728184929` |
| `20260805090000_wp_team_2bi_link_deactivation.sql` | `20260729013856` |
| `20260806090000_wp_chat_mentions_a.sql` | `20260729134824` |
| `20260807090000_wp_metric_1a_event_type_catalog.sql` | `20260729233845` |
| `20260808090000_wp_team_2bii_professional_deactivation.sql` | `20260730083824` |

**Por que isso é grave e não cosmético:** a CLI compara **versão**, não nome nem conteúdo.
Com a versão errada, o arquivo do repo parece NUNCA aplicado — e `supabase db push`
tentaria reaplicá-lo em cima de um banco que já o tem. Em 4 dos 6 casos acima isso termina
em `42710` (`create policy`/`add constraint` que já existe), com a transação daquele arquivo
revertida e o push parado no meio.

### UPDATE modelo — copie, troque os dois valores, rode na MESMA sessão

```sql
-- Corrige a linha recém-criada pela ferramenta: versão de RELÓGIO -> versão do ARQUIVO.
-- O WHERE casa por (version, name): se qualquer um dos dois estiver errado, ele acerta
-- ZERO linhas em vez de acertar a linha errada.
update supabase_migrations.schema_migrations
   set version = '<VERSAO_DO_ARQUIVO>'          -- ex.: 20260809090000
 where version = '<VERSAO_DE_RELOGIO_GRAVADA>'  -- ex.: 20260730142211
   and name    = '<NOME_SEM_A_VERSAO_E_SEM_.sql>';  -- ex.: wp_algo_a
```

Como descobrir a versão de relógio que acabou de nascer:

```sql
select version, name
  from supabase_migrations.schema_migrations
 where name = '<NOME_SEM_A_VERSAO_E_SEM_.sql>';
```

E confirme, logo depois do UPDATE, que sobrou **uma** linha e que ela tem a versão do arquivo.

> **Na mesma sessão.** Não é preciosismo: seis WPs seguidos deixaram para depois e "depois"
> nunca chegou — foi assim que o buraco chegou a 6 pares.

---

## 2. LEI — migration aplicada NÃO SE EDITA

Depois que uma migration foi aplicada em produção, o arquivo dela é **histórico**. Corrigir
um defeito significa **migration nova**, nunca editar a antiga.

**O motivo é uma cicatriz nossa, não uma regra de manual.** Em 03/07/2026 duas correções
foram aplicadas ao banco e nunca viraram arquivo — em vez disso, o conserto foi editado para
dentro dos arquivos já aplicados:

- `20260703023827 seed_demo_mariana_workout_execution_tz_fix` → o conserto foi parar em
  `supabase/migrations/20260702250000_seed_demo_mariana_workout_execution.sql:70`
- `20260703031129 workout_session_logs_performed_on_local_default` → foi parar em
  `supabase/migrations/20260702240000_workout_execution_logs.sql:45` e `:59`

Resultado: duas linhas no ledger da CLI sem arquivo nenhum (as "órfãs"), e dois arquivos que
deixaram de dizer o que produção realmente rodou. Elas sobreviveram 27 dias antes de alguém
olhar.

**Consequência colateral, medida no diagnóstico:** o SQL executável de **15** dos 73 arquivos
não bate mais com o que produção executou. Editar arquivo aplicado é a origem direta de parte
disso.

Se você editou por engano: **não apague a edição**. Escreva a migration nova com o estado
correto e registre no WP o que aconteceu.

---

## 3. Verificação pós-aplicação: OS DOIS ledgers, NOMEADOS

A checagem antiga dizia "confira o ledger". Era ambígua — e passou verde **seis vezes
seguidas** enquanto o outro ledger divergia, porque quem checava olhava o nosso
`schema_migration_log`, que estava certo, e nunca o da CLI, que estava errado.

A partir de agora, a verificação de fim de WP com migration cita os dois **pelo nome** e roda
as duas consultas:

```sql
-- (1) NOSSO ledger: a linha da migration existe, com o nome do arquivo certo?
select version, filename, session, applied_at
  from public.schema_migration_log
 where version = '<VERSAO_DO_ARQUIVO>';
-- Esperado: exatamente 1 linha, filename = '<VERSAO_DO_ARQUIVO>_<nome>.sql'.

-- (2) LEDGER DA CLI: a linha existe COM A VERSÃO DO ARQUIVO (e não com a de relógio)?
select version, name
  from supabase_migrations.schema_migrations
 where version = '<VERSAO_DO_ARQUIVO>' or name = '<NOME_SEM_A_VERSAO_E_SEM_.sql>';
-- Esperado: exatamente 1 linha, e version = '<VERSAO_DO_ARQUIVO>'.
-- Duas linhas, ou uma linha com versão de relógio ⇒ o passo 1 deste documento não foi feito.
```

E, uma vez por WP com migration, a checagem de conjunto — a que teria pego o problema no
primeiro dia:

```sql
-- Buracos e órfãs, contra a listagem real do diretório.
-- Gere o array por script, do diretório, sem digitar:
--   ls -1 supabase/migrations/*.sql | sed 's|.*/||' | cut -c1-14 | sort
with arquivos(v) as (values ('...'),('...') /* lista gerada */)
select
  (select count(*) from arquivos a
    where not exists (select 1 from supabase_migrations.schema_migrations m where m.version = a.v)) as buracos,
  (select count(*) from supabase_migrations.schema_migrations m
    where not exists (select 1 from arquivos a where a.v = m.version)) as orfas,
  (select count(*) from supabase_migrations.schema_migrations) as linhas_ledger_cli,
  (select count(*) from arquivos) as arquivos_no_diretorio;
-- Esperado: buracos = 0, orfas = 0, linhas_ledger_cli = arquivos_no_diretorio.
```

> Se comparar tempo com versão, **compare na mesma granularidade**: `applied_at` guarda
> microssegundos e a versão só tem segundos. `date_trunc('second', applied_at)` ou
> `to_char(applied_at at time zone 'UTC','YYYYMMDDHH24MISS')`. Igualdade crua de
> `timestamptz` contra versão reprova sempre, pelo motivo errado.

---

## 4. Limitação conhecida: o nosso log tem 57 de 73, e vai continuar assim

`public.schema_migration_log` cobre **57** das 73 migrations. Faltam **16**, todas anteriores
à prática de registrar (as duas primeiras são anteriores à própria criação da tabela; as
demais, de 30/06 a 02/07, simplesmente não escreveram a linha):

```
20260617100000 base_schema                    20260702120000 activity_sessions
20260617110000 seed_base_demo                 20260702130000 seed_demo_mariana_streak_convergence
20260630100000 revoke_rls_auto_enable_...     20260702140000 supplements
20260630170000 seed_demo_weight_logs_mariana  20260702210746 achievements
20260701100000 seed_demo_progress_photos_...  20260702220213 seed_mariana_timeline_coherence
20260701110000 seed_demo_assessments_...      20260702220402 notifications
20260701120000 meal_logs                      20260702230000 patient_documents
                                              20260702240000 workout_execution_logs
                                              20260702250000 seed_demo_mariana_workout_execution
```

**Essas 16 NÃO serão retroalimentadas.** O ledger da CLI não guarda carimbo de tempo — não
tem coluna `applied_at` —, então não existe fonte de onde tirar a data em que cada uma
rodou. Preencher significaria **inventar** o `applied_at`, e isso trocaria uma lacuna honesta
por um registro falso: quem lesse depois acreditaria numa data que ninguém mediu.

Portanto: **o nosso log é completo a partir de 2026-07-08**, e antes disso é parcial por
construção. Quem precisar da existência (não da data) de uma migration antiga usa o ledger da
CLI, que tem as 73.

---

## Não faça

- Não rode `supabase db push`, `db reset`, `db pull` nem `migration repair` neste projeto sem
  um WP que o autorize explicitamente.
- Não edite migration já aplicada (item 2).
- Não apague linha do ledger da CLI sem antes salvar o `statements` dela por extenso: um
  `update` de versão se desfaz com o inverso, um `delete` leva o SQL junto.
- Não conclua um WP com migration sem as duas consultas do item 3.
