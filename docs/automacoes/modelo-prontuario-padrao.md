# Modelo de prontuário padrão do Vertexa (v1 · 13/11/2026)

Modelo que a consulta assistida preenche sozinha até a Dra. Juliana mandar o dela. Pedido do Djeimyson (13/11): "Faça um modelo
de prontuário padrão enquanto a juliana não envia. Quero apresentar isso pra ela sem solicitar nada antes de apresentar".

Base: itens obrigatórios do prontuário (CFM, Res. 1.638/2002: identificação, anamnese, exame físico, exames complementares,
hipóteses diagnósticas, tratamento/conduta, evolução, identificação do profissional com registro, data e hora) + o roteiro
que a Dra. Juliana seguiu na consulta de 28/10 (medicina do esporte, cardiometabólica, emagrecimento e composição corporal).

Regras para a IA: preencher só com o que foi dito na conversa; campo sem informação fica vazio (nunca supor); números com
unidade; cada item guarda o trecho de origem; linguagem clínica objetiva, em terceira pessoa.

| # | Seção (chave) | Campos | Observação para a IA |
|---|---|---|---|
| 1 | Identificação e contexto (`identificacao`) | idade, profissão/rotina de trabalho, estado civil, tipo de atendimento (presencial/online), primeira consulta ou retorno | Nome e dados de cadastro vêm da ficha, não da conversa |
| 2 | Motivo da consulta e objetivo (`objetivo`) | queixa principal (frase do paciente), objetivo principal (emagrecimento, ganho de massa, check-up, metabólico, hormonal, avaliação pré-participação, outro), objetivos secundários | Guardar a frase do paciente entre aspas |
| 3 | História do objetivo atual (`historia`) | evolução do peso e do corpo, tentativas anteriores (dietas, profissionais, medicações), padrão alimentar e comportamento (ex.: restrição seguida de compulsão, fome emocional), fatores desencadeantes | Cronologia em ordem |
| 4 | Antecedentes pessoais (`antecedentes_pessoais`) | doenças (atuais e prévias), cirurgias, internações, alergias | "Nega" quando o paciente negar explicitamente |
| 5 | Medicações em uso (`medicacoes`) | lista: nome, dose, frequência, desde quando | Separar uso atual de uso anterior |
| 6 | Suplementos, manipulados e hormônios (`suplementos`) | lista atual e anterior, incluindo ergogênicos/hormônios citados | Registrar também os que o paciente disse que não usou |
| 7 | Antecedentes familiares (`antecedentes_familiares`) | lista: doença (HAS, DM, IAM, AVC, câncer, dislipidemia, outras), parentesco, idade de início, desfecho | |
| 8 | Hábitos de vida (`habitos`) | atividade física (tipo, frequência, intensidade), sono (horas, qualidade), hidratação (litros/dia), intestino, alimentação (refeições, horários), intolerâncias, álcool, tabagismo, estresse e saúde mental, rotina de trabalho | |
| 9 | Revisão de sistemas (`revisao_sistemas`) | gastrointestinal, cardiovascular, respiratório, osteoarticular/mobilidade, outros sintomas relevantes | Só o que foi perguntado/dito |
| 10 | Exame físico e medidas (`exame_fisico`) | peso, altura, IMC (calculado), circunferência abdominal, PA, FC, composição corporal (bioimpedância/DEXA: % gordura, massa magra) | Não calcular o que não foi medido |
| 11 | Exames trazidos (`exames_trazidos`) | lista: exame, data, resultado relevante | |
| 12 | Avaliação e hipóteses (`avaliacao`) | impressão clínica, hipóteses diagnósticas (CID opcional) | Só o que o profissional disse |
| 13 | Conduta (`conduta`) | exames solicitados (marcar os da 1ª etapa), medicação/manipulados prescritos, suplementação, orientações dadas, encaminhamentos (nutricionista, personal, outros), plano de acompanhamento | |
| 14 | Combinados com o paciente (`combinados`) | lista: quem faz (paciente ou equipe), o quê, até quando | Vai ao app do paciente depois da revisão |
| 15 | Próximo retorno (`retorno`) | data ou prazo, o que trazer (exames, fotos, peso) | |
| 16 | Profissional (`profissional`) | nome, conselho e número, data e hora do atendimento | Preenchido pelo sistema, não pela IA |

O modelo fica salvo por clínica (`clinical_templates`) e pode ser trocado pelo da Dra. Juliana sem mudar o sistema.
