-- =============================================================================
-- ÓRDENES DE SERVICIO A SUBCONTRATISTAS
-- -----------------------------------------------------------------------------
-- El arenado, la pintura, el torno o el corte láser se mandan afuera. Hasta
-- ahora eso entraba al costo de la unidad, pero sin documento propio: no había
-- número que darle al proveedor, ni plazo comprometido, ni constancia de que
-- el trabajo volvió bien. Se pagaba contra factura y nada más.
--
-- Esta migración convierte `servicios_terceros` en una orden de servicio de
-- verdad: número correlativo, plazo, aprobación, conformidad y quién la dio.
-- =============================================================================

-- --------------------------------------------------------------- el documento
alter table public.servicios_terceros
  add column if not exists numero                    text not null default '',
  add column if not exists plazo_dias                integer,
  add column if not exists aprobado_por              uuid references public.usuarios(id) on delete set null,
  add column if not exists fecha_aprobacion          timestamptz,
  add column if not exists fecha_conformidad         date,
  add column if not exists conformidad_por           uuid references public.usuarios(id) on delete set null,
  add column if not exists observaciones_conformidad text;

comment on column public.servicios_terceros.numero is
  'Correlativo de la orden de servicio: es el número que se le da al proveedor.';
comment on column public.servicios_terceros.fecha_conformidad is
  'Cuándo volvió el trabajo y se aceptó. Sin esto no se paga.';

-- El número es único, pero las filas viejas nacieron sin él: el índice solo
-- mira las que ya lo tienen.
create unique index if not exists servicios_terceros_numero_idx
  on public.servicios_terceros (numero)
  where numero <> '';

-- ------------------------------------------------------------------ la serie
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
values ('ORDEN_SERVICIO', '001', 'OS', 0, 4, 'OS-{numero}-MW')
on conflict do nothing;

-- ------------------------------------------------------------- el correlativo
create or replace function public.fn_os_numero()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := public.siguiente_correlativo('ORDEN_SERVICIO', '001', null);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_os_numero on public.servicios_terceros;
create trigger trg_os_numero
  before insert on public.servicios_terceros
  for each row execute function public.fn_os_numero();

-- ------------------------------------------------------- las reglas de estado
-- Una orden de servicio recorre: solicitada, en ejecución, conforme, pagada.
-- El paso por «en ejecución» no es obligatorio —un arenado puede volver el
-- mismo día— y se puede anular mientras el trabajo no haya vuelto. Lo que no
-- se puede es pagar sin haber recibido: ese es el agujero que este documento
-- viene a cerrar, y por eso a PAGADO solo se llega desde la conformidad.
create or replace function public.fn_os_transicion()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_permitidos text[];
begin
  if new.estado = old.estado then
    return new;
  end if;

  v_permitidos := case old.estado::text
    when 'SOLICITADO'   then array['EN_EJECUCION', 'EJECUTADO', 'CONFORME', 'ANULADO']
    when 'EN_EJECUCION' then array['EJECUTADO', 'CONFORME', 'ANULADO']
    when 'EJECUTADO'    then array['CONFORME', 'ANULADO']
    when 'CONFORME'     then array['PAGADO']
    when 'PAGADO'       then array[]::text[]
    when 'ANULADO'      then array[]::text[]
    else array[]::text[]
  end;

  if not (new.estado::text = any (v_permitidos)) then
    raise exception 'La orden de servicio % no puede pasar de % a %',
      old.numero, old.estado, new.estado
      using hint = 'Estados posibles desde aquí: ' ||
                   coalesce(nullif(array_to_string(v_permitidos, ', '), ''), 'ninguno');
  end if;

  if new.estado::text = 'CONFORME' then
    new.fecha_conformidad := coalesce(new.fecha_conformidad, current_date);
    new.conformidad_por   := coalesce(new.conformidad_por, public.usuario_actual());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_os_transicion on public.servicios_terceros;
create trigger trg_os_transicion
  before update of estado on public.servicios_terceros
  for each row execute function public.fn_os_transicion();

-- --------------------------------------------------------------- el costo real
-- Con la conformidad de por medio, el costo real de la unidad es lo recibido:
-- conforme o pagado. Lo pedido y lo que está afuera es compromiso, todavía no
-- costo. `EJECUTADO` se mantiene como recibido por las órdenes anteriores.
create or replace view public.v_ot_costo_servicios as
  select orden_id,
         coalesce(sum(monto_base) filter (
           where estado in ('EJECUTADO', 'CONFORME', 'PAGADO')), 0)::monto      as costo_servicios,
         coalesce(sum(monto_base) filter (
           where estado in ('SOLICITADO', 'EN_EJECUCION')), 0)::monto           as servicios_comprometidos,
         coalesce(sum(monto_base) filter (where estado = 'PAGADO'), 0)::monto   as servicios_pagados,
         count(*)                                                               as servicios,
         count(*) filter (where estado in ('SOLICITADO', 'EN_EJECUCION'))       as servicios_pendientes
    from public.servicios_terceros s
   where estado <> 'ANULADO'
   group by orden_id;

