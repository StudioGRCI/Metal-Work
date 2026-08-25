-- =============================================================================
-- 0004 · ALMACÉN Y COMPRAS
-- Metal-Work · Fabricación y reparación de carrocerías para vehículos pesados
-- -----------------------------------------------------------------------------
-- Este módulo responde tres preguntas del negocio:
--   1. ¿Qué tengo, dónde está y cuánto vale?      (materiales, almacen_stock, kardex)
--   2. ¿Cuánto material se fue a cada carrocería? (movimientos con orden_id → costos)
--   3. ¿De qué colada salió el acero de esa tolva? (lotes_material → trazabilidad)
--
-- Contenido:
--   · unidades_medida / categorias_material / materiales   catálogo maestro
--   · almacenes / almacen_stock / lotes_material           existencias y trazabilidad
--   · kardex                                               libro valorizado INMUTABLE
--   · movimientos_almacen / movimiento_detalle             documentos que mueven stock
--   · requerimientos / requerimiento_detalle               lo que el taller pide por OT
--   · proveedores / proveedor_materiales                   quién nos vende
--   · ordenes_compra / orden_compra_detalle                la compra
--   · recepciones / recepcion_detalle                      la llegada de la compra
--
-- Reglas de negocio que se hacen cumplir AQUÍ y no en la aplicación:
--   1. El kardex es inmutable: no admite UPDATE ni DELETE. Un error se corrige
--      con un movimiento de ajuste, nunca reescribiendo la historia.
--   2. El stock solo cambia por public.confirmar_movimiento_almacen(). Ningún
--      UPDATE manual puede pasar un movimiento a CONFIRMADO.
--   3. No se puede sacar más de lo que hay: la salida falla con mensaje claro.
--   4. La valorización es PROMEDIO PONDERADO MÓVIL por material y almacén; las
--      salidas se costean al promedio vigente, nunca al precio que ponga el usuario.
--   5. Aprobar un requerimiento reserva el stock disponible; atenderlo lo libera.
--   6. Un material marcado controla_lote no ingresa sin lote/colada identificada.
--
-- NOTA PARA LA MIGRACIÓN DE SEMILLA (0008): este archivo agrega dos valores al
-- enum public.tipo_correlativo. La semilla debe crear sus series o la numeración
-- de transferencias y recepciones fallará al primer uso:
--   ('TRANSFERENCIA_ALMACEN', '001', 'TRA', 5) y ('RECEPCION_COMPRA', '001', 'REC', 5).
-- =============================================================================

-- Sentencias sueltas y al inicio del archivo: ALTER TYPE ... ADD VALUE no puede
-- convivir con el uso del valor nuevo dentro de la misma transacción. Aquí solo
-- se declaran; se usan en cuerpos plpgsql que se evalúan en tiempo de ejecución.
alter type public.tipo_correlativo add value 'TRANSFERENCIA_ALMACEN';

alter type public.tipo_correlativo add value 'RECEPCION_COMPRA';

-- -----------------------------------------------------------------------------
-- Enums del dominio de almacén y compras
-- -----------------------------------------------------------------------------

-- Magnitud física de la unidad de medida. Solo se pueden convertir entre sí
-- unidades de la misma magnitud (kg ↔ ton, pero nunca kg ↔ metros).
create type public.magnitud_medida as enum (
  'UNIDAD', 'MASA', 'LONGITUD', 'AREA', 'VOLUMEN'
);

create type public.tipo_almacen as enum (
  'PRINCIPAL',    -- almacén central del taller
  'OBRA',         -- material ya entregado a planta, pendiente de consumo
  'HERRAMIENTAS', -- herramienta y consumible durable que se presta y devuelve
  'MERMA'         -- retazos, recortes y material observado a la espera de destino
);

-- Tipos de movimiento del libro kardex. El prefijo determina el signo:
-- INGRESO_* suma al saldo, SALIDA_* resta.
create type public.tipo_movimiento_kardex as enum (
  'INGRESO_COMPRA',
  'INGRESO_DEVOLUCION',
  'INGRESO_AJUSTE',
  'INGRESO_TRANSFERENCIA',
  'SALIDA_OT',
  'SALIDA_AJUSTE',
  'SALIDA_TRANSFERENCIA',
  'SALIDA_MERMA'
);

-- Tipos de documento de almacén. Uno solo puede generar dos filas de kardex
-- (la transferencia: sale del almacén origen y entra al destino).
create type public.tipo_movimiento_almacen as enum (
  'INGRESO',       -- entrada por compra u otro origen
  'SALIDA_OT',     -- vale de consumo: material que se va a una orden de trabajo
  'DEVOLUCION_OT', -- el taller devuelve al almacén lo que no consumió
  'TRANSFERENCIA', -- traslado entre almacenes
  'AJUSTE',        -- ajuste por inventario físico (cantidad con signo)
  'SALIDA_MERMA'   -- baja por merma, recorte inservible o material vencido
);

create type public.estado_movimiento_almacen as enum ('BORRADOR', 'CONFIRMADO', 'ANULADO');

create type public.estado_requerimiento as enum (
  'SOLICITADO', 'APROBADO', 'ATENDIDO_PARCIAL', 'ATENDIDO', 'RECHAZADO', 'ANULADO'
);

create type public.estado_orden_compra as enum (
  'BORRADOR', 'APROBADA', 'ENVIADA', 'RECIBIDA_PARCIAL', 'RECIBIDA', 'ANULADA'
);

create type public.condicion_pago as enum (
  'CONTADO', 'CREDITO_7', 'CREDITO_15', 'CREDITO_30', 'CREDITO_45', 'CREDITO_60', 'LETRAS'
);

-- =============================================================================
-- CATÁLOGO: UNIDADES DE MEDIDA
-- =============================================================================

create table public.unidades_medida (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,
  nombre          text not null,
  magnitud        public.magnitud_medida not null default 'UNIDAD',
  -- Unidad base de la misma magnitud (KG para MASA, M para LONGITUD...).
  -- Nula en la propia unidad base.
  unidad_base_id  uuid references public.unidades_medida(id) on delete restrict,
  -- cantidad_en_unidad_base = cantidad * factor_conversion.
  -- TON → 1000 (kg), PLN de 1.20x2.40x3mm → su peso en kg, GAL → 3.7854 (litros).
  factor_conversion numeric(14, 6) not null default 1 check (factor_conversion > 0),
  -- Decimales con los que la interfaz muestra y redondea la cantidad.
  decimales       smallint not null default 2 check (decimales between 0 and 4),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  -- La unidad base no se convierte a sí misma con un factor distinto de 1.
  constraint ck_um_base_factor check (unidad_base_id is not null or factor_conversion = 1),
  constraint ck_um_no_autoreferencia check (unidad_base_id is null or unidad_base_id <> id)
);

comment on table public.unidades_medida is
  'Unidades en las que se compra, almacena y consume el material: UND, KG, M, M2, M3, L, GAL, PZA, JGO, PLN (plancha), TON, ROLLO, CAJA.';
comment on column public.unidades_medida.factor_conversion is
  'Cuántas unidades base equivalen a una unidad de esta medida. Permite comprar en planchas o toneladas y consumir en kilos.';
comment on column public.unidades_medida.magnitud is
  'Solo se convierten entre sí unidades de la misma magnitud.';

create index idx_um_base on public.unidades_medida(unidad_base_id);
create index idx_um_activo on public.unidades_medida(activo) where activo;

-- =============================================================================
-- CATÁLOGO: CATEGORÍAS DE MATERIAL (jerárquicas)
-- =============================================================================

create table public.categorias_material (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text not null unique,
  nombre             text not null,
  descripcion        text,
  -- Jerarquía por familia: ACERO → PLANCHAS → PLANCHA ANTIDESGASTE.
  categoria_padre_id uuid references public.categorias_material(id) on delete restrict,
  -- Cuenta del PCGE con la que el contador concilia el inventario (60/25/61).
  cuenta_contable    text,
  orden_visual       int not null default 0,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  constraint ck_categoria_no_autoreferencia check (categoria_padre_id is null or categoria_padre_id <> id)
);

comment on table public.categorias_material is
  'Familias de material en árbol: acero, perfilería, hidráulica, soldadura, pintura, ferretería, eléctricos, gases.';
comment on column public.categorias_material.cuenta_contable is
  'Cuenta del plan contable peruano asociada a la familia. La usa el módulo de costos para el asiento de consumo.';

create index idx_categorias_material_padre on public.categorias_material(categoria_padre_id);
create index idx_categorias_material_activo on public.categorias_material(activo) where activo;

-- =============================================================================
-- CATÁLOGO: MATERIALES
-- =============================================================================

create table public.materiales (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,
  descripcion         text not null,
  categoria_id        uuid not null references public.categorias_material(id) on delete restrict,
  unidad_medida_id    uuid not null references public.unidades_medida(id) on delete restrict,
  -- Ficha técnica del material tal como la pide el taller:
  -- "Plancha LAC ASTM A36 1220x2440x6mm", "Tubo cuadrado 2x2 e=2mm".
  especificacion_tecnica text,
  -- Atributos que el taller usa para buscar y para calcular pesos de habilitado.
  espesor_mm          numeric(8, 2) check (espesor_mm is null or espesor_mm > 0),
  ancho_mm            numeric(10, 2) check (ancho_mm is null or ancho_mm > 0),
  largo_mm            numeric(10, 2) check (largo_mm is null or largo_mm > 0),
  -- A36, A572, Hardox 450/500, ASTM A500, inoxidable 304...
  calidad_acero       text,
  marca               text,
  modelo              text,
  -- Peso teórico de una unidad de compra; con él se pasa de planchas a kilos.
  peso_unitario_kg    numeric(12, 4) check (peso_unitario_kg is null or peso_unitario_kg >= 0),
  -- Costo unitario por promedio ponderado consolidado de todos los almacenes.
  -- Lo mantiene confirmar_movimiento_almacen(); no se edita a mano.
  costo_promedio      public.monto not null default 0 check (costo_promedio >= 0),
  ultimo_costo        public.monto not null default 0 check (ultimo_costo >= 0),
  fecha_ultimo_costo  date,
  stock_minimo        public.cantidad not null default 0 check (stock_minimo >= 0),
  stock_maximo        public.cantidad not null default 0 check (stock_maximo >= 0),
  -- Saldo con el que se dispara la reposición; suele estar entre mínimo y máximo.
  punto_reposicion    public.cantidad not null default 0 check (punto_reposicion >= 0),
  -- Material sin el cual la producción se detiene (plancha, electrodo, pistón).
  es_critico          boolean not null default false,
  -- Acero y consumibles certificados: obliga a identificar lote/colada al ingresar.
  controla_lote       boolean not null default false,
  -- Falso en servicios o consumibles que se compran y se gastan sin inventariar.
  es_inventariable    boolean not null default true,
  codigo_barras       text unique,
  imagen_url          text,
  observaciones       text,
  activo              boolean not null default true,
  creado_por          uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint ck_material_stock_rango check (stock_maximo = 0 or stock_maximo >= stock_minimo),
  constraint ck_material_reposicion check (
    punto_reposicion = 0 or stock_maximo = 0 or punto_reposicion <= stock_maximo)
);

comment on table public.materiales is
  'Catálogo maestro de materiales: planchas, perfiles, hidráulica, soldadura, pintura, ferretería y gases. El costo_promedio lo calcula el kardex, nunca el usuario.';
comment on column public.materiales.codigo is
  'Código interno de la empresa. Es el que aparece en el vale de consumo y en la etiqueta de anaquel.';
comment on column public.materiales.controla_lote is
  'Si es true el ingreso exige lote con número de colada. Es lo que permite responder "de qué colada salió el acero de esta tolva".';
comment on column public.materiales.es_critico is
  'Material cuya rotura de stock para la producción; alimenta las alertas de reposición.';
comment on column public.materiales.peso_unitario_kg is
  'Peso teórico de una unidad de compra. Sirve para convertir planchas a kilos al valorizar o al calcular el habilitado.';
comment on column public.materiales.punto_reposicion is
  'Saldo con el que se genera la orden de compra. Cero significa que no se controla reposición automática.';

create index idx_materiales_categoria on public.materiales(categoria_id);
create index idx_materiales_unidad on public.materiales(unidad_medida_id);
create index idx_materiales_creado_por on public.materiales(creado_por);
create index idx_materiales_codigo_barras on public.materiales(codigo_barras) where codigo_barras is not null;
create index idx_materiales_activo on public.materiales(activo) where activo;
create index idx_materiales_criticos on public.materiales(es_critico) where es_critico and activo;

-- El almacenero busca escribiendo "plancha 6mm" o "hardox": búsqueda difusa.
create index idx_materiales_descripcion_trgm
  on public.materiales using gin (descripcion gin_trgm_ops);
create index idx_materiales_codigo_trgm
  on public.materiales using gin (codigo gin_trgm_ops);

-- =============================================================================
-- ALMACENES
-- =============================================================================

