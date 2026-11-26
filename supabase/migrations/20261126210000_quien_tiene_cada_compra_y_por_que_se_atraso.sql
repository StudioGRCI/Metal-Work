-- =============================================================================
-- QUIÉN TIENE CADA COMPRA Y POR QUÉ SE ATRASÓ
-- -----------------------------------------------------------------------------
-- Desde la entrega 4.1 Logística ve qué OC y qué OS pasaron la fecha que
-- prometió el proveedor. Le faltaban dos cosas para poder hacer algo con eso
-- (Plan 4. Logística, entrega 4.2):
--
--   · Saber quién la tiene detenida. Una OC atrasada no siempre es culpa del
--     proveedor: puede estar esperando a Gerencia, la guía de Contabilidad, el
--     recojo del conductor o la validación de Almacén. Aquí va el recorrido de
--     cada OC y cada OS, con la misma forma que el del requerimiento y la
--     cotización (Plan 0, migración 20261125130000): lo hecho con el puesto de
--     quien lo hizo, quién la tiene ahora y hace cuántos días, y lo que falta.
--   · Dejar escrito por qué se atrasó, y corregir la fecha cuando el proveedor
--     avisa otra. Lo anota quien emite las compras (`compras.crear`), de una
--     lista corta —proveedor, pago, transporte, aprobación u otro— y una nota,
--     con quién y cuándo.
--
-- La OC y la OS son documentos numerados: nada de esto las borra ni las
-- reescribe. La fecha que salió en el documento (`fecha_estimada` de la OC,
-- `fecha_fin` de la OS) queda como se emitió, y el PDF no cambia. Cada motivo y
-- cada fecha corregida es una fila nueva de `seguimiento_de_compras`, que no se
-- corrige ni se borra: la fecha que vale es la última corregida, y las de antes
-- quedan en el recorrido.
--
-- `plazos_de_compras` y `plazos_de_servicios` (entrega 4.1) pasan a contar el
-- atraso contra la fecha que vale hoy. Misma firma: `create or replace`.
--
-- Idempotente: `if not exists`, `create or replace` y políticas que se crean
-- solo si faltan. Sin DROP.
-- =============================================================================

-- =============================================================================
-- 1. EL SEGUIMIENTO DE CADA COMPRA
-- =============================================================================
create table if not exists public.seguimiento_de_compras (
  id                uuid primary key default gen_random_uuid(),
  orden_compra_id   uuid references public.ordenes_compra_materiales (id),
  orden_servicio_id uuid references public.ordenes_servicio (id),
  -- MOTIVO_ATRASO: por qué se atrasó. FECHA_ESPERADA: el proveedor prometió otra fecha.
  tipo              text not null,
  motivo            text not null,
  nota              text,
  -- Solo de FECHA_ESPERADA: la que valía antes y la nueva.
  fecha_anterior    date,
  fecha_nueva       date,
  registrado_por    uuid references public.usuarios (id) default public.usuario_actual(),
  registrado_en     timestamptz not null default now(),
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_seguimiento_un_documento check (num_nonnulls(orden_compra_id, orden_servicio_id) = 1),
  constraint ck_seguimiento_tipo check (tipo in ('MOTIVO_ATRASO', 'FECHA_ESPERADA')),
  constraint ck_seguimiento_motivo check (motivo in ('PROVEEDOR', 'PAGO', 'TRANSPORTE', 'APROBACION', 'OTRO')),
  constraint ck_seguimiento_nota check (
    nota is null or char_length(nota) between 1 and 500
  ),
  -- «Otro» no dice nada solo: lleva su nota.
  constraint ck_seguimiento_otro check (motivo <> 'OTRO' or char_length(btrim(coalesce(nota, ''))) >= 10),
  constraint ck_seguimiento_fechas check (
    (tipo = 'FECHA_ESPERADA' and fecha_nueva is not null and fecha_anterior is distinct from fecha_nueva)
    or (tipo = 'MOTIVO_ATRASO' and fecha_nueva is null and fecha_anterior is null)
  )
);

comment on table public.seguimiento_de_compras is
  'Por qué se atrasó cada OC u OS y cada vez que se corrigió la fecha que prometió el proveedor (Plan 4.2). Una fila por anotación; no se corrige ni se borra. La OC y la OS no se tocan: su fecha de emisión queda como salió en el documento.';

-- Índices: el recorrido y los plazos buscan el seguimiento de cada documento
-- por su llave, en cada listado (regla (b) de la skill `datos`). No hay otro
-- índice que empiece por estas columnas.
create index if not exists ix_seguimiento_de_compras_oc
  on public.seguimiento_de_compras (orden_compra_id, registrado_en) where orden_compra_id is not null;
create index if not exists ix_seguimiento_de_compras_os
  on public.seguimiento_de_compras (orden_servicio_id, registrado_en) where orden_servicio_id is not null;

alter table public.seguimiento_de_compras enable row level security;

-- Lo lee quien ve el documento: la política de la OC o de la OS decide, fila
-- por fila, porque el `exists` corre con el RLS de quien mira.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'seguimiento_de_compras'
                  and policyname = 'ver_seguimiento_de_compras') then
    create policy ver_seguimiento_de_compras on public.seguimiento_de_compras
      for select to authenticated
      using (
        exists (select 1 from public.ordenes_compra_materiales c where c.id = orden_compra_id)
        or exists (select 1 from public.ordenes_servicio s where s.id = orden_servicio_id)
      );
  end if;
