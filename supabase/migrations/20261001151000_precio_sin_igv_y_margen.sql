-- =============================================================================
-- EL PRECIO DE VENTA SIN IGV Y EL MARGEN DE CADA CARROCERÍA
-- -----------------------------------------------------------------------------
-- El margen es lo que queda del precio de venta después del costo. Para que la
-- cifra no mienta, las dos cosas tienen que estar en la misma base: sin IGV
-- (el IGV no es ingreso de la empresa ni costo de la OT: se le cobra al cliente
-- y se le paga a la SUNAT) y en la misma moneda.
--
-- La cotización guarda «el total final» que dice el PDF, y la casa cotiza unas
-- veces con IGV («PRECIO: incluye IGV», COT 3588) y otras sin él («precio sin
-- IGV», COT 3659). El sistema no lo registraba. Comparar el total con IGV
-- contra un costo sin IGV infla el margen en el 18 % de la venta: un margen
-- real de 15 % aparecía como 28 %.
--
-- La confirmación vive en su propia tabla, atada a la versión de la cotización:
-- una cotización aprobada no admite cambios fuera de una corrección con PDF
-- nuevo (`fn_cotizacion_pdf_revision`), y si llega una corrección la
-- confirmación anterior deja de valer hasta que alguien mire el PDF nuevo. La
-- confirman quienes trabajan con la cotización: Ventas, Gerencia y
-- Administración.
--
-- El margen lo ve quien ve el costo (`costos.ver`) y el precio de venta
-- (`cotizaciones.ver_pdf_comercial`). Costos y Materiales ve el costo pero no
-- el precio, y así sigue: con el margen y el costo se deduce el precio.
--
-- La regla de los costos queda escrita en sus columnas: precio de compra sin
-- IGV (como la hoja de costeo de la casa) y gasto de área sin el IGV de la
-- factura (una boleta, un ticket o un recibo por honorarios cuentan completos:
-- solo el IGV de una factura es crédito fiscal).
-- =============================================================================