create table public.almacenes (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre         text not null,
  sede_id        uuid not null references public.sedes(id) on delete restrict,
  tipo           public.tipo_almacen not null default 'PRINCIPAL',
  responsable_id uuid references public.usuarios(id) on delete set null,
  direccion      text,
  -- Un almacén de solo lectura conserva su historia pero ya no admite movimientos.
  permite_movimientos boolean not null default true,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.almacenes is
  'Almacenes físicos por sede. El de tipo OBRA representa el material ya entregado a planta y el de tipo MERMA acumula recortes y material dado de baja.';
comment on column public.almacenes.permite_movimientos is
  'Falso congela el almacén: el histórico se conserva pero no se aceptan nuevos movimientos.';

create index idx_almacenes_sede on public.almacenes(sede_id);
create index idx_almacenes_responsable on public.almacenes(responsable_id);
create index idx_almacenes_tipo on public.almacenes(tipo);
create index idx_almacenes_activo on public.almacenes(activo) where activo;

-- Una sede tiene un solo almacén principal: es el destino por defecto de las compras.
create unique index uq_almacen_principal_sede
  on public.almacenes(sede_id) where tipo = 'PRINCIPAL' and activo;

-- =============================================================================
-- EXISTENCIAS POR ALMACÉN
-- =============================================================================

create table public.almacen_stock (
  id                  uuid primary key default gen_random_uuid(),
  almacen_id          uuid not null references public.almacenes(id) on delete restrict,
  material_id         uuid not null references public.materiales(id) on delete restrict,
  cantidad            public.cantidad not null default 0 check (cantidad >= 0),
  -- Comprometida por requerimientos aprobados que todavía no se atienden.
  cantidad_reservada  public.cantidad not null default 0 check (cantidad_reservada >= 0),
  -- Lo que el taller puede pedir hoy sin pisar una reserva ajena.
  cantidad_disponible public.cantidad generated always as (cantidad - cantidad_reservada) stored,
  -- Promedio ponderado móvil DE ESTE ALMACÉN. El consolidado vive en materiales.
  costo_promedio      public.monto not null default 0 check (costo_promedio >= 0),
  -- Saldo valorizado acumulado; es cantidad * costo_promedio salvo redondeos.
  saldo_valor         public.monto not null default 0 check (saldo_valor >= 0),
  -- Anaquel, rack o zona del patio donde está físicamente el material.
  ubicacion           text,
  fecha_ultimo_movimiento timestamptz,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint uq_almacen_stock unique (almacen_id, material_id),
  -- No se puede reservar más de lo que existe físicamente.
  constraint ck_stock_reserva check (cantidad_reservada <= cantidad)
);

comment on table public.almacen_stock is
  'Existencia de cada material en cada almacén con su valorización. La escribe únicamente confirmar_movimiento_almacen(); el kardex es la fuente de verdad y esta tabla su saldo vigente.';
comment on column public.almacen_stock.cantidad_disponible is
  'Columna calculada: cantidad - cantidad_reservada. Es la que se valida al aprobar un requerimiento.';
comment on column public.almacen_stock.saldo_valor is
  'Valor acumulado del saldo. Al llegar a cantidad cero se fuerza a cero para no arrastrar centavos de redondeo.';

create index idx_almacen_stock_almacen on public.almacen_stock(almacen_id);
create index idx_almacen_stock_material on public.almacen_stock(material_id);
-- El tablero de reposición pregunta por lo que tiene saldo o reserva viva.
create index idx_almacen_stock_con_saldo on public.almacen_stock(material_id)
  where cantidad > 0 or cantidad_reservada > 0;

-- =============================================================================
-- LOTES / COLADAS · TRAZABILIDAD DEL ACERO
-- =============================================================================

create table public.lotes_material (
  id                  uuid primary key default gen_random_uuid(),
  material_id         uuid not null references public.materiales(id) on delete restrict,
  -- Identificador interno del lote; si el proveedor no da uno se usa el número
  -- de la recepción para no perder la referencia documentaria.
  numero_lote         text not null,
  -- Número de colada del acero: el dato que la siderúrgica estampa en la plancha.
  numero_colada       text,
  certificado_calidad text,
  certificado_url     text,
  proveedor_id        uuid,
  orden_compra_id     uuid,
  recepcion_id        uuid,
  almacen_id          uuid references public.almacenes(id) on delete restrict,
  fecha_ingreso       date not null default current_date,
  -- Pintura, thinner, masilla y gases sí vencen; el acero no.
  fecha_vencimiento   date,
  cantidad_ingresada  public.cantidad not null default 0 check (cantidad_ingresada >= 0),
  cantidad_disponible public.cantidad not null default 0 check (cantidad_disponible >= 0),
  costo_unitario      public.monto not null default 0 check (costo_unitario >= 0),
  observaciones       text,
  activo              boolean not null default true,
  creado_por          uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint uq_lote_material unique (material_id, numero_lote),
  constraint ck_lote_vencimiento check (fecha_vencimiento is null or fecha_vencimiento >= fecha_ingreso)
);

comment on table public.lotes_material is
  'Lote o colada de un material certificado. Junto con el kardex responde la pregunta de trazabilidad del negocio: qué acero, de qué colada y de qué proveedor se usó en qué carrocería.';
comment on column public.lotes_material.numero_colada is
  'Colada de la siderúrgica (Aceros Arequipa, Hardox). Es el dato que exige el cliente minero en su expediente de calidad.';
comment on column public.lotes_material.cantidad_disponible is
  'Saldo del lote. Lo descuentan las salidas de kardex que citan este lote.';

create index idx_lotes_material on public.lotes_material(material_id);
create index idx_lotes_proveedor on public.lotes_material(proveedor_id);
create index idx_lotes_orden_compra on public.lotes_material(orden_compra_id);
create index idx_lotes_recepcion on public.lotes_material(recepcion_id);
create index idx_lotes_almacen on public.lotes_material(almacen_id);
create index idx_lotes_creado_por on public.lotes_material(creado_por);
create index idx_lotes_colada on public.lotes_material(numero_colada) where numero_colada is not null;
create index idx_lotes_vencimiento on public.lotes_material(fecha_vencimiento)
  where fecha_vencimiento is not null and activo;
create index idx_lotes_con_saldo on public.lotes_material(material_id) where cantidad_disponible > 0;

-- =============================================================================
-- KARDEX VALORIZADO · LIBRO INMUTABLE DE MOVIMIENTOS
-- =============================================================================

create table public.kardex (
  id                uuid primary key default gen_random_uuid(),
  -- Orden real de asiento. El saldo de una fila es el saldo tras aplicarla en
  -- ESTA secuencia, que es el orden en que se confirmaron los documentos y no
  -- necesariamente el orden de sus fechas (un vale puede registrarse tarde).
  secuencia         bigint generated always as identity,
  material_id       uuid not null references public.materiales(id) on delete restrict,
  almacen_id        uuid not null references public.almacenes(id) on delete restrict,
  lote_id           uuid references public.lotes_material(id) on delete restrict,
  -- Fecha contable del movimiento, heredada del documento que lo originó.
  fecha             date not null default current_date,
  tipo_movimiento   public.tipo_movimiento_kardex not null,
  -- Cantidad CON SIGNO: positiva en los ingresos, negativa en las salidas.
  cantidad          public.cantidad not null check (cantidad <> 0),
  costo_unitario    public.monto not null check (costo_unitario >= 0),
  -- Siempre positivo; el signo del movimiento ya está en cantidad.
  costo_total       public.monto not null check (costo_total >= 0),
  -- Saldos del par (material, almacén) DESPUÉS de aplicar esta fila.
  saldo_cantidad    public.cantidad not null check (saldo_cantidad >= 0),
  saldo_valor       public.monto not null check (saldo_valor >= 0),
  -- Promedio ponderado resultante del almacén tras esta fila.
  costo_promedio    public.monto not null default 0 check (costo_promedio >= 0),
  -- Orden de trabajo a la que se carga el consumo. Es la columna que convierte
  -- el almacén en costo real de la carrocería.
  orden_id          uuid references public.ordenes_trabajo(id) on delete restrict,
  etapa_id          uuid,
  -- Documento de almacén que originó la fila (el caso normal).
  movimiento_id     uuid,
  -- Puntero genérico para orígenes que no son un movimiento de almacén.
  referencia_tabla  text,
  referencia_id     uuid,
  observaciones     text,
  usuario_id        uuid references public.usuarios(id) on delete set null,
  creado_en         timestamptz not null default now(),

  -- El signo de la cantidad tiene que ser coherente con el tipo de movimiento:
  -- sin esta regla el saldo del libro deja de significar nada.
  constraint ck_kardex_signo check (
    (tipo_movimiento in ('INGRESO_COMPRA', 'INGRESO_DEVOLUCION', 'INGRESO_AJUSTE', 'INGRESO_TRANSFERENCIA')
       and cantidad > 0)
    or
    (tipo_movimiento in ('SALIDA_OT', 'SALIDA_AJUSTE', 'SALIDA_TRANSFERENCIA', 'SALIDA_MERMA')
       and cantidad < 0)
  ),
  -- Toda salida a producción se imputa a una OT: es el requisito del costeo real.
  constraint ck_kardex_salida_ot check (tipo_movimiento <> 'SALIDA_OT' or orden_id is not null),
  -- La etapa siempre viaja con su OT; sin ella no se sabría a qué fase cargarle
  -- el material.
  constraint ck_kardex_etapa check (etapa_id is null or orden_id is not null),
  constraint fk_kardex_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete restrict
);

comment on table public.kardex is
  'Libro de inventario permanente valorizado por promedio ponderado. Es INMUTABLE: un trigger rechaza UPDATE y DELETE. Todo error se corrige con un movimiento de ajuste, de modo que el libro siempre reconstruye el saldo sumando sus propias filas.';
comment on column public.kardex.secuencia is
  'Orden de asiento. Ordenar por secuencia reproduce exactamente los saldos guardados; ordenar por fecha no, porque los documentos se registran con retraso.';
comment on column public.kardex.cantidad is
  'Cantidad con signo: positiva en ingresos, negativa en salidas. Sumarla por material y almacén debe dar siempre el saldo vigente.';
comment on column public.kardex.costo_promedio is
  'Promedio ponderado del material en ese almacén después de esta fila. En los ingresos es el promedio recalculado; en las salidas es el promedio al que se valorizó.';
comment on column public.kardex.orden_id is
  'OT a la que se carga el consumo. El módulo de costos suma por aquí el material real de cada carrocería.';
comment on column public.kardex.referencia_tabla is
  'Tabla del documento origen cuando no es un movimiento de almacén (por ejemplo recepciones). Con referencia_id apunta a la fila exacta.';

create index idx_kardex_material_almacen on public.kardex(material_id, almacen_id, secuencia desc);
create index idx_kardex_material on public.kardex(material_id, fecha desc);
create index idx_kardex_almacen on public.kardex(almacen_id, fecha desc);
create index idx_kardex_lote on public.kardex(lote_id);
create index idx_kardex_orden on public.kardex(orden_id, fecha);
create index idx_kardex_etapa on public.kardex(etapa_id);
create index idx_kardex_movimiento on public.kardex(movimiento_id);
create index idx_kardex_tipo on public.kardex(tipo_movimiento, fecha desc);
create index idx_kardex_fecha on public.kardex(fecha desc);
create index idx_kardex_usuario on public.kardex(usuario_id);
create index idx_kardex_referencia on public.kardex(referencia_tabla, referencia_id)
  where referencia_tabla is not null;

-- =============================================================================
-- DOCUMENTOS DE ALMACÉN
-- =============================================================================

create table public.movimientos_almacen (
  id                  uuid primary key default gen_random_uuid(),
  -- Lo asigna el trigger con siguiente_correlativo() según el tipo.
  -- El default vacío existe para que el trigger BEFORE INSERT pueda asignar el
  -- correlativo sin que la aplicación tenga que inventar un número: Postgres
  -- aplica los defaults antes de los triggers, así que el trigger siempre
  -- reemplaza esta cadena vacía por el número real.
  numero              text not null default '' unique,
  tipo                public.tipo_movimiento_almacen not null,
  estado              public.estado_movimiento_almacen not null default 'BORRADOR',
  fecha               date not null default current_date,
  -- Almacén que mueve el stock; en una transferencia es el origen.
  almacen_id          uuid not null references public.almacenes(id) on delete restrict,
  almacen_destino_id  uuid references public.almacenes(id) on delete restrict,
  -- OT a la que se carga el consumo (salidas) o que devuelve material.
  orden_id            uuid references public.ordenes_trabajo(id) on delete restrict,
  -- Etapa concreta de la OT: permite costear el material por fase de fabricación.
  etapa_id            uuid,
  requerimiento_id    uuid,
  proveedor_id        uuid,
  -- Guía de remisión, factura o documento externo que respalda el movimiento.
  documento_referencia text,
  referencia_tabla    text,
  referencia_id       uuid,
  motivo              text,
  observaciones       text,
  -- Suma valorizada de las líneas; la escribe la confirmación.
  total_valorizado    public.monto not null default 0 check (total_valorizado >= 0),
  responsable_id      uuid references public.usuarios(id) on delete set null,
  confirmado_por      uuid references public.usuarios(id) on delete set null,
  fecha_confirmacion  timestamptz,
  anulado_por         uuid references public.usuarios(id) on delete set null,
  fecha_anulacion     timestamptz,
  motivo_anulacion    text,
  creado_por          uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  -- Solo la transferencia tiene destino, y nunca contra sí misma.
  constraint ck_mov_destino check (
    (tipo = 'TRANSFERENCIA' and almacen_destino_id is not null and almacen_destino_id <> almacen_id)
    or (tipo <> 'TRANSFERENCIA' and almacen_destino_id is null)),
  -- El vale de consumo y la devolución existen siempre contra una OT.
  constraint ck_mov_orden check (
    tipo not in ('SALIDA_OT', 'DEVOLUCION_OT') or orden_id is not null),
  -- Un ajuste sin explicación es un descuadre encubierto.
  constraint ck_mov_motivo_ajuste check (
    tipo <> 'AJUSTE' or nullif(btrim(motivo), '') is not null),
  constraint ck_mov_motivo_anulacion check (
    estado <> 'ANULADO' or nullif(btrim(motivo_anulacion), '') is not null),
  constraint ck_mov_etapa check (etapa_id is null or orden_id is not null),
  constraint fk_mov_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete restrict
);

comment on table public.movimientos_almacen is
  'Documento que mueve el stock: ingreso, vale de consumo a OT, devolución, transferencia, ajuste y baja por merma. Mientras está en BORRADOR se edita; al confirmarse escribe el kardex y ya no se toca.';
comment on column public.movimientos_almacen.estado is
  'BORRADOR (editable) → CONFIRMADO (escribió el kardex, inmutable) o ANULADO (se descartó antes de confirmar). Un movimiento confirmado NO se anula: se corrige con un movimiento contrario.';
comment on column public.movimientos_almacen.almacen_destino_id is
  'Almacén que recibe en una transferencia. La confirmación genera dos filas de kardex: salida en el origen e ingreso en el destino al mismo costo.';
comment on column public.movimientos_almacen.total_valorizado is
  'Valor total del movimiento al costo del kardex. Solo tiene contenido tras confirmar.';

create index idx_mov_almacen on public.movimientos_almacen(almacen_id, fecha desc);
create index idx_mov_almacen_destino on public.movimientos_almacen(almacen_destino_id);
create index idx_mov_orden on public.movimientos_almacen(orden_id);
create index idx_mov_etapa on public.movimientos_almacen(etapa_id);
create index idx_mov_requerimiento on public.movimientos_almacen(requerimiento_id);
create index idx_mov_proveedor on public.movimientos_almacen(proveedor_id);
create index idx_mov_responsable on public.movimientos_almacen(responsable_id);
create index idx_mov_confirmado_por on public.movimientos_almacen(confirmado_por);
create index idx_mov_anulado_por on public.movimientos_almacen(anulado_por);
create index idx_mov_creado_por on public.movimientos_almacen(creado_por);
create index idx_mov_tipo_estado on public.movimientos_almacen(tipo, estado);
create index idx_mov_fecha on public.movimientos_almacen(fecha desc);
create index idx_mov_referencia on public.movimientos_almacen(referencia_tabla, referencia_id)
  where referencia_tabla is not null;
-- El almacenero abre siempre "lo que está pendiente de confirmar".
create index idx_mov_borradores on public.movimientos_almacen(almacen_id, fecha desc)
  where estado = 'BORRADOR';

create table public.movimiento_detalle (
  id                     uuid primary key default gen_random_uuid(),
  movimiento_id          uuid not null references public.movimientos_almacen(id) on delete cascade,
  material_id            uuid not null references public.materiales(id) on delete restrict,
  lote_id                uuid references public.lotes_material(id) on delete restrict,
  -- Línea del requerimiento que esta salida atiende; al confirmar libera la reserva.
  requerimiento_detalle_id uuid,
  -- Positiva salvo en los ajustes, donde el signo indica sobrante o faltante.
  cantidad               public.cantidad not null check (cantidad <> 0),
  -- Costo propuesto. En las salidas se ignora: manda el promedio ponderado.
  costo_unitario         public.monto not null default 0 check (costo_unitario >= 0),
  costo_total            public.monto not null default 0 check (costo_total >= 0),
  -- Conteo físico del inventario, para dejar constancia de cómo se calculó el ajuste.
  cantidad_sistema       public.cantidad,
  cantidad_fisica        public.cantidad,
  observaciones          text,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),

  -- Un material aparece una sola vez por documento y lote: si se saca dos veces
  -- se acumula en la misma línea y el vale queda legible.
  constraint uq_movimiento_detalle unique nulls not distinct (movimiento_id, material_id, lote_id)
);

