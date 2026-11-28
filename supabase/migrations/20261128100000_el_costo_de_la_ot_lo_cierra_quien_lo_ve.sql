-- El costo de la OT lo cierra quien lo ve.
--
-- Cerrar el costo es firmar la cifra con la que se entregó la unidad: queda
-- congelada como evidencia y no se corrige. Por eso solo lo hace quien puede
-- revisar esa cifra antes de firmarla: Costos y Materiales y Administración
-- (`costos.ver`), como ya decía el aviso desde la migración 20261023140000.
--
-- La puerta de `cerrar_costo_ot` pedía solo `costos.controlar_ot` u
-- `ordenes.editar`. Requerimientos conserva `costos.controlar_ot` (lo heredó de
-- Costos y Materiales en la 20261012140000), pero desde la 20261015160000 ya no
-- ve el costo de las OT, a propósito: cada puesto ve lo suyo. El Jefe de Taller
-- tiene `ordenes.editar` y tampoco lo ve. A los dos la función les dejaba pasar
-- la puerta y después caía dentro del cálculo (`detalle_costeo_ot`) con «No
-- tiene el permiso costos.ver para realizar esta operación»: un rechazo que no
-- dice por qué. Comprobado en producción con la cuenta de Requerimientos el
-- 2026-11-28, en una transacción que se deshizo.
--
-- Ahora la puerta pide las dos cosas, decidir (`costos.controlar_ot` u
-- `ordenes.editar`) y ver el costo (`costos.ver`), y el que no las tiene recibe
-- el aviso de siempre. La acción, el botón del expediente y el pendiente
-- «órdenes terminadas con el costo sin cerrar» piden lo mismo. A Requerimientos
-- no se le da `costos.ver` ni se le quita nada.
--
-- No cambia datos. Antes de reemplazar la función se compara su texto con el
-- que conoce el repositorio (antes o después de este cambio), para no pisar un
-- arreglo pegado a mano en producción. `create or replace` conserva los permisos.

do $guarda$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
    from pg_proc p
   where p.oid = 'public.cerrar_costo_ot(uuid,text)'::regprocedure;
  if v_md5 not in ('d6036dd1876837b8d5421d15ef0c79b5', 'd38c679cf68a7b14d715b6f22fe5d36b') then
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

  perform public.ot_registrar_evento_interna(
    p_orden, 'DOCUMENTO',
    format('Costo cerrado en S/ %s', to_char(v_costo, 'FM999G999G990D00')),
    jsonb_build_object('cierre', v_id, 'costo_pen', v_costo),
    null, public.usuario_actual());

  return v_id;
end;
$function$;

comment on function public.cerrar_costo_ot(uuid, text) is
  'Congela el costo en soles de una OT terminada. Lo cierra quien controla el costo (costos.controlar_ot u ordenes.editar) y además lo ve (costos.ver): Costos y Materiales y Administración (20261128100000).';
