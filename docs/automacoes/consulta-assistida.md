# Consulta assistida (A7) — parte 1

Atendimento clínico com gravação em pedaços, transcrição e prontuário estruturado, com revisão do profissional.

## Fluxo
Ficha do paciente > aba Prontuário > Iniciar atendimento > `/pacientes/:id/atendimento/:encounterId`.
Aceite do paciente (texto versionado `v1-2026-11`, a aprovar pelo jurídico) > gravar (pedaço a cada ~2 min, bucket privado
`clinical-audio`) > trechos ao vivo > prontuário preenchido > editar (campo editado fica travado para a IA) > Encerrar > Finalizar
(imutável; correção só por adendo) > PDF > Enviar combinados (notificação `professional` no app da paciente).

## Banco (aditivo, nos dois ledgers)
Migrations: `20261113120000_clinical_encounters`, `20261113123000_clinical_versions_rpc`, `20261113130000_clinical_template_v2`
(todas aplicadas em produção). Tabelas `clinical_*` (encontros, trechos, registro, versões, adendos, envios, modelos).
Só equipe clínica com acesso ao paciente lê/escreve (RLS + RPC); paciente, financeiro e recepção não leem.

## Edge Functions (verify_jwt=true, v2)
`clinical-transcribe`, `clinical-structure`, `clinical-audio-purge`. Áudio apagado 30 dias após finalizar (ou "Apagar o áudio agora").

## Modo demonstração e chave de IA
Sem o secret `OPENAI_API_KEY` as funções usam roteiro fictício (faixa "Demonstração" na tela, aviso no PDF e "[Demonstração]" no combinado).
Para ligar: definir `OPENAI_API_KEY` (chave da Dra. Juliana) nos secrets das Edge Functions. Modelo de seções: `clinical_templates`
(padrão em `modelo-prontuario-padrao.md`); trocar sem código.
Custo estimado (a confirmar com a chave real): transcrição ~US$ 0,006/min (~US$ 0,55 em 90 min) + estruturação poucos centavos.

## Verificação
Passada Playwright com áudio falso (1280/1024/390 px, sem rolagem lateral) e prints em `runs/20261113/98a678ceb5941e7b9b98/prints/`.
