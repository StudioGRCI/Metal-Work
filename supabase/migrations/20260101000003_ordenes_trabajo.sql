-- =============================================================================
-- 0003 · PRODUCCIÓN · ÓRDENES DE TRABAJO Y EJECUCIÓN EN TALLER
-- Metal-Work · Fabricación y reparación de carrocerías para vehículos pesados
-- -----------------------------------------------------------------------------
-- Es el corazón del sistema. Modela:
--   · etapas_catalogo   fases estándar de fabricación, configurables
--   · ordenes_trabajo   la OT: qué se fabrica o repara, para quién y con qué plazo
--   · ot_etapas         instancia de cada fase dentro de una OT (el avance real)
--   · ot_tareas         tareas sueltas dentro de una etapa
--   · ot_personal       operarios asignados a la OT o a una etapa, con su oficio
--   · partes_diarios    parte de producción del día + parte_detalle (horas por operario)
--   · ot_inspecciones   control de calidad + ot_inspeccion_items (checklist)
--   · ot_entregas       acta de conformidad y garantía
--   · ot_bitacora       timeline de trazabilidad, alimentado por triggers
--
-- Reglas de negocio que se hacen cumplir AQUÍ y no en la aplicación:
--   1. El número de OT lo genera la base (nunca dos OT con el mismo número).
--   2. Las transiciones de estado siguen una máquina de estados; una OT ANULADA,
--      ENTREGADA o FACTURADA no puede volver a EN_PROCESO.
--   3. Las fechas reales se sellan solas al cambiar de estado.
--   4. El avance de la OT es el promedio de sus etapas ponderado por horas.
--   5. Las horas del parte diario solo impactan la OT cuando el parte se aprueba.
--   6. Una etapa marcada como crítica no se cierra sin inspección CONFORME.
--   7. Cada cambio relevante queda escrito en la bitácora de la OT.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums del dominio de producción
-- -----------------------------------------------------------------------------

create type public.tipo_trabajo_ot as enum (
  'FABRICACION',      -- carrocería nueva sobre chasis del cliente
  'REPARACION',       -- reparación de una carrocería existente
  'REPOTENCIACION',   -- reconstrucción o mejora de una carrocería usada
  'MANTENIMIENTO',    -- mantenimiento preventivo o correctivo menor
  'GARANTIA'          -- retrabajo sin costo dentro del plazo de garantía
);

create type public.estado_ot as enum (
  'BORRADOR',
  'APROBADA',
  'PROGRAMADA',
  'EN_PROCESO',
  'PAUSADA',
  'CONTROL_CALIDAD',
  'TERMINADA',
  'ENTREGADA',
  'FACTURADA',
  'ANULADA'
);

create type public.prioridad_ot as enum ('BAJA', 'NORMAL', 'ALTA', 'URGENTE');

create type public.estado_etapa_ot as enum (
  'PENDIENTE', 'EN_PROCESO', 'PAUSADA', 'TERMINADA', 'OMITIDA'
);

create type public.estado_tarea_ot as enum (
  'PENDIENTE', 'EN_PROCESO', 'TERMINADA', 'CANCELADA'
);

-- Oficio que cumple el operario dentro de la OT. Un mismo operario puede estar
-- asignado con dos oficios distintos (arma y suelda) en etapas distintas.
create type public.rol_operario as enum (
  'SOLDADOR', 'ARMADOR', 'PINTOR', 'ELECTRICISTA', 'AYUDANTE', 'MECANICO'
);

create type public.estado_parte_diario as enum ('BORRADOR', 'CERRADO', 'APROBADO');

create type public.resultado_inspeccion as enum ('CONFORME', 'OBSERVADO', 'RECHAZADO');

create type public.tipo_evento_ot as enum (
  'CREACION', 'CAMBIO_ESTADO', 'AVANCE', 'MATERIAL', 'DOCUMENTO',
  'INSPECCION', 'PAUSA', 'REANUDACION', 'COMENTARIO', 'ENTREGA'
);

-- =============================================================================
-- CATÁLOGO DE ETAPAS
-- =============================================================================

