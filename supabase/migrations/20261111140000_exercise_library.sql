-- Biblioteca de exercícios (cartão Oficina #581): catálogo global com a mídia enviada pela cliente
-- (ZIP "Exercicios v1": 61 exercícios, cada um em webp/gif/mp4). A mídia fica no bucket público
-- `exercise-library`; o app e a web resolvem o GIF do exercício prescrito pelo nome (ou apelido),
-- sem mudar workout_exercises nem save_workout_plan.
-- Rollback: drop table public.exercise_library; delete from storage.objects where bucket_id='exercise-library';
--           delete from storage.buckets where id='exercise-library';

create table if not exists public.exercise_library (
  id text primary key,
  name text not null,
  group_key text not null,
  group_label text not null,
  group_order int not null default 0,
  sort_order int not null default 0,
  aliases text[] not null default '{}',
  media_webp text not null,
  media_gif text not null,
  media_mp4 text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists exercise_library_name_uq on public.exercise_library (lower(name));
create index if not exists exercise_library_order_idx on public.exercise_library (group_order, sort_order);

alter table public.exercise_library enable row level security;
revoke all on public.exercise_library from public, anon, authenticated;
grant select on public.exercise_library to authenticated;
drop policy if exists exercise_library_read on public.exercise_library;
create policy exercise_library_read on public.exercise_library for select to authenticated using (active);

insert into public.exercise_library (id, name, group_key, group_label, group_order, sort_order, aliases, media_webp, media_gif, media_mp4) values
  ('costas_barra-fixa-assistida', 'Barra fixa assistida na máquina', 'costas', 'Costas', 0, 0, '{}'::text[], 'costas/costas_barra-fixa-assistida.webp', 'costas/costas_barra-fixa-assistida.gif', 'costas/costas_barra-fixa-assistida.mp4'),
  ('costas_barra-fixa-pronada', 'Barra fixa pronada', 'costas', 'Costas', 0, 1, '{}'::text[], 'costas/costas_barra-fixa-pronada.webp', 'costas/costas_barra-fixa-pronada.gif', 'costas/costas_barra-fixa-pronada.mp4'),
  ('costas_barra-fixa-supinada', 'Barra fixa supinada', 'costas', 'Costas', 0, 2, '{}'::text[], 'costas/costas_barra-fixa-supinada.webp', 'costas/costas_barra-fixa-supinada.gif', 'costas/costas_barra-fixa-supinada.mp4'),
  ('costas_hiperextensao-45', 'Hiperextensão lombar 45°', 'costas', 'Costas', 0, 3, '{}'::text[], 'costas/costas_hiperextensao-45.webp', 'costas/costas_hiperextensao-45.gif', 'costas/costas_hiperextensao-45.mp4'),
  ('costas_levantamento-terra', 'Levantamento terra', 'costas', 'Costas', 0, 4, '{}'::text[], 'costas/costas_levantamento-terra.webp', 'costas/costas_levantamento-terra.gif', 'costas/costas_levantamento-terra.mp4'),
  ('costas_terra-sumo', 'Levantamento terra sumô', 'costas', 'Costas', 0, 5, '{}'::text[], 'costas/costas_terra-sumo.webp', 'costas/costas_terra-sumo.gif', 'costas/costas_terra-sumo.mp4'),
  ('costas_pulldown-bracos-estendidos', 'Pulldown de braços estendidos', 'costas', 'Costas', 0, 6, '{}'::text[], 'costas/costas_pulldown-bracos-estendidos.webp', 'costas/costas_pulldown-bracos-estendidos.gif', 'costas/costas_pulldown-bracos-estendidos.mp4'),
  ('costas_puxada-neutra', 'Puxada neutra na polia', 'costas', 'Costas', 0, 7, '{}'::text[], 'costas/costas_puxada-neutra.webp', 'costas/costas_puxada-neutra.gif', 'costas/costas_puxada-neutra.mp4'),
  ('costas_remada-baixa-polia', 'Remada baixa na polia', 'costas', 'Costas', 0, 8, array['Remada baixa sentada na polia']::text[], 'costas/costas_remada-baixa-polia.webp', 'costas/costas_remada-baixa-polia.gif', 'costas/costas_remada-baixa-polia.mp4'),
  ('costas_remada-cavalinho', 'Remada cavalinho', 'costas', 'Costas', 0, 9, array['Remada cavalinho com barra']::text[], 'costas/costas_remada-cavalinho.webp', 'costas/costas_remada-cavalinho.gif', 'costas/costas_remada-cavalinho.mp4'),
  ('core_abdominal-crunch', 'Abdominal crunch', 'core', 'Core e abdômen', 1, 10, '{}'::text[], 'core/core_abdominal-crunch.webp', 'core/core_abdominal-crunch.gif', 'core/core_abdominal-crunch.mp4'),
  ('core_dead-bug', 'Dead bug', 'core', 'Core e abdômen', 1, 11, '{}'::text[], 'core/core_dead-bug.webp', 'core/core_dead-bug.gif', 'core/core_dead-bug.mp4'),
  ('core_elevacao-pernas', 'Elevação de pernas deitado', 'core', 'Core e abdômen', 1, 12, '{}'::text[], 'core/core_elevacao-pernas.webp', 'core/core_elevacao-pernas.gif', 'core/core_elevacao-pernas.mp4'),
  ('core_pallof-press', 'Pallof press na polia', 'core', 'Core e abdômen', 1, 13, '{}'::text[], 'core/core_pallof-press.webp', 'core/core_pallof-press.gif', 'core/core_pallof-press.mp4'),
  ('core_perdigueiro', 'Perdigueiro', 'core', 'Core e abdômen', 1, 14, array['Perdigueiro (bird dog)','Bird dog']::text[], 'core/core_perdigueiro.webp', 'core/core_perdigueiro.gif', 'core/core_perdigueiro.mp4'),
  ('core_prancha-toque-ombro', 'Prancha com toque no ombro', 'core', 'Core e abdômen', 1, 15, '{}'::text[], 'core/core_prancha-toque-ombro.webp', 'core/core_prancha-toque-ombro.gif', 'core/core_prancha-toque-ombro.mp4'),
  ('core_prancha-frontal', 'Prancha frontal', 'core', 'Core e abdômen', 1, 16, '{}'::text[], 'core/core_prancha-frontal.webp', 'core/core_prancha-frontal.gif', 'core/core_prancha-frontal.mp4'),
  ('core_prancha-lateral', 'Prancha lateral', 'core', 'Core e abdômen', 1, 17, '{}'::text[], 'core/core_prancha-lateral.webp', 'core/core_prancha-lateral.gif', 'core/core_prancha-lateral.mp4'),
  ('peito_flexao-inclinada', 'Flexão com mãos no banco', 'peito', 'Peito', 2, 18, array['Flexão inclinada']::text[], 'peito/peito_flexao-inclinada.webp', 'peito/peito_flexao-inclinada.gif', 'peito/peito_flexao-inclinada.mp4'),
  ('peito_supino-reto-halteres', 'Supino reto com halteres', 'peito', 'Peito', 2, 19, '{}'::text[], 'peito/peito_supino-reto-halteres.webp', 'peito/peito_supino-reto-halteres.gif', 'peito/peito_supino-reto-halteres.mp4'),
  ('biceps_rosca-scott', 'Rosca Scott', 'biceps', 'Bíceps', 3, 20, '{}'::text[], 'biceps/biceps_rosca-scott.webp', 'biceps/biceps_rosca-scott.gif', 'biceps/biceps_rosca-scott.mp4'),
  ('biceps_rosca-alternada', 'Rosca alternada com halteres', 'biceps', 'Bíceps', 3, 21, '{}'::text[], 'biceps/biceps_rosca-alternada.webp', 'biceps/biceps_rosca-alternada.gif', 'biceps/biceps_rosca-alternada.mp4'),
  ('biceps_rosca-concentrada', 'Rosca concentrada', 'biceps', 'Bíceps', 3, 22, '{}'::text[], 'biceps/biceps_rosca-concentrada.webp', 'biceps/biceps_rosca-concentrada.gif', 'biceps/biceps_rosca-concentrada.mp4'),
  ('biceps_rosca-polia', 'Rosca direta na polia', 'biceps', 'Bíceps', 3, 23, '{}'::text[], 'biceps/biceps_rosca-polia.webp', 'biceps/biceps_rosca-polia.gif', 'biceps/biceps_rosca-polia.mp4'),
  ('triceps_paralelas', 'Mergulho nas paralelas', 'triceps', 'Tríceps', 4, 24, '{}'::text[], 'triceps/triceps_paralelas.webp', 'triceps/triceps_paralelas.gif', 'triceps/triceps_paralelas.mp4'),
  ('triceps_mergulho-banco', 'Mergulho no banco', 'triceps', 'Tríceps', 4, 25, '{}'::text[], 'triceps/triceps_mergulho-banco.webp', 'triceps/triceps_mergulho-banco.gif', 'triceps/triceps_mergulho-banco.mp4'),
  ('triceps_coice-halter', 'Tríceps coice com halter', 'triceps', 'Tríceps', 4, 26, '{}'::text[], 'triceps/triceps_coice-halter.webp', 'triceps/triceps_coice-halter.gif', 'triceps/triceps_coice-halter.mp4'),
  ('triceps_corda-polia', 'Tríceps corda na polia', 'triceps', 'Tríceps', 4, 27, array['Tríceps corda']::text[], 'triceps/triceps_corda-polia.webp', 'triceps/triceps_corda-polia.gif', 'triceps/triceps_corda-polia.mp4'),
  ('triceps_frances-halter', 'Tríceps francês com halter', 'triceps', 'Tríceps', 4, 28, '{}'::text[], 'triceps/triceps_frances-halter.webp', 'triceps/triceps_frances-halter.gif', 'triceps/triceps_frances-halter.mp4'),
  ('ombro_crucifixo-inverso', 'Crucifixo inverso com halteres', 'ombro', 'Ombros', 5, 29, '{}'::text[], 'ombro/ombro_crucifixo-inverso.webp', 'ombro/ombro_crucifixo-inverso.gif', 'ombro/ombro_crucifixo-inverso.mp4'),
  ('ombro_desenvolvimento-militar', 'Desenvolvimento militar em pé', 'ombro', 'Ombros', 5, 30, '{}'::text[], 'ombro/ombro_desenvolvimento-militar.webp', 'ombro/ombro_desenvolvimento-militar.gif', 'ombro/ombro_desenvolvimento-militar.mp4'),
  ('gluteo_abducao-deitado', 'Abdução de quadril deitado de lado', 'gluteo', 'Glúteo', 6, 31, '{}'::text[], 'gluteo/gluteo_abducao-deitado.webp', 'gluteo/gluteo_abducao-deitado.gif', 'gluteo/gluteo_abducao-deitado.mp4'),
  ('gluteo_elevacao-pelvica-barra', 'Elevação pélvica com barra', 'gluteo', 'Glúteo', 6, 32, '{}'::text[], 'gluteo/gluteo_elevacao-pelvica-barra.webp', 'gluteo/gluteo_elevacao-pelvica-barra.gif', 'gluteo/gluteo_elevacao-pelvica-barra.mp4'),
  ('posterior_terra-romeno-halteres', 'Levantamento terra romeno com halteres', 'posterior', 'Posterior de coxa', 7, 33, '{}'::text[], 'posterior/posterior_terra-romeno-halteres.webp', 'posterior/posterior_terra-romeno-halteres.gif', 'posterior/posterior_terra-romeno-halteres.mp4'),
  ('posterior_mesa-flexora', 'Mesa flexora', 'posterior', 'Posterior de coxa', 7, 34, array['Mesa Flexora']::text[], 'posterior/posterior_mesa-flexora.webp', 'posterior/posterior_mesa-flexora.gif', 'posterior/posterior_mesa-flexora.mp4'),
  ('quadriceps_agachamento-bulgaro', 'Agachamento búlgaro', 'quadriceps', 'Quadríceps', 8, 35, '{}'::text[], 'quadriceps/quadriceps_agachamento-bulgaro.webp', 'quadriceps/quadriceps_agachamento-bulgaro.gif', 'quadriceps/quadriceps_agachamento-bulgaro.mp4'),
  ('quadriceps_agachamento-frontal', 'Agachamento frontal com barra', 'quadriceps', 'Quadríceps', 8, 36, '{}'::text[], 'quadriceps/quadriceps_agachamento-frontal.webp', 'quadriceps/quadriceps_agachamento-frontal.gif', 'quadriceps/quadriceps_agachamento-frontal.mp4'),
  ('quadriceps_agachamento-goblet', 'Agachamento goblet', 'quadriceps', 'Quadríceps', 8, 37, '{}'::text[], 'quadriceps/quadriceps_agachamento-goblet.webp', 'quadriceps/quadriceps_agachamento-goblet.gif', 'quadriceps/quadriceps_agachamento-goblet.mp4'),
  ('quadriceps_agachamento-smith', 'Agachamento no Smith', 'quadriceps', 'Quadríceps', 8, 38, '{}'::text[], 'quadriceps/quadriceps_agachamento-smith.webp', 'quadriceps/quadriceps_agachamento-smith.gif', 'quadriceps/quadriceps_agachamento-smith.mp4'),
  ('quadriceps_agachamento-sumo', 'Agachamento sumô com halter', 'quadriceps', 'Quadríceps', 8, 39, '{}'::text[], 'quadriceps/quadriceps_agachamento-sumo.webp', 'quadriceps/quadriceps_agachamento-sumo.gif', 'quadriceps/quadriceps_agachamento-sumo.mp4'),
  ('quadriceps_passada-caminhando', 'Passada caminhando com halteres', 'quadriceps', 'Quadríceps', 8, 40, '{}'::text[], 'quadriceps/quadriceps_passada-caminhando.webp', 'quadriceps/quadriceps_passada-caminhando.gif', 'quadriceps/quadriceps_passada-caminhando.mp4'),
  ('quadriceps_sentar-levantar', 'Sentar e levantar da cadeira', 'quadriceps', 'Quadríceps', 8, 41, '{}'::text[], 'quadriceps/quadriceps_sentar-levantar.webp', 'quadriceps/quadriceps_sentar-levantar.gif', 'quadriceps/quadriceps_sentar-levantar.mp4'),
  ('quadriceps_step-up', 'Subida no step', 'quadriceps', 'Quadríceps', 8, 42, '{}'::text[], 'quadriceps/quadriceps_step-up.webp', 'quadriceps/quadriceps_step-up.gif', 'quadriceps/quadriceps_step-up.mp4'),
  ('abdutores_cadeira-abdutora', 'Cadeira abdutora', 'abdutores', 'Abdutores', 9, 43, array['Abdutora']::text[], 'abdutores/abdutores_cadeira-abdutora.webp', 'abdutores/abdutores_cadeira-abdutora.gif', 'abdutores/abdutores_cadeira-abdutora.mp4'),
  ('equilibrio_apoio-unipodal', 'Apoio unipodal', 'equilibrio', 'Equilíbrio', 10, 44, '{}'::text[], 'equilibrio/equilibrio_apoio-unipodal.webp', 'equilibrio/equilibrio_apoio-unipodal.gif', 'equilibrio/equilibrio_apoio-unipodal.mp4'),
  ('cardio_bicicleta', 'Bicicleta ergométrica', 'cardio', 'Cardio', 11, 45, array['Bicicleta']::text[], 'cardio/cardio_bicicleta.webp', 'cardio/cardio_bicicleta.gif', 'cardio/cardio_bicicleta.mp4'),
  ('cardio_burpee', 'Burpee', 'cardio', 'Cardio', 11, 46, '{}'::text[], 'cardio/cardio_burpee.webp', 'cardio/cardio_burpee.gif', 'cardio/cardio_burpee.mp4'),
  ('cardio_caminhada-esteira', 'Caminhada na esteira', 'cardio', 'Cardio', 11, 47, '{}'::text[], 'cardio/cardio_caminhada-esteira.webp', 'cardio/cardio_caminhada-esteira.gif', 'cardio/cardio_caminhada-esteira.mp4'),
  ('cardio_escalador', 'Escalador', 'cardio', 'Cardio', 11, 48, '{}'::text[], 'cardio/cardio_escalador.webp', 'cardio/cardio_escalador.gif', 'cardio/cardio_escalador.mp4'),
  ('cardio_marcha-estacionaria', 'Marcha estacionária', 'cardio', 'Cardio', 11, 49, '{}'::text[], 'cardio/cardio_marcha-estacionaria.webp', 'cardio/cardio_marcha-estacionaria.gif', 'cardio/cardio_marcha-estacionaria.mp4'),
  ('cardio_polichinelo', 'Polichinelo', 'cardio', 'Cardio', 11, 50, '{}'::text[], 'cardio/cardio_polichinelo.webp', 'cardio/cardio_polichinelo.gif', 'cardio/cardio_polichinelo.mp4'),
  ('cardio_remo-ergometro', 'Remo ergômetro', 'cardio', 'Cardio', 11, 51, '{}'::text[], 'cardio/cardio_remo-ergometro.webp', 'cardio/cardio_remo-ergometro.gif', 'cardio/cardio_remo-ergometro.mp4'),
  ('mobilidade_isquiotibiais', 'Alongamento de posteriores deitado', 'mobilidade', 'Mobilidade e alongamento', 12, 52, '{}'::text[], 'mobilidade/mobilidade_isquiotibiais.webp', 'mobilidade/mobilidade_isquiotibiais.gif', 'mobilidade/mobilidade_isquiotibiais.mp4'),
  ('mobilidade_flexor-quadril', 'Alongamento do flexor do quadril ajoelhado', 'mobilidade', 'Mobilidade e alongamento', 12, 53, '{}'::text[], 'mobilidade/mobilidade_flexor-quadril.webp', 'mobilidade/mobilidade_flexor-quadril.gif', 'mobilidade/mobilidade_flexor-quadril.mp4'),
  ('mobilidade_gato-camelo', 'Gato-camelo', 'mobilidade', 'Mobilidade e alongamento', 12, 54, '{}'::text[], 'mobilidade/mobilidade_gato-camelo.webp', 'mobilidade/mobilidade_gato-camelo.gif', 'mobilidade/mobilidade_gato-camelo.mp4'),
  ('mobilidade_tornozelo-parede', 'Mobilidade de tornozelo na parede', 'mobilidade', 'Mobilidade e alongamento', 12, 55, '{}'::text[], 'mobilidade/mobilidade_tornozelo-parede.webp', 'mobilidade/mobilidade_tornozelo-parede.gif', 'mobilidade/mobilidade_tornozelo-parede.mp4'),
  ('mobilidade_quadril-90-90', 'Quadril 90/90', 'mobilidade', 'Mobilidade e alongamento', 12, 56, array['Quadril 90 90']::text[], 'mobilidade/mobilidade_quadril-90-90.webp', 'mobilidade/mobilidade_quadril-90-90.gif', 'mobilidade/mobilidade_quadril-90-90.mp4'),
  ('mobilidade_rotacao-toracica', 'Rotação torácica em quatro apoios', 'mobilidade', 'Mobilidade e alongamento', 12, 57, '{}'::text[], 'mobilidade/mobilidade_rotacao-toracica.webp', 'mobilidade/mobilidade_rotacao-toracica.gif', 'mobilidade/mobilidade_rotacao-toracica.mp4'),
  ('elastico_caminhada-lateral', 'Caminhada lateral com elástico', 'elastico', 'Elástico', 13, 58, '{}'::text[], 'elastico/elastico_caminhada-lateral.webp', 'elastico/elastico_caminhada-lateral.gif', 'elastico/elastico_caminhada-lateral.mp4'),
  ('elastico_remada', 'Remada em pé com elástico', 'elastico', 'Elástico', 13, 59, '{}'::text[], 'elastico/elastico_remada.webp', 'elastico/elastico_remada.gif', 'elastico/elastico_remada.mp4'),
  ('elastico_rosca', 'Rosca com elástico', 'elastico', 'Elástico', 13, 60, '{}'::text[], 'elastico/elastico_rosca.webp', 'elastico/elastico_rosca.gif', 'elastico/elastico_rosca.mp4')
on conflict (id) do update set name = excluded.name, group_key = excluded.group_key, group_label = excluded.group_label,
  group_order = excluded.group_order, sort_order = excluded.sort_order, aliases = excluded.aliases,
  media_webp = excluded.media_webp, media_gif = excluded.media_gif, media_mp4 = excluded.media_mp4;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-library', 'exercise-library', true, 5242880, array['image/webp','image/gif','video/mp4'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
