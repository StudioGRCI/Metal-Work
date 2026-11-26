-- =============================================================================
-- EL INSUMO QUE LLEGA AVISA A QUIEN LO PIDIÓ
-- -----------------------------------------------------------------------------
-- Plan 3 (Requerimientos), entrega 3.1. Quien registra el RQ lo sigue contra la
-- fecha en que lo necesita, y lo que más le importa es saber cuándo ya puede ir a
-- recoger. La campana ya le avisaba dos veces: cuando Almacén revisa el stock
-- («Por comprar: … Almacén tiene parte») y cuando el RQ entero queda «Listo en
-- almacén». Entre las dos no decía nada: si Logística compraba tres insumos y el
-- proveedor traía uno el lunes y los otros dos el viernes, el lunes el insumo ya
-- estaba en el almacén y quien lo pidió no se enteraba hasta abrir la pantalla.
--
-- Ahora, cada vez que entra al kardex lo que se compró para un insumo de un RQ
-- que sigue en compra, la campana le avisa a quien registró ese RQ (decisión del
-- plan: «el aviso va a quien registró»). Un aviso por cada ingreso: si el
-- proveedor trae una parte, avisa esa parte, y cuando llega el resto, otro.
--
-- Va en un disparador propio sobre el movimiento, no dentro de la función que
-- recibe la compra: un ingreso de compra entra por más de un camino (la
-- validación de lo que dejó el conductor, la recepción a mano del kardex, la
-- reposición de lo devuelto) y así ninguno se queda sin avisar, sin reescribir
-- ninguna función que ya está en producción.
--
-- No avisa:
--   · lo que vuelve al almacén de una salida (`devolucion_de`): no es compra;
--   · al RQ anulado, entregado o ya «Listo en almacén», que ya tuvo su aviso;
--   · a quien registró el ingreso, si es el mismo que pidió (como `fn_rq_avisar`).
-- Si la OC junta varios RQ, cada uno recibe el suyo, con sus insumos.
-- =============================================================================

create or replace function public.fn_rq_avisar_lo_que_llego()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rq record;
begin
  if new.tipo <> 'INGRESO' or new.orden_compra_detalle_id is null or new.devolucion_de is not null
     or coalesce(new.cantidad, 0) <= 0 then
    return null;
  end if;

  for v_rq in
    select r.id, r.numero, r.codigo_interno, r.creado_por,
           string_agg(l.descripcion, ', ' order by l.item) as insumos,
           count(*) as cuantos,
           (select public.nombre_de_oc(c.numero, c.referencia)
              from public.orden_compra_material_detalles d
              join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
             where d.id = new.orden_compra_detalle_id) as oc
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where l.orden_compra_detalle_id = new.orden_compra_detalle_id
       and r.estado in ('SIN_STOCK', 'EN_ATENCION')
       and r.creado_por is not null
     group by r.id, r.numero, r.codigo_interno, r.creado_por
  loop
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id,
           left('Llegó a almacén: ' || v_rq.numero, 200),
           left(case when v_rq.cuantos = 1 then 'Entró al almacén lo comprado para ' else 'Entró al almacén lo comprado para los insumos ' end
                || v_rq.insumos
                || coalesce(' (' || v_rq.oc || ')', '')
                || coalesce(' · ' || v_rq.codigo_interno, '')
                || '. Mira en el RQ cuánto ya puedes recoger.', 500),
           '/requerimientos?rq=' || v_rq.id,
           'requerimientos', v_rq.id
      from public.usuarios u
     where u.id = v_rq.creado_por
       and u.activo
       and u.id is distinct from public.usuario_actual();
  end loop;
  return null;
end;
$$;

comment on function public.fn_rq_avisar_lo_que_llego() is
  'Al entrar al kardex lo comprado para un insumo de un RQ en compra, avisa por la campana a quien registró el RQ (plan 3, entrega 3.1).';

revoke all on function public.fn_rq_avisar_lo_que_llego() from public, anon, authenticated;

create or replace trigger trg_rq_avisar_lo_que_llego
  after insert on public.movimientos_materiales
  for each row
  when (new.tipo = 'INGRESO' and new.orden_compra_detalle_id is not null and new.devolucion_de is null)
  execute function public.fn_rq_avisar_lo_que_llego();