create table public.etapas_catalogo (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,
  nombre              text not null,
  descripcion         text,
  -- Posición en el flujo estándar de fabricación. Es única para que el tablero
  -- de taller tenga un orden determinista.
  orden_secuencia     int not null unique check (orden_secuencia > 0),
  horas_estandar      public.cantidad not null default 0 check (horas_estandar >= 0),
  -- Si es true la etapa no se puede cerrar sin una inspección CONFORME.
  requiere_inspeccion boolean not null default false,
  -- Si es true la etapa puede avanzar sin esperar a que termine la anterior
  -- (por ejemplo el sistema eléctrico mientras se masilla).
  permite_paralelo    boolean not null default false,
  -- Color hexadecimal para el tablero y el diagrama de barras del taller.
  color               text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  activo              boolean not null default true,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

comment on table public.etapas_catalogo is
  'Fases estándar de fabricación de una carrocería (habilitado, armado, soldadura, pintura...). Configurables: son la plantilla con la que se instancian las etapas de cada OT.';
comment on column public.etapas_catalogo.horas_estandar is
  'Horas-hombre de referencia de la etapa. Sirve de peso para calcular el avance de la OT y de base para programar.';
comment on column public.etapas_catalogo.requiere_inspeccion is
  'Etapa crítica: ot_etapas no permite cerrarla sin una inspección con resultado CONFORME.';

create index idx_etapas_catalogo_secuencia on public.etapas_catalogo(orden_secuencia) where activo;

-- =============================================================================
-- ORDEN DE TRABAJO
-- =============================================================================

create table public.ordenes_trabajo (
  id                       uuid primary key default gen_random_uuid(),
  -- Lo asigna el trigger con siguiente_correlativo('ORDEN_TRABAJO', ...).
  numero                   text not null unique,
  cliente_id               uuid not null references public.clientes(id) on delete restrict,
  unidad_id                uuid references public.unidades(id) on delete set null,
  cotizacion_id            uuid references public.cotizaciones(id) on delete set null,
  tipo_carroceria_id       uuid references public.tipos_carroceria(id) on delete restrict,
  sede_id                  uuid not null references public.sedes(id) on delete restrict,
  tipo_trabajo             public.tipo_trabajo_ot not null default 'FABRICACION',
  estado                   public.estado_ot not null default 'BORRADOR',
  prioridad                public.prioridad_ot not null default 'NORMAL',
  descripcion              text not null,
  especificaciones_tecnicas text,
  -- Medidas y características de la carrocería en clave/valor: largo, ancho,
  -- alto, espesor_plancha, capacidad_m3, tipo_compuerta, etc. Va en jsonb porque
  -- cada tipo de carrocería tiene su propia ficha técnica.
  datos_tecnicos           jsonb not null default '{}'::jsonb,
  fecha_registro           date not null default current_date,
  fecha_inicio_programada  date,
  fecha_fin_programada     date,
  -- Fecha prometida al cliente; es la que se mide para el indicador de atraso.
  fecha_entrega_comprometida date,
  fecha_inicio_real        timestamptz,
  fecha_fin_real           timestamptz,
  -- Jefe de taller a cargo de ejecutar la OT.
  responsable_id           uuid references public.usuarios(id) on delete set null,
  supervisor_id            uuid references public.usuarios(id) on delete set null,
  moneda                   public.moneda not null default 'PEN',
  monto_presupuestado      public.monto not null default 0 check (monto_presupuestado >= 0),
  -- Lo recalcula el trigger a partir de ot_etapas; solo se edita a mano en OT
  -- que no usan etapas.
  avance_porcentaje        public.porcentaje not null default 0,
  horas_estimadas          public.cantidad not null default 0 check (horas_estimadas >= 0),
  horas_reales             public.cantidad not null default 0 check (horas_reales >= 0),
  motivo_pausa             text,
  motivo_anulacion         text,
  observaciones            text,
  creado_por               uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now(),

  constraint ck_ot_fechas_programadas check (
    fecha_inicio_programada is null or fecha_fin_programada is null
    or fecha_fin_programada >= fecha_inicio_programada),
  constraint ck_ot_fechas_reales check (
    fecha_inicio_real is null or fecha_fin_real is null
    or fecha_fin_real >= fecha_inicio_real),
  -- Pausar y anular exigen justificación: sin motivo no hay trazabilidad.
  constraint ck_ot_motivo_pausa check (estado <> 'PAUSADA' or nullif(btrim(motivo_pausa), '') is not null),
  constraint ck_ot_motivo_anulacion check (estado <> 'ANULADA' or nullif(btrim(motivo_anulacion), '') is not null),
  -- Necesario para que ot_etapas, parte_detalle e inspecciones puedan amarrar
  -- (etapa_id, orden_id) con una FK compuesta.
  constraint uq_ot_id_sede unique (id, sede_id)
);

comment on table public.ordenes_trabajo is
  'Orden de trabajo: el documento que autoriza y controla la fabricación o reparación de una carrocería. Eje de todo el sistema: materiales, horas, costos y documentos cuelgan de ella.';
comment on column public.ordenes_trabajo.numero is
  'Correlativo del sistema (por ejemplo OT-001-00042). Lo genera el trigger si viene nulo y luego es inmutable.';
comment on column public.ordenes_trabajo.datos_tecnicos is
  'Ficha técnica libre de la carrocería en formato clave/valor.';
comment on column public.ordenes_trabajo.avance_porcentaje is
  'Promedio del avance de las etapas ponderado por sus horas estimadas. Lo mantiene fn_ot_recalcular_avance.';
comment on column public.ordenes_trabajo.horas_reales is
  'Suma de horas de ot_etapas, que a su vez solo crecen cuando se aprueba un parte diario.';

create index idx_ot_cliente        on public.ordenes_trabajo(cliente_id);
create index idx_ot_unidad         on public.ordenes_trabajo(unidad_id);
create index idx_ot_cotizacion     on public.ordenes_trabajo(cotizacion_id);
create index idx_ot_tipo_carroceria on public.ordenes_trabajo(tipo_carroceria_id);
create index idx_ot_sede           on public.ordenes_trabajo(sede_id);
create index idx_ot_responsable    on public.ordenes_trabajo(responsable_id);
create index idx_ot_supervisor     on public.ordenes_trabajo(supervisor_id);
create index idx_ot_creado_por     on public.ordenes_trabajo(creado_por);
create index idx_ot_estado         on public.ordenes_trabajo(estado);
create index idx_ot_prioridad      on public.ordenes_trabajo(prioridad);
create index idx_ot_fecha_registro on public.ordenes_trabajo(fecha_registro desc);
create index idx_ot_sede_estado    on public.ordenes_trabajo(sede_id, estado);
-- El tablero del taller siempre pide "lo que está abierto", ordenado por compromiso.
create index idx_ot_abiertas on public.ordenes_trabajo(fecha_entrega_comprometida)
  where estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA');
-- Búsqueda por texto de la descripción del trabajo ("tolva 18m3", "furgón frigorífico").
create index idx_ot_descripcion_trgm on public.ordenes_trabajo using gin (descripcion gin_trgm_ops);

-- =============================================================================
-- ETAPAS DE LA OT
-- =============================================================================

create table public.ot_etapas (
  id                      uuid primary key default gen_random_uuid(),
  orden_id                uuid not null references public.ordenes_trabajo(id) on delete cascade,
  etapa_catalogo_id       uuid not null references public.etapas_catalogo(id) on delete restrict,
  estado                  public.estado_etapa_ot not null default 'PENDIENTE',
  -- Se copia del catálogo al instanciar, pero se puede reordenar por OT.
  orden_secuencia         int not null check (orden_secuencia > 0),
  avance_porcentaje       public.porcentaje not null default 0,
  fecha_inicio_programada date,
  fecha_fin_programada    date,
  fecha_inicio_real       timestamptz,
  fecha_fin_real          timestamptz,
  horas_estimadas         public.cantidad not null default 0 check (horas_estimadas >= 0),
  -- Solo la mueven los partes diarios aprobados.
  horas_reales            public.cantidad not null default 0 check (horas_reales >= 0),
  responsable_id          uuid references public.usuarios(id) on delete set null,
  -- Fotografía del catálogo al momento de crear la etapa: si mañana se relaja
  -- el catálogo, las OT en curso conservan la exigencia con la que nacieron.
  requiere_inspeccion     boolean not null default false,
  observaciones           text,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  constraint uq_ot_etapa unique (orden_id, etapa_catalogo_id),
  constraint uq_ot_etapa_orden unique (id, orden_id),
  constraint ck_ot_etapa_fechas_programadas check (
    fecha_inicio_programada is null or fecha_fin_programada is null
    or fecha_fin_programada >= fecha_inicio_programada),
  constraint ck_ot_etapa_fechas_reales check (
    fecha_inicio_real is null or fecha_fin_real is null
    or fecha_fin_real >= fecha_inicio_real)
);

comment on table public.ot_etapas is
  'Instancia de una etapa del catálogo dentro de una OT. Es donde se mide el avance real del trabajo en taller.';
comment on constraint uq_ot_etapa_orden on public.ot_etapas is
  'Clave alterna que permite a otras tablas referenciar (etapa_id, orden_id) y garantizar que la etapa pertenece a esa OT.';

create index idx_ot_etapas_orden       on public.ot_etapas(orden_id);
create index idx_ot_etapas_catalogo    on public.ot_etapas(etapa_catalogo_id);
create index idx_ot_etapas_responsable on public.ot_etapas(responsable_id);
create index idx_ot_etapas_estado      on public.ot_etapas(estado);
create index idx_ot_etapas_secuencia   on public.ot_etapas(orden_id, orden_secuencia);

-- =============================================================================
-- TAREAS DENTRO DE UNA ETAPA
-- =============================================================================

create table public.ot_tareas (
  id                uuid primary key default gen_random_uuid(),
  etapa_id          uuid not null references public.ot_etapas(id) on delete cascade,
  descripcion       text not null,
  detalle           text,
  estado            public.estado_tarea_ot not null default 'PENDIENTE',
  responsable_id    uuid references public.usuarios(id) on delete set null,
  orden_secuencia   int not null default 1 check (orden_secuencia > 0),
  horas_estimadas   public.cantidad not null default 0 check (horas_estimadas >= 0),
  fecha_programada  date,
  fecha_inicio_real timestamptz,
  fecha_fin_real    timestamptz,
  observaciones     text,
  creado_por        uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint ck_ot_tarea_fechas_reales check (
    fecha_inicio_real is null or fecha_fin_real is null
    or fecha_fin_real >= fecha_inicio_real)
);

comment on table public.ot_tareas is
  'Tareas sueltas dentro de una etapa (por ejemplo "reforzar bastidor lado izquierdo"). No pesan en el avance: son la lista de pendientes del jefe de taller.';

create index idx_ot_tareas_etapa       on public.ot_tareas(etapa_id);
create index idx_ot_tareas_responsable on public.ot_tareas(responsable_id);
create index idx_ot_tareas_estado      on public.ot_tareas(estado);
create index idx_ot_tareas_creado_por  on public.ot_tareas(creado_por);

-- =============================================================================
-- PERSONAL ASIGNADO
-- =============================================================================

create table public.ot_personal (
  id                   uuid primary key default gen_random_uuid(),
  orden_id             uuid not null references public.ordenes_trabajo(id) on delete cascade,
  -- Nulo = asignado a toda la OT; con valor = asignado a una etapa concreta.
  etapa_id             uuid,
  usuario_id           uuid not null references public.usuarios(id) on delete restrict,
  rol                  public.rol_operario not null,
  fecha_asignacion     date not null default current_date,
  fecha_desasignacion  date,
  observaciones        text,
  creado_por           uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),

  constraint fk_ot_personal_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete cascade,
  constraint ck_ot_personal_fechas check (
    fecha_desasignacion is null or fecha_desasignacion >= fecha_asignacion)
);

