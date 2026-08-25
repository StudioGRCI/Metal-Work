-- =============================================================================
-- 0006 · DOCUMENTOS Y TRAZABILIDAD
-- Metal-Work · Gestión de órdenes de trabajo para fabricación de carrocerías
-- -----------------------------------------------------------------------------
-- Dos cosas viven en este módulo:
--
--   1. EL REPOSITORIO DOCUMENTAL. Un plano, la cotización firmada, la orden de
--      compra del cliente, la guía de remisión, la factura, el certificado de
--      calidad del acero, el protocolo de soldadura, las fotos del avance, el
--      acta de conformidad y el informe de inspección son el mismo objeto para
--      el sistema: una cabecera lógica (documentos) con una o más versiones
--      inmutables (documento_versiones) guardadas en Supabase Storage, con un
--      flujo de aprobación opcional (aprobaciones) y un registro de quién lo
--      miró o lo descargó (documento_accesos).
--
--      El vínculo con el resto del sistema es POLIMÓRFICO: entidad_tabla +
--      entidad_id apuntan a cualquier registro (una OT, un proveedor, una orden
--      de compra, un lote de material, un cliente). Postgres no puede declarar
--      una clave foránea polimórfica, así que la integridad la sostiene un
--      trigger que comprueba que la tabla y la fila existan de verdad.
--
--   2. LA LÍNEA DE TIEMPO UNIFICADA (v_ot_timeline). Es lo que el usuario ve al
--      abrir una orden de trabajo: bitácora, documentos, movimientos de almacén,
--      inspecciones de calidad y cambios auditados de la propia OT, todo en una
--      sola lista ordenable por fecha. Ninguna de esas cinco fuentes se copia:
--      la vista las une en tiempo real, de modo que la línea de tiempo nunca
--      puede desincronizarse de los hechos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums del dominio documental
-- -----------------------------------------------------------------------------

-- Ciclo de vida de la cabecera. Un documento no se borra: se REEMPLAZA cuando
-- llega otro que lo sustituye (plano revisión B sobre revisión A) o se ANULA
-- cuando nunca debió existir. En ambos casos sigue siendo consultable.
create type public.estado_documento as enum ('VIGENTE', 'REEMPLAZADO', 'ANULADO');

-- Naturaleza del documento. Sirve para agrupar en pantalla y para decidir a qué
-- perfil se le muestra qué: el taller vive de los TECNICOS, la oficina de los
-- COMERCIALES y los ADMINISTRATIVOS.
create type public.categoria_documento as enum (
  'TECNICO',        -- planos, fichas técnicas, memorias de cálculo, procedimientos
  'COMERCIAL',      -- cotización firmada, orden de compra del cliente, contrato
  'CALIDAD',        -- certificados de acero, protocolos de soldadura, informes
  'LOGISTICO',      -- guías de remisión, packing lists, cargos de entrega
  'ADMINISTRATIVO', -- facturas, letras, comprobantes, seguros
  'LEGAL',          -- actas, cartas notariales, poderes
  'FOTOGRAFICO'     -- fotos de avance, del estado inicial de la unidad, de la entrega
);

create type public.estado_aprobacion as enum ('PENDIENTE', 'APROBADO', 'OBSERVADO', 'RECHAZADO');

-- Granularidad del registro de accesos: en una auditoría no es lo mismo haber
-- abierto la vista previa que haberse llevado el archivo.
create type public.tipo_acceso_documento as enum (
  'VISTA', 'DESCARGA', 'IMPRESION', 'COMPARTIDO'
);

-- =============================================================================
-- CATÁLOGO DE TIPOS DE DOCUMENTO
-- =============================================================================

create table public.tipos_documento (
  id                      uuid primary key default gen_random_uuid(),
  codigo                  text not null unique,
  nombre                  text not null,
  descripcion             text,
  categoria               public.categoria_documento not null default 'TECNICO',
  -- Tabla a la que se adjunta este tipo de documento. Nulo = aplica a cualquier
  -- entidad (por ejemplo una foto o una nota escaneada).
  entidad_tabla           text,
  -- Si es true el documento no se considera válido hasta que todas las firmas
  -- de la tabla aprobaciones estén en APROBADO.
  requiere_aprobacion     boolean not null default false,
  -- Si es true, una OT no puede pasar a ENTREGADA mientras no exista un
  -- documento VIGENTE de este tipo para esa orden. Es lo que impide entregar
  -- una carrocería sin acta de conformidad o sin certificado de calidad.
  obligatorio_para_cierre boolean not null default false,
  -- Extensiones aceptadas, en minúsculas y sin punto. Vacío = sin restricción.
  extensiones_permitidas  text[] not null default array['pdf', 'jpg', 'jpeg', 'png'],
  tamano_maximo_mb        int not null default 25 check (tamano_maximo_mb between 1 and 1024),
  -- Los tipos confidenciales marcan como confidencial todo documento que crean.
  confidencial_por_defecto boolean not null default false,
  -- Bucket de Supabase Storage donde se guardan los archivos de este tipo.
  bucket                  text not null default 'documentos',
  -- Meses que la empresa debe conservar el documento; nulo = indefinido.
  retencion_meses         int check (retencion_meses is null or retencion_meses > 0),
  orden_visualizacion     int not null default 0,
  activo                  boolean not null default true,
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now(),

  -- La obligatoriedad para el cierre solo tiene sentido en documentos de la OT.
  constraint ck_tipo_doc_obligatorio check (
    not obligatorio_para_cierre
    or coalesce(entidad_tabla, 'ordenes_trabajo') = 'ordenes_trabajo'),
  constraint ck_tipo_doc_bucket check (bucket in ('documentos', 'fotos-avance', 'logos'))
);

comment on table public.tipos_documento is
  'Catálogo configurable de tipos de documento. Define qué se puede adjuntar, a qué entidad, con qué formato y bajo qué exigencia de aprobación.';
comment on column public.tipos_documento.entidad_tabla is
  'Nombre de la tabla de public a la que aplica el tipo. Nulo cuando el tipo sirve para cualquier entidad.';
comment on column public.tipos_documento.obligatorio_para_cierre is
  'Bloquea el paso de la OT a ENTREGADA si no existe un documento vigente y aprobado de este tipo.';
comment on column public.tipos_documento.extensiones_permitidas is
  'Se normaliza a minúsculas y sin punto inicial en el trigger. Un arreglo vacío significa que se acepta cualquier extensión.';

