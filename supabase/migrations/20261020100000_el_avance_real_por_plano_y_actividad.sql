-- =============================================================================
-- EL AVANCE DE LA UNIDAD, LO MÁS REAL POSIBLE: POR PLANO Y POR ACTIVIDAD
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-20: «lo más importante es uno el costeo del vehículo
-- y dos el porcentaje sea lo más real posible», y explicó cómo:
--
--   «Diseño, cuando agrega un plano a un código interno, tiene que darle un
--   porcentaje de avance para la terminación de lo creado; entonces los
--   supervisores, como método de defensa, si es que Diseño no actualiza y
--   están ya avanzando, pueden hacer su propio porcentaje de avance vinculando
--   o no a un plano que dictamine Diseño. Además pueden reportar actividades
--   que ya reportaron un día antes que aún no están finalizadas, y que solo les
--   permita reportar el progreso que hayan avanzado: si corte de materia prima
--   el jueves reportaron 9 %, al día siguiente que lo puedan seleccionar y que
--   solo les deje reportar 10 % a más.» Y: «en Producción deben reportar los
--   avances de los subcontratos; en Maestranza, los avances de la habilitación
--   de material».
--
-- Hasta hoy el avance de un código era el promedio de sus etapas, todas con el
-- mismo peso, y cada etapa valía el promedio del último avance de cada trabajo
-- que su área escribía a mano en el reporte diario. Dos trabajos se tomaban por
-- el mismo si se escribían igual: «Corte de planchas» y «Corte planchas» eran
-- dos, y nada impedía que el viernes dijera 5 % lo que el jueves iba en 9 %.
-- Desde ahora:
--
--   * EL PESO DEL PLANO. Diseño pone a cada plano el porcentaje de la unidad
--     que representa (como en la hoja «Cumplimiento», donde cada plano llevaba
--     «el % que ese grupo pesa en la unidad»). Entre los planos vigentes de un
--     código no pasan de 100. Lo puede corregir después; el anulado deja libre
--     su parte. El plano sin peso (los de antes) no entra al reparto.
--   * LA ACTIVIDAD. Cada trabajo del reporte diario es una actividad con nombre
--     propio que dura varios días. El supervisor elige sobre qué reporta:
--       - un PLANO de su área (Maestranza: el habilitado de material; Producción
--         y Acabados: el armado y el acabado de ese plano), una sola actividad
--         por plano;
--       - un SUBCONTRATO de su área (Producción o Acabados), una por subcontrato;
--       - una actividad que ya abrió otro día y no terminó, para sumarle avance;
--       - o una actividad nueva, propia, sin plano: la defensa del supervisor
--         cuando Diseño todavía no subió el plano y el taller ya está avanzando.
--     Una actividad nueva que se llama igual que otra abierta del mismo código y
--     área se rechaza: se continúa la que ya existe.
--   * SOLO HACIA ARRIBA. El avance de una actividad tiene que ser mayor que el
--     de su último reporte anterior (el jueves 9 %, el viernes 10 % o más) y
--     menor que el de un reporte de un día posterior, si lo hay (un reporte
--     atrasado no pasa por encima del de después). Llegada al 100 %, ya no se
--     reporta. Un reporte observado que se corrige se compara sin él.
--   * EL SUBCONTRATO SE REPORTA AUNQUE NO HAYA GENTE PROPIA. El trabajo lo hace
--     el subcontratista, que no está en el personal: un reporte donde todo es
--     de subcontratos no pide horas. El subcontrato que Administración da por
--     TERMINADO cuenta 100 %.
--   * EL PORCENTAJE DE LA UNIDAD. Lo que Diseño repartió en planos se mide
--     plano por plano: cada uno aporta su peso por su avance (100 % si la etapa
--     de su área ya terminó). Lo que Diseño no repartió (100 menos la suma de
--     los pesos) se mide como hasta hoy, por las etapas, ahora con las
--     actividades: la etapa terminada vale 100 y la que no, el promedio del
--     último avance de cada actividad de su área que no sea de un plano con
--     peso (ese ya contó por su lado: contarlo otra vez en la etapa inflaba el
--     porcentaje). Sin pesos, el avance es el de antes; con pesos que suman
--     100, es solo el de los planos.
--
-- Las funciones que ya leen las pantallas conservan su firma (el conector de
-- producción no deja quitar ninguna): `codigos_internos_avance` dice además
-- PLANOS en su fuente cuando hay pesos, y `codigo_interno_etapas` cuenta por
-- actividad. Lo nuevo: el peso en `codigo_planos`, la tabla
-- `codigo_actividades`, la actividad de cada trabajo, `fijar_peso_plano`, la
-- firma de `registrar_plano_codigo` con el peso, `reporte_diario_opciones` (lo
-- que el supervisor puede elegir) y `codigo_interno_avance_planos` (el aporte de
-- cada plano), con `codigo_interno_avance_partes` (cómo sale el porcentaje, en
-- sus dos partes). La firma vieja de registrar un plano ya no carga planos sin peso.
-- La actividad de un plano con peso no entra al promedio de su etapa: el plano
-- ya cuenta por su lado. PLANTA, que no lleva avance, no pasa por actividades
-- abiertas: cada día su trabajo va suelto.
--
-- Los reportes de antes, sin actividad, siguen contando como hasta hoy: un
-- trabajo por su texto y su área.
--
-- Sin DROP ni DELETE: el conector de producción no los deja pasar.
-- =============================================================================

-- 1. El peso de cada plano ------------------------------------------------------------------
alter table public.codigo_planos add column if not exists peso numeric(5, 2);
comment on column public.codigo_planos.peso is
  'El porcentaje de la unidad que representa el plano, puesto por Diseño. Entre los planos vigentes de un código no pasa de 100. Vacío en los planos de antes del 2026-10-20: no entran al reparto del avance.';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_codigo_plano_peso') then
    alter table public.codigo_planos add constraint ck_codigo_plano_peso check (peso is null or (peso >= 0 and peso <= 100));
  end if;
end $$;

-- Lo cargado sigue sin corregirse, salvo el peso, que Diseño ajusta mientras el plano esté vigente.
create or replace function public.fn_codigo_plano_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_en', 'anulado_por', 'motivo_anulacion', 'actualizado_en', 'peso'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un plano cargado no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'El plano % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Un plano cargado no se corrige: súbele una revisión, o anúlalo con su motivo y cárgalo bien.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_codigo_plano_guardia() from public, anon, authenticated;

-- Entre los planos vigentes de un código no pasan de 100. El candado por código
-- impide que dos cargas a la vez pasen el tope cada una por su lado.
create or replace function public.fn_codigo_plano_peso_tope()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_otros numeric;
begin
  if new.anulado_en is not null or new.peso is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('peso-planos:' || new.codigo_interno, 0));
  select coalesce(sum(p.peso), 0) into v_otros
    from public.codigo_planos p
   where p.codigo_interno = new.codigo_interno and p.anulado_en is null and p.id <> new.id and p.peso is not null;
  if v_otros + new.peso > 100 then
    raise exception 'Los demás planos de % ya suman % %% de la unidad: a este le queda como mucho % %%.',
      new.codigo_interno, trim(trailing '.' from to_char(v_otros, 'FM990.99')),
      trim(trailing '.' from to_char(greatest(100 - v_otros, 0), 'FM990.99'))
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_codigo_plano_peso_tope() from public, anon, authenticated;
create or replace trigger trg_codigo_plano_peso_tope
  before insert or update on public.codigo_planos
  for each row execute function public.fn_codigo_plano_peso_tope();

