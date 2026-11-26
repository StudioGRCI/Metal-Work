-- =============================================================================
-- LA OS EN DÓLARES TOMA EL TIPO DE CAMBIO DE SU FACTURA
-- =============================================================================
-- La detracción de una orden de servicio en dólares se calcula sobre su monto
-- en soles, y ese monto salía del tipo de cambio del día en que Logística emitió
-- la OS. La factura del proveedor llega días después, con otra fecha, y la
-- detracción que Contabilidad deposita va con el cambio de la fecha de la
-- factura. El 2026-11-26 DKS decidió: «Cuando la OS tenga su factura, el monto
-- en soles y la detracción se recalculan con el cambio de la fecha de esa
-- factura».
--
-- Qué cambia:
--
--   1. La factura de una OS guarda su fecha de emisión. La de una OS en dólares
--      la exige: sin ella no se sabe qué cambio le toca.
--   2. La OS guarda el día de su tipo de cambio (`fecha_cambio`): el de su
--      factura vigente. Vacío es «el día en que se emitió», como hasta hoy.
--   3. Al adjuntar la factura, la OS toma el cambio que le toca a ese día: el
--      último registrado hasta ese día, de no más de diez días antes (el fin de
--      semana no tiene cambio propio). Si no hay ninguno, queda sin monto en
--      soles y Tesorería ve de qué día falta: no se paga una detracción con el
--      cambio equivocado. Al registrarlo Contabilidad, se completa sola (ya lo
--      hacía la 20261126626000).
--   4. La factura suele llegar el mismo día, antes de que Contabilidad registre
--      el cambio de ese día, y la OS toma el de la víspera. Cuando el cambio del
--      día se registra, la OS lo toma: si no, se quedaba con el de ayer y la
--      pantalla decía «el de la fecha de su factura» (auditoría del 2026-11-26).
--   5. Si la factura se anula, la OS vuelve al cambio de la que quede o al del
--      día en que se emitió (el último registrado hasta ese día, como al emitir).
--   6. Lo depositado, depositado está: la OS con su detracción ya depositada, o
--      ya pagada del todo, no se mueve. Si ese pago se anula, toma el cambio de
--      su factura, también el que se registró o se corrigió mientras tanto. Un
--      adelanto al proveedor no detiene a la OS con factura: la detracción
--      todavía no se depositó y tiene que salir con el cambio de la factura. La
--      OS sin factura sigue con la regla de antes (20261126626000): con cualquier
--      pago vigente, corregir el cambio del día en que se emitió no la mueve.
--   7. La pantalla dice de qué día es el cambio de la OS y por qué. Esa cuenta
--      la hace la base (`cambio_de_los_servicios`), con las mismas reglas, y la
--      pantalla solo la lee.
--
-- Las funciones que ya existían se cambian buscando su texto exacto: si otra
-- migración las cambió, se detiene y pide revisarlas a mano. Idempotente y sin
-- DROP.

-- 1. Las columnas -------------------------------------------------------------

alter table public.documentos_orden_servicio add column if not exists fecha_emision date;
comment on column public.documentos_orden_servicio.fecha_emision is
  'La fecha de emisión que dice la factura. La de la factura vigente de una OS en dólares decide su tipo de cambio (20261126947000).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_documento_servicio_fecha_emision') then
    alter table public.documentos_orden_servicio
      add constraint ck_documento_servicio_fecha_emision
      check (fecha_emision is null or tipo = 'FACTURA');
  end if;
end $$;

alter table public.ordenes_servicio add column if not exists fecha_cambio date;
comment on column public.ordenes_servicio.fecha_cambio is
  'El día cuyo tipo de cambio le toca a la OS en otra moneda: la fecha de emisión de su factura vigente. Vacío: el día en que se emitió la OS. Lo pone la base al adjuntar o anular la factura (20261126947000).';

