# Disaster Recovery e Isolamento Operacional

Status: `VIGENTE` desde 2026-08-23 (WP-06B). Documento canônico de incidente, backup, recuperação e isolamento.

Projeto Supabase de produção: `cdhjfyyuhmwrcuxqavib` (Vertexa, sa-east-1).
Organização: plano **PRO**.

Este arquivo diz o que fazer. Não é SLA contratual. Não habilita PITR, não executa restore e não altera infraestrutura.

Leituras irmãs (não duplicar):

- Migrations e ledgers: `docs/ops/MIGRATIONS_E_LEDGERS.md`
- Contrato de helpers/RLS: `docs/CONTRATO_INTEGRACAO.md` (WP-05B e famílias)
- Observabilidade WEB: `docs/ops/OBSERVABILITY.md`

---

## A. Responsabilidades

### Operador técnico

1. Identifica o sintoma (erro, vazamento, dado sumiu, Storage aberto, deploy quebrado).
2. Coleta evidência (hora UTC, SHA do WEB, ledgers, Sentry release, print do Dashboard).
3. Interrompe mudança nova (não aplica migration, não publica, não restaura).
4. Preserva logs. Não apaga snapshot, objeto, linha de ledger nem evento de trilha.
5. Executa **somente** o procedimento que o orquestrador autorizou.

### Orquestrador técnico

1. Classifica o incidente (F1–F7 abaixo, ou “ainda não sabemos”).
2. Escolhe o caminho de recuperação (C1–C4).
3. Autoriza, por escrito na sessão: migration corretiva, rollback de deploy, ou restore.

### Supabase Dashboard

Usar para: ver backups, status COMPLETED/FAILED, selecionar snapshot, e PITR **quando** estiver habilitado.

Nunca executar restore por impulso. Restore em produção exige autorização explícita do orquestrador **e** não é o primeiro exercício da equipe.

---

## B. Regra de ouro

Antes de qualquer recuperação:

1. Parar novas mudanças (código, migration, config, Storage).
2. Identificar o momento do incidente (UTC).
3. Registrar o último estado sabidamente bom (SHA WEB, versão de ledger, último snapshot COMPLETED).
4. Preservar evidências (não “limpar para tentar de novo”).
5. Decidir a classe do problema:
   - aplicação (WEB/App)
   - schema / policy
   - dados
   - RLS
   - Storage (blob físico)
   - infraestrutura (Supabase/Vercel)
6. Escolher a **menor** recuperação que resolve.

Não usar PITR (nem snapshot) se rollback de deploy resolve e o banco está íntegro.
Não usar rollback de deploy se o banco já foi destruído ou o dado clínico já sumiu.

---

## C. Hierarquia de recuperação

Sempre a solução menos destrutiva adequada.

| Ordem | Caminho | Quando |
|---|---|---|
| **C1** | Rollback / redeploy WEB | O frontend quebrou UX ou chamadas; banco, Auth e Storage íntegros. |
| **C2** | Migration corretiva **nova** | Schema/policy/RPC defeituosos e reversíveis; arquivo antigo **não** se edita. |
| **C3** | Restore de snapshot diário | Dado clínico corrompido ou apagado e não há reversão segura por SQL. |
| **C4** | PITR | **Futuro.** Só quando o add-on estiver habilitado. Recuperação com granularidade de segundos. |

C3 **não** devolve blobs de Storage. Ver seção G.

---

## D. Migrations

Fonte: `docs/ops/MIGRATIONS_E_LEDGERS.md`. Resumo operacional:

- O arquivo `.sql` entra no git **antes** do apply remoto.
- Migration já aplicada **não se edita**. Defeito = arquivo novo.
- Dois ledgers, os dois pelo nome:
  - CLI: `supabase_migrations.schema_migrations`
  - humano: `public.schema_migration_log`
