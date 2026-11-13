-- Consulta assistida (parte 1) — modelo de prontuário padrão v2 (16 seções, docs/automacoes/modelo-prontuario-padrao.md).
-- ADITIVA: novo registro em clinical_templates (o v1 deixa de ser o padrão, continua existindo para os
-- atendimentos que já o usaram — cada atendimento guarda seu template_snapshot) e duas funções NOVAS
-- versões de funções desta própria feature (create or replace), ainda sem uso clínico real:
--   * clinical_template_has_key: ignora seções de sistema (profissional);
--   * clinical_encounter_people: devolve também registro/conselho do profissional (seção "Profissional").

create or replace function private.clinical_template_has_key(p_snapshot jsonb, p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select exists (
    select 1
      from jsonb_array_elements(p_snapshot -> 'sections') s,
           jsonb_array_elements(s -> 'fields') f
     where coalesce((s ->> 'system')::boolean, false) = false
       and (s ->> 'id') || '.' || (f ->> 'id') = p_key
  )
$$;

create or replace function public.clinical_encounter_people(p_encounter uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.clinical_can_access_encounter(p_encounter) then
    jsonb_build_object(
      'professional', (select pf.full_name from public.clinical_encounters e
                         join public.professionals pr on pr.id = e.professional_id
                         join public.profiles pf on pf.id = pr.profile_id where e.id = p_encounter),
      'registry', (select pr.registry_number from public.clinical_encounters e
                     join public.professionals pr on pr.id = e.professional_id where e.id = p_encounter),
      'specialty', (select pr.specialty from public.clinical_encounters e
                      join public.professionals pr on pr.id = e.professional_id where e.id = p_encounter),
      'type', (select pr.type from public.clinical_encounters e
                 join public.professionals pr on pr.id = e.professional_id where e.id = p_encounter),
      'addenda', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text, 'created_at', a.created_at,
                    'author', (select pf.full_name from public.professionals pr join public.profiles pf on pf.id = pr.profile_id
                                where pr.id = a.author_professional_id)) order by a.created_at)
                  from public.clinical_addenda a where a.encounter_id = p_encounter), '[]'::jsonb))
  else null end
$$;

update public.clinical_templates set is_default = false where clinic_id is null and is_default and version = 1;

