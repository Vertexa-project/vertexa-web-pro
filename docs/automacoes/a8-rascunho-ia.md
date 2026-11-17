# A8 — Primeira versão de dieta e treino pela Vertexa IA (Versão 1, modo demonstração)

- Botão **Gerar primeira versão (Vertexa IA)** em Planos > Plano alimentar (nutricionista) e Planos > Treino (educador físico/fisioterapeuta).
- Fluxo: escolhe o **tipo de paciente** → Edge Function `vertexa-plan-draft` (verify_jwt) lê a ficha pelo JWT do profissional (RLS) → grava o rascunho em `ai_plan_drafts` (NÃO em `nutrition_plans`/`workout_plans`) → abre o editor existente com o selo **Rascunho · gerado pela Vertexa IA (demonstração) · revise antes de publicar**.
- Dieta: calorias por Mifflin-St Jeor × 1,4 × fator do tipo; refeições/itens/quantidades do modelo-base (escalam com as calorias). Treino: A/B/C só com a `exercise_library`, com instrução e intervalo. Restrições (lactose, glúten, vegetariano, ombro, joelho, lombar, impacto) são detectadas no prontuário e nas observações e trocam itens/exercícios (listadas em "Como foi montado").
- Com `OPENAI_API_KEY` a função pede o rascunho ao modelo (prompt com o **método da clínica**), valida (exercício fora da biblioteca, calorias absurdas) e, se vier inválido 2 vezes, cai no modelo-base.
- Configurações > Clínica > **Tipos de paciente (Vertexa IA)** (admin): lista de tipos (nome, modelo-base, orientação) e método da clínica por dieta/treino. Sem edição vale a lista padrão da reunião de 28/10.
- Rascunho nunca chega ao paciente: só o que o profissional salvar/publicar no editor. Gerar de novo substitui o rascunho pendente, nunca o plano publicado.
- Fica para a Versão 2: disparo automático 24–48 h após anamnese + exames; modelos reais da Juliana (chats do ChatGPT, plano cardiometabólico); leitura dos VALORES dos exames.
- Prova SQL: `scripts/a8-sql-proof.sh` (Postgres local descartável).
