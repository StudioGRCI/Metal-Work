-- La clasificación dice a qué área va cada partida.
--
-- En las hojas de costeo de la empresa cada línea empieza por una CLASIFICACIÓN
-- —ESTRUCTURA, PERNERÍA, ACABADOS, SISTEMA ELÉCTRICO…— y las filas se agrupan
-- por ella. El sistema tenía en su lugar un `tipo_costo` de cuatro valores
-- —MATERIAL, MANO_OBRA, SERVICIO, OTRO— que inventé al armar el esquema, antes
-- de haber visto un costeo suyo. Cuatro cajones no describen una tolva: en una
-- sola salieron veintiuna clasificaciones.
--
-- Y la clasificación no es solo una etiqueta para agrupar: **dice a qué área del
-- taller va esa partida**. ESTRUCTURA es habilitado, PERNERÍA es ensamblado,
-- ACABADOS es pintura. Con eso, cuando la cotización aprobada se convierte en
-- orden, cada línea del presupuesto puede caer en su etapa y el área abre su
-- lista y marca su avance. Ese es el puente que faltaba entre lo que se costea y
-- lo que se fabrica.
--
-- El catálogo es cerrado pero ampliable: se elige de una lista, no se escribe
-- libre. En sus propias hojas «PERNERIA» aparece dos veces y «ACCESORIO» convive
-- con «ACCESORIOS»; con texto libre, en tres meses hay cuarenta clasificaciones
-- para veintiuna cosas y ningún informe cuadra.

-- =============================================================================
-- EL CATÁLOGO
-- =============================================================================

create table if not exists public.clasificaciones_costeo (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null,
  nombre            text not null,
  -- A qué área del taller va lo que se clasifica así. Puede faltar —hay
  -- clasificaciones que son gasto y no trabajo de taller— y entonces la partida
  -- no se reparte a ninguna etapa.
  etapa_catalogo_id uuid references public.etapas_catalogo(id) on delete restrict,
  -- La naturaleza del costo se deduce de la clasificación y ya no se pregunta
  -- aparte: elegir «SERVICIO DE ARENADO» es decir que es un servicio. Dos campos
  -- para lo mismo terminan con la mitad de las partidas mal clasificadas.
  tipo_costo        public.tipo_costo_partida not null default 'MATERIAL',
  orden             int not null default 0,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint uq_clasificacion_codigo unique (codigo)
);

comment on table public.clasificaciones_costeo is
  'Cómo agrupa la empresa las líneas de un costeo, y a qué área del taller va cada grupo. Sale de sus hojas de costeo reales.';
comment on column public.clasificaciones_costeo.etapa_catalogo_id is
  'El área que recibe esa partida cuando la cotización se convierte en orden de trabajo.';

create index if not exists idx_clasificaciones_costeo_etapa
  on public.clasificaciones_costeo(etapa_catalogo_id);

-- =============================================================================
-- LAS CLASIFICACIONES REALES
-- -----------------------------------------------------------------------------
-- Salieron de `40- TOLVA 17 M3 -TRINCO.xlsx` (agosto 2026) y de las hojas de
-- costeo de garantía. El área que se les asigna acá es la lectura más razonable
-- de qué hace cada cosa; la empresa la corrige desde Configuración sin tocar
-- código, que para eso es un catálogo.
-- =============================================================================