end $$;

-- Nadie escribe directo: se anota con las dos funciones de abajo, y nada se
-- corrige ni se borra.
revoke all on public.seguimiento_de_compras from public, anon, authenticated;
grant select on public.seguimiento_de_compras to authenticated;

create or replace function public.fn_seguimiento_de_compras_queda()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  raise exception 'Lo anotado en el seguimiento de una compra queda como evidencia: no se corrige ni se borra. Anota otro motivo o corrige la fecha otra vez.'
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.fn_seguimiento_de_compras_queda() from public, anon, authenticated;

create or replace trigger trg_seguimiento_de_compras_queda
  before update or delete on public.seguimiento_de_compras
  for each row execute function public.fn_seguimiento_de_compras_queda();

do $$
begin
  perform public.activar_timestamps('seguimiento_de_compras');
  perform public.activar_auditoria('seguimiento_de_compras');
  perform public.activar_registro_de_prueba('seguimiento_de_compras');
end $$;

-- =============================================================================
-- 2. LA FECHA QUE VALE HOY
-- =============================================================================
-- La última corregida; si nunca se corrigió, la que salió en el documento.
create or replace function public.fecha_prometida_de_compra(p_oc uuid, p_os uuid)
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select s.fecha_nueva from public.seguimiento_de_compras s
      where s.tipo = 'FECHA_ESPERADA'
        and ((p_oc is not null and s.orden_compra_id = p_oc) or (p_os is not null and s.orden_servicio_id = p_os))
      order by s.registrado_en desc, s.creado_en desc, s.id desc
      limit 1),
    case when p_oc is not null then (select c.fecha_estimada from public.ordenes_compra_materiales c where c.id = p_oc)
         else (select o.fecha_fin from public.ordenes_servicio o where o.id = p_os) end);
$$;

comment on function public.fecha_prometida_de_compra(uuid, uuid) is
  'La fecha prometida que vale hoy para la OC (o la OS): la última corregida en seguimiento_de_compras o, si nunca se corrigió, la del documento. Ayudante interno.';

revoke all on function public.fecha_prometida_de_compra(uuid, uuid) from public, anon, authenticated;

