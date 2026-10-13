-- =============================================================================
-- LOS CUATRO ALMACENES Y LA SALIDA POR REQUERIMIENTO
-- -----------------------------------------------------------------------------
-- Gerencia pidió (2026-10-13) que Almacén se maneje como cuatro almacenes, cada
-- uno con su regla de salida, porque no es lo mismo entregar un disco de corte
-- que una plancha de acero:
--
--   * CONSUMIBLES: lo que más rota y más fácil sale. Sale como hasta hoy: a qué
--     unidad va, quién recibe y la foto.
--   * ACCESORIOS: van atados a un código interno de unidad. Un accesorio sale
--     solo para una unidad con código, y lo que entró para una unidad no sale
--     para otra.
--   * MATERIA PRIMA: es el almacén más caro. La salida se registra en el acto,
--     pero queda abierta hasta que se adjunta el escaneo del formato de
--     recepción firmado por el almacenero y por quien recibe.
--   * EPP: igual que materia prima, con el formato de entrega de EPP.
--
-- Cada categoría del catálogo dice a qué almacén pertenece; el material lo
-- hereda. Lo que entró a mano «POR CLASIFICAR» no tiene almacén todavía: sale
-- con la regla de consumibles y el tablero lo muestra aparte para ordenarlo.
--
-- Y la salida se puede hacer por el requerimiento (RQ-0001-2026…): el RQ dice
-- qué área lo pidió y para qué código interno, así que la salida lo hereda y
-- la línea del RQ sabe cuánto se le entregó. Las tablas del requerimiento son
-- del área de Requerimientos: aquí solo se leen.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Cada categoría dice a qué almacén pertenece ------------------------------
alter table public.categorias_material add column if not exists almacen text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_categoria_almacen'
                   and conrelid = 'public.categorias_material'::regclass) then
    alter table public.categorias_material add constraint ck_categoria_almacen
      check (almacen is null or almacen in ('EPP', 'CONSUMIBLES', 'ACCESORIOS', 'MATERIA_PRIMA'));
  end if;
end $$;
comment on column public.categorias_material.almacen is
  'A cuál de los cuatro almacenes pertenece la familia: EPP, CONSUMIBLES, ACCESORIOS o MATERIA_PRIMA. Sin almacén: por clasificar.';

-- Las familias de hoy, repartidas en los cuatro. Lo que la empresa quiera mover
-- de almacén se cambia aquí, no en la pantalla.
do $$ begin
  update public.categorias_material set almacen = case
    when codigo in ('EPP', 'ALM_EQUIPO_DE_PROTECCION_PERSONAL') then 'EPP'
    when codigo in ('CONSUMIBLES', 'SOLDADURA', 'PINTURA', 'FERRETERIA', 'ALM_CONSUMIBLES_E_INSUMOS',
                    'ALM_INSUMO_AUXILIAR_MATERIAL_INDIRECTO', 'ALM_PINTURAS_Y_QUIMICOS', 'ALM_EQUIPOS_Y_MAQUINARIA')
      then 'CONSUMIBLES'
    when codigo in ('ACCESORIOS', 'HIDRAULICO', 'ELECTRICO', 'SUSPENSION', 'ALM_ACCESORIOS_ESTRUCTURALES',
                    'ALM_SISTEMA_DE_FRENOS', 'ALM_SISTEMA_DE_LUBRICACION', 'ALM_SISTEMA_DE_SEGURIDAD',
                    'ALM_SISTEMA_DE_SUSPENSION', 'ALM_SISTEMA_ELECTRICO', 'ALM_SISTEMA_HIDRAULICO',
                    'ALM_SISTEMA_MECANICO', 'ALM_SISTEMA_NEUMATICO')
      then 'ACCESORIOS'
    when codigo in ('ACERO', 'ALM_MATERIA_PRIMA') or codigo like 'ACERO\_%' then 'MATERIA_PRIMA'
  end
  where almacen is null and codigo <> 'ALM_POR_CLASIFICAR';
  -- Una subfamilia hereda el almacén de su familia.
  update public.categorias_material h set almacen = p.almacen
    from public.categorias_material p
   where h.categoria_padre_id = p.id and h.almacen is null and p.almacen is not null;
end $$;

create or replace function public.almacen_de_material(p_material uuid)
returns text language sql stable security definer set search_path = 'public' as $$
  select c.almacen from public.materiales m join public.categorias_material c on c.id = m.categoria_id
   where m.id = p_material;
