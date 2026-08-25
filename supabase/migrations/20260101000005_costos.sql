-- =============================================================================
-- 0005 · COSTOS
-- Metal-Work · Gestión de órdenes de trabajo para fabricación de carrocerías
-- -----------------------------------------------------------------------------
-- Este módulo responde, en cualquier momento y para cualquier orden de trabajo,
-- las tres preguntas del negocio:
--     ¿cuánto llevo gastado?  ¿contra qué presupuesté?  ¿cuánto estoy ganando?
--
-- El costo real de una carrocería tiene cinco orígenes y ninguno se digita a
-- mano en este módulo salvo el último:
--     MATERIAL   ← kardex (0004): salidas a la OT menos devoluciones
--     MANO_OBRA  ← partes diarios aprobados (0003) valorizados con tarifa
--     SERVICIO   ← servicios_terceros (aquí): arenado, torno, corte láser...
--     INDIRECTO  ← prorrateo_indirectos (aquí): gasto de planta repartido
--     OTRO       ← ot_costos_adicionales (aquí): fletes, viáticos, compras directas
--
-- Todos los importes de este módulo se guardan además en MONEDA BASE
-- (empresa.moneda_base, PEN) en la columna monto_base, para que las vistas
-- puedan sumar sin volver a convertir.
-- =============================================================================

-- Necesaria para la restricción de exclusión que impide tarifas solapadas:
-- permite combinar el operador = sobre la especialidad con && sobre el rango
-- de vigencia dentro de un mismo índice GiST.
create extension if not exists "btree_gist";

-- -----------------------------------------------------------------------------
-- Enums del dominio de costos
-- -----------------------------------------------------------------------------

-- Naturaleza del costo. Es la columna vertebral del módulo: presupuesto, costo
-- real y desviación se comparan siempre dentro del mismo tipo.
-- Amplía a public.tipo_costo_partida (0002) con INDIRECTO, que la cotización no
-- conoce porque el gasto de planta no se cotiza al cliente por separado.
create type public.tipo_costo as enum (
  'MATERIAL',
  'MANO_OBRA',
  'SERVICIO',
  'INDIRECTO',
  'OTRO'
);

create type public.tipo_centro_costo as enum (
  'PRODUCCION',      -- taller: su gasto se reparte entre las OT
  'ADMINISTRATIVO',  -- gasto del periodo, no entra al costo de la carrocería
  'VENTAS'           -- gasto del periodo, no entra al costo de la carrocería
);

-- Trabajos que el taller no hace en casa y compra a un tercero.
create type public.tipo_servicio_tercero as enum (
  'ARENADO',
  'CORTE_LASER',
  'CORTE_PLASMA',
  'DOBLADO',
  'TORNO',
  'GALVANIZADO',
  'TRATAMIENTO_TERMICO',
  'TAPICERIA',
  'PINTURA',
  'ELECTRICIDAD',
  'HIDRAULICA',
  'TRANSPORTE',
  'CERTIFICACION',
  'OTRO'
);

-- SOLICITADO es compromiso, todavía no costo. EJECUTADO ya es costo real
-- aunque el proveedor no haya cobrado. ANULADO no cuenta para nada.
create type public.estado_servicio_tercero as enum (
  'SOLICITADO',
  'EJECUTADO',
  'PAGADO',
  'ANULADO'
);

create type public.categoria_gasto_indirecto as enum (
  'ENERGIA',
  'AGUA',
  'ALQUILER',
  'DEPRECIACION',
  'SUELDOS_INDIRECTOS',
  'MANTENIMIENTO_PLANTA',
  'SEGUROS',
  'EPP',
  'COMUNICACIONES',
  'LIMPIEZA',
  'OTRO'
);

-- De dónde salió una línea de presupuesto: arrastrada de la cotización
-- aprobada o cargada a mano por el área de costos.
create type public.origen_presupuesto as enum ('COTIZACION', 'MANUAL');

-- =============================================================================
-- CENTROS DE COSTO
-- =============================================================================

