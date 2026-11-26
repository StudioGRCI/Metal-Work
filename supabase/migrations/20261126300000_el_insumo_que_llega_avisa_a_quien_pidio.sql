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
-- Ahora, cuando entra al kardex lo que se compró para un insumo de un RQ que
-- sigue en compra, la campana le avisa a quien registró ese RQ (decisión del
-- plan: «el aviso va a quien registró»), con cuánto entró de cada insumo.
--
-- Va en un disparador propio sobre el movimiento, no dentro de la función que
-- recibe la compra: un ingreso de compra entra por más de un camino (la
-- validación de lo que dejó el conductor, la recepción a mano del kardex, la
-- reposición de lo devuelto) y así ninguno se queda sin avisar, sin reescribir
-- ninguna función que ya está en producción.
--
-- El disparador corre al cerrar la transacción (`deferrable initially
-- deferred`), no fila por fila al momento:
--   · una recepción de seis materiales entra en seis movimientos, uno tras
--     otro; al cerrar, cada RQ recibe un solo aviso con todos sus insumos, no
--     seis (auditor de realización, 26/11);
--   · si con ese ingreso el RQ quedó «Listo en almacén», ya recibió ese aviso y
--     este no se suma.
-- Por ser diferido, en la transacción que registró un ingreso la tabla
-- `movimientos_materiales` no acepta `alter table` («pending trigger events»)
-- hasta adelantarlo con `set constraints trg_rq_avisar_lo_que_llego immediate`.
-- Solo los checks lo hacen (414, 416 y 428 ya lo llevan).
--
-- Solo avisa al RQ al que ese ingreso le trajo algo. Lo que entra de una línea
-- de OC se reparte entre sus insumos en el orden en que se pidieron
-- (`llegado_de_la_linea_de_compra`): si entran 3 de 8 y le tocan todos al RQ
-- más antiguo, el más nuevo no recibe nada y no se le dice que vaya a recoger.
-- Tampoco avisa lo que entra de más cuando los insumos ya tienen lo suyo.
--
-- No avisa:
--   · lo que vuelve al almacén de una salida (`devolucion_de`): no es compra;
--   · al RQ anulado, entregado o ya «Listo en almacén», que ya tuvo su aviso;
--   · a quien registró el ingreso, si es el mismo que pidió (como `fn_rq_avisar`).
-- =============================================================================

create or replace function public.fn_rq_avisar_lo_que_llego()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_neto   numeric;
  v_oc     text;
  v_rq     record;
  v_titulo text;
  v_cola   constant text := '. Mira en el RQ cuánto ya puedes recoger.';
  v_previo public.notificaciones%rowtype;
  v_cuerpo text;
  v_fin    text;
begin
  if new.tipo <> 'INGRESO' or new.orden_compra_detalle_id is null or new.devolucion_de is not null
     or coalesce(new.cantidad, 0) <= 0 then
    return null;
  end if;

  -- Lo neto que entró de esa línea de OC, con este ingreso y sin él.
  select k.neto into v_neto from public.cuenta_de_la_linea_de_compra(new.orden_compra_detalle_id) k;
  select public.nombre_de_oc(c.numero, c.referencia) into v_oc
    from public.orden_compra_material_detalles d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where d.id = new.orden_compra_detalle_id;

  for v_rq in
    select r.id, r.numero, r.codigo_interno, r.creado_por,
           string_agg(trim_scale(d.llegado - a.llegado)::text || coalesce(' ' || u.codigo, '')
                      || ' del insumo ' || l.item || ', ' || l.descripcion, '; ' order by l.item) as piezas
      from public.llegado_de_la_linea_de_compra(new.orden_compra_detalle_id, v_neto - new.cantidad) a
      join public.llegado_de_la_linea_de_compra(new.orden_compra_detalle_id, v_neto) d on d.linea_id = a.linea_id
      join public.requerimiento_lineas l on l.id = d.linea_id
      join public.requerimientos r on r.id = l.requerimiento_id
      left join public.unidades_medida u on u.id = l.unidad_medida_id
     where d.llegado > a.llegado
       and r.estado in ('SIN_STOCK', 'EN_ATENCION')
       and r.creado_por is not null
     group by r.id, r.numero, r.codigo_interno, r.creado_por
  loop
    continue when not exists (select 1 from public.usuarios u where u.id = v_rq.creado_por and u.activo)
               or v_rq.creado_por is not distinct from public.usuario_actual();
    v_titulo := left('Llegó a almacén: ' || v_rq.numero, 200);

    -- El de la misma recepción (la misma transacción) suma sus insumos al aviso
    -- que ya tiene, sin leer, en vez de dejar otro.
    select * into v_previo from public.notificaciones n
     where n.usuario_id = v_rq.creado_por and n.origen_tabla = 'requerimientos' and n.origen_id = v_rq.id
       and n.titulo = v_titulo and n.creado_en = now() and n.leida_en is null
     order by n.id limit 1
     for update;
    if found then
      -- Si lo de antes es de la misma OC, la OC se nombra una vez, al final.
      v_fin := coalesce(' (' || v_oc || ')', '') || v_cola;
      if right(v_previo.cuerpo, char_length(v_fin)) = v_fin then
        v_cuerpo := left(v_previo.cuerpo, char_length(v_previo.cuerpo) - char_length(v_fin)) || '; ' || v_rq.piezas || v_fin;
      else
        v_cuerpo := replace(v_previo.cuerpo, v_cola, '; ' || v_rq.piezas || v_fin);
      end if;
      -- Si ya no cabe, queda como estaba: el RQ dice todo lo que llegó.
      if char_length(v_cuerpo) <= 500 and v_cuerpo <> v_previo.cuerpo then
        update public.notificaciones set cuerpo = v_cuerpo where id = v_previo.id;
      end if;
      continue;
    end if;

    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_rq.creado_por, v_titulo,
            left('Entró al almacén' || coalesce(', para ' || v_rq.codigo_interno, '') || ': '
                 || v_rq.piezas || coalesce(' (' || v_oc || ')', '') || v_cola, 500),
            '/requerimientos?rq=' || v_rq.id, 'requerimientos', v_rq.id);
  end loop;
  return null;
end;
$$;

comment on function public.fn_rq_avisar_lo_que_llego() is
  'Al cerrar la transacción en que entra al kardex lo comprado para un insumo de un RQ en compra, avisa por la campana a quien registró el RQ cuánto le llegó, un aviso por RQ (plan 3, entrega 3.1).';

revoke all on function public.fn_rq_avisar_lo_que_llego() from public, anon, authenticated;

-- Disparador de restricción para que corra al cerrar la transacción. No admite
-- `create or replace`: se crea solo si no está.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_rq_avisar_lo_que_llego'
                    and tgrelid = 'public.movimientos_materiales'::regclass) then
    create constraint trigger trg_rq_avisar_lo_que_llego
      after insert on public.movimientos_materiales
      deferrable initially deferred
      for each row
      when (new.tipo = 'INGRESO' and new.orden_compra_detalle_id is not null and new.devolucion_de is null)
      execute function public.fn_rq_avisar_lo_que_llego();
  end if;
end $$;
