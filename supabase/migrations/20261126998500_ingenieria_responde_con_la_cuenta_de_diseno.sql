-- =============================================================================
-- INGENIERÍA RESPONDE CON LA CUENTA DE DISEÑO
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-26, «Plan aparte. Las demás áreas», entrega A.4: «Ingeniería:
-- enlaza el responsable del área; no partas el puesto de Diseño e ingeniería».
-- Aprobó la propuesta el mismo día («Sí, con tus recomendaciones»).
--
-- Cómo estaba. El organigrama («CODIFICACION DE AREAS.xlsx», sección 3 de
-- docs/ANALISIS-ONEDRIVE.md) tiene dos áreas, Ingeniería (ING) y Diseño (DIS),
-- y en Ingeniería nombra a los «Ingenieros de diseño»: es la misma gente. En el
-- sistema es un solo puesto, «Diseño e ingeniería», y sus cuentas son del área
-- Diseño. Lo de Ingeniería ya lo lleva ese puesto: el informe semanal
-- (MW-IF-DI-01, «Área de Ingeniería»), la evaluación del personal y el
-- cumplimiento de las áreas. Pero el área Ingeniería no tiene ninguna cuenta:
-- el 2026-11-26, en producción, cero cuentas y sin responsable. Lo que se le
-- avise «al área de Ingeniería» (`responsable_del_area('ING')`, entrega A.0) no
-- le llegaba a nadie.
--
-- Desde aquí:
--
--   * un área puede decir qué otra área la lleva (`areas.llevada_por_id`).
--     Ingeniería la lleva Diseño. No se crea puesto ni cuenta, y ninguna cuenta
--     cambia de área;
--   * mientras Ingeniería no tenga cuenta responsable propia, la suya es la de
--     Diseño: se anota sola en su fila (`areas.jefe_id`, con
--     `areas.jefe_heredado` en verdadero) y es siempre la misma que tiene
--     Diseño, cambie cuando cambie. Se asigna una sola vez y quedan cubiertas
--     las dos. Ponerle una cuenta propia a Ingeniería sigue siendo posible, en
--     la misma pantalla de Configuración (aunque sea la misma de Diseño: deja
--     de seguirla), y quitársela la devuelve a la de Diseño;
--   * un área no se lleva a sí misma, y no hay cadenas: la que lleva a otra no
--     puede ser llevada. Así «quién responde» se lee de un vistazo.
--
-- Por qué se anota en la fila y no se calcula al leer. El responsable de un
-- área lo leen de `areas.jefe_id` quince funciones de cuatro módulos: no solo
-- `responsable_del_area`, que avisa, sino las que dicen quién puede abrir lo
-- avisado (`calidad_es_del_area`, `averias_visibles`, `averias_areas_de_la_cuenta`,
-- `averias_puede_confirmar`…). Si solo el aviso supiera de la herencia, a la
-- cuenta de Diseño le llegaría el aviso de una inspección o de una avería del
-- área Ingeniería y no podría abrirlo. Con la cuenta anotada en la fila, todas
-- leen lo mismo que ya leían y ninguna se reescribe.
--
-- Lo que NO cambia: qué ve cada cuenta por su área. Las listas «de tu área»
-- (requerimientos, SSOMA) siguen yendo por el área de la cuenta, que es Diseño.
-- Hoy ninguna fila de esas tablas es del área Ingeniería. Y si la cuenta propia
-- de Ingeniería se da de baja, pasa lo que en cualquier área: nadie responde
-- hasta que el administrador la cambie o la quite, y la pantalla lo marca. Si
-- la que se da de baja es la de Diseño, Ingeniería la conserva igual que
-- Diseño (las dos filas lo marcan) y vuelve a responder cuando vuelve de alta.
--
-- Esta migración no asigna a ninguna persona: las cuentas responsables las pone
-- DKS desde Configuración.
-- =============================================================================

-- 0. Lo que esta migración reescribe es lo que el repositorio conoce ------------
-- `fn_area_responsable_activo()` ya existe (20261125205000). Vale su huella de
-- antes y la de esta migración (volver a correrla). Si alguien la cambió a
-- mano, se detiene sin tocar nada.
do $$
declare
  v_huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_huella
    from pg_proc p where p.oid = to_regprocedure('public.fn_area_responsable_activo()');
  if v_huella is null then
    raise exception 'Falta public.fn_area_responsable_activo(): esta base no tiene los responsables de área (20261125205000).';
  end if;
  if v_huella not in ('89f4572cb124d6754a43b71872788954', '43cf4b2de5c08fdb0abee7f5c0797180') then
    raise exception 'public.fn_area_responsable_activo() no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v_huella;
  end if;
end $$;

-- 1. Qué área la lleva, y si su cuenta es heredada ------------------------------
-- Sin índice para la llave: (a) ninguno empieza por esta columna, (b) ninguna
-- pantalla filtra por ella y (c) un área no se borra en ningún flujo. Son 22
-- filas.
alter table public.areas
  add column if not exists llevada_por_id uuid references public.areas (id) on delete set null;
