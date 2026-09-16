-- =============================================================================
-- LA ORDEN AVISA EN CADA PASO
-- -----------------------------------------------------------------------------
-- La cotización avisa a cada mano desde la migración 058 y la orden que abre el
-- taller también (098). Pero la orden de la oficina caminaba muda: nadie sabía
-- que había una por aprobar, Diseño no se enteraba de que ya podía desglosar
-- una aprobada a mano, tesorería no sabía que una terminada esperaba su
-- liberación y la oficina no sabía que una entregada faltaba facturar. Cada
-- uno tenía que entrar a mirar.
--
-- Cuatro avisos más, generados por la base como los demás:
--
--   1. Nace en borrador desde la oficina → a quien aprueba (`ordenes.aprobar`).
--   2. Pasa de borrador a aprobada → a Diseño (`diseno.planos`) y a los jefes
--      de área (`produccion.actividades`), cada uno a su pestaña. La orden que
--      se emite desde la cotización ya nace aprobada y avisa desde
--      `emitir_orden_de_cotizacion`; acá solo la que se aprueba a mano.
--   3. Terminada → a tesorería (`tesoreria.liberar`) y a quien entrega
--      (`ordenes.entregar`).
--   4. Entregada → a la oficina (`ordenes.editar`), que es quien la factura
--      (migración 110).
--
-- Y dos que faltaban del lado del taller: cuando el supervisor corrige un
-- reporte observado, el jefe que lo observó se entera (antes el reporte volvía
-- a la cola sin decirle nada), y los avisos de la orden nueva llevan a la
-- pestaña donde se trabaja —Cumplimiento para Diseño, Actividades para los
-- jefes— en vez de al resumen.
--
-- Todo con disparadores propios: `fn_ot_despues_update` no se toca (blindaje).
-- =============================================================================

-- ------------------------------------------------- 1 y 2, 3 y 4: la orden
create or replace function public.fn_ot_avisa_de_estado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo   constant uuid := public.usuario_actual();
  v_ruta constant text := '/ordenes/' || new.id;
begin
  if new.estado is not distinct from old.estado then
    return null;
  end if;

  if new.estado = 'APROBADA' and old.estado = 'BORRADOR' then
    perform public.notificar_a_permiso(
      'diseno.planos',
      'Orden ' || new.numero || ' aprobada: falta el desglose',
      left(coalesce(new.descripcion, ''), 160) || '. Ya se pueden repartir los planos y armar las actividades.',
      v_ruta || '?vista=cumplimiento', 'ordenes_trabajo', new.id, v_yo);
    perform public.notificar_a_permiso(
      'produccion.actividades',
      'Orden ' || new.numero || ' aprobada',
      left(coalesce(new.descripcion, ''), 160) || '. Revisen la hoja de su área.',
      v_ruta || '?vista=actividades', 'ordenes_trabajo', new.id, v_yo);

  elsif new.estado = 'TERMINADA' then
    perform public.notificar_a_permiso(
      'tesoreria.liberar',
      'Orden ' || new.numero || ' terminada: falta liberar la salida',
      'El taller la dio por terminada. Confirma que el cliente está al día para que la unidad pueda salir.',
      v_ruta, 'ordenes_trabajo', new.id, v_yo);
    perform public.notificar_a_permiso(
      'ordenes.entregar',
      'Orden ' || new.numero || ' terminada',
      'Lista para entregar cuando tesorería libere la salida.',
      v_ruta, 'ordenes_trabajo', new.id, v_yo);

  elsif new.estado = 'ENTREGADA' then
    perform public.notificar_a_permiso(
      'ordenes.editar',
      'Orden ' || new.numero || ' entregada: falta facturar',
      'La unidad ya salió. Cuando esté la factura, márcala como facturada.',
      v_ruta, 'ordenes_trabajo', new.id, v_yo);
  end if;

  return null;
end;
$$;

comment on function public.fn_ot_avisa_de_estado() is
  'Aprobada a mano avisa a Diseño y a los jefes; terminada, a tesorería y a quien entrega; entregada, a la oficina que factura.';

revoke all on function public.fn_ot_avisa_de_estado() from public, anon, authenticated;

drop trigger if exists trg_ot_avisa_de_estado on public.ordenes_trabajo;
create trigger trg_ot_avisa_de_estado
  after update of estado on public.ordenes_trabajo
  for each row execute function public.fn_ot_avisa_de_estado();