-- 2. Cargar un plano, con su peso -------------------------------------------------------------
-- La firma de 20261015200000 hace todo lo demás; esta exige el peso y lo pone en
-- la misma transacción. La vieja, llamada sola, ya no carga: dice qué falta.
create or replace function public.registrar_plano_codigo(
  p_plano uuid, p_revision uuid, p_codigo text, p_numero text, p_nombre text, p_area uuid,
  p_observacion text, p_nombre_archivo text, p_peso numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
begin
  perform public.exigir_permiso('diseno.codigos');
  if p_peso is null or p_peso < 0 or p_peso > 100 or p_peso <> round(p_peso, 2) then
    raise exception 'Pon el porcentaje de la unidad que representa el plano: de 0 a 100, con hasta dos decimales.'
      using errcode = 'check_violation';
  end if;
  perform set_config('metalwork.plano_con_peso', p_plano::text, true);
  v_id := public.registrar_plano_codigo(p_plano, p_revision, p_codigo, p_numero, p_nombre, p_area, p_observacion, p_nombre_archivo);
  perform set_config('metalwork.plano_con_peso', '', true);
  update public.codigo_planos set peso = p_peso where id = v_id and peso is distinct from p_peso;
  return v_id;
end;
$$;
comment on function public.registrar_plano_codigo(uuid, uuid, text, text, text, uuid, text, text, numeric) is
  'Diseño carga un plano para un código interno con su área de producción, su primer PDF (R1) y el porcentaje de la unidad que representa (los vigentes del código no pasan de 100). Avisa al supervisor del área. Exige diseno.codigos.';
revoke all on function public.registrar_plano_codigo(uuid, uuid, text, text, text, uuid, text, text, numeric) from public, anon;
grant execute on function public.registrar_plano_codigo(uuid, uuid, text, text, text, uuid, text, text, numeric) to authenticated;

-- La firma de 20261015200000, igual salvo la primera comprobación: sola ya no
-- carga un plano, porque quedaría sin peso.
create or replace function public.registrar_plano_codigo(
  p_plano uuid, p_revision uuid, p_codigo text, p_numero text, p_nombre text, p_area uuid,
  p_observacion text, p_nombre_archivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_codigo  text;
  v_numero  text := upper(regexp_replace(btrim(coalesce(p_numero, '')), '\s+', ' ', 'g'));
  v_nombre  text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_obs     text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_ruta    text := p_plano::text || '/' || p_revision::text || '.pdf';
  v_area    public.areas%rowtype;
  v_existe  public.codigo_planos%rowtype;
  v_tamano  integer;
begin
  perform public.exigir_permiso('diseno.codigos');
  if coalesce(current_setting('metalwork.plano_con_peso', true), '') is distinct from p_plano::text then
    raise exception 'Pon el porcentaje de la unidad que representa el plano: vuelve a cargar la pantalla.'
      using errcode = 'check_violation';
  end if;
  v_codigo := public.exigir_codigo_de_unidad(p_codigo);

  select * into v_existe from public.codigo_planos where id = p_plano;
  if found then
    if v_existe.codigo_interno = v_codigo and upper(v_existe.numero) = v_numero and v_existe.area_id = p_area
       and v_existe.creado_por = v_yo
       and exists (select 1 from public.codigo_plano_revisiones r where r.id = p_revision and r.plano_id = p_plano) then
      return p_plano;
    end if;
    raise exception 'Ese plano ya se cargó con otros datos. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.codigo_plano_revisiones where id = p_revision) then
    raise exception 'Ese PDF ya se registró en otro plano. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  if char_length(v_numero) not between 1 and 20 then
    raise exception 'Escribe el número del plano como figura en él: 001, 2A, ENS.' using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) not between 2 and 200 then
    raise exception 'Escribe el nombre del plano, por ejemplo ESTRUCTURA CAJÓN o COMPUERTA.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_obs, '')) > 1000 then
    raise exception 'La observación del plano pasa de 1000 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_area from public.areas where id = p_area;
  if not found or v_area.codigo not in ('MTZ', 'PRD', 'ACB') then
    raise exception 'Elige a qué área de producción va el plano: Maestranza, Producción o Acabados.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.codigo_planos p
              where p.codigo_interno = v_codigo and upper(p.numero) = v_numero and p.area_id = p_area and p.anulado_en is null) then
    raise exception 'El plano % para % ya está en el código %: súbele una revisión en lugar de cargarlo otra vez.',
      v_numero, v_area.nombre, v_codigo using errcode = 'check_violation';
  end if;

  v_tamano := public.plano_pdf_subido(v_ruta, p_nombre_archivo);

  insert into public.codigo_planos (id, codigo_interno, numero, nombre, area_id, observacion, creado_por)
  values (p_plano, v_codigo, v_numero, v_nombre, p_area, v_obs, v_yo);
  insert into public.codigo_plano_revisiones (id, plano_id, revision, nombre_archivo, ruta, tamano_bytes, subido_por)
  values (p_revision, p_plano, 1, btrim(p_nombre_archivo), v_ruta, v_tamano, v_yo);

  perform public.avisar_area_del_plano(p_area,
    'Plano nuevo para ' || v_area.nombre || ': ' || v_codigo,
    'Diseño cargó el plano ' || v_numero || ' «' || v_nombre || '». Ábrelo y marca que lo recibiste.', p_plano);
  return p_plano;
end;
$$;
comment on function public.registrar_plano_codigo(uuid, uuid, text, text, text, uuid, text, text) is
  'La carga de un plano sin su peso. Desde 20261020100000 solo la llama la firma con el peso (registrar_plano_codigo con p_peso); sola, se niega. Exige diseno.codigos.';

-- 3. Corregir el peso de un plano --------------------------------------------------------------
create or replace function public.fijar_peso_plano(p_plano uuid, p_peso numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_plano public.codigo_planos%rowtype;
begin
  perform public.exigir_permiso('diseno.codigos');
  if p_peso is null or p_peso < 0 or p_peso > 100 or p_peso <> round(p_peso, 2) then
    raise exception 'El porcentaje del plano va de 0 a 100, con hasta dos decimales.' using errcode = 'check_violation';
  end if;
  select * into v_plano from public.codigo_planos where id = p_plano for update;
  if not found then
    raise exception 'Ese plano no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if v_plano.anulado_en is not null then
    raise exception 'El plano % está anulado: no lleva porcentaje.', v_plano.numero using errcode = 'check_violation';
  end if;
  update public.codigo_planos set peso = p_peso where id = p_plano and peso is distinct from p_peso;
  return p_plano;
end;
$$;
comment on function public.fijar_peso_plano(uuid, numeric) is
  'Diseño pone o corrige el porcentaje de la unidad que representa un plano vigente; los vigentes del código no pasan de 100. Exige diseno.codigos.';
revoke all on function public.fijar_peso_plano(uuid, numeric) from public, anon;
grant execute on function public.fijar_peso_plano(uuid, numeric) to authenticated;

-- 4. Las actividades ----------------------------------------------------------------------------
create table if not exists public.codigo_actividades (
  id              uuid primary key default gen_random_uuid(),
  codigo_interno  text not null,
  -- El área que la hace: la del plano o la del subcontrato, o la de quien la abrió.
  area_id         uuid,
  descripcion     text not null,
  plano_id        uuid,
  subcontrato_id  uuid,
  creado_por      uuid not null default public.usuario_actual(),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  -- Las llaves a las áreas y a quien la abrió: ni (a) ni (b) ni (c), sin índice.
  constraint codigo_actividades_area_id_fkey foreign key (area_id) references public.areas(id) on delete restrict,
  constraint codigo_actividades_creado_por_fkey foreign key (creado_por) references public.usuarios(id) on delete restrict,
  constraint codigo_actividades_plano_id_fkey foreign key (plano_id) references public.codigo_planos(id) on delete restrict,
  constraint codigo_actividades_subcontrato_id_fkey foreign key (subcontrato_id) references public.subcontratos(id) on delete restrict,
  constraint ck_codigo_actividad check (
    codigo_interno = upper(btrim(codigo_interno)) and char_length(codigo_interno) between 2 and 60
    and char_length(btrim(descripcion)) between 3 and 500
    and not (plano_id is not null and subcontrato_id is not null))
);
comment on table public.codigo_actividades is
  'Cada actividad que un área avanza en un código interno a lo largo de varios días: la de un plano, la de un subcontrato o una propia del supervisor. Su avance es el de su último reporte diario vigente. No se corrige ni se borra.';

-- Una actividad por plano y una por subcontrato; los dos índices sirven además a sus llaves (a).
create unique index if not exists uq_codigo_actividad_plano on public.codigo_actividades (plano_id) where plano_id is not null;
create unique index if not exists uq_codigo_actividad_subcontrato on public.codigo_actividades (subcontrato_id) where subcontrato_id is not null;
-- (b) El formulario del reporte busca las abiertas de un código.
create index if not exists idx_codigo_actividades_codigo on public.codigo_actividades (codigo_interno, area_id);

select public.activar_timestamps('codigo_actividades');
select public.activar_auditoria('codigo_actividades');
select public.activar_registro_de_prueba('codigo_actividades');

create or replace function public.fn_codigo_actividad_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una actividad no se borra: queda con sus reportes.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    raise exception 'Una actividad no se corrige: su avance sale de los reportes.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_codigo_actividad_guardia() from public, anon, authenticated;
create or replace trigger trg_codigo_actividad_guardia
  before update or delete on public.codigo_actividades
  for each row execute function public.fn_codigo_actividad_guardia();

alter table public.codigo_actividades enable row level security;
revoke all on public.codigo_actividades from public, anon, authenticated;
grant select on public.codigo_actividades to authenticated;
do $$ begin
  -- Quien ve los reportes, quien ve los códigos, Diseño, y el supervisor las de su área.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'codigo_actividades'
                    and policyname = 'ver_codigo_actividades') then
    create policy ver_codigo_actividades on public.codigo_actividades for select to authenticated using (
      (select public.es_admin()) or (select public.tiene_permiso('reporte_diario.ver'))
      or (select public.tiene_permiso('codigos_internos.ver')) or (select public.tiene_permiso('codigos_internos.seguimiento'))
      or (select public.tiene_permiso('diseno.codigos'))
      or creado_por = (select public.usuario_actual())
      or ((select public.tiene_permiso('reporte_diario.registrar')) and public.puede_hoja_de_area(area_id)));
  end if;