insert into public.clinical_templates (clinic_id, name, version, is_default, sections)
select null, 'Prontuário padrão Vertexa (v2)', 2, true, $json$[
 {
  "id": "identificacao",
  "title": "Identificação e contexto",
  "fields": [
   {
    "id": "idade",
    "label": "Idade"
   },
   {
    "id": "profissao_rotina",
    "label": "Profissão e rotina de trabalho"
   },
   {
    "id": "estado_civil",
    "label": "Estado civil"
   },
   {
    "id": "tipo_atendimento",
    "label": "Tipo de atendimento (presencial/online)"
   },
   {
    "id": "primeira_ou_retorno",
    "label": "Primeira consulta ou retorno"
   }
  ]
 },
 {
  "id": "objetivo",
  "title": "Motivo da consulta e objetivo",
  "fields": [
   {
    "id": "queixa_principal",
    "label": "Queixa principal (frase do paciente)"
   },
   {
    "id": "objetivo_principal",
    "label": "Objetivo principal"
   },
   {
    "id": "objetivos_secundarios",
    "label": "Objetivos secundários"
   }
  ]
 },
 {
  "id": "historia",
  "title": "História do objetivo atual",
  "fields": [
   {
    "id": "evolucao_peso_corpo",
    "label": "Evolução do peso e do corpo"
   },
   {
    "id": "tentativas_anteriores",
    "label": "Tentativas anteriores (dietas, profissionais, medicações)"
   },
   {
    "id": "padrao_alimentar_comportamento",
    "label": "Padrão alimentar e comportamento"
   },
   {
    "id": "fatores_desencadeantes",
    "label": "Fatores desencadeantes"
   }
  ]
 },
 {
  "id": "antecedentes_pessoais",
  "title": "Antecedentes pessoais",
  "fields": [
   {
    "id": "doencas",
    "label": "Doenças (atuais e prévias)"
   },
   {
    "id": "cirurgias",
    "label": "Cirurgias"
   },
   {
    "id": "internacoes",
    "label": "Internações"
   },
   {
    "id": "alergias",
    "label": "Alergias"
   }
  ]
 },
 {
  "id": "medicacoes",
  "title": "Medicações em uso",
  "fields": [
   {
    "id": "uso_atual",
    "label": "Uso atual (nome, dose, frequência, desde quando)"
   },
   {
    "id": "uso_anterior",
    "label": "Uso anterior"
   }
  ]
 },
 {
  "id": "suplementos",
  "title": "Suplementos, manipulados e hormônios",
  "fields": [
   {
    "id": "uso_atual",
    "label": "Uso atual"
   },
   {
    "id": "uso_anterior",
    "label": "Uso anterior"
   },
   {
    "id": "nao_usou",
    "label": "Citados como não utilizados"
   }
  ]
 },
 {
  "id": "antecedentes_familiares",
  "title": "Antecedentes familiares",
  "fields": [
   {
    "id": "antecedentes_familiares",
    "label": "Doença, parentesco, idade de início e desfecho"
   }
  ]
 },
 {
  "id": "habitos",
  "title": "Hábitos de vida",
  "fields": [
   {
    "id": "atividade_fisica",
    "label": "Atividade física"
   },
   {
    "id": "sono",
    "label": "Sono"
   },
   {
    "id": "hidratacao",
    "label": "Hidratação"
   },
   {
    "id": "intestino",
    "label": "Intestino"
   },
   {
    "id": "alimentacao",
    "label": "Alimentação (refeições e horários)"
   },
   {
    "id": "intolerancias",
    "label": "Intolerâncias"
   },
   {
    "id": "alcool",
    "label": "Álcool"
   },
   {
    "id": "tabagismo",
    "label": "Tabagismo"
   },
   {
    "id": "estresse_saude_mental",
    "label": "Estresse e saúde mental"
   },
   {
    "id": "rotina_trabalho",
    "label": "Rotina de trabalho"
   }
  ]
 },
 {
  "id": "revisao_sistemas",
  "title": "Revisão de sistemas",
  "fields": [
   {
    "id": "gastrointestinal",
    "label": "Gastrointestinal"
   },
   {
    "id": "cardiovascular",
    "label": "Cardiovascular"
   },
   {
    "id": "respiratorio",
    "label": "Respiratório"
   },
   {
    "id": "osteoarticular",
    "label": "Osteoarticular e mobilidade"
   },
   {
    "id": "outros_sintomas",
    "label": "Outros sintomas relevantes"
   }
  ]
 },
 {
  "id": "exame_fisico",
  "title": "Exame físico e medidas",
  "fields": [
   {
    "id": "peso",
    "label": "Peso"
   },
   {
    "id": "altura",
    "label": "Altura"
   },
   {
    "id": "imc",
    "label": "IMC"
   },
   {
    "id": "circunferencia_abdominal",
    "label": "Circunferência abdominal"
   },
   {
    "id": "pressao_arterial",
    "label": "Pressão arterial"
   },
   {
    "id": "frequencia_cardiaca",
    "label": "Frequência cardíaca"
   },
   {
    "id": "composicao_corporal",
    "label": "Composição corporal (bioimpedância/DEXA)"
   }
  ]
 },
 {
  "id": "exames_trazidos",
  "title": "Exames trazidos",
  "fields": [
   {
    "id": "exames_trazidos",
    "label": "Exame, data e resultado relevante"
   }
  ]
 },
 {
  "id": "avaliacao",
  "title": "Avaliação e hipóteses",
  "fields": [
   {
    "id": "impressao_clinica",
    "label": "Impressão clínica"
   },
   {
    "id": "hipoteses_diagnosticas",
    "label": "Hipóteses diagnósticas"
   }
  ]
 },
 {
  "id": "conduta",
  "title": "Conduta",
  "fields": [
   {
    "id": "exames_solicitados",
    "label": "Exames solicitados"
   },
   {
    "id": "medicacao_manipulados",
    "label": "Medicação e manipulados prescritos"
   },
   {
    "id": "suplementacao",
    "label": "Suplementação"
   },
   {
    "id": "orientacoes",
    "label": "Orientações dadas"
   },
   {
    "id": "encaminhamentos",
    "label": "Encaminhamentos (nutricionista, personal, outros)"
   },
   {
    "id": "plano_acompanhamento",
    "label": "Plano de acompanhamento"
   }
  ]
 },
 {
  "id": "combinados",
  "title": "Combinados com o paciente",
  "fields": [
   {
    "id": "combinados",
    "label": "Quem faz, o quê e até quando"
   }
  ]
 },
 {
  "id": "retorno",
  "title": "Próximo retorno",
  "fields": [
   {
    "id": "prazo_retorno",
    "label": "Data ou prazo"
   },
   {
    "id": "o_que_trazer",
    "label": "O que trazer"
   }
  ]
 },
 {
  "id": "profissional",
  "title": "Profissional",
  "system": true,
  "fields": [
   {
    "id": "nome",
    "label": "Nome"
   },
   {
    "id": "conselho_numero",
    "label": "Conselho e número"
   },
   {
    "id": "data_hora",
    "label": "Data e hora do atendimento"
   }
  ]
 }
]$json$::jsonb
where not exists (select 1 from public.clinical_templates where clinic_id is null and is_default);

insert into public.schema_migration_log (version, filename, description, session)
values ('20261113130000', '20261113130000_clinical_template_v2.sql',
        'Consulta assistida: modelo de prontuário padrão v2 (16 seções) e people com registro do profissional (aditiva).', 'CONSULTA-ASSISTIDA-1');
