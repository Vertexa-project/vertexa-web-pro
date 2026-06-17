---
name: app-patient-contract
description: Use quando a web profissional precisar ler/escrever dados que o app paciente também usa. Garante que os dois apps falem o mesmo "idioma" no Supabase.
---
# Contrato com o App Paciente

O app paciente (repo separado, React+Vite) escreve eventos e estados. A web LÊ esses dados.
Não mude nomes de tabela/coluna sem alinhar com o app.

Pontos de contato:
- `activity_events`: o app insere (type, payload, patient_id). A web lê para a Timeline.
  Tipos vindos do app (eventTracker.ts): workout_checked, weight_logged,
  progress_photo_uploaded, hydration_logged, sleep_logged, meal_plan_viewed, etc.
- `muscle_recovery_states`: o app faz UPSERT ao concluir treino. A web lê para o mapa corporal.
- `workout_plans`/`workouts`/`workout_exercises`: a WEB cria; o app LÊ e exibe.
- `nutrition_plans`/`meals`: a WEB cria; o app LÊ.
- `messages`: ambos inserem (sender_role distingue).

Regra de ouro: o profissional CRIA planos; o paciente EXECUTA; o backend deriva métricas.