comment on table public.movimiento_detalle is
  'Líneas del documento de almacén. Solo se pueden editar mientras el movimiento está en BORRADOR.';
comment on column public.movimiento_detalle.cantidad is
  'Cantidad positiva. En los movimientos de tipo AJUSTE admite negativo para registrar el faltante de inventario.';
comment on column public.movimiento_detalle.costo_unitario is
  'Costo de ingreso. En las salidas lo sobrescribe la confirmación con el promedio ponderado del almacén.';

create index idx_mov_detalle_movimiento on public.movimiento_detalle(movimiento_id);
create index idx_mov_detalle_material on public.movimiento_detalle(material_id);
create index idx_mov_detalle_lote on public.movimiento_detalle(lote_id);
create index idx_mov_detalle_requerimiento on public.movimiento_detalle(requerimiento_detalle_id);

-- =============================================================================
-- REQUERIMIENTOS DE MATERIAL
-- =============================================================================

create table public.requerimientos (
  id               uuid primary key default gen_random_uuid(),
  -- El default vacío existe para que el trigger BEFORE INSERT pueda asignar el
  -- correlativo sin que la aplicación tenga que inventar un número: Postgres
  -- aplica los defaults antes de los triggers, así que el trigger siempre
  -- reemplaza esta cadena vacía por el número real.
  numero           text not null default '' unique,
  -- Nulo en un requerimiento de reposición de almacén que no nace de una OT.
  orden_id         uuid references public.ordenes_trabajo(id) on delete restrict,
  etapa_id         uuid,
  sede_id          uuid not null references public.sedes(id) on delete restrict,
  -- Almacén que debe atenderlo; es donde se reserva el stock al aprobar.
  almacen_id       uuid references public.almacenes(id) on delete restrict,
  estado           public.estado_requerimiento not null default 'SOLICITADO',
  prioridad        public.prioridad_ot not null default 'NORMAL',
  fecha            date not null default current_date,
  -- Cuándo lo necesita el taller; la compra se programa contra esta fecha.
  fecha_requerida  date,
  solicitante_id   uuid references public.usuarios(id) on delete set null,
  aprobador_id     uuid references public.usuarios(id) on delete set null,
  fecha_aprobacion timestamptz,
  motivo_rechazo   text,
  observaciones    text,
  creado_por       uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  constraint ck_req_fecha_requerida check (fecha_requerida is null or fecha_requerida >= fecha),
  constraint ck_req_motivo_rechazo check (
    estado <> 'RECHAZADO' or nullif(btrim(motivo_rechazo), '') is not null),
  constraint ck_req_etapa check (etapa_id is null or orden_id is not null),
  constraint fk_req_etapa foreign key (etapa_id, orden_id)
    references public.ot_etapas(id, orden_id) on delete restrict
);

comment on table public.requerimientos is
  'Pedido de material del taller para una OT. Al aprobarse reserva el stock disponible; lo que no hay se convierte en orden de compra.';
comment on column public.requerimientos.estado is
  'SOLICITADO → APROBADO → ATENDIDO_PARCIAL → ATENDIDO. RECHAZADO y ANULADO liberan las reservas.';
comment on column public.requerimientos.almacen_id is
  'Almacén sobre el que se reserva y desde el que se despacha. Sin almacén no hay reserva posible.';

create index idx_req_orden on public.requerimientos(orden_id);
create index idx_req_etapa on public.requerimientos(etapa_id);
create index idx_req_sede on public.requerimientos(sede_id);
create index idx_req_almacen on public.requerimientos(almacen_id);
create index idx_req_solicitante on public.requerimientos(solicitante_id);
create index idx_req_aprobador on public.requerimientos(aprobador_id);
create index idx_req_creado_por on public.requerimientos(creado_por);
create index idx_req_estado on public.requerimientos(estado);
create index idx_req_fecha on public.requerimientos(fecha desc);
-- Bandeja del jefe de almacén: lo pendiente, por urgencia y por fecha requerida.
create index idx_req_pendientes on public.requerimientos(prioridad desc, fecha_requerida)
  where estado in ('SOLICITADO', 'APROBADO', 'ATENDIDO_PARCIAL');

create table public.requerimiento_detalle (
  id                  uuid primary key default gen_random_uuid(),
  requerimiento_id    uuid not null references public.requerimientos(id) on delete cascade,
  material_id         uuid not null references public.materiales(id) on delete restrict,
  cantidad_solicitada public.cantidad not null check (cantidad_solicitada > 0),
  -- La aprueba el jefe de almacén y puede ser menor a la solicitada.
  cantidad_aprobada   public.cantidad not null default 0 check (cantidad_aprobada >= 0),
  -- La suman los vales de consumo al confirmarse.
  cantidad_atendida   public.cantidad not null default 0 check (cantidad_atendida >= 0),
  -- Parte de lo aprobado que hoy está comprometida en almacen_stock.
  cantidad_reservada  public.cantidad not null default 0 check (cantidad_reservada >= 0),
  especificacion      text,
  observaciones       text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint uq_req_detalle unique (requerimiento_id, material_id),
  constraint ck_req_detalle_aprobada check (cantidad_aprobada <= cantidad_solicitada),
  constraint ck_req_detalle_reservada check (cantidad_reservada <= cantidad_aprobada)
);

comment on table public.requerimiento_detalle is
  'Materiales pedidos. cantidad_aprobada la fija el almacén, cantidad_atendida la suman los vales de consumo y cantidad_reservada es lo que hoy está comprometido en el stock.';

create index idx_req_detalle_requerimiento on public.requerimiento_detalle(requerimiento_id);
create index idx_req_detalle_material on public.requerimiento_detalle(material_id);
-- Lo que falta despachar, para el saldo de atención del almacén.
create index idx_req_detalle_pendiente on public.requerimiento_detalle(material_id)
  where cantidad_atendida < cantidad_aprobada;

-- =============================================================================
-- PROVEEDORES
-- =============================================================================

create table public.proveedores (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,
  -- RUC de 11 dígitos, o DNI de 8 en el proveedor persona natural (el tornero
  -- de la esquina, el pintor independiente).
  numero_documento  text not null unique
    check (numero_documento ~ '^[0-9]{8}$' or numero_documento ~ '^[0-9]{11}$'),
  razon_social      text not null,
  nombre_comercial  text,
  direccion         text,
  distrito          text,
  provincia         text,
  departamento      text,
  telefono          text,
  correo            public.email,
  web               text,
  contacto_nombre   text,
  contacto_telefono text,
  contacto_correo   public.email,
  condicion_pago    public.condicion_pago not null default 'CONTADO',
  dias_credito      int not null default 0 check (dias_credito between 0 and 180),
  moneda            public.moneda not null default 'PEN',
  banco             text,
  cuenta_bancaria   text,
  cuenta_cci        text,
  -- Calificación del comprador: 1 malo, 5 excelente. Pondera precio, plazo y calidad.
  calificacion      smallint check (calificacion between 1 and 5),
  -- Proveedor homologado para material certificado (acero, pernería estructural).
  es_homologado     boolean not null default false,
  observaciones     text,
  activo            boolean not null default true,
  creado_por        uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- El crédito sin días es contado disfrazado.
  constraint ck_proveedor_credito check (condicion_pago = 'CONTADO' or dias_credito > 0)
);

comment on table public.proveedores is
  'Proveedores de material y servicios de almacén: siderúrgicas, distribuidores, ferreterías, hidráulica y pintura.';
comment on column public.proveedores.es_homologado is
  'Proveedor aprobado para suministrar material certificado. Solo de un homologado se acepta acero con colada para trabajos con exigencia de calidad.';
comment on column public.proveedores.calificacion is
  'Nota de 1 a 5 que resume precio, cumplimiento de plazo y calidad. La usa el comprador al cotizar.';

create index idx_proveedores_creado_por on public.proveedores(creado_por);
create index idx_proveedores_documento on public.proveedores(numero_documento);
create index idx_proveedores_activo on public.proveedores(activo) where activo;
create index idx_proveedores_razon_social_trgm
  on public.proveedores using gin (razon_social gin_trgm_ops);

create table public.proveedor_materiales (
  id                  uuid primary key default gen_random_uuid(),
  proveedor_id        uuid not null references public.proveedores(id) on delete cascade,
  material_id         uuid not null references public.materiales(id) on delete cascade,
  -- Código con el que el proveedor identifica el material en su cotización.
  codigo_proveedor    text,
  precio_referencial  public.monto not null default 0 check (precio_referencial >= 0),
  moneda              public.moneda not null default 'PEN',
  fecha_precio        date,
  -- Plazo de entrega prometido; alimenta la fecha de entrega esperada de la OC.
  tiempo_entrega_dias int not null default 0 check (tiempo_entrega_dias >= 0),
  cantidad_minima     public.cantidad not null default 0 check (cantidad_minima >= 0),
  -- Proveedor por defecto de este material al generar la orden de compra.
  es_preferente       boolean not null default false,
  observaciones       text,
  activo              boolean not null default true,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint uq_proveedor_material unique (proveedor_id, material_id)
);

comment on table public.proveedor_materiales is
  'Qué material vende cada proveedor, a qué precio de referencia y en cuánto tiempo lo entrega. Es la lista con la que el comprador arma la orden de compra.';

create index idx_prov_mat_proveedor on public.proveedor_materiales(proveedor_id);
create index idx_prov_mat_material on public.proveedor_materiales(material_id);
-- Un solo proveedor preferente por material.
create unique index uq_prov_mat_preferente on public.proveedor_materiales(material_id)
  where es_preferente and activo;

-- =============================================================================
-- ÓRDENES DE COMPRA
-- =============================================================================