create index idx_tipos_documento_categoria on public.tipos_documento(categoria) where activo;
create index idx_tipos_documento_entidad on public.tipos_documento(entidad_tabla);
create index idx_tipos_documento_obligatorio on public.tipos_documento(id) where obligatorio_para_cierre and activo;

-- =============================================================================
-- DOCUMENTOS · cabecera lógica
-- =============================================================================

create table public.documentos (
  id                 uuid primary key default gen_random_uuid(),
  tipo_documento_id  uuid not null references public.tipos_documento(id) on delete restrict,
  titulo             text not null check (nullif(btrim(titulo), '') is not null),
  descripcion        text,
  -- Número que trae el documento por fuera del sistema: F001-00123 de una
  -- factura, T002-4567 de una guía, la revisión de un plano. No es único: dos
  -- proveedores distintos emiten facturas con la misma serie y número, y la
  -- unicidad real es (emisor, tipo, serie, número), que este módulo no conoce.
  numero_externo     text,
  -- Fecha que figura EN el documento, que no es la fecha en que se subió.
  fecha_documento    date,
  -- Vínculo polimórfico. Un trigger valida que la tabla exista en public y que
  -- la fila apuntada exista realmente; es el sustituto de la clave foránea que
  -- Postgres no puede declarar contra una tabla variable.
  entidad_tabla      text not null,
  entidad_id         uuid not null,
  -- DESNORMALIZACIÓN DELIBERADA. La pantalla de una OT necesita listar todos sus
  -- documentos con una sola consulta indexada, incluidos los que cuelgan de una
  -- entidad intermedia (una guía de remisión adjunta al movimiento de almacén,
  -- una factura adjunta a la orden de compra que abastece la OT). Resolver eso
  -- en tiempo de consulta obligaría a un UNION por cada tabla intermedia. Aquí
  -- lo resuelve una sola vez el trigger fn_entidad_polimorfica, que copia el
  -- orden_id de la entidad apuntada cuando esta lo tiene.
  orden_id           uuid references public.ordenes_trabajo(id) on delete cascade,
  estado             public.estado_documento not null default 'VIGENTE',
  -- Solo lo ven ADMIN y quien tenga permiso explícito (lo resuelve la migración
  -- de RLS). Sirve para costos de proveedor, contratos y temas de personal.
  es_confidencial    boolean not null default false,
  etiquetas          text[] not null default '{}',
  -- Número de la última versión subida. 0 significa cabecera sin archivo todavía.
  version_actual     int not null default 0 check (version_actual >= 0),
  -- Documento al que este sustituye: la revisión B apunta a la revisión A.
  reemplaza_a        uuid references public.documentos(id) on delete set null,
  -- Derivadas del flujo de aprobación; las mantiene fn_aprobacion_sincronizar.
  -- Nulas cuando el documento no tiene firmas registradas.
  estado_aprobacion  public.estado_aprobacion,
  aprobado_en        timestamptz,
  -- Vigencia del documento: un certificado de calidad o una póliza caducan.
  vence_en           date,
  motivo_anulacion   text,
  creado_por         uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  -- Anular sin decir por qué destruye la trazabilidad que este módulo existe para dar.
  constraint ck_documento_motivo_anulacion check (
    estado <> 'ANULADO' or nullif(btrim(motivo_anulacion), '') is not null),
  constraint ck_documento_no_se_reemplaza_a_si_mismo check (reemplaza_a is distinct from id),
  constraint ck_documento_vencimiento check (
    vence_en is null or fecha_documento is null or vence_en >= fecha_documento)
);

comment on table public.documentos is
  'Cabecera lógica de un documento. El archivo vive en documento_versiones; aquí está la identidad, el vínculo con el resto del sistema y el estado.';
comment on column public.documentos.entidad_tabla is
  'Tabla de public a la que pertenece el documento. Para documentos generales de la empresa se usa la tabla empresa.';
comment on column public.documentos.orden_id is
  'Copia redundante de la OT asociada, resuelta por trigger. Existe para listar los documentos de una orden sin recorrer las tablas intermedias.';
comment on column public.documentos.version_actual is
  'Última versión subida. Lo mantiene el trigger de documento_versiones; no se escribe a mano.';
comment on column public.documentos.estado_aprobacion is
  'Resumen del flujo de aprobaciones: RECHAZADO manda sobre OBSERVADO, OBSERVADO sobre PENDIENTE, y APROBADO solo cuando todas las firmas lo están.';

create index idx_documentos_tipo on public.documentos(tipo_documento_id);
create index idx_documentos_entidad on public.documentos(entidad_tabla, entidad_id);
create index idx_documentos_orden on public.documentos(orden_id, creado_en desc);
create index idx_documentos_creado_por on public.documentos(creado_por);
create index idx_documentos_reemplaza on public.documentos(reemplaza_a);
create index idx_documentos_fecha on public.documentos(fecha_documento desc nulls last);
create index idx_documentos_numero_externo on public.documentos(numero_externo)
  where numero_externo is not null;
create index idx_documentos_estado on public.documentos(estado) where estado <> 'VIGENTE';
-- Búsqueda por etiqueta libre: etiquetas @> array['garantia'].
create index idx_documentos_etiquetas on public.documentos using gin (etiquetas);
create index idx_documentos_titulo_trgm on public.documentos using gin (titulo gin_trgm_ops);
-- Bandeja de documentos que esperan firma.
create index idx_documentos_pendientes on public.documentos(tipo_documento_id)
  where estado_aprobacion in ('PENDIENTE', 'OBSERVADO');
-- Control de vencimientos de certificados y pólizas.
create index idx_documentos_vencimiento on public.documentos(vence_en)
  where vence_en is not null and estado = 'VIGENTE';

-- =============================================================================
-- DOCUMENTO_VERSIONES · el archivo, inmutable
-- =============================================================================

