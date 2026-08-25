-- =============================================================================
-- 0002 · DOMINIO COMERCIAL
-- Metal-Work · Gestión de órdenes de trabajo para fabricación de carrocerías
-- -----------------------------------------------------------------------------
-- Cubre el ciclo previo a la producción:
--   · clientes y sus contactos
--   · tipos de carrocería (catálogo del negocio, con estándares de referencia)
--   · unidades: el vehículo del cliente sobre el que se fabrica o repara
--   · cotizaciones y sus partidas, con totales calculados por la base de datos
--
-- Depende de 0001_nucleo: dominios, moneda, empresa, sedes, usuarios,
-- siguiente_correlativo(), activar_timestamps() y activar_auditoria().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums propios del dominio comercial
-- -----------------------------------------------------------------------------

-- Documento de identidad del cliente. Se necesita el tipo además del número
-- porque el taller factura tanto a transportistas persona jurídica (RUC) como a
-- propietarios persona natural (DNI) y a extranjeros con CE o pasaporte.
create type public.tipo_documento_cliente as enum ('RUC', 'DNI', 'CE', 'PASAPORTE');

create type public.tipo_vehiculo as enum (
  'VOLQUETE',
  'TRACTO',
  'SEMIRREMOLQUE',
  'CAMION',
  'REMOLQUE',
  'FURGON',
  'OTRO'
);

create type public.estado_cotizacion as enum (
  'BORRADOR',
  'ENVIADA',
  'APROBADA',
  'RECHAZADA',
  'VENCIDA',
  'ANULADA'
);

-- Naturaleza del costo de cada partida. Permite arrastrar la cotización
-- aprobada al presupuesto de la orden de trabajo (0005) sin reclasificar a mano.
-- Se nombra "..._partida" para no colisionar con el enum de costos de 0005.
create type public.tipo_costo_partida as enum ('MATERIAL', 'MANO_OBRA', 'SERVICIO', 'OTRO');

-- =============================================================================
-- CLIENTES
-- =============================================================================

create table public.clientes (
  id                    uuid primary key default gen_random_uuid(),
  tipo_documento        public.tipo_documento_cliente not null default 'RUC',
  numero_documento      text not null,
  razon_social          text not null,
  nombre_comercial      text,
  direccion_fiscal      text,
  distrito              text,
  provincia             text,
  departamento          text,
  telefono              text,
  correo                public.email,
  web                   text,
  -- Días de crédito por defecto que se proponen al emitir una cotización.
  -- 0 significa pago contra entrega.
  condicion_pago_dias   int not null default 0 check (condicion_pago_dias >= 0),
  linea_credito         public.monto not null default 0 check (linea_credito >= 0),
  moneda_preferida      public.moneda not null default 'PEN',
  -- Detracción SUNAT: el cliente retiene un porcentaje del pago y lo deposita
  -- en la cuenta de detracciones de la empresa. Aplica sobre todo a la
  -- fabricación por encargo y al mantenimiento/reparación de bienes muebles.
  retiene_detraccion    boolean not null default false,
  porcentaje_detraccion public.porcentaje not null default 12,
  vendedor_id           uuid references public.usuarios(id) on delete set null,
  observaciones         text,
  activo                boolean not null default true,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  creado_por            uuid references public.usuarios(id) on delete set null,

  -- Un mismo número puede existir como DNI y como RUC de personas distintas,
  -- por eso la unicidad es por (tipo, número) y no solo por el número.
  constraint uq_clientes_documento unique (tipo_documento, numero_documento),

  -- Formato del documento según su tipo. Se replica aquí porque la columna es
  -- text: no puede llevar a la vez los dominios public.ruc y public.dni.
  -- En el RUC peruano el prefijo 20 identifica a la persona jurídica y el 10 a
  -- la persona natural con negocio; no se valida el dígito verificador.
  constraint chk_clientes_documento check (
    case tipo_documento
      when 'RUC' then numero_documento ~ '^[0-9]{11}$'
      when 'DNI' then numero_documento ~ '^[0-9]{8}$'
      else char_length(numero_documento) between 6 and 20
    end
  ),

  constraint chk_clientes_detraccion check (
    not retiene_detraccion or porcentaje_detraccion > 0
  )
);