end $$;

-- El trabajo del reporte dice de qué actividad es. Los de antes quedan sin ella.
alter table public.reporte_diario_trabajos add column if not exists actividad_id uuid;
comment on column public.reporte_diario_trabajos.actividad_id is
  'La actividad que este trabajo avanza. Vacío en los reportes de antes del 2026-10-20, que cuentan por su texto y su área.';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reporte_diario_trabajos_actividad_id_fkey') then
    alter table public.reporte_diario_trabajos add constraint reporte_diario_trabajos_actividad_id_fkey
      foreign key (actividad_id) references public.codigo_actividades(id) on delete restrict;
  end if;
end $$;
-- (b) El último avance de cada actividad y el tope de solo hacia arriba se buscan por actividad.
create index if not exists idx_reporte_diario_trabajos_actividad
  on public.reporte_diario_trabajos (actividad_id) where actividad_id is not null;

-- 5. El avance de cada actividad, sin pedir permiso -----------------------------------------------
-- Una fila por actividad de los reportes vigentes: su último avance, cuándo, y
-- cuántos reportes la llevan. Los trabajos de antes, sin actividad, cuentan por
-- su texto y su área, como hasta hoy. El subcontrato TERMINADO vale 100. La
-- actividad de un plano que Diseño anuló o de un subcontrato ANULADO ya no
-- cuenta: nadie puede reportarla ni cerrarla, y sumaría para siempre.
-- p_sin: un reporte que no se cuenta (el observado que el supervisor está corrigiendo).
-- p_hasta: solo los reportes hasta ese día (lo que llevaba cada actividad ese día);
-- con p_antes_de, de ese mismo día solo los subidos antes (la corrección de un
-- reporte de la mañana no cuenta el de la tarde, que va después).
-- Dentro de un mismo día manda el avance más alto, no el último subido: corregir
-- el reporte de la mañana lo vuelve a subir después del de la tarde.
create or replace function public.codigo_interno_actividades_estado(p_codigo text, p_sin uuid default null, p_hasta date default null,
                                                                    p_antes_de timestamptz default null)
returns table (clave text, actividad_id uuid, codigo text, area_id uuid, descripcion text, plano_id uuid,
               subcontrato_id uuid, avance numeric, ultima_fecha date, primera_fecha date, reportes integer)
language sql stable set search_path to 'public' as $$
  with fila as (
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo,
           coalesce(a.area_id, r.area_id) as area_id, t.actividad_id, t.avance, r.fecha, r.creado_en, t.orden,
           coalesce(a.descripcion, t.descripcion) as descripcion, a.plano_id, a.subcontrato_id,
           coalesce(t.actividad_id::text,
                    'texto:' || coalesce(r.area_id::text, '') || ':' || lower(regexp_replace(btrim(t.descripcion), '\s+', ' ', 'g'))) as clave
      from public.reporte_diario_trabajos t
      join public.reportes_diarios r on r.id = t.reporte_id
      left join public.codigo_actividades a on a.id = t.actividad_id
     where r.anulado_en is null and r.id is distinct from p_sin
       and (p_hasta is null or r.fecha < p_hasta or (r.fecha = p_hasta and (p_antes_de is null or r.creado_en < p_antes_de)))
       and (public.normalizar_codigo_interno(p_codigo) is null
            or public.normalizar_codigo_interno(r.codigo_interno) = public.normalizar_codigo_interno(p_codigo))
  ), ultimo as (
    select distinct on (f.codigo, f.clave) f.*
      from fila f
     order by f.codigo, f.clave, f.fecha desc, f.avance desc, f.creado_en desc, f.orden
  ), cuenta as (
    select f.codigo, f.clave, min(f.fecha) as primera, count(*)::integer as reportes from fila f group by f.codigo, f.clave
  )
  select u.clave, u.actividad_id, u.codigo, u.area_id, u.descripcion, u.plano_id, u.subcontrato_id,
         case when s.estado = 'TERMINADO' then 100 else u.avance end::numeric,
         u.fecha, c.primera, c.reportes
    from ultimo u
    join cuenta c on c.codigo = u.codigo and c.clave = u.clave
    left join public.subcontratos s on s.id = u.subcontrato_id
    left join public.codigo_planos pl on pl.id = u.plano_id
   where u.codigo is not null
     and (u.plano_id is null or pl.anulado_en is null)
     and (u.subcontrato_id is null or s.estado is distinct from 'ANULADO')
$$;
comment on function public.codigo_interno_actividades_estado(text, uuid, date, timestamptz) is
  'El último avance de cada actividad de los reportes diarios vigentes de un código (o de todos), con su área, su plano o subcontrato y cuántos reportes la llevan; sin el reporte p_sin, si se da, solo hasta el día p_hasta (y de ese día, los subidos antes de p_antes_de), si se da, y sin las de un plano anulado o un subcontrato ANULADO. Dentro de un día, el avance más alto. Los trabajos de antes, sin actividad, por su texto y su área. No pide permiso: la llaman las funciones del avance.';
revoke all on function public.codigo_interno_actividades_estado(text, uuid, date, timestamptz) from public, anon, authenticated;

