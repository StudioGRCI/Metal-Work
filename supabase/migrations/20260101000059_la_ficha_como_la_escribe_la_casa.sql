-- =============================================================================
-- LA FICHA COMO LA ESCRIBE LA CASA
-- -----------------------------------------------------------------------------
-- De la cotización 3668-2026 (semirremolque cama baja, MENBER INGENIERÍA), que
-- la empresa mandó como ejemplo de cómo salen sus papeles de verdad.
--
-- Su bloque de ESPECIFICACIONES TÉCNICAS lleva diez renglones y el sistema solo
-- sabía guardar seis. Los cuatro que faltaban se escribían a mano en el texto
-- libre de la ficha o directamente no salían:
--
--   MARCA               ← ya estaba
--   AÑO                 ← FALTABA. Es el año de fabricación de la carrocería,
--                          no el del camión: en esa cotización dice 2026 sobre
--                          una unidad que todavía no existe.
--   CARROCERÍA          ← FALTABA. Es descriptiva —«EXTENDIBLE CON RAMPA»— y no
--                          el nombre del tipo del catálogo, que va en TIPO.
--   TIPO                ← ya estaba
--   LONGITUD            ← ya estaba (largo_m)
--   LONGITUD CAMA ÚTIL  ← FALTABA. En una cama baja no es lo mismo que el largo
--                          total: 11.80 contra 7.80 en el ejemplo.
--   ANCHO, ALTO         ← ya estaban
--   PESO NETO           ← ya estaba
--   EJES                ← FALTABA. «3 EJES EXTRA-ANCHO 93''» es texto, no un
--                          número: lleva la trocha y a veces la marca.
--
-- Y una línea suelta entre la ficha y el resto —«NORMAS BASE AL REGLAMENTO
-- PESOS Y MEDIDAS MTC»— que en sus papeles va siempre y no es una sección.
--
-- Todos van también en el catálogo de carrocerías, porque son de la carrocería:
-- una cama baja de tres ejes lleva siempre los mismos, y escribirlos en cada
-- cotización es la forma más segura de que algún día falten.
-- =============================================================================

alter table public.cotizaciones
  add column if not exists anio_fabricacion int,
  add column if not exists carroceria_texto text,
  add column if not exists largo_util_m     numeric(6,2),
  add column if not exists ejes             text,
  add column if not exists normas           text;

comment on column public.cotizaciones.anio_fabricacion is
  'Año que va impreso en la ficha. Es el de la carrocería que se va a fabricar, no el del chasis del cliente.';
comment on column public.cotizaciones.carroceria_texto is
  'Cómo se describe la carrocería en el papel («EXTENDIBLE CON RAMPA»). El nombre del catálogo va en tipo.';
comment on column public.cotizaciones.largo_util_m is
  'Longitud de cama útil. En una cama baja no es el largo total: 11.80 de largo con 7.80 de cama útil.';
comment on column public.cotizaciones.ejes is
  'Los ejes tal como se escriben: «3 EJES EXTRA-ANCHO 93''''». Texto porque lleva trocha y a veces marca.';
comment on column public.cotizaciones.normas is
  'La línea de normas que va bajo la ficha. En sus papeles: «NORMAS BASE AL REGLAMENTO PESOS Y MEDIDAS MTC».';

alter table public.tipos_carroceria
  add column if not exists carroceria_texto text,
  add column if not exists largo_util_m     numeric(6,2),
  add column if not exists ejes             text,
  add column if not exists normas           text;

-- ------------------------------------- el disparador copia también los nuevos
create or replace function public.fn_cotizacion_traer_medidas_del_tipo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tipo public.tipos_carroceria%rowtype;
begin
  if new.tipo_carroceria_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.tipo_carroceria_id is not distinct from old.tipo_carroceria_id then
    return new;
  end if;

  select * into v_tipo from public.tipos_carroceria t where t.id = new.tipo_carroceria_id;
  if not found then
    return new;
  end if;

  new.modelo           := coalesce(new.modelo, v_tipo.modelo);
  new.tipo             := coalesce(new.tipo, v_tipo.tipo);
  new.largo_m          := coalesce(new.largo_m, v_tipo.largo_m);
  new.ancho_m          := coalesce(new.ancho_m, v_tipo.ancho_m);
  new.alto_m           := coalesce(new.alto_m, v_tipo.alto_m);
  new.capacidad        := coalesce(new.capacidad, v_tipo.capacidad);
  new.peso_neto_tn     := coalesce(new.peso_neto_tn, v_tipo.peso_neto_tn);
  new.carroceria_texto := coalesce(new.carroceria_texto, v_tipo.carroceria_texto);
  new.largo_util_m     := coalesce(new.largo_util_m, v_tipo.largo_util_m);
  new.ejes             := coalesce(new.ejes, v_tipo.ejes);
  new.normas           := coalesce(new.normas, v_tipo.normas);

  -- El año se llena solo con el de la emisión: una cotización de 2026 fabrica
  -- una carrocería 2026, y en el ejemplo de la casa es exactamente eso.
  new.anio_fabricacion := coalesce(new.anio_fabricacion, extract(year from coalesce(new.fecha_emision, current_date))::int);

  return new;
end;
$$;

-- La línea de normas es la misma en todos sus papeles: se deja puesta en las
-- carrocerías que ya existen para no tener que escribirla treinta y cuatro veces.
update public.tipos_carroceria
   set normas = 'NORMAS BASE AL REGLAMENTO PESOS Y MEDIDAS MTC'
 where normas is null and activo;