-- 2. Las guardas dejan pasar el día del cambio ---------------------------------
-- Las dos guardas de la OS ya dejaban que la base pusiera el monto en soles con
-- la marca `metalwork.completando_monto_pen`. Ahora, con la misma marca, dejan
-- poner también el día del cambio, y dejar el monto vacío cuando ese día no
-- tiene cambio registrado.

do $$
declare
  v_funcion text;
  v_def     text;
  c_viejo_1 constant text := $v$     and new.monto_pen is not null
$v$;
  c_nuevo_1 constant text := $v$     and (new.monto_pen is not null or new.fecha_cambio is not null or old.fecha_cambio is not null)
$v$;
  c_viejo_2 constant text := $v$array['monto_pen', 'total_con_igv_pen', 'detraccion_monto', 'actualizado_en']$v$;
  c_nuevo_2 constant text := $v$array['monto_pen', 'total_con_igv_pen', 'detraccion_monto', 'fecha_cambio', 'actualizado_en']$v$;
begin
  foreach v_funcion in array array['public.fn_os_guardia()', 'public.fn_servicio_no_es_de_administracion()'] loop
    select replace(pg_get_functiondef(v_funcion::regprocedure), E'\r', '') into v_def;
    if position(c_nuevo_1 in v_def) > 0 and position(c_nuevo_2 in v_def) > 0
       and position(c_viejo_1 in v_def) = 0 and position(c_viejo_2 in v_def) = 0 then
      continue;
    end if;
    if (length(v_def) - length(replace(v_def, c_viejo_1, ''))) <> length(c_viejo_1)
       or (length(v_def) - length(replace(v_def, c_viejo_2, ''))) <> 2 * length(c_viejo_2) then
      raise exception '% ya no tiene la guarda del monto en soles que esta migración cambia: revísala a mano.', v_funcion;
    end if;
    execute replace(replace(v_def, c_viejo_1, c_nuevo_1), c_viejo_2, c_nuevo_2);
  end loop;
end $$;

-- 3. La OS toma el cambio de su factura -----------------------------------------