create table public.ordenes_compra (
  id                    uuid primary key default gen_random_uuid(),
  -- El default vacío existe para que el trigger BEFORE INSERT pueda asignar el
  -- correlativo sin que la aplicación tenga que inventar un número: Postgres
  -- aplica los defaults antes de los triggers, así que el trigger siempre
  -- reemplaza esta cadena vacía por el número real.
  numero                text not null default '' unique,
  proveedor_id          uuid not null references public.proveedores(id) on delete restrict,
  -- Requerimiento que originó la compra; permite cerrar el círculo taller-compra.
  requerimiento_id      uuid references public.requerimientos(id) on delete set null,
  -- OT a la que se compra directamente (material que no pasa por stock general).
  orden_id              uuid references public.ordenes_trabajo(id) on delete restrict,
  sede_id               uuid not null references public.sedes(id) on delete restrict,
  almacen_destino_id    uuid references public.almacenes(id) on delete restrict,
  estado                public.estado_orden_compra not null default 'BORRADOR',
  fecha                 date not null default current_date,
  fecha_entrega_esperada date,
  moneda                public.moneda not null default 'PEN',
  -- Tipo de cambio con el que se valorizará el ingreso si la compra es en dólares.
  tipo_cambio           numeric(10, 4) not null default 1 check (tipo_cambio > 0),
  condicion_pago        public.condicion_pago not null default 'CONTADO',
  lugar_entrega         text,
  -- Totales mantenidos por trigger a partir del detalle; no se editan a mano.
  subtotal              public.monto not null default 0 check (subtotal >= 0),
  descuento             public.monto not null default 0 check (descuento >= 0),
  igv_porcentaje        public.porcentaje not null default 18,
  igv                   public.monto not null default 0 check (igv >= 0),
  total                 public.monto not null default 0 check (total >= 0),
  observaciones         text,
  aprobada_por          uuid references public.usuarios(id) on delete set null,
  fecha_aprobacion      timestamptz,
  fecha_envio           timestamptz,
  motivo_anulacion      text,
  creado_por            uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  constraint ck_oc_entrega check (fecha_entrega_esperada is null or fecha_entrega_esperada >= fecha),
  constraint ck_oc_motivo_anulacion check (
    estado <> 'ANULADA' or nullif(btrim(motivo_anulacion), '') is not null),
  -- El tipo de cambio solo tiene sentido distinto de 1 en moneda extranjera.
  constraint ck_oc_tipo_cambio check (moneda = 'USD' or tipo_cambio = 1)
);

comment on table public.ordenes_compra is
  'Orden de compra al proveedor. Nace de un requerimiento que el almacén no pudo atender con stock. Sus recepciones generan los ingresos valorizados al kardex.';
comment on column public.ordenes_compra.estado is
  'BORRADOR → APROBADA → ENVIADA → RECIBIDA_PARCIAL → RECIBIDA. Las recepciones mueven los dos últimos estados solas.';
comment on column public.ordenes_compra.tipo_cambio is
  'Tipo de cambio de la compra en dólares. El kardex siempre se valoriza en moneda base, así que la recepción convierte con este valor.';

create index idx_oc_proveedor on public.ordenes_compra(proveedor_id);
create index idx_oc_requerimiento on public.ordenes_compra(requerimiento_id);
create index idx_oc_orden on public.ordenes_compra(orden_id);
create index idx_oc_sede on public.ordenes_compra(sede_id);
create index idx_oc_almacen_destino on public.ordenes_compra(almacen_destino_id);
create index idx_oc_aprobada_por on public.ordenes_compra(aprobada_por);
create index idx_oc_creado_por on public.ordenes_compra(creado_por);
create index idx_oc_estado on public.ordenes_compra(estado);
create index idx_oc_fecha on public.ordenes_compra(fecha desc);
-- Seguimiento del comprador: lo que está en la calle y su fecha comprometida.
create index idx_oc_pendientes on public.ordenes_compra(fecha_entrega_esperada)
  where estado in ('APROBADA', 'ENVIADA', 'RECIBIDA_PARCIAL');

create table public.orden_compra_detalle (
  id                    uuid primary key default gen_random_uuid(),
  orden_compra_id       uuid not null references public.ordenes_compra(id) on delete cascade,
  material_id           uuid not null references public.materiales(id) on delete restrict,
  requerimiento_detalle_id uuid references public.requerimiento_detalle(id) on delete set null,
  -- Descripción tal como debe salir impresa en la OC (puede detallar medidas).
  descripcion           text,
  cantidad              public.cantidad not null check (cantidad > 0),
  precio_unitario       public.monto not null check (precio_unitario >= 0),
  descuento_porcentaje  public.porcentaje not null default 0,
  subtotal              public.monto generated always as (
                          round(cantidad * precio_unitario * (1 - descuento_porcentaje / 100), 2)
                        ) stored,
  -- La suman las recepciones; nunca se edita a mano.
  cantidad_recibida     public.cantidad not null default 0 check (cantidad_recibida >= 0),
  cantidad_pendiente    public.cantidad generated always as (
                          greatest(cantidad - cantidad_recibida, 0)
                        ) stored,
  fecha_entrega_esperada date,
  observaciones         text,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),

  constraint uq_oc_detalle unique (orden_compra_id, material_id)
);

comment on table public.orden_compra_detalle is
  'Líneas de la orden de compra. El subtotal y el pendiente son columnas calculadas: no se pueden desincronizar del precio ni de lo recibido.';
comment on column public.orden_compra_detalle.cantidad_recibida is
  'Acumulado de las recepciones confirmadas. Cuando iguala a cantidad en todas las líneas, la OC pasa a RECIBIDA.';

create index idx_oc_detalle_orden on public.orden_compra_detalle(orden_compra_id);
create index idx_oc_detalle_material on public.orden_compra_detalle(material_id);
create index idx_oc_detalle_requerimiento on public.orden_compra_detalle(requerimiento_detalle_id);
create index idx_oc_detalle_pendiente on public.orden_compra_detalle(material_id)
  where cantidad_recibida < cantidad;

-- =============================================================================
-- RECEPCIONES DE COMPRA
-- =============================================================================

create table public.recepciones (
  id                uuid primary key default gen_random_uuid(),
  -- El default vacío existe para que el trigger BEFORE INSERT pueda asignar el
  -- correlativo sin que la aplicación tenga que inventar un número: Postgres
  -- aplica los defaults antes de los triggers, así que el trigger siempre
  -- reemplaza esta cadena vacía por el número real.
  numero            text not null default '' unique,
  orden_compra_id   uuid not null references public.ordenes_compra(id) on delete restrict,
  almacen_id        uuid not null references public.almacenes(id) on delete restrict,
  estado            public.estado_movimiento_almacen not null default 'BORRADOR',
  fecha             date not null default current_date,
  -- Documentos del proveedor: sin guía no hay sustento del ingreso ante SUNAT.
  numero_guia       text,
  fecha_guia        date,
  numero_factura    text,
  fecha_factura     date,
  transportista     text,
  placa_vehiculo    public.placa,
  -- Movimiento de ingreso que generó esta recepción al confirmarse.
  movimiento_id     uuid,
  observaciones     text,
  recibido_por      uuid references public.usuarios(id) on delete set null,
  confirmado_por    uuid references public.usuarios(id) on delete set null,
  fecha_confirmacion timestamptz,
  motivo_anulacion  text,
  creado_por        uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  constraint ck_recepcion_motivo_anulacion check (
    estado <> 'ANULADO' or nullif(btrim(motivo_anulacion), '') is not null)
);

comment on table public.recepciones is
  'Llegada física de una orden de compra al almacén. Al confirmarse genera el movimiento de ingreso, crea los lotes del material certificado y actualiza lo recibido en la OC.';
comment on column public.recepciones.numero_guia is
  'Guía de remisión del proveedor. Junto con la factura es el sustento documentario del ingreso.';
comment on column public.recepciones.movimiento_id is
  'Movimiento de almacén generado por la confirmación. Es el puente entre la compra y el kardex.';

create index idx_recepciones_oc on public.recepciones(orden_compra_id);
create index idx_recepciones_almacen on public.recepciones(almacen_id);
create index idx_recepciones_movimiento on public.recepciones(movimiento_id);
create index idx_recepciones_recibido_por on public.recepciones(recibido_por);
create index idx_recepciones_confirmado_por on public.recepciones(confirmado_por);
create index idx_recepciones_creado_por on public.recepciones(creado_por);
create index idx_recepciones_estado on public.recepciones(estado);
create index idx_recepciones_fecha on public.recepciones(fecha desc);
create index idx_recepciones_guia on public.recepciones(numero_guia) where numero_guia is not null;
create index idx_recepciones_factura on public.recepciones(numero_factura) where numero_factura is not null;

create table public.recepcion_detalle (
  id                     uuid primary key default gen_random_uuid(),
  recepcion_id           uuid not null references public.recepciones(id) on delete cascade,
  orden_compra_detalle_id uuid not null references public.orden_compra_detalle(id) on delete restrict,
  material_id            uuid not null references public.materiales(id) on delete restrict,
  cantidad_recibida      public.cantidad not null check (cantidad_recibida >= 0),
  -- Material que llegó mal (plancha abollada, pintura vencida): no ingresa al stock.
  cantidad_rechazada     public.cantidad not null default 0 check (cantidad_rechazada >= 0),
  motivo_rechazo         text,
  -- Costo en la moneda de la OC; la confirmación lo convierte a moneda base.
  costo_unitario         public.monto not null default 0 check (costo_unitario >= 0),
  -- Datos del lote que se creará si el material controla lote.
  numero_lote            text,
  numero_colada          text,
  certificado_calidad    text,
  fecha_vencimiento      date,
  observaciones          text,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),

  constraint ck_recepcion_detalle_algo check (cantidad_recibida > 0 or cantidad_rechazada > 0),
  constraint ck_recepcion_detalle_rechazo check (
    cantidad_rechazada = 0 or nullif(btrim(motivo_rechazo), '') is not null),
  constraint uq_recepcion_detalle unique (recepcion_id, orden_compra_detalle_id)
);

comment on table public.recepcion_detalle is
  'Lo que realmente llegó de cada línea de la OC, con su colada y certificado. Solo cantidad_recibida entra al stock; lo rechazado queda registrado con su motivo.';
comment on column public.recepcion_detalle.numero_colada is
  'Colada declarada en el certificado del acero. La confirmación crea con ella el lote trazable.';

create index idx_recepcion_detalle_recepcion on public.recepcion_detalle(recepcion_id);
create index idx_recepcion_detalle_oc_detalle on public.recepcion_detalle(orden_compra_detalle_id);
create index idx_recepcion_detalle_material on public.recepcion_detalle(material_id);
create index idx_recepcion_detalle_colada on public.recepcion_detalle(numero_colada)
  where numero_colada is not null;

-- -----------------------------------------------------------------------------
-- Claves foráneas diferidas
-- Se declaran aquí porque apuntan a tablas creadas más abajo en este archivo.
-- -----------------------------------------------------------------------------

alter table public.lotes_material
  add constraint fk_lote_proveedor foreign key (proveedor_id)
    references public.proveedores(id) on delete restrict,
  add constraint fk_lote_orden_compra foreign key (orden_compra_id)
    references public.ordenes_compra(id) on delete set null,
  add constraint fk_lote_recepcion foreign key (recepcion_id)
    references public.recepciones(id) on delete set null;

alter table public.kardex
  add constraint fk_kardex_movimiento foreign key (movimiento_id)
    references public.movimientos_almacen(id) on delete restrict;

alter table public.movimientos_almacen
  add constraint fk_mov_requerimiento foreign key (requerimiento_id)
    references public.requerimientos(id) on delete set null,
  add constraint fk_mov_proveedor foreign key (proveedor_id)
    references public.proveedores(id) on delete restrict;

alter table public.movimiento_detalle
  add constraint fk_mov_detalle_requerimiento foreign key (requerimiento_detalle_id)
    references public.requerimiento_detalle(id) on delete set null;

alter table public.recepciones
  add constraint fk_recepcion_movimiento foreign key (movimiento_id)
    references public.movimientos_almacen(id) on delete restrict;

-- =============================================================================
-- NUMERACIÓN AUTOMÁTICA DE DOCUMENTOS
-- Los números salen de public.siguiente_correlativo() dentro de la misma
-- transacción que inserta el documento, y después son inmutables.
-- =============================================================================

create or replace function public.fn_movimiento_numerar()
returns trigger
language plpgsql
as $$
declare
  v_tipo public.tipo_correlativo;
  v_sede uuid;
begin
  if tg_op = 'UPDATE' then
    if new.numero is distinct from old.numero then
      raise exception 'El número del movimiento de almacén es inmutable (% → %)', old.numero, new.numero
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if nullif(btrim(coalesce(new.numero, '')), '') is not null then
    return new;
  end if;

  -- Cada tipo de documento lleva su propia serie para que el correlativo del
  -- vale de consumo no se mezcle con el de los ingresos.
  v_tipo := case new.tipo
              when 'INGRESO'       then 'INGRESO_ALMACEN'
              when 'SALIDA_OT'     then 'SALIDA_ALMACEN'
              when 'SALIDA_MERMA'  then 'SALIDA_ALMACEN'
              when 'DEVOLUCION_OT' then 'DEVOLUCION_ALMACEN'
              when 'TRANSFERENCIA' then 'TRANSFERENCIA_ALMACEN'
              when 'AJUSTE'        then 'AJUSTE_INVENTARIO'
            end::public.tipo_correlativo;

  select sede_id into v_sede from public.almacenes where id = new.almacen_id;
  new.numero := public.siguiente_correlativo(v_tipo, null, v_sede);
  return new;
end;
$$;

create or replace function public.fn_requerimiento_numerar()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.numero is distinct from old.numero then
      raise exception 'El número del requerimiento es inmutable (% → %)', old.numero, new.numero
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if nullif(btrim(coalesce(new.numero, '')), '') is null then
    new.numero := public.siguiente_correlativo('REQUERIMIENTO', null, new.sede_id);
  end if;
  return new;
