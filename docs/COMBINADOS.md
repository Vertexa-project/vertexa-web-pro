# Combinados informais das calls — fonte de verdade do escopo

> Extraído das 3 transcrições (20/03 kickoff, 11/04 protótipo paciente, 01/05 versão web).
> Use isto para não inventar features fora do que o cliente pediu.

## Produto e posicionamento
- VERTEXA = SaaS B2B2C de **retenção clínica multiprofissional**. Cliente que paga = clínica/
  profissional. Paciente usa de graça (oferecido pela clínica como diferencial premium).
- Dor central: médico, nutri e personal trabalham fragmentados; paciente se perde; profissional
  não tem gestão de recorrência/retorno/adesão. VERTEXA unifica e reduz abandono.
- Deve atender: clínica com equipe, médico sozinho, nutri sozinho, personal sozinho, e
  **profissional externo convidado** (só vê o paciente vinculado).

## Web Profissional
- Benchmark funcional = Nutrio. **Identidade própria**, não cópia.
- Visual desktop = clean/elegante: branco+preto, laranja só em detalhe/ícone/item selecionado/logo.
- Dashboard com visão gerencial do atendimento (não financeiro do negócio na mesma tela).
- Prontuário/timeline clínica é peça central (pesquisa de mercado da Dizevolv apontou isso).
- Antropometria FLEXÍVEL: método de avaliação corporal selecionável (bioimpedância, adipômetro,
  dobras, circunferências, DEXA, manual). Nem todo profissional usa todos — não forçar padrão.
- DEXA e bioimpedância podem ser anexados como PDF/documento.
- Campanhas/automações: boas-vindas, pós-consulta imediata, check-in 15d, retorno 30d, lembrete
  de exame, lembrete de bioimpedância/foto, reativação de inativos, aniversário, NPS. Permitir
  jornada individual por paciente E campanha em massa. Modelo de "créditos" por automação extra.
- Central de mensagens: concentra interações; remetente aparece como clínica/profissional (NUNCA
  "Vertexa"); IA pode responder no futuro, mas sempre com opção de falar com humano.
- Hierarquia: admin da clínica vê tudo; cada profissional vê só seus pacientes; admin libera
  acessos por e-mail; pacotes por nº de profissionais.
- Integração Google Agenda prevista (futuro).
- Dashboard financeiro: receita, projeção (LTV), impacto de abandono. "Conflito moral" de mostrar
  paciente com lente financeira foi levantado — validar.

## App Paciente (JÁ existe — preservar)
- Visual "dopaminérgico": preto + laranja forte. Já validado em 2 calls.
- VRI (índice de adesão) no topo da home. JÁ implementado em adherenceEngine.ts.
- Recuperação muscular por mapa corporal. JÁ implementado em Progress.tsx.
- Cores recuperação (combinado): 1-2 dias=fadigado(vermelho), 3=recuperação(amarelo),
  4=recuperado(azul), 5+=enfraquecido(verde). **App atual usa neutral/activated — divergência.**
- Foto de treino: idealmente tirada DENTRO do app (sem puxar da galeria) para reduzir fraude e
  educar uso. Para desafios, foto = comprovação.
- Compartilhamento social: card de evolução/meta/treino com destaque para CLÍNICA/PROFISSIONAL
  pagante, VERTEXA discreto. No ecossistema multiprofissional, definir quem aparece (evitar briga).
- Esportes além de musculação: somar atividade (modalidade, tempo, caloria estimada). NÃO criar
  aba por esporte. Sem métricas específicas (ex.: pace de corrida) — fora de escopo.
- Mobilidade/alongamento: entra como sugestão, não obrigação.
- "Bater ponto" do treino + treino do dia bloqueado (não pode pular para outro dia).
- SOS: viagem, dificuldade dieta/treino, falta de motivação, dúvida, dor. Respondido por IA (com
  opção de humano).

## Integração entre os dois
- Profissional cria (plano, treino, metas, avaliações) → paciente executa/registra → backend
  calcula (VRI, recuperação, adesão) → profissional acompanha (timeline, dashboards, alertas).
- WhatsApp = canal de LEMBRETE/informativo, não substitui o app. App é o ambiente de execução.

## Banco de dados
- Cliente (Juliana) pediu arquitetura que não perca dados se paciente trocar de médico
  (continuidade/portabilidade). Pensar "grande" desde o início.

## Prazos
- Primeira versão: 60 dias (kickoff 20/03). Esta sprint: entrega navegável até 22/06.