-- La OS cuyo monto en soles ya no se mueve: tiene vigente el depósito de su
-- detracción o el pago que la canceló. No escribe nada: corre con quien la
-- llama, que son siempre las funciones de esta migración.
create or replace function public.servicio_con_el_cambio_fijo(p_orden_servicio uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (select 1 from public.pagos_orden_servicio p
                  where p.orden_servicio_id = p_orden_servicio
                    and p.anulado_en is null
                    and (p.destino = 'DETRACCION' or p.cancela));
$$;

revoke all on function public.servicio_con_el_cambio_fijo(uuid) from public, anon, authenticated;

comment on function public.servicio_con_el_cambio_fijo(uuid) is
  'Si la OS tiene vigente el depósito de su detracción o el pago que la canceló: su monto en soles ya no cambia con la fecha de su factura. Ayudante interno (20261126947000).';

create or replace function public.cambio_de_la_factura_de_servicio(p_orden_servicio uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_os    public.ordenes_servicio%rowtype;
  v_fecha date;
  v_tc    numeric;
begin
  select * into v_os from public.ordenes_servicio where id = p_orden_servicio for update;
  if not found or v_os.moneda = 'PEN' or v_os.monto is null
     or v_os.estado = 'ANULADA' or v_os.aprobacion = 'RECHAZADA' then
    return;
  end if;
  -- Lo depositado, depositado está: con la detracción en el Banco de la Nación, o
  -- con el pago que la canceló, no se mueve; si ese pago se anula, se vuelve a
  -- mirar. Un adelanto al proveedor no la detiene.
  if public.servicio_con_el_cambio_fijo(p_orden_servicio) then
    return;
  end if;
  -- La factura vigente que dice su fecha; si hay más de una, la última que se adjuntó.
  select d.fecha_emision into v_fecha
    from public.documentos_orden_servicio d
   where d.orden_servicio_id = p_orden_servicio
     and d.anulado_en is null
     and d.tipo = 'FACTURA'
     and d.fecha_emision is not null
   order by d.creado_en desc, d.id desc
   limit 1;
  -- Ya va con el día de esa factura y con el cambio que le toca: nada que hacer.
  -- Si el cambio de ese día se registró o se corrigió mientras estaba fija (la
  -- detracción depositada), al anularse ese pago se pone al día.
  if v_fecha is not distinct from v_os.fecha_cambio
     and (v_fecha is null
          or v_os.monto_pen is not distinct from round(v_os.monto * public.cambio_del_dia(v_fecha, 'VENTA'), 2)) then
    return;
  end if;
  -- Si a ese día no le toca ningún cambio registrado, queda sin monto en soles:
  -- se completa al registrarlo. Sin factura vuelve al del día en que se emitió,
  -- que es el último registrado hasta ese día, sin tope: así nació
  -- (`emitir_orden_servicio`), y con el tope de diez días quedaba vacía la que
  -- se emitió con un cambio más viejo.
  if v_fecha is null then
    v_tc := public.tipo_cambio_venta(public.fecha_de_lima(v_os.creado_en));
  else
    v_tc := public.cambio_del_dia(v_fecha, 'VENTA');
  end if;
  perform set_config('metalwork.completando_monto_pen', 'si', true);
  update public.ordenes_servicio
     set fecha_cambio = v_fecha,
         monto_pen = round(monto * v_tc, 2)
   where id = p_orden_servicio;
  perform set_config('metalwork.completando_monto_pen', '', true);
end;
$$;

revoke all on function public.cambio_de_la_factura_de_servicio(uuid) from public, anon, authenticated;

comment on function public.cambio_de_la_factura_de_servicio(uuid) is
  'Pone en la OS en otra moneda el día de su tipo de cambio (la fecha de su factura vigente; sin factura, el día en que se emitió) y su monto en soles con el cambio de ese día. No toca la que tiene depositada su detracción o ya se canceló, la anulada ni la rechazada. La llaman los disparadores de los documentos y del pago anulado; nadie más (20261126947000).';

create or replace function public.fn_documento_servicio_aplica_cambio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.tipo = 'FACTURA' then
    perform public.cambio_de_la_factura_de_servicio(new.orden_servicio_id);
  end if;
  return null;
end;
$$;

revoke all on function public.fn_documento_servicio_aplica_cambio() from public, anon, authenticated;

create or replace trigger trg_documento_servicio_aplica_cambio
  after insert or update of anulado_en on public.documentos_orden_servicio
  for each row execute function public.fn_documento_servicio_aplica_cambio();

-- 4. Adjuntar con la fecha de emisión ------------------------------------------
-- La función nueva sale de la que ya está en la base, con la fecha de más: así
-- lleva lo que otra migración le haya agregado. La de antes queda para la
-- pestaña que no se recargó, y pide recargar si lo que adjunta es la factura de
-- una OS en dólares.

do $$
declare
  v_def text;
  c_firma_vieja constant text := $v$adjuntar_documento_servicio(p_id uuid, p_orden_servicio uuid, p_tipo text, p_numero text, p_nombre text, p_ruta text)$v$;
  c_firma_nueva constant text := $v$adjuntar_documento_servicio(p_id uuid, p_orden_servicio uuid, p_tipo text, p_numero text, p_nombre text, p_ruta text, p_fecha_emision date)$v$;
  c_antes constant text := $v$  if p_tipo in ('FACTURA', 'BOLETA', 'RECIBO') then
    v_num := public.normalizar_numero_factura(p_numero);
$v$;
  c_fecha constant text := $v$  if p_fecha_emision is not null and p_tipo <> 'FACTURA' then
    raise exception 'La fecha de emisión va solo con la factura.' using errcode = 'check_violation';
  end if;
  if p_fecha_emision > public.fecha_de_lima(now()) then
    raise exception 'La fecha de emisión de la factura no puede ser de un día que todavía no llega.' using errcode = 'check_violation';
  end if;
  if p_fecha_emision < public.fecha_de_lima(v_os.creado_en) - 365 then
    raise exception 'La fecha de emisión de la factura es de más de un año antes de la %: revísala.', v_os.numero using errcode = 'check_violation';
  end if;
  if p_tipo = 'FACTURA' and v_os.moneda <> 'PEN' and p_fecha_emision is null then
    raise exception 'Escribe la fecha de emisión de la factura: la % está en otra moneda y toma el tipo de cambio de ese día.', v_os.numero
      using errcode = 'check_violation';
  end if;
$v$;
  -- El mismo envío repetido se reconoce también por su fecha: con otra, no es el mismo.
  c_repetido_viejo constant text := $v$               where id = p_id and ruta_storage = p_ruta and subido_por = public.usuario_actual()) then$v$;
  c_repetido_nuevo constant text := $v$               where id = p_id and ruta_storage = p_ruta and subido_por = public.usuario_actual()
                 and (p_fecha_emision is null or fecha_emision is not distinct from p_fecha_emision)) then$v$;
  c_insert_viejo constant text := $v$                                                mime_type, tamano_bytes, subido_por)
  values (p_id, p_orden_servicio, p_tipo, v_num, v_nombre, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);$v$;
  c_insert_nuevo constant text := $v$                                                mime_type, tamano_bytes, subido_por, fecha_emision)
  values (p_id, p_orden_servicio, p_tipo, v_num, v_nombre, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo, p_fecha_emision);$v$;
