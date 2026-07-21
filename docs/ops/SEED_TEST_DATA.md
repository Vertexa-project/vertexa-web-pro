# Seed de dados de teste (WP-SEED)

Popula o banco com um cenário realista (2 clínicas, profissionais com disciplinas, pacientes com datas
variadas, prescrições, registros, chat e jornada) para rodar o playbook de ponta a ponta. **Não é
migration** — não entra no ledger nem é aplicado automaticamente. É **DADO, não estrutura**: não cria/
altera schema, policies ou funções.

- Seed: [`supabase/seeds/wp_seed_test_data.sql`](../../supabase/seeds/wp_seed_test_data.sql)
- Remoção: [`supabase/seeds/wp_seed_test_data_remove.sql`](../../supabase/seeds/wp_seed_test_data_remove.sql)

## Como rodar

Rode o conteúdo do arquivo no banco (não há passo de CLI dedicado — não é migration):

- **MCP Supabase:** `execute_sql` com o conteúdo do arquivo.
- **psql:** `psql "$DATABASE_URL" -f supabase/seeds/wp_seed_test_data.sql`

O seed é **IDEMPOTENTE**: se a Clínica Alfa já existe, ele não faz nada (rodar duas vezes não duplica).

## ⚠️ Preencher os e-mails (senão ninguém loga)

O login real (Google) só funciona se o **e-mail do perfil** for **idêntico** ao da conta Google usada
(o `handle_new_user` liga o perfil por e-mail no 1º login). No topo do seed há um **bloco de
configuração** com placeholders `PREENCHA_*@exemplo.com`. **Enquanto não forem trocados pelos e-mails
reais, os dados EXISTEM mas NINGUÉM consegue entrar.** Cada e-mail deve ser único.

Duas formas de definir os e-mails:
1. **Antes de aplicar:** edite os `email_*` no topo do seed e rode.
2. **Depois de aplicado:** como o seed é idempotente (não re-roda), atualize direto, ex.:
   `update public.profiles set email = 'voce@gmail.com' where full_name = 'Dra. Alice Nogueira';`
   (ou rode a remoção, edite o seed e rode de novo).

Os pacientes (login no app do paciente) têm e-mail opcional — preencha `email_p1..p5` só se for
demonstrar o login do paciente.

## Rastreabilidade (o que o seed marca)

- **Ids determinísticos** `md5('vseed:'||label)::uuid` para clínicas, perfis e profissionais.
- Domínio de e-mail marcador `vertexa-seed.test` (secundário; some quando você troca pelo e-mail real).
- Tudo o mais é alcançável por **FK** a partir das 2 clínicas-âncora (Alfa/Beta).

## Como remover

Rode [`wp_seed_test_data_remove.sql`](../../supabase/seeds/wp_seed_test_data_remove.sql). Ele apaga
**exatamente** o que o seed criou, na ordem das dependências, sem tocar em nada fora do seed (também
idempotente: se as clínicas não existem, não faz nada).

## Cenário criado

**Clínica Alfa** (dona = Dra. Alice):

| Ator | Papel | Disciplina(s) | Observação |
|---|---|---|---|
| Dra. Alice Nogueira | admin/dona | nutricionista | dona da clínica |
| Bruno Martins | profissional | educador_fisico | prescreve treino |
| Dr. Carlos Esteves | profissional | medico + nutricionista | duas disciplinas; prescreve alimentar |
| Dani Prado | profissional | — (sem disciplina) | **não vinculado a paciente** (teste E2) |
| Eva Ribeiro | profissional | fisioterapeuta | **externa** (vínculo `is_external`) da Ana |

**Clínica Beta** (só para isolamento): Bia Fontes (admin, nutricionista) + 1 paciente.

**Pacientes (Alfa):**

| Paciente | Início | Nascimento | Para exercitar |
|---|---|---|---|
| Ana Antiga | há ~100 dias | 1988 | marcos 30/60/90 ocorridos; plano de treino + alimentar; peso/hidratação/refeições/execuções; chat; jornada (2 moves) |
| Bruna Vinte8 | há ~28 dias | 1992 | marco de 30 dias dentro da janela de 7 dias; chat; jornada |
| Carla Recente | há ~3 dias | 1995 | início recente (coluna inicial) |
| Diana Aniver | há ~45 dias | ~34 anos | **aniversário nos próximos 7 dias** (selo) |
| Elisa Beta | há ~20 dias | 1990 | **na Clínica Beta** (isolamento) |

Vínculos: Alice ligada a todos os pacientes da Alfa (via `create_patient`); Bruno e Carlos ligados à
Ana; Eva **externa** ligada à Ana; **Dani sem vínculo** (garante o caso E2 do playbook).

## Caminhos usados

Usa as **RPCs reais** (via `request.jwt.claims`, como os testes Nível 1): `assign_professional_discipline`,
`create_patient`, `save_workout_plan`, `save_nutrition_plan`, `move_patient_journey`,
`ack_journey_milestone`. Inserção **direta** (sem RPC) só onde não há: clínicas, perfis/linhas de
profissionais (bootstrap), disciplina do próprio admin (a RPC proíbe auto-atribuição), vínculos extras,
auto-registros do paciente (peso/hidratação/refeições/execuções) e o chat.

## Limitações (não semeado)

- **Anexos de chat:** exigem arquivo real no bucket `chat-attachments` (Storage) → não semeados.
- **Fotos de progresso:** exigem binário no bucket `progress-photos` → não semeadas.
- **Consentimento/peças de mídia (WP-ARTE):** ainda sem interface → não semeados.

> **Aviso (produção):** ver `docs/PENDENCIAS.md` — há dado de teste no banco de produção; **remover antes
> do primeiro cliente real**.
