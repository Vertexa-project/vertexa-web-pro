# Seed de dados de teste (WP-SEED · v2)

Popula o banco com um cenário realista (2 clínicas, profissionais com disciplinas, pacientes com datas
variadas, prescrições, registros, chat e jornada) para rodar o playbook de ponta a ponta. **Não é
migration** — não entra no ledger (nem em `supabase_migrations.schema_migrations`, nem em
`public.schema_migration_log`) e não é aplicado automaticamente. É **DADO, não estrutura**: não cria nem
altera schema, policies ou funções.

- Seed: [`supabase/seeds/wp_seed_test_data.sql`](../../supabase/seeds/wp_seed_test_data.sql)
- Remoção: [`supabase/seeds/wp_seed_test_data_remove.sql`](../../supabase/seeds/wp_seed_test_data_remove.sql)

## Pelos caminhos REAIS do produto

O seed **não fabrica estado à mão**: ele chama as RPCs de verdade, simulando cada ator via
`request.jwt.claims` (o mesmo mecanismo dos testes Nível 1). Assim o dado nasce pelo mesmo caminho que
a aplicação usa — se a RPC mudar de regra, o seed quebra junto (é uma trava, não um atalho).

| Etapa | Caminho |
|---|---|
| Criar Clínica Alfa / Beta | `create_clinic_with_owner` (a dona cria a própria clínica) |
| Disciplina da dona | `assign_professional_discipline` (auto-atribuição, WP-DISC-FIX) |
| Montar a equipe | `promote_to_professional` |
| Disciplinas da equipe | `assign_professional_discipline` |
| Pacientes (com data de início) | `create_patient` (com `p_start_date`) |
| Plano de treino | `save_workout_plan` (pelo educador físico) |
| Plano alimentar | `save_nutrition_plan` (pela nutricionista) |
| Jornada | `move_patient_journey` |

### Inserção direta (só onde NÃO existe RPC)

- **`profiles` dos profissionais** — nenhuma RPC cria profile de profissional. Só o trigger
  `handle_new_user` (no login) e `create_patient` (que cria profile de *paciente*).
- **`professional_patient_links` extras** — `create_patient` vincula apenas o **chamador**; não há RPC
  para vincular outro profissional nem para marcar `is_external`.
- **`weight_logs` / `activity_events` / `meal_logs` / `workout_session_logs` / `workout_set_logs`** —
  são escritas do **app paciente**, feitas direto pelo client sob RLS; não há RPC.
- **`chat_channels` / `chat_participants` / `chat_messages`** — não há RPC de chat.

### Não semeado (limitações)

- **Anexos de chat e fotos de progresso**: exigem arquivo binário real no bucket. SQL não sobe objeto no
  Storage (e `storage.objects` tem o trigger `protect_objects_delete`, que bloqueia manipulação por SQL).
- **Peças/consentimentos de mídia (WP-ARTE)**: fora do escopo por decisão do orquestrador.

## Login: como a pessoa cai no perfil semeado

Os 6 profiles de profissional ficam com **`auth_user_id = NULL`** e o **e-mail configurado no topo do
script**. No primeiro login com Google nesse **mesmo e-mail**, o trigger `public.handle_new_user`:

1. exige provedor **Google** e `email_confirmed_at` preenchido (senão nem tenta);
2. procura profiles com **`auth_user_id IS NULL`** e e-mail igual (case/espaço-insensível);
3. se achar **exatamente 1**, faz `update profiles set auth_user_id = <novo user>` → **vincula o perfil
   semeado**;
4. se achar 0 ou mais de 1, cria um profile **novo** `patient`/`pending`.

Por isso o seed **zera** os `auth_user_id` sintéticos no último passo. Se um `auth_user_id` sintético
ficasse gravado, o passo 2 não casaria e a pessoa cairia num **perfil pendente novo** — não no semeado.
Não há FK de `profiles.auth_user_id` para `auth.users`, então o erro seria **silencioso**.

> ⚠️ **Troque os e-mails ANTES do primeiro login.** Com os placeholders `PREENCHA.*@exemplo.com` os
> dados existem, mas ninguém consegue entrar. Use o script dedicado (abaixo) — não edite à mão.

### Trocar os e-mails: `wp_seed_set_emails.sql`

[`supabase/seeds/wp_seed_set_emails.sql`](../../supabase/seeds/wp_seed_set_emails.sql) tem um bloco de
**configuração no topo** com os 6 e-mails. Preencha e rode; deixar `''` **pula** aquele perfil, então dá
para preencher aos poucos.

**Faça isto ANTES do primeiro login.** Depois que a pessoa entra, o `auth_user_id` já foi gravado e
trocar o e-mail não revincula nada — o script recusa esse caso de propósito.