begin
  if to_regprocedure('public.adjuntar_documento_servicio(uuid,uuid,text,text,text,text,date)') is null then
    select replace(pg_get_functiondef('public.adjuntar_documento_servicio(uuid,uuid,text,text,text,text)'::regprocedure), E'\r', '')
      into v_def;
    if (length(v_def) - length(replace(v_def, c_firma_vieja, ''))) <> length(c_firma_vieja)
       or (length(v_def) - length(replace(v_def, c_antes, ''))) <> length(c_antes)
       or (length(v_def) - length(replace(v_def, c_repetido_viejo, ''))) <> length(c_repetido_viejo)
       or (length(v_def) - length(replace(v_def, c_insert_viejo, ''))) <> length(c_insert_viejo) then
      raise exception 'adjuntar_documento_servicio ya no tiene el texto que esta migración cambia: revísala a mano.';
    end if;
    v_def := replace(v_def, c_firma_vieja, c_firma_nueva);
    v_def := replace(v_def, c_antes, c_fecha || c_antes);
    v_def := replace(v_def, c_repetido_viejo, c_repetido_nuevo);
    v_def := replace(v_def, c_insert_viejo, c_insert_nuevo);
    execute v_def;
  end if;
end $$;

revoke all on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text, date) from public, anon;
grant execute on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text, date) to authenticated;

comment on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text, date) is
  'Anota un documento de la OS ya subido a Storage, con la fecha de emisión de su factura. La factura de una OS en otra moneda la exige: con ella la OS toma el tipo de cambio de ese día (20261126947000). Mismo permiso que antes: puede_adjuntar_documento_servicio().';

create or replace function public.adjuntar_documento_servicio(
  p_id uuid, p_orden_servicio uuid, p_tipo text, p_numero text, p_nombre text, p_ruta text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- La pestaña que no se recargó no tiene dónde escribir la fecha. El mismo
  -- envío repetido de un documento que ya entró sigue contestando su id.
  if p_tipo = 'FACTURA'
     and not exists (select 1 from public.documentos_orden_servicio where id = p_id)
     and exists (select 1 from public.ordenes_servicio s where s.id = p_orden_servicio and s.moneda <> 'PEN')
     and public.puede_adjuntar_documento_servicio() then
    raise exception 'La factura de una orden en otra moneda lleva su fecha de emisión: recarga la pantalla para escribirla.'
      using errcode = 'check_violation';
  end if;
  return public.adjuntar_documento_servicio(p_id, p_orden_servicio, p_tipo, p_numero, p_nombre, p_ruta, null::date);
end;
$$;

revoke all on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text) to authenticated;