create or replace function public.fn_ot_avisa_de_alta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- La del taller ya avisa desde abrir_orden_del_taller (098); acá la de la
  -- oficina, que espera la aprobación de Gerencia.
  if new.estado <> 'BORRADOR' or coalesce(new.abierta_en_taller, false) then
    return null;
  end if;

  perform public.notificar_a_permiso(
    'ordenes.aprobar',
    'Orden ' || new.numero || ' por aprobar',
    left(coalesce(new.descripcion, ''), 160) || '. Registrada por ' || coalesce(public.puesto_de(new.creado_por), 'la oficina') || '.',
    '/ordenes/' || new.id, 'ordenes_trabajo', new.id, public.usuario_actual());
  return null;
end;
$$;

comment on function public.fn_ot_avisa_de_alta() is
  'La orden que registra la oficina en borrador le avisa a quien la aprueba.';

revoke all on function public.fn_ot_avisa_de_alta() from public, anon, authenticated;

drop trigger if exists trg_ot_avisa_de_alta on public.ordenes_trabajo;
create trigger trg_ot_avisa_de_alta
  after insert on public.ordenes_trabajo
  for each row execute function public.fn_ot_avisa_de_alta();

-- ------------------------------------------ la corrección le avisa al jefe
-- fn_reporte_revision (097) devuelve a PENDIENTE el reporte observado que se
-- corrige y borra revisado_por en la fila nueva; en `old` sigue quien observó,
-- y es a quien hay que avisarle.
create or replace function public.fn_reporte_corregido_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fila  constant jsonb := to_jsonb(new);
  v_ruta  text;
  v_sobre text;
begin
  if old.revision <> 'OBSERVADO' or new.revision <> 'PENDIENTE'
     or new.corregido_en is not distinct from old.corregido_en
     or old.revisado_por is null then
    return null;
  end if;

  if tg_table_name = 'flota_avances' then
    v_ruta := '/avance/trabajos/' || (v_fila ->> 'flota_id');
    select coalesce(f.placa, f.descripcion) into v_sobre
      from public.flota_unidades f where f.id = (v_fila ->> 'flota_id')::uuid;
  else
    v_ruta := case when tg_table_name = 'ot_avances'
                   then '/avance/' || (v_fila ->> 'orden_id')
                   else '/ordenes/' || (v_fila ->> 'orden_id') || '?vista=actividades' end;
    select o.numero into v_sobre
      from public.ordenes_trabajo o where o.id = (v_fila ->> 'orden_id')::uuid;
  end if;

  perform public.notificar_a_usuario(
    old.revisado_por,
    'Corrigieron el reporte que observaste',
    format('%s, del %s. Vuelve a la cola para tu visto.', coalesce(v_sobre, 'Reporte'), to_char(new.fecha, 'DD/MM')),
    v_ruta,
    tg_table_name,
    new.id,
    public.usuario_actual());

  return null;
end;
$$;

comment on function public.fn_reporte_corregido_avisa() is
  'El reporte observado que se corrige vuelve a la cola y le avisa al jefe que lo observó.';

revoke all on function public.fn_reporte_corregido_avisa() from public, anon, authenticated;