comment on table public.clientes is
  'Empresas de transporte y propietarios que encargan la fabricación o reparación de carrocerías.';
comment on column public.clientes.numero_documento is
  'RUC de 11 dígitos, DNI de 8, o documento extranjero. El formato se valida según tipo_documento.';
comment on column public.clientes.condicion_pago_dias is
  'Días de crédito por defecto; se copia a la cotización como propuesta inicial.';
comment on column public.clientes.linea_credito is
  'Tope de deuda autorizado al cliente. Informativo en este módulo; lo consume el control de cobranzas.';
comment on column public.clientes.retiene_detraccion is
  'Verdadero si el cliente aplica detracción SUNAT al pagar las facturas del taller.';
comment on column public.clientes.vendedor_id is
  'Ejecutivo comercial responsable de la cuenta. Se usa como vendedor por defecto de sus cotizaciones.';

create index idx_clientes_vendedor on public.clientes(vendedor_id);
create index idx_clientes_creado_por on public.clientes(creado_por);
create index idx_clientes_documento on public.clientes(numero_documento);
create index idx_clientes_activo on public.clientes(activo) where activo;

-- Búsqueda parcial por nombre desde el buscador de la aplicación
-- ("transportes hua" debe encontrar "TRANSPORTES HUANCAYO SAC").
create index idx_clientes_razon_social_trgm
  on public.clientes using gin (razon_social gin_trgm_ops);
create index idx_clientes_nombre_comercial_trgm
  on public.clientes using gin (nombre_comercial gin_trgm_ops);

-- =============================================================================
-- CONTACTOS DEL CLIENTE
-- =============================================================================