comment on table public.ot_personal is
  'Cuadrilla asignada a la OT o a una de sus etapas, con el oficio que cumple cada operario y el periodo de la asignación.';
comment on column public.ot_personal.etapa_id is
  'Etapa a la que se asigna. La FK compuesta con orden_id impide asignar a una etapa de otra OT.';

create index idx_ot_personal_orden   on public.ot_personal(orden_id);
create index idx_ot_personal_etapa   on public.ot_personal(etapa_id);
create index idx_ot_personal_usuario on public.ot_personal(usuario_id);
create index idx_ot_personal_creado_por on public.ot_personal(creado_por);
-- Un operario no puede estar asignado dos veces con el mismo oficio a la misma
-- OT/etapa mientras la asignación siga vigente (sí puede reasignarse después).
create unique index uq_ot_personal_vigente
  on public.ot_personal (orden_id, etapa_id, usuario_id, rol)
  nulls not distinct
  where fecha_desasignacion is null;

-- =============================================================================
-- PARTE DIARIO DE PRODUCCIÓN
-- =============================================================================

create table public.partes_diarios (
  id                uuid primary key default gen_random_uuid(),
  numero            text not null unique,
  fecha             date not null default current_date,
  sede_id           uuid not null references public.sedes(id) on delete restrict,
  estado            public.estado_parte_diario not null default 'BORRADOR',
  -- Supervisor o jefe de taller que levanta el parte.
  responsable_id    uuid references public.usuarios(id) on delete set null,
  -- Totales del día, mantenidos por el trigger del detalle.
  total_horas       public.cantidad not null default 0 check (total_horas >= 0),
  total_horas_extra public.cantidad not null default 0 check (total_horas_extra >= 0),
  observaciones     text,
  fecha_cierre      timestamptz,
  aprobado_por      uuid references public.usuarios(id) on delete set null,
  fecha_aprobacion  timestamptz,
  creado_por        uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- Un solo parte por taller y día: es el documento oficial de esa jornada.
  constraint uq_parte_sede_fecha unique (sede_id, fecha)
);

comment on table public.partes_diarios is
  'Parte de producción del día por taller. Mientras está en BORRADOR se edita; al APROBARSE sus horas se cargan a las etapas de las OT y ya no se puede tocar.';
comment on column public.partes_diarios.estado is
  'BORRADOR (se edita) → CERRADO (lo cierra el supervisor) → APROBADO (impacta las horas reales de las OT).';

create index idx_partes_sede         on public.partes_diarios(sede_id);
create index idx_partes_fecha        on public.partes_diarios(fecha desc);
create index idx_partes_estado       on public.partes_diarios(estado);
create index idx_partes_responsable  on public.partes_diarios(responsable_id);
create index idx_partes_aprobado_por on public.partes_diarios(aprobado_por);
create index idx_partes_creado_por   on public.partes_diarios(creado_por);

create table public.parte_detalle (
  id             uuid primary key default gen_random_uuid(),
  parte_id       uuid not null references public.partes_diarios(id) on delete cascade,
  orden_id       uuid not null references public.ordenes_trabajo(id) on delete restrict,
  -- Obligatoria: toda hora de taller se imputa a una etapa concreta de la OT,
  -- que es lo que permite comparar horas estándar contra horas reales.
  etapa_id       uuid not null,
  usuario_id     uuid not null references public.usuarios(id) on delete restrict,
  horas          public.cantidad not null check (horas > 0 and horas <= 24),
  horas_extra    public.cantidad not null default 0 check (horas_extra >= 0 and horas_extra <= 12),
  horas_totales  public.cantidad generated always as (horas + horas_extra) stored,
  descripcion    text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Nadie trabaja más de una jornada completa en un día.
  constraint ck_parte_detalle_jornada check (horas + horas_extra <= 24),
  constraint fk_parte_detalle_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete restrict,
  -- Un operario aparece una sola vez por OT-etapa dentro del mismo parte:
  -- si trabajó en dos momentos del día se acumulan las horas en una línea.
  constraint uq_parte_detalle_operario unique (parte_id, usuario_id, orden_id, etapa_id)
);

comment on table public.parte_detalle is
  'Horas-hombre del día: qué operario trabajó, en qué OT y etapa, cuántas horas normales y extra, y qué hizo.';
comment on column public.parte_detalle.horas_totales is
  'Columna calculada: horas + horas_extra. Es la base del costeo de mano de obra directa.';

create index idx_parte_detalle_parte   on public.parte_detalle(parte_id);
create index idx_parte_detalle_orden   on public.parte_detalle(orden_id);
create index idx_parte_detalle_etapa   on public.parte_detalle(etapa_id);
create index idx_parte_detalle_usuario on public.parte_detalle(usuario_id);
create index idx_parte_detalle_orden_etapa on public.parte_detalle(orden_id, etapa_id);

-- =============================================================================
-- CONTROL DE CALIDAD
-- =============================================================================

create table public.ot_inspecciones (
  id                  uuid primary key default gen_random_uuid(),
  numero              text not null unique,
  orden_id            uuid not null references public.ordenes_trabajo(id) on delete cascade,
  -- Nula cuando es una inspección final de toda la carrocería.
  etapa_id            uuid,
  fecha               timestamptz not null default now(),
  inspector_id        uuid references public.usuarios(id) on delete set null,
  resultado           public.resultado_inspeccion not null,
  observaciones       text,
  acciones_correctivas text,
  -- Fecha en que se dieron por levantadas las observaciones.
  fecha_levantamiento timestamptz,
  levantado_por       uuid references public.usuarios(id) on delete set null,
  creado_por          uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint fk_ot_inspecciones_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete cascade,
  -- Observar o rechazar sin decir por qué no sirve para nada.
  constraint ck_inspeccion_observaciones check (
    resultado = 'CONFORME' or nullif(btrim(observaciones), '') is not null),
  constraint ck_inspeccion_levantamiento check (
    fecha_levantamiento is null or (resultado <> 'CONFORME' and fecha_levantamiento >= fecha))
);

comment on table public.ot_inspecciones is
  'Control de calidad de una etapa o de la carrocería completa. Una etapa marcada como crítica no se cierra sin una inspección CONFORME.';
comment on column public.ot_inspecciones.fecha_levantamiento is
  'Momento en que se verificó que las observaciones fueron subsanadas. Solo aplica a inspecciones OBSERVADO o RECHAZADO.';

create index idx_inspecciones_orden     on public.ot_inspecciones(orden_id);
create index idx_inspecciones_etapa     on public.ot_inspecciones(etapa_id);
create index idx_inspecciones_inspector on public.ot_inspecciones(inspector_id);
create index idx_inspecciones_levantado on public.ot_inspecciones(levantado_por);
create index idx_inspecciones_creado_por on public.ot_inspecciones(creado_por);
create index idx_inspecciones_resultado on public.ot_inspecciones(resultado);
create index idx_inspecciones_fecha     on public.ot_inspecciones(fecha desc);
-- Observaciones abiertas: lo primero que revisa el jefe de calidad.
create index idx_inspecciones_pendientes on public.ot_inspecciones(orden_id)
  where resultado <> 'CONFORME' and fecha_levantamiento is null;