-- Sin `of corregido_en`: esa columna la escribe fn_reporte_revision en BEFORE y
-- no viene en el SET del UPDATE del supervisor, y «update of» mira el SET, no
-- lo que cambió. Con la lista de columnas el disparador no corría nunca.
do $$
declare t text;
begin
  foreach t in array array['ot_actividad_avances', 'ot_avances', 'flota_avances'] loop
    execute format('drop trigger if exists trg_reporte_corregido_avisa on public.%I', t);
    execute format('create trigger trg_reporte_corregido_avisa after update on public.%I
                      for each row execute function public.fn_reporte_corregido_avisa()', t);
  end loop;
end $$;

-- ---------------------------------- los avisos de la orden nueva, a su pestaña
-- La función de la 108, tal cual, con las dos rutas cambiadas al final.
create or replace function public.emitir_orden_de_cotizacion(
  p_cotizacion    uuid,
  p_orden         uuid,
  p_numero        text,
  p_numero_fmi    text,
  p_tipo_unidad   public.tipo_unidad_carroceria,
  p_marca         text,
  p_modelo        text,
  p_fecha_entrega date,
  p_ruta_pdf      text,
  p_nombre_pdf    text,
  p_tamano_pdf    bigint default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cot     record;
  v_fmi     constant text := nullif(upper(btrim(coalesce(p_numero_fmi, ''))), '');
  v_clave   constant text := upper(regexp_replace(coalesce(p_numero_fmi, ''), '[^A-Za-z0-9]', '', 'g'));
  v_crudo   constant text := btrim(coalesce(p_numero, ''));
  v_numero  text;
  v_correl  bigint;
  v_unidad  uuid;
  v_ajena   text;
  v_sede    uuid;
  v_nombre  text;
  v_tipo    constant text := case p_tipo_unidad when 'SEMIRREMOLQUE' then 'Semirremolque'
                                                when 'CARROCERIA_MONTADA' then 'Carrocería montada' end;
begin
  perform public.exigir_permiso('ordenes.crear');

  -- El número del papel: «2922» toma el año en curso; «2922-2026» entra tal cual.
  if v_crudo ~ '^\d{1,6}$' then
    v_numero := lpad(v_crudo, 4, '0') || '-' ||
                to_char((now() at time zone 'America/Lima')::date, 'YYYY');
  elsif v_crudo ~ '^\d{1,6}-\d{4}$' then
    v_numero := lpad(split_part(v_crudo, '-', 1), 4, '0') || '-' || split_part(v_crudo, '-', 2);
  else
    raise exception 'El número de la orden es el que trae su papel: 2922 o 2922-2026.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.ordenes_trabajo o where o.numero = v_numero) then
    raise exception 'Ya hay una orden de trabajo %: revisa el número del papel.', v_numero
      using errcode = 'unique_violation';
  end if;

  select c.*, tc.nombre as carroceria into v_cot
    from public.cotizaciones_pdf c
    join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
   where c.id = p_cotizacion
     for update of c;

  if v_cot.id is null then
    raise exception 'No se encontró la cotización.' using errcode = 'foreign_key_violation';
  end if;
  if v_cot.estado <> 'APROBADA' then
    raise exception 'La cotización % todavía no está aprobada por Gerencia.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ordenes_trabajo o
              where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA') then
    raise exception 'La cotización % ya tiene su orden de trabajo.', v_cot.numero
      using errcode = 'unique_violation';
  end if;
  if p_tipo_unidad is null then
    raise exception 'Elige si es un semirremolque o una carrocería montada.' using errcode = 'check_violation';
  end if;
  if p_ruta_pdf is null or p_ruta_pdf <> 'ot/' || p_orden::text || '/' || split_part(p_ruta_pdf, '/', 3) then
    raise exception 'El PDF de la orden no llegó en su sitio.' using errcode = 'check_violation';
  end if;
  if v_clave = '' and nullif(btrim(p_marca), '') is null and nullif(btrim(p_modelo), '') is null then
    raise exception 'Escribe el número FMI, o la marca y el modelo si todavía no tiene.'
      using errcode = 'check_violation';
  end if;

  if v_clave <> '' then
    select u.id into v_unidad
      from public.unidades u
     where upper(regexp_replace(coalesce(u.numero_fmi, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
       and (u.cliente_id = v_cot.cliente_id or u.cliente_id is null)
     order by (u.cliente_id is not null) desc, u.creado_en desc
     limit 1;

    if v_unidad is null then
      select coalesce(cl.razon_social, 'otro cliente') into v_ajena
        from public.unidades u
        left join public.clientes cl on cl.id = u.cliente_id
       where upper(regexp_replace(coalesce(u.numero_fmi, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
       limit 1;
      if v_ajena is not null then
        raise exception 'El número FMI % ya es de una unidad de %: revisa el número.', v_fmi, v_ajena
          using errcode = 'unique_violation';
      end if;
    else
      update public.unidades set cliente_id = v_cot.cliente_id
       where id = v_unidad and cliente_id is null;
    end if;
  end if;

  if v_unidad is null then
    insert into public.unidades (cliente_id, numero_fmi, tipo_vehiculo, marca, modelo)
    values (v_cot.cliente_id, v_fmi,
            case p_tipo_unidad when 'SEMIRREMOLQUE' then 'SEMIRREMOLQUE' else 'CAMION' end::public.tipo_vehiculo,
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  end if;

  v_sede := coalesce(public.mi_sede(),
                     (select s.id from public.sedes s where s.activo order by s.nombre limit 1));

  insert into public.ordenes_trabajo (
    id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad,
    descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id, tipo_unidad)
  values (
    p_orden, v_numero, v_cot.cliente_id, v_unidad, v_cot.tipo_carroceria_id, v_sede, 'FABRICACION', 'NORMAL',
    format('%s · %s · cotización %s', v_cot.carroceria, v_tipo, v_cot.numero),
    p_fecha_entrega, 'APROBADA', p_cotizacion, p_tipo_unidad);

  -- La serie automática no se queda atrás del papel: la siguiente orden que el
  -- taller abra sale después de esta y no choca con ninguna.
  v_correl := split_part(v_numero, '-', 1)::bigint;
  update public.series_documentarias
     set correlativo_actual = greatest(correlativo_actual, v_correl)
   where tipo = 'ORDEN_TRABAJO'
     and (sede_id is null or sede_id = v_sede)
     and correlativo_actual < v_correl;

  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(nullif(btrim(p_nombre_pdf), ''), 'orden.pdf'), p_ruta_pdf,
          'application/pdf', p_tamano_pdf, public.usuario_actual());

  v_nombre := coalesce('FMI ' || v_fmi,
                       nullif(btrim(concat_ws(' ', nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))), ''));

  -- Cada aviso lleva a la pestaña donde se trabaja: el jefe a Actividades y
  -- Diseño a Cumplimiento, no al resumen.
  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Orden nueva en el taller',
    format('%s: %s, %s (%s). Armen la lista de su área.', v_numero, v_cot.carroceria, lower(v_tipo), coalesce(v_nombre, 'sin FMI')),
    '/ordenes/' || p_orden || '?vista=actividades', 'ordenes_trabajo', p_orden, public.usuario_actual());

  perform public.notificar_a_permiso(
    'diseno.planos',
    'Orden nueva para desglosar',
    format('%s: %s, %s. Falta el desglose de Diseño.', v_numero, v_cot.carroceria, lower(v_tipo)),
    '/ordenes/' || p_orden || '?vista=cumplimiento', 'ordenes_trabajo', p_orden, public.usuario_actual());

  return p_orden;
end;
$function$;

revoke all on function public.emitir_orden_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint)
  from public, anon;
grant execute on function public.emitir_orden_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, text, text, date, text, text, bigint)
  to authenticated;

-- --------------------------------- la cotización para costear, a su pantalla
-- La de la 058, tal cual, con la ruta de «para costear» apuntando a la
-- cotización y no a la lista: el aviso decía cuál y llevaba a buscarla.
create or replace function public.fn_cotizacion_avisar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_ruta    text := '/cotizaciones/' || new.id;
  v_cliente text;
  v_quien   text;
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  v_quien := coalesce(v_cliente, 'un cliente');

  if new.estado = 'EN_COSTEO' then
    perform public.notificar_a_permiso(
      'cotizaciones.costear',
      'Cotización ' || new.numero || ' para costear',
      'Ventas la pasó a cotización de trabajo. Falta cargar las partidas y la ficha técnica. Cliente: ' || v_quien || '.',
      '/cotizaciones/trabajo/' || new.id, 'cotizaciones', new.id, v_yo);

  elsif new.estado = 'EN_REVISION' then
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización ' || new.numero || ' esperando tu visto',
      'Administración terminó el costeo. Cliente: ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);

  elsif new.estado = 'REVISADA' then
    perform public.notificar_a_permiso(
      'cotizaciones.costear',
      'Cotización ' || new.numero || ' aprobada por Gerencia',
      'Ya tiene el visto. Cliente: ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);
    perform public.notificar_a_permiso(
      'cotizaciones.crear',
      'Cotización ' || new.numero || ' aprobada por Gerencia',
      'Lista para enviar al cliente. Cliente: ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);
    perform public.notificar_a_usuario(
      new.vendedor_id,
      'Cotización ' || new.numero || ' aprobada por Gerencia',
      'Lista para enviar a ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);

  elsif new.estado = 'OBSERVADA' then
    perform public.notificar_a_permiso(
      'cotizaciones.costear',
      'Cotización ' || new.numero || ' devuelta por Gerencia',
      coalesce(new.motivo_observacion, 'Sin motivo escrito.'),
      v_ruta, 'cotizaciones', new.id, v_yo);

  elsif new.estado in ('APROBADA', 'RECHAZADA') then
    perform public.notificar_a_permiso(
      'cotizaciones.costear',
      'Cotización ' || new.numero || ' ' || lower(new.estado::text) || ' por el cliente',
      case when new.estado = 'APROBADA'
           then 'Ya se puede abrir la orden de trabajo. Cliente: ' || v_quien || '.'
           else coalesce(new.motivo_rechazo, 'Sin motivo escrito.') end,
      v_ruta, 'cotizaciones', new.id, v_yo);
    perform public.notificar_a_usuario(
      new.vendedor_id,
      'Cotización ' || new.numero || ' ' || lower(new.estado::text) || ' por el cliente',
      'Cliente: ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);
  end if;

  return new;
end;
$$;

revoke all on function public.fn_cotizacion_avisar() from public, anon, authenticated;
