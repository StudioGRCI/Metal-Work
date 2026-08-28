-- =============================================================================
-- LO QUE SE VA A HACER, NO CÓMO SE ARMÓ EL PRECIO
-- -----------------------------------------------------------------------------
-- La cotización que se le manda al cliente salía con el «DETALLE ECONÓMICO»
-- entero: una línea por partida, con su precio unitario y su importe. Ese
-- desglose es la cocina del taller —cuánto pesa el acero, cuánto sale la mano de
-- obra, qué se subcontrata— y no es del cliente: al cliente le toca saber qué se
-- le va a fabricar y cuánto cuesta.
--
-- Las partidas se quedan donde están, porque de ellas sale el presupuesto de la
-- OT y con ellas se compra el material. Lo que cambia es el papel: se imprime
-- una sola línea con el nombre del trabajo, su cantidad, su unidad y su precio.
--
-- Esa línea necesitaba nombre propio y la cotización no tenía dónde guardarlo.
-- Se deducía de la carrocería, que dice «TOLVA VOLQUETE» donde el documento de
-- la empresa dice «Fabricación de tolva volquete de 23 m³, 03 ejes, con tiro y
-- suspensión mecánica». El concepto lo escribe quien cotiza.
--
-- Queda opcional a propósito: las 3 567 cotizaciones que ya existen no tienen
-- concepto y tienen que seguir imprimiéndose. Cuando falta, el documento cae a
-- la descripción de la carrocería, como hasta ahora.
-- =============================================================================

alter table public.cotizaciones
  add column if not exists concepto           text,
  add column if not exists concepto_cantidad  public.cantidad not null default 1,
  add column if not exists concepto_unidad    text not null default 'UND';

-- Postgres no admite `add constraint if not exists`, y la migración tiene que
-- poder volver a correr.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cotizaciones'::regclass
                    and conname = 'cotizaciones_concepto_no_vacio') then
    alter table public.cotizaciones
      add constraint cotizaciones_concepto_no_vacio
      check (concepto is null or btrim(concepto) <> '');
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cotizaciones'::regclass
                    and conname = 'cotizaciones_concepto_cantidad_positiva') then
    alter table public.cotizaciones
      add constraint cotizaciones_concepto_cantidad_positiva
      check (concepto_cantidad > 0);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cotizaciones'::regclass
                    and conname = 'cotizaciones_concepto_unidad_no_vacia') then
    alter table public.cotizaciones
      add constraint cotizaciones_concepto_unidad_no_vacia
      check (btrim(concepto_unidad) <> '');
  end if;
end;
$$;

comment on column public.cotizaciones.concepto is
  'Nombre del trabajo tal como se imprime en la cotización. Si está vacío, el documento usa la descripción de la carrocería.';
comment on column public.cotizaciones.concepto_cantidad is
  'Cuántas unidades del concepto se cotizan. Casi siempre 1: una tolva, una cisterna.';
comment on column public.cotizaciones.concepto_unidad is
  'Unidad del concepto tal como se escribe en el documento (UND, JGO, SERV, GLB).';
