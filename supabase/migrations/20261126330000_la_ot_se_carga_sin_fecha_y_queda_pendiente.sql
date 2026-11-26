-- =============================================================================
-- LA OT SE CARGA SIN FECHA Y QUEDA EN LOS PENDIENTES DE ADMINISTRACIÓN
-- -----------------------------------------------------------------------------
-- Plan 8 (Administración), entrega 8.1. Lo que más se le escapa a la oficina
-- no es un documento mal hecho sino uno que no se hizo: la cotización que
-- Gerencia aprobó y se quedó sin su OT, la OT que entró sin el código interno
-- de su unidad, o sin la fecha de entrega que se le prometió al cliente. De ahí
-- sale el semáforo de entregas (otro hilo) y, sin esos datos, no tiene con qué.
--
-- Dos cosas:
--
--   1. «Dar código y cargar la OT» (`cargar_codigo_y_ot_de_cotizacion`, migración
--      20261027200000) ya no se niega por falta de fecha. Lo decidió DKS en el
--      plan: la OT sin fecha se crea y queda en la lista de pendientes; a veces
--      el cliente todavía no la confirma y frenar la OT frena a Diseño y al
--      taller. El aviso a Diseño dice «Entrega prometida: por definir». La
--      fecha se pone después con «Editar OT», que la pide (`editar_ot_con_historial`).
--
--   2. `pendientes_de_las_ot()`: lo que la oficina tiene por completar, con los
--      días que lleva esperando por fecha de Lima (`dias_en_espera`, migración
--      20261125130000), lo más viejo primero:
--        * cotización aprobada sin OT vigente, desde que Gerencia la aprobó. La
--          «liberación a Tesorería» ya no existe desde la 20261027200000
--          (Tesorería ve toda cotización aprobada): no se pide;
--        * OT sin código interno: la de fabricación, reparación o repotenciación
--          cuya unidad no lo tiene. El mantenimiento y la garantía van por el
--          N.º de su OT (migración 20261120500000) y no se cuentan;
--        * OT sin fecha de entrega comprometida.
--      De las OT, solo las que siguen abiertas: ni entregadas, ni facturadas,
--      ni anuladas. Corre como quien llama (`security invoker`): solo lista lo
--      que su RLS ya le deja ver, y la pide quien carga las OT (`ordenes.crear`,
--      Administración). Sin importes.
--
--   3. La cotización que fue la venta anterior de una OT (la OT pasó a otro
--      comprador con «Editar OT») ya no admite otra OT: quedaba aprobada y sin
--      OT vigente, y «Dar código y cargar la OT» creaba una segunda OT para una
--      venta que se cayó.
--
-- Antes de reemplazar la función se mira que producción tenga el texto que el
-- repositorio conoce (skill `esquema` › Redefinir una función que producción
-- pudo cambiar a mano). Respaldo del texto anterior: la migración 20261027200000.
-- =============================================================================

do $$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)');
  if v_md5 is null then
    raise exception 'Aplica antes la migración 20261027200000: esta cambia su cargar_codigo_y_ot_de_cotizacion.';
  end if;
  -- El de la 20261027200000 y el de esta misma (volver a correrla no cambia nada).
  if v_md5 not in ('77d669c649a269f92309f2218384a0ff', 'd4d1478061113a19355599fcf186d3e7') then
    raise exception 'cargar_codigo_y_ot_de_cotizacion no es la que conoce el repositorio (md5 %): alguien la cambió a mano. Revísala antes de aplicar esta migración.', v_md5;
  end if;
end $$;