end;
$$;

create or replace function public.fn_orden_compra_numerar()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.numero is distinct from old.numero then
      raise exception 'El número de la orden de compra es inmutable (% → %)', old.numero, new.numero
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if nullif(btrim(coalesce(new.numero, '')), '') is null then
    new.numero := public.siguiente_correlativo('ORDEN_COMPRA', null, new.sede_id);
  end if;
  return new;
end;
$$;

create or replace function public.fn_recepcion_numerar()
returns trigger
language plpgsql
as $$
declare v_sede uuid;
begin
  if tg_op = 'UPDATE' then
    if new.numero is distinct from old.numero then
      raise exception 'El número de la recepción es inmutable (% → %)', old.numero, new.numero
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if nullif(btrim(coalesce(new.numero, '')), '') is null then
    select sede_id into v_sede from public.almacenes where id = new.almacen_id;
    new.numero := public.siguiente_correlativo('RECEPCION_COMPRA'::public.tipo_correlativo, null, v_sede);
  end if;
  return new;
end;
$$;

-- =============================================================================
-- INMUTABILIDAD DEL KARDEX
-- El libro de inventario permanente no se reescribe. Si el almacenero se
-- equivocó, el error queda registrado y se corrige con un movimiento de ajuste
-- que deja constancia de la corrección. Esa es la única forma de que el saldo
-- de cualquier fecha se pueda reconstruir sumando las filas del libro.
-- =============================================================================

create or replace function public.fn_kardex_inmutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'El kardex es inmutable: no admite % sobre sus filas', tg_op
    using errcode = 'restrict_violation',
          hint = 'Corrija con un movimiento de tipo AJUSTE y confírmelo con public.confirmar_movimiento_almacen().';
end;
$$;

comment on function public.fn_kardex_inmutable is
  'Bloquea UPDATE, DELETE y TRUNCATE sobre public.kardex. Es la garantía de que el inventario valorizado es auditable.';

-- =============================================================================
-- GUARDIAS DE EDICIÓN Y TRANSICIONES DE ESTADO
-- =============================================================================

-- Las líneas de un movimiento solo se tocan mientras el documento está en
-- BORRADOR; después ya escribieron el kardex.
create or replace function public.fn_movimiento_detalle_editable()
returns trigger
language plpgsql
as $$
declare
  v_estado public.estado_movimiento_almacen;
  v_tipo   public.tipo_movimiento_almacen;
  v_numero text;
begin
  select estado, tipo, numero into v_estado, v_tipo, v_numero
    from public.movimientos_almacen
   where id = coalesce(new.movimiento_id, old.movimiento_id);

  -- El movimiento ya no existe: es el borrado en cascada de un BORRADOR.
  if not found then
    return old;
  end if;

  if v_estado <> 'BORRADOR' then
    raise exception 'El movimiento % está % y sus líneas ya no se pueden modificar', v_numero, v_estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Solo el ajuste de inventario admite cantidad negativa (el faltante).
  if v_tipo <> 'AJUSTE' and new.cantidad <= 0 then
    raise exception 'La cantidad de la línea debe ser positiva en un movimiento de tipo %', v_tipo
      using errcode = 'check_violation';
  end if;

  new.costo_total := round(abs(new.cantidad) * new.costo_unitario, 2);
  return new;
end;
$$;

create or replace function public.fn_movimiento_transicion()
returns trigger
language plpgsql
as $$
begin
  if old.estado = 'CONFIRMADO' then
    raise exception 'El movimiento % ya está confirmado y es inmutable', old.numero
      using errcode = 'object_not_in_prerequisite_state',
            hint = 'Registre un movimiento contrario o un ajuste de inventario para corregirlo.';
  end if;

  if old.estado = 'ANULADO' and new.estado <> 'ANULADO' then
    raise exception 'El movimiento % está anulado y no se puede reactivar', old.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- La confirmación es la que escribe el kardex; sin ella el stock quedaría
  -- descuadrado. Por eso un UPDATE manual a CONFIRMADO se rechaza: la función
  -- marca la transacción con una variable de sesión local antes de actualizar.
  if new.estado = 'CONFIRMADO'
     and coalesce(current_setting('metalwork.mov_confirmando', true), '') <> new.id::text then
    raise exception 'El movimiento % solo se confirma con public.confirmar_movimiento_almacen(''%'')', new.numero, new.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- El detalle del requerimiento se congela al aprobarse: después solo cambian
-- las cantidades que administran las funciones (aprobada, atendida, reservada).
create or replace function public.fn_requerimiento_detalle_editable()
returns trigger
language plpgsql
as $$
declare
  v_estado public.estado_requerimiento;
  v_numero text;
begin
  select estado, numero into v_estado, v_numero
    from public.requerimientos
   where id = coalesce(new.requerimiento_id, old.requerimiento_id);

  if not found then
    return old;
  end if;

  if v_estado = 'SOLICITADO' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'El requerimiento % está % : ya no se pueden agregar ni quitar materiales', v_numero, v_estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Se comparan las filas ignorando las columnas que sí administra el sistema.
  if (to_jsonb(new) - 'cantidad_aprobada' - 'cantidad_atendida' - 'cantidad_reservada' - 'actualizado_en')
     is distinct from
     (to_jsonb(old) - 'cantidad_aprobada' - 'cantidad_atendida' - 'cantidad_reservada' - 'actualizado_en') then
    raise exception 'El requerimiento % está % : solo el almacén puede mover las cantidades aprobada, atendida y reservada', v_numero, v_estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  return new;
end;
$$;

create or replace function public.fn_requerimiento_transicion()
returns trigger
language plpgsql
as $$
begin
  if old.estado = new.estado then
    return new;
  end if;

  if old.estado in ('RECHAZADO', 'ANULADO') then
    raise exception 'El requerimiento % está % y no admite más cambios de estado', old.numero, old.estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if old.estado = 'ATENDIDO' and new.estado <> 'ANULADO' then
    raise exception 'El requerimiento % ya fue atendido', old.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if old.estado = 'SOLICITADO' and new.estado in ('ATENDIDO_PARCIAL', 'ATENDIDO') then
    raise exception 'El requerimiento % debe aprobarse antes de atenderse', old.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  return new;
end;
$$;

-- Rechazar o anular un requerimiento devuelve al stock lo que tenía reservado;
-- si no, el material quedaría comprometido para siempre.
create or replace function public.fn_requerimiento_liberar_reserva()
returns trigger
language plpgsql
as $$
begin
  if new.estado not in ('RECHAZADO', 'ANULADO', 'ATENDIDO') or new.almacen_id is null then
    return new;
  end if;

  update public.almacen_stock s
     set cantidad_reservada = greatest(s.cantidad_reservada - rd.cantidad_reservada, 0)
    from public.requerimiento_detalle rd
   where rd.requerimiento_id = new.id
     and rd.cantidad_reservada > 0
     and s.almacen_id = new.almacen_id
     and s.material_id = rd.material_id;

  update public.requerimiento_detalle
     set cantidad_reservada = 0
   where requerimiento_id = new.id
     and cantidad_reservada > 0;

  return new;
end;
$$;

-- La unidad base tiene que ser de la misma magnitud y ser ella misma una base:
-- convertir toneladas a metros no significa nada, y una cadena de conversiones
-- encadenadas haría imposible saber en qué se está midiendo el stock.
create or replace function public.fn_unidad_medida_valida_base()
returns trigger
language plpgsql
as $$
declare v_base public.unidades_medida;
begin
  if new.unidad_base_id is null then
    return new;
  end if;

  select * into v_base from public.unidades_medida where id = new.unidad_base_id;

  if v_base.magnitud <> new.magnitud then
    raise exception 'La unidad % es de magnitud % y no puede convertirse a % (magnitud %)',
      new.codigo, new.magnitud, v_base.codigo, v_base.magnitud
      using errcode = 'check_violation';
  end if;

  if v_base.unidad_base_id is not null then
    raise exception 'La unidad % no puede ser base de % porque a su vez se deriva de otra',
      v_base.codigo, new.codigo
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Una categoría no puede ser descendiente de sí misma: un ciclo en el árbol
-- colgaría cualquier consulta recursiva del catálogo.
create or replace function public.fn_categoria_material_sin_ciclos()
returns trigger
language plpgsql
as $$
declare
  v_padre uuid := new.categoria_padre_id;
  v_saltos int := 0;
begin
  while v_padre is not null loop
    if v_padre = new.id then
      raise exception 'La categoría % no puede colgar de sí misma: se formaría un ciclo en el árbol', new.codigo
        using errcode = 'check_violation';
    end if;
    v_saltos := v_saltos + 1;
    if v_saltos > 20 then
      raise exception 'El árbol de categorías supera los 20 niveles: revise la jerarquía'
        using errcode = 'check_violation';
    end if;
    select categoria_padre_id into v_padre from public.categorias_material where id = v_padre;
  end loop;
  return new;
end;
$$;

-- =============================================================================
-- MOTOR DE VALORIZACIÓN · PROMEDIO PONDERADO MÓVIL
-- -----------------------------------------------------------------------------
-- kardex_registrar() escribe UNA fila del libro y deja el saldo cuadrado. Es la
-- única puerta de entrada al kardex y solo la usa confirmar_movimiento_almacen().
--
-- Cómo se valoriza (promedio ponderado móvil por material y almacén):
--   INGRESO  saldo_valor += cantidad * costo_ingreso
--            costo_promedio = saldo_valor / saldo_cantidad   ← se recalcula
--   SALIDA   se valoriza al costo_promedio vigente, nunca al precio que
--            proponga el usuario; saldo_valor -= cantidad * costo_promedio
-- Cuando el saldo llega a cero se fuerza saldo_valor a cero para no arrastrar
-- los centavos que deja el redondeo a dos decimales.
-- =============================================================================

create or replace function public.kardex_registrar(
  p_material         uuid,
  p_almacen          uuid,
  p_tipo             public.tipo_movimiento_kardex,
  p_cantidad         public.cantidad,
  p_costo_unitario   public.monto default null,
  p_fecha            date default current_date,
  p_orden            uuid default null,
  p_etapa            uuid default null,
  p_lote             uuid default null,
  p_movimiento       uuid default null,
  p_referencia_tabla text default null,
  p_referencia_id    uuid default null,
  p_usuario          uuid default null,
  p_observaciones    text default null
)
returns public.kardex
language plpgsql
volatile
as $$
declare
  v_signo           int;
  v_material        public.materiales;
  v_almacen         public.almacenes;
  v_stock           public.almacen_stock;
  v_lote            public.lotes_material;
  v_costo           public.monto;
  v_costo_total     public.monto;
  v_cantidad_nueva  public.cantidad;
  v_valor_nuevo     public.monto;
  v_promedio        public.monto;
  v_fila            public.kardex;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad enviada al kardex debe ser positiva; el signo lo pone el tipo de movimiento (%)', p_tipo
      using errcode = 'check_violation';
  end if;

  v_signo := case when p_tipo::text like 'INGRESO%' then 1 else -1 end;

  select * into v_material from public.materiales where id = p_material;
  if not found then
    raise exception 'El material % no existe', p_material using errcode = 'no_data_found';
  end if;
  if not v_material.activo then
    raise exception 'El material % (%) está inactivo y no admite movimientos',
      v_material.codigo, v_material.descripcion using errcode = 'check_violation';
  end if;

  select * into v_almacen from public.almacenes where id = p_almacen;
  if not found then
    raise exception 'El almacén % no existe', p_almacen using errcode = 'no_data_found';
  end if;
  if not v_almacen.activo or not v_almacen.permite_movimientos then
    raise exception 'El almacén % (%) no admite movimientos', v_almacen.codigo, v_almacen.nombre
      using errcode = 'check_violation';
  end if;

  -- Primera vez que este material toca este almacén: se abre su fila de saldo.
  insert into public.almacen_stock (almacen_id, material_id)
  values (p_almacen, p_material)
  on conflict (almacen_id, material_id) do nothing;

  -- FOR UPDATE serializa dos confirmaciones simultáneas sobre el mismo saldo:
  -- sin este bloqueo dos vales podrían sacar el mismo último material.
  select * into v_stock
    from public.almacen_stock
   where almacen_id = p_almacen and material_id = p_material
   for update;

  if v_signo < 0 and v_stock.cantidad < p_cantidad then
    raise exception 'Stock insuficiente de % (%) en el almacén %: se piden % y solo hay %',
      v_material.codigo, v_material.descripcion, v_almacen.codigo,
      trim(to_char(p_cantidad, 'FM9999999990.0999')), trim(to_char(v_stock.cantidad, 'FM9999999990.0999'))
      using errcode = 'check_violation',
            hint = 'Registre el ingreso del material o corrija la cantidad del documento.';
  end if;

  -- El lote también tiene que alcanzar: una colada agotada obliga a despachar
  -- de otra, y decirlo con claridad evita que el almacenero fuerce el vale.
  if p_lote is not null then
    select * into v_lote from public.lotes_material where id = p_lote for update;

    if not found then
      raise exception 'El lote % no existe', p_lote using errcode = 'no_data_found';
    end if;

    if v_lote.material_id <> p_material then
      raise exception 'El lote % pertenece a otro material distinto de % (%)',
        v_lote.numero_lote, v_material.codigo, v_material.descripcion
        using errcode = 'check_violation';
    end if;

    if v_signo < 0 and v_lote.cantidad_disponible < p_cantidad then
      raise exception 'Saldo insuficiente del lote % (colada %) de %: se piden % y quedan %',
        v_lote.numero_lote, coalesce(v_lote.numero_colada, 's/colada'), v_material.codigo,
        trim(to_char(p_cantidad, 'FM9999999990.0999')),
        trim(to_char(v_lote.cantidad_disponible, 'FM9999999990.0999'))
        using errcode = 'check_violation',
              hint = 'Divida la salida entre los lotes disponibles del material.';
    end if;
  end if;

  if v_signo > 0 then
    -- Ingreso: manda el costo del documento; si no vino, se hereda el promedio.
    v_costo := coalesce(nullif(p_costo_unitario, 0), nullif(v_stock.costo_promedio, 0), v_material.costo_promedio, 0);
  else
    -- Salida: SIEMPRE al promedio ponderado vigente del almacén. Que el usuario
    -- no pueda elegir el costo de salida es lo que hace confiable el costo de la OT.
    v_costo := coalesce(nullif(v_stock.costo_promedio, 0), nullif(v_material.costo_promedio, 0), p_costo_unitario, 0);
  end if;

  v_costo_total    := round(p_cantidad * v_costo, 2);
  v_cantidad_nueva := v_stock.cantidad + v_signo * p_cantidad;
  v_valor_nuevo    := greatest(v_stock.saldo_valor + v_signo * v_costo_total, 0);

  -- Sin existencias no queda valor que arrastrar.
  if v_cantidad_nueva = 0 then
    v_valor_nuevo := 0;
  end if;

  v_promedio := case
                  when v_cantidad_nueva > 0 then round(v_valor_nuevo / v_cantidad_nueva, 2)
                  else v_stock.costo_promedio   -- se conserva el último costo conocido
                end;

  insert into public.kardex (
    material_id, almacen_id, lote_id, fecha, tipo_movimiento, cantidad,
    costo_unitario, costo_total, saldo_cantidad, saldo_valor, costo_promedio,
    orden_id, etapa_id, movimiento_id, referencia_tabla, referencia_id,
    observaciones, usuario_id
  ) values (
    p_material, p_almacen, p_lote, coalesce(p_fecha, current_date), p_tipo, v_signo * p_cantidad,
    v_costo, v_costo_total, v_cantidad_nueva, v_valor_nuevo, v_promedio,
    p_orden, p_etapa, p_movimiento, p_referencia_tabla, p_referencia_id,
    p_observaciones, p_usuario
  )
  returning * into v_fila;

  update public.almacen_stock
     set cantidad = v_cantidad_nueva,
         -- La reserva jamás puede superar lo que hay físicamente: si una salida
         -- deja el saldo por debajo de lo comprometido, la reserva se recorta.
         cantidad_reservada = least(cantidad_reservada, v_cantidad_nueva),
         saldo_valor = v_valor_nuevo,
         costo_promedio = v_promedio,
         fecha_ultimo_movimiento = now()
   where id = v_stock.id;

  -- Saldo del lote: es lo que permite decir de qué colada salió cada plancha.
  if p_lote is not null then
    update public.lotes_material
       set cantidad_disponible = cantidad_disponible + v_signo * p_cantidad,
           cantidad_ingresada  = cantidad_ingresada + greatest(v_signo, 0) * p_cantidad,
           almacen_id = coalesce(almacen_id, p_almacen)
     where id = p_lote;
  end if;

  -- Costo promedio consolidado del material: pondera todos sus almacenes.
  update public.materiales m
     set costo_promedio = coalesce(s.promedio, m.costo_promedio),
         ultimo_costo   = case when v_signo > 0 then v_costo else m.ultimo_costo end,
         fecha_ultimo_costo = case when v_signo > 0 then coalesce(p_fecha, current_date) else m.fecha_ultimo_costo end
    from (
      select case when sum(cantidad) > 0 then round(sum(saldo_valor) / sum(cantidad), 2) end as promedio
        from public.almacen_stock
       where material_id = p_material
    ) s
   where m.id = p_material;

  return v_fila;