-- ------------------------------------------------------------------ el listado
create or replace view public.os_resumen as
  select s.id,
         s.numero,
         s.orden_id,
         o.numero              as orden_numero,
         c.razon_social        as cliente,
         u.placa,
         s.proveedor_id,
         p.razon_social        as proveedor,
         s.tipo_servicio,
         s.descripcion,
         s.especificacion,
         s.estado,
         s.fecha,
         s.fecha_entrega,
         s.plazo_dias,
         s.fecha_conformidad,
         s.moneda,
         s.monto,
         s.monto_base,
         s.numero_factura,
         s.fecha_factura,
         (s.fecha_entrega is not null
          and s.fecha_entrega < current_date
          and s.estado in ('SOLICITADO', 'EN_EJECUCION'))                as atrasada,
         s.etapa_id,
         e.nombre              as etapa
    from public.servicios_terceros s
    join public.proveedores p       on p.id = s.proveedor_id
    left join public.ordenes_trabajo o on o.id = s.orden_id
    left join public.clientes c     on c.id = o.cliente_id
    left join public.unidades u     on u.id = o.unidad_id
    left join public.ot_etapas oe   on oe.id = s.etapa_id
    left join public.etapas_catalogo e on e.id = oe.etapa_catalogo_id;

comment on view public.os_resumen is
  'Órdenes de servicio con su proveedor, su orden de trabajo y si están atrasadas.';

-- ------------------------------------------------------------- la conformidad
-- Dar la conformidad es aceptar el trabajo que volvió del proveedor: es lo que
-- habilita el pago, así que lleva permiso propio y queda con nombre y fecha.
create or replace function public.dar_conformidad_servicio(
  p_servicio      uuid,
  p_observaciones text default null,
  p_fecha         date default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_estado text;
begin
  perform public.exigir_permiso('calidad.inspeccionar');

  select estado::text into v_estado from public.servicios_terceros where id = p_servicio;

  if v_estado is null then
    raise exception 'No existe esa orden de servicio';
  end if;

  update public.servicios_terceros
     set estado                    = 'CONFORME',
         fecha_conformidad         = coalesce(p_fecha, current_date),
         conformidad_por           = public.usuario_actual(),
         observaciones_conformidad = nullif(trim(coalesce(p_observaciones, '')), '')
   where id = p_servicio;
end;
$$;

comment on function public.dar_conformidad_servicio(uuid, text, date) is
  'Acepta el trabajo devuelto por el subcontratista; es lo que habilita el pago.';

revoke all on function public.dar_conformidad_servicio(uuid, text, date) from public, anon;
grant execute on function public.dar_conformidad_servicio(uuid, text, date) to authenticated;

-- --------------------------------------------------------------- los permisos
-- Las vistas creadas después del blindaje se ejecutan con los permisos de quien
-- consulta, igual que las demás: así heredan las políticas de sus tablas.
alter view public.os_resumen set (security_invoker = on);
alter view public.v_ot_costo_servicios set (security_invoker = on);
grant select on public.os_resumen to authenticated;

-- ------------------------------------------------------- quién toca el documento
-- La orden de servicio la emite logística, que es quien trata con el proveedor,
-- y la mira costos, porque el monto termina en el costo de la unidad. Por eso
-- reemplazamos aquí las políticas generadas, que solo contemplaban costos.
drop policy if exists ver_servicios_terceros    on public.servicios_terceros;
drop policy if exists crear_servicios_terceros  on public.servicios_terceros;
drop policy if exists editar_servicios_terceros on public.servicios_terceros;

create policy ver_servicios_terceros on public.servicios_terceros
  for select to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('costos.ver')
    or public.tiene_permiso('compras.ver')
    or public.tiene_permiso('calidad.ver')
  );

create policy crear_servicios_terceros on public.servicios_terceros
  for insert to authenticated
  with check (
    public.es_admin()
    or public.tiene_permiso('costos.editar')
    or public.tiene_permiso('compras.crear')
  );

-- La conformidad entra por su propia función, que corre como definidora; esta
-- política cubre el resto del recorrido: sacarla al proveedor, recibirla,
-- anularla y registrar la factura.
create policy editar_servicios_terceros on public.servicios_terceros
  for update to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('costos.editar')
    or public.tiene_permiso('compras.crear')
  )
  with check (
    public.es_admin()
    or public.tiene_permiso('costos.editar')
    or public.tiene_permiso('compras.crear')
  );