create table public.ot_inspeccion_items (
  id             uuid primary key default gen_random_uuid(),
  inspeccion_id  uuid not null references public.ot_inspecciones(id) on delete cascade,
  orden_secuencia int not null default 1 check (orden_secuencia > 0),
  item           text not null,
  -- null = no aplica a esta carrocería.
  cumple         boolean,
  observacion    text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint ck_inspeccion_item_observacion check (
    cumple is distinct from false or nullif(btrim(observacion), '') is not null)
);

comment on table public.ot_inspeccion_items is
  'Checklist de la inspección (soldadura sin poros, espesor de pintura, torque de pernos...). Un ítem que no cumple obliga a escribir la observación.';

create index idx_inspeccion_items_inspeccion on public.ot_inspeccion_items(inspeccion_id, orden_secuencia);

-- =============================================================================
-- ACTA DE CONFORMIDAD / ENTREGA
-- =============================================================================

create table public.ot_entregas (
  id                uuid primary key default gen_random_uuid(),
  numero            text not null unique,
  orden_id          uuid not null references public.ordenes_trabajo(id) on delete cascade,
  fecha_entrega     date not null default current_date,
  recibe_nombre     text not null,
  -- DNI, carné de extranjería o RUC de quien recibe; se guarda como texto libre
  -- porque el chofer que retira la unidad no siempre tiene DNI peruano.
  recibe_documento  text,
  recibe_cargo      text,
  conforme          boolean not null default true,
  observaciones     text,
  garantia_meses    int not null default 0 check (garantia_meses between 0 and 120),
  -- Vencimiento de garantía calculado: no se puede desincronizar de la entrega.
  garantia_vence    date generated always as (
                      (fecha_entrega + make_interval(months => garantia_meses))::date) stored,
  entregado_por     uuid references public.usuarios(id) on delete set null,
  creado_por        uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- Si el cliente no da conformidad hay que dejar constancia de por qué.
  constraint ck_entrega_conformidad check (
    conforme or nullif(btrim(observaciones), '') is not null)
);

comment on table public.ot_entregas is
  'Acta de conformidad con la que el cliente recibe la unidad. Registrarla pasa la OT a ENTREGADA e inicia el cómputo de la garantía.';
comment on column public.ot_entregas.garantia_vence is
  'fecha_entrega + garantia_meses. Calculada por la base para reclamos de garantía.';

create index idx_entregas_orden    on public.ot_entregas(orden_id);
create index idx_entregas_fecha    on public.ot_entregas(fecha_entrega desc);
create index idx_entregas_garantia on public.ot_entregas(garantia_vence) where garantia_meses > 0;
create index idx_entregas_entregado_por on public.ot_entregas(entregado_por);
create index idx_entregas_creado_por on public.ot_entregas(creado_por);

-- =============================================================================
-- BITÁCORA / TRAZABILIDAD DE LA OT
-- =============================================================================

create table public.ot_bitacora (
  id           uuid primary key default gen_random_uuid(),
  orden_id     uuid not null references public.ordenes_trabajo(id) on delete cascade,
  etapa_id     uuid references public.ot_etapas(id) on delete set null,
  tipo_evento  public.tipo_evento_ot not null,
  descripcion  text not null,
  -- Contexto del evento: estados anterior/nuevo, horas, documento, material...
  datos        jsonb not null default '{}'::jsonb,
  usuario_id   uuid references public.usuarios(id) on delete set null,
  creado_en    timestamptz not null default now()
);

comment on table public.ot_bitacora is
  'Línea de tiempo de la OT. Es un registro inmutable y de solo inserción: no lleva actualizado_en ni auditoría porque ella misma ES la traza. Los módulos de almacén y documentos escriben aquí con ot_registrar_evento().';

create index idx_bitacora_orden  on public.ot_bitacora(orden_id, creado_en desc);
create index idx_bitacora_etapa  on public.ot_bitacora(etapa_id);
create index idx_bitacora_tipo   on public.ot_bitacora(tipo_evento, creado_en desc);
create index idx_bitacora_usuario on public.ot_bitacora(usuario_id);

-- =============================================================================
-- FUNCIONES DE APOYO
-- =============================================================================

-- Numera un documento de producción intentando primero la serie de la sede y,
-- si esa sede no tiene serie propia, la serie global (sede_id nulo). Evita que
-- la numeración dependa de cómo se hayan configurado las series en cada taller.
create or replace function public.produccion_siguiente_numero(
  p_tipo public.tipo_correlativo,
  p_sede uuid
)
returns text
language plpgsql
volatile
as $$
begin
  if p_sede is null then
    return public.siguiente_correlativo(p_tipo, null, null);
  end if;

  begin
    return public.siguiente_correlativo(p_tipo, null, p_sede);
  exception when no_data_found then
    return public.siguiente_correlativo(p_tipo, null, null);
  end;
end;
$$;

comment on function public.produccion_siguiente_numero is
  'Correlativo de un documento de producción con respaldo a la serie global cuando la sede no tiene serie propia.';

-- Punto de entrada único a la bitácora. Los módulos de almacén (consumos),
-- documentos (planos, actas) y costos pueden llamarla para dejar su huella
-- en la línea de tiempo de la OT.
create or replace function public.ot_registrar_evento(
  p_orden_id    uuid,
  p_tipo        public.tipo_evento_ot,
  p_descripcion text,
  p_datos       jsonb default '{}'::jsonb,
  p_etapa_id    uuid default null,
  p_usuario_id  uuid default null
)
returns uuid
language plpgsql
volatile
as $$
declare v_id uuid;
begin
  insert into public.ot_bitacora (orden_id, etapa_id, tipo_evento, descripcion, datos, usuario_id)
  values (p_orden_id, p_etapa_id, p_tipo, p_descripcion,
          coalesce(p_datos, '{}'::jsonb),
          coalesce(p_usuario_id, public.usuario_actual()))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.ot_registrar_evento is
  'Registra un evento en la bitácora de la OT. Es la manera correcta de escribir la traza desde otros módulos.';

-- Máquina de estados de la OT. Se declara como función y no como tabla para que
-- las transiciones válidas no dependan de datos semilla: si la tabla estuviera
-- vacía la OT quedaría congelada.
create or replace function public.ot_transicion_valida(
  p_origen  public.estado_ot,
  p_destino public.estado_ot
)
returns boolean
language sql
immutable
as $$
  select p_origen = p_destino
      or (p_origen::text || '>' || p_destino::text) = any (array[
        -- Preparación
        'BORRADOR>APROBADA',        'BORRADOR>ANULADA',
        'APROBADA>PROGRAMADA',      'APROBADA>EN_PROCESO',
        'APROBADA>BORRADOR',        'APROBADA>ANULADA',
        'PROGRAMADA>EN_PROCESO',    'PROGRAMADA>APROBADA',
        'PROGRAMADA>ANULADA',
        -- Ejecución en taller
        'EN_PROCESO>PAUSADA',       'EN_PROCESO>CONTROL_CALIDAD',
        'EN_PROCESO>TERMINADA',     'EN_PROCESO>ANULADA',
        'PAUSADA>EN_PROCESO',       'PAUSADA>ANULADA',
        -- Calidad: si el control observa la carrocería, vuelve a taller
        'CONTROL_CALIDAD>EN_PROCESO',
        'CONTROL_CALIDAD>TERMINADA',
        'CONTROL_CALIDAD>ANULADA',
        -- Cierre. TERMINADA todavía admite retrabajo antes de entregar.
        'TERMINADA>EN_PROCESO',     'TERMINADA>ENTREGADA',
        'TERMINADA>ANULADA',
        'ENTREGADA>FACTURADA'
        -- ENTREGADA, FACTURADA y ANULADA no vuelven a producción.
      ]);
$$;

comment on function public.ot_transicion_valida is
  'Transiciones permitidas entre estados de una OT. La usa el trigger de validación y la aplicación para habilitar botones.';