-- 6. Subir el reporte, con sus actividades ----------------------------------------------------------
-- La misma función de 20261014201000, con el trabajo atado a su actividad, el
-- avance que solo sube y el reporte de solo subcontratos sin gente.
-- p_trabajos: [{"avance": 40, "personal": [...], y uno de:
--   "plano_id": "…"        el plano de su área (su actividad se abre sola la primera vez),
--   "subcontrato_id": "…"  el subcontrato de su área (igual),
--   "actividad_id": "…"    una actividad propia que ya abrió otro día,
--   "descripcion": "…"     una actividad propia nueva}]
create or replace function public.reporte_diario_insertar(
  p_id uuid, p_fecha date, p_codigo_interno text, p_asunto text, p_descripcion text,
  p_trabajos jsonb, p_personal_general jsonb, p_fotos jsonb, p_reemplaza uuid
) returns uuid language plpgsql set search_path to 'public' as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_codigo   text := upper(btrim(coalesce(p_codigo_interno, '')));
  v_norma    text := public.normalizar_codigo_interno(p_codigo_interno);
  v_asunto   text := btrim(coalesce(p_asunto, ''));
  v_desc     text := btrim(coalesce(p_descripcion, ''));
  v_general  boolean := coalesce(jsonb_typeof(p_personal_general) = 'array' and jsonb_array_length(p_personal_general) > 0, false);
  v_fotos    jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_fecha_previa date;
  v_reporte  public.reportes_diarios%rowtype;
  v_trabajo  jsonb;
  v_persona  jsonb;
  v_orden    int := 0;
  v_tid      uuid;
  v_tdesc    text;
  v_avance   numeric;
  v_ruta     text;
  v_objeto   storage.objects%rowtype;
  v_nfoto    int := 0;
  v_plano_id uuid;
  v_sub_id   uuid;
  v_act_id   uuid;
  v_plano    public.codigo_planos%rowtype;
  v_sub      public.subcontratos%rowtype;
  v_act      public.codigo_actividades%rowtype;
  v_vistas   uuid[] := '{}';
  v_solo_sub boolean := true;
  v_antes    smallint;
  v_antes_el date;
  v_despues  smallint;
  v_despues_el date;
  v_clave    text;
  -- Dónde cae este reporte entre los demás: su día y, dentro del día, cuándo se
  -- subió. La corrección va donde estaba el observado, no al final del día.
  v_ref      timestamptz := now();
  v_sub_prev boolean;