create table public.documento_versiones (
  id             uuid primary key default gen_random_uuid(),
  documento_id   uuid not null references public.documentos(id) on delete cascade,
  -- Lo asigna el trigger tomando y bloqueando la cabecera: dos cargas
  -- simultáneas del mismo documento se serializan y nunca comparten número.
  version        int not null check (version > 0),
  bucket         text not null default 'documentos',
  -- Ruta dentro del bucket, por ejemplo ot/OT-001-00042/planos/uuid.pdf
  ruta_storage   text not null check (nullif(btrim(ruta_storage), '') is not null),
  nombre_archivo text not null,
  extension      text not null,
  tamano_bytes   bigint not null check (tamano_bytes > 0),
  mime_type      text,
  -- Huella del archivo. Permite demostrar ante una auditoría que el PDF que se
  -- descarga hoy es byte a byte el que se subió, y detectar cargas duplicadas.
  hash_sha256    text check (hash_sha256 ~ '^[a-f0-9]{64}$'),
  -- Qué cambió respecto de la versión anterior: "revisión B, se corrige el
  -- espesor de la plancha de piso".
  comentario     text,
  subido_por     uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  subido_en      timestamptz not null default now(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint uq_version_por_documento unique (documento_id, version),
  -- Un archivo por ruta: dos versiones no pueden apuntar al mismo objeto de
  -- Storage, o borrar una dejaría a la otra sin archivo.
  constraint uq_version_ruta unique (bucket, ruta_storage),
  constraint ck_version_bucket check (bucket in ('documentos', 'fotos-avance', 'logos'))
);

comment on table public.documento_versiones is
  'Cada archivo subido es una versión inmutable. Solo se puede editar el comentario; el resto lo protege un trigger.';
comment on column public.documento_versiones.ruta_storage is
  'Ruta del objeto dentro del bucket de Supabase Storage. La aplicación firma URLs temporales contra ella; nunca se expone el bucket completo.';
comment on column public.documento_versiones.hash_sha256 is
  'SHA-256 del contenido, calculado por el cliente al subir. Verifica integridad y evita registrar dos veces el mismo archivo.';

create index idx_doc_versiones_documento on public.documento_versiones(documento_id, version desc);
create index idx_doc_versiones_subido_por on public.documento_versiones(subido_por);
create index idx_doc_versiones_subido_en on public.documento_versiones(subido_en desc);
create index idx_doc_versiones_hash on public.documento_versiones(hash_sha256)
  where hash_sha256 is not null;
-- El mismo contenido no se registra dos veces como versiones distintas del
-- mismo documento: eso no es una revisión, es una carga repetida por error.
create unique index uq_doc_version_hash on public.documento_versiones(documento_id, hash_sha256)
  where hash_sha256 is not null;

-- =============================================================================
-- APROBACIONES · flujo de firmas de un documento
-- =============================================================================

create table public.aprobaciones (
  id               uuid primary key default gen_random_uuid(),
  documento_id     uuid not null references public.documentos(id) on delete cascade,
  aprobador_id     uuid not null references public.usuarios(id) on delete restrict,
  -- Posición en la cadena de firmas. Con varias firmas, la 2 no puede decidir
  -- mientras la 1 siga pendiente; lo hace cumplir un trigger.
  orden_firma      int not null default 1 check (orden_firma > 0),
  estado           public.estado_aprobacion not null default 'PENDIENTE',
  comentario       text,
  -- Momento de la decisión. Lo pone el trigger, no la aplicación.
  fecha            timestamptz,
  -- Versión del documento sobre la que se decidió. Subir una versión nueva
  -- devuelve las firmas a PENDIENTE: nadie aprobó un archivo que aún no existía.
  version_aprobada int check (version_aprobada > 0),
  solicitado_por   uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  solicitado_en    timestamptz not null default now(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),

  constraint uq_aprobacion_orden unique (documento_id, orden_firma),
  -- Observar o rechazar exige explicar qué está mal.
  constraint ck_aprobacion_comentario check (
    estado not in ('OBSERVADO', 'RECHAZADO') or nullif(btrim(comentario), '') is not null),
  -- Pendiente y sin fecha, o decidido y con fecha: nunca una cosa a medias.
  constraint ck_aprobacion_fecha check ((estado = 'PENDIENTE') = (fecha is null))
);

comment on table public.aprobaciones is
  'Firmas requeridas sobre un documento. El historial de decisiones anteriores queda en audit_log, no se pisa aquí.';
comment on column public.aprobaciones.orden_firma is
  'Secuencia de firma. Varias filas con el mismo documento se firman en orden ascendente.';

create index idx_aprobaciones_documento on public.aprobaciones(documento_id, orden_firma);
create index idx_aprobaciones_aprobador on public.aprobaciones(aprobador_id, estado);
create index idx_aprobaciones_solicitado_por on public.aprobaciones(solicitado_por);
-- Bandeja de entrada del aprobador.
create index idx_aprobaciones_pendientes on public.aprobaciones(aprobador_id, solicitado_en)
  where estado = 'PENDIENTE';

-- =============================================================================
-- DOCUMENTO_ACCESOS · quién vio o descargó qué
-- =============================================================================

create table public.documento_accesos (
  id           uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos(id) on delete cascade,
  -- Versión concreta que se consultó; nula si se accedió a la ficha del documento.
  version_id   uuid references public.documento_versiones(id) on delete set null,
  usuario_id   uuid references public.usuarios(id) on delete set null,
  tipo_acceso  public.tipo_acceso_documento not null default 'VISTA',
  ip           inet,
  user_agent   text,
  creado_en    timestamptz not null default now()
);

comment on table public.documento_accesos is
  'Bitácora de lectura de documentos. Es append-only y por eso no lleva actualizado_en ni trigger de auditoría: la tabla ya ES el registro de auditoría.';
comment on column public.documento_accesos.usuario_id is
  'Lo fija registrar_acceso_documento a partir de la sesión; la aplicación no puede declarar accesos a nombre de otro.';

create index idx_doc_accesos_documento on public.documento_accesos(documento_id, creado_en desc);
create index idx_doc_accesos_version on public.documento_accesos(version_id);
create index idx_doc_accesos_usuario on public.documento_accesos(usuario_id, creado_en desc);
create index idx_doc_accesos_fecha on public.documento_accesos(creado_en desc);

-- =============================================================================
-- NOTAS · comentarios libres sobre cualquier entidad
-- =============================================================================

create table public.notas (
  id             uuid primary key default gen_random_uuid(),
  -- Mismo vínculo polimórfico validado que en documentos.
  entidad_tabla  text not null,
  entidad_id     uuid not null,
  -- Copia redundante por el mismo motivo que en documentos: leer de un tirón
  -- todo lo dicho alrededor de una orden de trabajo.
  orden_id       uuid references public.ordenes_trabajo(id) on delete cascade,
  texto          text not null check (nullif(btrim(texto), '') is not null),
  autor_id       uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  -- Usuarios mencionados con @ en el texto. El trigger comprueba que existan.
  menciones      uuid[] not null default '{}',
  -- Respuesta a otra nota: permite hilos sin tabla aparte.
  nota_padre_id  uuid references public.notas(id) on delete cascade,
  -- Una nota interna no se muestra en los reportes que se envían al cliente.
  es_interna     boolean not null default true,
  fijada         boolean not null default false,
  editada_en     timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  constraint ck_nota_no_es_su_propio_padre check (nota_padre_id is distinct from id)
);

comment on table public.notas is
  'Comentarios de trabajo sobre cualquier registro del sistema: acuerdos con el cliente, advertencias del taller, motivos de una decisión.';
comment on column public.notas.menciones is
  'Usuarios notificados. Se valida contra usuarios para que una mención no quede apuntando a nadie.';

create index idx_notas_entidad on public.notas(entidad_tabla, entidad_id, creado_en desc);
create index idx_notas_orden on public.notas(orden_id, creado_en desc);
create index idx_notas_autor on public.notas(autor_id);
create index idx_notas_padre on public.notas(nota_padre_id);
create index idx_notas_menciones on public.notas using gin (menciones);
create index idx_notas_fijadas on public.notas(entidad_tabla, entidad_id) where fijada;

-- =============================================================================
-- INTEGRIDAD DEL VÍNCULO POLIMÓRFICO
-- =============================================================================

-- Sustituye a la clave foránea que no se puede declarar cuando la tabla destino
-- es un dato. Comprueba que la tabla exista en public, que la fila exista, y de
-- paso resuelve el orden_id desnormalizado leyéndolo de la entidad apuntada.
-- La comparten documentos y notas.
create or replace function public.fn_entidad_polimorfica()
returns trigger
language plpgsql
as $$
declare
  v_relacion regclass;
  v_existe   boolean;
  v_orden    uuid;
begin
  new.entidad_tabla := lower(btrim(new.entidad_tabla));

  v_relacion := to_regclass(format('public.%I', new.entidad_tabla));
  if v_relacion is null then
    raise exception 'La entidad "%" no corresponde a ninguna tabla del esquema public', new.entidad_tabla
      using errcode = 'foreign_key_violation';
  end if;

  -- La comprobación de existencia solo aplica a tablas que siguen la convención
  -- del esquema (id uuid). Las tablas con clave natural quedan fuera.
  if exists (
    select 1
      from pg_attribute a
     where a.attrelid = v_relacion
       and a.attname = 'id'
       and a.atttypid = 'uuid'::regtype
       and a.attnum > 0
       and not a.attisdropped
  ) then
    execute format('select exists (select 1 from public.%I where id = $1)', new.entidad_tabla)
      into v_existe
      using new.entidad_id;

    if not v_existe then
      raise exception 'No existe el registro % en la tabla %', new.entidad_id, new.entidad_tabla
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- Resolución del orden_id redundante. Solo se calcula si no vino dado.
  if new.orden_id is null then
    if new.entidad_tabla = 'ordenes_trabajo' then
      new.orden_id := new.entidad_id;
    elsif exists (
      select 1
        from pg_attribute a
       where a.attrelid = v_relacion
         and a.attname = 'orden_id'
         and a.attnum > 0
         and not a.attisdropped
    ) then
      execute format('select orden_id from public.%I where id = $1', new.entidad_tabla)
        into v_orden
        using new.entidad_id;
      new.orden_id := v_orden;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.fn_entidad_polimorfica is
  'Valida el par (entidad_tabla, entidad_id) y deriva el orden_id desnormalizado. Sustituye a la clave foránea imposible de un vínculo polimórfico.';

-- =============================================================================
-- TRIGGERS DE TIPOS_DOCUMENTO
-- =============================================================================

create or replace function public.fn_tipo_documento_normalizar()
returns trigger
language plpgsql
as $$
begin
  new.codigo := upper(btrim(new.codigo));

  -- Las extensiones se guardan en minúsculas y sin punto para poder compararlas
  -- directamente con la extensión del archivo que sube el usuario.
  new.extensiones_permitidas := coalesce(
    (select array_agg(distinct lower(btrim(regexp_replace(e, '^\.', ''))))
       from unnest(new.extensiones_permitidas) as e
      where nullif(btrim(e), '') is not null),
    '{}'::text[]);

  if new.entidad_tabla is not null then
    new.entidad_tabla := lower(btrim(new.entidad_tabla));
    if to_regclass(format('public.%I', new.entidad_tabla)) is null then
      raise exception 'El tipo de documento apunta a la tabla inexistente "%"', new.entidad_tabla
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_tipos_documento_normalizar
  before insert or update on public.tipos_documento
  for each row execute function public.fn_tipo_documento_normalizar();

-- =============================================================================
-- TRIGGERS DE DOCUMENTOS
-- =============================================================================

create or replace function public.fn_documento_antes()
returns trigger
language plpgsql
as $$
declare
  v_tipo public.tipos_documento%rowtype;
begin
  select * into v_tipo from public.tipos_documento t where t.id = new.tipo_documento_id;

  if not found then
    raise exception 'El tipo de documento % no existe', new.tipo_documento_id
      using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'INSERT' and not v_tipo.activo then
    raise exception 'El tipo de documento % está desactivado', v_tipo.codigo
      using errcode = 'check_violation';
  end if;

  -- Un tipo restringido a una entidad no se adjunta a otra: así una "guía de
  -- remisión" no termina colgada de un cliente.
  if v_tipo.entidad_tabla is not null and v_tipo.entidad_tabla <> new.entidad_tabla then
    raise exception 'El tipo de documento % solo se adjunta a % y se intentó adjuntar a %',
      v_tipo.codigo, v_tipo.entidad_tabla, new.entidad_tabla
      using errcode = 'check_violation';
  end if;

  -- La confidencialidad solo escala: un tipo confidencial contagia a su
  -- documento, pero un documento marcado a mano nunca se desmarca solo.
  if v_tipo.confidencial_por_defecto then
    new.es_confidencial := true;
  end if;

  new.titulo := btrim(new.titulo);
  new.numero_externo := nullif(btrim(new.numero_externo), '');

  -- Etiquetas normalizadas y sin repeticiones, para que el índice GIN sirva de algo.
  new.etiquetas := coalesce(
    (select array_agg(distinct btrim(lower(e)))
       from unnest(new.etiquetas) as e
      where nullif(btrim(e), '') is not null),
    '{}'::text[]);

  return new;
end;
$$;

create trigger trg_documentos_entidad
  before insert or update of entidad_tabla, entidad_id, orden_id on public.documentos
  for each row execute function public.fn_entidad_polimorfica();

create trigger trg_documentos_antes
  before insert or update on public.documentos
  for each row execute function public.fn_documento_antes();

-- =============================================================================
-- TRIGGERS DE DOCUMENTO_VERSIONES
-- =============================================================================

-- Asigna el número de versión y valida el archivo contra las reglas del tipo.
-- El SELECT ... FOR UPDATE sobre la cabecera es el que serializa dos cargas
-- simultáneas: la segunda espera y recibe el número siguiente.
create or replace function public.fn_version_antes_insert()
returns trigger
language plpgsql
as $$
declare
  v_documento public.documentos%rowtype;
  v_tipo      public.tipos_documento%rowtype;
  v_maximo    bigint;
begin
  select * into v_documento
    from public.documentos d
   where d.id = new.documento_id
     for update;

  if not found then
    raise exception 'El documento % no existe', new.documento_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_documento.estado = 'ANULADO' then
    raise exception 'No se pueden subir versiones a un documento anulado'
      using errcode = 'check_violation';
  end if;

  select * into v_tipo from public.tipos_documento t where t.id = v_documento.tipo_documento_id;

  new.nombre_archivo := btrim(new.nombre_archivo);

  -- La extensión se deduce del nombre del archivo cuando no viene declarada.
  new.extension := lower(coalesce(
    nullif(btrim(regexp_replace(coalesce(new.extension, ''), '^\.', '')), ''),
    substring(new.nombre_archivo from '\.([A-Za-z0-9]+)$')));

  if new.extension is null then
    raise exception 'No se pudo determinar la extensión del archivo "%"', new.nombre_archivo
      using errcode = 'check_violation';
  end if;

  if cardinality(v_tipo.extensiones_permitidas) > 0
     and not (new.extension = any (v_tipo.extensiones_permitidas)) then
    raise exception 'El tipo % no admite archivos .%; se aceptan: %',
      v_tipo.codigo, new.extension, array_to_string(v_tipo.extensiones_permitidas, ', ')
      using errcode = 'check_violation';
  end if;

  v_maximo := v_tipo.tamano_maximo_mb::bigint * 1024 * 1024;
  if new.tamano_bytes > v_maximo then
    raise exception 'El archivo pesa % bytes y el tipo % admite hasta % MB',
      new.tamano_bytes, v_tipo.codigo, v_tipo.tamano_maximo_mb
      using errcode = 'check_violation';
  end if;

  -- El bucket lo manda el tipo de documento: la aplicación no elige dónde se
  -- guarda, para que las políticas de Storage sean predecibles.
  new.bucket := v_tipo.bucket;
  new.hash_sha256 := lower(nullif(btrim(new.hash_sha256), ''));
  new.version := v_documento.version_actual + 1;

  return new;
end;
$$;

-- Propaga la nueva versión a la cabecera y reabre las firmas.
create or replace function public.fn_version_despues_insert()
returns trigger
language plpgsql
as $$
begin
  update public.documentos d
     set version_actual = new.version,
         actualizado_en = now()
   where d.id = new.documento_id;

  -- Una versión nueva invalida lo ya firmado: nadie aprobó un archivo que no
  -- había visto. Las decisiones anteriores quedan en audit_log.
  if new.version > 1 then
    update public.aprobaciones a
       set estado = 'PENDIENTE',
           fecha = null,
           version_aprobada = null
     where a.documento_id = new.documento_id
       and a.estado <> 'PENDIENTE';
  end if;

  return null;
end;
$$;

-- Una versión es el registro de un archivo que ya existe en Storage: cambiarle
-- la ruta, el hash o el peso sería falsear la evidencia. Solo se deja corregir
-- el comentario del cambio.
create or replace function public.fn_version_inmutable()
returns trigger
language plpgsql
as $$
begin
  if (new.documento_id, new.version, new.bucket, new.ruta_storage, new.nombre_archivo,
      new.extension, new.tamano_bytes, new.hash_sha256, new.subido_por, new.subido_en)
     is distinct from
     (old.documento_id, old.version, old.bucket, old.ruta_storage, old.nombre_archivo,
      old.extension, old.tamano_bytes, old.hash_sha256, old.subido_por, old.subido_en)
  then
    raise exception 'Una versión de documento es inmutable: solo se puede editar el comentario'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_version_antes_insert
  before insert on public.documento_versiones
  for each row execute function public.fn_version_antes_insert();

create trigger trg_version_despues_insert
  after insert on public.documento_versiones
  for each row execute function public.fn_version_despues_insert();

create trigger trg_version_inmutable
  before update on public.documento_versiones
  for each row execute function public.fn_version_inmutable();

-- =============================================================================
-- TRIGGERS DE APROBACIONES
-- =============================================================================

create or replace function public.fn_aprobacion_antes()
returns trigger
language plpgsql
as $$
declare
  v_version int;
begin
  if new.estado = 'PENDIENTE' then
    new.fecha := null;
    new.version_aprobada := null;
    return new;
  end if;

  -- Se acaba de tomar una decisión.
  if tg_op = 'INSERT' or old.estado is distinct from new.estado then
    -- Firma en cadena: nadie decide antes que quien le precede.
    if exists (
      select 1
        from public.aprobaciones a
       where a.documento_id = new.documento_id
         and a.orden_firma < new.orden_firma
         and a.estado = 'PENDIENTE'
         and a.id <> new.id
    ) then
      raise exception 'Faltan firmas anteriores en el documento %', new.documento_id
        using errcode = 'check_violation';
    end if;

    new.fecha := now();

    select d.version_actual into v_version
      from public.documentos d
     where d.id = new.documento_id;

    if coalesce(v_version, 0) = 0 then
      raise exception 'No se puede aprobar un documento que todavía no tiene archivo'
        using errcode = 'check_violation';
    end if;

    new.version_aprobada := v_version;
  end if;

  return new;
end;
$$;

-- Mantiene el resumen del flujo en la cabecera del documento, que es lo que
-- consultan las pantallas y la regla de cierre de OT.
create or replace function public.fn_aprobacion_sincronizar()
returns trigger
language plpgsql
as $$
declare
  v_documento uuid;
  v_estado    public.estado_aprobacion;
begin
  if tg_op = 'DELETE' then
    v_documento := old.documento_id;
  else
    v_documento := new.documento_id;
  end if;

  select case
           when count(*) = 0 then null
           when count(*) filter (where a.estado = 'RECHAZADO') > 0 then 'RECHAZADO'
           when count(*) filter (where a.estado = 'OBSERVADO') > 0 then 'OBSERVADO'
           when count(*) filter (where a.estado = 'PENDIENTE') > 0 then 'PENDIENTE'
           else 'APROBADO'
         end::public.estado_aprobacion
    into v_estado
    from public.aprobaciones a
   where a.documento_id = v_documento;

  update public.documentos d
     set estado_aprobacion = v_estado,
         aprobado_en = case when v_estado = 'APROBADO' then coalesce(d.aprobado_en, now()) end,
         actualizado_en = now()
   where d.id = v_documento
     and (d.estado_aprobacion is distinct from v_estado
          or (v_estado = 'APROBADO') <> (d.aprobado_en is not null));

  return null;
end;
$$;

create trigger trg_aprobaciones_antes
  before insert or update on public.aprobaciones
  for each row execute function public.fn_aprobacion_antes();

create trigger trg_aprobaciones_sincronizar
  after insert or update or delete on public.aprobaciones
  for each row execute function public.fn_aprobacion_sincronizar();

-- =============================================================================
-- TRIGGERS DE NOTAS
-- =============================================================================

create or replace function public.fn_nota_antes()
returns trigger
language plpgsql
as $$
declare
  v_menciones int;
begin
  new.menciones := coalesce(
    (select array_agg(distinct m) from unnest(new.menciones) as m where m is not null),
    '{}'::uuid[]);

  if cardinality(new.menciones) > 0 then
    select count(*) into v_menciones
      from public.usuarios u
     where u.id = any (new.menciones);

    if v_menciones <> cardinality(new.menciones) then
      raise exception 'La nota menciona usuarios que no existen'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- El hilo no cruza entidades: una respuesta pertenece al mismo registro.
  if new.nota_padre_id is not null and not exists (
    select 1 from public.notas p
     where p.id = new.nota_padre_id
       and p.entidad_tabla = new.entidad_tabla
       and p.entidad_id = new.entidad_id
  ) then
    raise exception 'La nota padre pertenece a otra entidad'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and new.texto is distinct from old.texto then
    new.editada_en := now();
  end if;

  return new;
end;
$$;

create trigger trg_notas_entidad
  before insert or update of entidad_tabla, entidad_id, orden_id on public.notas
  for each row execute function public.fn_entidad_polimorfica();

create trigger trg_notas_antes
  before insert or update on public.notas
  for each row execute function public.fn_nota_antes();

-- =============================================================================
-- API DE TRAZABILIDAD
-- =============================================================================

-- Registro de eventos de negocio en la bitácora de una OT con una sola llamada.
-- SECURITY DEFINER porque la bitácora es un historial de solo escritura: al
-- usuario se le permite añadir eventos sin darle permisos directos sobre la
-- tabla, y el usuario del evento sale de la sesión, no de un parámetro.
create or replace function public.registrar_evento_ot(
  p_orden_id    uuid,
  p_tipo_evento public.tipo_evento_ot,
  p_descripcion text,
  p_datos       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_orden_id is null then
    raise exception 'registrar_evento_ot exige una orden de trabajo'
      using errcode = 'null_value_not_allowed';
  end if;

  if nullif(btrim(coalesce(p_descripcion, '')), '') is null then
    raise exception 'El evento necesita una descripción'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.ordenes_trabajo o where o.id = p_orden_id) then
    raise exception 'La orden de trabajo % no existe', p_orden_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.ot_bitacora (orden_id, tipo_evento, descripcion, datos, usuario_id)
  values (p_orden_id, p_tipo_evento, btrim(p_descripcion),
          coalesce(p_datos, '{}'::jsonb), public.usuario_actual())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.registrar_evento_ot is
  'Inserta un evento de negocio en la bitácora de una OT. Es la única puerta que la aplicación necesita para alimentar la línea de tiempo.';

-- Deja constancia de una lectura o descarga. La aplicación la llama por RPC
-- justo antes de entregar la URL firmada del archivo.
create or replace function public.registrar_acceso_documento(
  p_documento_id uuid,
  p_tipo_acceso  public.tipo_acceso_documento default 'VISTA',
  p_version_id   uuid default null,
  p_ip           inet default null,
  p_user_agent   text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.documentos d where d.id = p_documento_id) then
    raise exception 'El documento % no existe', p_documento_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.documento_accesos (documento_id, version_id, usuario_id, tipo_acceso, ip, user_agent)
  values (p_documento_id, p_version_id, public.usuario_actual(), p_tipo_acceso, p_ip, p_user_agent)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.registrar_acceso_documento is
  'Registra quién abrió o descargó un documento. El usuario se toma de la sesión para que el registro no se pueda falsear.';

-- Tipos de documento obligatorios que le faltan a una OT para poder entregarse.
create or replace function public.documentos_obligatorios_faltantes(p_orden_id uuid)
returns table (tipo_documento_id uuid, codigo text, nombre text)
language sql
stable
as $$
  select t.id, t.codigo, t.nombre
    from public.tipos_documento t
   where t.activo
     and t.obligatorio_para_cierre
     and not exists (
       select 1
         from public.documentos d
        where d.tipo_documento_id = t.id
          and d.orden_id = p_orden_id
          and d.estado = 'VIGENTE'
          -- Una cabecera sin archivo no es un documento entregado.
          and d.version_actual > 0
          -- Si el tipo exige firmas, solo cuenta cuando están todas.
          and (d.estado_aprobacion is null or d.estado_aprobacion = 'APROBADO')
     )
   order by t.orden_visualizacion, t.codigo;
$$;

comment on function public.documentos_obligatorios_faltantes is
  'Documentación pendiente de una OT. Devuelve vacío cuando la orden está en condiciones de entregarse.';

-- Regla dura: no se entrega una carrocería sin su documentación. Se aplica en
-- el paso a ENTREGADA y no antes, porque el acta de conformidad y los cargos de
-- entrega se producen justamente en ese momento. Mientras ningún tipo esté
-- marcado como obligatorio_para_cierre, este trigger no bloquea nada.
create or replace function public.fn_ot_exigir_documentos()
returns trigger
language plpgsql
as $$
declare
  v_faltantes text;
begin
  if new.estado = 'ENTREGADA' and old.estado is distinct from new.estado then
    select string_agg(f.nombre, ', ' order by f.nombre)
      into v_faltantes
      from public.documentos_obligatorios_faltantes(new.id) as f;

    if v_faltantes is not null then
      raise exception 'No se puede entregar la orden % sin la documentación obligatoria: %',
        new.numero, v_faltantes
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_ot_exigir_documentos
  before update on public.ordenes_trabajo
  for each row execute function public.fn_ot_exigir_documentos();

-- =============================================================================
-- VISTAS
-- =============================================================================

-- Documento con su versión vigente resuelta. Es la lectura normal del
-- repositorio: quien consulta un documento quiere el último archivo, no la lista.
create view public.v_documentos_vigentes as
select
  d.id,
  d.tipo_documento_id,
  t.codigo               as tipo_codigo,
  t.nombre               as tipo_nombre,
  t.categoria,
  d.titulo,
  d.descripcion,
  d.numero_externo,
  d.fecha_documento,
  d.entidad_tabla,
  d.entidad_id,
  d.orden_id,
  o.numero               as orden_numero,
  d.estado,
  d.es_confidencial,
  d.etiquetas,
  d.version_actual,
  d.estado_aprobacion,
  d.aprobado_en,
  d.vence_en,
  (d.vence_en is not null and d.vence_en < current_date) as vencido,
  v.id                   as version_id,
  v.bucket,
  v.ruta_storage,
  v.nombre_archivo,
  v.extension,
  v.tamano_bytes,
  v.mime_type,
  v.hash_sha256,
  v.subido_por,
  v.subido_en,
  d.creado_por,
  d.creado_en
from public.documentos d
join public.tipos_documento t on t.id = d.tipo_documento_id
left join public.documento_versiones v
       on v.documento_id = d.id and v.version = d.version_actual
left join public.ordenes_trabajo o on o.id = d.orden_id;

comment on view public.v_documentos_vigentes is
  'Cada documento con los datos de su última versión. Las versiones anteriores siguen consultables en documento_versiones.';

-- Documentación pendiente por orden abierta: el semáforo que mira el jefe de
-- taller antes de programar la entrega.
create view public.v_ot_documentos_faltantes as
select
  o.id                as orden_id,
  o.numero            as orden_numero,
  o.cliente_id,
  o.estado,
  f.tipo_documento_id,
  f.codigo            as tipo_codigo,
  f.nombre            as tipo_nombre
from public.ordenes_trabajo o
cross join lateral public.documentos_obligatorios_faltantes(o.id) as f
where o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA');

comment on view public.v_ot_documentos_faltantes is
  'Órdenes abiertas a las que todavía les falta documentación obligatoria para poder entregarse.';

-- Bandeja de firmas.
create view public.v_documentos_por_aprobar as
select
  a.id             as aprobacion_id,
  a.documento_id,
  a.aprobador_id,
  a.orden_firma,
  a.solicitado_en,
  d.titulo,
  d.orden_id,
  d.version_actual,
  t.codigo         as tipo_codigo,
  t.nombre         as tipo_nombre,
  -- Verdadero cuando le toca firmar ya: no hay firmas anteriores pendientes.
  not exists (
    select 1
      from public.aprobaciones p
     where p.documento_id = a.documento_id
       and p.orden_firma < a.orden_firma
       and p.estado = 'PENDIENTE'
  ) as le_toca
from public.aprobaciones a
join public.documentos d on d.id = a.documento_id
join public.tipos_documento t on t.id = d.tipo_documento_id
where a.estado = 'PENDIENTE'
  and d.estado = 'VIGENTE';

comment on view public.v_documentos_por_aprobar is
  'Documentos esperando firma, con la marca de si al aprobador le toca su turno en la cadena.';

-- =============================================================================
-- LÍNEA DE TIEMPO UNIFICADA DE LA ORDEN DE TRABAJO
-- -----------------------------------------------------------------------------
-- Cinco fuentes, una sola lista. No hay tabla materializada detrás a propósito:
-- duplicar los hechos abriría la puerta a que la línea de tiempo cuente una
-- historia distinta de la que cuentan las tablas.
--
-- Las columnas comunes son:
--   orden_id, ocurrido_en, categoria, titulo, detalle, usuario_id,
--   referencia_tabla, referencia_id  (+ referencia_clave y datos, añadidos)
--
-- La vista no lleva ORDER BY: quien consulta añade "order by ocurrido_en desc"
-- y así el planificador puede aprovechar los índices por orden_id de cada rama.
-- =============================================================================

create view public.v_ot_timeline as

-- 1) BITÁCORA · eventos de negocio registrados con registrar_evento_ot
select
  b.orden_id,
  b.creado_en                              as ocurrido_en,
  'BITACORA'::text                         as categoria,
  replace(b.tipo_evento::text, '_', ' ')   as titulo,
  b.descripcion                            as detalle,
  b.usuario_id,
  'ot_bitacora'::text                      as referencia_tabla,
  b.id                                     as referencia_id,
  b.id::text                               as referencia_clave,
  b.datos                                  as datos