alter table public.areas
  add column if not exists jefe_heredado boolean not null default false;

comment on column public.areas.llevada_por_id is
  'El área cuyo puesto lleva también esta (a Ingeniería la lleva Diseño: es el puesto de Diseño e ingeniería). Mientras esta no tenga cuenta responsable propia, se le anota la de aquella. Migración 20261126998500.';
comment on column public.areas.jefe_heredado is
  'Verdadero si la cuenta responsable de esta área (jefe_id) es la del área que la lleva, anotada sola: siempre la misma que tiene esa. Falso si es propia o no tiene. Escrita a mano solo se acepta si es verdad; quien guarda una cuenta propia manda falso. Migración 20261126998500.';

-- 2. Las reglas de la fila -------------------------------------------------------
-- Una sola regla dice si la cuenta es heredada: la fila es de un área que otra
-- lleva, y su cuenta es la misma que tiene esa otra. Lo que llega escrito se
-- acepta solo si es verdad; lo demás se decide aquí. Por eso el reparto del
-- área que la lleva (sección 3) no necesita ningún permiso especial: escribe
-- lo que esta función habría decidido.
--
-- Corre antes que `trg_area_responsable_activo` (por orden alfabético), que así
-- ya recibe la marca decidida. Sin lista de columnas: decide adentro, con el
-- valor nuevo o el que cambió.
create or replace function public.fn_area_llevada_por()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_la_lleva     public.areas%rowtype;
  v_de_ella      uuid;
  v_era_heredada boolean := false;
  v_cambio_jefe  boolean := true;
  v_cambio_quien boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_era_heredada := old.jefe_heredado;
    v_cambio_jefe  := new.jefe_id is distinct from old.jefe_id;
    v_cambio_quien := new.llevada_por_id is distinct from old.llevada_por_id;
  end if;

  -- A la que nadie lleva no se le hereda nada. Si dejó de ser llevada, la
  -- cuenta heredada no era suya y se va con eso.
  if new.llevada_por_id is null then
    if v_era_heredada and not v_cambio_jefe then
      new.jefe_id := null;
    end if;
    new.jefe_heredado := false;
    return new;
  end if;

  -- Quién la lleva: ni ella misma, ni una dada de baja, ni en cadena.
  if v_cambio_quien then
    if new.llevada_por_id = new.id then
      raise exception '% no se puede llevar a sí misma: elige el área que tiene el puesto.', new.nombre
        using errcode = 'check_violation';
    end if;
    select * into v_la_lleva from public.areas a where a.id = new.llevada_por_id;
    if not found or not v_la_lleva.activo then
      raise exception 'El área elegida para llevar % no existe o está dada de baja.', new.nombre
        using errcode = 'check_violation';
    end if;
    if v_la_lleva.llevada_por_id is not null then
      raise exception 'A % ya la lleva otra área: elige la que tiene el puesto, no una intermedia.', v_la_lleva.nombre
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.areas a where a.llevada_por_id = new.id) then
      raise exception '% ya lleva a otra área: no puede, a la vez, ser llevada por otra.', new.nombre
        using errcode = 'check_violation';
    end if;
  end if;

  -- La cuenta del área que la lleva, tal cual la tiene (activa o no: lo juzga
  -- quien la lee, igual que la de ella). Un área dada de baja no reparte la suya.
  -- Con la fila de esa área sujeta (`for share`): si alguien le está cambiando
  -- la cuenta en este instante, se espera a que termine en vez de copiar la de
  -- antes y dejar esta fila desfasada sin que nada avise.
  select a.jefe_id into v_de_ella from public.areas a where a.id = new.llevada_por_id and a.activo for share;

  -- Sin cuenta propia (se la quitaron o nunca tuvo): la del área que la lleva.
  if new.jefe_id is null then
    new.jefe_id := v_de_ella;
    new.jefe_heredado := v_de_ella is not null;
    return new;
  end if;

  if new.jefe_heredado then
    -- Dice heredada y es verdad: es la misma del área que la lleva.
    if new.jefe_id is not distinct from v_de_ella then
      return new;
    end if;
    -- Tenía la heredada y nadie le tocó la cuenta (cambió quién la lleva, o
    -- la de esa área): se pone al día.
    if v_era_heredada and not v_cambio_jefe then
      new.jefe_id := v_de_ella;
      new.jefe_heredado := v_de_ella is not null;
      return new;
    end if;
  end if;

  -- Le pusieron una cuenta, o ya tenía una propia: es propia. También si es la
  -- misma del área que la lleva y quien la guarda dice que es propia
  -- (`jefe_heredado = false`, como hace la pantalla): deja de seguirla.
  new.jefe_heredado := false;
  return new;
end $$;