create table public.centros_costo (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre         text not null,
  tipo           public.tipo_centro_costo not null default 'PRODUCCION',
  descripcion    text,
  responsable_id uuid references public.usuarios(id) on delete set null,
  -- Nulo = centro transversal a toda la empresa.
  sede_id        uuid references public.sedes(id) on delete set null,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.centros_costo is
  'Centros de costo de la empresa. Solo el gasto de los centros de tipo PRODUCCION se reparte entre las órdenes de trabajo; el administrativo y el de ventas son gasto del periodo.';
comment on column public.centros_costo.tipo is
  'PRODUCCION (taller, se prorratea a las OT), ADMINISTRATIVO y VENTAS (gasto del periodo).';

create index idx_centros_costo_responsable on public.centros_costo(responsable_id);
create index idx_centros_costo_sede on public.centros_costo(sede_id);
create index idx_centros_costo_tipo on public.centros_costo(tipo) where activo;

-- =============================================================================
-- TARIFAS DE MANO DE OBRA
-- =============================================================================

create table public.tarifas_mano_obra (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,
  -- Se reutiliza el enum de oficios de producción (0003) a propósito: la tarifa
  -- se resuelve por el mismo oficio con el que el operario está asignado a la OT.
  especialidad     public.rol_operario not null,
  nombre           text not null,
  costo_hora       public.monto not null check (costo_hora >= 0),
  costo_hora_extra public.monto not null check (costo_hora_extra >= 0),
  -- Vigencia cerrada por la derecha con NULL = sigue vigente hoy.
  vigencia_desde   date not null default current_date,
  vigencia_hasta   date,
  centro_costo_id  uuid references public.centros_costo(id) on delete set null,
  observaciones    text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  constraint ck_tarifa_vigencia check (
    vigencia_hasta is null or vigencia_hasta >= vigencia_desde),

  -- La hora extra jamás cuesta menos que la normal: la ley peruana obliga a un
  -- recargo mínimo de 25 % sobre las dos primeras horas y de 35 % en adelante.
  constraint ck_tarifa_extra check (costo_hora_extra >= costo_hora),

  -- Dos tarifas de la misma especialidad no pueden traslaparse en el tiempo:
  -- si lo hicieran, "la tarifa vigente" dejaría de estar definida y el costeo
  -- de mano de obra sería ambiguo. Para cambiar un precio se cierra la tarifa
  -- anterior con vigencia_hasta y se crea la nueva.
  constraint ex_tarifa_sin_solape exclude using gist (
    especialidad with =,
    daterange(vigencia_desde, coalesce(vigencia_hasta, 'infinity'::date), '[]') with &&
  )
);

comment on table public.tarifas_mano_obra is
  'Costo por hora de cada especialidad de taller, con vigencia. Es el precio de referencia con el que se valorizan las horas de los partes diarios cuando el operario no tiene un costo_hora propio.';
comment on column public.tarifas_mano_obra.costo_hora is
  'Costo empresa por hora normal en moneda base: incluye sueldo, cargas sociales y beneficios, no es el sueldo neto del operario.';
comment on column public.tarifas_mano_obra.vigencia_hasta is
  'Nulo mientras la tarifa siga vigente. Se llena al crear la tarifa que la reemplaza.';

create index idx_tarifas_especialidad on public.tarifas_mano_obra(especialidad, vigencia_desde desc);
create index idx_tarifas_centro_costo on public.tarifas_mano_obra(centro_costo_id);

-- Devuelve la fila de tarifa vigente para una especialidad en una fecha dada.
-- La restricción de exclusión garantiza que hay como mucho una; el order by
-- solo fija un resultado determinista si alguna vez se relajara esa regla.
create or replace function public.tarifa_vigente(
  p_especialidad public.rol_operario,
  p_fecha        date default current_date
)
returns public.tarifas_mano_obra
language sql
stable
as $$
  select t.*
    from public.tarifas_mano_obra t
   where t.especialidad = p_especialidad
     and t.vigencia_desde <= p_fecha
     and (t.vigencia_hasta is null or t.vigencia_hasta >= p_fecha)
   order by t.vigencia_desde desc
   limit 1;
$$;

comment on function public.tarifa_vigente is
  'Tarifa de mano de obra aplicable a una especialidad en una fecha. Devuelve la fila completa para que quien la llame use costo_hora o costo_hora_extra según corresponda; devuelve null si no hay tarifa configurada.';

-- =============================================================================
-- PRESUPUESTO DE LA ORDEN DE TRABAJO
-- =============================================================================

create table public.ot_presupuesto (
  id                    uuid primary key default gen_random_uuid(),
  orden_id              uuid not null references public.ordenes_trabajo(id) on delete cascade,
  tipo_costo            public.tipo_costo not null,
  descripcion           text not null,
  detalle               text,
  unidad_medida         text not null default 'UND',
  cantidad              public.cantidad not null default 1 check (cantidad > 0),
  -- Costo unitario y monto se mantienen coherentes por trigger: se digita uno
  -- de los dos y la base de datos deduce el otro.
  costo_unitario        public.monto not null default 0 check (costo_unitario >= 0),
  monto_presupuestado   public.monto not null default 0 check (monto_presupuestado >= 0),

  origen                public.origen_presupuesto not null default 'MANUAL',
  -- Partida de la cotización de la que proviene esta línea. Es lo que permite
  -- explicarle al cliente por qué se presupuestó lo que se presupuestó.
  cotizacion_partida_id uuid references public.cotizacion_partidas(id) on delete set null,

  -- Referencias opcionales que afinan el seguimiento sin ser obligatorias.
  material_id           uuid references public.materiales(id) on delete set null,
  especialidad          public.rol_operario,
  horas_presupuestadas  public.cantidad not null default 0 check (horas_presupuestadas >= 0),
  centro_costo_id       uuid references public.centros_costo(id) on delete set null,
  observaciones         text,
  creado_por            uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  -- Una partida de cotización se arrastra una sola vez a la misma OT. Las
  -- líneas manuales llevan cotizacion_partida_id nulo y no chocan entre sí
  -- porque UNIQUE trata los nulos como distintos.
  constraint uq_ot_presupuesto_partida unique (orden_id, cotizacion_partida_id),
  constraint ck_ot_presupuesto_origen check (
    origen <> 'COTIZACION' or cotizacion_partida_id is not null),
  -- Las horas presupuestadas solo tienen sentido en las líneas de mano de obra.
  constraint ck_ot_presupuesto_horas check (
    tipo_costo = 'MANO_OBRA' or horas_presupuestadas = 0)
);

comment on table public.ot_presupuesto is
  'Presupuesto de costo de la orden de trabajo, desglosado por naturaleza del costo. Es el "contra qué" de todo el módulo: la desviación se mide siempre contra la suma de estas líneas.';
comment on column public.ot_presupuesto.monto_presupuestado is
  'Costo esperado en moneda base, no precio de venta. Cuando se arrastra desde la cotización se aplica el factor de costo indicado en generar_presupuesto_desde_cotizacion.';
comment on column public.ot_presupuesto.origen is
  'COTIZACION = línea arrastrada de la cotización aprobada; MANUAL = cargada por el área de costos.';

create index idx_ot_presupuesto_orden on public.ot_presupuesto(orden_id, tipo_costo);
create index idx_ot_presupuesto_partida on public.ot_presupuesto(cotizacion_partida_id);
create index idx_ot_presupuesto_material on public.ot_presupuesto(material_id);
create index idx_ot_presupuesto_centro on public.ot_presupuesto(centro_costo_id);
create index idx_ot_presupuesto_creado_por on public.ot_presupuesto(creado_por);

-- =============================================================================
-- SERVICIOS DE TERCEROS
-- =============================================================================

create table public.servicios_terceros (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references public.ordenes_trabajo(id) on delete restrict,
  -- Etapa a la que se imputa el servicio, opcional. La FK compuesta impide
  -- apuntar a la etapa de otra OT.
  etapa_id        uuid,
  proveedor_id    uuid not null references public.proveedores(id) on delete restrict,
  tipo_servicio   public.tipo_servicio_tercero not null default 'OTRO',
  descripcion     text not null,
  especificacion  text,
  fecha           date not null default current_date,
  fecha_entrega   date,
  moneda          public.moneda not null default 'PEN',
  monto           public.monto not null check (monto > 0),
  tipo_cambio     numeric(10, 4) not null check (tipo_cambio > 0),
  -- Importe en moneda base. Se calcula solo: es lo que suman las vistas de
  -- costo, que no pueden andar convirtiendo dólares fila por fila.
  monto_base      public.monto generated always as (round(monto * tipo_cambio, 2)) stored,
  numero_factura  text,
  fecha_factura   date,
  estado          public.estado_servicio_tercero not null default 'SOLICITADO',
  centro_costo_id uuid references public.centros_costo(id) on delete set null,
  responsable_id  uuid references public.usuarios(id) on delete set null,
  observaciones   text,
  creado_por      uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint fk_servicio_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete restrict,
  -- En soles el tipo de cambio es 1 por definición; cualquier otro valor
  -- deformaría monto_base sin que nadie lo note.
  constraint ck_servicio_tc_pen check (moneda <> 'PEN' or tipo_cambio = 1),
  constraint ck_servicio_fechas check (fecha_entrega is null or fecha_entrega >= fecha),
  -- No se paga un servicio sin comprobante: es el sustento del gasto ante SUNAT.
  constraint ck_servicio_factura check (
    estado <> 'PAGADO' or nullif(btrim(coalesce(numero_factura, '')), '') is not null)
);

comment on table public.servicios_terceros is
  'Trabajos tercerizados que se cargan a una OT: arenado, corte láser, torno, tapicería, transporte. Mientras están SOLICITADO son compromiso; desde EJECUTADO son costo real de la carrocería.';
comment on column public.servicios_terceros.monto is
  'Importe del servicio SIN IGV y en la moneda del comprobante. El IGV no es costo de la OT: es crédito fiscal de la empresa.';
comment on column public.servicios_terceros.tipo_cambio is
  'Tipo de cambio congelado al registrar. Si no se indica lo completa el trigger con el tipo de cambio venta vigente a la fecha del servicio.';

create index idx_servicios_orden on public.servicios_terceros(orden_id, estado);
create index idx_servicios_etapa on public.servicios_terceros(etapa_id, orden_id);
create index idx_servicios_proveedor on public.servicios_terceros(proveedor_id);
create index idx_servicios_centro on public.servicios_terceros(centro_costo_id);
create index idx_servicios_responsable on public.servicios_terceros(responsable_id);
create index idx_servicios_creado_por on public.servicios_terceros(creado_por);
create index idx_servicios_fecha on public.servicios_terceros(fecha desc);
-- Servicios encargados que todavía no vuelven del proveedor: es la lista que
-- el jefe de taller persigue todos los días.
create index idx_servicios_pendientes on public.servicios_terceros(orden_id)
  where estado = 'SOLICITADO';

-- =============================================================================
-- GASTOS INDIRECTOS DE PLANTA
-- =============================================================================

create table public.gastos_indirectos (
  id               uuid primary key default gen_random_uuid(),
  -- Siempre el primer día del mes: el prorrateo trabaja por periodo mensual.
  periodo          date not null,
  categoria        public.categoria_gasto_indirecto not null default 'OTRO',
  descripcion      text not null,
  centro_costo_id  uuid not null references public.centros_costo(id) on delete restrict,
  sede_id          uuid references public.sedes(id) on delete restrict,
  moneda           public.moneda not null default 'PEN',
  monto            public.monto not null check (monto > 0),
  tipo_cambio      numeric(10, 4) not null check (tipo_cambio > 0),
  monto_base       public.monto generated always as (round(monto * tipo_cambio, 2)) stored,
  numero_documento text,
  fecha_documento  date,
  -- Solo lo que se marca aquí entra al reparto entre las OT. Se valida por
  -- trigger que el centro de costo sea de PRODUCCION: el gasto de ventas o de
  -- administración es gasto del periodo y no encarece la carrocería.
  prorratear       boolean not null default true,
  observaciones    text,
  creado_por       uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  constraint ck_gasto_periodo_mes check (periodo = date_trunc('month', periodo::timestamp)::date),
  constraint ck_gasto_tc_pen check (moneda <> 'PEN' or tipo_cambio = 1)
);

comment on table public.gastos_indirectos is
  'Gastos de planta del mes que no se pueden imputar directamente a una OT: energía, alquiler, depreciación de equipos, sueldos indirectos. prorratear_indirectos() los reparte entre las órdenes.';
comment on column public.gastos_indirectos.periodo is
  'Primer día del mes al que pertenece el gasto. Es la llave del prorrateo.';

create index idx_gastos_periodo on public.gastos_indirectos(periodo desc);
create index idx_gastos_centro on public.gastos_indirectos(centro_costo_id);
create index idx_gastos_sede on public.gastos_indirectos(sede_id);
create index idx_gastos_creado_por on public.gastos_indirectos(creado_por);
-- Índice que sirve exactamente a la suma que hace el prorrateo.
create index idx_gastos_prorrateables on public.gastos_indirectos(periodo) where prorratear;

-- =============================================================================
-- PRORRATEO DE INDIRECTOS
-- =============================================================================

create table public.prorrateo_indirectos (
  id                    uuid primary key default gen_random_uuid(),
  periodo               date not null,
  orden_id              uuid not null references public.ordenes_trabajo(id) on delete cascade,
  -- Horas-hombre aprobadas que la OT consumió en el mes (normales + extras).
  horas_hombre          public.cantidad not null check (horas_hombre > 0),
  -- Denominador y numerador del reparto, guardados para poder auditar el
  -- cálculo meses después sin tener que rehacerlo.
  horas_totales_periodo public.cantidad not null check (horas_totales_periodo > 0),
  gasto_total_periodo   public.monto not null check (gasto_total_periodo >= 0),
  -- Tasa de absorción del mes. No usa el dominio public.monto porque no es un
  -- importe sino un factor de cálculo y con dos decimales se perdería precisión.
  tasa_hora             numeric(14, 6) not null check (tasa_hora >= 0),
  monto_asignado        public.monto not null check (monto_asignado >= 0),
  calculado_en          timestamptz not null default now(),
  calculado_por         uuid references public.usuarios(id) on delete set null,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  -- Una sola asignación por OT y mes: volver a correr el prorrateo reemplaza
  -- la anterior, nunca la duplica.
  constraint uq_prorrateo_periodo_orden unique (periodo, orden_id),
  constraint ck_prorrateo_periodo_mes check (periodo = date_trunc('month', periodo::timestamp)::date),
  constraint ck_prorrateo_horas check (horas_hombre <= horas_totales_periodo)
);

comment on table public.prorrateo_indirectos is
  'Resultado del reparto del gasto indirecto de un mes entre las OT que trabajaron ese mes. Lo escribe prorratear_indirectos(); no se digita a mano.';
comment on column public.prorrateo_indirectos.tasa_hora is
  'Gasto indirecto prorrateable del mes dividido entre las horas-hombre aprobadas de todas las OT activas en ese mes.';

create index idx_prorrateo_orden on public.prorrateo_indirectos(orden_id);
create index idx_prorrateo_periodo on public.prorrateo_indirectos(periodo desc);
create index idx_prorrateo_calculado_por on public.prorrateo_indirectos(calculado_por);

-- =============================================================================
-- OTROS COSTOS IMPUTADOS A LA OT
-- =============================================================================

create table public.ot_costos_adicionales (
  id               uuid primary key default gen_random_uuid(),
  orden_id         uuid not null references public.ordenes_trabajo(id) on delete restrict,
  etapa_id         uuid,
  fecha            date not null default current_date,
  -- Se admite cualquier naturaleza porque hay compras directas de material que
  -- nunca pasan por almacén (la ferretería de la esquina un sábado) y horas de
  -- personal externo que no llegan por parte diario.
  tipo_costo       public.tipo_costo not null default 'OTRO',
  descripcion      text not null,
  moneda           public.moneda not null default 'PEN',
  monto            public.monto not null check (monto > 0),
  tipo_cambio      numeric(10, 4) not null check (tipo_cambio > 0),
  monto_base       public.monto generated always as (round(monto * tipo_cambio, 2)) stored,
  centro_costo_id  uuid references public.centros_costo(id) on delete set null,
  numero_documento text,
  observaciones    text,
  creado_por       uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  constraint fk_costo_adicional_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete restrict,
  constraint ck_costo_adicional_tc_pen check (moneda <> 'PEN' or tipo_cambio = 1)
);

comment on table public.ot_costos_adicionales is
  'Costos cargados a mano a una OT que no vienen del almacén, ni de los partes diarios, ni de un servicio de tercero: fletes, viáticos, compras directas, penalidades, alquiler de equipo.';
comment on column public.ot_costos_adicionales.monto is
  'Importe sin IGV en la moneda del comprobante.';

create index idx_costos_adicionales_orden on public.ot_costos_adicionales(orden_id, tipo_costo);
create index idx_costos_adicionales_etapa on public.ot_costos_adicionales(etapa_id, orden_id);
create index idx_costos_adicionales_centro on public.ot_costos_adicionales(centro_costo_id);
create index idx_costos_adicionales_creado_por on public.ot_costos_adicionales(creado_por);
create index idx_costos_adicionales_fecha on public.ot_costos_adicionales(fecha desc);
