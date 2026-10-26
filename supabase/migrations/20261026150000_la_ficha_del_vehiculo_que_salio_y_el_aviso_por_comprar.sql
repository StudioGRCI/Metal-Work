-- Dos cosas que DKS decidió el 26/10/2026 sobre los puntos del manual v4 de
-- Requerimientos.
--
-- 1. La ficha de un vehículo que ya salió queda como estaba. Un vehículo que
--    sale sin esperar la ficha (a la cochera o al arenado) seguía con «Guardar
--    avance» y «Cerrar ingreso»: se podía cambiar después lo que se anotó al
--    recibirlo. Ahora guardar_ficha_vehiculo se niega si el ingreso ya tiene
--    su salida. Adjuntar el escaneo firmado de una ficha ya cerrada sigue
--    abierto: no cambia lo anotado, guarda la evidencia en papel. Si vuelve del
--    arenado, entra con un ingreso nuevo y su propia ficha.
--
--    Como en la 20261023150000, la función no se copia entera: se mete la
--    regla nueva junto a la del ingreso anulado sobre pg_get_functiondef, que
--    conserva security definer, su search_path y sus permisos. Si no está ni el
--    fragmento viejo ni el nuevo, la función cambió por otro lado y la
--    migración se detiene sin tocar nada.
--
-- 2. Quien registró el RQ se entera cuando queda «Por comprar». Almacén lo
--    revisa y, si le falta algo, el aviso iba solo a Logística; Requerimientos
--    lo sabía al mirar la lista. Ahora le llega «Por comprar: RQ-…» con lo que
--    falta, igual que le llega «Listo en almacén» cuando está todo. Va en un
--    disparador propio, sin copiar rq_revisar_stock. El RQ de Administración
--    no lo lleva: quien lo registra es la administradora, que ya recibe el
--    aviso para comprarlo.
--
-- 3. «Almacén no tiene nada» solo cuando de verdad no tiene nada. El aviso a
--    Logística lo decía cuando todos los insumos tenían faltante, aunque
--    Almacén tuviera una parte de alguno (3 faros pedidos y 2 en stock: «no
--    tiene nada»). Lo vio el auditor de este cambio. Se corrige igual que el 1,
--    sobre el fragmento; los avisos ya enviados no se reescriben.
--
-- 4. La corrección de un RQ listo en almacén le avisa a Almacén. DKS dejó a
--    criterio el aviso de la corrección: iba a Almacén solo si el RQ seguía
--    por revisar y, si no, a Logística. Con el RQ listo, quien tiene separado
--    el material y lo entrega es Almacén, y Logística no tiene nada que
--    comprar: el aviso va a Almacén. La pantalla dice lo mismo.

-- =============================================== 1. La ficha del que salió
do $$
declare
  v_def   text;
  v_viejo text := $v$  if v_registro.anulado_en is not null then
    raise exception 'Ese ingreso está anulado: su ficha ya no se llena.' using errcode = 'check_violation';
  end if;
$v$;
  v_regla text := $v$  if v_registro.salida_en is not null then
    raise exception 'El vehículo ya salió de la planta: su ficha queda como estaba.' using errcode = 'check_violation';
  end if;
$v$;
begin
  v_def := replace(pg_get_functiondef('public.guardar_ficha_vehiculo(uuid, text, jsonb)'::regprocedure), E'\r', '');
  if position(v_regla in v_def) > 0 then
    return;
  end if;
  if position(v_viejo in v_def) = 0 then
    raise exception 'guardar_ficha_vehiculo cambió: no tiene la regla del ingreso anulado como la conoce el repositorio. Revisarla a mano antes de seguir.';
  end if;
  execute replace(v_def, v_viejo, v_viejo || v_regla);
end $$;

comment on function public.guardar_ficha_vehiculo(uuid, text, jsonb) is
  'Guarda la ficha única de ingreso y salida de un ingreso de vehículo (GUARDAR), o la guarda y cierra el ingreso (CERRAR_INGRESO) o la salida (CERRAR_SALIDA). Requerimientos (vehiculos.registrar). Con el vehículo ya fuera de la planta, la ficha queda como estaba.';