**Use exatamente as contas Google que serão usadas na demonstração**, e cadastre cada uma como
**usuária de teste** no Google Cloud (APIs & Services → OAuth consent screen → **Test users**). Enquanto
o app estiver em modo de testes, uma conta Google que não esteja nessa lista não consegue concluir o
login — e aí o perfil semeado nunca é vinculado.

O script **recusa e não grava nada** se qualquer trava falhar (todas verificadas em ensaio):

| Trava | Comportamento |
|---|---|
| Formato de e-mail inválido | recusado |
| Valor ainda é `PREENCHA…` | recusado |
| Perfil semeado não existe (seed não rodou) | recusado |
| Perfil já tem `auth_user_id` (a pessoa já logou) | recusado |
| Mesmo e-mail repetido entre os 6 informados | recusado |
| E-mail já pertence a outro profile do banco | recusado |

Por que as duas últimas importam: `handle_new_user` só vincula quando encontra **exatamente um**
profile com aquele e-mail e `auth_user_id IS NULL`. Dois profiles com o mesmo e-mail fazem o login
cair no caminho "cria perfil pendente novo".

O script **nunca toca em `auth_user_id`** — ele precisa continuar `NULL` até o primeiro login, e há uma
checagem final que aborta se algum dos 6 tiver sido preenchido. É **idempotente** (rodar de novo com os
mesmos valores não muda nada) e **reversível** (bloco comentado no fim do arquivo devolve os placeholders).

Conferir a qualquer momento:

```sql
select id, full_name, email, auth_user_id, status from public.profiles
 where id in (md5('wp-seed:v2:prof:alfa:owner')::uuid, md5('wp-seed:v2:prof:alfa:edu')::uuid,
              md5('wp-seed:v2:prof:alfa:med')::uuid,   md5('wp-seed:v2:prof:alfa:nodisc')::uuid,
              md5('wp-seed:v2:prof:alfa:ext')::uuid,   md5('wp-seed:v2:prof:beta:owner')::uuid)
 order by full_name;
```

## Cenário criado

**Clínica Alfa** — 5 profissionais:

| Pessoa | Papel | Disciplina | Vínculos |
|---|---|---|---|
| Ana Prado | dona / **admin** | nutricionista | os 4 pacientes (criou todos) |
| Bruno Salles | membro | educador_fisico | só o P1 |
| Clara Vieira | membro | medico + nutricionista | só o P2 |
| Diego Martins | membro | **nenhuma** | **nenhum paciente** |
| Elisa Rocha | membro | nutricionista | só o P4, `is_external = true` |

Diego é de propósito o profissional **sem disciplina e sem nenhum paciente** — é ele que prova o
isolamento (não deve enxergar nem escrever nada).

**Pacientes da Alfa:**

| # | Nome | Início | Para quê |
|---|---|---|---|
| P1 | Mariana Lopes | −100 dias | marcos de 30/60/90 **já ocorridos**; é quem tem planos e registros |
| P2 | Rafael Nunes | −28 dias | marco de 30 dias **dentro da janela de 7 dias** |
| P3 | Juliana Costa | −3 dias | paciente recente |
| P4 | Sofia Andrade | −45 dias | **aniversário nos próximos 7 dias** |

Todos com `birth_date` preenchida e **maiores de idade**.

**Clínica Beta** — Felipe Antunes (educador_fisico) + 1 paciente. Existe só para provar isolamento
entre clínicas.

**Mais:** 1 plano de treino ABC + 1 plano alimentar de 5 refeições (no P1); 15 pesagens, 21 dias de
hidratação, 14 dias de refeições registradas e 12 sessões de treino com séries (no P1); 1 conversa por
paciente com mensagens **nos dois sentidos**; 2 pacientes movidos na jornada (3 movimentos = histórico).

## Rastreabilidade e remoção

**Critério de identificação (oficial):** os 6 profiles de profissional têm id **determinístico**
`md5('wp-seed:v2:' || <chave>)::uuid`. A partir desse conjunto fechado de 6 UUIDs, tudo o mais é
alcançado por FK: as clínicas são as que têm `owner_profile_id` nesse conjunto; profissionais e
pacientes vêm por `clinic_id`; planos, registros, chat e jornada vêm por `patient_id`. **Nada é
apagado por nome ou heurística.**

- **Idempotente:** se o profile-âncora já existir, o seed não faz nada.
- **Reversível:** rode `wp_seed_test_data_remove.sql` — apaga exatamente o que o seed criou, na ordem
  de dependências, e é seguro rodar duas vezes.

## Como rodar

```sql
-- aplicar
\i supabase/seeds/wp_seed_test_data.sql
-- remover
\i supabase/seeds/wp_seed_test_data_remove.sql
```

Ou colando o conteúdo no SQL Editor do Supabase. Rode como `postgres`/`service_role` (o seed insere em
tabelas com RLS e usa `set local role` para simular os atores).