end;
$$;

comment on function public.kardex_registrar is
  'Escribe una fila del kardex y deja cuadrado el saldo del almacén, el lote y el costo promedio del material. Uso interno: los documentos se confirman con public.confirmar_movimiento_almacen().';

-- =============================================================================
-- CONFIRMACIÓN DE UN MOVIMIENTO DE ALMACÉN
-- -----------------------------------------------------------------------------
-- Es la pieza central del módulo. Todo ocurre dentro de la transacción del
-- llamador: o se escribe el kardex completo, se actualiza el stock y el
-- documento queda CONFIRMADO, o no se escribe absolutamente nada.
--
-- Secuencia por cada línea:
--   1. valida el lote en el material que se controla por colada
--   2. libera la reserva del requerimiento que la línea atiende (antes de sacar
--      el material, porque la reserva nunca puede superar la existencia)
--   3. escribe el kardex valorizado (aquí falla si el stock no alcanza)
--   4. suma lo despachado al requerimiento
-- Una transferencia genera DOS filas de kardex: salida en el origen e ingreso
-- en el destino, ambas al mismo costo.
-- =============================================================================

create or replace function public.confirmar_movimiento_almacen(p_movimiento uuid)
returns public.movimientos_almacen
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_mov      public.movimientos_almacen;
  v_det      record;
  v_kardex   public.kardex;
  v_usuario  uuid := public.usuario_actual();
  v_total    public.monto := 0;
  v_lineas   int;
  v_tipo     public.tipo_movimiento_kardex;
  v_cantidad public.cantidad;
  v_reserva  public.cantidad;
  v_costo    public.monto;
begin
  -- El bloqueo del documento impide que dos usuarios lo confirmen a la vez.
  select * into v_mov from public.movimientos_almacen where id = p_movimiento for update;

  if not found then
    raise exception 'El movimiento de almacén % no existe', p_movimiento
      using errcode = 'no_data_found';
  end if;

  if v_mov.estado = 'CONFIRMADO' then
    raise exception 'El movimiento % ya fue confirmado el % y el kardex es inmutable',
      v_mov.numero, to_char(v_mov.fecha_confirmacion, 'DD/MM/YYYY HH24:MI')
      using errcode = 'object_not_in_prerequisite_state',
            hint = 'Para corregirlo registre un movimiento contrario o un ajuste de inventario.';
  end if;

  if v_mov.estado = 'ANULADO' then
    raise exception 'El movimiento % está anulado y no se puede confirmar', v_mov.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select count(*) into v_lineas
    from public.movimiento_detalle where movimiento_id = p_movimiento;

  if v_lineas = 0 then
    raise exception 'El movimiento % no tiene líneas de detalle: no hay nada que confirmar', v_mov.numero
      using errcode = 'check_violation';
  end if;

  -- El recorrido va siempre en el mismo orden (por material) para que dos
  -- confirmaciones simultáneas tomen los bloqueos de stock en igual secuencia
  -- y no se interbloqueen entre sí.
  for v_det in
    select d.*,
           m.codigo        as material_codigo,
           m.descripcion   as material_descripcion,
           m.controla_lote as material_controla_lote,
           rq.almacen_id   as req_almacen_id,
           rq.id           as req_id
      from public.movimiento_detalle d
      join public.materiales m on m.id = d.material_id
      left join public.requerimiento_detalle rd on rd.id = d.requerimiento_detalle_id
      left join public.requerimientos rq on rq.id = rd.requerimiento_id
     where d.movimiento_id = p_movimiento
     order by d.material_id
  loop
    v_cantidad := abs(v_det.cantidad);

    -- Sin lote no hay trazabilidad: el acero certificado no entra al almacén
    -- sin decir de qué colada viene.
    if v_det.material_controla_lote
       and v_det.lote_id is null
       and v_mov.tipo in ('INGRESO', 'TRANSFERENCIA') then
      raise exception 'El material % (%) se controla por lote: indique la colada antes de confirmar %',
        v_det.material_codigo, v_det.material_descripcion, v_mov.numero
        using errcode = 'check_violation';
    end if;

    -- Se libera la reserva ANTES de mover el stock, porque una existencia no
    -- puede quedar por debajo de lo que tiene comprometido.
    if v_mov.tipo = 'SALIDA_OT' and v_det.requerimiento_detalle_id is not null then
      select rd.cantidad_reservada into v_reserva
        from public.requerimiento_detalle rd
       where rd.id = v_det.requerimiento_detalle_id
       for update;

      v_reserva := least(coalesce(v_reserva, 0), v_cantidad);

      update public.requerimiento_detalle
         set cantidad_atendida  = cantidad_atendida + v_cantidad,
             cantidad_reservada = cantidad_reservada - v_reserva
       where id = v_det.requerimiento_detalle_id;

      if v_reserva > 0 and v_det.req_almacen_id is not null then
        update public.almacen_stock
           set cantidad_reservada = greatest(cantidad_reservada - v_reserva, 0)
         where almacen_id = v_det.req_almacen_id
           and material_id = v_det.material_id;
      end if;
    end if;

    if v_mov.tipo = 'TRANSFERENCIA' then
      v_kardex := public.kardex_registrar(
        v_det.material_id, v_mov.almacen_id, 'SALIDA_TRANSFERENCIA', v_cantidad, null,
        v_mov.fecha, v_mov.orden_id, v_mov.etapa_id, v_det.lote_id, v_mov.id,
        'movimientos_almacen', v_mov.id, v_usuario, v_det.observaciones);

      -- El destino recibe al costo con el que salió el origen: trasladar
      -- material entre almacenes no crea ni destruye valor.
      perform public.kardex_registrar(
        v_det.material_id, v_mov.almacen_destino_id, 'INGRESO_TRANSFERENCIA', v_cantidad,
        v_kardex.costo_unitario, v_mov.fecha, v_mov.orden_id, v_mov.etapa_id, v_det.lote_id,
        v_mov.id, 'movimientos_almacen', v_mov.id, v_usuario, v_det.observaciones);
    else
      v_tipo := (case v_mov.tipo
                   when 'INGRESO'       then 'INGRESO_COMPRA'
                   when 'DEVOLUCION_OT' then 'INGRESO_DEVOLUCION'
                   when 'SALIDA_OT'     then 'SALIDA_OT'
                   when 'SALIDA_MERMA'  then 'SALIDA_MERMA'
                   when 'AJUSTE'        then case when v_det.cantidad > 0
                                                  then 'INGRESO_AJUSTE'
                                                  else 'SALIDA_AJUSTE' end
                 end)::public.tipo_movimiento_kardex;

      -- En las salidas el costo lo pone el promedio del almacén, no el documento.
      v_costo := case when v_tipo::text like 'INGRESO%' then nullif(v_det.costo_unitario, 0) end;

      v_kardex := public.kardex_registrar(
        v_det.material_id, v_mov.almacen_id, v_tipo, v_cantidad, v_costo,
        v_mov.fecha, v_mov.orden_id, v_mov.etapa_id, v_det.lote_id, v_mov.id,
        'movimientos_almacen', v_mov.id, v_usuario, v_det.observaciones);
    end if;

    v_total := v_total + v_kardex.costo_total;

    -- El costo real con el que se valorizó queda escrito en la línea, para que
    -- el vale impreso muestre lo mismo que el kardex.
    update public.movimiento_detalle
       set costo_unitario = v_kardex.costo_unitario,
           costo_total    = v_kardex.costo_total
     where id = v_det.id;
  end loop;

  -- Estado de los requerimientos tocados por este despacho.
  if v_mov.requerimiento_id is not null then
    perform public.actualizar_estado_requerimiento(v_mov.requerimiento_id);
  end if;

  perform public.actualizar_estado_requerimiento(r.id)
     from (select distinct rq.id
             from public.movimiento_detalle d
             join public.requerimiento_detalle rd on rd.id = d.requerimiento_detalle_id
             join public.requerimientos rq on rq.id = rd.requerimiento_id
            where d.movimiento_id = p_movimiento) r;

  -- Marca de transacción que autoriza el paso a CONFIRMADO (ver fn_movimiento_transicion).
  perform set_config('metalwork.mov_confirmando', p_movimiento::text, true);

  update public.movimientos_almacen
     set estado             = 'CONFIRMADO',
         confirmado_por     = coalesce(v_usuario, responsable_id),
         fecha_confirmacion = now(),
         total_valorizado   = v_total
   where id = p_movimiento
  returning * into v_mov;

  perform set_config('metalwork.mov_confirmando', '', true);

  -- Trazabilidad en la línea de tiempo de la OT: el jefe de taller ve el
  -- material que entró y salió de su orden sin salir de la pantalla de la OT.
  if v_mov.orden_id is not null then
    perform public.ot_registrar_evento(
      v_mov.orden_id,
      'MATERIAL'::public.tipo_evento_ot,
      case v_mov.tipo
        when 'SALIDA_OT'     then 'Consumo de material según vale ' || v_mov.numero
        when 'DEVOLUCION_OT' then 'Devolución de material al almacén según ' || v_mov.numero
        else 'Movimiento de almacén ' || v_mov.numero
      end,
      jsonb_build_object(
        'movimiento_id', v_mov.id,
        'numero', v_mov.numero,
        'tipo', v_mov.tipo,
        'lineas', v_lineas,
        'total_valorizado', v_total),
      v_mov.etapa_id,
      v_usuario);
  end if;

  return v_mov;
end;
$$;

comment on function public.confirmar_movimiento_almacen is
  'Confirma un documento de almacén: valida el stock, escribe el kardex valorizado por promedio ponderado, actualiza existencias, lotes, costo promedio y requerimientos, y deja el movimiento en CONFIRMADO. Es la única vía por la que cambia el inventario.';

