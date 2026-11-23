-- Cartão 1317 · Conteúdo inicial da Central de Ajuda (gerado de docs/ajuda/tutoriais.json).
-- Escrito a partir do sistema; a Vertexa edita na Plataforma. Não sobrescreve o que já existe.

insert into public.help_categories (id, title, description, position) values ('primeiros-passos', 'Primeiros passos', 'Entrar, conhecer o menu, convidar a equipe e cadastrar as unidades da clínica.', 1) on conflict (id) do nothing;
insert into public.help_categories (id, title, description, position) values ('pacientes', 'Pacientes', 'Cadastrar, importar, exportar e acompanhar a ficha de cada paciente.', 2) on conflict (id) do nothing;
insert into public.help_categories (id, title, description, position) values ('agenda', 'Agenda', 'Marcar compromissos e ver a agenda da clínica junto com o Google Agenda.', 3) on conflict (id) do nothing;
insert into public.help_categories (id, title, description, position) values ('jornada-relacionamento', 'Jornada e relacionamento', 'Acompanhar cada paciente por etapa, conversar e enviar campanhas.', 4) on conflict (id) do nothing;
insert into public.help_categories (id, title, description, position) values ('planos', 'Dietas, treinos e biblioteca', 'Montar plano alimentar e treino, entregar ao paciente e consultar a biblioteca de exercícios.', 5) on conflict (id) do nothing;
insert into public.help_categories (id, title, description, position) values ('gestao', 'Gestão', 'Financeiro, estoque e documentos clínicos da clínica.', 6) on conflict (id) do nothing;
insert into public.help_categories (id, title, description, position) values ('configuracoes', 'Configurações e automações', 'Pré-consulta, rotina do paciente e outros ajustes da clínica.', 7) on conflict (id) do nothing;
insert into public.help_categories (id, title, description, position) values ('app-paciente', 'App do paciente', 'Como o paciente recebe o acesso e o que ele vê e faz no app.', 8) on conflict (id) do nothing;

