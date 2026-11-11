-- Biblioteca de exercícios (Oficina #581): grupos com o nome e a ordem do HTML de referência da cliente
-- ("Biblioteca_de_Exercicios.html", Nova Studio, 11/11/2026): 14 grupos em ordem alfabética, exercícios na ordem do HTML.
-- O nome curto do HTML vira apelido (menos 'remada' e 'rosca' do elástico, genéricos demais para ligar o GIF) (busca e GIF pelo nome). Só dados; a mídia é a mesma (conferida arquivo a arquivo).
-- Rollback: reaplicar 20261111140000_exercise_library.sql (o upsert devolve rótulos, ordem e apelidos anteriores).
do $$
begin
  if (select count(*) from public.exercise_library) <> 61 then
    raise exception 'exercise_library: esperado 61 itens';
  end if;
end $$;

update public.exercise_library e set group_label = v.label, group_order = v.gorder, sort_order = v.sorder, aliases = v.aliases
from (values
  ('abdutores_cadeira-abdutora', 'Abdutores', 0, 0, array['cadeira abdutora','Abdutora']::text[]),
  ('biceps_rosca-alternada', 'Bíceps', 1, 1, array['rosca alternada']::text[]),
  ('biceps_rosca-concentrada', 'Bíceps', 1, 2, array['rosca concentrada']::text[]),
  ('biceps_rosca-polia', 'Bíceps', 1, 3, array['rosca polia']::text[]),
  ('biceps_rosca-scott', 'Bíceps', 1, 4, array['rosca scott']::text[]),
  ('cardio_bicicleta', 'Cardio', 2, 5, array['bicicleta']::text[]),
  ('cardio_burpee', 'Cardio', 2, 6, array['burpee']::text[]),
  ('cardio_caminhada-esteira', 'Cardio', 2, 7, array['caminhada esteira']::text[]),
  ('cardio_escalador', 'Cardio', 2, 8, array['escalador']::text[]),
  ('cardio_marcha-estacionaria', 'Cardio', 2, 9, array['marcha estacionaria']::text[]),
  ('cardio_polichinelo', 'Cardio', 2, 10, array['polichinelo']::text[]),
  ('cardio_remo-ergometro', 'Cardio', 2, 11, array['remo ergometro']::text[]),
  ('core_abdominal-crunch', 'Core', 3, 12, array['abdominal crunch']::text[]),
  ('core_dead-bug', 'Core', 3, 13, array['dead bug']::text[]),
  ('core_elevacao-pernas', 'Core', 3, 14, array['elevacao pernas']::text[]),
  ('core_pallof-press', 'Core', 3, 15, array['pallof press']::text[]),
  ('core_perdigueiro', 'Core', 3, 16, array['perdigueiro','Perdigueiro (bird dog)','Bird dog']::text[]),
  ('core_prancha-frontal', 'Core', 3, 17, array['prancha frontal']::text[]),
  ('core_prancha-lateral', 'Core', 3, 18, array['prancha lateral']::text[]),
  ('core_prancha-toque-ombro', 'Core', 3, 19, array['prancha toque ombro']::text[]),
  ('costas_barra-fixa-assistida', 'Costas', 4, 20, array['barra fixa assistida']::text[]),
  ('costas_barra-fixa-pronada', 'Costas', 4, 21, array['barra fixa pronada']::text[]),
  ('costas_barra-fixa-supinada', 'Costas', 4, 22, array['barra fixa supinada']::text[]),
  ('costas_hiperextensao-45', 'Costas', 4, 23, array['hiperextensao 45']::text[]),
  ('costas_levantamento-terra', 'Costas', 4, 24, array['levantamento terra']::text[]),
  ('costas_pulldown-bracos-estendidos', 'Costas', 4, 25, array['pulldown bracos estendidos']::text[]),
  ('costas_puxada-neutra', 'Costas', 4, 26, array['puxada neutra']::text[]),
  ('costas_remada-baixa-polia', 'Costas', 4, 27, array['remada baixa polia','Remada baixa sentada na polia']::text[]),
  ('costas_remada-cavalinho', 'Costas', 4, 28, array['remada cavalinho','Remada cavalinho com barra']::text[]),
  ('costas_terra-sumo', 'Costas', 4, 29, array['terra sumo']::text[]),
  ('elastico_caminhada-lateral', 'Elástico', 5, 30, array['caminhada lateral']::text[]),
  ('elastico_remada', 'Elástico', 5, 31, '{}'::text[]),
  ('elastico_rosca', 'Elástico', 5, 32, '{}'::text[]),
  ('equilibrio_apoio-unipodal', 'Equilíbrio', 6, 33, array['apoio unipodal']::text[]),
  ('gluteo_abducao-deitado', 'Glúteo', 7, 34, array['abducao deitado']::text[]),
  ('gluteo_elevacao-pelvica-barra', 'Glúteo', 7, 35, array['elevacao pelvica barra']::text[]),
  ('mobilidade_flexor-quadril', 'Mobilidade', 8, 36, array['flexor quadril']::text[]),
  ('mobilidade_gato-camelo', 'Mobilidade', 8, 37, array['gato camelo']::text[]),
  ('mobilidade_isquiotibiais', 'Mobilidade', 8, 38, array['isquiotibiais']::text[]),
  ('mobilidade_quadril-90-90', 'Mobilidade', 8, 39, array['quadril 90 90']::text[]),
  ('mobilidade_rotacao-toracica', 'Mobilidade', 8, 40, array['rotacao toracica']::text[]),
  ('mobilidade_tornozelo-parede', 'Mobilidade', 8, 41, array['tornozelo parede']::text[]),
  ('ombro_crucifixo-inverso', 'Ombro', 9, 42, array['crucifixo inverso']::text[]),
  ('ombro_desenvolvimento-militar', 'Ombro', 9, 43, array['desenvolvimento militar']::text[]),
  ('peito_flexao-inclinada', 'Peito', 10, 44, array['flexao inclinada']::text[]),
  ('peito_supino-reto-halteres', 'Peito', 10, 45, array['supino reto halteres']::text[]),
  ('posterior_mesa-flexora', 'Posterior', 11, 46, array['mesa flexora']::text[]),
  ('posterior_terra-romeno-halteres', 'Posterior', 11, 47, array['terra romeno halteres']::text[]),
  ('quadriceps_agachamento-bulgaro', 'Quadríceps', 12, 48, array['agachamento bulgaro']::text[]),
  ('quadriceps_agachamento-frontal', 'Quadríceps', 12, 49, array['agachamento frontal']::text[]),
  ('quadriceps_agachamento-goblet', 'Quadríceps', 12, 50, array['agachamento goblet']::text[]),
  ('quadriceps_agachamento-smith', 'Quadríceps', 12, 51, array['agachamento smith']::text[]),
  ('quadriceps_agachamento-sumo', 'Quadríceps', 12, 52, array['agachamento sumo']::text[]),
  ('quadriceps_passada-caminhando', 'Quadríceps', 12, 53, array['passada caminhando']::text[]),
  ('quadriceps_sentar-levantar', 'Quadríceps', 12, 54, array['sentar levantar']::text[]),
  ('quadriceps_step-up', 'Quadríceps', 12, 55, array['step up']::text[]),
  ('triceps_coice-halter', 'Tríceps', 13, 56, array['coice halter']::text[]),
  ('triceps_corda-polia', 'Tríceps', 13, 57, array['corda polia','Tríceps corda']::text[]),
  ('triceps_frances-halter', 'Tríceps', 13, 58, array['frances halter']::text[]),
  ('triceps_mergulho-banco', 'Tríceps', 13, 59, array['mergulho banco']::text[]),
  ('triceps_paralelas', 'Tríceps', 13, 60, array['paralelas']::text[])
) as v(id, label, gorder, sorder, aliases)
where e.id = v.id;