-- Anular solo tiene sentido antes de confirmar. Un movimiento ya confirmado se
-- corrige con otro movimiento en sentido contrario, nunca borrando la historia.
create or replace function public.anular_movimiento_almacen(
  p_movimiento uuid,
  p_motivo     text
)
returns public.movimientos_almacen
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_mov public.movimientos_almacen;
begin
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Anular un movimiento de almacén exige un motivo'
      using errcode = 'check_violation';
  end if;

  select * into v_mov from public.movimientos_almacen where id = p_movimiento for update;

  if not found then
    raise exception 'El movimiento de almacén % no existe', p_movimiento using errcode = 'no_data_found';
  end if;

  if v_mov.estado = 'CONFIRMADO' then
    raise exception 'El movimiento % está confirmado: no se anula, se corrige con un movimiento contrario', v_mov.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_mov.estado = 'ANULADO' then
    raise exception 'El movimiento % ya está anulado', v_mov.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update public.movimientos_almacen
     set estado           = 'ANULADO',
         motivo_anulacion = p_motivo,
         anulado_por      = public.usuario_actual(),
         fecha_anulacion  = now()
   where id = p_movimiento
  returning * into v_mov;

  return v_mov;
end;
$$;

-- =============================================================================
-- REQUERIMIENTOS: APROBACIÓN Y RESERVA DE STOCK
-- =============================================================================

create or replace function public.actualizar_estado_requerimiento(p_requerimiento uuid)
returns void
language plpgsql
volatile
as $$
declare
  v_estado    public.estado_requerimiento;
  v_aprobado  public.cantidad;
  v_atendido  public.cantidad;
  v_nuevo     public.estado_requerimiento;
begin
  select estado into v_estado from public.requerimientos where id = p_requerimiento for update;
  if not found or v_estado in ('SOLICITADO', 'RECHAZADO', 'ANULADO') then
    return;
  end if;

  select coalesce(sum(cantidad_aprobada), 0), coalesce(sum(cantidad_atendida), 0)
    into v_aprobado, v_atendido
    from public.requerimiento_detalle
   where requerimiento_id = p_requerimiento;

  v_nuevo := case
               when v_atendido <= 0 then 'APROBADO'
               when v_aprobado > 0 and v_atendido >= v_aprobado then 'ATENDIDO'
               else 'ATENDIDO_PARCIAL'
             end;

  if v_nuevo is distinct from v_estado then
    update public.requerimientos set estado = v_nuevo where id = p_requerimiento;
  end if;
end;
$$;

comment on function public.actualizar_estado_requerimiento is
  'Recalcula el estado del requerimiento comparando lo aprobado contra lo despachado. La llama la confirmación de cada vale de consumo.';

create or replace function public.aprobar_requerimiento(
  p_requerimiento uuid,
  p_aprobador     uuid default null
)
returns public.requerimientos
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_req      public.requerimientos;
  v_det      record;
  v_aprobada public.cantidad;
  v_reserva  public.cantidad;
begin
  select * into v_req from public.requerimientos where id = p_requerimiento for update;

  if not found then
    raise exception 'El requerimiento % no existe', p_requerimiento using errcode = 'no_data_found';
  end if;

  if v_req.estado <> 'SOLICITADO' then
    raise exception 'El requerimiento % está % : solo se aprueba lo que está SOLICITADO', v_req.numero, v_req.estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not exists (select 1 from public.requerimiento_detalle where requerimiento_id = p_requerimiento) then
    raise exception 'El requerimiento % no tiene materiales', v_req.numero using errcode = 'check_violation';
  end if;

  for v_det in
    select * from public.requerimiento_detalle
     where requerimiento_id = p_requerimiento
     order by material_id
  loop
    -- Si el almacén no recortó la cantidad, se aprueba lo solicitado.
    v_aprobada := case when v_det.cantidad_aprobada > 0
                       then v_det.cantidad_aprobada
                       else v_det.cantidad_solicitada end;
    v_reserva := 0;

    -- Se reserva solo lo que hay disponible hoy; el faltante es lo que se compra.
    if v_req.almacen_id is not null then
      insert into public.almacen_stock (almacen_id, material_id)
      values (v_req.almacen_id, v_det.material_id)
      on conflict (almacen_id, material_id) do nothing;

      select greatest(least(v_aprobada, s.cantidad - s.cantidad_reservada), 0)
        into v_reserva
        from public.almacen_stock s
       where s.almacen_id = v_req.almacen_id and s.material_id = v_det.material_id
       for update;

      if v_reserva > 0 then
        update public.almacen_stock
           set cantidad_reservada = cantidad_reservada + v_reserva
         where almacen_id = v_req.almacen_id and material_id = v_det.material_id;
      end if;
    end if;

    update public.requerimiento_detalle
       set cantidad_aprobada  = v_aprobada,
           cantidad_reservada = coalesce(v_reserva, 0)
     where id = v_det.id;
  end loop;

  update public.requerimientos
     set estado           = 'APROBADO',
         aprobador_id     = coalesce(p_aprobador, public.usuario_actual(), aprobador_id),
         fecha_aprobacion = now()
   where id = p_requerimiento
  returning * into v_req;

  if v_req.orden_id is not null then
    perform public.ot_registrar_evento(
      v_req.orden_id,
      'MATERIAL'::public.tipo_evento_ot,
      'Requerimiento de material ' || v_req.numero || ' aprobado',
      jsonb_build_object('requerimiento_id', v_req.id, 'numero', v_req.numero),
      v_req.etapa_id,
      public.usuario_actual());
  end if;

  return v_req;
end;
$$;

comment on function public.aprobar_requerimiento is
  'Aprueba el requerimiento y reserva en el almacén el stock disponible de cada línea. Lo que no alcanza a reservarse es exactamente lo que debe comprarse.';

-- =============================================================================
-- ÓRDENES DE COMPRA: TOTALES Y ESTADOS
-- =============================================================================

-- Los totales de la cabecera se calculan siempre a partir del detalle: no hay
-- forma de que la orden impresa diga un número distinto al de sus líneas.
create or replace function public.fn_oc_totales()
returns trigger
language plpgsql
as $$
declare v_subtotal public.monto;
begin
  if tg_op = 'UPDATE' then
    select coalesce(sum(subtotal), 0) into v_subtotal
      from public.orden_compra_detalle where orden_compra_id = new.id;
    new.subtotal := v_subtotal;
  end if;

  if new.descuento > new.subtotal then
    raise exception 'El descuento (%) no puede superar el subtotal (%) de la orden de compra',
      new.descuento, new.subtotal using errcode = 'check_violation';
  end if;

  new.igv   := round((new.subtotal - new.descuento) * new.igv_porcentaje / 100, 2);
  new.total := round(new.subtotal - new.descuento + new.igv, 2);
  return new;
end;
$$;

create or replace function public.fn_oc_recalcular()
returns trigger
language plpgsql
as $$
declare v_oc uuid := coalesce(new.orden_compra_id, old.orden_compra_id);
begin
  update public.ordenes_compra o
     set subtotal = coalesce((select sum(d.subtotal)
                                from public.orden_compra_detalle d
                               where d.orden_compra_id = v_oc), 0)
   where o.id = v_oc;
  return null;
end;
$$;

create or replace function public.fn_oc_detalle_editable()
returns trigger
language plpgsql
as $$
declare
  v_estado public.estado_orden_compra;
  v_numero text;
begin
  select estado, numero into v_estado, v_numero
    from public.ordenes_compra
   where id = coalesce(new.orden_compra_id, old.orden_compra_id);

  if not found then
    return old;
  end if;

  if v_estado = 'BORRADOR' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'La orden de compra % está % : ya no admite agregar ni quitar líneas', v_numero, v_estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Después de aprobada lo único que cambia en la línea es lo que va llegando.
  -- Se descartan también las columnas calculadas (subtotal y cantidad_pendiente):
  -- Postgres todavía no las ha resuelto en NEW cuando corre un trigger BEFORE.
  if (to_jsonb(new) - 'cantidad_recibida' - 'cantidad_pendiente' - 'subtotal' - 'actualizado_en')
     is distinct from
     (to_jsonb(old) - 'cantidad_recibida' - 'cantidad_pendiente' - 'subtotal' - 'actualizado_en') then
    raise exception 'La orden de compra % está % : solo las recepciones pueden modificar sus líneas', v_numero, v_estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  return new;
end;
$$;

create or replace function public.fn_oc_transicion()
returns trigger
language plpgsql
as $$
begin
  if old.estado = new.estado then
    return new;
  end if;

  if old.estado in ('RECIBIDA', 'ANULADA') then
    raise exception 'La orden de compra % está % y no admite más cambios de estado', old.numero, old.estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if new.estado in ('RECIBIDA_PARCIAL', 'RECIBIDA') and old.estado = 'BORRADOR' then
    raise exception 'La orden de compra % debe aprobarse antes de recibirse', old.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Anular una compra que ya ingresó al almacén dejaría el kardex huérfano.
  if new.estado = 'ANULADA'
     and exists (select 1 from public.recepciones r
                  where r.orden_compra_id = old.id and r.estado = 'CONFIRMADO') then
    raise exception 'La orden de compra % tiene recepciones confirmadas: no se puede anular', old.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if new.estado = 'APROBADA' then
    new.aprobada_por     := coalesce(new.aprobada_por, public.usuario_actual());
    new.fecha_aprobacion := coalesce(new.fecha_aprobacion, now());
  end if;

  if new.estado = 'ENVIADA' then
    new.fecha_envio := coalesce(new.fecha_envio, now());
  end if;

  return new;
end;
$$;

-- =============================================================================
-- RECEPCIONES: GUARDIAS Y CONFIRMACIÓN
-- =============================================================================

create or replace function public.fn_recepcion_detalle_editable()
returns trigger
language plpgsql
as $$
declare
  v_estado public.estado_movimiento_almacen;
  v_numero text;
begin
  select estado, numero into v_estado, v_numero
    from public.recepciones
   where id = coalesce(new.recepcion_id, old.recepcion_id);

  if not found then
    return old;
  end if;

  if v_estado <> 'BORRADOR' then
    raise exception 'La recepción % está % y sus líneas ya no se pueden modificar', v_numero, v_estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.fn_recepcion_transicion()
returns trigger
language plpgsql
as $$
begin
  if old.estado = 'CONFIRMADO' then
    raise exception 'La recepción % ya está confirmada y generó el ingreso al almacén', old.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if old.estado = 'ANULADO' and new.estado <> 'ANULADO' then
    raise exception 'La recepción % está anulada', old.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if new.estado = 'CONFIRMADO'
     and coalesce(current_setting('metalwork.rec_confirmando', true), '') <> new.id::text then
    raise exception 'La recepción % solo se confirma con public.confirmar_recepcion(''%'')', new.numero, new.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Una recepción solo se abre contra una orden de compra viva: si la OC está en
-- BORRADOR todavía no se pidió nada, y si está RECIBIDA o ANULADA ya se cerró.
create or replace function public.fn_recepcion_valida_oc()
returns trigger
language plpgsql
as $$
declare
  v_estado public.estado_orden_compra;
  v_numero text;
begin
  select estado, numero into v_estado, v_numero
    from public.ordenes_compra where id = new.orden_compra_id;

  if v_estado not in ('APROBADA', 'ENVIADA', 'RECIBIDA_PARCIAL') then
    raise exception 'La orden de compra % está % : no admite nuevas recepciones', v_numero, v_estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Confirmación de la recepción: es el puente entre la compra y el almacén.
-- Crea el movimiento de ingreso, abre los lotes del material certificado,
-- convierte el costo a moneda base y deja que confirmar_movimiento_almacen()
-- haga la valorización. Todo en la misma transacción.
-- -----------------------------------------------------------------------------
create or replace function public.confirmar_recepcion(p_recepcion uuid)
returns public.recepciones
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_rec      public.recepciones;
  v_oc       public.ordenes_compra;
  v_det      record;
  v_mov_id   uuid;
  v_lote_id  uuid;
  v_costo    public.monto;
  v_tc       numeric(10, 4);
  v_usuario  uuid := public.usuario_actual();