insert into public.help_articles (slug, category_id, title, summary, body, position) values ('entrar-no-vertexa', 'primeiros-passos', 'Entrar no Vertexa e fazer o primeiro acesso', 'Como entrar com Google ou e-mail e o que fazer no primeiro acesso, com ou sem código da clínica.', '## Entrar

1. Na página de acesso, clique em “Entrar com Google”, ou digite seu e-mail e sua senha e clique em “Entrar”.
2. Se esqueceu a senha, clique em “Esqueceu a senha?” e siga as instruções que aparecem na tela.

O ícone de olho no campo de senha mostra ou esconde o que você digitou.

## Primeiro acesso

Se você ainda não faz parte de nenhuma clínica, aparece a tela “Vamos configurar seu acesso” com duas opções:

- “Sou responsável por uma clínica”: clique em “Cadastrar minha clínica” e informe o nome da clínica. O pedido vai para análise da equipe Vertexa. Quando for aprovado, você conclui o cadastro e passa a ser o administrador da clínica.
- “Fui convidado para uma clínica”: clique em “Entrar com código”, digite o código que a clínica te passou e clique em “Entrar na clínica”.

## Depois de pedir para entrar

Quem usou o código vê “Solicitação enviada”. Ela fica aguardando o administrador da clínica. Assim que ele aprovar, seu acesso é liberado nessa mesma tela, sem precisar fazer nada de novo.

Se o pedido não for aprovado, você pode tentar outra vez com outro código.

## Sair

Clique na sua foto ou nome, no canto superior direito, e escolha “Sair”.', 1) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('conhecer-menu-e-tela-hoje', 'primeiros-passos', 'Conhecer o menu, a tela Hoje e trocar o tema', 'Um passeio pelo menu lateral, pela tela Hoje e pelas opções de tema claro ou escuro.', '## O menu

O menu lateral tem: “Hoje”, “Pacientes”, “Agenda”, “Jornada”, “Relacionamento”, “Gestão”, “Biblioteca” e, no fim, “Configurações”. O item “Gestão” só aparece para quem tem acesso a alguma de suas áreas, e cada pessoa vê apenas o que o seu papel permite.

No topo da tela ficam o sino de avisos (por exemplo, quando alguém marca você em uma conversa), o botão “Alternar tema” e o menu da sua conta, com “Configurações”, “Assinatura” e “Sair”.

## A tela Hoje

A tela “Hoje” abre com uma saudação e mostra, para quem acompanha pacientes:

- números rápidos: “Pacientes ativos”, “Em risco”, “Em atenção”, “Adesão média” e “Com pendências”;
- “Foco do dia”: os pacientes que mais precisam de você e a próxima ação sugerida;
- “Agenda de hoje”, com os botões “Novo compromisso” e “Ver semana”.

Quem tem papel de Recepção, Financeiro ou Estoquista não vê dados clínicos: a tela Hoje mostra só a agenda.

## Trocar o tema

1. Abra “Configurações”.
2. No cartão “Aparência”, escolha “Claro”, “Escuro” ou “Sistema”.

A mudança vale na hora. “Sistema” acompanha o tema do seu computador. Você também pode alternar rapidinho pelo botão “Alternar tema” no topo.

## Vertexa IA

O botão “Vertexa IA” no topo está em modo demonstração: serve para conhecer a ideia, não para uso real no dia a dia.', 2) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('convidar-equipe-e-papeis', 'primeiros-passos', 'Convidar a equipe, aprovar pedidos e definir papéis', 'O administrador compartilha o código da clínica, aprova quem pediu para entrar e define o que cada pessoa pode fazer.', 'Só o administrador da clínica gerencia a equipe.

## Convidar

1. Abra “Configurações”.
2. Na linha “Código de acesso da equipe”, use “Copiar o código” ou “Copiar convite” e envie para a pessoa.
3. A pessoa entra no Vertexa, escolhe “Fui convidado para uma clínica” e digita o código.

Se o código vazar, clique em “Gerar novo código”. O código antigo deixa de funcionar na hora; pedidos já enviados continuam valendo.

## Aprovar o pedido

1. Em “Configurações”, na linha “Equipe”, clique em “Gerenciar” (se houver pedidos, aparece também “Revisar pedidos”).
2. Em “Pedidos pendentes”, clique em “Aprovar” ou “Rejeitar”.

Depois de aprovar, o próprio sistema sugere o próximo passo: “Atribuir disciplinas”. Sem disciplina, a pessoa entra no painel mas não registra nada clínico.

## Disciplinas e papéis

- Disciplinas: em “Configurações”, “Disciplinas da equipe” › “Gerenciar”. A disciplina define o que a pessoa pode escrever: plano alimentar exige Nutricionista, treino exige Educador Físico ou Fisioterapeuta e medicamentos exigem Médico.
- Papéis: na lista “Equipe atual”, a coluna “Papéis” permite acrescentar Gestor, Financeiro, Recepção ou Estoquista, por unidade ou em “Todas as unidades”.

## Desativar e reativar

Em “Equipe atual”, “Desativar” tira o acesso da pessoa imediatamente; o histórico é preservado. “Reativar” devolve o acesso. Ambos ficam registrados.

## Transferir pacientes

Em “Gestão” › “Visão geral”, clique em “Transferir pacientes” para passar os pacientes de um profissional para outro.', 3) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('cadastrar-unidades', 'primeiros-passos', 'Cadastrar e editar as unidades da clínica', 'O administrador cadastra os locais de atendimento e a licença sanitária de cada um.', 'Unidades são os locais de atendimento da clínica. A unidade principal é criada junto com a clínica. Só o administrador cria, edita e desativa unidades.

## Cadastrar uma unidade

1. Abra “Configurações”.
2. Na linha “Unidades”, clique em “Gerenciar”.
3. Clique em “Nova unidade”.
4. Preencha “Nome da unidade”. Se tiver, informe também a “Licença sanitária (número)” e a “Validade da licença”.
5. Salve.

A lista mostra o nome, se a unidade é a principal, a situação da licença (sem licença, válida, vence em breve ou vencida) e a validade.

## Editar ou desativar

Na lista, clique em “Editar” na linha da unidade. Você pode mudar o nome e os dados da licença. Para desativar, desmarque “Unidade ativa” e informe o motivo.

A unidade principal pode ser renomeada, mas não pode ser desativada. Não é possível ter duas unidades com o mesmo nome.

## Para que serve a licença

A licença sanitária é consultada na venda de manipulado: sem licença válida, o sistema avisa e pede o aceite do administrador antes de liberar a venda.

As unidades também aparecem nos papéis da equipe (por exemplo, um Estoquista de uma unidade só) e no Financeiro e no Estoque.', 4) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('cadastrar-paciente', 'pacientes', 'Cadastrar um paciente', 'Passo a passo para criar um paciente novo com os dados que você já tem.', 'O cadastro manual é feito pelo administrador da clínica.

## Passo a passo

1. Abra “Pacientes”.
2. Clique em “Cadastrar novo paciente”.
3. Em “Identificação”, preencha “Nome completo” (obrigatório). Se quiser, informe “E-mail”, “Data de nascimento”, “Sexo” e “Altura (cm)”.
4. Em “Objetivo e metas”, preencha “Objetivo”, “Peso inicial (kg)” e “Meta de peso (kg)”.
5. Se já tiver a avaliação da pré-consulta, preencha “Anamnese / pré-consulta”: “Método”, “Peso aferido (kg)”, “% Gordura” e “Observações da anamnese”. Esse bloco é opcional e, se preenchido, vira a primeira avaliação corporal do paciente.
6. Clique em “Cadastrar paciente”.

O paciente aparece na lista e você pode abrir a ficha dele. Tudo pode ser editado depois.

## O e-mail é importante

O e-mail do cadastro é o que liga o paciente ao app. O paciente entra no app com o mesmo e-mail do Google, e o sistema localiza o cadastro por ele. Sem e-mail, o acesso ao app não é ativado.

## Limite de pacientes

Se aparecer “A clínica atingiu o limite de pacientes ativos.”, o cadastro não é feito. Fale com o administrador sobre a assinatura em “Configurações” › “Assinatura e faturamento”.

## Editar depois

Na ficha do paciente, o administrador clica em “Editar cadastro”. O histórico clínico não é alterado por essa edição.', 1) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('importar-e-exportar-pacientes', 'pacientes', 'Importar pacientes de uma planilha e exportar a base', 'Traga pacientes de outro sistema por planilha e gere arquivos da sua base, com registro de quem exportou.', '## Importar (administrador da clínica)

1. Em “Pacientes”, clique em “Importar pacientes”.
2. Passo 1: clique em “Escolher arquivo” e selecione um CSV ou XLSX (até 500 linhas). Se precisar, use “Baixar modelo de planilha”.
3. Passo 2: confira se cada coluna da planilha está ligada ao campo certo (Nome completo, E-mail, Telefone / WhatsApp, Data de nascimento, Sexo, Objetivo, Peso (kg), Altura (cm)). Colunas que você não quer usar ficam em “Sem campo (ignorar)”. O nome é obrigatório. Clique em “Conferir prévia”.
4. Passo 3: veja a prévia. Cada linha aparece como “Pronto”, “Com erro” ou “Possível duplicado”. Linhas com erro não entram. Duplicados só entram se você marcar “Importar mesmo assim”.
5. Confirme a importação.

Nenhum paciente é juntado a outro, e o sistema não envia convite nem e-mail: o convite do app continua sendo uma ação sua, paciente a paciente.

## Exportar a base (administrador ou Gestor)

1. Clique em “Exportar base”.
2. Em “Quais dados”, marque os grupos: Cadastro, Contato, Medidas e peso, Adesão.
3. Escolha o “Motivo da exportação” e explique em poucas palavras.
4. Clique em “Exportar”.

Sai um arquivo CSV com dados pessoais: guarde em local seguro. A exportação fica registrada (quem, quando, motivo e quantidade), e o administrador vê esse histórico em “Configurações”, em “Exportações da base de pacientes”. O prontuário não entra na base.

## Relatórios em PDF

“Exportar em lote” gera os relatórios de vários pacientes de uma vez. Dentro da ficha de cada paciente, o botão “Relatório completo (PDF)” gera o relatório individual.', 2) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('ficha-do-paciente', 'pacientes', 'Usar a ficha do paciente e conhecer as abas', 'O que há em cada aba da ficha e quais botões ficam no alto dela.', 'Em “Pacientes”, clique em “Ver paciente” na linha do paciente para abrir a ficha. Use a busca, o filtro de “Status” ou de “Profissional” e a aba “Pendentes” (pacientes em atenção ou em risco) para achar quem você procura.

## Botões do alto da ficha

- “Editar cadastro” (administrador): altera os dados e permite “Excluir cadastro”, com confirmação.
- “Iniciar atendimento”: abre a tela de atendimento. A transcrição ainda funciona em modo demonstração.
- “Novo documento”, “Nova venda” e “Relatório completo (PDF)”, conforme o seu papel.

## As abas

- “Resumo”: objetivo, peso, sequência e adesão da semana; “Pré-consulta”; “Exames e retornos” (lembretes que o paciente também recebe no app); “Recado da semana”; sinais recentes; planos ativos; e a equipe do paciente.
- “Timeline”: tudo o que aconteceu com o paciente, em ordem.
- “Prontuário”: atendimentos e registros clínicos.
- “Planos”: “Plano alimentar”, “Suplementos” e “Treino”.
- “Evolução”: “Antropometria”, “Evolução/Fotos” e “Recuperação”.
- “Documentos”: exames e documentos enviados, e documentos clínicos emitidos.

## Equipe do paciente

No “Resumo”, a equipe mostra quem acompanha o paciente. O administrador usa “Adicionar profissional” para incluir alguém e “Desativar vínculo” para retirar; a pessoa perde na hora o acesso aos dados e à conversa daquele paciente.

## Quem escreve o quê

Para criar ou editar plano alimentar, treino e suplementos, a pessoa precisa ter a disciplina certa. Quando não tem, o botão fica desabilitado e explica o motivo.', 3) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('usar-a-agenda', 'agenda', 'Marcar compromissos e conectar o Google Agenda', 'Crie, mova e edite compromissos e veja seus eventos do Google ao lado da agenda da clínica.', '## Criar um compromisso

1. Abra “Agenda” e clique em “Novo compromisso”. Você também pode clicar em um horário livre do calendário.
2. Preencha o título, a “Data”, o “Início” e o “Término”. O horário vai das 06:00 às 23:00.
3. Escolha o “Paciente” (ou “Sem paciente”) e o “Profissional”.
4. Em “Tipo”, escolha Consulta, Retorno, Previsão de retorno ou Outros. Em “Status”, escolha Confirmado, Pendente ou Desmarcado.
5. Se quiser, escreva “Observações” e clique em “Criar compromisso”.

## Mudar e remarcar

Clique no compromisso para editar (“Salvar alterações”) ou “Excluir”. Também dá para arrastar o compromisso para outro horário para remarcar.

## Ver a agenda

Use os botões “Hoje”, “Dia”, “Semana”, “Mês” e “Lista”. Abaixo do calendário, as legendas “Tipos de evento” e “Status do agendamento” explicam as cores. A tela “Hoje” mostra a “Agenda de hoje”.

## Google Agenda

Você pode ver seus eventos do Google ao lado dos compromissos da clínica. Eles aparecem em modo somente leitura: não dá para editá-los pelo Vertexa.

1. Abra “Configurações” e vá ao cartão “Integrações”.
2. Clique em “Conectar Google Agenda” e autorize o acesso.
3. Depois, use “Atualizar agenda” quando quiser trazer eventos novos, ou “Desconectar” para parar. Ao desconectar, os eventos sincronizados saem do painel.

Se o Google não puder ser carregado, o painel mostra só a agenda interna da clínica.', 1) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('acompanhar-a-jornada', 'jornada-relacionamento', 'Acompanhar os pacientes no quadro da Jornada', 'Mova os pacientes entre as etapas e configure as colunas do quadro.', '## Usar o quadro

1. Abra “Jornada”. Cada coluna é uma etapa do acompanhamento e cada paciente é um cartão.
2. Arraste o cartão para a coluna seguinte. Se preferir, use o menu “Mover para” no cartão.
3. Os marcos do paciente (início, aniversário, 30, 60 e 90 dias) aparecem no cartão. Clique em “Reconhecer” para registrar que você viu o marco.

Se o cartão voltar para a coluna anterior, você não tem permissão para mover aquele paciente (por exemplo, acesso externo ou vínculo removido) ou houve uma falha: tente de novo.

## Configurar as colunas (administrador)

1. Abra “Configurações” e, na linha “Colunas da jornada”, clique em “Gerenciar”.
2. Clique em “Nova coluna”, dê um nome e escolha uma cor.
3. Use as setas para reordenar. “Tornar inicial” define a coluna onde entram os pacientes novos. Existe sempre uma única coluna inicial.

## Remover coluna

Só é possível remover uma coluna que não seja a inicial, não tenha pacientes e nunca tenha tido movimentações. Se não puder remover, renomeie a coluna.

## Quadro vazio

Se não houver colunas, o administrador vê “Configurar colunas” para criar a primeira. Os demais veem um aviso de que o administrador ainda não configurou a jornada.', 1) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('conversar-com-pacientes', 'jornada-relacionamento', 'Conversar com os pacientes em Mensagens', 'Como responder, anexar arquivos e marcar colegas na central de conversas.', '## Abrir uma conversa

1. Abra “Relacionamento”. A aba “Mensagens” é a central de conversas.
2. Na lista da esquerda, clique no paciente. Conversas com uma marcação sua ainda não lida mostram um aviso.
3. Escreva no campo “Escreva uma mensagem…” e clique em “Enviar”.

O paciente recebe e responde pelo app, na área “Equipe”. Você responde no lugar da clínica ou do profissional, sempre com uma pessoa no controle.

## Anexar um arquivo

Clique em “Anexar arquivo” e escolha um PDF ou uma imagem. Para tirar o anexo antes de enviar, use “Remover anexo”.

## Marcar um colega

Clique em “Marcar um profissional” e escolha quem deve ver a mensagem. A pessoa marcada recebe um aviso no sino, e a mensagem fica com o destaque “Você foi marcado nesta mensagem”.

## Responder uma mensagem específica

Em uma mensagem do paciente, clique em “Responder”. Para desistir, clique em “Cancelar resposta”.

## Quando a conversa não abre

Se aparecer a mensagem “Não foi possível abrir a conversa”, confira se você continua vinculado ao paciente. Quando o vínculo é removido, o acesso à conversa também deixa de existir.

Se a lista estiver vazia, aparece “Nenhuma conversa”: as conversas surgem conforme os pacientes que você acompanha.', 2) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('campanhas-e-disparos', 'jornada-relacionamento', 'Ligar automações e enviar disparos aos pacientes', 'Automações prontas e mensagens avulsas que chegam na caixa de notificações do app do paciente.', 'Em “Relacionamento”, abra a aba “Campanhas”. As mensagens chegam na caixa de notificações do app do paciente, em nome da clínica.

## Automações

As automações começam desligadas. Elas são: “Boas-vindas”, “Check-in periódico”, “Lembrete de retorno”, “Reativação de inativos” e “Aniversário”. Cada paciente recebe a mesma mensagem uma vez por período.

1. Na lista “Automações”, veja quando cada uma dispara.
2. Clique em “Ligar” para ativar (ou “Desligar”).
3. Para mudar texto ou prazo, use o botão de editar da linha. Dá para usar {nome} no texto: o sistema troca pelo primeiro nome do paciente.

Só o administrador da clínica liga, desliga e edita as automações.

## Reengajamento de paciente sumido

Uma sequência de 3 mensagens para quem some. Começa desligada. Você pode ligar, ajustar os dias sem interação e os textos, e ver quem está na sequência e o histórico de envios.

## Novo disparo

1. Clique em “Novo disparo”.
2. Em “Para quem”, escolha: “Meus pacientes” ou “Meus pacientes inativos”. O administrador também vê “Todos os pacientes da clínica” e “Todos os pacientes inativos da clínica”.
3. Nas opções de inativos, informe os “Dias sem registrar”. O sistema mostra quantos pacientes vão receber.
4. Escreva o “Título” e a “Mensagem”.
5. Clique em “Revisar e enviar” e depois em “Enviar agora”.

O que foi enviado fica no “Histórico de disparos”. Os números no topo mostram as automações ligadas, as enviadas em 30 dias e os disparos manuais.', 3) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('criar-plano-alimentar', 'planos', 'Criar o plano alimentar e enviar ao paciente', 'Monte as refeições na ficha do paciente e entregue o plano também em PDF no app.', 'Criar e editar plano alimentar exige a disciplina Nutricionista.

## Criar o plano

1. Abra a ficha do paciente e vá em “Planos” › “Plano alimentar”.
2. Clique em “Criar plano”.
3. Dê um “Título” ao plano.
4. Para cada refeição, informe o “Horário”, o nome (por exemplo, Café da manhã), as “Calorias” e os itens, um por linha.
5. Se quiser oferecer alternativas, clique em “Adicionar opção de troca”. Para mais refeições, clique em “Adicionar refeição”.
6. Clique em “Salvar plano”.

O paciente verá o plano no app, na aba “Plano”. A ficha mostra o total de calorias por dia. Para mudar depois, clique em “Editar”.

## Enviar o plano em PDF

1. Clique em “Enviar ao paciente”.
2. Confira a prévia do PDF, que leva a marca da clínica.
3. Clique em “Enviar ao app do paciente”. Se preferir só guardar uma cópia, use “Baixar PDF”.

O paciente recebe um aviso e baixa o arquivo em “Meus documentos”. O envio fica registrado na aba “Documentos” da ficha. WhatsApp e e-mail ficam para uma próxima versão.

## Suplementos e medicamentos

Em “Planos” › “Suplementos”, o profissional cadastra a lista que o paciente vê no app, com lembrete no horário definido. Quem marca como tomado é o paciente. Suplementos exigem a disciplina Nutricionista; medicamentos só podem ser prescritos por Médico.', 1) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('criar-e-publicar-treino', 'planos', 'Montar o treino, publicar e enviar ao paciente', 'Crie o treino como rascunho, publique quando estiver pronto e envie o PDF ao app.', 'Criar, editar e publicar treino exige a disciplina Educador Físico ou Fisioterapeuta.

## Montar o treino

1. Na ficha do paciente, abra “Planos” › “Treino” e clique em “Criar plano”.
2. Informe o “Título” e o “Objetivo”.
3. Para cada treino (A, B, C…), dê um nome e o grupo muscular principal, e use “Adicionar treino” para criar os outros.
4. Em cada exercício, comece a digitar o nome e escolha na lista da Biblioteca: só assim o paciente vê a animação do movimento. Informe “Séries”, “Reps”, “Carga (kg)”, “Intervalo (s)” e, se quiser, uma instrução para o paciente.
5. Clique em “Salvar rascunho do treino”.

Enquanto for rascunho, o paciente ainda não vê o treino no app.

## Publicar

1. Na ficha, clique em “Publicar treino”.
2. Confira os dias liberados e quantos exercícios têm animação.
3. Deixe marcado “Avisar o paciente pelo app” se quiser que ele receba o aviso.
4. Clique em “Publicar”.

Depois de publicado, o paciente vê todos os treinos no app e escolhe qual fazer em cada dia. Se você editar um treino já publicado, o que salvar vale na hora para o paciente.

## Enviar o PDF

Com o treino publicado, o botão “Enviar ao paciente” abre a prévia do PDF. Clique em “Enviar ao app do paciente”. O paciente recebe um aviso e baixa em “Meus documentos”.', 2) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('biblioteca-de-exercicios', 'planos', 'Consultar a Biblioteca de exercícios', 'Procure exercícios por nome ou grupo muscular e veja como eles aparecem no treino do paciente.', 'A “Biblioteca” é a coleção de exercícios com animação usada nos treinos.

## Consultar

1. Abra “Biblioteca” no menu.
2. Use o campo “Buscar exercício” para procurar pelo nome.
3. Use os botões de grupo, como “Todos”, para ver só um grupo muscular.

Se nada aparecer, aparece “Nenhum exercício encontrado”: tente outro nome ou escolha outro grupo.

## Usar no treino

Ao montar o treino de um paciente, o campo do exercício sugere nomes da Biblioteca enquanto você digita (“Sugestões da Biblioteca”). Escolha o exercício pela lista:

- o paciente vê a animação do movimento no app;
- um exercício digitado à mão, que não está na Biblioteca, aparece só com o nome, sem animação.

Na hora de publicar o treino, o sistema mostra quantos exercícios têm animação, para você conferir antes de liberar.

## Quem pode usar

Todos podem consultar a Biblioteca. Montar treino em si exige a disciplina Educador Físico ou Fisioterapeuta.', 3) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('financeiro-vendas-e-caixa', 'gestao', 'Registrar vendas, recebimentos e fechar o caixa', 'O básico do Financeiro: nova venda, lançar recebimento, cancelar venda e operar o caixa.', 'Abra “Gestão” › “Financeiro”. As abas que aparecem dependem do seu papel: administrador, Gestor, Financeiro e Recepção veem áreas diferentes. A Recepção registra venda e recebimento e opera o próprio caixa.

## Registrar uma venda

1. Em “Vendas”, clique em “Nova venda”. Na ficha do paciente também existe o botão “Nova venda”.
2. Escolha a unidade e o paciente.
3. Em “Itens”, escolha o tipo (serviço, pacote ou produto/manipulado), a quantidade e o preço. Use “Adicionar item” para mais linhas.
4. Informe o “Vendedor”, se for outra pessoa, e clique em “Registrar venda”.

O preço de tabela só pode ser alterado por Gestor, Financeiro ou administrador.

## Lançar o recebimento

Abra a venda e clique em “Lançar recebimento”. Escolha a “Forma de pagamento” e o valor. O recebimento não pode passar do saldo da venda.

Para desfazer, clique em “Cancelar venda” e informe o motivo: recebimentos e títulos ficam como estornados, e nada é apagado.

## Caixa

1. Em “Caixa”, clique em “Abrir caixa” e informe o troco inicial em espécie.
2. Durante o dia, use “Sangria” (retirada) e “Suprimento” (reforço de troco), sempre com motivo.
3. No fim, clique em “Fechar caixa” e informe o valor contado. Se houver diferença, escreva a justificativa: o Gestor precisa aprovar o fechamento.

## Outras abas

“Mensalidades” (só administrador), “Painel”, “Atendimentos”, “Pacotes dos pacientes”, “Repasse”, “Títulos” e “Cadastros” (serviços, pacotes, meios de pagamento, impostos e histórico).', 1) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('estoque-itens-entradas-saidas', 'gestao', 'Cadastrar itens e controlar entradas e saídas do estoque', 'Do cadastro do item ao saldo: entradas, saídas, alertas e inventário.', 'Abra “Gestão” › “Estoque”. Quem escreve é o administrador, o Gestor e o Estoquista; o Financeiro só consulta.

## Cadastrar um item

1. Na aba “Itens”, clique em “Novo item”.
2. Informe nome, categoria, tipo (medicação aplicada, manipulado, produto de revenda ou material de consumo) e as unidades de compra, de estoque e de consumo, com as conversões.
3. Marque “Controla lote e validade” quando precisar (é obrigatório para medicação aplicada e manipulado) e defina o estoque mínimo.

## Dar entrada

Na aba “Entradas”, clique em “Nova entrada” para lançar saldo inicial, compra ou bonificação. Se tiver o arquivo da nota, use “Importar XML da NF-e”. Cada entrada atualiza o custo médio do item.

## Dar saída

Na aba “Saídas”, clique em “Nova saída”. Escolha o tipo (consumo interno, perda, quebra, vencimento ou uso por paciente). O sistema sugere o lote que vence primeiro e usa o custo médio do momento. Para uso por paciente, escolha o paciente.

## Acompanhar

- “Saldo”: quanto há de cada item por unidade, com lotes, validade e valor. Itens abaixo do mínimo ficam sinalizados.
- “Alertas”: itens abaixo do mínimo, lotes vencendo ou vencidos e transferências paradas.
- “Movimentações”: o histórico completo.
- “Inventário” e “Transferências”: contagem e envio de itens entre unidades.

O saldo é sempre a soma das movimentações. Para corrigir uma entrada errada, use “Estornar” na lista.', 2) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('documentos-clinicos', 'gestao', 'Emitir e consultar documentos clínicos', 'Receita, atestado, exames e relatório: como emitir pela ficha e onde consultar os já assinados.', 'Importante: a emissão de documentos funciona hoje em modo demonstração. O documento é uma simulação e não tem validade legal. Receitas de controlados só valem quando emitidas por um provedor de prescrição conectado. Esse aviso fica sempre visível na tela, no PDF e na lista.

## Emitir

1. Abra a ficha do paciente e clique em “Novo documento”.
2. Escolha o tipo: Receita, Atestado, Exames ou Relatório.
3. Os dados do paciente, do profissional e da clínica já vêm preenchidos. Informe, se quiser, o CPF e o endereço do paciente, o título e o conteúdo. Na receita, use “Adicionar medicamento” com dose, posologia e quantidade.
4. Clique em “Assinar (demonstração)”.

Só emite quem tem acesso clínico, conselho ou registro cadastrado, e só quando o provedor de prescrição da clínica está conectado. Se o botão estiver desabilitado, passe o mouse para ver o motivo.

## Consultar na clínica

Em “Gestão” › “Documentos” ficam os documentos assinados da clínica. Filtre por “Tipo”, “Situação” (Válidos ou Invalidados), “De”, “Até” e “Paciente ou título”. A Recepção pode reenviar documentos, mas não vê o conteúdo clínico.

## Exames e arquivos na ficha

Na aba “Documentos” da ficha, em “Exames e documentos”, você envia o PDF ou a imagem de um exame (até 15 MB) com “Enviar documento”. Dá para “Enviar ao paciente” para que ele veja no app, ou “Retirar do app” depois. Os “Laudos das avaliações” aparecem logo abaixo.', 3) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('configurar-pre-consulta', 'configuracoes', 'Configurar e enviar a pré-consulta', 'Defina as perguntas que o paciente responde no app antes da consulta e veja as respostas na ficha.', 'A pré-consulta é uma ficha curta, com pedido de exames, que o paciente recebe no app antes da consulta.

## Configurar (administrador)

1. Abra “Configurações”, na linha “Pré-consulta”, e clique em “Configurar”.
2. Em “Perguntas”, escreva o texto de cada pergunta. Use “Adicionar pergunta” para incluir mais, as setas para reordenar e “Restaurar perguntas padrão” para voltar ao modelo original.
3. Se quiser o envio automático, marque “Enviar a pré-consulta automaticamente quando uma consulta for marcada na Agenda”. Ele vem desligado.
4. Clique em “Salvar”.

## Enviar para um paciente

Mesmo com o envio automático desligado, a equipe pode enviar na hora:

1. Abra a ficha do paciente, aba “Resumo”.
2. No cartão “Pré-consulta”, clique em “Enviar pré-consulta”.
3. Para desfazer antes de o paciente responder, use “Cancelar pedido”.

## O que o paciente faz

No app, o pedido aparece no Início. O paciente responde no tempo dele, pode salvar o rascunho e continuar depois, e anexa PDF ou foto de exames. Ao enviar, a equipe já vê as respostas.

## Ver as respostas

As respostas e os exames aparecem no cartão “Pré-consulta” da ficha, e os exames também ficam na aba “Documentos”. O bloco “Resumo para a consulta” está em modo demonstração.', 1) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('rotina-do-paciente', 'configuracoes', 'Ligar a rotina do paciente e a missão da primeira semana', 'Peça foto, peso e feedback no app em dias fixos e acompanhe quem cumpriu.', 'A rotina pede foto, peso e feedback no Início do app do paciente e mostra na ficha quem cumpriu. Ela vem desligada.

## Ligar para a clínica (administrador)

1. Abra “Configurações” e role até o cartão “Rotina do paciente”.
2. Em “Rotina de acompanhamento”, clique em “Ligar”. O padrão sugerido é foto e peso uma vez por mês e feedback toda sexta.
3. Ajuste o período e o dia de cada item, se quiser, e clique em “Salvar rotina”.

## Missão da 1ª semana

É um checklist que o paciente novo cumpre antes da primeira consulta (fotos, peso, entre outros passos). Em “Missão da 1ª semana”, clique em “Ligar”, ligue ou desligue cada passo, edite o texto e defina o “Prazo da missão”. Deixe pelo menos um passo ligado.

Vale para quem entrar depois de ligar. Para quem já é paciente, o profissional pode iniciar na ficha.

## Ajustar por paciente

Na ficha, aba “Resumo”, o cartão “Rotina” mostra se o paciente está em dia ou pendente e o último feedback dele. Clique em “Ajustar rotina deste paciente” e escolha:

- “Seguir o padrão da clínica”;
- “Personalizar para este paciente”;
- “Não pedir rotina a este paciente”.

Depois, “Salvar rotina do paciente”. No cartão “Missão da 1ª semana”, use “Iniciar missão da 1ª semana” ou “Reiniciar missão” (o progresso volta a zero e conta só os registros a partir de hoje).', 2) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('outras-configuracoes', 'configuracoes', 'Conhecer as outras configurações da clínica', 'Foto, identidade visual, assinatura, lembrete de medicação e registros de exportação.', 'Abra “Configurações” pelo menu ou pelo menu da sua conta. Algumas linhas aparecem só para o administrador da clínica.

## Sua conta

No cartão “Sua conta”, você troca a sua foto e vê seu nome, seu papel e seu e-mail.

## Identidade da clínica (administrador)

Na linha “Identidade (logo e cor)”, envie o logo (PNG, JPG ou WebP, até 2 MB; fundo transparente fica melhor) e escolha a “Cor da marca”. Clique em “Salvar identidade”. A marca aparece no sistema e nos PDFs enviados aos pacientes.

## Assinatura e faturamento (administrador)

No cartão “Assinatura e faturamento”, clique em “Gerenciar” para contratar o plano da clínica e ver os dados de cobrança. Isso fica só com o administrador.

## Lembrete de aplicação de medicação

Na linha “Lembrete de aplicação de medicação (app do paciente)”, clique em “Ligar”. No dia da aplicação, o paciente vê no Início do app um cartão com o botão “Já apliquei”.

## Auditoria e exportações (administrador)

- “Auditoria de PDFs de prontuário” › “Ver registros”: quem exportou relatórios de pacientes, quando, período e volume, sem conteúdo clínico.
- “Exportações da base de pacientes”: quem exportou a base, quando, motivo e quantidade.

## Outras linhas que você já viu

“Equipe”, “Unidades”, “Disciplinas da equipe”, “Colunas da jornada”, “Pré-consulta”, “Rotina do paciente”, “Código de acesso da equipe” e “Integrações” têm tutoriais próprios.

Alguns itens, como alterar e-mail, resumo diário por e-mail e WhatsApp, ainda não estão disponíveis e aparecem desabilitados.', 3) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('app-paciente-como-recebe-o-acesso', 'app-paciente', 'Dar acesso ao app para o paciente', 'O paciente entra com o Google usando o mesmo e-mail do cadastro feito pela clínica.', 'O app do paciente é separado do painel da clínica. O paciente entra com o Google, e o acesso é liberado pelo e-mail do cadastro.

## O que a clínica faz

1. Cadastre o paciente em “Pacientes” › “Cadastrar novo paciente” (ou importe a planilha) e preencha o “E-mail” com o e-mail do Google do paciente.
2. Combine com o paciente de usar esse mesmo e-mail no app. Hoje o convite não é enviado pelo sistema: a orientação é sua.
3. Na ficha, em “Editar cadastro”, a linha de e-mail mostra “Acesso ainda não ativado” enquanto o paciente não entrou e “Conta de acesso vinculada” depois do primeiro acesso.

## O que o paciente faz

1. Abre o app e toca em “Entrar com Google”.
2. Escolhe a conta Google com o e-mail cadastrado.
3. Passa pelas telas de boas-vindas e chega ao Início.

## Se não funcionar

Se o paciente entrar mas aparecer “Acesso pendente”, a conta dele ainda não está ligada a um cadastro. Confira se o e-mail do cadastro é o mesmo da conta Google e corrija em “Editar cadastro”, se precisar.

Depois que o paciente já tem conta vinculada, o e-mail não pode ser trocado pelo cadastro.

## Vínculo com a equipe

O paciente só vê a equipe que está vinculada a ele. Se for o caso, o administrador inclui profissionais na equipe do paciente, no “Resumo” da ficha.', 1) on conflict (slug) do nothing;
insert into public.help_articles (slug, category_id, title, summary, body, position) values ('app-paciente-o-que-ele-ve', 'app-paciente', 'Saber o que o paciente vê e faz no app', 'As telas do app e o que cada ação do paciente gera para a clínica.', 'O app tem cinco áreas na barra inferior: “Hoje”, “Jornada”, “Evolução”, “Plano” e “Perfil”.

## O que o paciente vê

- Em “Hoje” (o Início do app): o índice de adesão, a sequência de dias, as tarefas de hoje, pendências (como foto ou peso atrasado) e atalhos de registro rápido para peso, água, refeição, foto, equipe e SOS.
- Em “Plano”: as abas Alimentar, Treino e Suplementos, com o que a equipe cadastrou e publicou. O paciente marca refeições feitas e suplementos tomados. Ao lado há orientações gerais de saúde, iguais para todos.
- Em “Meus documentos”: planos em PDF, relatórios e arquivos que a clínica enviou.
- O “Resumo da semana”, com o “Recado da semana” que você escreveu na ficha (se estiver em branco, ele vê um recado automático).
- Notificações: avisos de retorno, exames, disparos e automações da clínica.

## O que o paciente registra

Peso, fotos de evolução (visíveis só para ele e a equipe), treino concluído, água, sono e observações. Quando registra o peso, a equipe confere o valor antes de ele entrar no índice.

## Conversa e pré-consulta

Pela área “Equipe”, ele troca mensagens com os profissionais (aparecem em “Mensagens”, no painel). Quando a clínica pede, ele responde a pré-consulta no Início.

## O que muda para a clínica

Tudo o que o paciente registra aparece na ficha dele: Timeline, “Antropometria”, “Evolução/Fotos” e a adesão em “Pacientes” e na tela “Hoje”. Pacientes que deixam de registrar passam a aparecer como “Em atenção” ou “Em risco” na tela Hoje, e as automações de reengajamento podem avisá-los.', 2) on conflict (slug) do nothing;