insert into public.clasificaciones_costeo (codigo, nombre, orden, tipo_costo, etapa_catalogo_id)
select v.codigo, v.nombre, v.orden, v.tipo_costo::public.tipo_costo_partida,
       (select id from public.etapas_catalogo where codigo = v.etapa)
  from (values
    -- Lo que se corta y se habilita: planchas, ángulos, tubos, barras.
    ('ESTRUCTURA',        'Estructura',                          10, 'MATERIAL', 'HABILITADO_MP'),
    -- Piezas torneadas: barra perforada, bocinas, pines.
    ('PINES_BOCINAS',     'Pines y bocinas',                     20, 'MATERIAL', 'REQ_MAESTRANZA'),
    ('ACCESORIO_ESTRUCT', 'Accesorio estructural',               30, 'MATERIAL', 'PRODUCCION'),
    ('COMPUERTA',         'Compuerta',                           40, 'MATERIAL', 'PRODUCCION'),
    ('SISTEMA_COMPUERTA', 'Sistema de compuerta posterior',      50, 'MATERIAL', 'PRODUCCION'),
    ('PERNERIA',          'Pernería',                            60, 'MATERIAL', 'PRODUCCION'),
    ('ACCESORIOS',        'Accesorios',                          70, 'MATERIAL', 'PRODUCCION'),
    ('SISTEMA_LEVANTE',   'Sistema de levante de porta llantas', 80, 'MATERIAL', 'PRODUCCION'),
    ('SISTEMA_ENGRASE',   'Sistema de engrase',                  90, 'MATERIAL', 'PRODUCCION'),
    ('SISTEMA_HIDRAULICO','Sistema hidráulico',                 100, 'MATERIAL', 'ELECTRICO_NEUM'),
    ('MANGUERAS_HIDRA',   'Mangueras hidráulicas',              110, 'MATERIAL', 'ELECTRICO_NEUM'),
    ('CONEXIONES_HIDRA',  'Conexiones y conectores hidráulicos',120, 'MATERIAL', 'ELECTRICO_NEUM'),
    ('SISTEMA_NEUMATICO', 'Sistema neumático',                  130, 'MATERIAL', 'ELECTRICO_NEUM'),
    ('CONEXIONES_NEUM',   'Conexiones neumáticas',              140, 'MATERIAL', 'ELECTRICO_NEUM'),
    ('SISTEMA_ELECTRICO', 'Sistema eléctrico',                  150, 'MATERIAL', 'ELECTRICO_NEUM'),
    ('FIN_CARRERA',       'Fin de carrera',                     160, 'MATERIAL', 'ELECTRICO_NEUM'),
    ('ACABADOS',          'Acabados',                           170, 'MATERIAL', 'PINTURA'),
    ('STICKERS',          'Stickers y logeado',                 180, 'MATERIAL', 'PINTURA'),
    -- Lo que se manda a hacer afuera. Va como una fila más en sus hojas.
    ('MO_ARMADO',         'Mano de obra tercera · armado',      200, 'SERVICIO', 'PRODUCCION'),
    ('MO_PINTURA',        'Mano de obra tercera · pintura',     210, 'SERVICIO', 'PINTURA'),
    ('SERV_ARENADO',      'Servicio de arenado',                220, 'SERVICIO', 'ARENADO'),
    ('SERV_MAESTRANZA',   'Servicio de maestranza',             230, 'SERVICIO', 'REQ_MAESTRANZA'),
    ('TRANSPORTE',        'Transporte y encomiendas',           240, 'SERVICIO', 'LOGISTICA'),
    ('TRAMITES',          'Trámites, placas y documentación',   250, 'SERVICIO', 'ENTREGA'),
    -- Horas propias del taller, cuando se costean aparte del material.
    ('MO_PRODUCCION',     'Mano de obra de producción',         260, 'MANO_OBRA', 'PRODUCCION'),
    -- Sin área: es gasto, no trabajo de taller.
    ('OTROS',             'Otros',                              900, 'OTRO', null)
  ) as v(codigo, nombre, orden, tipo_costo, etapa)
on conflict (codigo) do nothing;

-- =============================================================================
-- LA PARTIDA GUARDA SU CLASIFICACIÓN
-- =============================================================================

alter table public.cotizacion_partidas
  add column if not exists clasificacion_id uuid
    references public.clasificaciones_costeo(id) on delete restrict;

create index if not exists idx_cotizacion_partidas_clasificacion
  on public.cotizacion_partidas(clasificacion_id);

comment on column public.cotizacion_partidas.clasificacion_id is
  'Cómo agrupa la empresa esta línea y a qué área del taller va. De ella se deduce el tipo de costo.';

-- El tipo de costo deja de preguntarse: lo pone la clasificación. Sigue en la
-- tabla porque es lo que decide en qué línea del presupuesto de la OT cae la
-- partida, pero ya no hay dos campos que puedan contradecirse.
create or replace function public.fn_partida_tipo_desde_clasificacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.clasificacion_id is not null then
    select c.tipo_costo into new.tipo_costo
      from public.clasificaciones_costeo c
     where c.id = new.clasificacion_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_partida_tipo_desde_clasificacion on public.cotizacion_partidas;
create trigger trg_partida_tipo_desde_clasificacion
  before insert or update of clasificacion_id on public.cotizacion_partidas
  for each row execute function public.fn_partida_tipo_desde_clasificacion();

-- =============================================================================
-- LAS REJAS
-- -----------------------------------------------------------------------------
-- El catálogo lo lee cualquiera que pueda ver una cotización —hace falta para
-- pintar la pantalla— y lo mantiene quien administra la configuración del
-- taller, igual que las etapas y los tipos de carrocería.
-- =============================================================================

alter table public.clasificaciones_costeo enable row level security;

drop policy if exists ver_clasificaciones_costeo on public.clasificaciones_costeo;
create policy ver_clasificaciones_costeo on public.clasificaciones_costeo
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('cotizaciones.ver'));

drop policy if exists crear_clasificaciones_costeo on public.clasificaciones_costeo;
create policy crear_clasificaciones_costeo on public.clasificaciones_costeo
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('configuracion.editar'));

drop policy if exists editar_clasificaciones_costeo on public.clasificaciones_costeo;
create policy editar_clasificaciones_costeo on public.clasificaciones_costeo
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('configuracion.editar'))
  with check (public.es_admin() or public.tiene_permiso('configuracion.editar'));

grant select, insert, update on public.clasificaciones_costeo to authenticated;

drop trigger if exists trg_clasificacion_fecha on public.clasificaciones_costeo;
create trigger trg_clasificacion_fecha
  before update on public.clasificaciones_costeo
  for each row execute function public.fn_set_actualizado_en();

select public.activar_auditoria('clasificaciones_costeo');