$$;
revoke all on function public.almacen_de_material(uuid) from public, anon;
grant execute on function public.almacen_de_material(uuid) to authenticated;

-- 2. Lo que cada movimiento necesita saber de más ------------------------------
alter table public.movimientos_materiales
  add column if not exists codigo_interno text,
  add column if not exists requerimiento_linea_id uuid references public.requerimiento_lineas(id) on delete restrict,
  add column if not exists formato_ruta text,
  add column if not exists formato_cerrado_en timestamptz,
  add column if not exists formato_cerrado_por uuid references public.usuarios(id) on delete restrict;
comment on column public.movimientos_materiales.codigo_interno is
  'Código interno de la unidad para la que entró o salió el material. En accesorios manda: lo que entró para una unidad no sale para otra.';
comment on column public.movimientos_materiales.requerimiento_linea_id is
  'La línea del requerimiento (RQ) que esta salida atiende. La línea sabe así cuánto se le entregó.';
comment on column public.movimientos_materiales.formato_ruta is
  'Escaneo del formato de recepción firmado (materia prima) o de entrega de EPP. Mientras falte, la salida está abierta.';

-- Índice de la llave al RQ: (b) la vista de salidas por requerimiento suma lo
-- entregado por línea. El de formato_ruta, como el de la foto: una ruta, un
-- movimiento. formato_cerrado_por: (a), (b) y (c) no se cumplen; sin índice.
create index if not exists ix_movimientos_rq_linea on public.movimientos_materiales (requerimiento_linea_id)
  where requerimiento_linea_id is not null;
create unique index if not exists idx_movimientos_formato on public.movimientos_materiales (formato_ruta)
  where formato_ruta is not null;

-- 3. El escaneo del formato va al mismo bucket que la foto -----------------------
do $$ begin
  update storage.buckets
     set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
   where id = 'evidencias-almacen';
end $$;
-- Quien ve la salida ve su formato; una carga suelta se puede retirar mientras
-- ninguna salida la nombre. Las políticas se cambian, no se recrean.
alter policy almacen_leer_evidencia on storage.objects using (
  bucket_id = 'evidencias-almacen'
  and ((owner_id = (select auth.uid())::text and (select public.tiene_permiso('almacen.despachar')))
    or exists (select 1 from public.movimientos_materiales m
                where m.foto_ruta = objects.name or m.formato_ruta = objects.name)));
alter policy almacen_retirar_evidencia_suelta on storage.objects using (
  bucket_id = 'evidencias-almacen' and owner_id = (select auth.uid())::text
  and not exists (select 1 from public.movimientos_materiales m
                   where m.foto_ruta = objects.name or m.formato_ruta = objects.name));

-- 4. Supervisión ve los requerimientos: va a recoger de almacén lo que ya está --
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'requerimientos.ver' from public.roles r where r.codigo in ('SUPERVISOR', 'ALMACENERO')
on conflict do nothing;

-- 5. Las líneas de requerimiento que Almacén puede atender -----------------------
-- Lo que pide cada RQ vivo, con lo ya entregado y lo pendiente. security_invoker:
-- quien la lee necesita ver requerimientos y movimientos.
create or replace view public.v_rq_lineas_para_salida with (security_invoker = true) as
select l.id as linea_id, r.id as requerimiento_id, r.numero, r.codigo_interno, a.nombre as area, r.estado,
       r.fecha_requerida, l.item, l.descripcion, l.cantidad::numeric as cantidad, um.codigo as unidad,
       c.nombre as categoria, c.almacen,
       coalesce(s.entregado, 0)::numeric as entregado,
       greatest(l.cantidad - coalesce(s.entregado, 0), 0)::numeric as pendiente
  from public.requerimiento_lineas l
  join public.requerimientos r on r.id = l.requerimiento_id
  join public.areas a on a.id = r.area_id
  join public.unidades_medida um on um.id = l.unidad_medida_id
  join public.categorias_material c on c.id = l.categoria_id
  left join lateral (
    select sum(m.cantidad) filter (where m.tipo = 'SALIDA')
         - coalesce(sum(d.cantidad), 0) as entregado
      from public.movimientos_materiales m
      left join public.movimientos_materiales d on d.devolucion_de = m.id and d.tipo = 'INGRESO'
     where m.requerimiento_linea_id = l.id) s on true
 where r.estado <> 'ANULADO';
