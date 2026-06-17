---
name: clinical-ui-states
description: Use ao construir qualquer tela com dados de paciente. Padroniza badges de status, cores e estados de UI no VERTEXA web.
---
# Estados e cores clínicas (VERTEXA web)

Status do paciente (VRI) -> badge:
- alta (>=80): verde
- moderada (50-79): amarelo
- baixa (20-49): laranja
- risco (<20): vermelho
- inativo (15+ dias sem interação): cinza

Recuperação muscular -> cor do músculo no mapa:
- fatigued: vermelho | recovering: amarelo | recovered: azul | weakened: verde | neutral: cinza
(PENDÊNCIA: confirmar mapeamento com cliente — ver docs/PENDENCIAS.md item 1)

Toda lista/tela DEVE ter: loading (skeleton), vazio (mensagem + ação), erro (retry).
Laranja é acento, não cor de fundo. Base é branca/cinza-claro.