-- Instancia en la OT todas las etapas activas del catálogo. Es idempotente:
-- volver a llamarla solo agrega las etapas que falten.
create or replace function public.crear_etapas_ot(p_orden_id uuid)
returns integer
language plpgsql
volatile
as $$
declare
  v_creadas integer;
begin
  if not exists (select 1 from public.ordenes_trabajo where id = p_orden_id) then
    raise exception 'No existe la orden de trabajo %', p_orden_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.ot_etapas (
    orden_id, etapa_catalogo_id, orden_secuencia, horas_estimadas, requiere_inspeccion)
  select p_orden_id, ec.id, ec.orden_secuencia, ec.horas_estandar, ec.requiere_inspeccion
    from public.etapas_catalogo ec
   where ec.activo
   order by ec.orden_secuencia
  on conflict (orden_id, etapa_catalogo_id) do nothing;

  get diagnostics v_creadas = row_count;

  if v_creadas > 0 then
    perform public.ot_registrar_evento(
      p_orden_id, 'CREACION',
      format('Se generaron %s etapas de producción para la OT', v_creadas),
      jsonb_build_object('etapas_creadas', v_creadas));
  end if;

  return v_creadas;
end;
$$;

comment on function public.crear_etapas_ot is
  'Crea las etapas de una OT a partir del catálogo activo. Se dispara sola al aprobar la OT y puede volver a llamarse si luego se activan etapas nuevas.';

-- Recalcula avance y horas de una OT a partir de sus etapas. El avance es el
-- promedio ponderado por horas estimadas: una etapa de 40 horas pesa el doble
-- que una de 20. Las etapas OMITIDAS no cuentan ni en el avance ni en el peso.
create or replace function public.ot_recalcular_avance(p_orden_id uuid)
returns void
language plpgsql
volatile
as $$
declare
  v_avance     public.porcentaje;
  v_estimadas  public.cantidad;
  v_reales     public.cantidad;
begin
  select
    coalesce(round(
      sum(e.avance_porcentaje * coalesce(nullif(e.horas_estimadas, 0), 1))
        filter (where e.estado <> 'OMITIDA')
      / nullif(sum(coalesce(nullif(e.horas_estimadas, 0), 1))
        filter (where e.estado <> 'OMITIDA'), 0), 2), 0),
    coalesce(sum(e.horas_estimadas) filter (where e.estado <> 'OMITIDA'), 0),
    coalesce(sum(e.horas_reales), 0)
  into v_avance, v_estimadas, v_reales
  from public.ot_etapas e
  where e.orden_id = p_orden_id;

  -- Una OT sin etapas conserva el avance que se le haya puesto a mano.
  if not exists (select 1 from public.ot_etapas where orden_id = p_orden_id) then
    return;
  end if;

  update public.ordenes_trabajo o
     set avance_porcentaje = v_avance,
         horas_estimadas   = v_estimadas,
         horas_reales      = v_reales
   where o.id = p_orden_id
     and (o.avance_porcentaje is distinct from v_avance
       or o.horas_estimadas   is distinct from v_estimadas
       or o.horas_reales      is distinct from v_reales);
end;
$$;

comment on function public.ot_recalcular_avance is
  'Recalcula avance_porcentaje, horas_estimadas y horas_reales de la OT desde sus etapas. Solo escribe si algo cambió, para no ensuciar la auditoría.';

-- =============================================================================
-- TRIGGERS · ORDEN DE TRABAJO
-- =============================================================================

create or replace function public.fn_ot_antes_insert()
returns trigger
language plpgsql
as $$
begin
  -- Numeración atómica: dos usuarios grabando a la vez nunca obtienen el mismo
  -- número porque siguiente_correlativo bloquea la fila de la serie.
  if nullif(btrim(new.numero), '') is null then
    new.numero := public.produccion_siguiente_numero('ORDEN_TRABAJO', new.sede_id);
  end if;

  if new.estado = 'EN_PROCESO' and new.fecha_inicio_real is null then
    new.fecha_inicio_real := now();
  end if;

  return new;
end;
$$;

create or replace function public.fn_ot_antes_update()
returns trigger
language plpgsql
as $$
begin
  if new.numero is distinct from old.numero then
    raise exception 'El número de la OT % no se puede modificar', old.numero
      using errcode = 'check_violation';
  end if;

  if new.estado is distinct from old.estado then
    if not public.ot_transicion_valida(old.estado, new.estado) then
      raise exception 'Transición de estado no permitida en la OT %: % → %',
        old.numero, old.estado, new.estado
        using errcode = 'check_violation',
              hint = 'Una OT ENTREGADA, FACTURADA o ANULADA ya no vuelve a producción.';
    end if;

    -- Programar exige tener plazo: sin fechas no hay programación posible.
    if new.estado = 'PROGRAMADA'
       and (new.fecha_inicio_programada is null or new.fecha_fin_programada is null) then
      raise exception 'La OT % no se puede programar sin fecha de inicio y fin programadas', old.numero
        using errcode = 'check_violation';
    end if;

    -- No se cierra una OT con etapas de taller todavía abiertas.
    if new.estado = 'TERMINADA'
       and exists (select 1 from public.ot_etapas e
                    where e.orden_id = new.id
                      and e.estado not in ('TERMINADA', 'OMITIDA')) then
      raise exception 'La OT % tiene etapas sin terminar', old.numero
        using errcode = 'check_violation',
              hint = 'Termine u omita todas las etapas antes de dar por terminada la OT.';
    end if;

    -- Sellado automático de las fechas reales.
    if new.estado = 'EN_PROCESO' and new.fecha_inicio_real is null then
      new.fecha_inicio_real := now();
    end if;
    if new.estado = 'TERMINADA' and new.fecha_fin_real is null then
      new.fecha_fin_real := now();
    end if;
    -- Al reanudar se limpia el motivo de la pausa que quedó atrás.
    if old.estado = 'PAUSADA' and new.estado <> 'PAUSADA' then
      new.motivo_pausa := null;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.fn_ot_despues_insert()
returns trigger
language plpgsql
as $$
begin
  perform public.ot_registrar_evento(
    new.id, 'CREACION',
    format('Se registró la OT %s (%s)', new.numero, new.tipo_trabajo),
    jsonb_build_object('estado', new.estado, 'prioridad', new.prioridad,
                       'tipo_trabajo', new.tipo_trabajo),
    null, new.creado_por);

  -- Una OT que nace ya aprobada también necesita sus etapas.
  if new.estado <> 'BORRADOR' and new.estado <> 'ANULADA' then
    perform public.crear_etapas_ot(new.id);
  end if;

  return null;
end;
$$;

create or replace function public.fn_ot_despues_update()
returns trigger
language plpgsql
as $$
declare
  v_tipo  public.tipo_evento_ot;
  v_texto text;
begin
  if new.estado is not distinct from old.estado then
    return null;
  end if;

  -- Al aprobar se instancian las etapas del catálogo.
  if new.estado = 'APROBADA' then
    perform public.crear_etapas_ot(new.id);
  end if;

  if new.estado = 'PAUSADA' then
    v_tipo  := 'PAUSA';
    v_texto := format('OT pausada: %s', coalesce(new.motivo_pausa, 'sin motivo'));
  elsif old.estado = 'PAUSADA' then
    v_tipo  := 'REANUDACION';
    v_texto := format('OT reanudada en estado %s', new.estado);
  elsif new.estado = 'ENTREGADA' then
    v_tipo  := 'ENTREGA';
    v_texto := 'OT entregada al cliente';
  else
    v_tipo  := 'CAMBIO_ESTADO';
    v_texto := format('Estado de la OT: %s → %s', old.estado, new.estado);
  end if;

  perform public.ot_registrar_evento(
    new.id, v_tipo, v_texto,
    jsonb_build_object(
      'estado_anterior', old.estado,
      'estado_nuevo',    new.estado,
      'motivo',          coalesce(new.motivo_pausa, new.motivo_anulacion),
      'avance',          new.avance_porcentaje));

  return null;
