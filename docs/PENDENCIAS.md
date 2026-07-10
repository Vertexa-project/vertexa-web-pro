# Pendências a validar com o cliente (Bruno coleta com Juliana/Gabriel)

> Não bloqueiam o build da sprint, mas precisam ser resolvidas antes de virar definitivo no banco.

1. **Status de recuperação muscular.** O app atual usa `neutral`/`activated`; os combinados das
   calls usam `recovered`/`weakened`. São dois esquemas de 4 cores diferentes. Definir o oficial
   antes de persistir em `muscle_recovery_states`.

2. **Card compartilhável no ecossistema multiprofissional.** Quando há médico + nutri + personal,
   quem aparece no card (para não gerar "injustiça" entre profissionais)? Só o pagante? Os três?

3. **Pesos do VRI v1 e pontuação do ranking.** Confirmar os pesos exatos de cada ação (treino vale
   mais que hábito simples, etc.). Hoje há valores no adherenceEngine.ts — validar com a clínica.

4. **Profissional externo convidado.** Modelo de acesso, permissão e incentivo. Hoje só temos a
   flag `is_external` no link. Falta a regra de negócio.

5. **Foto de treino.** Bloqueia pontuação ou só aumenta confiança? Câmera obrigatória (sem galeria)?

6. **Campanhas MVP vs V2.** Quais entram já e quais ficam para depois.

7. **WhatsApp.** Entra no MVP real ou fica simulado primeiro? (Recomendação: simulado nesta sprint.)

8. **Visão financeira do paciente.** Mostrar paciente com lente financeira (receita/LTV) — o próprio
   cliente levantou possível "conflito moral". Confirmar se entra no perfil do paciente ou só no
   dashboard gerencial.

