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
   e para o paciente. Coletar como deve funcionar (escopo flexível).

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

12. **Storage privado + URL assinada.** `progress_photos.photo_url` e `body_assessments.document_url`
    são URLs cruas. Confirmar bucket privado e gerar `createSignedUrl` na camada `api/` antes de
    publicar (já previsto no CLAUDE.md como pós-MVP).

13. **Salvar plano não é transacional.** `saveWorkoutPlan`/`saveNutritionPlan` fazem DELETE do plano
    anterior e depois INSERT do novo (treinos/exercícios/refeições em vários passos). Se falhar no
    meio, o plano antigo já foi apagado e o novo fica parcial. Mover para uma RPC/transação (Postgres
    function) antes de uso real, para o app paciente nunca ler um plano inconsistente.