end;
$$;

create trigger trg_ot_antes_insert   before insert on public.ordenes_trabajo
  for each row execute function public.fn_ot_antes_insert();
create trigger trg_ot_antes_update   before update on public.ordenes_trabajo
  for each row execute function public.fn_ot_antes_update();
create trigger trg_ot_despues_insert after insert on public.ordenes_trabajo
  for each row execute function public.fn_ot_despues_insert();
create trigger trg_ot_despues_update after update on public.ordenes_trabajo
  for each row execute function public.fn_ot_despues_update();

-- =============================================================================
-- TRIGGERS · ETAPAS DE LA OT
-- =============================================================================

create or replace function public.fn_ot_etapa_antes_update()
returns trigger
language plpgsql
as $$
declare
  v_estado_ot public.estado_ot;
  v_numero    text;
begin
  select o.estado, o.numero into v_estado_ot, v_numero
    from public.ordenes_trabajo o where o.id = new.orden_id;

  if v_estado_ot = 'ANULADA' then
    raise exception 'La OT % está anulada: sus etapas ya no se pueden modificar', v_numero
      using errcode = 'check_violation';
  end if;

  if new.estado is distinct from old.estado then
    -- Una etapa terminada solo se reabre para retrabajo; una omitida vuelve a pendiente.
    if old.estado = 'TERMINADA' and new.estado <> 'EN_PROCESO' then
      raise exception 'La etapa terminada de la OT % solo puede reabrirse como EN_PROCESO', v_numero
        using errcode = 'check_violation';
    end if;
    if old.estado = 'OMITIDA' and new.estado <> 'PENDIENTE' then
      raise exception 'La etapa omitida de la OT % solo puede volver a PENDIENTE', v_numero
        using errcode = 'check_violation';
    end if;

    if new.estado = 'EN_PROCESO' and new.fecha_inicio_real is null then
      new.fecha_inicio_real := now();
    end if;

    if new.estado = 'TERMINADA' then
      -- Etapa crítica: sin control de calidad conforme no se cierra.
      if new.requiere_inspeccion
         and not exists (select 1 from public.ot_inspecciones i
                          where i.etapa_id = new.id and i.resultado = 'CONFORME') then
        raise exception 'La etapa requiere inspección de calidad conforme antes de cerrarse (OT %)', v_numero
          using errcode = 'check_violation',
                hint = 'Registre una inspección con resultado CONFORME para esta etapa.';
      end if;
      new.avance_porcentaje := 100;
      if new.fecha_fin_real is null then
        new.fecha_fin_real := now();
      end if;
    end if;

    if new.estado = 'OMITIDA' then
      new.avance_porcentaje := 0;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.fn_ot_etapa_bitacora()
returns trigger
language plpgsql
as $$
declare
  v_etapa text;
begin
  select ec.nombre into v_etapa
    from public.etapas_catalogo ec where ec.id = new.etapa_catalogo_id;

  if new.estado is distinct from old.estado then
    perform public.ot_registrar_evento(
      new.orden_id, 'CAMBIO_ESTADO',
      format('Etapa %s: %s → %s', v_etapa, old.estado, new.estado),
      jsonb_build_object('etapa', v_etapa, 'estado_anterior', old.estado,
                         'estado_nuevo', new.estado, 'avance', new.avance_porcentaje),
      new.id);
  elsif new.avance_porcentaje is distinct from old.avance_porcentaje then
    perform public.ot_registrar_evento(
      new.orden_id, 'AVANCE',
      format('Etapa %s al %s%%', v_etapa, new.avance_porcentaje),
      jsonb_build_object('etapa', v_etapa, 'avance_anterior', old.avance_porcentaje,
                         'avance', new.avance_porcentaje),
      new.id);
  end if;

  return null;
end;
$$;

-- Se dispara una vez por sentencia (no por fila) usando tablas de transición:
-- crear las 12 etapas de una OT recalcula el avance una sola vez.
create or replace function public.fn_ot_recalcular_avance()
returns trigger
language plpgsql
as $$
declare v_orden uuid;
begin
  if tg_op = 'INSERT' then
    for v_orden in select distinct orden_id from nuevas loop
      perform public.ot_recalcular_avance(v_orden);
    end loop;
  elsif tg_op = 'DELETE' then
    for v_orden in select distinct orden_id from antiguas loop
      perform public.ot_recalcular_avance(v_orden);
    end loop;
  else
    for v_orden in
      select orden_id from nuevas union select orden_id from antiguas
    loop
      perform public.ot_recalcular_avance(v_orden);
    end loop;
  end if;
  return null;
end;
$$;

create trigger trg_ot_etapa_antes_update before update on public.ot_etapas
  for each row execute function public.fn_ot_etapa_antes_update();

create trigger trg_ot_etapa_bitacora after update on public.ot_etapas
  for each row execute function public.fn_ot_etapa_bitacora();

create trigger trg_ot_etapa_recalculo_insert after insert on public.ot_etapas
  referencing new table as nuevas
  for each statement execute function public.fn_ot_recalcular_avance();

create trigger trg_ot_etapa_recalculo_update after update on public.ot_etapas
  referencing new table as nuevas old table as antiguas
  for each statement execute function public.fn_ot_recalcular_avance();

create trigger trg_ot_etapa_recalculo_delete after delete on public.ot_etapas
  referencing old table as antiguas
  for each statement execute function public.fn_ot_recalcular_avance();

-- =============================================================================
-- TRIGGERS · PARTE DIARIO
-- =============================================================================

create or replace function public.fn_parte_antes_insert()
returns trigger
language plpgsql
as $$
begin
  if nullif(btrim(new.numero), '') is null then
    new.numero := public.produccion_siguiente_numero('PARTE_DIARIO', new.sede_id);
  end if;

  -- El parte registra lo que ya se trabajó, no lo que se va a trabajar.
  if new.fecha > current_date then
    raise exception 'No se puede registrar un parte diario con fecha futura (%)', new.fecha
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create or replace function public.fn_parte_antes_update()
returns trigger
language plpgsql
as $$
begin
  if new.numero is distinct from old.numero then
    raise exception 'El número del parte % no se puede modificar', old.numero
      using errcode = 'check_violation';
  end if;

  if old.estado <> 'BORRADOR'
     and (new.fecha is distinct from old.fecha or new.sede_id is distinct from old.sede_id) then
    raise exception 'El parte % ya no está en borrador: no se puede cambiar su fecha ni su sede', old.numero
      using errcode = 'check_violation';
  end if;

  if new.estado is distinct from old.estado then
    -- BORRADOR → CERRADO → APROBADO, con reapertura hacia atrás paso a paso.
    if not ((old.estado = 'BORRADOR' and new.estado = 'CERRADO')
         or (old.estado = 'CERRADO'  and new.estado in ('APROBADO', 'BORRADOR'))
         or (old.estado = 'APROBADO' and new.estado = 'CERRADO')) then
      raise exception 'Transición no permitida en el parte %: % → %', old.numero, old.estado, new.estado
        using errcode = 'check_violation';
    end if;

    if new.estado = 'CERRADO' and old.estado = 'BORRADOR'
       and not exists (select 1 from public.parte_detalle d where d.parte_id = new.id) then
      raise exception 'El parte % no tiene horas registradas', old.numero
        using errcode = 'check_violation';
    end if;

    if new.estado = 'CERRADO' and new.fecha_cierre is null then
      new.fecha_cierre := now();
    end if;

    if new.estado = 'APROBADO' then
      new.fecha_aprobacion := coalesce(new.fecha_aprobacion, now());
      new.aprobado_por     := coalesce(new.aprobado_por, public.usuario_actual());
    elsif old.estado = 'APROBADO' then
      -- Se desaprueba: se borra el sello para no dejar una firma falsa.
      new.fecha_aprobacion := null;
      new.aprobado_por     := null;
    end if;
  end if;

  return new;
