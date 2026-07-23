# UI de disciplinas (WP-DISC B) — permissões por união + administração

Complementa o contrato do banco em `docs/CONTRATO_INTEGRACAO.md → "Disciplinas por profissional"`.
A autorização REAL é a RLS/RPC por disciplina no banco (WP-DISC A); a UI **espelha** isso — nunca é a
barreira.

## Modelo de permissões da UI
- A autoridade **clínica** de UI vem das **DISCIPLINAS** do profissional logado — **não** mais de
  `professionals.type`.
  - **Real:** `useMyDisciplines` lê `professional_disciplines`.
  - **Demo:** `demoDisciplinesForRole` mapeia a persona do seletor → disciplinas (SÓ demo; o banco está vazio).
- `useDisciplinePermissions()` deriva `{ canEditNutrition, canEditSupplements, canEditWorkout,
  canEditBodyAssessment }` da **UNIÃO** das disciplinas (`derivePermissions`, `src/lib/domain/disciplines.ts`).
  Acumular disciplinas **só amplia, nunca restringe**.
- `roles.ts` guarda só o **ADMINISTRATIVO** (`isAdmin`) + rótulo/persona de display. `professionals.type`
  é usado apenas para o rótulo de display e para listar a equipe — **nunca** para permissão clínica.

## Espelho do mapa (⚠️ manter em sincronia com o banco)
`DISCIPLINE_WRITE_MAP` (`src/lib/domain/disciplines.ts`) é **ESPELHO** das policies do banco (migration
`20260725090000`). O teste `src/lib/domain/disciplines.test.ts` **trava** o espelho (`toEqual`) — mudar o
mapa do banco exige mudar aqui (o teste avisa). **Dívida futura:** derivar o mapa do banco (RPC/endpoint)
em vez de espelhar, eliminando a possibilidade de divergência.

| Superfície | Disciplina exigida (OU) |
|---|---|
| `nutrition_plans`, `meals`, `supplements` | nutricionista |
| `workout_plans`, `workouts`, `workout_exercises` | educador_fisico OU fisioterapeuta |
| `body_assessments` | nutricionista OU educador_fisico OU fisioterapeuta OU medico |
| `patient_documents`, `appointments` | **NÃO** escopados |

## Gating de escrita (defesa em profundidade)
1. **Botão** (`GatedAction`) nas Tabs de dieta/treino/suplementos — desabilitado, com o **motivo** visível.
2. **Editor** — botão *Salvar* desabilitado + motivo quando a disciplina falta.
3. **Mutation hook** (`useWriteGuard`) — lança `WriteForbiddenError` **antes** de tocar o banco (impede um
   caminho de escrita que só falharia na RLS).

`patient_documents` e `appointments` **não** são gateados por disciplina (mantêm a regra anterior).
`body_assessments` **não tem editor na web** (só leitura) — a permissão é derivada e exposta para uso
futuro; a anamnese via `create_patient` é administrativa (SECDEF, não passa pela policy).

## Erro de escrita negada (B5)
Se o banco (ou o guard) negar, o editor mostra mensagem amigável (`writeDeniedMessage`), sem stack. O
evento é reportado ao Sentry com `source:"authz"` — **sem PII**. `isDisciplineDenied` reconhece tanto o
`WriteForbiddenError` do cliente quanto o `forbidden: requires <disciplina>`/RLS do banco.

## Administração de disciplinas (B4)
`Configurações → Clínica → Disciplinas da equipe` (só admin) → rota `/configuracoes/disciplinas`
(`DisciplinesAdminPage`). Lista os profissionais da clínica e concede/revoga disciplinas
**individualmente** (chips por disciplina; múltiplas por profissional). Só o admin vê a área; o banco
(RPCs `assign_professional_discipline` / `revoke_professional_discipline`) é o gate real.

- **Auto-atribuição LIBERADA para o admin (WP-DISC-FIX, migration `20260802090000`):** os chips do
  **próprio** admin ficam **habilitados** (a linha dele aparece marcada com "(você)"). Motivo: sem isso a
  **clínica solo** nascia travada — `create_clinic_with_owner` cria o dono sem disciplina, sem disciplina
  ele não escreve nada clínico, e numa clínica nova não existe outra pessoa para conceder. Não é escalada:
  o admin já promove pessoas e já concede a terceiros (poderia contornar criando um co-admin).
  **Continua negado:** profissional **não-admin** atribuir/revogar (a si ou a terceiros) — ele nem vê esta
  área (fail-closed acima) e o banco recusa —, e **admin em clínica alheia** (o gate usa a clínica do
  profissional-ALVO).
- **Visibilidade** usa o **SINAL REAL do banco** (`useIsClinicAdmin` → RPC `public.am_i_clinic_admin` =
  dono OU `clinic_role='admin'`), **não** `profiles.role`. Isso corrige AUTH-ADMIN-1: um admin apenas por
  `owner`/`clinic_role='admin'` (sem `profiles.role='admin'`) **passa a ver** a área. Fail-closed: enquanto
  carrega ou em erro, a área **não** aparece. (WP-CLINIC-ADMIN-SIGNAL — migration `20260726090000`.)

## Situação inicial (importante)
`professional_disciplines` nasce **vazia** e só o admin popula. Até o admin conceder disciplinas pela tela
acima, **nenhum** profissional escreve nada clínico (lê tudo — a leitura é integrada). A tela de
administração é o primeiro passo operacional pós-deploy.
