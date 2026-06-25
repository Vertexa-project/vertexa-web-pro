# Design Tokens — VERTEXA Web Profissional

Light-first (oposto ao app paciente que é dark-first), mas MESMA primária laranja e MESMOS
status, para que web e mobile sejam claramente o mesmo produto. Modo escuro = tokens do app.

## Light (padrão) — Sessão 5: neutros com TINTA QUENTE (não cinza 0% de template)
- background 40 33% 97% (canvas off-white quente) · foreground 24 14% 13% (quase-preto quente)
- card 0 0% 100% (branco — separa do canvas = profundidade sóbria) · muted 38 24% 95%
- border 32 16% 89% · input 32 16% 85% · muted-foreground 28 7% 42% (passa AA sobre branco/canvas)
- accent 30 44% 93% (hover com leve tinta laranja) · accent-foreground 22 60% 30%
- primary 24 95% 53% (LARANJA — só ACENTO, inalterado) · primary-foreground 0 0% 100% · ring 24 95% 53%
- success 142 71% 45% · warning 45 93% 47% · destructive 0 72% 51% · info 207 90% 54% (status = app, NÃO alterar)
- sidebar branca ancorada sobre o canvas · item ativo = primary (spine) · radius 0.875rem

## Tipografia (Sessão 5)
- **Display = Plus Jakarta Sans** (`font-display`): títulos de página/seção (CardTitle, PageHeader, ProfileHeader),
  números de métrica (StatCard, VRI) e wordmark. **Corpo/UI = Inter** (`font-sans`). Ambas já carregadas (Google Fonts).
- Métricas usam `.tnum` (tabular-nums) para alinhar.

## Elevação (Sessão 5) — sombra QUENTE, sutil (matiz da marca, não preto puro)
- `--shadow-card` (cards) · `--shadow-elevated` (hover/popover) · `--shadow-sm` (uso CSS direto).
- ⚠️ NÃO sobrescrever o utilitário `shadow-sm` do Tailwind (shadcn usa em TabsTrigger ativo etc.).

## Assinatura de marca (Sessão 5)
- **Mark do "pico/vertex"** (`src/components/Brand.tsx` → `BrandMark`/`Brand`): tile laranja + ápice branco (vértice).
  Variante `onDark` (tile translúcido) para fundos escuros (login). Mesmo símbolo no `public/favicon.svg`.
- **Spine** laranja (barra fina) = elemento estrutural recorrente: barra do item de menu ativo + tick no título de página.

## Dark (modo escuro — reutiliza o app paciente)
- background 0 0% 7% · card 0 0% 11% · foreground 0 0% 96% · border 0 0% 18%
- primary 24 95% 53% · success/warning/destructive iguais · info 207 90% 54%

## Uso
- Laranja = ACENTO no light (botão primário, item de menu ativo, badge, ícone de destaque).
  Nunca fundo de tela inteiro.
- Tipografia: Inter ou Plus Jakarta Sans.
- Sombra light: 0 4px 24px -4px hsla(0,0%,0%,0.08).
- Status sempre nas mesmas cores entre web e app (coerência de produto).
