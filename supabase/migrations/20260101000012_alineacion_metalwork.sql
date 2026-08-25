-- =============================================================================
-- 012 · Alineación con los formatos reales de Metal Work Perú S.A.C.
-- =============================================================================
-- Hasta aquí el esquema seguía el estándar del sector metalmecánico peruano.
-- Esta migración lo ajusta a lo que la empresa usa de verdad, tomado de sus
-- propios archivos en OneDrive:
--
--   · Organigrama y códigos de área  ......  "CODIFICACION DE AREAS.xlsx"
--   · Codificación documental SIG  ........  idem, hoja "GCO"/"ING"/"DIS"
--   · Etapas y días de fabricación  .......  "FECHAS DE LOS PROCESOS DE
--                                             FABRICACIÓN - ACTUAL.xlsx"
--   · Estados por área  ...................  "CONTROL DE AREAS - ADMI.xlsx"
--                                             (formato MW-FOR-ADM-7)
--   · Numeración real de OT / COT / OC  ...  OT 2920, COT 3567, OC-5580-MW
--   · Código interno de unidad  ...........  "VSC_SR_O4_6_26/30"
--
-- Solo cubre Metal Work Perú. JAMISA S.A.C. comparte el OneDrive pero queda
-- fuera de alcance por indicación expresa.
-- =============================================================================


-- =============================================================================
-- ÁREAS · el organigrama real, con sus códigos
-- =============================================================================
-- Estos códigos de tres letras no son decorativos: son el segmento central de
-- todo código documental de la empresa (MW-FOR-**ADM**-7), así que la tabla es
-- la fuente de la que se arma ese código, no una lista suelta.

