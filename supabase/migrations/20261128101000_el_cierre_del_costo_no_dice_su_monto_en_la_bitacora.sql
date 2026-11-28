-- El cierre del costo no dice su monto en la bitácora.
--
-- La bitácora de la OT (`ot_bitacora`) la lee todo el que ve la OT
-- (`puede_ver_orden`): Ventas, Tesorería, Contabilidad, Diseño, el taller.
-- `cerrar_costo_ot` anotaba ahí «Costo cerrado en S/ 1,380.00» y el monto en
-- `datos.costo_pen`, así que esos puestos leían en «Cómo se fabricó» y en la
-- bitácora la cifra que la tarjeta del costo les esconde, y Ventas, que conoce
-- el precio, sacaba el margen. Cada puesto ve lo suyo: el evento dice que el
-- costo se cerró, y la cifra queda en `ot_cierres_costo`, que solo lee quien
-- tiene `costos.ver`. Venía de la 20261001152000 y la 20261128100000 lo copió;
-- lo encontró la auditoría de funcionamiento el 2026-11-28.
--
-- No cambia datos: en producción no había ningún evento así (0 cierres al
-- 2026-11-28). Solo cambia el texto del evento; la puerta es la de la
-- 20261128100000. La guarda compara el cuerpo con el que conoce el repositorio.

do $guarda$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
    from pg_proc p
   where p.oid = 'public.cerrar_costo_ot(uuid,text)'::regprocedure;
  if v_md5 not in ('d38c679cf68a7b14d715b6f22fe5d36b', 'f38794673ff08a24d6d6070ddd14fba6') then
    raise exception 'cerrar_costo_ot cambió fuera del repositorio (md5 %): revisarla antes de reemplazarla.', v_md5;
  end if;
end;
$guarda$;

create or replace function public.cerrar_costo_ot(p_orden uuid, p_nota text default ''::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_estado text;
  v_numero text;
  v_sin_precio integer;
  v_sin_cambio integer;
  v_costo numeric;
  v_lineas jsonb;
  v_id uuid := gen_random_uuid();
begin
  -- Decide quien controla el costo de la OT y, además, lo ve: no se firma una
  -- cifra que no se puede revisar (20261128100000).
  if not (public.es_admin()
          or ((public.tiene_permiso('costos.controlar_ot') or public.tiene_permiso('ordenes.editar'))
              and public.tiene_permiso('costos.ver'))) then
    raise exception 'No tienes permiso para cerrar el costo de la OT.'
      using errcode = 'insufficient_privilege';
  end if;

  select o.estado::text, o.numero into v_estado, v_numero
    from public.ordenes_trabajo o where o.id = p_orden for update;
  if not found then
    raise exception 'La OT no existe.';
  end if;
  if v_estado not in ('TERMINADA', 'ENTREGADA', 'FACTURADA') then
    raise exception 'La OT % sigue en producción: el costo se cierra cuando el trabajo terminó.', v_numero;
  end if;
  if exists (select 1 from public.ot_cierres_costo c where c.orden_id = p_orden) then
    raise exception 'El costo de la OT % ya está cerrado.', v_numero;
  end if;

  select count(*) filter (where s.fuente = 'MATERIALES_SIN_PRECIO'),
         count(*) filter (where s.moneda = 'USD' and s.monto_pen is null),
         coalesce(sum(s.monto_pen), 0),
         coalesce(jsonb_agg(jsonb_build_object(
           'fuente', s.fuente, 'fecha', s.fecha, 'concepto', s.concepto, 'moneda', s.moneda,
           'monto', s.monto, 'tipo_cambio', s.tipo_cambio, 'monto_pen', s.monto_pen)
           order by s.fuente, s.fecha), '[]'::jsonb)
    into v_sin_precio, v_sin_cambio, v_costo, v_lineas
    from public.costeo_ot_en_soles(p_orden) s;

  if v_sin_precio > 0 then
    raise exception 'La OT % tiene % despacho(s) sin precio: valorízalos antes de cerrar el costo.', v_numero, v_sin_precio;
  end if;
  if v_sin_cambio > 0 then
    raise exception 'La OT % tiene % línea(s) en dólares sin tipo de cambio de su fecha: regístralo en Tipo de cambio.', v_numero, v_sin_cambio;
  end if;

  insert into public.ot_cierres_costo (id, orden_id, costo_pen, lineas, nota, cerrado_por, cerrado_en)
  values (v_id, p_orden, v_costo, v_lineas, coalesce(btrim(p_nota), ''), public.usuario_actual(), now());

  -- La bitácora la lee todo el que ve la OT; la cifra, solo quien ve el costo
  -- (en ot_cierres_costo). El evento dice que se cerró, no en cuánto.
  perform public.ot_registrar_evento_interna(
    p_orden, 'DOCUMENTO',
    'Costo de la OT cerrado',
    jsonb_build_object('cierre', v_id),
    null, public.usuario_actual());

  return v_id;
end;
$function$;
