-- =============================================================================
-- EL CATÁLOGO DE CARROCERÍAS TRAE SUS MEDIDAS
-- -----------------------------------------------------------------------------
-- La ficha de la cotización salía con rayas en Modelo, Tipo, Medidas, Capacidad
-- y Peso neto porque esos datos no existían en ningún sitio: había que
-- escribirlos a mano en cada cotización, y quien no se acordaba mandaba el papel
-- sin ellos.
--
-- Son datos del tipo de carrocería, no de cada cotización: una tolva volquete de
-- piso circular mide lo que mide. Así que se guardan una vez en el catálogo y la
-- cotización los trae sola al elegir el tipo.
--
-- **Y se pueden cambiar en la cotización**, que es lo que pidió la empresa: «a
-- veces no todas terminan igual». Por eso lo que se copia son valores normales
-- en las columnas de la cotización, no una referencia al catálogo: una vez
-- copiados, son de esa cotización y nadie los vuelve a tocar.
--
-- El momento de copiar es cuando se elige el tipo —al crear la cotización o al
-- cambiarlo—, y solo sobre los campos que estén vacíos. Copiar en cada guardado
-- devolvería a su sitio lo que Administración acabara de corregir; copiar solo
-- al elegir hace que la corrección quede.
-- =============================================================================

-- ------------------------------------------------- lo que mide cada carrocería
alter table public.tipos_carroceria
  add column if not exists modelo        text,
  add column if not exists tipo          text,
  add column if not exists largo_m       numeric(6,2),
  add column if not exists ancho_m       numeric(6,2),
  add column if not exists alto_m        numeric(6,2),
  add column if not exists capacidad     text,
  add column if not exists peso_neto_tn  numeric(8,3);

comment on column public.tipos_carroceria.modelo is
  'Modelo con el que la casa nombra esta carrocería en sus fichas. Se copia a la cotización al elegir el tipo, y ahí se puede corregir.';
comment on column public.tipos_carroceria.capacidad is
  'Capacidad tal como se escribe en el papel («18 m³»). Es texto porque no siempre es un volumen: hay fichas que dicen «2 compartimientos».';
comment on column public.tipos_carroceria.peso_neto_tn is
  'Peso neto de referencia en toneladas. Lo que de verdad pese la unidad terminada se corrige en la cotización.';

-- ---------------------------------------- la cotización las trae al elegir tipo
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

  -- Solo al elegir el tipo: al crear la cotización, o al cambiarlo por otro. En
  -- cualquier otro guardado no se toca nada, para que lo que Administración
  -- corrigió a mano no vuelva solo a los valores del catálogo.
  if tg_op = 'UPDATE' and new.tipo_carroceria_id is not distinct from old.tipo_carroceria_id then
    return new;
  end if;

  select * into v_tipo from public.tipos_carroceria t where t.id = new.tipo_carroceria_id;
  if not found then
    return new;
  end if;

  -- `coalesce` en este orden: lo que ya trae la cotización manda sobre el
  -- catálogo. Cambiar de tipo no borra un dato que alguien ya escribió.
  new.modelo       := coalesce(new.modelo, v_tipo.modelo);
  new.tipo         := coalesce(new.tipo, v_tipo.tipo);
  new.largo_m      := coalesce(new.largo_m, v_tipo.largo_m);
  new.ancho_m      := coalesce(new.ancho_m, v_tipo.ancho_m);
  new.alto_m       := coalesce(new.alto_m, v_tipo.alto_m);
  new.capacidad    := coalesce(new.capacidad, v_tipo.capacidad);
  new.peso_neto_tn := coalesce(new.peso_neto_tn, v_tipo.peso_neto_tn);

  return new;
end;
$$;

comment on function public.fn_cotizacion_traer_medidas_del_tipo is
  'Copia las medidas del catálogo a la cotización al elegir el tipo de carrocería. Copia, no referencia: después se corrigen en la cotización sin tocar el catálogo.';

drop trigger if exists trg_cotizacion_traer_medidas_del_tipo on public.cotizaciones;

-- Antes que `trg_cotizacion_calcular` no hace falta —no toca importes— pero sí
-- antes de escribir la fila: el nombre lo pone alfabéticamente después de
-- `trg_cotizacion_calcular`, y ninguno depende del otro.
create trigger trg_cotizacion_traer_medidas_del_tipo
  before insert or update of tipo_carroceria_id on public.cotizaciones
  for each row execute function public.fn_cotizacion_traer_medidas_del_tipo();