-- ============================================ 2. «Por comprar» a quien lo pidió
create or replace function public.fn_rq_avisar_por_comprar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_total     integer;
  v_faltan    integer;
  v_con_stock integer;
  v_detalle   text;
begin
  select count(*), count(*) filter (where l.cantidad_en_stock < l.cantidad), count(*) filter (where l.cantidad_en_stock > 0),
         string_agg(case when l.cantidad_en_stock < l.cantidad then
                      rtrim(to_char(l.cantidad - l.cantidad_en_stock, 'FM999999990.999'), '.') || ' ' || coalesce(um.codigo, '') || ' ' || l.descripcion
                    end, '; ' order by l.item)
    into v_total, v_faltan, v_con_stock, v_detalle
    from public.requerimiento_lineas l
    left join public.unidades_medida um on um.id = l.unidad_medida_id
   where l.requerimiento_id = new.id;

  perform public.fn_rq_avisar(new, 'Por comprar: ' || new.numero,
    left(case when v_con_stock = 0 then 'Almacén no tiene nada' else 'Almacén tiene parte' end
         || '; Logística compra ' || v_faltan || ' de ' || v_total || case when v_total = 1 then ' insumo' else ' insumos' end
         || coalesce(' · ' || new.codigo_interno, '') || coalesce(': ' || v_detalle, ''), 500),
    'EMISOR');
  return null;
end;
$$;
comment on function public.fn_rq_avisar_por_comprar() is
  'Disparador: cuando Almacén revisa un RQ de operación y le falta algo (POR_ATENDER → SIN_STOCK), avisa a quien lo registró qué compra Logística.';
revoke all on function public.fn_rq_avisar_por_comprar() from public, anon, authenticated;

drop trigger if exists trg_rq_avisar_por_comprar on public.requerimientos;
create trigger trg_rq_avisar_por_comprar
  after update of estado on public.requerimientos
  for each row
  when (old.estado = 'POR_ATENDER' and new.estado = 'SIN_STOCK' and new.tipo is distinct from 'ADMINISTRACION')
  execute function public.fn_rq_avisar_por_comprar();

-- ======================================= 3. «No tiene nada», solo si no tiene nada
do $$
declare
  v_def   text;
  v_viejo text := $v$case when v_faltan = v_total then 'Almacén no tiene nada. ' else 'Almacén tiene parte. ' end$v$;
  v_nuevo text := $v$case when not exists (select 1 from public.requerimiento_lineas x
                                     where x.requerimiento_id = p_id and x.cantidad_en_stock > 0)
                then 'Almacén no tiene nada. ' else 'Almacén tiene parte. ' end$v$;
begin
  v_def := replace(pg_get_functiondef('public.rq_revisar_stock(uuid, jsonb, text)'::regprocedure), E'\r', '');
  if position(v_viejo in v_def) > 0 then
    execute replace(v_def, v_viejo, v_nuevo);
  elsif position(v_nuevo in v_def) = 0 then
    raise exception 'rq_revisar_stock cambió: no tiene el aviso a Logística como lo conoce el repositorio. Revisarla a mano antes de seguir.';
  end if;
end $$;

-- ======================================= 4. Corregir un RQ listo avisa a Almacén
do $$
declare
  v_def   text;
  v_viejo text := $v$case when v_rq.estado = 'POR_ATENDER' then 'ALMACEN' else 'LOGISTICA' end$v$;
  v_nuevo text := $v$case when v_rq.estado in ('POR_ATENDER', 'LISTO_EN_ALMACEN') then 'ALMACEN' else 'LOGISTICA' end$v$;
begin
  v_def := replace(pg_get_functiondef('public.corregir_requerimiento(uuid, uuid, text, text, text, jsonb)'::regprocedure), E'\r', '');
  if position(v_viejo in v_def) > 0 then
    execute replace(v_def, v_viejo, v_nuevo);
  elsif position(v_nuevo in v_def) = 0 then
    raise exception 'corregir_requerimiento cambió: no tiene el aviso de la corrección como lo conoce el repositorio. Revisarla a mano antes de seguir.';
  end if;
end $$;