- Apply via MCP (`apply_migration`) grava a linha da CLI com **versão de relógio**. Corrigir **na mesma sessão** para a versão do arquivo. Sem isso, `db push` tenta reaplicar.
- Pós-apply: as duas consultas do item 3 de `MIGRATIONS_E_LEDGERS.md`.
- Se os ledgers divergirem: **STOP**. Não inventar repair.
- Não rodar `db push` / `db reset` / `db pull` / `migration repair` sem WP que autorize.
- Fingerprints H1–H5 (policies, helpers `private`, âncoras, ACLs, FKs) são a prova de schema quando o WP que mudou o banco as publicou. Repetir **essas** consultas. Não inventar hash novo.
- Advisors: registrar WARN novos vs. o retrato do WP anterior. 0029 em RPC autenticada intencional **não** é sozinho motivo de rollback.
- PostgREST: schemas expostos = `public` (+ `graphql_public`). `private` fora da Data API.

Último retrato conhecido no diagnóstico WP-06A (não é meta eterna): CLI **78** / humano **62** / última `20260813090000`.

---

## E. Isolamento

Invariantes. Se um deles quebrar em produção: incidente **F3** (ou F4 se for só Storage). Não reexecutar provas neste documento — apontar as existentes.

### E1. Clínica A não lê/escreve clínica B

Helpers: `private.is_clinic_admin` / `is_clinic_member` / `is_clinic_staff` / `patient_clinic`. Admin = dono **ou** `professionals.clinic_role='admin'` — nunca `profiles.role` (AUTH-ADMIN-1).

Prova: `docs/CONTRATO_INTEGRACAO.md` Fam1/Fam6; testes `supabase/tests/wp05b_fam1_identity_test.sql`, `wp05b_fam6_agenda_test.sql`.

### E2. Profissional sem vínculo ativo não acessa o paciente

`can_access_patient` / `can_access_patient_internal` exigem vínculo com `coalesce(status,'active')='active'` (interno vs. externo conforme a família). Mesma clínica **não** basta (AUTH-AGENDA-1).

Prova: Fam1–Fam5; percurso real WP-05B (1 paciente, 2 profissionais, desativação isolada).

### E3. Paciente não acessa outro paciente

Self = `private.is_self_patient`. Forja de `patient_id` negada no WITH CHECK.

Prova: testes Fam2 (`wp05b_fam2_behavior_test.sql`) e famílias seguintes (IDOR / isolamento X⟂Y).

### E4. Desativar vínculo corta ação na hora

`deactivate_patient_link` (WP-TEAM-2b-i): vínculo `inactive` + profissional sai do roster do canal existente. SELECT de chat/Storage/clínico segue o vínculo **atual**.

Prova: `docs/CONTRATO_INTEGRACAO.md` WP-CHAT-FIX + `docs/PENDENCIAS.md` WP-TEAM-2b-i; percurso WP-05B.

### E5. Desativar profissional corta ação na hora

WP-TEAM-2b-ii (`20260808090000`): profissional inativo perde ação; helpers de staff/vínculo não o tratam como ator vivo.

Prova: `docs/CONTRATO_INTEGRACAO.md` “Estado do PROFISSIONAL”; `docs/PENDENCIAS.md` dívidas nomeadas do 2b-ii.

### E6. Histórico e autoria permanecem identificáveis

Desativação é soft. Autoria em mensagens/documentos/eventos não se apaga. Trilha `ppl_status_events` (2b-i). Reativação **reusa a mesma linha** de vínculo (WP-05A1), sem duplicar par `(professional_id, patient_id)`.

### E7. Storage privado obedece o mesmo isolamento

Buckets `chat-attachments`, `patient-documents`, `progress-photos`: `public=false`. Policies `TO authenticated` via `can_read_channel` / `can_access_patient` / `can_access_patient_internal` / `can_prescribe_for_patient`. Anon: zero policy. WEB lê por `createSignedUrl`, não URL pública.

