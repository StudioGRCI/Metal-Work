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
--     `areas.jefe_heredado` en verdadero) cada vez que cambia la de Diseño. Se
--     asigna una sola vez y quedan cubiertas las dos. Ponerle una cuenta propia
--     a Ingeniería sigue siendo posible, en la misma pantalla de Configuración,
--     y quitársela la devuelve a la de Diseño;
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
-- hasta que el administrador la cambie o la quite, y la pantalla lo marca.
--
-- Esta migración no asigna a ninguna persona: las cuentas responsables las pone
-- DKS desde Configuración.
-- =============================================================================

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
  'Verdadero si la cuenta responsable de esta área (jefe_id) es la del área que la lleva, anotada sola. Falso si es propia o no tiene. No se escribe a mano: la deciden los disparadores. Migración 20261126998500.';

-- 2. Las reglas de la fila -------------------------------------------------------
-- Corre antes que `trg_area_responsable_activo` (por orden alfabético), que así
-- juzga también la cuenta que aquí se hereda. Sin lista de columnas: decide
-- adentro, con el valor nuevo o el que cambió.
create or replace function public.fn_area_llevada_por()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_la_lleva     public.areas%rowtype;
  v_era_heredada boolean := tg_op = 'UPDATE' and old.jefe_heredado;
  v_cambio_jefe  boolean := tg_op = 'INSERT' or new.jefe_id is distinct from old.jefe_id;
  v_cambio_quien boolean := tg_op = 'INSERT' or new.llevada_por_id is distinct from old.llevada_por_id;
begin
  -- Quién la lleva: ni ella misma, ni una dada de baja, ni en cadena.
  if new.llevada_por_id is not null and v_cambio_quien then
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

  -- Lo que escribe el área que la lleva al repartir su cuenta pasa tal cual.
  if coalesce(current_setting('metalwork.reparte_responsable', true), '') = '1' then
    return new;
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

  -- Nada de esto cambió: la marca queda como estaba, no se escribe a mano.
  if not v_cambio_jefe and not v_cambio_quien then
    new.jefe_heredado := old.jefe_heredado;
    return new;
  end if;

  -- Le pusieron una cuenta: es propia.
  if v_cambio_jefe and new.jefe_id is not null then
    new.jefe_heredado := false;
    return new;
  end if;

  -- Cambió quién la lleva y tenía una propia: la conserva.
  if not v_cambio_jefe and new.jefe_id is not null and not v_era_heredada then
    new.jefe_heredado := false;
    return new;
  end if;

  -- Quedó sin cuenta propia (se la quitaron, nunca tuvo, o la heredada era de
  -- otra área): la del área que la lleva, si tiene una activa.
  new.jefe_id := (select a.jefe_id
                    from public.areas a
                    join public.usuarios u on u.id = a.jefe_id and u.activo
                   where a.id = new.llevada_por_id and a.activo);
  new.jefe_heredado := new.jefe_id is not null;
  return new;
end $$;

comment on function public.fn_area_llevada_por() is
  'Un área no se lleva a sí misma ni en cadena, y la que es llevada por otra y no tiene cuenta responsable propia recibe la de esa (jefe_heredado). Migración 20261126998500.';

revoke all on function public.fn_area_llevada_por() from public, anon, authenticated;

create or replace trigger trg_area_llevada_por
  before insert or update on public.areas
  for each row execute function public.fn_area_llevada_por();

-- 3. El área que lleva a otras reparte su cuenta ----------------------------------
-- Cuando cambia su cuenta responsable (o se da de baja el área), las que lleva
-- y no tienen una propia reciben la nueva, o quedan sin ninguna. Corre con el
-- permiso de quien cambió la fila: la política de `areas` es la misma para las
-- dos, y el cambio queda en la auditoría a su nombre.
create or replace function public.fn_area_reparte_su_responsable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_cuenta uuid;
begin
  if coalesce(current_setting('metalwork.reparte_responsable', true), '') = '1' then
    return null;
  end if;
  if new.jefe_id is not distinct from old.jefe_id and new.activo is not distinct from old.activo then
    return null;
  end if;
  if not exists (select 1 from public.areas c where c.llevada_por_id = new.id) then
    return null;
  end if;
  if new.activo then
    select u.id into v_cuenta from public.usuarios u where u.id = new.jefe_id and u.activo;
  end if;
  perform set_config('metalwork.reparte_responsable', '1', true);
  update public.areas c
     set jefe_id = v_cuenta,
         jefe_heredado = v_cuenta is not null
   where c.llevada_por_id = new.id
     and (c.jefe_heredado or c.jefe_id is null)
     and c.jefe_id is distinct from v_cuenta;
  perform set_config('metalwork.reparte_responsable', '', true);
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