from public.ot_bitacora b

union all

-- 2) DOCUMENTOS · lo adjuntado a la OT, con la versión vigente
select
  d.orden_id,
  coalesce(v.subido_en, d.creado_en),
  'DOCUMENTO'::text,
  t.nombre || ': ' || d.titulo,
  concat_ws(' · ',
    'v' || d.version_actual,
    nullif(v.nombre_archivo, ''),
    nullif(d.numero_externo, ''),
    nullif(d.descripcion, '')),
  coalesce(v.subido_por, d.creado_por),
  'documentos'::text,
  d.id,
  d.id::text,
  jsonb_build_object(
    'tipo', t.codigo,
    'categoria', t.categoria,
    'version', d.version_actual,
    'estado', d.estado,
    'aprobacion', d.estado_aprobacion,
    'confidencial', d.es_confidencial,
    'etiquetas', to_jsonb(d.etiquetas))
from public.documentos d
join public.tipos_documento t on t.id = d.tipo_documento_id
left join public.documento_versiones v
       on v.documento_id = d.id and v.version = d.version_actual
where d.orden_id is not null
  and d.estado <> 'ANULADO'

union all

-- 3) ALMACÉN · solo movimientos confirmados; un borrador todavía no ocurrió
select
  m.orden_id,
  coalesce(m.fecha_confirmacion, m.fecha::timestamptz),
  'ALMACEN'::text,
  replace(m.tipo::text, '_', ' ') || ' ' || m.numero,
  concat_ws(' · ',
    a.nombre,
    'valorizado ' || to_char(m.total_valorizado, 'FM999G999G990D00'),
    nullif(m.documento_referencia, ''),
    nullif(m.motivo, '')),
  coalesce(m.confirmado_por, m.responsable_id),
  'movimientos_almacen'::text,
  m.id,
  m.id::text,
  jsonb_build_object(
    'tipo', m.tipo,
    'numero', m.numero,
    'almacen', a.codigo,
    'total_valorizado', m.total_valorizado)