end;
$$;

-- Carga (o revierte) las horas del parte sobre las etapas de las OT. Es el único
-- camino por el que crecen ot_etapas.horas_reales: las horas solo valen cuando
-- el supervisor aprueba el parte.
create or replace function public.fn_parte_aplicar_horas()
returns trigger
language plpgsql
as $$
declare
  v_signo integer;
begin
  if new.estado is not distinct from old.estado then
    return null;
  end if;

  if new.estado = 'APROBADO' then
    v_signo := 1;
  elsif old.estado = 'APROBADO' then
    v_signo := -1;
  else
    return null;
  end if;

  update public.ot_etapas e
     set horas_reales = greatest(e.horas_reales + (v_signo * d.horas), 0)
    from (select d.etapa_id, sum(d.horas_totales) as horas
            from public.parte_detalle d
           where d.parte_id = new.id
           group by d.etapa_id) d
   where e.id = d.etapa_id;

  perform public.ot_registrar_evento(
    d.orden_id,
    'AVANCE',
    format('Parte diario %s del %s: %s horas %s',
           new.numero, new.fecha, d.horas,
           case when v_signo = 1 then 'imputadas' else 'revertidas' end),
    jsonb_build_object('parte', new.numero, 'fecha', new.fecha,
                       'horas', d.horas, 'signo', v_signo))
  from (select d.orden_id, sum(d.horas_totales) as horas
          from public.parte_detalle d
         where d.parte_id = new.id
         group by d.orden_id) d;

  return null;
end;
$$;

-- El detalle solo se toca mientras el parte está en borrador; después el parte
-- es un documento firmado.
create or replace function public.fn_parte_detalle_guardia()
returns trigger
language plpgsql
as $$
declare
  v_fila     record;
  v_estado   public.estado_parte_diario;
  v_numero   text;
  v_estado_ot public.estado_ot;
  v_ot       text;
begin
  v_fila := case when tg_op = 'DELETE' then old else new end;

  select p.estado, p.numero into v_estado, v_numero
    from public.partes_diarios p where p.id = v_fila.parte_id;

  if v_estado <> 'BORRADOR' then
    raise exception 'El parte % está % y su detalle ya no se puede modificar', v_numero, v_estado
      using errcode = 'check_violation';
  end if;

  if tg_op <> 'DELETE' then
    select o.estado, o.numero into v_estado_ot, v_ot
      from public.ordenes_trabajo o where o.id = new.orden_id;

    if v_estado_ot in ('BORRADOR', 'ANULADA') then
      raise exception 'No se pueden imputar horas a la OT % porque está %', v_ot, v_estado_ot
        using errcode = 'check_violation';
    end if;
  end if;

  return v_fila;
end;
$$;

create or replace function public.parte_recalcular_totales(p_parte_id uuid)
returns void
language plpgsql
volatile
as $$
declare
  v_horas       public.cantidad;
  v_horas_extra public.cantidad;
begin
  select coalesce(sum(horas), 0), coalesce(sum(horas_extra), 0)
    into v_horas, v_horas_extra
    from public.parte_detalle where parte_id = p_parte_id;

  update public.partes_diarios p
     set total_horas = v_horas, total_horas_extra = v_horas_extra
   where p.id = p_parte_id
     and (p.total_horas is distinct from v_horas
       or p.total_horas_extra is distinct from v_horas_extra);
end;
$$;

create or replace function public.fn_parte_detalle_totales()
returns trigger
language plpgsql
as $$
declare v_parte uuid;
begin
  if tg_op = 'INSERT' then
    for v_parte in select distinct parte_id from nuevas loop
      perform public.parte_recalcular_totales(v_parte);
    end loop;
  elsif tg_op = 'DELETE' then
    for v_parte in select distinct parte_id from antiguas loop
      perform public.parte_recalcular_totales(v_parte);
    end loop;
  else
    for v_parte in select parte_id from nuevas union select parte_id from antiguas loop
      perform public.parte_recalcular_totales(v_parte);
    end loop;
  end if;
  return null;
end;
$$;

create trigger trg_parte_antes_insert before insert on public.partes_diarios
  for each row execute function public.fn_parte_antes_insert();
create trigger trg_parte_antes_update before update on public.partes_diarios
  for each row execute function public.fn_parte_antes_update();
create trigger trg_parte_aplicar_horas after update on public.partes_diarios
  for each row execute function public.fn_parte_aplicar_horas();

create trigger trg_parte_detalle_guardia before insert or update or delete on public.parte_detalle
  for each row execute function public.fn_parte_detalle_guardia();

create trigger trg_parte_detalle_totales_insert after insert on public.parte_detalle
  referencing new table as nuevas
  for each statement execute function public.fn_parte_detalle_totales();
create trigger trg_parte_detalle_totales_update after update on public.parte_detalle
  referencing new table as nuevas old table as antiguas
  for each statement execute function public.fn_parte_detalle_totales();
create trigger trg_parte_detalle_totales_delete after delete on public.parte_detalle
  referencing old table as antiguas
  for each statement execute function public.fn_parte_detalle_totales();

-- =============================================================================
-- TRIGGERS · INSPECCIONES
-- =============================================================================

create or replace function public.fn_inspeccion_antes_insert()
returns trigger
language plpgsql
as $$
declare v_sede uuid;
begin
  if nullif(btrim(new.numero), '') is null then
    select o.sede_id into v_sede from public.ordenes_trabajo o where o.id = new.orden_id;
    new.numero := public.produccion_siguiente_numero('INSPECCION_CALIDAD', v_sede);
  end if;
  return new;
end;
$$;

create or replace function public.fn_inspeccion_despues_insert()
returns trigger
language plpgsql
as $$
declare v_etapa text;
begin
  select ec.nombre into v_etapa
    from public.ot_etapas e
    join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
   where e.id = new.etapa_id;

  perform public.ot_registrar_evento(
    new.orden_id, 'INSPECCION',
    format('Inspección %s de %s: %s', new.numero, coalesce(v_etapa, 'la carrocería'), new.resultado),
    jsonb_build_object('numero', new.numero, 'resultado', new.resultado,
                       'etapa', v_etapa, 'observaciones', new.observaciones),
    new.etapa_id, new.inspector_id);

  return null;
end;
$$;

create trigger trg_inspeccion_antes_insert before insert on public.ot_inspecciones
  for each row execute function public.fn_inspeccion_antes_insert();
create trigger trg_inspeccion_despues_insert after insert on public.ot_inspecciones
  for each row execute function public.fn_inspeccion_despues_insert();

-- =============================================================================
-- TRIGGERS · ENTREGA
-- =============================================================================

create or replace function public.fn_entrega_antes_insert()
returns trigger
language plpgsql
as $$
declare
  v_estado public.estado_ot;
  v_sede   uuid;
  v_numero text;
begin
  select o.estado, o.sede_id, o.numero into v_estado, v_sede, v_numero
    from public.ordenes_trabajo o where o.id = new.orden_id;

  -- No se entrega lo que el taller todavía no ha terminado.
  if v_estado not in ('TERMINADA', 'ENTREGADA') then
    raise exception 'La OT % está en estado % y todavía no se puede entregar', v_numero, v_estado
      using errcode = 'check_violation',
            hint = 'La OT debe estar TERMINADA para levantar el acta de conformidad.';
  end if;

  if nullif(btrim(new.numero), '') is null then
    new.numero := public.produccion_siguiente_numero('ACTA_CONFORMIDAD', v_sede);
  end if;

  return new;
end;
$$;