begin
  select * into v_rec from public.recepciones where id = p_recepcion for update;

  if not found then
    raise exception 'La recepción % no existe', p_recepcion using errcode = 'no_data_found';
  end if;

  if v_rec.estado = 'CONFIRMADO' then
    raise exception 'La recepción % ya fue confirmada', v_rec.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_rec.estado = 'ANULADO' then
    raise exception 'La recepción % está anulada', v_rec.numero
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  select * into v_oc from public.ordenes_compra where id = v_rec.orden_compra_id for update;

  if v_oc.estado not in ('APROBADA', 'ENVIADA', 'RECIBIDA_PARCIAL') then
    raise exception 'La orden de compra % está % : no se puede recibir', v_oc.numero, v_oc.estado
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not exists (select 1 from public.recepcion_detalle
                  where recepcion_id = p_recepcion and cantidad_recibida > 0) then
    raise exception 'La recepción % no tiene cantidades por ingresar', v_rec.numero
      using errcode = 'check_violation';
  end if;

  -- El kardex se lleva en moneda base: una compra en dólares se convierte con
  -- el tipo de cambio pactado en la orden.
  v_tc := case when v_oc.moneda = 'USD' then v_oc.tipo_cambio else 1 end;

  insert into public.movimientos_almacen (
    tipo, fecha, almacen_id, orden_id, proveedor_id, documento_referencia,
    referencia_tabla, referencia_id, motivo, responsable_id, creado_por
  ) values (
    'INGRESO', v_rec.fecha, v_rec.almacen_id, v_oc.orden_id, v_oc.proveedor_id,
    coalesce(v_rec.numero_guia, v_rec.numero_factura),
    'recepciones', v_rec.id,
    'Ingreso por recepción ' || v_rec.numero || ' de la orden de compra ' || v_oc.numero,
    v_rec.recibido_por, v_rec.creado_por
  )
  returning id into v_mov_id;

  for v_det in
    select rd.*,
           m.codigo        as material_codigo,
           m.controla_lote as material_controla_lote,
           ocd.precio_unitario,
           ocd.descuento_porcentaje
      from public.recepcion_detalle rd
      join public.materiales m on m.id = rd.material_id
      join public.orden_compra_detalle ocd on ocd.id = rd.orden_compra_detalle_id
     where rd.recepcion_id = p_recepcion
       and rd.cantidad_recibida > 0
     order by rd.material_id
  loop
    -- Costo real de ingreso: el de la recepción si el almacenero lo corrigió,
    -- si no el de la orden con su descuento, siempre llevado a moneda base.
    v_costo := round(
      coalesce(nullif(v_det.costo_unitario, 0),
               v_det.precio_unitario * (1 - v_det.descuento_porcentaje / 100)) * v_tc, 2);

    v_lote_id := null;

    -- Material certificado: se abre el lote con su colada. El saldo del lote lo
    -- llena el kardex al confirmar el movimiento, no este INSERT.
    if v_det.material_controla_lote then
      insert into public.lotes_material (
        material_id, numero_lote, numero_colada, certificado_calidad, proveedor_id,
        orden_compra_id, recepcion_id, almacen_id, fecha_ingreso, fecha_vencimiento,
        costo_unitario, creado_por
      ) values (
        v_det.material_id,
        coalesce(nullif(btrim(coalesce(v_det.numero_lote, '')), ''),
                 v_rec.numero || '-' || v_det.material_codigo),
        v_det.numero_colada, v_det.certificado_calidad, v_oc.proveedor_id,
        v_oc.id, v_rec.id, v_rec.almacen_id, v_rec.fecha, v_det.fecha_vencimiento,
        v_costo, v_rec.creado_por
      )
      returning id into v_lote_id;
    end if;

    insert into public.movimiento_detalle (
      movimiento_id, material_id, lote_id, cantidad, costo_unitario, observaciones
    ) values (
      v_mov_id, v_det.material_id, v_lote_id, v_det.cantidad_recibida, v_costo,
      v_det.observaciones
    );

    update public.orden_compra_detalle
       set cantidad_recibida = cantidad_recibida + v_det.cantidad_recibida
     where id = v_det.orden_compra_detalle_id;
  end loop;

  -- Aquí se escribe el kardex valorizado y se actualiza el stock.
  perform public.confirmar_movimiento_almacen(v_mov_id);

  -- Mientras quede algo por llegar la orden sigue parcialmente recibida.
  update public.ordenes_compra
     set estado = (case
                     when exists (select 1 from public.orden_compra_detalle d
                                   where d.orden_compra_id = v_oc.id
                                     and d.cantidad_recibida < d.cantidad)
                     then 'RECIBIDA_PARCIAL'
                     else 'RECIBIDA'
                   end)::public.estado_orden_compra
   where id = v_oc.id;

  perform set_config('metalwork.rec_confirmando', p_recepcion::text, true);

  update public.recepciones
     set estado             = 'CONFIRMADO',
         movimiento_id      = v_mov_id,
         confirmado_por     = coalesce(v_usuario, recibido_por),
         fecha_confirmacion = now()
   where id = p_recepcion
  returning * into v_rec;

  perform set_config('metalwork.rec_confirmando', '', true);

  return v_rec;
end;
$$;

comment on function public.confirmar_recepcion is
  'Confirma la llegada de una orden de compra: genera el movimiento de ingreso, crea los lotes con su colada, valoriza en moneda base, actualiza lo recibido en la OC y su estado.';

-- =============================================================================
-- VISTAS DE CONSULTA
-- =============================================================================

-- Existencias vigentes con su valorización y la alerta de reposición. Es la
-- pantalla de stock del almacenero y la fuente del reporte de inventario.
create view public.v_stock_actual as
select
  s.id                     as stock_id,
  m.id                     as material_id,
  m.codigo                 as material_codigo,
  m.descripcion            as material_descripcion,
  m.especificacion_tecnica,
  c.nombre                 as categoria,
  um.codigo                as unidad_medida,
  a.id                     as almacen_id,
  a.codigo                 as almacen_codigo,
  a.nombre                 as almacen_nombre,
  a.tipo                   as almacen_tipo,
  a.sede_id,
  s.ubicacion,
  s.cantidad,
  s.cantidad_reservada,
  s.cantidad_disponible,
  s.costo_promedio,
  s.saldo_valor            as valorizado,
  m.stock_minimo,
  m.stock_maximo,
  m.punto_reposicion,
  m.es_critico,
  m.controla_lote,
  s.fecha_ultimo_movimiento,
  -- Bajo el mínimo: el taller se queda sin material antes de lo aceptable.
  (m.stock_minimo > 0 and s.cantidad < m.stock_minimo)                as bajo_minimo,
  -- Toca comprar: lo libre ya cayó al punto de reposición.
  (m.punto_reposicion > 0 and s.cantidad_disponible <= m.punto_reposicion) as requiere_reposicion
from public.almacen_stock s
join public.materiales m on m.id = s.material_id
join public.almacenes a on a.id = s.almacen_id
join public.categorias_material c on c.id = m.categoria_id
join public.unidades_medida um on um.id = m.unidad_medida_id
where m.activo and a.activo;

comment on view public.v_stock_actual is
  'Existencia, disponibilidad y valorización por material y almacén, con las banderas de stock mínimo y punto de reposición. Solo lista materiales que alguna vez tuvieron movimiento en el almacén.';

-- Material realmente consumido por cada OT, neto de devoluciones. Es la entrada
-- de material directo al costeo real de la carrocería (módulo de costos).
create view public.v_materiales_por_ot as
select
  k.orden_id,
  ot.numero                                as orden_numero,
  count(distinct k.material_id)            as materiales_distintos,
  count(*)                                 as movimientos,
  -- Las salidas llevan costo positivo y las devoluciones lo restan: el neto es
  -- el material que realmente se quedó en la carrocería.
  sum(case when k.cantidad < 0 then k.costo_total else -k.costo_total end) as costo_material,
  min(k.fecha)                             as primer_consumo,
  max(k.fecha)                             as ultimo_consumo
from public.kardex k
join public.ordenes_trabajo ot on ot.id = k.orden_id
where k.orden_id is not null
group by k.orden_id, ot.numero;

comment on view public.v_materiales_por_ot is
  'Consumo de material valorizado por orden de trabajo, neto de devoluciones al almacén. Es el insumo de material directo del costeo real de la OT.';

-- Trazabilidad del acero: qué colada, de qué proveedor, terminó en qué carrocería.
create view public.v_trazabilidad_lotes as
select
  l.id                as lote_id,
  l.numero_lote,
  l.numero_colada,
  l.certificado_calidad,
  m.codigo            as material_codigo,
  m.descripcion       as material_descripcion,
  p.razon_social      as proveedor,
  l.fecha_ingreso,
  k.orden_id,
  ot.numero           as orden_numero,
  ot.descripcion      as orden_descripcion,
  cl.razon_social     as cliente,
  u.placa,
  k.fecha             as fecha_consumo,
  -k.cantidad         as cantidad_consumida,
  k.costo_total
from public.kardex k
join public.lotes_material l on l.id = k.lote_id
join public.materiales m on m.id = l.material_id
left join public.proveedores p on p.id = l.proveedor_id
join public.ordenes_trabajo ot on ot.id = k.orden_id
join public.clientes cl on cl.id = ot.cliente_id
left join public.unidades u on u.id = ot.unidad_id
where k.tipo_movimiento = 'SALIDA_OT';

comment on view public.v_trazabilidad_lotes is
  'Responde la pregunta de trazabilidad del negocio: de qué colada y de qué proveedor salió el acero que se usó en la carrocería de cada unidad.';

-- Seguimiento de compras: lo que está pedido y todavía no llega.
create view public.v_ordenes_compra_pendientes as
select
  oc.id                as orden_compra_id,
  oc.numero,
  oc.estado,
  oc.fecha,
  oc.fecha_entrega_esperada,
  p.razon_social       as proveedor,
  oc.moneda,
  oc.total,
  sum(d.cantidad)              as cantidad_pedida,
  sum(d.cantidad_recibida)     as cantidad_recibida,
  sum(d.cantidad_pendiente)    as cantidad_pendiente,
  -- Días de atraso contra la fecha comprometida por el proveedor.
  case when oc.fecha_entrega_esperada is not null and oc.fecha_entrega_esperada < current_date
       then current_date - oc.fecha_entrega_esperada else 0 end as dias_atraso
from public.ordenes_compra oc
join public.proveedores p on p.id = oc.proveedor_id
join public.orden_compra_detalle d on d.orden_compra_id = oc.id
where oc.estado in ('APROBADA', 'ENVIADA', 'RECIBIDA_PARCIAL')
group by oc.id, oc.numero, oc.estado, oc.fecha, oc.fecha_entrega_esperada,
         p.razon_social, oc.moneda, oc.total;

comment on view public.v_ordenes_compra_pendientes is
  'Órdenes de compra colocadas y no cerradas, con lo pendiente de llegar y los días de atraso del proveedor.';

-- =============================================================================
-- TRIGGERS DEL MÓDULO
-- =============================================================================

-- Kardex: inmutable ante cualquier intento de reescribir la historia.
create trigger trg_kardex_inmutable
  before update or delete on public.kardex
  for each row execute function public.fn_kardex_inmutable();

create trigger trg_kardex_no_truncate
  before truncate on public.kardex
  for each statement execute function public.fn_kardex_inmutable();

-- Numeración de documentos.
create trigger trg_mov_numerar
  before insert or update on public.movimientos_almacen
  for each row execute function public.fn_movimiento_numerar();

create trigger trg_req_numerar
  before insert or update on public.requerimientos
  for each row execute function public.fn_requerimiento_numerar();

create trigger trg_oc_numerar
  before insert or update on public.ordenes_compra
  for each row execute function public.fn_orden_compra_numerar();

create trigger trg_recepcion_numerar
  before insert or update on public.recepciones
  for each row execute function public.fn_recepcion_numerar();

-- Estados y edición.
create trigger trg_mov_transicion
  before update on public.movimientos_almacen
  for each row execute function public.fn_movimiento_transicion();

create trigger trg_mov_detalle_editable
  before insert or update or delete on public.movimiento_detalle
  for each row execute function public.fn_movimiento_detalle_editable();

create trigger trg_req_transicion
  before update on public.requerimientos
  for each row execute function public.fn_requerimiento_transicion();

create trigger trg_req_liberar_reserva
  after update of estado on public.requerimientos
  for each row execute function public.fn_requerimiento_liberar_reserva();

create trigger trg_req_detalle_editable
  before insert or update or delete on public.requerimiento_detalle
  for each row execute function public.fn_requerimiento_detalle_editable();

create trigger trg_oc_totales
  before insert or update on public.ordenes_compra
  for each row execute function public.fn_oc_totales();

create trigger trg_oc_transicion
  before update on public.ordenes_compra
  for each row execute function public.fn_oc_transicion();

create trigger trg_oc_detalle_editable
  before insert or update or delete on public.orden_compra_detalle
  for each row execute function public.fn_oc_detalle_editable();

create trigger trg_oc_detalle_recalcular
  after insert or update or delete on public.orden_compra_detalle
  for each row execute function public.fn_oc_recalcular();

create trigger trg_recepcion_valida_oc
  before insert on public.recepciones
  for each row execute function public.fn_recepcion_valida_oc();

create trigger trg_recepcion_transicion
  before update on public.recepciones
  for each row execute function public.fn_recepcion_transicion();

create trigger trg_recepcion_detalle_editable
  before insert or update or delete on public.recepcion_detalle
  for each row execute function public.fn_recepcion_detalle_editable();

create trigger trg_unidad_medida_base
  before insert or update of unidad_base_id, magnitud on public.unidades_medida
  for each row execute function public.fn_unidad_medida_valida_base();

create trigger trg_categoria_material_ciclos
  before insert or update of categoria_padre_id on public.categorias_material
  for each row execute function public.fn_categoria_material_sin_ciclos();

-- =============================================================================
-- TIMESTAMPS Y AUDITORÍA
-- -----------------------------------------------------------------------------
-- La auditoría se instala sobre los documentos y sus detalles: es lo que la
-- empresa debe poder rastrear. Quedan deliberadamente fuera:
--   · kardex        ya es por definición la traza del inventario, y además es
--                   inmutable: auditarlo sería duplicar cada fila.
--   · almacen_stock su historia completa está en el kardex.
--   · materiales    el costo promedio cambia en cada movimiento; auditarlo
--                   inundaría audit_log con ruido de cálculo.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'unidades_medida', 'categorias_material', 'materiales', 'almacenes', 'almacen_stock',
    'lotes_material', 'movimientos_almacen', 'movimiento_detalle', 'requerimientos',
    'requerimiento_detalle', 'proveedores', 'proveedor_materiales', 'ordenes_compra',
    'orden_compra_detalle', 'recepciones', 'recepcion_detalle'
  ] loop
    perform public.activar_timestamps(t);
  end loop;

  foreach t in array array[
    'lotes_material', 'movimientos_almacen', 'movimiento_detalle', 'requerimientos',
    'requerimiento_detalle', 'ordenes_compra', 'orden_compra_detalle',
    'recepciones', 'recepcion_detalle', 'proveedores'
  ] loop
    perform public.activar_auditoria(t);
  end loop;
end;
$$;