-- =============================================================================
-- 3. ANOTAR POR QUÉ SE ATRASÓ
-- =============================================================================
-- Lo anota quien emite las compras, de la OC u OS vigente que está atrasada o
-- que llegó con atraso. El mismo envío repetido (mismo id, misma persona, mismo
-- contenido) da lo mismo; con otro contenido, el primero queda.
create or replace function public.anotar_motivo_atraso(
  p_id        uuid,
  p_tipo      text,
  p_documento uuid,
  p_motivo    text,
  p_nota      text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_previo public.seguimiento_de_compras%rowtype;
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_nombre text;
  v_dias   integer;
  v_vigente boolean;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del motivo.' using errcode = 'check_violation';
  end if;
  if p_tipo is null or p_tipo not in ('OC', 'OS') then
    raise exception 'Elige una orden de compra o de servicio.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.seguimiento_de_compras where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() or v_previo.tipo <> 'MOTIVO_ATRASO' then
      raise exception 'Este motivo ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    if v_previo.motivo = p_motivo and v_previo.nota is not distinct from v_nota
       and (case p_tipo when 'OC' then v_previo.orden_compra_id else v_previo.orden_servicio_id end) = p_documento then
      return p_id;
    end if;
    raise exception 'Este motivo ya quedó anotado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;

  if p_tipo = 'OC' then
    select public.nombre_de_oc(c.numero, c.referencia), c.aprobacion not in ('RECHAZADA', 'ANULADA')
      into v_nombre, v_vigente
      from public.ordenes_compra_materiales c where c.id = p_documento for update;
    if not found then
      raise exception 'La orden de compra no existe.' using errcode = 'check_violation';
    end if;
    select p.dias_atraso into v_dias from public.plazos_de_compras(array[p_documento]) p;
  else
    select o.numero, o.estado <> 'ANULADA' and o.aprobacion <> 'RECHAZADA'
      into v_nombre, v_vigente
      from public.ordenes_servicio o where o.id = p_documento for update;
    if not found then
      raise exception 'La orden de servicio no existe.' using errcode = 'check_violation';
    end if;
    select p.dias_atraso into v_dias from public.plazos_de_servicios(array[p_documento]) p;
  end if;

  if not v_vigente then
    raise exception 'La % está rechazada o anulada: no se atrasa.', v_nombre using errcode = 'check_violation';
  end if;
  if coalesce(v_dias, 0) <= 0 then
    raise exception 'La % no está atrasada: el motivo se anota cuando pasó la fecha prometida. Si el proveedor avisó otra fecha, corrígela.', v_nombre
      using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('PROVEEDOR', 'PAGO', 'TRANSPORTE', 'APROBACION', 'OTRO') then
    raise exception 'Elige el motivo: proveedor, pago, transporte, aprobación u otro.' using errcode = 'check_violation';
  end if;
  if p_motivo = 'OTRO' and char_length(coalesce(v_nota, '')) < 10 then
    raise exception 'Con «Otro», cuenta qué pasó en al menos 10 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;

  insert into public.seguimiento_de_compras (id, orden_compra_id, orden_servicio_id, tipo, motivo, nota)
  values (p_id, case when p_tipo = 'OC' then p_documento end, case when p_tipo = 'OS' then p_documento end,
          'MOTIVO_ATRASO', p_motivo, v_nota);
  return p_id;
end;
$$;

comment on function public.anotar_motivo_atraso(uuid, text, uuid, text, text) is
  'Anota por qué se atrasó una OC u OS vigente que pasó su fecha prometida: proveedor, pago, transporte, aprobación u otro (con nota). Exige compras.crear. No toca el documento.';

revoke all on function public.anotar_motivo_atraso(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.anotar_motivo_atraso(uuid, text, uuid, text, text) to authenticated;

-- =============================================================================
-- 4. CORREGIR LA FECHA QUE PROMETIÓ EL PROVEEDOR
-- =============================================================================
-- De la OC u OS vigente que todavía no llegó completa. La anterior queda en el
-- recorrido. La fecha nueva va de la emisión (o del inicio de la OS) a un año.
create or replace function public.corregir_fecha_esperada(
  p_id        uuid,
  p_tipo      text,
  p_documento uuid,
  p_fecha     date,
  p_motivo    text,
  p_nota      text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_previo   public.seguimiento_de_compras%rowtype;
  v_nota     text := nullif(btrim(coalesce(p_nota, '')), '');
  v_hoy      constant date := public.fecha_de_lima(now());
  v_nombre   text;
  v_vigente  boolean;
  v_completa timestamptz;
  v_desde    date;
  v_actual   date;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la fecha.' using errcode = 'check_violation';
  end if;
  if p_tipo is null or p_tipo not in ('OC', 'OS') then
    raise exception 'Elige una orden de compra o de servicio.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.seguimiento_de_compras where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() or v_previo.tipo <> 'FECHA_ESPERADA' then
      raise exception 'Esta corrección ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    if v_previo.fecha_nueva = p_fecha and v_previo.motivo = p_motivo and v_previo.nota is not distinct from v_nota
       and (case p_tipo when 'OC' then v_previo.orden_compra_id else v_previo.orden_servicio_id end) = p_documento then
      return p_id;
    end if;
    raise exception 'Esta corrección ya quedó anotada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;

  if p_tipo = 'OC' then
    select public.nombre_de_oc(c.numero, c.referencia), c.aprobacion not in ('RECHAZADA', 'ANULADA'),
           public.fecha_de_lima(c.creado_en)
      into v_nombre, v_vigente, v_desde
      from public.ordenes_compra_materiales c where c.id = p_documento for update;
    if not found then
      raise exception 'La orden de compra no existe.' using errcode = 'check_violation';
    end if;
    select p.completa_en into v_completa from public.plazos_de_compras(array[p_documento]) p;
  else
    select o.numero, o.estado <> 'ANULADA' and o.aprobacion <> 'RECHAZADA',
           greatest(public.fecha_de_lima(o.creado_en), o.fecha_inicio)
      into v_nombre, v_vigente, v_desde
      from public.ordenes_servicio o where o.id = p_documento for update;
    if not found then
      raise exception 'La orden de servicio no existe.' using errcode = 'check_violation';
    end if;
    select p.completa_en into v_completa from public.plazos_de_servicios(array[p_documento]) p;
  end if;

  if not v_vigente then
    raise exception 'La % está rechazada o anulada: su fecha ya no se corrige.', v_nombre using errcode = 'check_violation';
  end if;
  if v_completa is not null then
    raise exception 'La % ya %: su fecha ya no se corrige. Si llegó tarde, anota el motivo del atraso.', v_nombre,
      case p_tipo when 'OC' then 'llegó completa' else 'volvió conforme' end
      using errcode = 'check_violation';
  end if;
  if p_fecha is null then
    raise exception 'Elige la fecha nueva que prometió el proveedor.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_desde then
    raise exception 'La fecha nueva no puede ser anterior al %.', to_char(v_desde, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  if p_fecha > v_hoy + 365 then
    raise exception 'La fecha nueva va como mucho a un año de hoy.' using errcode = 'check_violation';
  end if;
  v_actual := public.fecha_prometida_de_compra(
    case when p_tipo = 'OC' then p_documento end, case when p_tipo = 'OS' then p_documento end);
  if p_fecha = v_actual then
    raise exception 'La % ya tiene esa fecha.', v_nombre using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('PROVEEDOR', 'PAGO', 'TRANSPORTE', 'APROBACION', 'OTRO') then
    raise exception 'Elige por qué cambia la fecha: proveedor, pago, transporte, aprobación u otro.' using errcode = 'check_violation';
  end if;
  if p_motivo = 'OTRO' and char_length(coalesce(v_nota, '')) < 10 then
    raise exception 'Con «Otro», cuenta qué pasó en al menos 10 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;

  insert into public.seguimiento_de_compras
    (id, orden_compra_id, orden_servicio_id, tipo, motivo, nota, fecha_anterior, fecha_nueva)
  values (p_id, case when p_tipo = 'OC' then p_documento end, case when p_tipo = 'OS' then p_documento end,
          'FECHA_ESPERADA', p_motivo, v_nota, v_actual, p_fecha);
  return p_id;
end;
$$;

comment on function public.corregir_fecha_esperada(uuid, text, uuid, date, text, text) is
  'Corrige la fecha que prometió el proveedor de una OC u OS vigente que todavía no llegó completa, con su motivo. La anterior queda en el recorrido. Exige compras.crear. El documento y su PDF no cambian.';

revoke all on function public.corregir_fecha_esperada(uuid, text, uuid, date, text, text) from public, anon;
grant execute on function public.corregir_fecha_esperada(uuid, text, uuid, date, text, text) to authenticated;

-- =============================================================================
-- 5. LOS PLAZOS, CONTRA LA FECHA QUE VALE HOY
-- =============================================================================
-- Igual que en la 20261126200000, con una sola diferencia: `esperada` es la
-- fecha corregida, si se corrigió.
create or replace function public.plazos_de_compras(p_ids uuid[])
returns table (
  documento   uuid,
  esperada    date,
  llego_en    timestamptz,
  completa_en timestamptz,
  dias_atraso integer,
  atrasada    boolean,
  por_llegar  jsonb,
  por_validar boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_hoy constant date := public.fecha_de_lima(now());
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver las órdenes de compra.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el plazo de hasta 500 órdenes de compra a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with oc as (
    select c.id, public.fecha_prometida_de_compra(c.id, null) as fecha_estimada, c.entregado_almacen_en, c.creado_en,
           c.aprobacion not in ('RECHAZADA', 'ANULADA') as vigente
      from public.ordenes_compra_materiales c
     where c.id = any(p_ids)
       -- El mismo alcance que el listado de OC: Logística todas; quien solo
       -- consulta, las directas y las de las áreas que le tocan.
       and (public.es_admin() or public.tiene_permiso('compras.crear') or public.tiene_permiso('tesoreria.ver_documentos')
            or c.requerimiento_id is null
            or exists (select 1 from public.requerimientos_materiales r
                        where r.id = c.requerimiento_id and public.puede_ver_area_material(r.area_destino)))
  ),
  lineas as (
    select d.orden_compra_id as oc, d.id, d.cantidad,
           greatest(d.cantidad - k.sin_reponer - k.neto - coalesce(pv.cantidad, 0), 0) as falta,
           coalesce(pv.cantidad, 0) as por_validar,
           coalesce(d.material_id, om.material_id) as material_id
      from public.orden_compra_material_detalles d
      left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
      left join public.ot_materiales om on om.id = rd.ot_material_id
     cross join lateral public.cuenta_de_la_linea_de_compra(d.id) k
      left join lateral (select sum(ip.cantidad) as cantidad from public.ingresos_pendientes_almacen ip
                          where ip.orden_compra_detalle_id = d.id and ip.estado = 'PENDIENTE') pv on true
     where d.orden_compra_id = any(p_ids)
  ),
  cuenta as (
    select l.oc,
           count(*) as n,
           count(*) filter (where l.falta > 0) as con_falta,
           count(*) filter (where l.por_validar > 0) as con_por_validar,
           (select max(ip.dejado_en) from public.ingresos_pendientes_almacen ip
             where ip.orden_compra_id = l.oc and ip.estado = 'PENDIENTE') as ultimo_por_validar,
           (select max(coalesce(ip.dejado_en, m.registrado_en)) from public.movimientos_materiales m
              left join public.ingresos_pendientes_almacen ip on ip.movimiento_id = m.id
             where m.tipo = 'INGRESO' and m.orden_compra_detalle_id in (select x.id from lineas x where x.oc = l.oc)) as ultimo_ingreso
      from lineas l
     group by l.oc
  ),
  antigua as (
    select o.id as oc
      from oc o
     where o.entregado_almacen_en is not null
       and not exists (select 1 from public.ingresos_pendientes_almacen ip where ip.orden_compra_id = o.id)
       and not exists (select 1 from public.movimientos_materiales m
                         join public.orden_compra_material_detalles d on d.id = m.orden_compra_detalle_id
                        where d.orden_compra_id = o.id and m.tipo = 'INGRESO')
  ),
  estado as (
    select o.id, o.fecha_estimada as esperada, o.entregado_almacen_en as llego_en, o.vigente,
           coalesce(c.con_por_validar, 0) > 0 as por_validar,
           case
             when a.oc is not null then o.entregado_almacen_en
             when o.entregado_almacen_en is not null and coalesce(c.con_falta, 0) = 0 and coalesce(c.con_por_validar, 0) = 0
               then greatest(o.entregado_almacen_en, c.ultimo_ingreso)
           end as completa_en,
           -- Ya llegó todo y falta que Almacén lo valide: la demora de Almacén no es
           -- del proveedor, así que el plazo se cuenta hasta que se dejó.
           case when o.entregado_almacen_en is not null and coalesce(c.con_falta, 0) = 0
                then greatest(o.entregado_almacen_en, c.ultimo_ingreso, c.ultimo_por_validar) end as llego_todo_en
      from oc o
      left join cuenta c on c.oc = o.id
      left join antigua a on a.oc = o.id
  )
  select e.id, e.esperada, e.llego_en, e.completa_en,
         case
           when e.esperada is null then null
           when e.completa_en is not null then greatest(public.fecha_de_lima(e.completa_en) - e.esperada, 0)
           when e.llego_todo_en is not null then greatest(public.fecha_de_lima(e.llego_todo_en) - e.esperada, 0)
           when e.vigente then greatest(v_hoy - e.esperada, 0)
         end::integer,
         (e.vigente and e.completa_en is null and e.llego_todo_en is null and e.esperada is not null and e.esperada < v_hoy),
         case when e.llego_en is not null and e.completa_en is null then (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'material', coalesce(mat.descripcion, 'Material sin catálogo'),
                    'unidad', um.codigo,
                    'pedido', l.cantidad,
                    'falta', l.falta) order by mat.descripcion), '[]'::jsonb)
             from lineas l
             left join public.materiales mat on mat.id = l.material_id
             left join public.unidades_medida um on um.id = mat.unidad_medida_id
            where l.oc = e.id and l.falta > 0)
         end,
         e.por_validar
    from estado e;
end;
$$;

comment on function public.plazos_de_compras(uuid[]) is
  'De cada OC: la fecha prometida que vale hoy (la corregida, si se corrigió), cuándo llegó al almacén y cuándo quedó completa (cuando se dejó lo último que la completó, no cuando se validó), los días de atraso por fecha de Lima, si está atrasada (vigente, vencida y sin llegar completa), de la que llegó a medias lo que falta por material y si tiene ingresos que Almacén todavía no valida. Lo lee quien lee el listado de OC, con el mismo alcance. Sin importes.';

revoke all on function public.plazos_de_compras(uuid[]) from public, anon;
grant execute on function public.plazos_de_compras(uuid[]) to authenticated;

create or replace function public.plazos_de_servicios(p_ids uuid[])
returns table (
  documento   uuid,
  esperada    date,
  completa_en timestamptz,
  dias_atraso integer,
  atrasada    boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_hoy constant date := public.fecha_de_lima(now());
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')
          or public.tiene_permiso('compras.detraccion')
          or public.tiene_permiso('tesoreria.ver_documentos') or public.es_aprobador_compras()) then
    raise exception 'No tienes permiso para ver las órdenes de servicio.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el plazo de hasta 500 órdenes de servicio a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with os as (
    select s.id, public.fecha_prometida_de_compra(null, s.id) as esperada,
           case when s.estado = 'CONFORME' then s.conformidad_en end as completa_en,
           s.estado in ('EMITIDA', 'EN_EJECUCION') and s.aprobacion <> 'RECHAZADA' as abierta
      from public.ordenes_servicio s
     where s.id = any(p_ids)
  )
  select o.id, o.esperada, o.completa_en,
         case
           when o.esperada is null then null
           when o.completa_en is not null then greatest(public.fecha_de_lima(o.completa_en) - o.esperada, 0)
           when o.abierta then greatest(v_hoy - o.esperada, 0)
         end::integer,
         (o.abierta and o.esperada is not null and o.esperada < v_hoy)
    from os o;
end;
$$;

comment on function public.plazos_de_servicios(uuid[]) is
  'De cada OS: la fecha en que el trabajo debe volver que vale hoy (la corregida, si se corrigió; si no, fecha_fin), cuándo volvió conforme, los días de atraso por fecha de Lima y si está atrasada (emitida o en ejecución, no rechazada, con la fecha ya pasada). Lo lee quien lee el listado de OS. Sin importes.';

revoke all on function public.plazos_de_servicios(uuid[]) from public, anon;
grant execute on function public.plazos_de_servicios(uuid[]) to authenticated;

-- =============================================================================
-- 6. EL RECORRIDO DE LA ORDEN DE COMPRA
-- =============================================================================
-- Emisión → aprobación de Gerencia (si la pide la regla; al aprobarla, la OC
-- queda mandada a recojo; si no la pide, la manda a recojo quien la emitió) →
-- Logística programa el recojo con el conductor → Contabilidad
-- carga la guía de remisión (a la par del conductor) → el conductor sale, la
-- recoge y la deja en el almacén → Almacén valida el ingreso → completa.
-- Además, cada motivo de atraso y cada fecha corregida, en su fecha.
--
-- Quién la tiene ahora sale de las mismas columnas que usa el recorrido del RQ
-- (Plan 0): la aprobación, el recojo, la programación y los ingresos. Lo lee
-- quien lee el plazo, con su mismo alcance: el recorrido se arma solo de las
-- OC que `plazos_de_compras` devuelve.
--
-- `detalle`:
--   VALIDACION        VALIDADO u OBSERVADO
--   FECHA_CORREGIDA   «2026-11-21>2026-11-28|PROVEEDOR|nota»
--   MOTIVO_ATRASO     «PROVEEDOR|nota»
create or replace function public.recorrido_de_ordenes_compra(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver las órdenes de compra.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 órdenes de compra a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with plazo as (
    select p.documento, p.completa_en from public.plazos_de_compras(p_ids) p
  ),
  oc as (
    select c.id, c.creado_por, c.creado_en, c.aprobacion, c.aprobacion_pedida_en, c.aprobado_por, c.aprobado_en,
           c.rechazado_por, c.rechazado_en, c.anulada_por, c.anulada_en,
           c.recojo, c.recojo_pedido_por, c.recojo_pedido_en, c.en_recojo_por, c.en_recojo_en,
           c.recogido_por, c.recogido_en, c.dejado_por, c.dejado_en, c.entregado_almacen_por, c.entregado_almacen_en,
           pr.posicion, pr.programado_por, pr.programado_en,
           p.completa_en,
           c.aprobacion not in ('RECHAZADA', 'ANULADA') and p.completa_en is null as abierta
      from public.ordenes_compra_materiales c
      join plazo p on p.documento = c.id
      left join public.programacion_recojo pr on pr.orden_compra_id = c.id
  ),
  guia as (
    select distinct on (g.orden_compra_id) g.orden_compra_id as oc, g.cargada_por, g.cargada_en
      from public.guias_remision_compra g
     where g.orden_compra_id = any(p_ids) and g.anulada_en is null
     order by g.orden_compra_id, g.cargada_en desc
  ),
  ingresos as (
    select ip.orden_compra_id as oc, ip.estado, ip.validado_por, ip.validado_en, ip.dejado_en
      from public.ingresos_pendientes_almacen ip
     where ip.orden_compra_id = any(p_ids)
  ),
  -- Lo devuelto al proveedor, por OC; y lo que todavía espera su reposición.
  devoluciones as (
    select d.orden_compra_id as oc, m.registrado_por, m.registrado_en,
           m.se_repone and m.reposicion_cancelada_en is null
             and m.cantidad::numeric > coalesce((select sum(x.cantidad::numeric) from public.movimientos_materiales x
                                                  where x.repone_devolucion = m.id), 0) as por_reponer
      from public.movimientos_materiales m
      join public.orden_compra_material_detalles d on d.id = m.orden_compra_detalle_id
     where m.tipo = 'DEVOLUCION_PROVEEDOR' and d.orden_compra_id = any(p_ids)
  ),
  seguimiento as (
    select s.orden_compra_id as oc, s.tipo, s.motivo, s.nota, s.fecha_anterior, s.fecha_nueva, s.registrado_por, s.registrado_en
      from public.seguimiento_de_compras s
     where s.orden_compra_id = any(p_ids)
  ),
  -- Quién la tiene ahora. La guía va aparte, porque corre a la par del conductor.
  ahora as (
    select o.id as oc, x.canon, x.paso, x.puesto, x.espera, x.desde
      from oc o
     cross join lateral (
       select * from (values
         (o.aprobacion = 'POR_APROBAR',
            20, 'APROBACION', 'Gerencia', 'APROBACION', coalesce(o.aprobacion_pedida_en, o.creado_en)),
         (o.recojo is null and o.entregado_almacen_en is null,
            30, 'MANDADA_A_RECOJO', coalesce(public.puesto_de(o.creado_por), 'Logística'), 'MANDAR_A_RECOJO',
            coalesce(o.aprobado_en, o.creado_en)),
         (o.recojo = 'POR_RECOGER' and o.posicion is null,
            40, 'PROGRAMACION', 'Logística', 'PROGRAMAR', o.recojo_pedido_en),
         (o.recojo = 'POR_RECOGER',
            50, 'SALIDA', 'Conductor de Logística', 'SALIR', coalesce(o.programado_en, o.recojo_pedido_en)),
         (o.recojo = 'EN_RECOJO',
            60, 'RECOGIDA', 'Conductor de Logística', 'RECOGER', o.en_recojo_en),
         (o.recojo = 'RECOGIDO',
            70, 'DEJADA', 'Conductor de Logística', 'DEJAR', o.recogido_en),
         (exists (select 1 from ingresos i where i.oc = o.id and i.estado = 'PENDIENTE'),
            80, 'VALIDACION', 'Almacén', 'VALIDAR',
            (select min(i.dejado_en) from ingresos i where i.oc = o.id and i.estado = 'PENDIENTE')),
         (exists (select 1 from devoluciones d where d.oc = o.id and d.por_reponer),
            80, 'VALIDACION', 'El proveedor', 'REPONER',
            (select max(d.registrado_en) from devoluciones d where d.oc = o.id and d.por_reponer)),
         (exists (select 1 from ingresos i where i.oc = o.id and i.estado = 'OBSERVADO'),
            80, 'VALIDACION', coalesce(public.puesto_de(o.creado_por), 'Logística'), 'OBSERVADO',
            (select max(i.validado_en) from ingresos i where i.oc = o.id and i.estado = 'OBSERVADO')),
         (true,
            80, 'VALIDACION', coalesce(public.puesto_de(o.creado_por), 'Logística'), 'FALTA_LLEGAR',
            coalesce((select max(i.validado_en) from ingresos i where i.oc = o.id), o.dejado_en, o.entregado_almacen_en))
       ) v(aplica, canon, paso, puesto, espera, desde)
       where v.aplica
       order by v.canon
       limit 1
     ) x
     where o.abierta
  ),
  guia_ahora as (
    select o.id as oc, o.programado_en as desde
      from oc o
     where o.abierta
       and (o.recojo in ('EN_RECOJO', 'RECOGIDO') or (o.recojo = 'POR_RECOGER' and o.posicion is not null))
       and not exists (select 1 from guia g where g.oc = o.id)
  ),
  pasos as (
    -- 10 · Emisión
    select o.id as oc, 10 as canon, 'EMISION' as paso, 'HECHO' as situacion, o.creado_por as quien, null::text as puesto_fijo,
           o.creado_en as en, null::text as espera, null::text as detalle
      from oc o
    union all
    -- 20 · Gerencia la aprobó o la rechazó
    select o.id, 20, 'APROBACION', 'HECHO', o.aprobado_por, null, o.aprobado_en, null, null
      from oc o where o.aprobado_en is not null and o.aprobacion <> 'RECHAZADA'
    union all
    select o.id, 20, 'RECHAZO', 'HECHO', o.rechazado_por, null, o.rechazado_en, null, null
      from oc o where o.aprobacion = 'RECHAZADA' and o.rechazado_en is not null
    union all
    -- 30 · Mandada a recojo a mano. Al aprobarla, Gerencia la manda sola
    -- (`fn_compra_recojo`): ese no es un paso aparte.
    select o.id, 30, 'MANDADA_A_RECOJO', 'HECHO', o.recojo_pedido_por, null, o.recojo_pedido_en, null, null
      from oc o where o.recojo_pedido_en is not null and o.recojo_pedido_en is distinct from o.aprobado_en
    union all
    -- 40 · Programada con el conductor
    select o.id, 40, 'PROGRAMACION', 'HECHO', o.programado_por, null, o.programado_en, null, null
      from oc o where o.programado_en is not null and (o.posicion is not null or o.recojo in ('EN_RECOJO', 'RECOGIDO', 'DEJADO'))
    union all
    -- 45 · Contabilidad cargó la guía de remisión
    select g.oc, 45, 'GUIA', 'HECHO', g.cargada_por, null, g.cargada_en, null, null
      from guia g
    union all
    -- 50, 60, 70 · El conductor salió, la recogió y la dejó en el almacén
    select o.id, 50, 'SALIDA', 'HECHO', o.en_recojo_por, null, o.en_recojo_en, null, null
      from oc o where o.en_recojo_en is not null
    union all
    select o.id, 60, 'RECOGIDA', 'HECHO', o.recogido_por, null, o.recogido_en, null, null
      from oc o where o.recogido_en is not null
    union all
    -- La OC de antes del conductor la marcaba entregada Logística.
    select o.id, 70, 'DEJADA', 'HECHO', coalesce(o.dejado_por, o.entregado_almacen_por), null,
           coalesce(o.dejado_en, o.entregado_almacen_en), null, null
      from oc o where coalesce(o.dejado_en, o.entregado_almacen_en) is not null
    union all
    -- 80 · Cada validación de Almacén; lo de un mismo minuto es un envío.
    select i.oc, 80, 'VALIDACION', 'HECHO', i.validado_por, null, min(i.validado_en), null, i.estado
      from ingresos i
     where i.validado_en is not null
     group by i.oc, i.validado_por, i.estado, date_trunc('minute', i.validado_en)
    union all
    -- 85 · Lo devuelto al proveedor
    select d.oc, 85, 'DEVOLUCION', 'HECHO', d.registrado_por, null, min(d.registrado_en), null, null
      from devoluciones d
     group by d.oc, d.registrado_por, date_trunc('minute', d.registrado_en)
    union all
    -- 90 · Completa: de cada línea ya entró lo pedido
    select o.id, 90, 'COMPLETA', 'HECHO', null, 'Almacén', o.completa_en, null, null
      from oc o where o.completa_en is not null
    union all
    -- 95 · Anulada
    select o.id, 95, 'ANULACION', 'HECHO', o.anulada_por, null, o.anulada_en, null, null
      from oc o where o.aprobacion = 'ANULADA' and o.anulada_en is not null
    union all
    -- El seguimiento de Logística, en su fecha
    select s.oc, 15,
           case s.tipo when 'FECHA_ESPERADA' then 'FECHA_CORREGIDA' else 'MOTIVO_ATRASO' end,
           'HECHO', s.registrado_por, null, s.registrado_en, null,
           case s.tipo when 'FECHA_ESPERADA' then coalesce(s.fecha_anterior::text, '') || '>' || s.fecha_nueva::text || '|' else '' end
             || s.motivo || '|' || coalesce(s.nota, '')
      from seguimiento s
    union all
    -- Lo que espera ahora
    select h.oc, h.canon, h.paso, 'AHORA', null, h.puesto, h.desde, h.espera, null
      from ahora h
    union all
    select g.oc, 45, 'GUIA', 'AHORA', null, 'Contabilidad', g.desde, 'GUIA', null
      from guia_ahora g
    union all
    -- Lo que todavía no le toca a nadie, en el orden del circuito.
    select o.id, p.canon, p.paso, 'PENDIENTE', null, null, null, null, null
      from oc o
      join ahora h on h.oc = o.id
     cross join (values (40, 'PROGRAMACION'), (45, 'GUIA'), (50, 'SALIDA'),
                        (60, 'RECOGIDA'), (70, 'DEJADA'), (80, 'VALIDACION'), (90, 'COMPLETA')) p(canon, paso)
     where p.canon > h.canon
       and not (p.paso = 'GUIA' and (exists (select 1 from guia g where g.oc = o.id)
                                     or exists (select 1 from guia_ahora g where g.oc = o.id)))
  )
  select p.oc,
         (row_number() over (
            partition by p.oc
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then coalesce(public.puesto(u), p.puesto_fijo) else p.puesto_fijo end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien;
end;
$$;

comment on function public.recorrido_de_ordenes_compra(uuid[]) is
  'El recorrido de cada OC, un paso por fila: lo hecho con el puesto de quien lo hizo; quién la tiene ahora (Gerencia, Logística, Contabilidad, el conductor, Almacén o el proveedor) y hace cuántos días por fecha de Lima; lo que falta; y cada motivo de atraso y fecha corregida. Lo lee quien lee el plazo de la OC, con su alcance. Sin importes.';

revoke all on function public.recorrido_de_ordenes_compra(uuid[]) from public, anon;
grant execute on function public.recorrido_de_ordenes_compra(uuid[]) to authenticated;

-- =============================================================================
-- 7. EL RECORRIDO DE LA ORDEN DE SERVICIO
-- =============================================================================
-- Emisión → aprobación de Gerencia → Logística la inicia → el proveedor hace el
-- trabajo → Logística da la conformidad. Quién la inició no tiene columna: sale
-- de la bitácora, como la vuelta a compra del RQ.
create or replace function public.recorrido_de_ordenes_servicio(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')
          or public.tiene_permiso('compras.detraccion')
          or public.tiene_permiso('tesoreria.ver_documentos') or public.es_aprobador_compras()) then
    raise exception 'No tienes permiso para ver las órdenes de servicio.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 órdenes de servicio a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with os as (
    select s.id, s.creado_por, s.creado_en, s.aprobacion, s.aprobado_por, s.aprobado_en, s.rechazado_por, s.rechazado_en,
           s.estado, s.iniciado_en, s.conformidad_por, s.conformidad_en, s.anulado_por, s.anulado_en,
           s.estado in ('EMITIDA', 'EN_EJECUCION') and s.aprobacion <> 'RECHAZADA' as abierta,
           (select b.usuario_id from public.audit_log b
             where b.tabla = 'ordenes_servicio' and b.registro_id = s.id and b.accion = 'UPDATE'
               and b.datos_antes ->> 'estado' = 'EMITIDA' and b.datos_despues ->> 'estado' = 'EN_EJECUCION'
             order by b.creado_en limit 1) as iniciado_por
      from public.ordenes_servicio s
     where s.id = any(p_ids)
  ),
  ahora as (
    select o.id as os,
           case when o.aprobacion = 'POR_APROBAR' then 20 when o.estado = 'EMITIDA' then 30 else 40 end as canon,
           case when o.aprobacion = 'POR_APROBAR' then 'APROBACION' when o.estado = 'EMITIDA' then 'INICIO' else 'EJECUCION' end as paso,
           case when o.aprobacion = 'POR_APROBAR' then 'Gerencia' when o.estado = 'EMITIDA' then 'Logística' else 'El proveedor' end as puesto,
           case when o.aprobacion = 'POR_APROBAR' then 'APROBACION' when o.estado = 'EMITIDA' then 'INICIAR' else 'EJECUTAR' end as espera,
           case when o.aprobacion = 'POR_APROBAR' then o.creado_en when o.estado = 'EMITIDA' then coalesce(o.aprobado_en, o.creado_en)
                else o.iniciado_en end as desde
      from os o
     where o.abierta
  ),
  pasos as (
    select o.id as os, 10 as canon, 'EMISION' as paso, 'HECHO' as situacion, o.creado_por as quien, null::text as puesto_fijo,
           o.creado_en as en, null::text as espera, null::text as detalle
      from os o
    union all
    select o.id, 20, 'APROBACION', 'HECHO', o.aprobado_por, null, o.aprobado_en, null, null
      from os o where o.aprobado_en is not null and o.aprobacion = 'APROBADA'
    union all
    select o.id, 20, 'RECHAZO', 'HECHO', o.rechazado_por, null, o.rechazado_en, null, null
      from os o where o.aprobacion = 'RECHAZADA' and o.rechazado_en is not null
    union all
    -- La conformidad directa, sin «iniciar», también la pone en marcha: ahí no hay inicio aparte.
    select o.id, 30, 'INICIO', 'HECHO', o.iniciado_por, null, o.iniciado_en, null, null
      from os o where o.iniciado_en is not null and o.iniciado_por is not null
    union all
    select o.id, 50, 'CONFORMIDAD', 'HECHO', o.conformidad_por, null, o.conformidad_en, null, null
      from os o where o.estado = 'CONFORME' and o.conformidad_en is not null
    union all
    select o.id, 95, 'ANULACION', 'HECHO', o.anulado_por, null, o.anulado_en, null, null
      from os o where o.estado = 'ANULADA' and o.anulado_en is not null
    union all
    select s.orden_servicio_id, 15,
           case s.tipo when 'FECHA_ESPERADA' then 'FECHA_CORREGIDA' else 'MOTIVO_ATRASO' end,
           'HECHO', s.registrado_por, null, s.registrado_en, null,
           case s.tipo when 'FECHA_ESPERADA' then coalesce(s.fecha_anterior::text, '') || '>' || s.fecha_nueva::text || '|' else '' end
             || s.motivo || '|' || coalesce(s.nota, '')
      from public.seguimiento_de_compras s
     where s.orden_servicio_id = any(p_ids)
    union all
    select h.os, h.canon, h.paso, 'AHORA', null, h.puesto, h.desde, h.espera, null
      from ahora h
    union all
    select h.os, p.canon, p.paso, 'PENDIENTE', null, null, null, null, null
      from ahora h
     cross join (values (30, 'INICIO'), (40, 'EJECUCION'), (50, 'CONFORMIDAD')) p(canon, paso)
     where p.canon > h.canon
  )
  select p.os,
         (row_number() over (
            partition by p.os
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then coalesce(public.puesto(u), p.puesto_fijo) else p.puesto_fijo end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien;
end;
$$;

comment on function public.recorrido_de_ordenes_servicio(uuid[]) is
  'El recorrido de cada OS, un paso por fila: lo hecho con el puesto de quien lo hizo; quién la tiene ahora (Gerencia, Logística o el proveedor) y hace cuántos días por fecha de Lima; lo que falta; y cada motivo de atraso y fecha corregida. Lo lee quien lee el listado de OS. Sin importes.';

revoke all on function public.recorrido_de_ordenes_servicio(uuid[]) from public, anon;
grant execute on function public.recorrido_de_ordenes_servicio(uuid[]) to authenticated;