comment on function public.fn_area_llevada_por() is
  'Un área no se lleva a sí misma ni en cadena. La que es llevada por otra y no tiene cuenta responsable propia recibe la de esa (jefe_heredado), que solo es verdadero si las dos cuentas son la misma. Migración 20261126998500.';

revoke all on function public.fn_area_llevada_por() from public, anon, authenticated;

create or replace trigger trg_area_llevada_por
  before insert or update on public.areas
  for each row execute function public.fn_area_llevada_por();

-- La heredada no se juzga al anotarla: es la del área que la lleva, que se
-- juzgó cuando se la asignaron a ella. Si esa cuenta se dio de baja después,
-- las dos filas la conservan y la pantalla lo marca en las dos. El resto de la
-- función es el de la 20261125205000.
create or replace function public.fn_area_responsable_activo()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.jefe_id is null then
    return new;
  end if;
  -- `trg_area_llevada_por` corre antes y solo deja la marca si la cuenta es la
  -- misma del área que la lleva.
  if new.jefe_heredado then
    return new;
  end if;
  -- La que no cambió no se vuelve a juzgar. Sí la que deja de ser heredada
  -- para ser propia: es elegirla, aunque sea la misma cuenta.
  if tg_op = 'UPDATE' and new.jefe_id is not distinct from old.jefe_id
     and new.jefe_heredado is not distinct from old.jefe_heredado then
    return new;
  end if;
  if not exists (select 1 from public.usuarios u where u.id = new.jefe_id and u.activo) then
    raise exception 'La cuenta elegida para % está dada de baja o ya no existe: el responsable de un área tiene que ser una cuenta activa.',
      new.nombre using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function public.fn_area_responsable_activo() is
  'La cuenta responsable de un área tiene que estar activa al asignarla. La heredada del área que la lleva no se juzga aquí. Migraciones 20261125205000 y 20261126998500.';

revoke all on function public.fn_area_responsable_activo() from public, anon, authenticated;

-- 3. El área que lleva a otras reparte su cuenta ----------------------------------
-- Cuando cambia su cuenta responsable (o el área se da de baja o de alta), las
-- que lleva y no tienen una propia reciben la misma, o quedan sin ninguna.
-- Corre con el permiso de quien cambió la fila: la política de `areas` es la
-- misma para las dos, y el cambio queda en la auditoría a su nombre. Si alguna
-- no se pudo poner al día, se detiene: una fila desfasada no avisaría a nadie.
create or replace function public.fn_area_reparte_su_responsable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_cuenta uuid := case when new.activo then new.jefe_id end;
  v_falta  text;
begin
  if new.jefe_id is not distinct from old.jefe_id and new.activo is not distinct from old.activo then
    return null;
  end if;
  update public.areas c
     set jefe_id = v_cuenta,
         jefe_heredado = v_cuenta is not null
   where c.llevada_por_id = new.id
     and (c.jefe_heredado or c.jefe_id is null)
     and c.jefe_id is distinct from v_cuenta;
  select string_agg(c.nombre, ', ') into v_falta
    from public.areas c
   where c.llevada_por_id = new.id
     and (c.jefe_heredado or c.jefe_id is null)
     and c.jefe_id is distinct from v_cuenta;
  if v_falta is not null then
    raise exception 'No se pudo anotar la cuenta de % en %, que lleva: no se guardó el cambio. Vuelve a intentarlo.', new.nombre, v_falta;
  end if;
  return null;
end $$;

comment on function public.fn_area_reparte_su_responsable() is
  'Al cambiar la cuenta responsable de un área que lleva a otras, se la anota a las que no tienen una propia. Migración 20261126998500.';

revoke all on function public.fn_area_reparte_su_responsable() from public, anon, authenticated;

create or replace trigger trg_area_reparte_su_responsable
  after update on public.areas
  for each row execute function public.fn_area_reparte_su_responsable();

-- 4. A Ingeniería la lleva Diseño ------------------------------------------------
-- Solo si todavía no la lleva nadie: si alguien ya le puso otra, se respeta. Si
-- Diseño ya tiene cuenta responsable e Ingeniería no, el disparador se la anota.
do $$
declare
  v_dis uuid := (select id from public.areas where codigo = 'DIS' and activo);
begin
  if v_dis is null then
    raise notice 'No hay un área Diseño (DIS) activa: Ingeniería queda sin quién la lleve.';
    return;
  end if;
  update public.areas
     set llevada_por_id = v_dis
   where codigo = 'ING'
     and llevada_por_id is null;
end $$;

comment on function public.responsable_del_area(text) is
  'La cuenta responsable y activa del área con ese código («CAL», «MNT»), o null si el área no tiene responsable o su cuenta se dio de baja. Para un área que otra lleva (Ingeniería, que la lleva Diseño) es la de esa mientras no tenga una propia: va anotada en su fila (20261126998500). Es a quien se le avisa lo que va «al área». Migración 20261125205000.';