from public.movimientos_almacen m
join public.almacenes a on a.id = m.almacen_id
where m.orden_id is not null
  and m.estado = 'CONFIRMADO'

union all

-- 4) CALIDAD · inspecciones de la orden
select
  i.orden_id,
  i.fecha,
  'CALIDAD'::text,
  'Inspección ' || i.numero || ' · ' || i.resultado::text,
  concat_ws(' · ',
    nullif(i.observaciones, ''),
    nullif(i.acciones_correctivas, '')),
  i.inspector_id,
  'ot_inspecciones'::text,
  i.id,
  i.id::text,
  jsonb_build_object(
    'resultado', i.resultado,
    'numero', i.numero,
    'etapa_id', i.etapa_id,
    'levantada', i.fecha_levantamiento is not null)
from public.ot_inspecciones i

union all

-- 5) AUDITORÍA · cambios sobre la fila de la propia OT.
--    referencia_id queda nula porque audit_log.id es bigint y no cabe en un
--    uuid; la clave del evento viaja en referencia_clave, que es text en todas
--    las ramas justamente para poder cargar con este caso.
select
  l.registro_id,
  l.creado_en,
  'AUDITORIA'::text,
  case l.accion
    when 'INSERT' then 'Orden registrada'
    when 'UPDATE' then 'Modificación de la orden'
    else 'Orden eliminada'
  end,
  case
    when l.campos_modificados is not null
      then 'Campos: ' || array_to_string(l.campos_modificados, ', ')
  end,
  l.usuario_id,
  'audit_log'::text,
  null::uuid,
  l.id::text,
  jsonb_strip_nulls(jsonb_build_object(
    'accion', l.accion,
    'campos', to_jsonb(l.campos_modificados)))