create table if not exists public.cotizaciones_pdf_igv (
  id             uuid primary key default gen_random_uuid(),
  cotizacion_id  uuid not null unique references public.cotizaciones_pdf(id) on delete restrict,
  version        integer not null check (version > 0),
  incluye_igv    boolean not null,
  confirmado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  confirmado_en  timestamptz not null default now(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.cotizaciones_pdf_igv is
  'Si el monto de venta de la cotización incluye IGV, confirmado para una versión del PDF. Otra versión exige confirmar de nuevo.';

alter table public.cotizaciones_pdf_igv enable row level security;
revoke all on public.cotizaciones_pdf_igv from public, anon, authenticated;
grant select on public.cotizaciones_pdf_igv to authenticated;

drop policy if exists cotizaciones_pdf_igv_lectura on public.cotizaciones_pdf_igv;
create policy cotizaciones_pdf_igv_lectura on public.cotizaciones_pdf_igv for select to authenticated
  using (public.es_admin()
         or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
         or public.tiene_permiso('cotizaciones.crear')
         or public.tiene_permiso('cotizaciones.revisar'));

select public.activar_timestamps('cotizaciones_pdf_igv');
select public.activar_auditoria('cotizaciones_pdf_igv');
select public.activar_registro_de_prueba('cotizaciones_pdf_igv');

create or replace function public.confirmar_igv_cotizacion(p_cotizacion uuid, p_incluye_igv boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_version integer;
  v_estado  text;
  v_numero  text;
begin
  if not (public.es_admin()
          or public.tiene_permiso('cotizaciones.crear')
          or public.tiene_permiso('cotizaciones.revisar')
          or public.tiene_permiso('cotizaciones.liberar_tesoreria')) then
    raise exception 'Solo Ventas, Gerencia o Administración confirman si el precio de la cotización incluye IGV.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_incluye_igv is null then
    raise exception 'Indica si el precio de la cotización incluye IGV o no.';
  end if;

  select c.version, c.estado::text, c.numero into v_version, v_estado, v_numero
    from public.cotizaciones_pdf c where c.id = p_cotizacion;
  if not found then
    raise exception 'La cotización no existe.';
  end if;
  if v_estado = 'ANULADA' then
    raise exception 'La cotización % está anulada: su precio ya no se usa.', v_numero;
  end if;

  insert into public.cotizaciones_pdf_igv (cotizacion_id, version, incluye_igv, confirmado_por, confirmado_en)
  values (p_cotizacion, v_version, p_incluye_igv, public.usuario_actual(), now())
  on conflict (cotizacion_id) do update
    set version = excluded.version,
        incluye_igv = excluded.incluye_igv,
        confirmado_por = excluded.confirmado_por,
        confirmado_en = excluded.confirmado_en;
end;
$$;

revoke all on function public.confirmar_igv_cotizacion(uuid, boolean) from public, anon;
grant execute on function public.confirmar_igv_cotizacion(uuid, boolean) to authenticated;

-- El margen de una OT, en soles. Una fila siempre: lo que falte para
-- calcularlo sale en null y con su contador, para que la pantalla diga qué falta.
create or replace function public.margen_ot(p_orden uuid)
returns table (
  moneda_venta         text,
  precio_venta         numeric,
  incluye_igv          boolean,
  precio_neto          numeric,
  cambio_venta         numeric,
  precio_neto_pen      numeric,
  costo_pen            numeric,
  margen_pen           numeric,
  margen_pct           numeric,
  despachos_sin_precio integer,
  lineas_sin_cambio    integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  -- La tasa del IGV en el Perú desde 2011.
  c_igv constant numeric := 0.18;
  v_moneda text;
  v_precio numeric;
  v_igv boolean;
  v_fecha date;
  v_neto numeric;
  v_cambio numeric;
  v_neto_pen numeric;
  v_costo numeric;
  v_sin_precio integer;
  v_sin_cambio integer;
begin
  perform public.exigir_permiso('costos.ver');
  if not (public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')) then
    raise exception 'El margen se calcula con el precio de venta, que tu puesto no ve.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta OT.' using errcode = 'insufficient_privilege';
  end if;

  select c.moneda::text, c.monto_venta,
         case when i.version = c.version then i.incluye_igv end,
         o.fecha_registro::date
    into v_moneda, v_precio, v_igv, v_fecha
    from public.ordenes_trabajo o
    left join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id and c.estado <> 'ANULADA'
    left join public.cotizaciones_pdf_igv i on i.cotizacion_id = c.id
   where o.id = p_orden;

  select coalesce(sum(s.monto_pen), 0),
         count(*) filter (where s.fuente = 'MATERIALES_SIN_PRECIO'),
         count(*) filter (where s.moneda = 'USD' and s.monto_pen is null)
    into v_costo, v_sin_precio, v_sin_cambio
    from public.costeo_ot_en_soles(p_orden) s;

  v_neto := case when v_igv then round(v_precio / (1 + c_igv), 2)
                 when v_igv = false then v_precio end;
  -- Un precio en dólares se pasa con el cambio de COMPRA del día en que se
  -- registró la OT: es cuando la venta quedó comprometida.
  v_cambio := case when v_moneda = 'USD' then public.cambio_del_dia(v_fecha, 'COMPRA') end;
  v_neto_pen := case when v_moneda = 'PEN' then v_neto
                     when v_moneda = 'USD' then round(v_neto * v_cambio, 2) end;

  return query select
    v_moneda, v_precio, v_igv, v_neto, v_cambio, v_neto_pen, v_costo,
    case when v_neto_pen is not null then v_neto_pen - v_costo end,
    case when v_neto_pen > 0 then round((v_neto_pen - v_costo) / v_neto_pen * 100, 1) end,
    v_sin_precio, v_sin_cambio;
end;
$$;

revoke all on function public.margen_ot(uuid) from public, anon;
grant execute on function public.margen_ot(uuid) to authenticated;

comment on column public.orden_compra_material_detalles.precio_unitario is
  'Precio unitario de compra SIN IGV, como en la hoja de costeo de la casa. Si el proveedor lo da con IGV, se divide entre 1.18.';
comment on column public.ot_gastos_areas.monto is
  'Importe que entra al costo de la OT: sin el IGV si el comprobante es factura; completo si es boleta, ticket o recibo por honorarios.';