Prova: `docs/CONTRATO_INTEGRACAO.md` WP-STORAGE-P1 + WP-CHAT-ATTACH A; testes `wp_storage2_p1_storage_objects_test.sql`.

### E8. SECURITY DEFINER não cria bypass

RPCs de produto: `search_path=''`, EXECUTE revogado de `public`/`anon`, autorização revalidada com `private.*` e `auth.uid()` / `current_profile_id()`. `clinic_id` / `professional_id` do client **não** autorizam sozinhos (`assign_patient_professional` deriva clínica do paciente; `create_patient` exige staff da clínica-alvo).

Prova: WP-APP-1, WP-05A1, onboarding; diagnóstico WP-06A (sem bypass novo).

### E9. `service_role` nunca vai ao frontend

Client WEB: só `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (`src/lib/supabase.ts`). Service role só em Edge (`supabase/functions/_shared/supabaseAdmin.ts`). `.env` não é rastreado.

### E10. `anon` não tem acesso clínico

Sem policy clínica para `anon`. Signup fail-closed em `patient`/`pending` (`handle_new_user`).

Prova: Fam1–Fam7; advisors `rls_policy_always_true` esvaziado nas famílias de dados.

### E11. Delta autorizado

Para ator **legitimamente** vinculado depois da mudança: somente o delta autorizado (ex.: segundo profissional ativo passa a ver aquele paciente e o roster do canal existente).

Para atores **não relacionados**: `DEPOIS == ANTES`.

Prova de produto: percurso WP-05A1/05A2/05B (2 profissionais, zero duplicata, roster coerente).

---

## F. Backup do banco

Inspeção Dashboard em **2026-08-23** (WP-06B, operador):

| Item | Estado observado |
|---|---|
| Plano org | PRO |
| Scheduled backups | ativos, diários |
| Snapshots | COMPLETED visíveis de 16/08/2026 até 23/08/2026 |
| Último observado | `23/08/2026 09:12:26 +0000` |
| Restore do snapshot | disponível |
| Restore to new project | disponível (Beta) |
| PITR | **desabilitado** (add-on; ver H) |
| Storage objects | **não incluídos** (alerta do Dashboard) |

`PRO ≠ PITR habilitado`. Não inferir de novo.

CLI `supabase backups list --project-ref cdhjfyyuhmwrcuxqavib` devolveu **403** no diagnóstico WP-06A. A prova de backup é o **Dashboard**, não a CLI desta conta.

### Checklist periódico (antes de clientes reais e depois, com cadência)

Em [Database → Backups](https://supabase.com/dashboard/project/cdhjfyyuhmwrcuxqavib/database/backups):

- [ ] Último backup existe e é recente (hoje ou ontem, UTC).
- [ ] Status **COMPLETED** (não FAILED / in-progress travado).
- [ ] Há **vários** snapshots na janela visível, não um só.
- [ ] Nenhuma falha nova sem dono.
- [ ] Registrar data/hora UTC da inspeção na sessão / PR / nota operacional.

Não assumir que o backup de ontem ainda está lá — olhar.

---

## G. Storage

### Fato que o restore de banco **não** resolve

> Os backups PostgreSQL do Supabase **não** recuperam os blobs físicos
> removidos do Storage.

| Camada | O que o snapshot devolve | O que o snapshot **não** devolve |
|---|---|---|
| Banco (`storage.objects` + tabelas `patient_documents` / `progress_photos` / `chat_messages.attachment_*`) | metadados, paths, policies | — |
| Storage (S3 dos buckets) | — | arquivo físico |

Se o blob sumiu e só o banco voltar: linha aponta para objeto inexistente. Se o banco voltar a um ponto antigo e o blob novo permanecer: objeto órfão.

Buckets atuais (todos `public=false`):

| Bucket | Path | Quem lê | Quem escreve |
|---|---|---|---|
| `chat-attachments` | `{channel_id}/{uuid}.ext` | `can_read_channel` | participante |
| `patient-documents` | `{patient_id}/{arquivo}` | `can_access_patient_internal` | `can_prescribe_for_patient` |
| `progress-photos` | `{patient_id}/{arquivo}` | `can_access_patient` (externo incluído) | paciente na própria pasta |

Nunca religar `public=true`. Nunca recriar policy `sprint_*`. Service role **não** é necessário no browser.

### Gap

`DR-STORAGE-01` — política externa de backup/replicação dos objetos **ainda não definida**.

Não implementar neste documento. Sem essa política, RPO de arquivo físico = **NÃO DEFINIDO**.

---

## H. PITR

| Campo | Valor |
|---|---|
| Estado | `NOT ENABLED` |
| O que o Dashboard diz | add-on; compute mínimo **Small**; granularidade de segundos |
| Preços vistos em 23/08/2026 | 7 dias US$100/mês; 14 dias US$200/mês; 28 dias US$400/mês |

**Recomendação para avaliar (não executar):** `7-day PITR`.

Por quê: reduz o RPO de “até ~24 h de snapshot” para segundos, na primeira janela operacional do Vertexa. 14/28 dias ficam para depois.

Custo total = add-on + compute Small (se hoje estiver abaixo). **Aprovar custo antes de habilitar.**

Este WP **não** habilita PITR e **não** aumenta compute.

---

## RPO / RTO (capacidade técnica, não SLA)

| Superfície | RPO | Base |
|---|---|---|
| Banco, sem PITR | até ~24 horas | snapshot diário comprovado em 23/08/2026 |
| Banco, com PITR 7 dias (se um dia ligar) | segundos, dentro da janela | add-on; **não habilitado** |
| Storage (blobs) | `NÃO DEFINIDO` | `DR-STORAGE-01` |
| Aplicação (git) | último SHA em `origin/main` | rollback C1 |

**RTO = `NÃO MEDIDO`.** Não existe exercício real de restore. O RTO só nasce depois do drill controlado (seção K), medindo:

1. detectar
2. decidir o ponto
3. executar o restore
4. validar banco
5. validar Auth
6. validar Storage (metadado **e** blob)
7. validar WEB
8. validar App paciente
9. liberar produção

Não inventar minutos.

---

## I. Incidentes F1–F7

Para cada um: DETECTAR → CONTER → RECUPERAR → VALIDAR → LIBERAR.

Onde o Vertexa ainda não tem passo escrito: `PROCEDIMENTO PENDENTE`.

### F1 — Migration ruim aplicada

- **DETECTAR:** apply falhou no meio; ledger CLI com versão de relógio; H1–H5 divergiu; advisors novos; PostgREST 500 em RPC/tabela.
- **CONTER:** não aplicar a próxima. Não editar o arquivo já aplicado. Não `db push` para “consertar”.
- **RECUPERAR:**
  1. Se o header da migration tem rollback SQL conhecido e o orquestrador autoriza: migration **nova** que aplica esse rollback (ou o inverso seguro).
  2. Se o schema não é reversível com segurança: C3 (snapshot) — **PROCEDIMENTO PENDENTE** de execução (nunca ensaiado).
- **VALIDAR:** dois ledgers; H1–H5 do WP; advisors; RPC afetada.
- **LIBERAR:** seção J + smoke da superfície que a migration tocou.

### F2 — DELETE/UPDATE indevido em dado clínico

- **DETECTAR:** usuário reporta dado sumido; contagens quebram o percurso conhecido; Sentry se a API falhar. Trilha útil quando existir: `ppl_status_events`.
- **CONTER:** revogar escrita (kill switch de RPC no header da migration daquela RPC, ou parar o WEB). Não “corrigir na mão” em produção sem autorização.
- **RECUPERAR:** se a linha ainda existe (soft-delete / status): RPC de reativação já existente (`reactivate_patient_link`, etc.). Se a linha sumiu: C3. PITR só no futuro (C4).
- **VALIDAR:** SELECT do paciente/vínculo/canal; `DEPOIS` para terceiros = `ANTES`.
- **LIBERAR:** seção J. Blobs: se o arquivo também sumiu, C3 **não** basta (`DR-STORAGE-01`).

### F3 — RLS vaza clínica B para clínica A

- **DETECTAR:** prova cruzada A⟂B falha; advisor `rls_policy_always_true` / policy permissiva nova; report de paciente/clínica alheia.
- **CONTER:** kill switch fail-closed do header da família (drop programático das policies da superfície → deny-all). **Nunca** recriar `sprint_*`. Interromper o WEB se o vazamento for explorável.
- **RECUPERAR:** migration corretiva que restaura o predicado `private.*`. Se dado já vazou para cliente: comunicação + C3 só se precisar rebobinar estado (raro; vazamento é de leitura).
- **VALIDAR:** invariantes E1–E3 e E11; testes da família em `supabase/tests/wp05b_fam*_*.sql` (harness, não produção).
- **LIBERAR:** advisors sem a regressão; isolamento A⟂B refeito.

### F4 — Storage exposto

- **DETECTAR:** bucket `public=true`; URL sem assinatura abre objeto; policy `anon`; objeto listável por quem não tem vínculo.
- **CONTER:** `public=false` (já é o estado; **não** voltar atrás). Drop da policy errada. Kill switch: deny-all em `storage.objects` (header `20260720090000_wp_storage2_p1_storage_objects_rls.sql`).
- **RECUPERAR:** migration corretiva de policy. Objeto **já baixado** não volta. Rotacionar URLs assinadas = elas já expiram (TTL curto no WEB).
- **VALIDAR:** os 3 buckets `public=false`; anon sem policy; profissional sem vínculo ativo não assina.
- **LIBERAR:** seção J + item Storage. Se houve exposição real: `PROCEDIMENTO PENDENTE` de comunicação a titulares.

### F5 — WEB / PostgREST quebrado

- **DETECTAR:** Sentry (`docs/ops/OBSERVABILITY.md`); tela branca; 401/404/500 em `/rest/v1` ou `/rpc`; build/deploy falhou.
- **CONTER:** não publicar hotfix no escuro. Se o banco está íntegro: C1.
- **RECUPERAR:** republicar o SHA anterior conhecido de `origin/main`. **Passo a passo Vercel = `PROCEDIMENTO PENDENTE`** (este repo não tem runbook de rollback de deploy). Se a quebra for schema (PostgREST): F1, não C1.
- **VALIDAR:** login WEB; RPC de identidade; paciente; chat.
- **LIBERAR:** seção J (itens WEB). App só se a API compartilhada quebrou.

### F6 — Supabase indisponível

- **DETECTAR:** projeto não `ACTIVE_HEALTHY`; status.supabase.com; WEB/App falham em auth e REST ao mesmo tempo.
- **CONTER:** não aplicar migration “para ver se volta”. Não restore. Comunicar interrupção.
- **RECUPERAR:** esperar o provedor. `PROCEDIMENTO PENDENTE` de status page / mensagem ao cliente.
- **VALIDAR:** Dashboard healthy; `SELECT 1`; login.
- **LIBERAR:** seção J. Sem dado perdido, C3 não se aplica.

### F7 — Credencial administrativa comprometida

- **DETECTAR:** uso anômalo no Dashboard; RPC/Edge inesperada; chave `service_role` em log/repo/VITE_*.
- **CONTER:** revogar sessão Dashboard; **não** commitar a chave. Se `service_role` vazou: Dashboard → Settings → API → rotacionar. Se `anon` vazou: impacto menor (RLS segura o dado) mas rotacionar se foi embedada em app de terceiro.
- **RECUPERAR:** emitir chaves novas **só** no runtime Edge / secrets do provedor — nunca `VITE_*`. Auditar ledgers e últimos writes.
- **VALIDAR:** grep negativo `service_role` / `SUPABASE_SERVICE_ROLE_KEY` no client WEB; `.env` continua fora do git.
- **LIBERAR:** seção J. Runbook fino de rotação = `PROCEDIMENTO PENDENTE`.

---

## J. Critério de volta ao ar

Não declarar encerrado antes de:

- [ ] Supabase `ACTIVE_HEALTHY`
- [ ] SELECT básico (identidade / paciente / vínculo)
- [ ] Ledgers coerentes (CLI + humano; sem versão de relógio órfã da sessão)
- [ ] Estado de migration conhecido (arquivo = linha da CLI)
- [ ] H1–H5 quando o incidente tocou schema/policy/função
- [ ] Advisors sem regressão **causada** pelo incidente
- [ ] Login WEB
- [ ] Acesso de admin da clínica
- [ ] Paciente visível para o profissional vinculado
- [ ] Vínculo ativo coerente (sem duplicata do par)
- [ ] Isolamento E1–E3 / E11 na superfície afetada
- [ ] Chat (roster se o incidente tocou canal)
- [ ] Storage (signed URL da superfície afetada; blob existe)
- [ ] App paciente, se a API compartilhada foi tocada
- [ ] Smoke da funcionalidade que quebrou

---

## K. Restore

**O restore nunca é testado pela primeira vez sobre este projeto de produção.**

Exercício futuro (WP próprio, autorização explícita), num destes:

- projeto Supabase **separado**; ou
- **Restore to new project** (Beta do Dashboard), depois de autorização; ou
- homologação dedicada.

Não usar o primeiro drill para “salvar” cliente real.

Depois de um restore autorizado (quando existir runbook):

1. Confirmar que o alvo **não** é `cdhjfyyuhmwrcuxqavib`, salvo autorização de desastre real.
2. Anotar o snapshot escolhido (hora UTC) e que Storage **não** veio junto.
3. Validar Auth (usuários do ponto restaurado).
4. Validar banco (ledgers podem voltar no tempo — esperar isso).
5. Validar blobs: paths do banco vs. objetos que ainda existem.
6. Só então apontar aplicação, se o exercício for de cutover — **PROCEDIMENTO PENDENTE**.

---

## Matriz P0 / P1 / P2

Atualizada em 2026-08-23 com o estado real do Dashboard.

### P0

- **Fechado:** “backup de banco não comprovado”. Agora: **DB backup = comprovado** (snapshots COMPLETED, restore disponível).
- PITR desabilitado **não** é P0 automático. O RPO atual do banco é o do snapshot diário.

### P1 — antes de operação clínica plena / escala

- Decidir e, se aprovado, habilitar PITR (recomendação de avaliação: 7 dias) + compute mínimo exigido.
- Definir proteção dos blobs (`DR-STORAGE-01`).
- Restore drill **fora** de produção.
- Medir e formalizar RTO.
- Homologação (projeto ou branch Supabase). PITR **não** substitui staging.

### P2

- Privilégio CLI para `backups list` (hoje 403).
- Comentário stale no WEB de que `progress-photos` seria público (o bucket remoto não é).
- Check Vercel de autor (ruído conhecido).
- Inventário contínuo de SECDEF / advisor 0029.

---

## Decisões pendentes

Não responder aqui. Só registrar.

| ID | Pergunta |
|---|---|
| **D1** | Habilitar PITR 7 dias (custo add-on + compute Small)? |
| **D2** | Qual estratégia de backup/replicação dos blobs (`DR-STORAGE-01`)? |
| **D3** | Qual ambiente do restore drill (projeto novo / Restore to new project / homologação)? |
| **D4** | Qual RTO alvo, em minutos, depois do primeiro drill medido? |

---

## O que este documento não faz

Não habilita PITR. Não altera compute. Não cria backup. Não executa restore. Não cria branch/projeto de homologação. Não muda Storage. Não cria migration.