from public.audit_log l
where l.tabla = 'ordenes_trabajo'
  and l.registro_id is not null;

comment on view public.v_ot_timeline is
  'Línea de tiempo de una orden de trabajo: bitácora, documentos, movimientos de almacén confirmados, inspecciones y cambios auditados de la OT. Se consulta filtrando por orden_id y ordenando por ocurrido_en desc.';

-- =============================================================================
-- BUCKETS DE SUPABASE STORAGE
-- -----------------------------------------------------------------------------
-- Se declaran aquí porque son parte del modelo: documento_versiones.bucket solo
-- admite estos tres valores. El bloque se salta cuando el esquema storage no
-- existe, para que las migraciones puedan correr contra un Postgres pelado.
-- =============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Esquema storage no disponible: se omite la creación de buckets.';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values
    -- Todo el repositorio documental: planos, facturas, guías, certificados, actas.
    ('documentos',   'documentos',   false),
    -- Fotografías del avance de fabricación y del estado de la unidad al ingresar.
    ('fotos-avance', 'fotos-avance', false),
    -- Único bucket público: logotipos que se incrustan en cotizaciones y reportes.
    ('logos',        'logos',        true)
  on conflict (id) do nothing;
end;
$$;

-- =============================================================================
-- TIMESTAMPS Y AUDITORÍA
-- =============================================================================