-- 5. El cambio que se registra o se corrige mira el día que le toca a la OS -----
-- `completar_monto_pen_de_servicios`, `recalcular_monto_pen_de_servicios` y el
-- pago anulado (20261126945000) miraban el día en que se emitió. Ahora miran el
-- de la factura si la OS lo tiene. El pago anulado, además, le da a la OS el
-- cambio de la factura que se adjuntó mientras tenía su detracción depositada.

do $$
declare
  v_cambio record;
  v_def    text;
  v_veces  integer;
begin
  for v_cambio in
    select * from (values
      ('public.completar_monto_pen_de_servicios()', 1,
       $v$public.cambio_del_dia(public.fecha_de_lima(o.creado_en), 'VENTA') as tc$v$,
       $v$public.cambio_del_dia(coalesce(o.fecha_cambio, public.fecha_de_lima(o.creado_en)), 'VENTA') as tc$v$),
      ('public.recalcular_monto_pen_de_servicios(date,numeric,numeric)', 3,
       $v$public.fecha_de_lima(s.creado_en)$v$,
       $v$coalesce(s.fecha_cambio, public.fecha_de_lima(s.creado_en))$v$),
      ('public.fn_pago_anulado_recalcula_servicio()', 2,
       $v$public.fecha_de_lima(o.creado_en)$v$,
       $v$coalesce(o.fecha_cambio, public.fecha_de_lima(o.creado_en))$v$),
      ('public.fn_pago_anulado_recalcula_servicio()', 1,
       $v$ and p.anulado_en is null) then
    return null;$v$,
       $v$ and p.anulado_en is null) then
    -- Le queda otro pago: la factura se mira igual, que solo espera al depósito
    -- de la detracción y al pago que la canceló (20261126947000).
    perform public.cambio_de_la_factura_de_servicio(new.orden_servicio_id);
    return null;$v$),
      ('public.fn_pago_anulado_recalcula_servicio()', 1,
       $v$  perform set_config('metalwork.completando_monto_pen', '', true);
  return null;$v$,
       $v$  perform set_config('metalwork.completando_monto_pen', '', true);
  -- La factura que se adjuntó mientras tenía su detracción depositada (20261126947000).
  perform public.cambio_de_la_factura_de_servicio(new.orden_servicio_id);
  return null;$v$)
    ) as x(funcion, veces, viejo, nuevo)
  loop
    select replace(pg_get_functiondef(v_cambio.funcion::regprocedure), E'\r', '') into v_def;
    -- Ya cambiada: el texto nuevo está las veces que toca. El viejo puede
    -- seguir dentro del nuevo (la fecha de Lima va dentro del coalesce).
    if (length(v_def) - length(replace(v_def, v_cambio.nuevo, ''))) = v_cambio.veces * length(v_cambio.nuevo) then
      continue;
    end if;
    v_veces := (length(v_def) - length(replace(v_def, v_cambio.viejo, ''))) / length(v_cambio.viejo);
    if v_veces <> v_cambio.veces or position(v_cambio.nuevo in v_def) > 0 then
      raise exception '% ya no tiene el texto que esta migración cambia (se esperaba % vez o veces, hay %): revísala a mano.',
        v_cambio.funcion, v_cambio.veces, v_veces;
    end if;
    execute replace(v_def, v_cambio.viejo, v_cambio.nuevo);
  end loop;
end $$;

comment on function public.completar_monto_pen_de_servicios() is
  'Pone el monto en soles de las OS en otra moneda que no lo tienen, con el cambio del día que les toca: el de su factura (fecha_cambio) o, sin factura, el día en que se emitieron (20261126626000, 20261126947000).';

