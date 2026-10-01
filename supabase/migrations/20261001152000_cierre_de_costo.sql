-- =============================================================================
-- EL COSTO DE UNA CARROCERÍA SE CIERRA Y QUEDA COMO EVIDENCIA
-- -----------------------------------------------------------------------------
-- El costo de una OT se calcula en vivo: una factura de flete que llega un mes
-- después, una devolución tardía o una planilla que se reparte de nuevo cambian
-- el costo de una unidad que ya se entregó, y nadie puede decir después con qué
-- cifra se dio por terminada.
--
-- El cierre congela el costo con su detalle, quién lo cerró y cuándo. No se
-- edita ni se borra: lo que entre después se ve como diferencia contra el
-- cierre, no reescribiéndolo. Es la misma regla que los documentos numerados
-- (20260101000034_anular_no_borrar).
--
-- Se cierra cuando el trabajo terminó (TERMINADA, ENTREGADA o FACTURADA) y el
-- costo está completo: ningún despacho sin precio y ninguna línea en dólares
-- sin tipo de cambio. Lo cierran Costos y Materiales (`costos.controlar_ot`) o
-- Administración (`ordenes.editar`).
--
-- El cierre guarda el costo y no el precio ni el margen: Costos y Materiales lo
-- lee y no ve el precio de venta. El margen al cierre lo arma `margen_ot` con
-- el costo congelado.
-- =============================================================================

create table if not exists public.ot_cierres_costo (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null unique references public.ordenes_trabajo(id) on delete restrict,
  costo_pen      numeric(14,2) not null check (costo_pen >= 0),
  lineas         jsonb not null check (jsonb_typeof(lineas) = 'array'),
  nota           text not null default '' check (length(nota) <= 1000),
  cerrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  cerrado_en     timestamptz not null default now(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.ot_cierres_costo is
  'Costo congelado de una OT al darla por cerrada. No se edita ni se borra.';

alter table public.ot_cierres_costo enable row level security;
revoke all on public.ot_cierres_costo from public, anon, authenticated;
grant select on public.ot_cierres_costo to authenticated;

drop policy if exists ot_cierres_costo_lectura on public.ot_cierres_costo;
create policy ot_cierres_costo_lectura on public.ot_cierres_costo for select to authenticated
  using ((public.es_admin() or public.tiene_permiso('costos.ver')) and public.puede_ver_orden(orden_id));

select public.activar_timestamps('ot_cierres_costo');
select public.activar_auditoria('ot_cierres_costo');
select public.activar_registro_de_prueba('ot_cierres_costo');

create or replace function public.fn_cierre_costo_inmutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  raise exception 'El cierre de costo de una OT no se modifica ni se borra: quedó como evidencia.'
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.fn_cierre_costo_inmutable() from public, anon, authenticated;

drop trigger if exists trg_cierre_costo_inmutable on public.ot_cierres_costo;
create trigger trg_cierre_costo_inmutable
  before update or delete on public.ot_cierres_costo
  for each row execute function public.fn_cierre_costo_inmutable();

create or replace function public.cerrar_costo_ot(p_orden uuid, p_nota text default '')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_estado text;
  v_numero text;
  v_sin_precio integer;
  v_sin_cambio integer;
  v_costo numeric;
  v_lineas jsonb;
  v_id uuid := gen_random_uuid();
begin
  if not (public.es_admin()
          or public.tiene_permiso('costos.controlar_ot')
          or public.tiene_permiso('ordenes.editar')) then
    raise exception 'El costo lo cierran Costos y Materiales o Administración.'
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
$$;

revoke all on function public.cerrar_costo_ot(uuid, text) from public, anon;
grant execute on function public.cerrar_costo_ot(uuid, text) to authenticated;