do $$
declare t text;
begin
  -- documento_accesos queda fuera: es una tabla append-only sin actualizado_en.
  foreach t in array array[
    'tipos_documento', 'documentos', 'documento_versiones', 'aprobaciones', 'notas'
  ] loop
    perform public.activar_timestamps(t);
  end loop;

  -- Todo lo que afecta a la evidencia documental se audita:
  --   · tipos_documento porque cambiar extensiones, obligatoriedad o aprobación
  --     altera las reglas bajo las que se aceptaron documentos anteriores
  --   · documento_versiones porque un DELETE deja huérfano un archivo de Storage
  --     y debe quedar constancia de quién lo borró
  --   · aprobaciones porque su historial de decisiones se reinicia al subir una
  --     versión nueva, y ese historial solo sobrevive en audit_log
  --   · notas porque editar o borrar un comentario cambia lo que se acordó
  -- documento_accesos no se audita: la tabla ya es en sí misma el registro de
  -- auditoría, y duplicarla en audit_log solo generaría ruido.
  foreach t in array array[
    'tipos_documento', 'documentos', 'documento_versiones', 'aprobaciones', 'notas'
  ] loop
    perform public.activar_auditoria(t);
  end loop;
end;
$$;

-- =============================================================================
-- SEGURIDAD A NIVEL DE FILA
-- -----------------------------------------------------------------------------
-- Las POLÍTICAS de estas tablas van en la migración 0007, junto con las del
-- resto del sistema. Aquí solo se activa RLS, porque 0007 termina comprobando
-- que ninguna tabla de public quede sin activar y una tabla nueva sin RLS haría
-- fallar esa comprobación. Hasta que 0007 escriba las políticas de este módulo
-- (permisos documentos.ver / documentos.subir / documentos.aprobar /
-- documentos.eliminar, ya sembrados en 0008), estas tablas están cerradas para
-- todos salvo el propietario del esquema, que es el comportamiento seguro.
-- =============================================================================

alter table public.tipos_documento     enable row level security;
alter table public.documentos          enable row level security;
alter table public.documento_versiones enable row level security;
alter table public.aprobaciones        enable row level security;
alter table public.documento_accesos   enable row level security;
alter table public.notas               enable row level security;