revoke all on public.v_rq_lineas_para_salida from public, anon;
grant select on public.v_rq_lineas_para_salida to authenticated;

-- 6. La salida, con la regla de su almacén y el requerimiento que atiende ---------
-- Misma salida que registrar_salida_almacen (20261001100000) más: el almacén
-- del material decide qué exige; la línea del RQ, si viene, pone el código
-- interno y descuenta lo pendiente. registrar_salida_almacen queda como atajo
-- sin requerimiento, para la planilla y lo que ya la llama.
create or replace function public.registrar_salida_material(
  p_id uuid, p_material uuid, p_cantidad numeric, p_unidad uuid, p_codigo text,
  p_motivo text, p_recibe text, p_foto text, p_requerimiento_linea uuid)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  v_codigo text := nullif(upper(regexp_replace(btrim(coalesce(p_codigo, '')), '\s+', ' ', 'g')), '');
  v_unidad uuid := p_unidad;
  v_coincide uuid[];
  v_existente public.movimientos_materiales%rowtype;
  v_objeto storage.objects%rowtype;
  v_reserva numeric;
  v_libre numeric;
  v_almacen text;
  v_codigo_interno text;
  v_linea public.v_rq_lineas_para_salida%rowtype;
  v_reservado_otros numeric;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_material is null or p_cantidad is null or p_cantidad <= 0 or p_cantidad <> round(p_cantidad, 3)
     or length(btrim(coalesce(p_motivo, ''))) not between 3 and 200
     or length(btrim(coalesce(p_recibe, ''))) not between 3 and 160
     or p_foto is null
     or p_foto not in (auth.uid()::text || '/' || p_id::text || '.jpg',
                       auth.uid()::text || '/' || p_id::text || '.png',
                       auth.uid()::text || '/' || p_id::text || '.webp') then
    raise exception 'Indica material, cantidad, motivo, quién recibe y la foto de la salida.';
  end if;

  -- La línea del requerimiento: viva, con saldo por entregar, y del mismo almacén.
  if p_requerimiento_linea is not null then
    select * into v_linea from public.v_rq_lineas_para_salida where linea_id = p_requerimiento_linea;
    if not found then
      raise exception 'Esa línea de requerimiento no existe o el requerimiento está anulado.';
    end if;
    -- Un reintento del mismo envío ya descontó lo suyo: no se cuenta dos veces.
    if v_linea.pendiente + coalesce((select m.cantidad from public.movimientos_materiales m
                                      where m.id = p_id and m.requerimiento_linea_id = p_requerimiento_linea), 0) < p_cantidad then
      raise exception 'El requerimiento % pide % % de «%» y ya se entregó %: quedan % por entregar.',
        v_linea.numero, trim_scale(v_linea.cantidad), v_linea.unidad, v_linea.descripcion, trim_scale(v_linea.entregado), trim_scale(v_linea.pendiente);
    end if;
    -- Si no se dijo a qué unidad va, va a la del requerimiento.
    if v_unidad is null and v_codigo is null and upper(v_linea.codigo_interno) <> 'PLANTA' then
      v_codigo := upper(regexp_replace(btrim(v_linea.codigo_interno), '\s+', ' ', 'g'));
    end if;
  end if;
  if (v_unidad is null) = (v_codigo is null) then
    raise exception 'Vincula la salida a un vehículo registrado o escribe el código de la unidad, uno de los dos.';
  end if;

  if v_unidad is not null then
    perform 1 from public.unidades where id = v_unidad and activo;
    if not found then raise exception 'La unidad elegida no existe o está desactivada.'; end if;
  else
    if length(v_codigo) not between 3 and 60 then
      raise exception 'El código de la unidad debe tener de 3 a 60 caracteres.';
    end if;
    -- Si el código escrito es el de una unidad registrada, la salida se vincula
    -- a ella: así el mismo vehículo no aparece con dos nombres en el kardex.
    select array_agg(u.id) into v_coincide from public.unidades u
     where u.activo and (upper(btrim(u.codigo_interno)) = v_codigo or upper(btrim(u.placa)) = v_codigo);
    if cardinality(v_coincide) = 1 then
      v_unidad := v_coincide[1];
      v_codigo := null;
    end if;
  end if;

  perform 1 from public.materiales where id = p_material and activo for update;
  if not found then raise exception 'El material no está activo.'; end if;
  v_almacen := public.almacen_de_material(p_material);
  if v_linea.almacen is not null and v_almacen is not null and v_linea.almacen <> v_almacen then
    raise exception 'El requerimiento % pide «%» (%), y este material es de %: elige un material de ese almacén.',
      v_linea.numero, v_linea.descripcion, v_linea.categoria, lower(replace(v_almacen, '_', ' '));
  end if;

  -- El código interno para el que sale: el del RQ, el escrito, o el de la unidad.
  v_codigo_interno := coalesce(
    nullif(upper(btrim(v_linea.codigo_interno)), 'PLANTA'),
    v_codigo,
    (select nullif(upper(btrim(u.codigo_interno)), '') from public.unidades u where u.id = v_unidad));
  if v_almacen = 'ACCESORIOS' and v_codigo_interno is null then
    raise exception 'Un accesorio sale solo para una unidad con código interno: escribe el código de la unidad o elige el requerimiento que lo pide.';
  end if;

  select * into v_existente from public.movimientos_materiales where id = p_id;
  if found then
    if v_existente.tipo = 'SALIDA' and v_existente.registrado_por = public.usuario_actual()
       and v_existente.material_id = p_material and v_existente.cantidad = p_cantidad
       and v_existente.foto_ruta = p_foto and v_existente.recibido_por_nombre = btrim(p_recibe)
       and v_existente.documento_referencia = btrim(p_motivo)
       and v_existente.unidad_id is not distinct from v_unidad
       and v_existente.requerimiento_linea_id is not distinct from p_requerimiento_linea then
      return p_id;
    end if;
    raise exception 'Esa salida ya existe con otros datos. Recarga el kardex.';
  end if;

  select * into v_objeto from storage.objects where bucket_id = 'evidencias-almacen' and name = p_foto;
  if not found or v_objeto.owner_id is distinct from auth.uid()::text
     or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'Carga una foto válida antes de confirmar la salida.';
  end if;

  -- Lo reservado para solicitudes de OT no se entrega por salida general.
  select coalesce(sum(greatest(coalesce(d.cantidad_stock, case when d.decision_almacen = 'STOCK' then d.cantidad_solicitada else 0 end)
                               + coalesce(s.ingresado, 0) - coalesce(s.cantidad, 0), 0)), 0)
    into v_reserva
    from public.requerimiento_material_detalles d
    join public.ot_materiales om on om.id = d.ot_material_id
    join public.ordenes_trabajo ot on ot.id = om.orden_id
    left join lateral (
      select sum(x.cantidad) filter (where x.tipo = 'DESPACHO') cantidad,
             sum(x.cantidad) filter (where x.tipo = 'INGRESO' and x.origen = 'COMPRA') ingresado
        from public.movimientos_materiales x where x.requerimiento_detalle_id = d.id) s on true
   where om.material_id = p_material and d.decision_almacen in ('STOCK', 'COMPRA') and ot.estado::text <> 'ANULADA';
  v_libre := greatest(public.saldo_registrado_material(p_material) - v_reserva, 0);
  if p_cantidad > v_libre then
    raise exception 'Solo hay % libre de este material; lo demás está reservado para solicitudes de OT o no está en almacén.', v_libre;
  end if;

  -- Un accesorio que entró para una unidad no sale para otra.
  if v_almacen = 'ACCESORIOS' then
    select coalesce(sum(greatest(x.entradas - x.salidas, 0)), 0) into v_reservado_otros
      from (select upper(m.codigo_interno) as codigo,
                   sum(case when m.tipo = 'INGRESO' then m.cantidad else 0 end) as entradas,
                   sum(case when m.tipo <> 'INGRESO' then m.cantidad else 0 end) as salidas
              from public.movimientos_materiales m
             where m.material_id = p_material and m.codigo_interno is not null
               and upper(m.codigo_interno) <> v_codigo_interno
             group by upper(m.codigo_interno)) x;
    if p_cantidad > v_libre - v_reservado_otros then
      raise exception 'De este accesorio hay % libre para la unidad %: % entró para otras unidades y sale solo para ellas.',
        trim_scale(greatest(v_libre - v_reservado_otros, 0)), v_codigo_interno, trim_scale(v_reservado_otros);
    end if;
  end if;

  insert into public.movimientos_materiales(id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
    cantidad_de_stock, foto_ruta, recibido_por_nombre, unidad_id, codigo_unidad, codigo_interno, requerimiento_linea_id)
  values (p_id, 'SALIDA', p_material, p_cantidad, 'SALIDA_GENERAL', btrim(p_motivo), public.usuario_actual(),
    p_cantidad, p_foto, btrim(p_recibe), v_unidad, v_codigo, v_codigo_interno, p_requerimiento_linea);
  return p_id;
