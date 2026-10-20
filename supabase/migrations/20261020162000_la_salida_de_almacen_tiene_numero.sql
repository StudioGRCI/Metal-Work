-- =============================================================================
-- LA SALIDA DE ALMACÉN TIENE NÚMERO
-- -----------------------------------------------------------------------------
-- La salida de materia prima y la de EPP se cierran con un formato impreso,
-- firmado por el almacenero y por quien recibe, que Almacén escanea y carga.
-- Hasta hoy ese papel decía «N.º» y debajo los ocho primeros caracteres del
-- identificador interno: no era una serie, y con una hoja perdida nadie podía
-- saber que faltaba. La revisión del 2026-10-20 lo marcó (informe de
-- formatos, P2-10). Desde ahora cada salida que exige formato nace con su
-- número de la casa, SA-0001-2026, de una serie sin huecos.
--
-- El tipo SALIDA_ALMACEN existe desde el núcleo; su serie de entonces (SAL,
-- sin documentos) se retiró en la migración 094. Vuelve con el formato de las
-- series de hoy.
--
-- El número lo pone un disparador al insertar, como el de la OC: así lo lleva
-- toda salida, venga del kardex, de la planilla de almacén o de un
-- requerimiento, sin que cada camino tenga que acordarse. Solo las que exigen
-- formato: los consumibles y los accesorios salen con su foto y no imprimen
-- hoja, y numerarlos dejaría huecos que nadie podría explicar.
--
-- Las salidas de antes quedan sin número (el movimiento no se reescribe: es
-- el kardex), y su formato dice que es anterior a la serie. En producción no
-- hay ninguna salida de materia prima ni de EPP a la fecha (2026-10-20).
-- =============================================================================

insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'SALIDA_ALMACEN', '001', 'SA', 0, 4, 'SA-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'SALIDA_ALMACEN' and serie = '001');

alter table public.movimientos_materiales add column if not exists numero_salida text;

comment on column public.movimientos_materiales.numero_salida is
  'El número de la casa de la salida que se cierra con formato firmado (materia prima y EPP): SA-0001-2026. Lo pone el disparador al insertar; las salidas de antes de la serie no lo tienen.';

create unique index if not exists uq_movimientos_numero_salida
  on public.movimientos_materiales (numero_salida) where numero_salida is not null;

create or replace function public.fn_salida_almacen_numero()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  -- El número lo pone siempre la serie: uno que venga escrito en el INSERT no vale.
  new.numero_salida := null;
  if new.tipo = 'SALIDA' and exists (
       select 1 from public.materiales m
         join public.categorias_material c on c.id = m.categoria_id
        where m.id = new.material_id and c.almacen in ('MATERIA_PRIMA', 'EPP')) then
    new.numero_salida := public.siguiente_correlativo('SALIDA_ALMACEN', '001', null);
  end if;
  return new;
end;
$$;
revoke all on function public.fn_salida_almacen_numero() from public, anon, authenticated;

-- «zz»: corre después de los BEFORE INSERT que completan el material
-- (`identificar_material_movimiento`), que van por orden alfabético.
create or replace trigger trg_zz_salida_almacen_numero
  before insert on public.movimientos_materiales
  for each row execute function public.fn_salida_almacen_numero();