-- 6. El cambio del día de la factura que se registra después -------------------
-- La OS con factura va siempre con el cambio que le toca al día de su factura.
-- Si ese cambio se registra después de adjuntarla (la factura electrónica llega
-- el mismo día, antes que el cambio de SUNAT), la OS deja el de la víspera y
-- toma el suyo. Disparador propio, por sentencia: no se toca el que completa
-- las que no tienen monto.

create or replace function public.fn_tipo_de_cambio_alcanza_a_las_facturas()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform set_config('metalwork.completando_monto_pen', 'si', true);
  update public.ordenes_servicio s
     set monto_pen = round(s.monto * x.tc, 2)
    from (select o.id, public.cambio_del_dia(o.fecha_cambio, 'VENTA') as tc
            from public.ordenes_servicio o
           where o.fecha_cambio is not null
             and o.moneda <> 'PEN'
             and o.monto is not null
             and o.estado <> 'ANULADA'
             and o.aprobacion <> 'RECHAZADA'
             and not public.servicio_con_el_cambio_fijo(o.id)) x
   where x.id = s.id
     and x.tc is not null
     and s.monto_pen is distinct from round(s.monto * x.tc, 2);
  perform set_config('metalwork.completando_monto_pen', '', true);
  return null;
end;
$$;

revoke all on function public.fn_tipo_de_cambio_alcanza_a_las_facturas() from public, anon, authenticated;

comment on function public.fn_tipo_de_cambio_alcanza_a_las_facturas() is
  'Al registrar o corregir un tipo de cambio, la OS con factura toma el que ahora le toca al día de su factura. No toca la que tiene depositada su detracción o ya se canceló (20261126947000).';

create or replace trigger trg_tipo_de_cambio_alcanza_a_las_facturas
  after insert or update of fecha, venta on public.tipos_de_cambio
  for each statement execute function public.fn_tipo_de_cambio_alcanza_a_las_facturas();

-- ---------------------------------------------------------------------------
-- 7. La pantalla no adivina con qué cambio va la OS: lo dice la base
-- ---------------------------------------------------------------------------
-- Compras › Servicios, Tesorería y Aprobación dicen de qué día es el cambio de
-- la OS y por qué. Eso depende de su factura, de sus pagos y de los cambios
-- registrados, y no todo el que ve la OS puede leer sus documentos ni sus
-- pagos: Almacén leía «su detracción ya estaba depositada» de una OS sin
-- ningún pago, porque su pantalla no veía la factura (auditoría del
-- 2026-11-26). La cuenta se hace aquí, una sola vez y con las mismas reglas
-- que mueven el monto, y la pantalla solo la lee.
--
-- La ve quien ve la OS: los mismos permisos que la política ver_ordenes_servicio
-- (el check 490 falla si dejan de coincidir). No entrega el documento ni el
-- pago, solo de dónde sale el cambio.