9. **Relatórios PDF de evolução.** Pedido pela cliente (Discord 14/06) — semana a semana, para ela
   e para o paciente. Coletar como deve funcionar (escopo flexível). **PARCIAL ✅:** já existem DOIS
   relatórios PDF client-side (`src/lib/pdf/*`, casca `ReportShell`+primitivos): (a) **Evolução**
   (KPIs+gráfico de peso+antropometria+fotos) e (b) **Pontos/VRI** (herói do VRI LIDO do snapshot +
   pontos fortes/atenção + resumo de peso + recado motivacional; pensado p/ o paciente levar ao
   retorno / WhatsApp / impressão). Falta validar com a cliente a CADÊNCIA "semana a semana" e o
   escopo definitivo (o que entra/sai). Sem execução de treino (dívida #S-EXEC).

10. **GIFs/vídeos de exercício.** Hoje o app usa URLs de terceiros (fitnessprogramer.com). Definir
    fonte própria/licenciada antes de publicar.

## Pendências técnicas (segurança/infra — antes de dados reais)

11. **RLS real (substituir policy temporária da sprint).** As tabelas estavam com RLS ligada e
    ZERO policies (cliente lia 0 linhas). Adicionada migration `sprint_anon_read_policies` com
    `sprint_read_all` = SELECT `using(true)` para `anon`+`authenticated` em todas as 17 tabelas —
    **TEMPORÁRIA, só com dados fictícios/seed**. Antes de qualquer dado real de paciente: remover
    `anon` do SELECT, trocar por RLS por papel/clínica (admin vê a clínica; profissional vê via
    `professional_patient_links`; externo vê só o paciente vinculado via `is_external`). Não publicar
    em domínio público enquanto estiver `using(true)` (vazamento de dados de saúde — LGPD).

12. **Storage privado + URL assinada.** ✅ **PARCIAL (S-DOCS):** os **exames/documentos** novos já vivem em
    bucket **PRIVADO** `patient-documents` (`public=false`) + `createSignedUrl` (TTL 10 min) na camada
    `api/documents.ts` (tabela `patient_documents`, migration `20260702230000`) — o EXAME/DOCUMENTO está
    resolvido (o profissional envia, a equipe lê via link assinado no clique). **Ainda cru (dívida aberta):**
    `progress_photos.photo_url` (bucket `progress-photos` PÚBLICO) e o legado `body_assessments.document_url`
    (URL crua sob allowlist `isSafeDocumentUrl`, #18). Migrar essas duas fontes para o mesmo padrão (bucket
    privado + signed URL) antes de publicar com dado real.

13. **Salvar plano não é transacional.** `saveWorkoutPlan`/`saveNutritionPlan` fazem DELETE do plano
    anterior e depois INSERT do novo (treinos/exercícios/refeições em vários passos). Se falhar no
    meio, o plano antigo já foi apagado e o novo fica parcial. Mover para uma RPC/transação (Postgres
    function `SECURITY DEFINER`) antes de uso real, para o app paciente nunca ler um plano inconsistente.

14. **Checklist de segurança ANTES de dados reais (produção) — BLOQUEANTE.** Hoje a sprint roda com
    RLS permissiva (`using(true)`) + modo demo, só com seed fictício. Antes de qualquer paciente real:
    - **AUTH REAL LIGADO (WP-03/AUTH-01), mas RLS real segue pendente (WP-05).** A identidade real já
      existe (`VITE_AUTH_MODE=real` → login Google → `auth.uid()` → `profiles.auth_user_id` → professional
      → clinic; trigger `handle_new_user` associa por e-mail VERIFICADO ou cria `pending`). **Isto NÃO é
      autorização** — a RLS continua permissiva, então o modo real não expõe mais que o demo já expõe,
      MAS também não protege. Fechar a RLS por papel/clínica usando `auth.uid()` (em vez do env pin) é
      exatamente o WP-05. Até lá, **não publicar com dado real**. O demo/pin deve ser desabilitado em
      produção (ver #21). A guarda anti account-takeover (e-mail verificado) já está no trigger.
    - **Superfície do app PACIENTE coberta (WP-04/AUTH-02).** O `handle_new_user` agora é ciente da
      superfície e **fail-closed**: NO-MATCH cria sempre um `patient` pending NEUTRO (nunca `professional`),
      porque `signup_surface` é user_metadata controlável pelo client e não pode conceder privilégio; o
      match por e-mail continua role-agnóstico (paciente semeado linka como paciente) e o provider-gate
      Google segue intacto. Diagnóstico do trigger em `auth_trigger_events` (deny-all, sem PII). Ainda
      assim, **promoção a `professional`** (convite/admin/provisioning) e o **vínculo/onboarding do
      paciente** (Parte B do app) seguem pendentes; a RLS real (por papel/clínica) continua sendo o WP-05.
    - **Leitura por papel/clínica** (substituir `sprint_read_all`): admin vê a clínica; profissional vê
      via `professional_patient_links`; externo (`is_external`) só o paciente vinculado. Hoje qualquer
      anon lê tudo (a anon key é pública no bundle).
    - **Escrita de planos restrita** (substituir `sprint_plan_write` `using(true)`): hoje qualquer anon
      pode apagar/reescrever o plano de QUALQUER paciente (o `professionalId` é escolhido no client).
      Validar o vínculo no servidor (RPC `SECURITY DEFINER` + `auth.uid()`), nunca confiar no client.
    - **Escrita do app paciente restrita** (writes permissivos versionados em
      `20260618130000_sprint_write_policies.sql`): `activity_events` (`sprint_activity_write`, INSERT) e
      `muscle_recovery_states` (`sprint_muscle_write_insert` INSERT + `sprint_muscle_write_update` UPDATE)
      hoje aceitam `with check (true)` de qualquer anon — ou seja, qualquer um pode injetar evento/estado
      de recuperação para QUALQUER paciente. Sob RLS real, só o próprio paciente (`auth.uid()` → seu
      `patient_id`) pode escrever os seus eventos/estados. Mesmo padrão em `meal_logs`
      (`20260701120000_meal_logs.sql`: `sprint_meal_write_insert` INSERT + `sprint_meal_write_delete`
      DELETE, `with check`/`using (true)`) e `activity_sessions` (`20260702120000_activity_sessions.sql`:
      `sprint_activity_session_write` INSERT `with check (true)`) — qualquer anon pode marcar/desmarcar
      refeição ou lançar atividade complementar para QUALQUER `patient_id`. Fecham junto na mesma RLS real
      por `auth.uid()` → `patient_id`. Idem `supplements` + `supplement_intakes`
      (`20260702140000_supplements.sql`, S3/app): `sprint_supplement_write` (ALL — autoria do web, editor
      implementado na S-SUPL-EDITOR) e
      `sprint_supplement_intake_insert`/`_delete` (`with check`/`using (true)`) — qualquer anon pode editar
      a LISTA de suplementos e marcar/desmarcar "tomado" para QUALQUER `patient_id`. Mesma RLS real fecha.
    - **Conquistas (`achievements` + `patient_achievements`, S5/app)** — `20260702210746_achievements.sql`:
      `sprint_achievement_read` (SELECT no catálogo GLOBAL) + `sprint_patient_achievement_read` (SELECT) +
      `sprint_patient_achievement_insert` (INSERT `with check (true)`, escrito PELO MOTOR `achievementsEngine`).
      SEM UPDATE/DELETE para anon (unlock é monotônico; UPSERT `on conflict do nothing`). Hoje qualquer anon lê o
      catálogo e INSERE unlocks para QUALQUER `patient_id`. Sob RLS real: o catálogo segue leitura pública (NÃO é
      dado de paciente), mas `patient_achievements` fecha por `auth.uid()` → `patient_id` (só o próprio paciente
      destrava as suas). O motor de conquistas NÃO alimenta o VRI — escreve só em `patient_achievements`.
    - **Notificações (`notifications`, S6/app)** — `20260702220402_notifications.sql`:
      `sprint_notification_read` (SELECT) + `sprint_notification_update` (UPDATE, para marcar como lida),
      anon/auth `using/with check (true)`. SEM INSERT/DELETE para anon: as notificações NASCEM DE SEED/migration
      (**dívida: "emissor de notificações no web"** — a web/Edge ainda não gera notificações a partir de eventos).
      Hoje qualquer anon lê e marca como lida QUALQUER notificação. Sob RLS real: fechar por
      `auth.uid()`->`patient_id` e restringir o UPDATE à coluna `read_at` das PRÓPRIAS notificações.
    - **Documentos/exames (`patient_documents` + bucket privado `patient-documents`, S-DOCS)** —
      `20260702230000_patient_documents.sql`: `sprint_patient_document_read` (SELECT) +
      `sprint_patient_document_insert` (INSERT `with check (true)`), SEM UPDATE/DELETE (documento imutável na
      sprint); storage `sprint_patient_documents_storage_read` (SELECT) + `sprint_patient_documents_storage_write`
      (INSERT) escopadas só por `bucket_id`. ⚠️ **DADO DE SAÚDE MAIS SENSÍVEL (exame em PDF/imagem)**: hoje
      qualquer anon LISTA os caminhos (patient_id + nome do arquivo) de QUALQUER paciente e ASSINA a URL de
      QUALQUER objeto (o SELECT em `storage.objects` é justamente o que habilita o signed URL no anon). Sob RLS
      real (S9): SELECT só profissionais VINCULADOS (`professional_patient_links`) + o próprio paciente
      (`auth.uid()`→`patients`); INSERT do profissional via `auth.uid()`→`professionals`, do paciente só o próprio
      (`professional_id` NULL); storage fechado por pasta = `patient_id`. O bucket é PRIVADO (sem URL pública), mas
      a anon key é pública no bundle → NÃO publicar em domínio público enquanto permissivo (LGPD).
    - **Modo demo** não pode usar a sessão anon contra o banco real quando a RLS fechar — isolar em
      dataset fictício ou desabilitar em `import.meta.env.PROD`.
    - **IDOR**: `getPatient(id)` lê qualquer UUID da URL; a barreira real é a RLS (acima) — tratar
      0 linhas/erro como 403 na UI.
    - **Storage privado + URL assinada** (ver #12). Confirmar que o app paciente também faz escaping
      do conteúdo de planos/mensagens.
    - **Chat (`chat_channels` / `chat_participants` / `chat_messages` / `chat_mentions`)**: hoje rodam
      permissivas — `sprint_read_all` (SELECT) + `sprint_chat_write` (ALL), `anon`/`authenticated`
      `using(true)`. Sob RLS real, só os **participantes do canal** (paciente dono + profissionais
      vinculados, via `chat_participants`) podem ler/escrever. O **realtime** (`postgres_changes`)
      respeita essas policies — portanto fechar a RLS aqui também controla o que vaza pelo realtime.
    - **Cadastro de paciente pela web (Sessão 4)** — `20260625180000_sprint_patient_create_write_policies.sql`:
      INSERT permissivo em `patients` / `professional_patient_links` / `body_assessments` (`with check (true)`)
      + `profiles` (`with check (role = 'patient')` — já restrito ao papel na sprint para não permitir forjar
      admin/professional). Sob RLS real: derivar `clinic_id`/`professional_id` de `auth.uid()` no servidor
      (RPC `SECURITY DEFINER` que cruza `professionals.profile_id`), nunca confiar no que o client enviou —
      o isolamento por clínica hoje é **client-side** (vem do `DEMO_PROFESSIONAL_PROFILE_ID`).
    - **Ledger técnico interno (Sessão 7/8) — ✅ RESOLVIDO no remoto (S8).** `20260626120000_schema_migration_log.sql`
      criou `schema_migration_log`; `20260626123000_schema_migration_log_internal_only.sql` (**aplicada via MCP em
      2026-06-26**) removeu `miglog_read`, revogou privilégios de `anon`/`authenticated` e manteve RLS ligada.
      Validado: 12 linhas, sem policy pública, `has_table_privilege(anon/authenticated,select)`=false, `relrowsecurity`=true.
      O ledger não aparece no portal (sem API client/hook/rota/card; `rg` em `src`=0); inspeção só por MCP/SQL/migrations.
    - **Agenda interna (Sessão 6)** — `20260626090000_appointments_internal_agenda.sql`:
      `appointments` roda permissiva — `sprint_appointment_read` (SELECT) + `sprint_appointment_write` (ALL),
      `anon`/`authenticated` `using/with check (true)`. Qualquer anon lê/escreve compromissos de QUALQUER
      clínica; o isolamento por `clinic_id` é **client-side** (vem do profissional logado). Sob RLS real:
      admin vê a clínica, profissional vê só a sua, e `clinic_id` deriva de `auth.uid()` no servidor.
      ⚠️ **`appointments.notes` é texto livre vinculado a paciente nominal → DADO SENSÍVEL**: não publicar
      em domínio público enquanto o SELECT for `using(true)`; tratar `notes` como sensível na futura RLS e
      nunca logar. O select de **paciente** no diálogo usa `useListPatients()` (não escopado por clínica,
      igual ao resto do app) — fechar junto (criar `listClinicPatients`).

15. **✅ RESOLVIDO (WP-05B Fam8, 2026-07-11) — tabela legada `messages` APOSENTADA (DROP).** Prova: 0 linhas
    (purgada na Fase A), 0 FK de terceiros, 0 uso no web e no app (só um comentário em `types/db.ts`), fora do
    realtime → MORTA. Migration `20260718090000_wp05b_fam8_drop_legacy_messages` fez `DROP TABLE public.messages`
    (rollback = recriar vazia, no header). Substituída por `chat_*` (Família 4, já com RLS real). Nada mais depende dela.

16. **`createPatient` não é transacional (Sessão 4).** O cadastro encadeia 4 inserts
    (`profiles` → `patients` → `professional_patient_links` → `body_assessments`) sem transação. Um
    erro no meio deixa um `profile` de paciente (dado pessoal) órfão, sem patient/vínculo e sem caminho
    de UI para limpar (a web não tem DELETE). Igual à dívida #13 dos planos: mover para uma RPC/transação
    (`SECURITY DEFINER`, begin/commit) antes de cadastro real — isso também resolve o isolamento (#14).
    Hoje OK só com seed fictício.

17. **`listPatients` lê embeds sem limite (perf pré-produção).** O `select` da listagem embute
    `activity_events`, `weight_logs(measured_at)` e `progress_photos(taken_at)` SEM limite, só para
    calcular a recência (`lastActivityAt`/`lastWeightAt`/`lastPhotoAt`) no client. Sem impacto com seed,
    mas em produção um paciente com histórico longo traz centenas de linhas por acesso à lista. Mover o
    cálculo para o banco (RPC/`view` com `max()` agrupado) antes de escala real.

18. **Validar esquema de URL de documento no client (Sessão 4 — mitigado).** `DocumentsTab` só abre
    `document_url` num `<a href>` se passar pela allowlist `isSafeDocumentUrl()` (https:// ou
    `data:application/pdf;base64,`) — defesa contra `javascript:`/`data:text/html` gravado por anon
    (INSERT permissivo). A correção definitiva é a #12 (bucket privado + signed URL, sempre https).

19. **Conectar Google Agenda (gancho da Sessão 6 — placeholder).** A agenda é 100% INTERNA nesta fase
    (tabela `appointments`, CRUD na web). O botão "Conectar Google Agenda" no `AgendaCard` é gancho
    desabilitado ("Em breve"). Quando vierem as credenciais: trocar a FONTE da agenda pela API do Google
    (OAuth + escopos), mantendo o CRUD interno como fallback. **Google Meet NÃO entra.** Subdívidas da
    agenda: (a) **RLS/isolamento** de `appointments` por papel/clínica no servidor (parte do #14, incl.
    `notes` sensível); (b) **fuso**: a janela de leitura usa o fuso do NAVEGADOR (`startOfDay` local) e o
    seed ancora em `America/Sao_Paulo` — coincidem no BR (premissa da demo), mas fora do fuso BR a aba
    "Hoje" pode deslocar; robustez real = derivar/persistir o fuso da clínica e calcular a janela nele
    (ex.: `date-fns-tz`); (c) **UX**: confirmação de exclusão usa `window.confirm` nativo (trocar por
    AlertDialog do design system pós-MVP). **Status (Sessão 10): integração REAL read-only implementada**
    (Edge Functions + tabelas `calendar_*` + agenda mesclada interna+Google no `AgendaCard`); o placeholder
    saiu. As subdívidas (a) isolamento server-side → vira **#23**; (b) fuso e (c) `window.confirm` seguem abertas.

20. **Financeiro por papel (Sessão 6 — diferido/stretch).** Não implementado nesta sessão. Forma proposta:
    aba/rota `/financeiro` gated por papel (admin/gestor/financeiro) — com a RBAC mínima por `profiles.role`;
    como a demo loga como Camila (`professional`), a aba ficaria corretamente OCULTA (só admin a veria).
    Conteúdo inicial = placeholder de UI para fontes de import (CSV/PDF/planilha/extrato), **SEM** parser real
    e **SEM** Open Finance. Retomar quando houver persona admin demonstrável ou auth real.

21. **RBAC de UI ≠ RLS de dados (Sessão 7).** O papel do logado (admin/médico/nutri) controla o que a UI
    MOSTRA/EDITA (`lib/domain/roles.ts` + `useRole`), inclusive um seletor de papel "modo demonstração"
    (runtime, não persiste). Isto é **gating de UI, não autorização** — qualquer client com a anon key
    ainda lê/escreve os dados (RLS sprint permissiva). A autorização real por papel/clínica é a dívida
    #11–#14 (Sessão 9): quando a RLS fechar, o papel deve vir de `auth.uid()`→`profiles.role`/`professionals`,
    e o override de demonstração deve ser desabilitado em produção (`import.meta.env.PROD`). O override de
    demo hoje vive só em memória (reseta no reload) — aceitável para a demo (troca de persona ao vivo).
    - **AUTH-01 (WP-03):** com `VITE_AUTH_MODE=real` a identidade já vem de `auth.uid()`→profile→professional
      (não do pin), e o botão/seletor de demonstração fica escondido. **Em PROD deve-se rodar
      `VITE_AUTH_MODE=real`** (o pin `VITE_DEMO_PROFESSIONAL_PROFILE_ID` e o "modo demonstração" ficam então
      inertes). Falta o gate defensivo por `import.meta.env.PROD` (forçar real em PROD independentemente da
      flag) — anotado aqui; a RLS real (#14/WP-05) é o que efetivamente protege.

22. **Cifrar `refresh_token` do Google em repouso (Sessão 10 — S9/P1).** A tabela
    `calendar_connection_tokens` é **deny-all** (sem leitura por `anon`/`authenticated`; só `service_role`
    via Edge Function), mas o `refresh_token` é gravado em texto puro. Antes de conectar a agenda REAL de uma
    clínica, cifrar em repouso (pgsodium/Supabase Vault) e descriptografar só na Edge Function. Guarda-chuva
    de segurança da S9 (junto de #11–#14).

23. **Verificação de admin/tenant no SERVIDOR para o Google Calendar (Sessão 10 — S9).** Hoje as Edge
    Functions `google-calendar-auth/sync/disconnect` recebem `clinicId`/`professionalId` do client (não há
    `auth.uid()` no modo demo) e o gating de "admin" é só de UI (RBAC S7). As funções já escopam SEMPRE por
    `clinic_id` (sem caminho por id solto — corrigido na revisão da S10), mas a posse real ("admin desta
    clínica") só fecha na S9: a função deve ler o JWT → `auth.uid()` → `profiles`/`professionals` e rejeitar
    divergência de clínica. **Pré-S9: conectar apenas conta Google de TESTE** (ver `docs/ops/SETUP_GOOGLE_CALENDAR.md`).
    Hardening já aplicado: `ALLOWED_REDIRECT_ORIGINS` (allowlist do redirect do callback) — configurar em produção.

24. **Seleção da conexão da clínica por status (Sessão 10 — latente, pós-S9).** `getCalendarConnection` e o
    `google-calendar-sync` (escopo por clínica) pegam a conexão mais recente por `updated_at` (limit 1), sem
    priorizar `status='connected'`. Com **mais de uma conexão por clínica** (só possível com OAuth real e 2+
    contas, post-S9), uma conexão `revoked`/`error` recém-falhada (que bumpa `updated_at`) poderia ser
    re-selecionada no lugar de uma boa. Hoje há no máximo 1 conexão por clínica (seed/demo), então não se
    manifesta. Correção: priorizar `connected` (ou alinhar com a decisão de unicidade do índice) ao resolver
    "a conexão da clínica".

25. **Fuso horário fixo no calendário (Sessão 12 — pós-demo).** O FullCalendar usa `timeZone: 'local'` (correto
    para a demo BR — fuso do navegador). Para clínicas/usuários fora de `America/Sao_Paulo` (ex.: Manaus, Acre),
    a linha do "agora" e a posição dos eventos divergem do horário da clínica. Pós-demo, fixar
    `timeZone: 'America/Sao_Paulo'` exige o plugin `@fullcalendar/luxon3` (~60 KB gzip) — não entrou agora para
    não inflar o bundle. Avaliar quando houver clínica multi-fuso. **Obs.:** a RLS real dos novos campos
    `appointments.type/status` segue no guarda-chuva da S9 (a policy de sprint de `appointments` é permissiva;
    ver #11–#14) — adicionar colunas não muda o modelo de acesso.

26. **Thresholds dos SINAIS DE RISCO — validar clínica com a Juliana (S-RISK).** O painel "Sinais de risco"
    (aba Visão geral, `src/lib/domain/riskSignals.ts`, read-only) usa DEFAULTS não validados clinicamente:
    (a) **sobrecarga muscular** = músculo `fatigued` sustentado ≥3 dias (alta ≥5) — além da janela normal de
    fadiga (0–2d do `recoveryRule` do app); ⚠️ baseado no `status` PERSISTIDO de `muscle_recovery_states`, que
    **não decai server-side** (ver #1) → um `fatigued` pode ficar "preso"; sobrecarga CRÔNICA real (recorrência/
    carga acumulada) só com **histórico de sessões de treino**, que ainda não existe (dívida #S-EXEC). (b) **meta
    de água = 2,0 L/dia** — **NÃO existe meta por paciente** no banco; é um default. Definir a meta (fixa? por
    peso, ex. 35 ml/kg? por paciente, nova coluna?) e a janela (hoje uso 7 dias completos). (c) **foto ausente**
    = 30d (espelha as pendências) / alta 60d. (d) **mobilidade = SEM FONTE**: o app não registra mobilidade/
    aquecimento (conteúdo estático) → o sinal aparece honestamente como "sem dados" e **fica pendente até existir
    um módulo de mobilidade no app** que persista os dados. Nenhum threshold é bloqueante para a demo (só seed
    fictício), mas todos precisam do aval da Juliana antes de virar régua clínica real.

27. **WP-05B RLS real — FAMÍLIA 1 (Identidade) ✅ CONCLUÍDA; famílias restantes pendentes.** As 5 tabelas de
    identidade (`profiles`, `professionals`, `patients`, `professional_patient_links`, `clinics`) agora têm **RLS real
    por papel/clínica/vínculo** (fecha a parte de IDENTIDADE das #11–#14). Migrations `20260711093000` (co-admin
    aditiva) + `20260711094000` (helpers `private.*`) + `20260711095000` (policies), branch `feat/rls-real-web`,
    aguardando auditoria do dono. Testes Nível 1 verdes (`supabase/tests/wp05b_fam1_identity_test.sql`). Decisões
    AUTH-ADMIN-1/EXT-1/AGENDA-1 e contrato de helpers em `CONTRATO_INTEGRACAO.md`.
    **FAMÍLIA 2 (Comportamento do Paciente) ✅ CONCLUÍDA** (migrations `20260712090000` helpers + `20260712091000`
    policies): RLS real por vínculo em `weight_logs`, `activity_events`, `activity_sessions`, `meal_logs`,
    `supplement_intakes`, `muscle_recovery_states`, `adherence_snapshots`, `workout_session_logs`, `workout_set_logs`,
    `progress_photos` (só metadado), `body_assessments` (externo excluído). Escrita `is_self_patient` (anti-forja);
    testes `supabase/tests/wp05b_fam2_behavior_test.sql`.
    **FAMÍLIA 3 (Prescrição — eixo invertido) ✅ CONCLUÍDA** (migrations `20260713090000` helpers + `20260713091000`
    policies): RLS real em `workout_plans`, `workouts`, `workout_exercises`, `nutrition_plans`, `meals`, `supplements`.
    Profissional vinculado/admin PRESCREVE (`can_prescribe_for_patient`); **paciente só LÊ** (`can_access_patient_internal`,
    externo excluído). patient_id/plan_id imutáveis; testes `supabase/tests/wp05b_fam3_prescription_test.sql`.
    **FAMÍLIA 4 (Chat — por participação; realtime) ✅ CONCLUÍDA** (migrations `20260714090000` helpers + `20260714091000`
    policies): RLS real em `chat_channels`, `chat_participants`, `chat_messages`, `chat_mentions` por PARTICIPAÇÃO
    (`can_read_channel`). SELECT fecha o REALTIME (não-participante não recebe); INSERT de mensagem = participante +
    `sender_profile_id = current_profile_id()` (anti-forja); admin lê por oversight mas não envia; testes
    `supabase/tests/wp05b_fam4_chat_test.sql`.
    **FAMÍLIA 5 (Documentos) ✅ CONCLUÍDA** (migration `20260715090000`): RLS real na TABELA `patient_documents`
    (metadado). SELECT `can_access_patient_internal` (externo excluído); escrita `can_prescribe_for_patient` (paciente
    não sobe); patient_id/file_path imutáveis; testes `supabase/tests/wp05b_fam5_documents_test.sql`. **Bucket NÃO tocado.**
    **FAMÍLIA 6 (Agenda/Clínica — duas chaves) ✅ CONCLUÍDA** (migrations `20260716090000` helpers + `20260716091000`
    policies): RLS real em `appointments` (chave PACIENTE/AUTH-AGENDA-1: vínculo, não clínica; paciente/externo excluídos;
    `notes` sensível), `campaigns` (chave CLÍNICA: staff lê, admin escreve; paciente não vê), `calendar_connections`/
    `calendar_event_cache` (SELECT-only: dono da conexão+admin; Edge escreve; **cache fecha a porta lateral do Google**).
    `calendar_connection_tokens`/`calendar_oauth_state` seguem **deny-all** (não tocados). Testes
    `supabase/tests/wp05b_fam6_agenda_test.sql`.
    **FAMÍLIA 7 (Gamificação/Notificações — três modelos) ✅ CONCLUÍDA** (migration `20260717090000`): RLS real em
    `achievements` (CATÁLOGO: SELECT authenticated, anon negado; escrita de ninguém pelo client — os 12 itens intactos),
    `patient_achievements` (SELECT `can_access_patient_internal` externo excluído; INSERT `is_self_patient` anti-forja;
    append-only; **dívida: desbloqueio client-side = paciente pode inflar gamificação, mover p/ engine server-side**),
    `notifications` (SELECT/UPDATE só o destinatário; UPDATE só `read_at`; INSERT/DELETE negado — emissor server-side).
    Testes `supabase/tests/wp05b_fam7_gamification_test.sql`. **Advisors: `rls_policy_always_true` VAZIO.**
    **FAMÍLIA 8 (legado `messages`) ✅ CONCLUÍDA — DROP** (migration `20260718090000`): tabela comprovadamente morta
    (0 linhas, 0 FK de terceiros, 0 uso web/app, fora do realtime) → `DROP TABLE`. Fecha a #15. Substituída por `chat_*`.
    **🏁 FASE B (BANCO) FECHADA — 8 famílias. TODA tabela de dados do schema `public` tem RLS real (ou foi aposentada).**
    Só resta `sprint_*` em **`storage.objects` (3 policies = WP de STORAGE dedicado)** — nenhuma tabela de dados.
    **STORAGE (WP DEDICADO, PENDENTE — NÃO resolvido):** os BUCKETS `progress-photos` (público → tornar privado, mudança
    de contrato: path+signed URL) e `patient-documents` (privado, mas policy de `storage.objects` bucket-wide =
    `sprint_patient_documents_storage_read`/`_write` + `sprint_progress_photos_write`) seguem em sprint — ver #12. As
    TABELAS `progress_photos` (Fam2) e `patient_documents` (Fam5) já estão fechadas; falta fechar os BUCKETS/`storage.objects`.
    Owner-checks: (a) `Settings > API` expõe só `public`(+`graphql_public`), **`private` fora**; (b) remover os 2 objetos
    demo `demo/mariana/*.png` via Storage API. Dívidas: Fam2 — `adherence_snapshots`/`muscle_recovery_states` gravadas pelo
    paciente (mover p/ engine server-side); Fam3 — prescrição não escopada por disciplina + `DÍVIDA-APP-1` (save
    DELETE+INSERT, RLS não piora); Fam4 — `sender_profile_id` vem do client (RLS amarra ao current_profile_id).

28. **web `createPatient` incompatível com a RLS de identidade (dívida introduzida pela Família 1; relacionada à #16).**
    `src/lib/api/patients.ts` cria paciente inserindo `profiles` direto (role='patient') + `patients` +
    `professional_patient_links`. Sob a RLS real: `profiles` INSERT é **negado** ao client (profile nasce via trigger
    `handle_new_user`); `patients` INSERT e o vínculo exigem **admin da clínica**. Efeito: o fluxo de "cadastrar
    paciente" pela web para de funcionar sob login real. **Correção (fora do escopo da Família 1):** mover para
    provisionamento server-side (Edge Function `service_role`, resolvendo também a #16 transacional) ou fluxo de
    convite (paciente cria o próprio profile no 1º login; admin vincula). Gates (typecheck/lint/build) seguem verdes
    (é comportamento de runtime, não de build).