create or replace function public.fn_entrega_despues_insert()
returns trigger
language plpgsql
as $$
begin
  -- El acta es el hecho que mueve la OT a ENTREGADA.
  update public.ordenes_trabajo
     set estado = 'ENTREGADA'
   where id = new.orden_id and estado = 'TERMINADA';

  perform public.ot_registrar_evento(
    new.orden_id, 'ENTREGA',
    format('Acta %s: recibió %s%s', new.numero, new.recibe_nombre,
           case when new.garantia_meses > 0
                then format(' · garantía %s meses hasta %s', new.garantia_meses, new.garantia_vence)
                else '' end),
    jsonb_build_object('acta', new.numero, 'fecha_entrega', new.fecha_entrega,
                       'recibe', new.recibe_nombre, 'documento', new.recibe_documento,
                       'conforme', new.conforme, 'garantia_meses', new.garantia_meses,
                       'garantia_vence', new.garantia_vence),
    null, new.creado_por);

  return null;
end;
$$;

create trigger trg_entrega_antes_insert before insert on public.ot_entregas
  for each row execute function public.fn_entrega_antes_insert();
create trigger trg_entrega_despues_insert after insert on public.ot_entregas
  for each row execute function public.fn_entrega_despues_insert();

-- =============================================================================
-- TRIGGERS · BITÁCORA INMUTABLE
-- =============================================================================

-- La bitácora no se edita nunca. Los eventos solo desaparecen si se elimina la
-- OT completa: en ese caso el borrado llega en cascada y la OT ya no existe,
-- que es como distinguimos la cascada de un intento manual de borrar la traza.
create or replace function public.fn_bitacora_inmutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'La bitácora de la OT es un registro histórico y no se puede modificar'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.ordenes_trabajo o where o.id = old.orden_id) then
    raise exception 'No se pueden borrar eventos de la bitácora de una OT vigente'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

create trigger trg_bitacora_inmutable before update or delete on public.ot_bitacora
  for each row execute function public.fn_bitacora_inmutable();

-- =============================================================================
-- VISTAS DE CONSULTA
-- =============================================================================

-- Cabecera de la OT con lo que el jefe de taller y la gerencia miran a diario.
create view public.ot_resumen as
select
  o.id,
  o.numero,
  o.estado,
  o.prioridad,
  o.tipo_trabajo,
  o.sede_id,
  s.nombre                    as sede,
  o.cliente_id,
  c.razon_social              as cliente,
  c.numero_documento          as cliente_documento,
  o.unidad_id,
  u.placa,
  tc.nombre                   as tipo_carroceria,
  o.descripcion,
  o.fecha_registro,
  o.fecha_inicio_programada,
  o.fecha_fin_programada,
  o.fecha_entrega_comprometida,
  o.fecha_inicio_real,
  o.fecha_fin_real,
  o.avance_porcentaje,
  o.horas_estimadas,
  o.horas_reales,
  (o.horas_reales - o.horas_estimadas)                        as desviacion_horas,
  o.moneda,
  o.monto_presupuestado,
  o.responsable_id,
  (r.nombres || ' ' || r.apellidos)                           as responsable,
  count(e.id)                                                 as etapas_total,
  count(e.id) filter (where e.estado = 'TERMINADA')           as etapas_terminadas,
  count(e.id) filter (where e.estado = 'EN_PROCESO')          as etapas_en_proceso,
  -- Días de atraso frente a lo prometido al cliente; 0 si aún hay plazo o si la
  -- OT ya salió del taller.
  case
    when o.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA') then 0
    when o.fecha_entrega_comprometida is null then 0
    else greatest(current_date - o.fecha_entrega_comprometida, 0)
  end                                                         as dias_atraso
from public.ordenes_trabajo o
join public.clientes c        on c.id  = o.cliente_id
join public.sedes s           on s.id  = o.sede_id
left join public.unidades u   on u.id  = o.unidad_id
left join public.tipos_carroceria tc on tc.id = o.tipo_carroceria_id
left join public.usuarios r   on r.id  = o.responsable_id
left join public.ot_etapas e  on e.orden_id = o.id
group by o.id, c.id, s.id, u.id, tc.id, r.id;

comment on view public.ot_resumen is
  'Una fila por OT con cliente, unidad, avance, horas y atraso. Es la fuente del tablero de órdenes.';

-- Tablero de etapas del taller: qué se está haciendo ahora mismo y con quién.
create view public.ot_tablero_etapas as
select
  e.id                        as etapa_id,
  e.orden_id,
  o.numero                    as ot_numero,
  o.estado                    as ot_estado,
  o.prioridad,
  o.sede_id,
  c.razon_social              as cliente,
  u.placa,
  ec.codigo                   as etapa_codigo,
  ec.nombre                   as etapa,
  ec.permite_paralelo,
  e.orden_secuencia,
  e.estado,
  e.avance_porcentaje,
  e.horas_estimadas,
  e.horas_reales,
  (e.horas_reales - e.horas_estimadas) as desviacion_horas,
  e.fecha_inicio_programada,
  e.fecha_fin_programada,
  e.fecha_inicio_real,
  e.fecha_fin_real,
  e.responsable_id,
  e.requiere_inspeccion,
  exists (select 1 from public.ot_inspecciones i
           where i.etapa_id = e.id and i.resultado = 'CONFORME')   as inspeccion_conforme,
  (select count(*) from public.ot_personal p
    where p.etapa_id = e.id and p.fecha_desasignacion is null)     as operarios_asignados
from public.ot_etapas e
join public.ordenes_trabajo o on o.id = e.orden_id
join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
join public.clientes c        on c.id = o.cliente_id
left join public.unidades u   on u.id = o.unidad_id
where o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA');

comment on view public.ot_tablero_etapas is
  'Etapas de las OT que siguen en taller, con avance, horas, cuadrilla asignada y si la inspección de calidad ya está conforme.';

-- Horas de mano de obra directa efectivamente validadas. El módulo de costos
-- valoriza desde aquí: solo entran partes APROBADOS.
create view public.ot_horas_aprobadas as
select
  d.id                as detalle_id,
  d.orden_id,
  d.etapa_id,
  d.usuario_id,
  p.id                as parte_id,
  p.numero            as parte_numero,
  p.fecha,
  p.sede_id,
  d.horas,
  d.horas_extra,
  d.horas_totales,
  us.costo_hora,
  d.descripcion
from public.parte_detalle d
join public.partes_diarios p on p.id = d.parte_id
join public.usuarios us      on us.id = d.usuario_id
where p.estado = 'APROBADO';

comment on view public.ot_horas_aprobadas is
  'Horas-hombre imputadas a cada OT y etapa desde partes diarios aprobados, con el costo hora vigente del operario. Base del costeo real de mano de obra.';

-- =============================================================================
-- TIMESTAMPS Y AUDITORÍA
-- =============================================================================

do $$
declare t text;
begin
  -- ot_bitacora queda fuera: es un log inmutable, sin actualizado_en.
  foreach t in array array[
    'etapas_catalogo', 'ordenes_trabajo', 'ot_etapas', 'ot_tareas', 'ot_personal',
    'partes_diarios', 'parte_detalle', 'ot_inspecciones', 'ot_inspeccion_items',
    'ot_entregas'
  ] loop
    perform public.activar_timestamps(t);
  end loop;

  -- Todo lo que la empresa debe poder rastrear ante un reclamo o una auditoría
  -- de costos. El catálogo de etapas entra porque cambiar sus horas estándar
  -- altera la programación y el costeo de todas las OT siguientes.
  foreach t in array array[
    'etapas_catalogo', 'ordenes_trabajo', 'ot_etapas', 'ot_tareas', 'ot_personal',
    'partes_diarios', 'parte_detalle', 'ot_inspecciones', 'ot_inspeccion_items',
    'ot_entregas'
  ] loop
    perform public.activar_auditoria(t);
  end loop;
end;
$$;
