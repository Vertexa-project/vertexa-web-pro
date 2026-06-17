# Design Tokens — VERTEXA Web Profissional

Light-first (oposto ao app paciente que é dark-first), mas MESMA primária laranja e MESMOS
status, para que web e mobile sejam claramente o mesmo produto. Modo escuro = tokens do app.

## Light (padrão)
- background 0 0% 100% · foreground 0 0% 12% · card 0 0% 100% · muted 0 0% 96%
- border/input 0 0% 90% · muted-foreground 0 0% 45%
- primary 24 95% 53% (LARANJA) · primary-foreground 0 0% 100% · ring 24 95% 53%
- success 142 71% 45% (verde) · warning 45 93% 47% (amarelo)
- destructive 0 72% 51% (vermelho) · info 207 90% 54% (azul)
- sidebar branca, item ativo = primary · radius 0.875rem

## Dark (modo escuro — reutiliza o app paciente)
- background 0 0% 7% · card 0 0% 11% · foreground 0 0% 96% · border 0 0% 18%
- primary 24 95% 53% · success/warning/destructive iguais · info 207 90% 54%

## Uso
- Laranja = ACENTO no light (botão primário, item de menu ativo, badge, ícone de destaque).
  Nunca fundo de tela inteiro.
- Tipografia: Inter ou Plus Jakarta Sans.
- Sombra light: 0 4px 24px -4px hsla(0,0%,0%,0.08).
- Status sempre nas mesmas cores entre web e app (coerência de produto).