begin
  if p_reemplaza is not null then
    select fecha, creado_en into v_fecha_previa, v_ref from public.reportes_diarios where id = p_reemplaza;
    v_ref := coalesce(v_ref, now());
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'Elige el día del reporte: hoy o un día anterior.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_hoy - 7 and p_fecha is distinct from v_fecha_previa then
    raise exception 'El reporte se sube hasta 7 días después; para uno más antiguo, habla con Recursos Humanos.' using errcode = 'check_violation';
  end if;
  if char_length(v_codigo) not between 2 and 60 then
    raise exception 'Escribe el código interno (de 2 a 60 caracteres), por ejemplo PLA_SR_O4_1_26/28 o PLANTA.' using errcode = 'check_violation';
  end if;
  if char_length(v_asunto) not between 3 and 120 then
    raise exception 'Escribe el asunto del reporte (de 3 a 120 caracteres).' using errcode = 'check_violation';
  end if;
  if char_length(v_desc) not between 3 and 1000 then
    raise exception 'Escribe una breve descripción del reporte (de 3 a 1000 caracteres).' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_trabajos) is distinct from 'array' or jsonb_array_length(p_trabajos) = 0 then
    raise exception 'Anota al menos un trabajo realizado.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_trabajos) > 20 then
    raise exception 'Un reporte lleva hasta 20 trabajos.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(v_fotos) <> 'array' or jsonb_array_length(v_fotos) > 3 then
    raise exception 'Un reporte lleva hasta 3 fotos.' using errcode = 'check_violation';
  end if;

  insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, personal_general, area_id, registrado_por, reemplaza_a)
  values (p_id, p_fecha, v_codigo, v_asunto, v_desc, v_general, (select u.area_id from public.usuarios u where u.id = v_yo), v_yo, p_reemplaza)
  returning * into v_reporte;

  -- Las actividades que ya existen se toman de una vez y en orden: dos reportes
  -- a la vez con los mismos planos en distinto orden no se traban entre sí.
  perform 1 from public.codigo_actividades a
   where a.plano_id in (select (j->>'plano_id')::uuid from jsonb_array_elements(p_trabajos) j where j->>'plano_id' ~ '^[0-9a-fA-F-]{36}$')
      or a.subcontrato_id in (select (j->>'subcontrato_id')::uuid from jsonb_array_elements(p_trabajos) j where j->>'subcontrato_id' ~ '^[0-9a-fA-F-]{36}$')
      or a.id in (select (j->>'actividad_id')::uuid from jsonb_array_elements(p_trabajos) j where j->>'actividad_id' ~ '^[0-9a-fA-F-]{36}$')
   order by a.id
   for update;

  for v_trabajo in select * from jsonb_array_elements(p_trabajos) loop
    v_orden := v_orden + 1;
    begin
      v_avance := (v_trabajo->>'avance')::numeric;
    exception when others then
      v_avance := null;
    end;
    if v_avance is null or v_avance < 0 or v_avance > 100 or v_avance <> round(v_avance) then
      raise exception 'El avance del trabajo % va de 0 a 100 %%, en números enteros.', v_orden using errcode = 'check_violation';
    end if;
    begin
      v_plano_id := nullif(v_trabajo->>'plano_id', '')::uuid;
      v_sub_id := nullif(v_trabajo->>'subcontrato_id', '')::uuid;
      v_act_id := nullif(v_trabajo->>'actividad_id', '')::uuid;
    exception when others then
      raise exception 'Vuelve a elegir sobre qué es el trabajo %.', v_orden using errcode = 'check_violation';
    end;
    if num_nonnulls(v_plano_id, v_sub_id, v_act_id) > 1 then
      raise exception 'El trabajo % va sobre una sola cosa: un plano, un subcontrato o una actividad.', v_orden using errcode = 'check_violation';
    end if;

    -- La actividad del trabajo: la del plano, la del subcontrato, la que ya
    -- estaba abierta, o una nueva.
    if v_plano_id is not null then
      select * into v_plano from public.codigo_planos where id = v_plano_id;
      if not found or v_plano.anulado_en is not null then
        raise exception 'El plano del trabajo % ya no está vigente: Diseño lo anuló. Vuelve a cargar la pantalla.', v_orden
          using errcode = 'check_violation';
      end if;
      if v_plano.codigo_interno is distinct from v_norma then
        raise exception 'El plano % es del código %, no de %.', v_plano.numero, v_plano.codigo_interno, v_codigo using errcode = 'check_violation';
      end if;
      if not public.puede_hoja_de_area(v_plano.area_id) then
        raise exception 'El plano % es de %: su avance lo reporta esa área.', v_plano.numero,
          (select a.nombre from public.areas a where a.id = v_plano.area_id) using errcode = 'insufficient_privilege';
      end if;
      -- Si dos supervisores lo reportan a la vez por primera vez, el segundo usa la que abrió el primero.
      insert into public.codigo_actividades (codigo_interno, area_id, descripcion, plano_id, creado_por)
      values (v_norma, v_plano.area_id, left('Plano ' || v_plano.numero || ' · ' || v_plano.nombre, 500), v_plano_id, v_yo)
      on conflict do nothing;
      select * into v_act from public.codigo_actividades where plano_id = v_plano_id;
      v_solo_sub := false;
    elsif v_sub_id is not null then
      select * into v_sub from public.subcontratos where id = v_sub_id;
      if not found or v_sub.estado = 'ANULADO' then
        raise exception 'El subcontrato del trabajo % ya no está vigente. Vuelve a cargar la pantalla.', v_orden using errcode = 'check_violation';
      end if;
      -- El que Administración ya dio por terminado solo vuelve en la corrección
      -- del reporte que lo llevaba: Gerencia pudo observar las horas, no el subcontrato.
      if v_sub.estado = 'TERMINADO' then
        select exists (select 1 from public.reporte_diario_trabajos t
                         join public.codigo_actividades a on a.id = t.actividad_id
                        where t.reporte_id = p_reemplaza and a.subcontrato_id = v_sub_id) into v_sub_prev;
        if not v_sub_prev then
          raise exception 'El subcontrato % ya está terminado: Administración lo cerró y no se reporta más.', v_sub.numero
            using errcode = 'check_violation';
        end if;
      end if;
      if public.normalizar_codigo_interno(v_sub.codigo_interno) is distinct from v_norma then
        raise exception 'El subcontrato % es del código %, no de %.', v_sub.numero, v_sub.codigo_interno, v_codigo using errcode = 'check_violation';
      end if;
      if v_sub.area_id is null or not public.puede_hoja_de_area(v_sub.area_id) then
        raise exception 'El subcontrato % no es de tu área: su avance lo reporta el supervisor de %.', v_sub.numero,
          coalesce((select a.nombre from public.areas a where a.id = v_sub.area_id), 'su área') using errcode = 'insufficient_privilege';
      end if;
      insert into public.codigo_actividades (codigo_interno, area_id, descripcion, subcontrato_id, creado_por)
      values (v_norma, v_sub.area_id, left('Subcontrato ' || v_sub.numero || ' · ' || btrim(v_sub.descripcion), 500), v_sub_id, v_yo)
      on conflict do nothing;
      select * into v_act from public.codigo_actividades where subcontrato_id = v_sub_id;
    elsif v_act_id is not null then
      select * into v_act from public.codigo_actividades where id = v_act_id;
      if not found then
        raise exception 'La actividad del trabajo % no existe. Vuelve a cargar la pantalla.', v_orden using errcode = 'check_violation';
      end if;
      if v_act.codigo_interno is distinct from v_norma then
        raise exception 'La actividad «%» es del código %, no de %.', v_act.descripcion, v_act.codigo_interno, v_codigo
          using errcode = 'check_violation';
      end if;
      if not (v_act.creado_por = v_yo or (v_act.area_id is not null and public.puede_hoja_de_area(v_act.area_id))) then
        raise exception 'La actividad «%» es de otra área: su avance lo reporta esa área.', v_act.descripcion
          using errcode = 'insufficient_privilege';
      end if;
      -- La de un plano o un subcontrato se reporta eligiendo ese plano o subcontrato,
      -- que es donde se mira si sigue vigente.
      if v_act.plano_id is not null or v_act.subcontrato_id is not null then
        raise exception 'El trabajo % va sobre un plano o un subcontrato: elígelo como tal en «Sobre qué». Vuelve a cargar la pantalla.', v_orden
          using errcode = 'check_violation';
      end if;
      v_solo_sub := false;
    else
      v_tdesc := regexp_replace(btrim(coalesce(v_trabajo->>'descripcion', '')), '\s+', ' ', 'g');
      if char_length(v_tdesc) not between 3 and 500 then
        raise exception 'Describe el trabajo % (de 3 a 500 caracteres).', v_orden using errcode = 'check_violation';
      end if;
      -- Una actividad propia que ya está abierta con el mismo nombre se continúa, no se abre otra.
      -- PLANTA no lleva avance: su trabajo de cada día va suelto, sin actividad.
      v_clave := lower(v_tdesc);
      if v_norma <> 'PLANTA'
         and exists (select 1 from public.reporte_diario_trabajos t where t.reporte_id = p_id and lower(t.descripcion) = v_clave) then
        raise exception 'El trabajo % repite «%»: cada actividad va una sola vez en el reporte.', v_orden, v_tdesc
          using errcode = 'check_violation';
      end if;
      select a.* into v_act
        from public.codigo_actividades a
        join public.codigo_interno_actividades_estado(v_norma) e on e.actividad_id = a.id
       where a.codigo_interno = v_norma and a.area_id is not distinct from v_reporte.area_id
         and a.plano_id is null and a.subcontrato_id is null
         and lower(a.descripcion) = v_clave and e.avance < 100 and v_norma <> 'PLANTA'
       limit 1;
      if found then
        raise exception 'Ya hay una actividad abierta «%» en % (va en % %%): elígela en «Sobre qué» para sumarle el avance.',
          v_act.descripcion, v_codigo,
          (select e.avance from public.codigo_interno_actividades_estado(v_norma) e where e.actividad_id = v_act.id)
          using errcode = 'check_violation';
      end if;
      if v_norma = 'PLANTA' then
        v_act := null;
      else
        insert into public.codigo_actividades (codigo_interno, area_id, descripcion, creado_por)
        values (v_norma, v_reporte.area_id, v_tdesc, v_yo)
        returning * into v_act;
      end if;
      v_solo_sub := false;
    end if;

    if v_act.id is not null and v_act.id = any(v_vistas) then
      raise exception 'El trabajo % repite «%»: cada actividad va una sola vez en el reporte.', v_orden, v_act.descripcion
        using errcode = 'check_violation';
    end if;
    v_vistas := v_vistas || v_act.id;
    v_tdesc := coalesce(v_act.descripcion, v_tdesc);

    -- Solo hacia arriba: más que lo reportado antes, menos que lo reportado después.
    -- La fila de la actividad se toma primero: dos supervisores a la vez no se pisan el avance.
    perform 1 from public.codigo_actividades where id = v_act.id for update;
    select t.avance, r.fecha into v_antes, v_antes_el
      from public.reporte_diario_trabajos t
      join public.reportes_diarios r on r.id = t.reporte_id
     where t.actividad_id = v_act.id and r.anulado_en is null and r.id <> p_id
       and r.id is distinct from p_reemplaza and (r.fecha, r.creado_en) < (p_fecha, v_ref)
     order by t.avance desc, r.fecha desc
     limit 1;
    if found and v_avance <= v_antes then
      if v_antes >= 100 then
        raise exception '«%» ya llegó al 100 %% el %: no se reporta más.', v_tdesc, to_char(v_antes_el, 'DD/MM/YYYY')
          using errcode = 'check_violation';
      end if;
      raise exception '«%» ya iba en % %% (reporte del %): pon en cuánto va ahora, % %% o más.',
        v_tdesc, v_antes, to_char(v_antes_el, 'DD/MM/YYYY'), v_antes + 1 using errcode = 'check_violation';
    end if;
    select t.avance, r.fecha into v_despues, v_despues_el
      from public.reporte_diario_trabajos t
      join public.reportes_diarios r on r.id = t.reporte_id
     where t.actividad_id = v_act.id and r.anulado_en is null and r.id <> p_id
       and r.id is distinct from p_reemplaza and (r.fecha, r.creado_en) > (p_fecha, v_ref)
     order by t.avance, r.fecha
     limit 1;
    if found and v_avance >= v_despues then
      raise exception '«%» ya tiene % %% en un reporte posterior (del %): este tiene que quedar por debajo.',
        v_tdesc, v_despues, to_char(v_despues_el, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;

    insert into public.reporte_diario_trabajos (reporte_id, orden, descripcion, avance, actividad_id)
    values (p_id, v_orden, v_tdesc, v_avance::smallint, v_act.id)
    returning id into v_tid;

    if jsonb_typeof(coalesce(v_trabajo->'personal', '[]'::jsonb)) <> 'array' then
      raise exception 'Revisa el personal del trabajo %.', v_orden using errcode = 'check_violation';
    end if;
    if v_general and jsonb_array_length(coalesce(v_trabajo->'personal', '[]'::jsonb)) > 0 then
      raise exception 'Con personal general, la gente va una sola vez para todo el reporte, no en cada trabajo.' using errcode = 'check_violation';
    end if;
    for v_persona in select * from jsonb_array_elements(coalesce(v_trabajo->'personal', '[]'::jsonb)) loop
      perform public.reporte_diario_agregar_persona(v_reporte, v_tid, v_tdesc, v_persona);
    end loop;
  end loop;

  if v_general then
    for v_persona in select * from jsonb_array_elements(p_personal_general) loop
      perform public.reporte_diario_agregar_persona(v_reporte, null, v_asunto, v_persona);
    end loop;
  end if;

  -- El subcontratista no está en el personal: un reporte de solo subcontratos no pide horas.
  if not v_solo_sub and not exists (select 1 from public.reporte_diario_personal where reporte_id = p_id) then
    raise exception 'Pon al menos a una persona con sus horas: de ahí sale el costeo.' using errcode = 'check_violation';
  end if;

  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_nfoto := v_nfoto + 1;
    if v_ruta !~ ('^' || v_yo::text || '/' || p_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
       and not (p_reemplaza is not null
                and exists (select 1 from public.reporte_diario_fotos f where f.reporte_id = p_reemplaza and f.ruta = v_ruta)) then
      raise exception 'Vuelve a poner las fotos del reporte.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-reporte-diario' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_nfoto using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.reporte_diario_fotos f join public.reportes_diarios r on r.id = f.reporte_id
                where f.ruta = v_ruta and r.anulado_en is null) then
      raise exception 'La foto % está repetida: quítala.', v_nfoto using errcode = 'check_violation';
    end if;
    insert into public.reporte_diario_fotos (reporte_id, orden, ruta, mime_type, tamano_bytes)
    values (p_id, v_nfoto, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id,
         case when p_reemplaza is null then 'Reporte diario por validar: ' else 'Reporte corregido por validar: ' end || v_asunto,
         coalesce((select a.nombre from public.areas a where a.id = v_reporte.area_id) || ' · ', '')
           || v_codigo || ' · ' || to_char(p_fecha, 'DD/MM/YYYY'),
         '/reportes-diarios/' || p_id, 'reportes_diarios', p_id
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo and u.id is distinct from v_yo
     and (r.codigo = 'ADMIN'
          or exists (select 1 from public.roles_permisos rp
                      where rp.rol_id = u.rol_id
                        and rp.permiso_codigo in ('reporte_diario.validar_gerencia', 'reporte_diario.validar_rrhh')));

  return p_id;
end;
$$;
revoke all on function public.reporte_diario_insertar(uuid, date, text, text, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;

-- 7. Lo que el supervisor puede elegir en un código ------------------------------------------------
-- PLANO: los vigentes de sus áreas que no llegaron al 100 %, con su peso.
-- SUBCONTRATO: los vigentes de sus áreas (Producción o Acabados).
-- ACTIVIDAD: las propias abiertas de sus áreas (o que abrió él), para continuar.
-- Con el avance que llevan y la fecha de su último reporte: el formulario pide más.
-- p_corrige: el reporte observado que el supervisor corrige. Se cuenta sin él,
-- como lo hará la base al subirlo (lo anula primero); solo si es suyo y está observado.
-- p_fecha: el día del reporte. Lo que lleva cada cosa se mira a ese día, no a hoy:
-- un reporte olvidado del miércoles, o la corrección de uno observado, sigue
-- pudiendo ir sobre un plano que el viernes llegó al 100 %. tope y tope_fecha:
-- el menor avance de un día posterior, que este día no puede alcanzar.
create or replace function public.reporte_diario_opciones(p_codigo text, p_corrige uuid default null, p_fecha date default null)
returns table (tipo text, id uuid, etiqueta text, area text, avance numeric, ultima_fecha date, peso numeric,
               tope numeric, tope_fecha date)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_yo uuid := public.usuario_actual();
  v_sin uuid;
  v_ref timestamptz;
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  if v_codigo is null then
    return;
  end if;
  -- La corrección va donde estaba el observado: de su mismo día, lo subido
  -- después (el reporte de la tarde) es el tope, no lo que ya lleva.
  select r.id, r.creado_en into v_sin, v_ref from public.reportes_diarios r
   where r.id = p_corrige and r.registrado_por = v_yo and r.observado_en is not null and r.anulado_en is null;
  return query
  with estado as (
    select * from public.codigo_interno_actividades_estado(v_codigo, v_sin, p_fecha, v_ref)
  ), siguiente as (
    select distinct on (t.actividad_id) t.actividad_id, t.avance::numeric as tope, r.fecha as tope_fecha
      from public.reporte_diario_trabajos t
      join public.reportes_diarios r on r.id = t.reporte_id
     where p_fecha is not null and (r.fecha > p_fecha or (r.fecha = p_fecha and v_ref is not null and r.creado_en > v_ref))
       and r.anulado_en is null and r.id is distinct from v_sin
       and t.actividad_id is not null and public.normalizar_codigo_interno(r.codigo_interno) = v_codigo
     order by t.actividad_id, t.avance, r.fecha
  )
  select 'PLANO'::text, p.id, ('Plano ' || p.numero || ' · ' || p.nombre)::text, a.nombre::text,
         e.avance, e.ultima_fecha, p.peso, sg.tope, sg.tope_fecha
    from public.codigo_planos p
    join public.areas a on a.id = p.area_id
    left join public.codigo_actividades x on x.plano_id = p.id
    left join estado e on e.actividad_id = x.id
    left join siguiente sg on sg.actividad_id = x.id
   where p.codigo_interno = v_codigo and p.anulado_en is null and public.puede_hoja_de_area(p.area_id)
     and coalesce(e.avance, 0) < 100 and (sg.tope is null or coalesce(e.avance, -1) + 1 < sg.tope)
  union all
  -- El TERMINADO vuelve solo en la corrección del reporte que lo llevaba, con lo
  -- que de verdad se había reportado (el estado lo da por 100).
  select 'SUBCONTRATO', s.id, ('Subcontrato ' || s.numero || ' · ' || s.descripcion)::text, a.nombre::text,
         k.avance, k.ultima_fecha, null::numeric, sg.tope, sg.tope_fecha
    from public.subcontratos s
    join public.areas a on a.id = s.area_id
    left join public.codigo_actividades x on x.subcontrato_id = s.id
    left join estado e on e.actividad_id = x.id
    left join siguiente sg on sg.actividad_id = x.id
    left join lateral (
      select t.avance::numeric as avance, r.fecha as ultima_fecha
        from public.reporte_diario_trabajos t
        join public.reportes_diarios r on r.id = t.reporte_id
       where s.estado = 'TERMINADO' and t.actividad_id = x.id and r.anulado_en is null and r.id is distinct from v_sin
         and (p_fecha is null or r.fecha < p_fecha or (r.fecha = p_fecha and (v_ref is null or r.creado_en < v_ref)))
       order by t.avance desc, r.fecha desc
       limit 1
    ) real on true
    cross join lateral (
      select case when s.estado = 'TERMINADO' then real.avance else e.avance end as avance,
             case when s.estado = 'TERMINADO' then real.ultima_fecha else e.ultima_fecha end as ultima_fecha
    ) k
   where public.normalizar_codigo_interno(s.codigo_interno) = v_codigo
     and (s.estado = 'VIGENTE'
          or (s.estado = 'TERMINADO'
              and exists (select 1 from public.reporte_diario_trabajos t where t.reporte_id = v_sin and t.actividad_id = x.id)))
     and public.puede_hoja_de_area(s.area_id) and coalesce(k.avance, 0) < 100
     and (sg.tope is null or coalesce(k.avance, -1) + 1 < sg.tope)
  union all
  -- La que todavía no tenía reporte a ese día se ofrece si se abrió en el reporte
  -- que se corrige o si tiene uno después (el día olvidado va antes que ese).
  select 'ACTIVIDAD', x.id, x.descripcion, a.nombre::text, e.avance, e.ultima_fecha, null::numeric, sg.tope, sg.tope_fecha
    from public.codigo_actividades x
    left join estado e on e.actividad_id = x.id
    left join siguiente sg on sg.actividad_id = x.id
    left join public.areas a on a.id = x.area_id
   where x.codigo_interno = v_codigo and x.codigo_interno <> 'PLANTA' and x.plano_id is null and x.subcontrato_id is null
     and (e.avance < 100
          or (e.actividad_id is null
              and (sg.actividad_id is not null
                   or exists (select 1 from public.reporte_diario_trabajos t where t.reporte_id = v_sin and t.actividad_id = x.id))))
     and (sg.tope is null or coalesce(e.avance, -1) + 1 < sg.tope)
     and (x.creado_por = v_yo or (x.area_id is not null and public.puede_hoja_de_area(x.area_id)))
   order by 1, 3;
end;
$$;
comment on function public.reporte_diario_opciones(text, uuid, date) is
  'Sobre qué puede reportar el supervisor en un código: los planos vigentes y los subcontratos vigentes de su área (el terminado, solo al corregir el reporte que lo llevaba), y sus actividades propias abiertas, con el avance que llevan al día p_fecha (o hoy), su último reporte y el tope de un día posterior (sin su reporte observado p_corrige, si lo está corrigiendo). Exige reporte_diario.registrar.';
revoke all on function public.reporte_diario_opciones(text, uuid, date) from public, anon;
grant execute on function public.reporte_diario_opciones(text, uuid, date) to authenticated;

-- 8. El aporte de cada plano -------------------------------------------------------------------------
-- Cada plano vigente con peso: cuánto avanzó y cuánto aporta a la unidad. Vale
-- 100 si todas las etapas de su área en el código ya terminaron.
create or replace function public.codigo_interno_avance_planos_calculado(p_codigo text)
returns table (plano_id uuid, codigo text, numero text, nombre text, area_id uuid, area text, peso numeric,
               avance numeric, aporte numeric, por_etapa boolean, ultima_fecha date, reportes integer)
language sql stable set search_path to 'public' as $$
  with plano as (
    select p.* from public.codigo_planos p
     where p.anulado_en is null and p.peso is not null
       and (public.normalizar_codigo_interno(p_codigo) is null or p.codigo_interno = public.normalizar_codigo_interno(p_codigo))
  ), etapa_area as (
    select e.codigo_interno as codigo, e.area_id, bool_and(e.fin_real is not null) as terminada
      from public.codigo_etapas e
     where e.quitada_en is null and e.area_id is not null
     group by 1, 2
  ), estado as (
    select * from public.codigo_interno_actividades_estado(p_codigo) where plano_id is not null
  )
  select p.id, p.codigo_interno, p.numero, p.nombre, p.area_id, a.nombre::text, p.peso,
         x.avance, round(p.peso * x.avance / 100, 2), coalesce(ea.terminada, false), e.ultima_fecha, coalesce(e.reportes, 0)
    from plano p
    join public.areas a on a.id = p.area_id
    left join etapa_area ea on ea.codigo = p.codigo_interno and ea.area_id = p.area_id
    left join estado e on e.plano_id = p.id
    cross join lateral (select case when ea.terminada then 100::numeric else coalesce(e.avance, 0) end as avance) x
$$;
revoke all on function public.codigo_interno_avance_planos_calculado(text) from public, anon, authenticated;

create or replace function public.codigo_interno_avance_planos(p_codigo text)
returns table (plano_id uuid, codigo text, numero text, nombre text, area text, peso numeric,
               avance numeric, aporte numeric, por_etapa boolean, ultima_fecha date, reportes integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_todo boolean;
begin
  perform public.exigir_ver_codigos_de_diseno();
  v_todo := public.usuario_actual() is null or public.es_admin() or public.tiene_permiso('diseno.codigos')
            or public.tiene_permiso('codigos_internos.ver') or public.tiene_permiso('codigos_internos.seguimiento');
  if public.normalizar_codigo_interno(p_codigo) is null then
    return;
  end if;
  return query
  select k.plano_id, k.codigo, k.numero, k.nombre, k.area, k.peso, k.avance, k.aporte, k.por_etapa, k.ultima_fecha, k.reportes
    from public.codigo_interno_avance_planos_calculado(p_codigo) k
   where v_todo or public.puede_hoja_de_area(k.area_id)
   order by k.area, k.numero;
end;
$$;
comment on function public.codigo_interno_avance_planos(text) is
  'Los planos vigentes con peso de un código: su porcentaje de la unidad, su avance (100 si la etapa de su área terminó) y lo que aportan al avance de la unidad. El supervisor ve los de su área. Exige poder ver lo que Diseño carga por código.';
revoke all on function public.codigo_interno_avance_planos(text) from public, anon;
grant execute on function public.codigo_interno_avance_planos(text) to authenticated;

-- 9. Lo que no se repartió en planos, área por área ------------------------------------------------------
-- Cada área vale el promedio del último avance de sus actividades SIN las de un
-- plano con peso: ese plano ya aporta su parte de la unidad por su cuenta, y
-- contarlo también en su etapa lo contaría dos veces. Sin planos con peso, es
-- el promedio de todas, como hasta hoy.
create or replace function public.codigo_interno_resto_por_area_calculado(p_codigo text)
returns table (codigo text, area_id uuid, avance numeric)
language sql stable set search_path to 'public' as $$
  select a.codigo, a.area_id, round(avg(a.avance))::numeric
    from public.codigo_interno_actividades_estado(p_codigo) a
   where a.area_id is not null
     and not exists (select 1 from public.codigo_planos p
                      where p.id = a.plano_id and p.anulado_en is null and p.peso > 0)
   group by a.codigo, a.area_id
$$;
comment on function public.codigo_interno_resto_por_area_calculado(text) is
  'El avance de cada área de un código (o de todos) para la parte de la unidad que no se repartió en planos: el promedio redondeado del último avance de sus actividades, sin las de un plano con peso. No pide permiso: la llaman las funciones del avance.';
revoke all on function public.codigo_interno_resto_por_area_calculado(text) from public, anon, authenticated;

-- 10. Las etapas, contando por actividad -----------------------------------------------------------------
-- La misma de 20261015200000: el avance de la etapa que no terminó es el de su
-- área en lo que no se repartió en planos (arriba). La pestaña «Etapas» y el
-- porcentaje de la unidad leen estas mismas filas: la regla no se repite.
create or replace function public.codigo_interno_etapas(p_codigo text default null)
returns table (id uuid, codigo text, orden smallint, nombre text, area_id uuid, area text, area_codigo text,
               inicio_plan date, fin_plan date, inicio_real date, fin_real date, nota text, actualizado_en timestamptz,
               reportes integer, primer_reporte date, ultimo_reporte date, avance_reportado numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_ver_codigos_de_diseno();
  return query
  with etapa as (
    select e.* from public.codigo_etapas e
     where e.quitada_en is null and (v_codigo is null or e.codigo_interno = v_codigo)
  ), reporte as (
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, r.area_id, r.id, r.fecha, r.creado_en
      from public.reportes_diarios r
     where r.anulado_en is null and r.area_id is not null
       and (v_codigo is null or public.normalizar_codigo_interno(r.codigo_interno) = v_codigo)
  ), por_area as (
    select r.codigo, r.area_id, count(*)::integer as reportes, min(r.fecha) as primero, max(r.fecha) as ultimo
      from reporte r group by r.codigo, r.area_id
  )
  select e.id, e.codigo_interno, e.orden, e.nombre, e.area_id, a.nombre::text, a.codigo::text,
         e.inicio_plan, e.fin_plan, e.inicio_real, e.fin_real, e.nota, e.actualizado_en,
         coalesce(pa.reportes, 0), pa.primero, pa.ultimo, av.avance
    from etapa e
    left join public.areas a on a.id = e.area_id
    left join por_area pa on pa.codigo = e.codigo_interno and pa.area_id = e.area_id
    left join public.codigo_interno_resto_por_area_calculado(v_codigo) av on av.codigo = e.codigo_interno and av.area_id = e.area_id
   order by e.codigo_interno, e.orden;
end;
$$;
comment on function public.codigo_interno_etapas(text) is
  'Las etapas vigentes de un código (o de todos), con los reportes diarios de su área y su avance: el promedio del último avance de las actividades de su área que no son de un plano con peso (ese cuenta aparte en el porcentaje de la unidad).';
revoke all on function public.codigo_interno_etapas(text) from public, anon;
grant execute on function public.codigo_interno_etapas(text) to authenticated;

-- 11. El avance de cada código, en sus dos partes ---------------------------------------------------------
-- Lo repartido en planos, plano por plano; el resto, por las etapas (las mismas
-- filas de la pestaña «Etapas») o, sin etapas, por las actividades que no son de
-- un plano con peso. Una sola cuenta, que leen el porcentaje y «Cómo sale».
create or replace function public.codigo_interno_avance_calculado(p_codigo text)
returns table (codigo text, peso numeric, de_planos numeric, resto numeric, resto_por text,
               etapas integer, etapas_terminadas integer, trabajos integer, trabajos_terminados integer, ultimo_reporte date)
language sql stable set search_path to 'public' as $$
  with actividad as (
    select a.*, exists (select 1 from public.codigo_planos p
                         where p.id = a.plano_id and p.anulado_en is null and p.peso > 0) as de_plano
      from public.codigo_interno_actividades_estado(p_codigo) a
  ), etapa as (
    select e.codigo,
           count(*)::integer as etapas,
           count(*) filter (where e.fin_real is not null)::integer as terminadas,
           avg(case when e.fin_real is not null then 100 else coalesce(e.avance_reportado, 0) end) as avance
      from public.codigo_interno_etapas(p_codigo) e
     group by e.codigo
  ), trabajo as (
    select a.codigo, count(*)::integer as trabajos, count(*) filter (where a.avance >= 100)::integer as terminados,
           avg(a.avance) filter (where not a.de_plano) as avance, max(a.ultima_fecha) as ultimo
      from actividad a group by a.codigo
  ), plano as (
    select k.codigo, sum(k.peso) as peso, sum(k.peso * k.avance / 100) as aporte
      from public.codigo_interno_avance_planos_calculado(p_codigo) k
     group by k.codigo
     having sum(k.peso) > 0
  ), codigos as (
    select e.codigo from etapa e union select t.codigo from trabajo t union select p.codigo from plano p
  )
  select c.codigo, coalesce(p.peso, 0), coalesce(p.aporte, 0), coalesce(e.avance, t.avance, 0),
         case when e.codigo is not null then 'ETAPAS' else 'ACTIVIDADES' end,
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0),
         coalesce(t.trabajos, 0), coalesce(t.terminados, 0), t.ultimo
    from codigos c
    left join etapa e on e.codigo = c.codigo
    left join trabajo t on t.codigo = c.codigo
    left join plano p on p.codigo = c.codigo
   where c.codigo is not null and c.codigo <> 'PLANTA'
$$;
comment on function public.codigo_interno_avance_calculado(text) is
  'Las dos partes del avance de cada código (o de uno): el peso repartido en planos y lo que aportan, y el avance (0 a 100) de lo que no se repartió, por etapas o por actividades. No pide permiso: la llaman las funciones del avance.';
revoke all on function public.codigo_interno_avance_calculado(text) from public, anon, authenticated;

create or replace function public.codigos_internos_avance(p_codigo text default null)
returns table (codigo text, avance integer, fuente text, etapas integer, etapas_terminadas integer,
               trabajos integer, trabajos_terminados integer, ultimo_reporte date)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  select k.codigo,
         round(k.de_planos + (100 - k.peso) / 100 * k.resto)::integer,
         case when k.peso > 0 then 'PLANOS' when k.resto_por = 'ETAPAS' then 'ETAPAS' else 'REPORTES' end,
         k.etapas, k.etapas_terminadas, k.trabajos, k.trabajos_terminados, k.ultimo_reporte
    from public.codigo_interno_avance_calculado(p_codigo) k
   order by 1;
end;
$$;
comment on function public.codigos_internos_avance(text) is
  'El porcentaje de avance de cada código interno (o de uno): lo que Diseño repartió en planos, cada plano por su peso y su avance; el resto, por el promedio de sus etapas (la terminada vale 100, la que no, el promedio del último avance de cada actividad de su área que no sea de un plano con peso) o, sin etapas, por el de esas actividades. Sin PLANTA. Exige codigos_internos.ver.';
revoke all on function public.codigos_internos_avance(text) from public, anon;
grant execute on function public.codigos_internos_avance(text) to authenticated;

create or replace function public.codigo_interno_avance_partes(p_codigo text)
returns table (peso numeric, de_planos numeric, resto numeric, resto_por text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  if public.normalizar_codigo_interno(p_codigo) is null then
    return;
  end if;
  return query
  select k.peso, round(k.de_planos, 2), round(k.resto, 2), k.resto_por
    from public.codigo_interno_avance_calculado(p_codigo) k;
end;
$$;
comment on function public.codigo_interno_avance_partes(text) is
  'Cómo sale el porcentaje de un código: el peso repartido en planos, lo que aportan, y el avance (0 a 100) de lo que no se repartió, por ETAPAS o por ACTIVIDADES. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_avance_partes(text) from public, anon;
grant execute on function public.codigo_interno_avance_partes(text) to authenticated;

-- 12. Cada actividad con su historia, para Gerencia ---------------------------------------------------------
-- La lista «cada trabajo con su último avance» de un código, actividad por
-- actividad y no por el texto: el «Corte» que terminó y el nuevo que se abrió
-- con el mismo nombre son dos, y la de un plano anulado ya no aparece. cuenta
-- dice dónde entra: PLANO (aporta por su plano con %), ETAPA (al promedio de
-- su etapa) o NADA (PLANTA).
create or replace function public.codigo_interno_actividades(p_codigo text)
returns table (clave text, area text, descripcion text, tipo text, cuenta text, avance numeric,
               ultima_fecha date, reportes integer, historial jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  if v_codigo is null then
    return;
  end if;
  return query
  with estado as (
    select * from public.codigo_interno_actividades_estado(v_codigo)
  ), fila as (
    select coalesce(t.actividad_id::text,
                    'texto:' || coalesce(r.area_id::text, '') || ':' || lower(regexp_replace(btrim(t.descripcion), '\s+', ' ', 'g'))) as clave,
           r.fecha, r.creado_en, t.orden, t.avance
      from public.reporte_diario_trabajos t
      join public.reportes_diarios r on r.id = t.reporte_id
     where r.anulado_en is null and public.normalizar_codigo_interno(r.codigo_interno) = v_codigo
  )
  select e.clave, a.nombre::text, e.descripcion,
         case when e.plano_id is not null then 'PLANO' when e.subcontrato_id is not null then 'SUBCONTRATO'
              when e.actividad_id is not null then 'PROPIA' else 'TEXTO' end,
         case when v_codigo = 'PLANTA' then 'NADA'
              when exists (select 1 from public.codigo_planos p where p.id = e.plano_id and p.peso > 0) then 'PLANO'
              else 'ETAPA' end,
         e.avance, e.ultima_fecha, e.reportes,
         (select jsonb_agg(jsonb_build_object('fecha', f.fecha, 'avance', f.avance) order by f.fecha, f.creado_en, f.orden)
            from fila f where f.clave = e.clave)
    from estado e
    left join public.areas a on a.id = e.area_id
   order by e.ultima_fecha desc, e.avance, e.descripcion;
end;
$$;
comment on function public.codigo_interno_actividades(text) is
  'Cada actividad vigente de un código con su último avance (el subcontrato TERMINADO, 100), su área, dónde cuenta (PLANO, ETAPA o NADA) y sus avances reporte por reporte. Sin las de un plano anulado o un subcontrato ANULADO. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_actividades(text) from public, anon;
grant execute on function public.codigo_interno_actividades(text) to authenticated;