create or replace function public.cargar_codigo_y_ot_de_cotizacion(
  p_cotizacion     uuid,
  p_orden          uuid,
  p_codigo_interno text,
  p_numero_ot      text,
  p_tipo_unidad    public.tipo_unidad_carroceria,
  p_fecha_entrega  date,
  p_ruta_pdf       text,
  p_nombre_pdf     text,
  p_tamano_pdf     bigint,
  p_marca          text default null,
  p_modelo         text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cot     record;
  v_codigo  constant text := public.normalizar_codigo_interno(p_codigo_interno);
  v_clave   constant text := upper(regexp_replace(coalesce(p_codigo_interno, ''), '[^A-Za-z0-9]', '', 'g'));
  v_crudo   constant text := btrim(coalesce(p_numero_ot, ''));
  v_cifras  text;
  v_anio    text;
  v_numero  text;
  v_otra    text;
  v_unidad  uuid;
  v_ajena   text;
  v_sede    uuid;
  v_tipo    constant text := case p_tipo_unidad when 'SEMIRREMOLQUE' then 'Semirremolque'
                                                when 'CARROCERIA_MONTADA' then 'Carrocería montada' end;
  v_enlace  text;
begin
  if public.usuario_actual() is not null and not (public.es_admin() or public.tiene_permiso('ordenes.crear')) then
    raise exception 'No tienes permiso para dar el código interno ni subir la OT de la cotización.'
      using errcode = 'insufficient_privilege';
  end if;

  select c.*, tc.nombre as carroceria, cl.razon_social as cliente
    into v_cot
    from public.cotizaciones_pdf c
    join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
    left join public.clientes cl on cl.id = c.cliente_id
   where c.id = p_cotizacion
     for update of c;
  if v_cot.id is null then
    raise exception 'No se encontró la cotización.' using errcode = 'foreign_key_violation';
  end if;
  if v_cot.estado = 'POR_REVISAR' then
    raise exception 'La cotización % todavía no está aprobada: su código y su OT se cargan cuando se apruebe.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_cot.estado = 'RECHAZADA' then
    raise exception 'La cotización % está rechazada: Ventas sube la corrección y vuelve a aprobarse.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_cot.estado <> 'APROBADA' then
    raise exception 'La cotización % está anulada: no lleva OT.', v_cot.numero using errcode = 'check_violation';
  end if;

  select o.numero into v_otra
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
   limit 1;
  if v_otra is not null then
    raise exception 'La cotización % ya tiene su OT %.', v_cot.numero, v_otra
      using errcode = 'unique_violation';
  end if;

  -- La venta que se cayó: «Editar OT» pasó su OT a la cotización del nuevo
  -- comprador y esta quedó aprobada, pero sin carrocería que fabricar. Otra OT
  -- para ella sería un documento numerado que solo se podría anular
  -- (migración 20261126330000).
  select o.numero into v_otra
    from public.ot_ventas_anteriores va
    join public.ordenes_trabajo o on o.id = va.orden_id
   where va.cotizacion_pdf_id = p_cotizacion
   order by va.creado_en desc
   limit 1;
  if v_otra is not null then
    raise exception 'La cotización % fue la venta anterior de la OT %: esa OT pasó a otro comprador y esta venta no lleva otra OT.', v_cot.numero, v_otra
      using errcode = 'check_violation';
  end if;

  -- El código interno: obligatorio, y el de una unidad, no PLANTA.
  if v_codigo is null then
    raise exception 'Escribe el código interno que tendrá la unidad.' using errcode = 'check_violation';
  end if;
  if v_clave = '' then
    raise exception 'El código interno debe tener letras o números.' using errcode = 'check_violation';
  end if;
  if char_length(v_codigo) > 40 then
    raise exception 'El código interno no pasa de 40 caracteres.' using errcode = 'check_violation';
  end if;
  if v_clave = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: escribe el código interno de la unidad que se fabrica.'
      using errcode = 'check_violation';
  end if;

  -- El número de la OT es el que trae su papel: 2922, o 2922-2026.
  if v_crudo ~ '^\d{1,6}$' then
    v_cifras := v_crudo;
    v_anio := to_char((now() at time zone 'America/Lima')::date, 'YYYY');
  elsif v_crudo ~ '^\d{1,6}-\d{4}$' then
    v_cifras := split_part(v_crudo, '-', 1);
    v_anio := split_part(v_crudo, '-', 2);
  else
    raise exception 'El número de la OT es el que trae su papel: 2922 o 2922-2026.' using errcode = 'check_violation';
  end if;
  v_cifras := ltrim(v_cifras, '0');
  if v_cifras = '' then
    raise exception 'El número de la OT es el que trae su papel: 2922 o 2922-2026.' using errcode = 'check_violation';
  end if;
  v_numero := (case when char_length(v_cifras) < 4 then lpad(v_cifras, 4, '0') else v_cifras end) || '-' || v_anio;
  if exists (select 1 from public.ordenes_trabajo where numero = v_numero) then
    raise exception 'Ya hay una OT %: revisa el número de su papel.', v_numero using errcode = 'unique_violation';
  end if;

  if p_tipo_unidad is null then
    raise exception 'Elige si es un semirremolque o una carrocería montada.' using errcode = 'check_violation';
  end if;
  -- Sin fecha de entrega la OT se carga igual (migración 20261126330000): queda
  -- en «Pendientes de Administración» de la lista de OT hasta que se la ponga.
  if p_ruta_pdf is null or p_ruta_pdf <> 'ot/' || p_orden::text || '/' || split_part(p_ruta_pdf, '/', 3)
     or split_part(p_ruta_pdf, '/', 3) = '' then
    raise exception 'El PDF de la OT no llegó en su sitio: vuelve a elegirlo.' using errcode = 'check_violation';
  end if;

  -- La unidad: la que ya lleva ese código y es de este cliente (o de nadie), o
  -- una nueva. Un código de otro cliente no se toma.
  select u.id into v_unidad
    from public.unidades u
   where upper(regexp_replace(coalesce(u.codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
     and (u.cliente_id = v_cot.cliente_id or u.cliente_id is null)
   order by (u.cliente_id is not null) desc, u.creado_en desc
   limit 1;
  if v_unidad is null then
    select coalesce(cl.razon_social, 'otro cliente') into v_ajena
      from public.unidades u
      left join public.clientes cl on cl.id = u.cliente_id
     where upper(regexp_replace(coalesce(u.codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
     limit 1;
    if v_ajena is not null then
      raise exception 'El código interno % ya es de una unidad de %: elige otro.', v_codigo, v_ajena
        using errcode = 'unique_violation';
    end if;
    insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo, marca, modelo)
    values (v_cot.cliente_id, v_codigo,
            case p_tipo_unidad when 'SEMIRREMOLQUE' then 'SEMIRREMOLQUE' else 'CAMION' end::public.tipo_vehiculo,
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  else
    update public.unidades set cliente_id = v_cot.cliente_id where id = v_unidad and cliente_id is null;
  end if;

  -- La OT nace aprobada, con su PDF: Gerencia ya aprobó su cotización.
  v_sede := coalesce(public.mi_sede(), (select id from public.sedes where activo order by nombre limit 1));
  insert into public.ordenes_trabajo (id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo,
                                      prioridad, descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id, tipo_unidad)
  values (p_orden, v_numero, v_cot.cliente_id, v_unidad, v_cot.tipo_carroceria_id, v_sede, 'FABRICACION',
          'NORMAL', format('%s · %s · cotización %s', v_cot.carroceria, v_tipo, v_cot.numero), p_fecha_entrega,
          'APROBADA', p_cotizacion, p_tipo_unidad);
  update public.series_documentarias
     set correlativo_actual = greatest(correlativo_actual, v_cifras::bigint)
   where tipo = 'ORDEN_TRABAJO' and (sede_id is null or sede_id = v_sede) and correlativo_actual < v_cifras::bigint;
  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(nullif(btrim(p_nombre_pdf), ''), 'orden.pdf'), p_ruta_pdf, 'application/pdf',
          p_tamano_pdf, public.usuario_actual());

  -- Los avisos: Diseño y el taller como cuando aprobaba Gerencia, y Ventas, que
  -- desde aquí recibe el código aparte de la aprobación.
  v_enlace := '/diseno/codigo?codigo='
    || replace(replace(replace(replace(replace(replace(v_codigo, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), '/', '%2F'), ' ', '+');
  perform public.notificar_a_permiso(
    'diseno.codigos',
    'Código nuevo con su OT',
    format('%s: OT %s, %s (%s) de %s Entrega prometida: %s. Carga sus planos, materiales y etapas.',
           v_codigo, v_numero, v_cot.carroceria, lower(v_tipo), public.con_punto_final(coalesce(v_cot.cliente, 'un cliente')),
           coalesce(to_char(p_fecha_entrega, 'DD/MM/YYYY'), 'por definir')),
    v_enlace, 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Código nuevo en el taller',
    format('%s: %s, %s. Diseño cargará sus planos y etapas.', v_codigo, v_cot.carroceria, lower(v_tipo)),
    '/planos', 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_usuario(
    v_cot.registrado_por,
    'Tu cotización ya tiene su código',
    format('La %s de %s quedó con el código interno %s y la OT %s.',
           v_cot.numero, coalesce(v_cot.cliente, 'un cliente'), v_codigo, v_numero),
    '/cotizaciones/pdf', 'cotizaciones_pdf', p_cotizacion, public.usuario_actual());

  return p_orden;
end;
$$;

comment on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text) is
  'Administración (ordenes.crear) da el código interno de la unidad y sube el PDF de la OT de una cotización ya aprobada, todo junto o nada (migración 20261027200000). La fecha de entrega puede ir vacía: la OT queda en los pendientes de la lista de OT (migración 20261126330000).';

revoke all on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  from public, anon;
grant execute on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  to authenticated;


-- -----------------------------------------------------------------------------
-- Lo que la oficina tiene por completar en las OT
-- -----------------------------------------------------------------------------
-- Además de qué falta, cada fila dice lo que hace falta saber para completarla:
--   * `ot_anulada`: la cotización vuelve a la lista porque su OT se anuló; se
--     dice cuál, para que nadie la cargue otra vez sin saberlo.
--   * `codigo_bloqueado`: el código interno va en la unidad, y «Editar OT» no
--     puede ponerlo cuando la OT no tiene unidad (SIN_UNIDAD) o cuando la unidad
--     es también de otra OT (UNIDAD_COMPARTIDA: `editar_ot_con_historial` no
--     cambia datos compartidos desde una sola orden). La pantalla lo dice en vez
--     de ofrecer un botón que no lo resuelve.
--   * `total`: cuántas hay en todo, aunque la lista se corte en 500.
-- No sale la cotización que fue la venta anterior de una OT que pasó a otro
-- comprador (`ot_ventas_anteriores`): esa venta se cayó y no lleva OT.
create or replace function public.pendientes_de_las_ot()
returns table (
  clase            text,         -- COTIZACION u OT
  documento        uuid,         -- la cotización o la OT
  numero           text,
  cliente          text,
  trabajo          text,         -- la carrocería o la descripción
  falta_ot         boolean,
  falta_codigo     boolean,
  falta_fecha      boolean,
  ot_anulada       text,         -- de la cotización: el N.º de su OT anulada
  codigo_bloqueado text,         -- de la OT: SIN_UNIDAD o UNIDAD_COMPARTIDA
  desde            timestamptz,  -- desde cuándo espera
  dias             integer,      -- por fecha de Lima, hoy = 0
  total            integer       -- cuántas hay, aunque se muestren 500
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('ordenes.crear')) then
    raise exception 'Los pendientes de las OT los ve quien carga las OT.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with pendientes as (
    select 'COTIZACION'::text as clase, c.id as documento, c.numero, cl.razon_social as cliente,
           tc.nombre as trabajo, true as falta_ot, false as falta_codigo, false as falta_fecha,
           (select o.numero from public.ordenes_trabajo o
             where o.cotizacion_pdf_id = c.id and o.estado = 'ANULADA'
             order by o.actualizado_en desc limit 1) as ot_anulada,
           null::text as codigo_bloqueado,
           coalesce(c.revisado_en, c.creado_en) as desde
      from public.cotizaciones_pdf c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
     where c.estado = 'APROBADA'
       and not exists (select 1 from public.ordenes_trabajo o
                        where o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA')
       and not exists (select 1 from public.ot_ventas_anteriores va
                        where va.cotizacion_pdf_id = c.id)
    union all
    select 'OT', o.id, o.numero, cl.razon_social, o.descripcion, false,
           s.sin_codigo,
           o.fecha_entrega_comprometida is null,
           null::text,
           case when not s.sin_codigo then null
                when o.unidad_id is null then 'SIN_UNIDAD'
                when exists (select 1 from public.ordenes_trabajo o2
                              where o2.unidad_id = o.unidad_id and o2.id <> o.id) then 'UNIDAD_COMPARTIDA'
           end,
           o.creado_en
      from public.ordenes_trabajo o
      left join public.unidades u on u.id = o.unidad_id
      left join public.clientes cl on cl.id = o.cliente_id
      cross join lateral (
        select (o.tipo_trabajo not in ('MANTENIMIENTO', 'GARANTIA')
                and nullif(btrim(coalesce(u.codigo_interno, '')), '') is null) as sin_codigo
      ) s
     where o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')
       and (s.sin_codigo or o.fecha_entrega_comprometida is null)
  )
  select p.clase, p.documento, p.numero, p.cliente, p.trabajo, p.falta_ot, p.falta_codigo, p.falta_fecha,
         p.ot_anulada, p.codigo_bloqueado, p.desde, public.dias_en_espera(p.desde),
         (count(*) over ())::integer
    from pendientes p
   order by p.desde, p.numero
   limit 500;
end;
$$;

comment on function public.pendientes_de_las_ot() is
  'Lo que Administración tiene por completar en las OT, lo más viejo primero (hasta 500, con el total): cotización aprobada sin OT vigente (desde su aprobación; dice si su OT se anuló; no la venta anterior de una OT que pasó a otro comprador), y OT abierta sin código interno (fabricación, reparación o repotenciación; mantenimiento y garantía van por su N.º; dice si no tiene unidad o si la comparte con otra OT) o sin fecha de entrega comprometida (desde que se creó). Días por fecha de Lima. Corre como quien llama y la pide ordenes.crear. Sin importes. Migración 20261126330000.';

revoke all on function public.pendientes_de_las_ot() from public, anon;
grant execute on function public.pendientes_de_las_ot() to authenticated;