end $$;
revoke all on function public.registrar_salida_material(uuid, uuid, numeric, uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.registrar_salida_material(uuid, uuid, numeric, uuid, text, text, text, text, uuid) to authenticated;

create or replace function public.registrar_salida_almacen(
  p_id uuid, p_material uuid, p_cantidad numeric, p_unidad uuid, p_codigo text,
  p_motivo text, p_recibe text, p_foto text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
begin
  return public.registrar_salida_material(p_id, p_material, p_cantidad, p_unidad, p_codigo, p_motivo, p_recibe, p_foto, null);
end $$;

-- 7. Cerrar la salida con el formato firmado ---------------------------------------
-- Materia prima y EPP salen con un formato en papel que firman el almacenero y
-- quien recibe. El escaneo cierra la salida. Cualquier almacenero puede cerrar
-- la que otro abrió; el archivo lo sube quien cierra, bajo su propia carpeta.
create or replace function public.cerrar_salida_con_formato(p_id uuid, p_ruta text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  v_mov public.movimientos_materiales%rowtype;
  v_objeto storage.objects%rowtype;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_ruta is null
     or p_ruta not in (auth.uid()::text || '/' || p_id::text || '-formato.pdf',
                       auth.uid()::text || '/' || p_id::text || '-formato.jpg',
                       auth.uid()::text || '/' || p_id::text || '-formato.png',
                       auth.uid()::text || '/' || p_id::text || '-formato.webp') then
    raise exception 'Adjunta el formato firmado, en PDF o foto, para cerrar la salida.';
  end if;
  select * into v_mov from public.movimientos_materiales where id = p_id and tipo = 'SALIDA' for update;
  if not found then raise exception 'La salida no existe.'; end if;
  if v_mov.formato_ruta is not null then
    if v_mov.formato_ruta = p_ruta then return p_id; end if;
    raise exception 'Esa salida ya tiene su formato firmado.';
  end if;
  select * into v_objeto from storage.objects where bucket_id = 'evidencias-almacen' and name = p_ruta;
  if not found or v_objeto.owner_id is distinct from auth.uid()::text
     or v_objeto.metadata->>'mimetype' not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'Carga el formato firmado (PDF o foto de hasta 10 MB) antes de cerrar la salida.';
  end if;
  update public.movimientos_materiales
     set formato_ruta = p_ruta, formato_cerrado_en = now(), formato_cerrado_por = public.usuario_actual()
   where id = p_id;
  return p_id;
end $$;
revoke all on function public.cerrar_salida_con_formato(uuid, text) from public, anon;
grant execute on function public.cerrar_salida_con_formato(uuid, text) to authenticated;

-- 8. Las vistas dicen de qué almacén es cada cosa --------------------------------
-- Mismo texto que 20260930091000 más el almacén y la categoría, al final.
create or replace view public.v_existencias_materiales with (security_invoker = true) as
with movimientos as (
  select coalesce(mov.material_id, om.material_id) material_id,
    sum(case when mov.tipo = 'INGRESO' then mov.cantidad else -mov.cantidad end) saldo
  from public.movimientos_materiales mov
  left join public.requerimiento_material_detalles d on d.id = mov.requerimiento_detalle_id
  left join public.ot_materiales om on om.id = d.ot_material_id group by coalesce(mov.material_id, om.material_id)
), conteos as (select material_id, sum(ajuste) ajuste from public.conteos_inventario group by material_id),
reservas as (
  select om.material_id, sum(greatest(coalesce(d.cantidad_stock, case when d.decision_almacen = 'STOCK' then d.cantidad_solicitada else 0 end) + coalesce(s.ingresado, 0) - coalesce(s.cantidad, 0), 0)) reservado
  from public.requerimiento_material_detalles d join public.ot_materiales om on om.id = d.ot_material_id
  join public.ordenes_trabajo ot on ot.id = om.orden_id
  left join lateral(select sum(x.cantidad) filter(where x.tipo = 'DESPACHO') cantidad,
      sum(x.cantidad) filter(where x.tipo = 'INGRESO' and x.origen = 'COMPRA') ingresado
    from public.movimientos_materiales x where x.requerimiento_detalle_id = d.id) s on true
  where ot.estado::text <> 'ANULADA' and d.decision_almacen in ('STOCK', 'COMPRA') group by om.material_id
)
select mat.id material_id, mat.codigo, mat.descripcion, um.codigo unidad,
  (coalesce(m.saldo, 0) + coalesce(c.ajuste, 0))::public.cantidad existencia,
  coalesce(r.reservado, 0)::numeric reservado,
  greatest(coalesce(m.saldo, 0) + coalesce(c.ajuste, 0) - coalesce(r.reservado, 0), 0)::numeric disponible,
  cat.almacen, cat.nombre as categoria
from public.materiales mat left join public.unidades_medida um on um.id = mat.unidad_medida_id
left join public.categorias_material cat on cat.id = mat.categoria_id
left join movimientos m on m.material_id = mat.id left join conteos c on c.material_id = mat.id left join reservas r on r.material_id = mat.id
where mat.activo and (m.material_id is not null or c.material_id is not null or r.material_id is not null);

-- Mismo texto que 20261001200000 más el almacén, el código interno, el RQ y el
-- formato, al final. formato_pendiente: salida de materia prima o EPP sin cerrar.
create or replace view public.v_kardex_almacen with (security_invoker = true) as
with eventos as (
  select m.id, m.registrado_en as fecha, m.material_id,
         m.tipo as movimiento, m.origen,
         case when m.tipo = 'INGRESO' then m.cantidad::numeric else 0 end as entrada,
         case when m.tipo <> 'INGRESO' then m.cantidad::numeric else 0 end as salida,
         m.documento_referencia as documento, m.unidad_id, m.codigo_unidad, m.orden_id,
         m.recibido_por_nombre, m.registrado_por, m.precio_unitario, m.moneda,
         m.foto_ruta is not null as con_foto, m.devolucion_de,
         m.desde_planilla, m.cargado_en,
         m.codigo_interno, m.requerimiento_linea_id, m.formato_ruta
    from public.movimientos_materiales m
  union all
  select c.id, c.registrado_en, c.material_id,
         'AJUSTE', 'CONTEO',
         greatest(c.ajuste::numeric, 0), greatest(-c.ajuste::numeric, 0),
         c.motivo, null, null, null,
         null, c.registrado_por, null, null,
         false, null,
         false, c.registrado_en,
         null, null, null
    from public.conteos_inventario c
), con_saldo as (
  select e.*,
         sum(e.entrada - e.salida) over (partition by e.material_id order by e.fecha, e.id
                                         rows between unbounded preceding and current row) as saldo
    from eventos e
)
select k.id, k.fecha, k.material_id,
       mat.codigo as material_codigo, mat.descripcion as material, um.codigo as unidad_medida,
       k.movimiento, k.origen, k.entrada, k.salida, k.saldo,
       k.documento, k.unidad_id, k.codigo_unidad, k.orden_id, ot.numero as orden_numero,
       k.recibido_por_nombre, k.registrado_por,
       nullif(btrim(concat_ws(' ', us.nombres, us.apellidos)), '') as registrado_por_nombre,
       k.precio_unitario, k.moneda, k.con_foto, k.devolucion_de,
       k.desde_planilla, k.cargado_en,
       cat.almacen, k.codigo_interno, k.requerimiento_linea_id, rq.numero as requerimiento_numero,
       k.formato_ruta is not null as con_formato,
       (k.movimiento = 'SALIDA' and cat.almacen in ('MATERIA_PRIMA', 'EPP') and k.formato_ruta is null) as formato_pendiente
  from con_saldo k
  left join public.materiales mat on mat.id = k.material_id
  left join public.categorias_material cat on cat.id = mat.categoria_id
  left join public.unidades_medida um on um.id = mat.unidad_medida_id
  left join public.ordenes_trabajo ot on ot.id = k.orden_id
  left join public.usuarios us on us.id = k.registrado_por
  left join public.requerimiento_lineas rl on rl.id = k.requerimiento_linea_id
  left join public.requerimientos rq on rq.id = rl.requerimiento_id;
revoke all on public.v_kardex_almacen from public, anon;
grant select on public.v_kardex_almacen to authenticated;