create or replace function public.cambio_de_los_servicios(p_ids uuid[])
returns table (
  orden_servicio_id uuid,
  origen            text,
  dia               date,
  registrado_el     date,
  se_espera         boolean,
  fijo              boolean
)
language sql
stable
security definer
set search_path to 'public'
rows 50
as $$
  with os as (
    select s.id, s.monto, s.monto_pen, s.fecha_cambio,
           coalesce(s.fecha_cambio, public.fecha_de_lima(s.creado_en)) as dia,
           public.servicio_con_el_cambio_fijo(s.id) as fijo,
           -- La factura vigente del día que guarda la OS, la que dice alguna fecha y la que hay.
           exists (select 1 from public.documentos_orden_servicio d
                    where d.orden_servicio_id = s.id and d.anulado_en is null and d.tipo = 'FACTURA'
                      and d.fecha_emision = s.fecha_cambio) as la_de_ese_dia,
           exists (select 1 from public.documentos_orden_servicio d
                    where d.orden_servicio_id = s.id and d.anulado_en is null and d.tipo = 'FACTURA'
                      and d.fecha_emision is not null) as con_fecha,
           exists (select 1 from public.documentos_orden_servicio d
                    where d.orden_servicio_id = s.id and d.anulado_en is null and d.tipo = 'FACTURA') as con_factura
      from public.ordenes_servicio s
     where s.id = any(p_ids)
       and s.moneda <> 'PEN'
       -- A la anulada y a la rechazada nada les mueve el monto: no se dice de dónde sale, que
       -- sin pagos se leía «quedó fija al depositar su detracción».
       and s.estado <> 'ANULADA'
       and s.aprobacion <> 'RECHAZADA'
       and (public.es_admin()
            or public.tiene_permiso('compras.ver')
            or public.tiene_permiso('compras.crear')
            or public.tiene_permiso('compras.detraccion')
            or public.tiene_permiso('tesoreria.ver_documentos')
            or public.tiene_permiso('costos.ver')
            or public.es_aprobador_compras())
  ), con_cambio as (
    select o.*,
           -- Con factura le toca uno solo: el último registrado hasta su día, como cambio_del_dia.
           -- Sin factura se emitió con el último que había entonces (el de su día pudo registrarse
           -- después, y no la mueve): el más reciente del que sale su monto.
           (select t.fecha
              from public.tipos_de_cambio t
             where t.fecha <= o.dia and t.fecha > o.dia - 10
               and (o.fecha_cambio is not null or round(o.monto * t.venta, 2) = o.monto_pen)
             order by t.fecha desc
             limit 1) as toca
      from os o
  ), medido as (
    select c.*,
           case when c.monto is null or c.monto_pen is null or c.toca is null then null
                when round(c.monto * (select t.venta from public.tipos_de_cambio t where t.fecha = c.toca), 2) = c.monto_pen then c.toca
           end as lleva
      from con_cambio c
  )
  select m.id,
         case when m.fecha_cambio is not null and not m.la_de_ese_dia then 'DEPOSITADA_CON_OTRA'
              -- Va con el día de su factura, pero su monto no sale del cambio que hoy le toca a ese día.
              when m.fecha_cambio is not null and m.monto_pen is not null and m.lleva is null then 'DEPOSITADA_CON_OTRO_CAMBIO'
              when m.fecha_cambio is not null then 'FACTURA'
              when m.con_fecha then 'DEPOSITADA_ANTES'
              -- Se depositó su detracción, o se pagó, antes de que llegara la factura: ya no la espera.
              when m.fijo then 'FIJA_SIN_FACTURA'
              when m.con_factura then 'FACTURA_SIN_FECHA'
              else 'SIN_FACTURA'
         end,
         m.dia,
         m.lleva,
         -- Va con el de un día anterior y todavía puede llegar el suyo: el día de su factura es
         -- hábil (el sábado, el domingo y el feriado no tienen cambio propio: vale el último) y
         -- la OS no está fija.
         coalesce(m.fecha_cambio is not null and m.la_de_ese_dia and m.lleva < m.dia and not m.fijo
                  and extract(isodow from m.dia) < 6
                  and not exists (select 1 from public.feriados f where f.fecha = m.dia and not f.laborable), false),
         m.fijo
    from medido m;
$$;

revoke all on function public.cambio_de_los_servicios(uuid[]) from public, anon;
grant execute on function public.cambio_de_los_servicios(uuid[]) to authenticated;

comment on function public.cambio_de_los_servicios(uuid[]) is
  'De cada OS vigente en otra moneda que quien llama puede ver: de dónde sale el día de su cambio (su factura, el día en que se emitió, o lo que quedó fijo al depositar su detracción), qué día es, de qué día es el cambio registrado del que sale su monto en soles, si todavía se espera el de su día y si ya está fija. Para la pantalla; no entrega documentos ni pagos (20261126947000).';