create table public.contactos_cliente (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  nombre         text not null,
  cargo          text,
  telefono       text,
  correo         public.email,
  -- El contacto principal es el destinatario por defecto de la cotización.
  es_principal   boolean not null default false,
  observaciones  text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.contactos_cliente is
  'Personas de contacto dentro del cliente: jefe de flota, logística, gerencia.';

create index idx_contactos_cliente on public.contactos_cliente(cliente_id);

-- Como máximo un contacto principal por cliente.
create unique index uq_contacto_principal_por_cliente
  on public.contactos_cliente(cliente_id) where es_principal;

-- =============================================================================
-- TIPOS DE CARROCERÍA
-- =============================================================================

create table public.tipos_carroceria (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text not null unique,
  nombre                text not null,
  descripcion           text,
  -- Estándares de referencia que el presupuestador usa como punto de partida
  -- antes de detallar las partidas. No son un compromiso, son una guía.
  horas_hombre_estandar numeric(10, 2) not null default 0 check (horas_hombre_estandar >= 0),
  peso_estimado_kg      numeric(12, 2) not null default 0 check (peso_estimado_kg >= 0),
  -- Referencia comercial rápida para el vendedor en campo.
  precio_referencial    public.monto not null default 0 check (precio_referencial >= 0),
  moneda_referencial    public.moneda not null default 'PEN',
  orden_secuencia       int not null default 0,
  activo                boolean not null default true,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now()
);

comment on table public.tipos_carroceria is
  'Catálogo de carrocerías que el taller fabrica o repotencia: TOLVA_VOLQUETE, PLATAFORMA, FURGON, CISTERNA, BARANDA, CAMA_BAJA, PORTACONTENEDOR, TANQUE, REPOTENCIACION.';
comment on column public.tipos_carroceria.horas_hombre_estandar is
  'Horas-hombre estimadas de fabricación. Sirve de base al presupuesto y a la programación de la OT.';
comment on column public.tipos_carroceria.peso_estimado_kg is
  'Peso estimado de la carrocería terminada; referencia para calcular el acero a comprar.';

create index idx_tipos_carroceria_activo on public.tipos_carroceria(activo) where activo;

-- =============================================================================
-- UNIDADES (VEHÍCULOS DEL CLIENTE)
-- =============================================================================

create table public.unidades (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references public.clientes(id) on delete restrict,
  placa                public.placa not null,
  tipo_vehiculo        public.tipo_vehiculo not null default 'VOLQUETE',
  marca                text,
  modelo               text,
  anio                 int check (anio between 1950 and 2100),
  numero_chasis        text,
  numero_motor         text,
  color                text,
  -- Capacidad de la tolva o el tanque; se usa al dimensionar el trabajo.
  capacidad_m3         numeric(10, 2) check (capacidad_m3 >= 0),
  capacidad_toneladas  numeric(10, 2) check (capacidad_toneladas >= 0),
  tipo_carroceria_id   uuid references public.tipos_carroceria(id) on delete restrict,
  observaciones        text,
  activo               boolean not null default true,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  creado_por           uuid references public.usuarios(id) on delete set null,

  -- DECISIÓN DE DISEÑO: la placa NO es única por sí sola.
  -- Un tracto o un semirremolque cambia de propietario y vuelve al taller años
  -- después con otro dueño. Si la placa fuese única global, el nuevo cliente no
  -- podría registrar su unidad sin borrar o reasignar el historial del anterior,
  -- y se perdería la trazabilidad de las OT ya ejecutadas. Por eso la unicidad
  -- es (cliente_id, placa): cada dueño tiene su propia ficha de la unidad y
  -- cada ficha conserva las órdenes de trabajo que se le hicieron.
  constraint uq_unidades_cliente_placa unique (cliente_id, placa),

  -- Necesaria para la FK compuesta de cotizaciones: garantiza que la unidad
  -- citada en un documento pertenece al cliente de ese documento.
  constraint uq_unidades_id_cliente unique (id, cliente_id)
);

comment on table public.unidades is
  'Vehículo del cliente sobre el que se fabrica, repara o repotencia la carrocería.';
comment on column public.unidades.placa is
  'Placa de rodaje en mayúsculas. Única por cliente, no a nivel global: ver la decisión documentada en la tabla.';
comment on column public.unidades.tipo_carroceria_id is
  'Carrocería que la unidad tiene actualmente. Cambia cuando el taller le instala una distinta.';
comment on column public.unidades.numero_chasis is
  'VIN o número de chasis. Se registra para las actas de conformidad y los trámites ante la certificadora.';

create index idx_unidades_cliente on public.unidades(cliente_id);
create index idx_unidades_tipo_carroceria on public.unidades(tipo_carroceria_id);
create index idx_unidades_creado_por on public.unidades(creado_por);
create index idx_unidades_placa on public.unidades(placa);
-- Búsqueda parcial de placa: el usuario suele recordar solo tres caracteres.
create index idx_unidades_placa_trgm
  on public.unidades using gin ((placa::text) gin_trgm_ops);

-- =============================================================================
-- COTIZACIONES
-- =============================================================================

create table public.cotizaciones (
  id                  uuid primary key default gen_random_uuid(),
  numero              text not null unique,
  cliente_id          uuid not null references public.clientes(id) on delete restrict,
  unidad_id           uuid references public.unidades(id) on delete restrict,
  tipo_carroceria_id  uuid references public.tipos_carroceria(id) on delete restrict,
  contacto_id         uuid references public.contactos_cliente(id) on delete set null,
  sede_id             uuid references public.sedes(id) on delete restrict,
  fecha_emision       date not null default current_date,
  validez_dias        int not null default 15 check (validez_dias > 0),
  -- Fecha hasta la que el precio se respeta; la calcula la base de datos.
  fecha_vencimiento   date generated always as (fecha_emision + validez_dias) stored,
  moneda              public.moneda not null default 'PEN',
  -- Tipo de cambio congelado al emitir. Si no se indica se toma el vigente.
  tipo_cambio         numeric(10, 4) not null check (tipo_cambio > 0),
  estado              public.estado_cotizacion not null default 'BORRADOR',

  -- Totales calculados por trigger a partir de las partidas. No se confía en
  -- lo que envíe la aplicación.
  subtotal            public.monto not null default 0 check (subtotal >= 0),
  descuento           public.monto not null default 0 check (descuento >= 0),
  -- Porcentaje de IGV congelado al emitir, tomado de public.empresa. Se guarda
  -- en el documento para que una cotización antigua siga cuadrando si la tasa
  -- legal cambia.
  igv_porcentaje      public.porcentaje not null,
  igv                 public.monto not null default 0 check (igv >= 0),
  total               public.monto not null default 0 check (total >= 0),

  plazo_entrega_dias  int check (plazo_entrega_dias >= 0),
  forma_pago          text,
  condiciones         text,
  observaciones       text,
  motivo_rechazo      text,
  fecha_aprobacion    timestamptz,
  aprobada_por        uuid references public.usuarios(id) on delete set null,
  vendedor_id         uuid references public.usuarios(id) on delete set null,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  creado_por          uuid references public.usuarios(id) on delete set null,

  -- La unidad cotizada debe pertenecer al cliente cotizado. Se resuelve con una
  -- FK compuesta en lugar de un trigger: es declarativo y no se puede evadir.
  -- Con unidad_id nulo (cotización de una carrocería aún sin vehículo asignado)
  -- la FK no se evalúa.
  constraint fk_cotizaciones_unidad_del_cliente
    foreign key (unidad_id, cliente_id)
    references public.unidades(id, cliente_id) on delete restrict,

  -- Un rechazo sin motivo no sirve para nada al análisis comercial posterior.
  constraint chk_cotizaciones_motivo_rechazo check (
    estado <> 'RECHAZADA' or nullif(btrim(coalesce(motivo_rechazo, '')), '') is not null
  ),
  constraint chk_cotizaciones_descuento check (descuento <= subtotal)
);

comment on table public.cotizaciones is
  'Propuesta económica al cliente. Aprobada, es el origen de la orden de trabajo y de su presupuesto.';
comment on column public.cotizaciones.numero is
  'Correlativo del tipo COTIZACION. Lo asigna un trigger si la aplicación no lo envía.';
comment on column public.cotizaciones.tipo_cambio is
  'Tipo de cambio venta congelado a la fecha de emisión; permite comparar en soles cotizaciones en dólares.';
comment on column public.cotizaciones.subtotal is
  'Suma de los subtotales de las partidas. Recalculado por trigger; cualquier valor enviado se descarta.';
comment on column public.cotizaciones.descuento is
  'Descuento global sobre el subtotal, adicional a los descuentos por partida. Nunca puede superar el subtotal.';
comment on column public.cotizaciones.plazo_entrega_dias is
  'Días calendario ofrecidos para entregar la unidad terminada, contados desde el inicio de la OT.';

create index idx_cotizaciones_cliente on public.cotizaciones(cliente_id);
create index idx_cotizaciones_unidad on public.cotizaciones(unidad_id);
create index idx_cotizaciones_tipo_carroceria on public.cotizaciones(tipo_carroceria_id);
create index idx_cotizaciones_contacto on public.cotizaciones(contacto_id);
create index idx_cotizaciones_sede on public.cotizaciones(sede_id);
create index idx_cotizaciones_vendedor on public.cotizaciones(vendedor_id);
create index idx_cotizaciones_aprobada_por on public.cotizaciones(aprobada_por);
create index idx_cotizaciones_creado_por on public.cotizaciones(creado_por);
create index idx_cotizaciones_estado_fecha on public.cotizaciones(estado, fecha_emision desc);
create index idx_cotizaciones_fecha_emision on public.cotizaciones(fecha_emision desc);
-- Soporta el barrido diario que marca como vencidas las cotizaciones sin respuesta.
create index idx_cotizaciones_vencimiento on public.cotizaciones(fecha_vencimiento)
  where estado = 'ENVIADA';

-- =============================================================================
-- PARTIDAS DE LA COTIZACIÓN
-- =============================================================================

create table public.cotizacion_partidas (
  id                   uuid primary key default gen_random_uuid(),
  cotizacion_id        uuid not null references public.cotizaciones(id) on delete cascade,
  orden_secuencia      int not null,
  descripcion          text not null,
  detalle              text,
  -- Unidad de medida escrita en el documento (UND, KG, M, M2, GLB, SERV).
  -- Es texto libre a propósito: la cotización se emite antes de que el material
  -- exista en el maestro del almacén.
  unidad_medida        text not null default 'UND',
  cantidad             public.cantidad not null check (cantidad > 0),
  precio_unitario      public.monto not null check (precio_unitario >= 0),
  descuento_porcentaje public.porcentaje not null default 0,
  subtotal             public.monto not null default 0 check (subtotal >= 0),
  -- Clasificación que permite arrastrar la partida al presupuesto de la OT.
  tipo_costo           public.tipo_costo_partida not null default 'MATERIAL',
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now()
);

comment on table public.cotizacion_partidas is
  'Líneas de la cotización. El subtotal lo calcula la base de datos; el valor enviado por la aplicación se ignora.';
comment on column public.cotizacion_partidas.orden_secuencia is
  'Posición de la partida en el documento impreso. Si no se envía, se asigna la siguiente disponible.';
comment on column public.cotizacion_partidas.tipo_costo is
  'MATERIAL, MANO_OBRA, SERVICIO u OTRO. Determina en qué línea del presupuesto de la OT cae la partida.';

create index idx_cotizacion_partidas_cotizacion
  on public.cotizacion_partidas(cotizacion_id, orden_secuencia);
create index idx_cotizacion_partidas_tipo_costo on public.cotizacion_partidas(tipo_costo);

-- =============================================================================
-- LÓGICA DE NEGOCIO
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Valores por defecto y aritmética de la cabecera de la cotización.
-- Todos los importes de la cabecera se derivan aquí, de modo que da igual si el
-- cambio vino de la aplicación o del recálculo disparado por las partidas.
-- -----------------------------------------------------------------------------
create or replace function public.fn_cotizacion_calcular()
returns trigger
language plpgsql
as $$
declare
  v_base numeric;
begin
  if tg_op = 'INSERT' then
    if new.numero is null then
      -- La serie puede estar registrada por sede o ser global; se intenta
      -- primero la de la sede del documento y se cae a la global.
      begin
        new.numero := public.siguiente_correlativo('COTIZACION', null, new.sede_id);
      exception when no_data_found then
        new.numero := public.siguiente_correlativo('COTIZACION', null, null);
      end;
    end if;

    if new.vendedor_id is null then
      select c.vendedor_id into new.vendedor_id
        from public.clientes c where c.id = new.cliente_id;
    end if;

    if new.creado_por is null then
      new.creado_por := public.usuario_actual();
    end if;

    if new.tipo_cambio is null then
      new.tipo_cambio := public.tipo_cambio_vigente(new.fecha_emision);
    end if;
  end if;

  -- El IGV se congela al emitir; el 18 final solo actúa si aún no se ha
  -- registrado la fila de empresa (p. ej. durante las pruebas del esquema).
  if new.igv_porcentaje is null then
    new.igv_porcentaje := coalesce(
      (select e.igv_porcentaje from public.empresa e order by e.creado_en limit 1),
      18);
  end if;

  -- El subtotal SIEMPRE se reconstruye desde las partidas: es la única fuente
  -- de verdad del importe. Así ninguna ruta de la aplicación puede escribir un
  -- subtotal que no cuadre con el detalle impreso en la cotización.
  new.subtotal := coalesce(
    (select sum(p.subtotal) from public.cotizacion_partidas p where p.cotizacion_id = new.id),
    0);
  new.descuento := coalesce(new.descuento, 0);

  v_base    := new.subtotal::numeric - new.descuento::numeric;
  new.igv   := round(v_base * new.igv_porcentaje::numeric / 100, 2);
  new.total := round(v_base + new.igv::numeric, 2);

  -- Quién y cuándo aprobó queda sellado por la base, no por la aplicación.
  if new.estado = 'APROBADA' then
    new.fecha_aprobacion := coalesce(new.fecha_aprobacion, now());
    new.aprobada_por     := coalesce(new.aprobada_por, public.usuario_actual());
  end if;

  return new;
end;
$$;

comment on function public.fn_cotizacion_calcular is
  'Asigna correlativo, tipo de cambio, vendedor e IGV, y recalcula igv y total de la cotización.';

create trigger trg_cotizacion_calcular
  before insert or update on public.cotizaciones
  for each row execute function public.fn_cotizacion_calcular();

-- -----------------------------------------------------------------------------
-- Transiciones de estado permitidas.
-- Evita que la aplicación resucite una cotización anulada o apruebe una que
-- nunca se envió al cliente.
-- -----------------------------------------------------------------------------
create or replace function public.fn_cotizacion_transicion()
returns trigger
language plpgsql
as $$
declare
  v_permitido boolean;
begin
  if old.estado = new.estado then
    return new;
  end if;

  v_permitido := case old.estado
    when 'BORRADOR'  then new.estado in ('ENVIADA', 'ANULADA')
    -- Vuelve a BORRADOR si el vendedor corrige antes de que el cliente responda.
    when 'ENVIADA'   then new.estado in ('BORRADOR', 'APROBADA', 'RECHAZADA', 'VENCIDA', 'ANULADA')
    -- Una cotización vencida se reenvía tal cual o se anula.
    when 'VENCIDA'   then new.estado in ('ENVIADA', 'ANULADA')
    when 'RECHAZADA' then new.estado in ('ANULADA')
    -- Aprobada solo puede anularse, y solo mientras no exista una OT que la use;
    -- esa validación adicional vive en el módulo de producción.
    when 'APROBADA'  then new.estado in ('ANULADA')
    when 'ANULADA'   then false
  end;

  if not v_permitido then
    raise exception 'Transición de estado no permitida en la cotización %: % → %',
      new.numero, old.estado, new.estado
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_cotizacion_transicion
  before update of estado on public.cotizaciones
  for each row execute function public.fn_cotizacion_transicion();

-- -----------------------------------------------------------------------------
-- Subtotal de la partida: siempre calculado.
-- -----------------------------------------------------------------------------
create or replace function public.fn_partida_calcular()
returns trigger
language plpgsql
as $$
begin
  if new.orden_secuencia is null then
    select coalesce(max(p.orden_secuencia), 0) + 1
      into new.orden_secuencia
      from public.cotizacion_partidas p
     where p.cotizacion_id = new.cotizacion_id;
  end if;

  new.subtotal := round(
      new.cantidad::numeric
    * new.precio_unitario::numeric
    * (1 - coalesce(new.descuento_porcentaje, 0)::numeric / 100), 2);

  return new;
end;
$$;

comment on function public.fn_partida_calcular is
  'Calcula subtotal = cantidad × precio_unitario × (1 - descuento%). El valor enviado por la aplicación se descarta.';

create trigger trg_partida_calcular
  before insert or update on public.cotizacion_partidas
  for each row execute function public.fn_partida_calcular();

-- -----------------------------------------------------------------------------
-- REGLA: las partidas de una cotización APROBADA son inmutables.
-- Una cotización aprobada es el compromiso económico firmado con el cliente y
-- la base del presupuesto de la orden de trabajo; si sus partidas pudieran
-- cambiar después, el costo presupuestado dejaría de ser auditable. Para
-- modificar el alcance se anula la cotización y se emite una nueva versión.
-- Lo mismo aplica a una cotización ANULADA: se conserva como evidencia.
-- El borrado de la cabecera se bloquea aparte (trg_cotizacion_bloquear_borrado):
-- en un DELETE en cascada Postgres elimina primero la cotización y recién
-- después sus partidas, así que este trigger ya no encontraría la cabecera.
-- -----------------------------------------------------------------------------
create or replace function public.fn_partida_bloquear_cerrada()
returns trigger
language plpgsql
as $$
declare
  v_cotizacion uuid;
  v_estado     public.estado_cotizacion;
  v_numero     text;
begin
  if tg_op = 'DELETE' then
    v_cotizacion := old.cotizacion_id;
  else
    v_cotizacion := new.cotizacion_id;
  end if;

  select c.estado, c.numero into v_estado, v_numero
    from public.cotizaciones c where c.id = v_cotizacion;

  if v_estado in ('APROBADA', 'ANULADA') then
    raise exception
      'La cotización % está en estado % y sus partidas ya no pueden modificarse. Anúlela y emita una nueva versión.',
      v_numero, v_estado
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_partida_bloquear_cerrada
  before insert or update or delete on public.cotizacion_partidas
  for each row execute function public.fn_partida_bloquear_cerrada();

-- Una cotización aprobada o anulada no se borra: es el respaldo del compromiso
-- con el cliente y del presupuesto de la OT. Para dejarla sin efecto se anula.
create or replace function public.fn_cotizacion_bloquear_borrado()
returns trigger
language plpgsql
as $$
begin
  if old.estado in ('APROBADA', 'ANULADA') then
    raise exception 'La cotización % está en estado % y no puede eliminarse; forma parte del historial del cliente.',
      old.numero, old.estado
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger trg_cotizacion_bloquear_borrado
  before delete on public.cotizaciones
  for each row execute function public.fn_cotizacion_bloquear_borrado();

-- -----------------------------------------------------------------------------
-- Recálculo de la cabecera cuando cambian las partidas.
-- Solo escribe el subtotal: igv y total los deriva trg_cotizacion_calcular.
-- -----------------------------------------------------------------------------
create or replace function public.recalcular_totales_cotizacion(p_cotizacion uuid)
returns void
language sql
as $$
  update public.cotizaciones c
     set subtotal = coalesce(
           (select sum(p.subtotal) from public.cotizacion_partidas p
             where p.cotizacion_id = c.id), 0)
   where c.id = p_cotizacion;
$$;

comment on function public.recalcular_totales_cotizacion is
  'Reconstruye el subtotal de una cotización desde sus partidas. Útil también para reparar datos migrados.';

create or replace function public.fn_partida_recalcular_cabecera()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalcular_totales_cotizacion(old.cotizacion_id);
    return old;
  end if;

  perform public.recalcular_totales_cotizacion(new.cotizacion_id);

  -- Mover una partida de cotización obliga a recalcular también la de origen.
  if tg_op = 'UPDATE' and old.cotizacion_id is distinct from new.cotizacion_id then
    perform public.recalcular_totales_cotizacion(old.cotizacion_id);
  end if;

  return new;
end;
$$;

create trigger trg_partida_recalcular_cabecera
  after insert or update or delete on public.cotizacion_partidas
  for each row execute function public.fn_partida_recalcular_cabecera();

-- -----------------------------------------------------------------------------
-- Barrido de vencimientos: una cotización enviada que pasó su fecha de validez
-- deja de comprometer el precio ofertado. Se ejecuta desde un job diario.
-- -----------------------------------------------------------------------------
create or replace function public.marcar_cotizaciones_vencidas(p_fecha date default current_date)
returns integer
language plpgsql
as $$
declare
  v_afectadas integer;
begin
  update public.cotizaciones
     set estado = 'VENCIDA'
   where estado = 'ENVIADA'
     and fecha_vencimiento < p_fecha;

  get diagnostics v_afectadas = row_count;
  return v_afectadas;
end;
$$;

comment on function public.marcar_cotizaciones_vencidas is
  'Marca como VENCIDA toda cotización ENVIADA cuya validez expiró. Devuelve cuántas cambiaron.';

-- =============================================================================
-- VISTAS
-- =============================================================================

create view public.cotizaciones_detalle as
  select
    c.id,
    c.numero,
    c.estado,
    c.fecha_emision,
    c.fecha_vencimiento,
    (c.fecha_vencimiento - current_date) as dias_para_vencer,
    c.moneda,
    c.subtotal,
    c.descuento,
    c.igv,
    c.total,
    -- Total llevado a soles para poder sumar cotizaciones de ambas monedas.
    round(c.total::numeric * case when c.moneda = 'USD' then c.tipo_cambio else 1 end, 2) as total_pen,
    c.cliente_id,
    cli.razon_social,
    cli.numero_documento,
    c.unidad_id,
    u.placa,
    u.tipo_vehiculo,
    c.tipo_carroceria_id,
    tc.codigo as tipo_carroceria_codigo,
    tc.nombre as tipo_carroceria_nombre,
    c.vendedor_id,
    c.sede_id,
    (select count(*) from public.cotizacion_partidas p where p.cotizacion_id = c.id) as partidas
  from public.cotizaciones c
  join public.clientes cli on cli.id = c.cliente_id
  left join public.unidades u on u.id = c.unidad_id
  left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id;

comment on view public.cotizaciones_detalle is
  'Cotizaciones con cliente, unidad y tipo de carrocería resueltos, para las pantallas de listado y los reportes comerciales.';

-- =============================================================================
-- TIMESTAMPS Y AUDITORÍA
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'clientes', 'contactos_cliente', 'tipos_carroceria', 'unidades',
    'cotizaciones', 'cotizacion_partidas'
  ] loop
    perform public.activar_timestamps(t);
  end loop;

  -- Todo lo que sostiene un compromiso con el cliente se audita: quién cambió
  -- un precio, quién reasignó una unidad o quién aprobó una cotización.
  foreach t in array array[
    'clientes', 'contactos_cliente', 'unidades', 'cotizaciones', 'cotizacion_partidas'
  ] loop
    perform public.activar_auditoria(t);
  end loop;
end;
$$;
