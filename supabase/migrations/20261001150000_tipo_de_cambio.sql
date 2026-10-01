-- =============================================================================
-- EL TIPO DE CAMBIO Y EL COSTO DE CADA CARROCERÍA EN SOLES
-- -----------------------------------------------------------------------------
-- Una OT con compras en dólares tenía dos costos que no se podían sumar —«S/
-- 18,400 + US$ 2,150»— y su margen no se podía sacar contra un precio en soles.
-- La tabla de tipos de cambio se retiró con las cotizaciones estructuradas
-- (20260927234131) y nada la reemplazó.
--
-- Aquí vuelve, con una regla simple: cada línea en dólares del costo se pasa a
-- soles con el cambio de su propia fecha (el del despacho, el del gasto, el del
-- mes de la planilla), no con el de hoy: lo que costó el material es lo que se
-- pagó entonces. Para costos se usa el cambio de VENTA (lo que cuesta comprar
-- un dólar); para un ingreso en dólares, el de COMPRA. Es la práctica contable
-- en el Perú con el cambio que publica la SUNAT.
--
-- Si un día no tiene cambio registrado (fin de semana, feriado), vale el último
-- de los diez días anteriores. Más atrás no se busca: un cambio de hace un mes
-- daría una cifra que parece exacta y no lo es, y la pantalla debe poder decir
-- «falta el tipo de cambio del 12/09».
--
-- Lo registran Tesorería, Administración y Contabilidad (`tesoreria.tipo_cambio`);
-- lo leen todos los que tienen cuenta activa: no es un dato reservado.
--
-- `registrado_por` no lleva índice: la aplicación no filtra por esa columna y
-- una cuenta no se borra en ningún flujo (ver la skill `datos`).
-- =============================================================================

insert into public.permisos (codigo, modulo, descripcion) values
  ('tesoreria.tipo_cambio', 'Tesorería', 'Registrar y corregir el tipo de cambio del día')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'tesoreria.tipo_cambio'
  from public.roles r
 where r.codigo in ('TESORERIA', 'ADMINISTRACION', 'CONTABILIDAD')
on conflict do nothing;

create table if not exists public.tipos_de_cambio (
  id             uuid primary key default gen_random_uuid(),
  fecha          date not null unique,
  compra         numeric(7,4) not null check (compra > 0 and compra < 100),
  venta          numeric(7,4) not null check (venta > 0 and venta < 100),
  fuente         text not null default 'SUNAT' check (fuente in ('SUNAT', 'SBS', 'BANCO', 'OTRO')),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_cambio_venta_no_menor_que_compra check (venta >= compra)
);

comment on table public.tipos_de_cambio is
  'Tipo de cambio del dólar por día (SUNAT). El costo de una OT pasa cada línea en dólares a soles con el cambio de su fecha.';

alter table public.tipos_de_cambio enable row level security;
revoke all on public.tipos_de_cambio from public, anon, authenticated;
grant select, insert, update on public.tipos_de_cambio to authenticated;

drop policy if exists tipos_de_cambio_lectura on public.tipos_de_cambio;
create policy tipos_de_cambio_lectura on public.tipos_de_cambio for select to authenticated
  using (public.es_usuario_activo());

drop policy if exists tipos_de_cambio_alta on public.tipos_de_cambio;
create policy tipos_de_cambio_alta on public.tipos_de_cambio for insert to authenticated
  with check ((public.es_admin() or public.tiene_permiso('tesoreria.tipo_cambio'))
              and registrado_por = public.usuario_actual());

-- Un cambio mal digitado se corrige; no se borra, para que el costo que ya se
-- calculó con él tenga de dónde salir. La auditoría guarda el valor anterior.
drop policy if exists tipos_de_cambio_correccion on public.tipos_de_cambio;
create policy tipos_de_cambio_correccion on public.tipos_de_cambio for update to authenticated
  using (public.es_admin() or public.tiene_permiso('tesoreria.tipo_cambio'))
  with check (public.es_admin() or public.tiene_permiso('tesoreria.tipo_cambio'));

select public.activar_timestamps('tipos_de_cambio');
select public.activar_auditoria('tipos_de_cambio');
select public.activar_registro_de_prueba('tipos_de_cambio');

-- El cambio que vale para una fecha: el de ese día o el último de los diez
-- anteriores. Null si no hay ninguno: quien lo pide debe decir que falta.
create or replace function public.cambio_del_dia(p_fecha date, p_operacion text default 'VENTA')
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select case when upper(p_operacion) = 'COMPRA' then t.compra else t.venta end
    from public.tipos_de_cambio t
   where t.fecha <= p_fecha
     and t.fecha > p_fecha - 10
   order by t.fecha desc
   limit 1
$$;

revoke all on function public.cambio_del_dia(date, text) from public, anon;
grant execute on function public.cambio_del_dia(date, text) to authenticated;

-- El detalle del costo con cada línea pasada a soles. Mismas llaves que el
-- detalle (`costos.ver` y poder ver la orden): se las pide `detalle_costeo_ot`,
-- que corre con los permisos de quien llama.
create or replace function public.costeo_ot_en_soles(p_orden uuid)
returns table (
  fuente text,
  fecha date,
  concepto text,
  moneda text,
  monto numeric,
  tipo_cambio numeric,
  monto_pen numeric
)
language sql
stable
set search_path to 'public'
as $$
  select d.fuente, d.fecha, d.concepto, d.moneda, d.monto,
         case when d.moneda = 'USD' then public.cambio_del_dia(d.fecha, 'VENTA') end,
         case when d.moneda = 'PEN' then d.monto
              when d.moneda = 'USD' then round(d.monto * public.cambio_del_dia(d.fecha, 'VENTA'), 2)
         end
    from public.detalle_costeo_ot(p_orden) d
$$;

revoke all on function public.costeo_ot_en_soles(uuid) from public, anon;
grant execute on function public.costeo_ot_en_soles(uuid) to authenticated;