create table if not exists public.areas (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique check (codigo ~ '^[A-Z]{3}$'),
  nombre          text not null,
  -- Nombre del responsable tal como figura en el organigrama. Se guarda como
  -- texto y no como FK a usuarios porque el organigrama nombra a la persona
  -- aunque todavía no tenga cuenta en el sistema.
  encargado       text,
  orden_secuencia int not null unique check (orden_secuencia > 0),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

comment on table public.areas is
  'Áreas del organigrama de Metal Work Perú. El código de tres letras es el segmento de área de todo código documental SIG (MW-TIPO-AREA-N).';

insert into public.areas (codigo, nombre, encargado, orden_secuencia) values
  ('GGE', 'Gerencia General',       null,                              1),
  ('GCO', 'Gerencia Comercial',     null,                              2),
  ('GOP', 'Gerencia de Operaciones', null,                             3),
  ('ADM', 'Administración',         null,                              4),
  ('RRH', 'Recursos Humanos',       'Shantal',                         5),
  ('MKT', 'Marketing',              null,                              6),
  ('CON', 'Contabilidad',           'Greys',                           7),
  ('TES', 'Tesorería',              'Margarita',                       8),
  ('LOG', 'Logística',              'Viviana',                         9),
  ('ALM', 'Almacén',                'Jesús',                          10),
  ('REQ', 'Requerimientos',         'Fernando',                       11),
  ('ING', 'Ingeniería',             'Ingenieros de diseño',           12),
  ('DIS', 'Diseño',                 'Frank',                          13),
  ('MTZ', 'Maestranza',             'Edson',                          14),
  ('PRD', 'Producción',             'Santiago',                       15),
  ('ACB', 'Acabados',               'Santiago',                       16),
  ('MNT', 'Mantenimiento',          'Diego',                          17),
  ('GRT', 'Garantías',              'Diego',                          18),
  ('CAL', 'Calidad',                null,                             19),
  ('SST', 'SSOMA',                  null,                             20),
  ('TIC', 'TI / Soporte',           null,                             21)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      encargado = excluded.encargado,
      orden_secuencia = excluded.orden_secuencia;

select public.activar_timestamps('areas');
select public.activar_auditoria('areas');

-- Cada persona pertenece a un área. El rol dice qué puede hacer; el área, en
-- qué parte del taller trabaja. Son cosas distintas y se necesitan las dos:
-- el tablero de control de unidades se agrupa por área, no por rol.
alter table public.usuarios
  add column if not exists area_id uuid references public.areas(id) on delete set null;

comment on column public.usuarios.area_id is
  'Área del organigrama a la que pertenece. Distinto del rol: el rol otorga permisos, el área agrupa el trabajo en el tablero de unidades.';

create index if not exists ix_usuarios_area on public.usuarios(area_id) where activo;


-- =============================================================================
-- CODIFICACIÓN DOCUMENTAL SIG
-- =============================================================================
-- La empresa codifica todo documento como MW-{TIPO}-{ÁREA}-{N°}. Ejemplos
-- reales encontrados: MW-FOR-ADM-7, MW-PRO-ING-1, MW-FOR-DIS-3, MW-FOR-MTZ-2,
-- MW-MAN-RRH-01.

create table if not exists public.tipos_documento_sig (
  codigo         text primary key check (codigo ~ '^[A-Z]{3}$'),
  nombre         text not null,
  uso_tipico     text,
  orden_secuencia int not null unique check (orden_secuencia > 0),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.tipos_documento_sig is
  'Catálogo de tipos del estándar SIG de la empresa (MAN, PRO, INS, FOR, REG...). Es el segundo segmento del código documental.';

insert into public.tipos_documento_sig (codigo, nombre, uso_tipico, orden_secuencia) values
  ('MAN', 'Manual',                  'Manual SIG, Calidad, SSOMA, Ambiental u Operaciones',        1),
  ('PRO', 'Procedimiento',           'Procesos clave y de apoyo; incluye flujogramas firmados',    2),
  ('INS', 'Instructivo',             'Tareas operativas detalladas (SOP)',                          3),
  ('PLN', 'Plan',                    'Planes de calidad, ambiental, SST, mantenimiento, auditoría', 4),
  ('POL', 'Política',                'Políticas corporativas',                                      5),
  ('ESP', 'Especificación',          'Requisitos técnicos, de materiales o de acabados',            6),
  ('FOR', 'Formato',                 'Plantillas para registros',                                   7),
  ('REG', 'Registro',                'Documentos completados: la evidencia',                        8),
  ('MAT', 'Matriz',                  'IPERC, aspectos ambientales, competencias, riesgos',          9),
  ('PRG', 'Programa',                'Cronogramas maestros: auditorías, calibración, formación',   10),
  ('IRG', 'Instructivo de registro', 'Cómo llenar un formato específico',                          11),
  ('DEX', 'Documento externo',       'Normas, leyes, catálogos, manuales del fabricante',          12),
  ('DOC', 'Documento',               'Documento que no encaja en los tipos anteriores',            13)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      uso_tipico = excluded.uso_tipico,
      orden_secuencia = excluded.orden_secuencia;

select public.activar_timestamps('tipos_documento_sig');

-- El código SIG se arma solo. Es una columna generada y no un texto libre
-- para que nadie pueda escribir "MW-FOR-ADM-7" en un formato del área de
-- diseño: el código y el área siempre coinciden porque salen de la misma fila.
alter table public.tipos_documento
  add column if not exists tipo_sig       text references public.tipos_documento_sig(codigo) on delete restrict,
  add column if not exists area_codigo    text references public.areas(codigo) on delete restrict,
  add column if not exists correlativo_sig int check (correlativo_sig is null or correlativo_sig > 0);

alter table public.tipos_documento
  add column if not exists codigo_sig text generated always as (
    case
      when tipo_sig is not null and area_codigo is not null and correlativo_sig is not null
        then 'MW-' || tipo_sig || '-' || area_codigo || '-' || correlativo_sig::text
    end
  ) stored;

comment on column public.tipos_documento.codigo_sig is
  'Código documental de la empresa, armado a partir de tipo, área y correlativo: MW-FOR-ADM-7. Se calcula solo; no se escribe a mano.';

-- Dos formatos distintos no pueden compartir código.
create unique index if not exists ux_tipos_documento_codigo_sig
  on public.tipos_documento(codigo_sig) where codigo_sig is not null;

-- Los tres segmentos van juntos o no va ninguno: un código a medias no
-- identifica nada y ensucia los listados del área de calidad.
alter table public.tipos_documento
  drop constraint if exists ck_tipos_documento_sig_completo;
alter table public.tipos_documento
  add constraint ck_tipos_documento_sig_completo check (
    num_nonnulls(tipo_sig, area_codigo, correlativo_sig) in (0, 3)
  );


-- =============================================================================
-- CÓDIGO INTERNO DE LA UNIDAD
-- =============================================================================
-- La empresa identifica cada unidad fabricada con un código propio del tipo
-- "VSC_SR_O4_6_26/30" o "VPP_CM_N1_2_26/41", que aparece tanto en la orden de
-- trabajo como en el control de unidades. Es independiente de la placa: la
-- unidad tiene código interno desde antes de estar matriculada.

alter table public.unidades
  add column if not exists codigo_interno text;

comment on column public.unidades.codigo_interno is
  'Código interno de fabricación de la empresa (p. ej. VSC_SR_O4_6_26/30). Existe desde antes de que la unidad tenga placa.';

create index if not exists ix_unidades_codigo_interno
  on public.unidades(codigo_interno) where codigo_interno is not null;


-- =============================================================================
-- ETAPAS REALES DE FABRICACIÓN
-- =============================================================================
-- Las etapas que traía el sistema eran las de un taller de soldadura genérico.
-- Las de Metal Work son otras: incluyen diseño, requerimientos, logística,
-- aprobación de cotizaciones, almacén y trámite vehicular, porque su cuello de
-- botella no está en el taller sino en conseguir el material a tiempo.
--
-- Los días son los de su propio cronograma. Suman más de 45 porque las etapas
-- se solapan: el plan maestro de la empresa es DISEÑO 15 + MAESTRANZA 20 +
-- PRODUCCIÓN Y ACABADOS 10 = 45 días. Por eso casi todas permiten paralelo.

alter table public.etapas_catalogo
  add column if not exists dias_estandar int not null default 0 check (dias_estandar >= 0);

comment on column public.etapas_catalogo.dias_estandar is
  'Días de calendario que la empresa asigna a la etapa en su cronograma. Es lo que planifica de verdad; horas_estandar solo pondera el avance.';

-- Se aparta el catálogo anterior en lugar de borrarlo: si alguna OT histórica
-- llegara a referenciarlo, el borrado fallaría y la migración quedaría a medias.
-- orden_secuencia es único, así que hay que liberar los puestos 1..14 antes de
-- insertar los nuevos.
update public.etapas_catalogo
   set orden_secuencia = orden_secuencia + 100,
       activo = false
 where orden_secuencia < 100;

insert into public.etapas_catalogo
  (codigo, nombre, descripcion, orden_secuencia, dias_estandar, horas_estandar,
   requiere_inspeccion, permite_paralelo, color) values
  ('OT_EMISION',      'Emisión de orden de trabajo',
   'Administración emite la OT a partir de la cotización aprobada y la registra en el control de unidades',
    1,  1,   8, false, false, '#0F172A'),
  ('DISENO',          'Diseño',
   'Planos por bloques, control dimensional y entrega de planos a maestranza',
    2, 13, 104, true,  true,  '#6366F1'),
  ('REQ_MAESTRANZA',  'Requerimientos · Maestranza',
   'Requerimiento de materia prima y parte estructural para los bloques de maestranza',
    3, 10,  80, false, true,  '#0EA5E9'),
  ('REQ_PRODUCCION',  'Requerimientos · Producción',
   'Requerimiento de accesorios y de los sistemas mecánico, neumático, eléctrico e hidráulico',
    4, 12,  96, false, true,  '#06B6D4'),
  ('LOGISTICA',       'Logística',
   'Compra y traslado del material requerido hasta planta',
    5, 17, 136, false, true,  '#F97316'),
  ('APROB_COTIZACION','Aprobación de cotizaciones',
   'Aprobación de las cotizaciones de proveedores por gerencia',
    6, 16, 128, false, true,  '#EAB308'),
  ('ALMACEN',         'Almacén',
   'Recepción, control de calidad de materia prima y custodia hasta el habilitado',
    7, 17, 136, true,  true,  '#78716C'),
  ('HABILITADO_MP',   'Habilitado de materia prima',
   'Corte, plegado y habilitado de planchas y perfiles en maestranza',
    8, 12,  96, false, false, '#64748B'),
  ('PRODUCCION',      'Producción · Ensamblado',
   'Armado de estructura, soldadura y montaje de sistemas',
    9, 15, 120, true,  false, '#EF4444'),
  ('ARENADO',         'Arenado',
   'Arenado industrial previo a la pintura',
   10,  1,   8, false, false, '#A3A3A3'),
  ('PINTURA',         'Pintura',
   'Base epóxica, acabado gloss, stickers y cinta reflectiva',
   11,  6,  48, false, false, '#8B5CF6'),
  ('ELECTRICO_NEUM',  'Sistema eléctrico y neumático',
   'Instalación de arnés, luces, señalización y sistema de aire',
   12,  1,   8, false, false, '#F59E0B'),
  ('CALIDAD',         'Pruebas de la unidad · Control de calidad',
   'Pruebas de funcionamiento e inspección final antes de liberar la unidad',
   13,  1,   8, true,  false, '#22C55E'),
  ('ENTREGA',         'Trámite documentario · Entrega · Check list',
   'Certificados, tarjeta y placas, check list de salida y entrega al cliente',
   14,  1,   8, false, false, '#16A34A')
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion,
      orden_secuencia = excluded.orden_secuencia,
      dias_estandar = excluded.dias_estandar,
      horas_estandar = excluded.horas_estandar,
      requiere_inspeccion = excluded.requiere_inspeccion,
      permite_paralelo = excluded.permite_paralelo,
      color = excluded.color,
      activo = true;


-- =============================================================================
-- NUMERACIÓN REAL DE DOCUMENTOS
-- =============================================================================
-- La empresa no numera como el sistema venía numerando. Sus formatos reales:
--
--   Orden de trabajo   2909-2026        número correlativo global y año
--   Cotización         3567-2025        número correlativo global y año
--   Orden de compra    OC-5580-MW       prefijo, número y sigla de empresa
--
-- Se agrega una plantilla por serie en lugar de codificar cada caso, para que
-- puedan cambiar el formato desde Configuración sin tocar una función.

alter table public.series_documentarias
  add column if not exists formato text not null default '{prefijo}-{serie}-{numero}';

comment on column public.series_documentarias.formato is
  'Plantilla del número emitido. Marcadores: {prefijo} {serie} {numero} {anio}. Un {prefijo} vacío no deja guiones sueltos.';

alter table public.series_documentarias
  drop constraint if exists ck_series_formato_tiene_numero;
alter table public.series_documentarias
  add constraint ck_series_formato_tiene_numero
    check (formato like '%{numero}%');

create or replace function public.siguiente_correlativo(
  p_tipo  public.tipo_correlativo,
  p_serie text default null,
  p_sede  uuid default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serie_id  uuid;
  v_serie     text;
  v_prefijo   text;
  v_longitud  int;
  v_formato   text;
  v_numero    bigint;
  v_resultado text;
begin
  -- Se busca primero la serie de la sede y solo si no hay, la global. El
  -- SELECT ... FOR UPDATE bloquea exactamente una fila: dos usuarios grabando
  -- a la vez se serializan aquí y nunca reciben el mismo número.
  if p_sede is not null then
    select id into v_serie_id
      from public.series_documentarias
     where tipo = p_tipo
       and (p_serie is null or serie = p_serie)
       and activo
       and sede_id = p_sede
     order by serie
     limit 1
     for update;
  end if;

  if v_serie_id is null then
    select id into v_serie_id
      from public.series_documentarias
     where tipo = p_tipo
       and (p_serie is null or serie = p_serie)
       and activo
       and sede_id is null
     order by serie
     limit 1
     for update;
  end if;

  if v_serie_id is null then
    raise exception 'No existe una serie documentaria activa para el tipo % (serie %, sede %)',
      p_tipo, coalesce(p_serie, '<cualquiera>'), coalesce(p_sede::text, '<global>')
      using errcode = 'no_data_found';
  end if;

  update public.series_documentarias
     set correlativo_actual = correlativo_actual + 1,
         actualizado_en = now()
   where id = v_serie_id
  returning serie, prefijo, longitud, correlativo_actual, formato
    into v_serie, v_prefijo, v_longitud, v_numero, v_formato;

  v_resultado := replace(v_formato, '{numero}', lpad(v_numero::text, v_longitud, '0'));
  v_resultado := replace(v_resultado, '{serie}',   v_serie);
  v_resultado := replace(v_resultado, '{anio}',    to_char(now(), 'YYYY'));
  v_resultado := replace(v_resultado, '{prefijo}', coalesce(nullif(v_prefijo, ''), ''));

  -- Un prefijo vacío dejaría el número empezando en guion ("-001-00042").
  v_resultado := btrim(v_resultado, '-');
  return regexp_replace(v_resultado, '-{2,}', '-', 'g');
end;
$$;

comment on function public.siguiente_correlativo(public.tipo_correlativo, text, uuid) is
  'Entrega el siguiente número de una serie documentaria, bloqueando la fila para que dos usuarios simultáneos nunca reciban el mismo. El formato sale de la plantilla de la serie.';

-- Numeración vigente al momento de la puesta en marcha, tomada de los
-- documentos de la empresa: OT 2920, COT 3567 y OC-5580-MW son los últimos
-- emitidos, de modo que el sistema continúa desde ahí.
update public.series_documentarias
   set formato = '{numero}-{anio}', longitud = 4, prefijo = '',
       correlativo_actual = greatest(correlativo_actual, 2920)
 where tipo = 'ORDEN_TRABAJO' and sede_id is null;

update public.series_documentarias
   set formato = '{numero}-{anio}', longitud = 4, prefijo = '',
       correlativo_actual = greatest(correlativo_actual, 3567)
 where tipo = 'COTIZACION' and sede_id is null;

update public.series_documentarias
   set formato = 'OC-{numero}-MW', longitud = 4, prefijo = 'OC',
       correlativo_actual = greatest(correlativo_actual, 5580)
 where tipo = 'ORDEN_COMPRA' and sede_id is null;


-- =============================================================================
-- COMPROBACIONES
-- =============================================================================

do $$
declare
  v_faltan int;
begin
  select count(*) into v_faltan
    from public.etapas_catalogo
   where activo and orden_secuencia between 1 and 14;
  if v_faltan <> 14 then
    raise exception 'Se esperaban 14 etapas activas de fabricación y hay %', v_faltan;
  end if;

  select count(*) into v_faltan from public.areas where activo;
  if v_faltan <> 21 then
    raise exception 'Se esperaban 21 áreas del organigrama y hay %', v_faltan;
  end if;

  -- El formato de cada serie tiene que producir algo utilizable: si a alguien
  -- se le va un marcador mal escrito, esto lo detiene aquí y no en producción
  -- cuando un usuario intente grabar una orden.
  if exists (select 1 from public.series_documentarias
              where formato !~ '\{numero\}') then
    raise exception 'Hay series documentarias cuyo formato no incluye {numero}';
  end if;
end;
$$;


-- =============================================================================
-- SEGURIDAD DE LAS TABLAS NUEVAS
-- =============================================================================
-- La migración 0007 comprueba que ninguna tabla quede sin RLS, pero ya se
-- ejecutó: las tablas creadas aquí quedarían abiertas si no se protegen en
-- esta misma migración. Se usa el mismo criterio que el resto de catálogos:
-- las lee quien puede ver la configuración, las escribe quien puede editarla.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('areas',               'configuracion.ver', 'configuracion.editar'),
      ('tipos_documento_sig', 'configuracion.ver', 'configuracion.editar')
    ) as t(tabla, permiso_ver, permiso_escribir)
  loop
    execute format('alter table public.%I enable row level security', r.tabla);

    execute format('drop policy if exists %I on public.%I', 'ver_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.es_admin() or public.tiene_permiso(%L))',
      'ver_' || r.tabla, r.tabla, r.permiso_ver);

    execute format('drop policy if exists %I on public.%I', 'crear_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.es_admin() or public.tiene_permiso(%L))',
      'crear_' || r.tabla, r.tabla, r.permiso_escribir);

    execute format('drop policy if exists %I on public.%I', 'editar_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.es_admin() or public.tiene_permiso(%L))
         with check (public.es_admin() or public.tiene_permiso(%L))',
      'editar_' || r.tabla, r.tabla, r.permiso_escribir, r.permiso_escribir);

    -- Borrar sigue siendo exclusivo de ADMIN: el resto desactiva, no elimina.
    execute format('drop policy if exists %I on public.%I', 'borrar_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.es_admin())',
      'borrar_' || r.tabla, r.tabla);
  end loop;
end;
$$;

-- Recrear una función restablece sus permisos por defecto, y el permiso por
-- defecto de Postgres es EXECUTE para PUBLIC. Como siguiente_correlativo() se
-- redefinió arriba y es SECURITY DEFINER, sin esto el rol anon volvería a
-- poder llamarla y quemar correlativos sin haber iniciado sesión.
revoke execute on function public.siguiente_correlativo(public.tipo_correlativo, text, uuid) from public;
revoke execute on function public.siguiente_correlativo(public.tipo_correlativo, text, uuid) from anon;
grant  execute on function public.siguiente_correlativo(public.tipo_correlativo, text, uuid) to authenticated, service_role;

do $$
declare
  v_sin_rls    int;
  v_sin_polit  int;
  v_anon_puede boolean;
begin
  select count(*) into v_sin_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_sin_rls > 0 then
    raise exception 'Quedaron % tablas de public sin RLS activo', v_sin_rls;
  end if;

  select count(*) into v_sin_polit
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  if v_sin_polit > 0 then
    raise exception 'Quedaron % tablas con RLS activo y ninguna política: nadie podría leerlas', v_sin_polit;
  end if;

  select has_function_privilege('anon',
           'public.siguiente_correlativo(public.tipo_correlativo, text, uuid)', 'execute')
    into v_anon_puede;
  if v_anon_puede then
    raise exception 'El rol anon todavía puede ejecutar siguiente_correlativo()';
  end if;
end;
$$;
