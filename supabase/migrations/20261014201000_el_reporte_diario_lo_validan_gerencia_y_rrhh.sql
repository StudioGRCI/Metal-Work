-- =============================================================================
-- SUPERVISIÓN: EL REPORTE DIARIO LO VALIDAN GERENCIA Y RECURSOS HUMANOS
-- -----------------------------------------------------------------------------
-- El supervisor sube su reporte diario (20261014180000) y sus horas pasan solas
-- al costeo de RR. HH. Gerencia pidió (2026-10-14) que de esos reportes salga
-- también lo que se le paga a la gente: una PLANILLA DIARIA que va a Tesorería
-- (20261014202000). Para pagar sobre un reporte, antes tienen que darle su
-- VISTO BUENO dos áreas, en cualquier orden:
--
--   * GERENCIA, que mira que el trabajo y el avance sean ciertos.
--   * RECURSOS HUMANOS, que mira la gente y sus horas.
--
-- Si cualquiera de las dos ve algo mal, lo OBSERVA con su motivo y el reporte
-- vuelve al supervisor. Un reporte ya subido sigue sin corregirse: el
-- supervisor lo CORRIGE Y LO SUBE DE NUEVO desde el observado (con lo mismo
-- escrito y las mismas fotos, para no teclearlo otra vez), y el observado queda
-- anulado, con el motivo y el enlace al que lo reemplaza. El corregido vuelve a
-- pasar por las dos áreas.
--
-- Mientras no lo validen las dos, sus horas no se pagan; al costeo siguen
-- entrando al subirlo, como hasta ahora. En pantalla se nombra el área que dio
-- el visto o la observación, nunca a la persona. Sin DROP: el conector de
-- producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos ------------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('reporte_diario.validar_gerencia', 'Supervisión',
   'Dar el visto bueno de Gerencia a un reporte diario, u observarlo para que el supervisor lo corrija'),
  ('reporte_diario.validar_rrhh', 'Supervisión',
   'Dar el visto bueno de Recursos Humanos a un reporte diario, u observarlo para que el supervisor lo corrija')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'GERENTE' and p.codigo = 'reporte_diario.validar_gerencia')
    or (r.codigo = 'RECURSOS_HUMANOS' and p.codigo = 'reporte_diario.validar_rrhh')
on conflict do nothing;

-- 2. El visto de cada área y la observación --------------------------------------------
alter table public.reportes_diarios
  add column if not exists visto_gerencia_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists visto_gerencia_en  timestamptz,
  add column if not exists visto_rrhh_por     uuid references public.usuarios(id) on delete restrict,
  add column if not exists visto_rrhh_en      timestamptz,
  add column if not exists observado_por      uuid references public.usuarios(id) on delete restrict,
  add column if not exists observado_en       timestamptz,
  add column if not exists observacion_area   text,
  add column if not exists observacion        text,
  add column if not exists reemplaza_a        uuid references public.reportes_diarios(id) on delete restrict;

comment on column public.reportes_diarios.observacion_area is 'GERENCIA o RRHH: el área que lo observó. En pantalla se nombra el área, no la persona.';
comment on column public.reportes_diarios.reemplaza_a is 'El reporte observado que este corrige; aquel quedó anulado al subir este.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_reporte_diario_validacion') then
    alter table public.reportes_diarios add constraint ck_reporte_diario_validacion check (
      (visto_gerencia_en is null) = (visto_gerencia_por is null)
      and (visto_rrhh_en is null) = (visto_rrhh_por is null)
      and (observado_en is null
           or (observado_por is not null and observacion_area in ('GERENCIA', 'RRHH')
               and char_length(btrim(coalesce(observacion, ''))) between 10 and 500))
      and reemplaza_a is distinct from id);
  end if;
end $$;

-- El observado muestra qué reporte lo corrigió (b). Las llaves de quién dio el
-- visto u observó: ni (a) ni (b) ni (c), sin índice.
create index if not exists ix_reportes_diarios_reemplaza on public.reportes_diarios (reemplaza_a) where reemplaza_a is not null;

-- Las fotos del observado pasan al corregido: una misma foto puede nombrarla
-- más de un reporte (el anulado y el que lo corrige). La política de Storage la
-- sigue buscando por su ruta (b).
alter table public.reporte_diario_fotos drop constraint if exists uq_reporte_diario_foto_ruta;
create index if not exists ix_reporte_diario_fotos_ruta on public.reporte_diario_fotos (ruta);

-- 3. En qué va un reporte ------------------------------------------------------------------
create or replace function public.reporte_diario_estado(p public.reportes_diarios)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p.anulado_en is not null then 'ANULADO'
    when p.observado_en is not null then 'OBSERVADO'
    when p.visto_gerencia_en is not null and p.visto_rrhh_en is not null then 'VALIDADO'
    else 'POR_VALIDAR'
  end;
$$;
revoke all on function public.reporte_diario_estado(public.reportes_diarios) from public, anon, authenticated;

-- 4. Lo que no se corrige (ahora con el visto y la observación) ------------------------------
create or replace function public.fn_reporte_diario_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en',
    'visto_gerencia_por', 'visto_gerencia_en', 'visto_rrhh_por', 'visto_rrhh_en',
    'observado_por', 'observado_en', 'observacion_area', 'observacion'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reporte diario no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese reporte está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Un reporte ya subido no se corrige: anúlalo con su motivo y súbelo de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_reporte_diario_guardia() from public, anon, authenticated;

-- 5. Subir el reporte (y el corregido) --------------------------------------------------------
-- Lo mismo que hacía registrar_reporte_diario en 20261014180000, más el reporte
-- que corrige: con él vale la fecha del observado aunque pasaran los 7 días, y
-- valen sus fotos. La llaman solo las dos funciones de abajo, que ya exigieron
-- el permiso y ya comprobaron el reintento.
create or replace function public.reporte_diario_insertar(
  p_id uuid, p_fecha date, p_codigo_interno text, p_asunto text, p_descripcion text,
  p_trabajos jsonb, p_personal_general jsonb, p_fotos jsonb, p_reemplaza uuid
) returns uuid language plpgsql set search_path to 'public' as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_codigo   text := upper(btrim(coalesce(p_codigo_interno, '')));
  v_asunto   text := btrim(coalesce(p_asunto, ''));
  v_desc     text := btrim(coalesce(p_descripcion, ''));
  v_general  boolean := coalesce(jsonb_typeof(p_personal_general) = 'array' and jsonb_array_length(p_personal_general) > 0, false);
  v_fotos    jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_fecha_previa date;
  v_reporte  public.reportes_diarios%rowtype;
  v_trabajo  jsonb;
  v_persona  jsonb;
  v_orden    int := 0;
  v_tid      uuid;
  v_tdesc    text;
  v_avance   numeric;
  v_ruta     text;
  v_objeto   storage.objects%rowtype;
  v_nfoto    int := 0;
begin
  if p_reemplaza is not null then
    select fecha into v_fecha_previa from public.reportes_diarios where id = p_reemplaza;
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'Elige el día del reporte: hoy o un día anterior.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_hoy - 7 and p_fecha is distinct from v_fecha_previa then
    raise exception 'El reporte se sube hasta 7 días después; para uno más antiguo, habla con Recursos Humanos.' using errcode = 'check_violation';
  end if;
  if char_length(v_codigo) not between 2 and 60 then
    raise exception 'Escribe el código interno (de 2 a 60 caracteres), por ejemplo PLA_SR_O4_1_26/28 o PLANTA.' using errcode = 'check_violation';
  end if;
  if char_length(v_asunto) not between 3 and 120 then
    raise exception 'Escribe el asunto del reporte (de 3 a 120 caracteres).' using errcode = 'check_violation';
  end if;
  if char_length(v_desc) not between 3 and 1000 then
    raise exception 'Escribe una breve descripción del reporte (de 3 a 1000 caracteres).' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_trabajos) is distinct from 'array' or jsonb_array_length(p_trabajos) = 0 then
    raise exception 'Anota al menos un trabajo realizado.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_trabajos) > 20 then
    raise exception 'Un reporte lleva hasta 20 trabajos.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(v_fotos) <> 'array' or jsonb_array_length(v_fotos) > 3 then
    raise exception 'Un reporte lleva hasta 3 fotos.' using errcode = 'check_violation';
  end if;

  insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, personal_general, area_id, registrado_por, reemplaza_a)
  values (p_id, p_fecha, v_codigo, v_asunto, v_desc, v_general, (select u.area_id from public.usuarios u where u.id = v_yo), v_yo, p_reemplaza)
  returning * into v_reporte;

  for v_trabajo in select * from jsonb_array_elements(p_trabajos) loop
    v_orden := v_orden + 1;
    v_tdesc := btrim(coalesce(v_trabajo->>'descripcion', ''));
    if char_length(v_tdesc) not between 3 and 500 then
      raise exception 'Describe el trabajo % (de 3 a 500 caracteres).', v_orden using errcode = 'check_violation';
    end if;
    begin
      v_avance := (v_trabajo->>'avance')::numeric;
    exception when others then
      v_avance := null;
    end;
    if v_avance is null or v_avance < 0 or v_avance > 100 or v_avance <> round(v_avance) then
      raise exception 'El avance del trabajo % va de 0 a 100 %%, en números enteros.', v_orden using errcode = 'check_violation';
    end if;
    insert into public.reporte_diario_trabajos (reporte_id, orden, descripcion, avance)
    values (p_id, v_orden, v_tdesc, v_avance::smallint)
    returning id into v_tid;

    if jsonb_typeof(coalesce(v_trabajo->'personal', '[]'::jsonb)) <> 'array' then
      raise exception 'Revisa el personal del trabajo %.', v_orden using errcode = 'check_violation';
    end if;
    if v_general and jsonb_array_length(coalesce(v_trabajo->'personal', '[]'::jsonb)) > 0 then
      raise exception 'Con personal general, la gente va una sola vez para todo el reporte, no en cada trabajo.' using errcode = 'check_violation';
    end if;
    for v_persona in select * from jsonb_array_elements(coalesce(v_trabajo->'personal', '[]'::jsonb)) loop
      perform public.reporte_diario_agregar_persona(v_reporte, v_tid, v_tdesc, v_persona);
    end loop;
  end loop;

  if v_general then
    for v_persona in select * from jsonb_array_elements(p_personal_general) loop
      perform public.reporte_diario_agregar_persona(v_reporte, null, v_asunto, v_persona);
    end loop;
  end if;

  if not exists (select 1 from public.reporte_diario_personal where reporte_id = p_id) then
    raise exception 'Pon al menos a una persona con sus horas: de ahí sale el costeo.' using errcode = 'check_violation';
  end if;

  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_nfoto := v_nfoto + 1;
    -- Una foto nueva va a la carpeta de este reporte; la del observado que se
    -- corrige se queda donde estaba.
    if v_ruta !~ ('^' || v_yo::text || '/' || p_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')
       and not (p_reemplaza is not null
                and exists (select 1 from public.reporte_diario_fotos f where f.reporte_id = p_reemplaza and f.ruta = v_ruta)) then
      raise exception 'Vuelve a poner las fotos del reporte.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-reporte-diario' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_nfoto using errcode = 'check_violation';
    end if;
    -- Repetida es la que ya nombra un reporte vigente (este mismo, si viene dos
    -- veces). Las de los anulados no cuentan: una foto que pasó de corrección en
    -- corrección la siguen nombrando todos los observados que quedaron atrás.
    if exists (select 1 from public.reporte_diario_fotos f join public.reportes_diarios r on r.id = f.reporte_id
                where f.ruta = v_ruta and r.anulado_en is null) then
      raise exception 'La foto % está repetida: quítala.', v_nfoto using errcode = 'check_violation';
    end if;
    insert into public.reporte_diario_fotos (reporte_id, orden, ruta, mime_type, tamano_bytes)
    values (p_id, v_nfoto, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;

  -- Les llega a las dos áreas que lo validan (una vez a cada persona).
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id,
         case when p_reemplaza is null then 'Reporte diario por validar: ' else 'Reporte corregido por validar: ' end || v_asunto,
         coalesce((select a.nombre from public.areas a where a.id = v_reporte.area_id) || ' · ', '')
           || v_codigo || ' · ' || to_char(p_fecha, 'DD/MM/YYYY'),
         '/reportes-diarios/' || p_id, 'reportes_diarios', p_id
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo and u.id is distinct from v_yo
     and (r.codigo = 'ADMIN'
          or exists (select 1 from public.roles_permisos rp
                      where rp.rol_id = u.rol_id
                        and rp.permiso_codigo in ('reporte_diario.validar_gerencia', 'reporte_diario.validar_rrhh')));

  return p_id;
end;
$$;
revoke all on function public.reporte_diario_insertar(uuid, date, text, text, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;

-- p_trabajos: [{"descripcion": "…", "avance": 40, "personal": [{"trabajador_id": "…", "horas": 4}]}]
-- p_personal_general: [{"trabajador_id": "…", "horas": 8}] — si trae gente, el
--   personal es de todo el reporte y los trabajos van sin el suyo.
-- p_fotos: ["{cuenta}/{reporte}/{foto}.jpg", …], ya subidas a fotos-reporte-diario.
-- Un reintento con el mismo p_id devuelve el reporte ya subido.
create or replace function public.registrar_reporte_diario(
  p_id uuid, p_fecha date, p_codigo_interno text, p_asunto text, p_descripcion text,
  p_trabajos jsonb, p_personal_general jsonb default null, p_fotos jsonb default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_reporte public.reportes_diarios%rowtype;
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  if p_id is null or v_yo is null then
    raise exception 'Vuelve a abrir el formulario del reporte.' using errcode = 'check_violation';
  end if;
  select * into v_reporte from public.reportes_diarios where id = p_id;
  if found then
    if v_reporte.registrado_por = v_yo then return p_id; end if;
    raise exception 'Ese reporte ya existe: vuelve a abrir el formulario.' using errcode = 'check_violation';
  end if;
  return public.reporte_diario_insertar(p_id, p_fecha, p_codigo_interno, p_asunto, p_descripcion,
                                        p_trabajos, p_personal_general, p_fotos, null);
end;
$$;
revoke all on function public.registrar_reporte_diario(uuid, date, text, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_reporte_diario(uuid, date, text, text, text, jsonb, jsonb, jsonb) to authenticated;

-- El supervisor corrige su reporte observado: el observado se anula con el
-- motivo de la observación y el nuevo entra en su lugar, en la misma
-- transacción (si el nuevo no entra, el observado sigue como estaba). Se anula
-- primero para que sus horas no cuenten dos veces en el tope de 16 del día.
create or replace function public.registrar_reporte_corregido(
  p_reemplaza uuid, p_id uuid, p_fecha date, p_codigo_interno text, p_asunto text, p_descripcion text,
  p_trabajos jsonb, p_personal_general jsonb default null, p_fotos jsonb default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_previo  public.reportes_diarios%rowtype;
  v_reporte public.reportes_diarios%rowtype;
  v_motivo  text;
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  if p_id is null or v_yo is null or p_reemplaza is null then
    raise exception 'Vuelve a abrir el formulario del reporte.' using errcode = 'check_violation';
  end if;
  select * into v_reporte from public.reportes_diarios where id = p_id;
  if found then
    if v_reporte.registrado_por = v_yo and v_reporte.reemplaza_a is not distinct from p_reemplaza then return p_id; end if;
    raise exception 'Ese reporte ya existe: vuelve a abrir el formulario.' using errcode = 'check_violation';
  end if;

  select * into v_previo from public.reportes_diarios where id = p_reemplaza for update;
  if not found or v_previo.registrado_por is distinct from v_yo then
    raise exception 'Solo corriges tus propios reportes observados.' using errcode = 'insufficient_privilege';
  end if;
  if v_previo.anulado_en is not null then
    raise exception 'Ese reporte ya está anulado: si falta subirlo de nuevo, usa «Nuevo reporte».' using errcode = 'check_violation';
  end if;
  if v_previo.observado_en is null then
    raise exception 'Ese reporte no está observado: solo se corrige lo que Gerencia o Recursos Humanos observaron.' using errcode = 'check_violation';
  end if;

  v_motivo := left('Corregido por la observación de ' || case v_previo.observacion_area when 'GERENCIA' then 'Gerencia' else 'Recursos Humanos' end
                   || ': ' || v_previo.observacion, 500);
  update public.reportes_diarios
     set anulado_por = v_yo, anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_reemplaza;
  update public.tareos
     set anulado_por = v_yo, anulado_en = now(), motivo_anulacion = left('Se anuló el reporte diario: ' || v_motivo, 500)
   where anulado_en is null
     and reporte_linea_id in (select l.id from public.reporte_diario_personal l where l.reporte_id = p_reemplaza);

  return public.reporte_diario_insertar(p_id, p_fecha, p_codigo_interno, p_asunto, p_descripcion,
                                        p_trabajos, p_personal_general, p_fotos, p_reemplaza);
end;
$$;
revoke all on function public.registrar_reporte_corregido(uuid, uuid, date, text, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_reporte_corregido(uuid, uuid, date, text, text, text, jsonb, jsonb, jsonb) to authenticated;

-- 6. El visto bueno -------------------------------------------------------------------------
-- p_lado: GERENCIA o RRHH, cada uno con su permiso. Devuelve en qué quedó el
-- reporte. Un segundo toque no cambia nada.
create or replace function public.validar_reporte_diario(p_id uuid, p_lado text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo  uuid := public.usuario_actual();
  v_rep public.reportes_diarios%rowtype;
begin
  if p_lado = 'GERENCIA' then
    perform public.exigir_permiso('reporte_diario.validar_gerencia');
  elsif p_lado = 'RRHH' then
    perform public.exigir_permiso('reporte_diario.validar_rrhh');
  else
    raise exception 'Elige si das el visto de Gerencia o de Recursos Humanos.' using errcode = 'check_violation';
  end if;
  select * into v_rep from public.reportes_diarios where id = p_id for update;
  if not found then
    raise exception 'Ese reporte no existe.' using errcode = 'check_violation';
  end if;
  if v_rep.anulado_en is not null then
    raise exception 'Ese reporte está anulado: no se valida.' using errcode = 'check_violation';
  end if;
  if v_rep.observado_en is not null then
    raise exception 'Ese reporte está observado: espera a que el supervisor lo corrija y lo suba de nuevo.' using errcode = 'check_violation';
  end if;

  if p_lado = 'GERENCIA' and v_rep.visto_gerencia_en is null then
    update public.reportes_diarios set visto_gerencia_por = v_yo, visto_gerencia_en = now() where id = p_id
    returning * into v_rep;
  elsif p_lado = 'RRHH' and v_rep.visto_rrhh_en is null then
    update public.reportes_diarios set visto_rrhh_por = v_yo, visto_rrhh_en = now() where id = p_id
    returning * into v_rep;
  end if;
  return public.reporte_diario_estado(v_rep);
end;
$$;
revoke all on function public.validar_reporte_diario(uuid, text) from public, anon;
grant execute on function public.validar_reporte_diario(uuid, text) to authenticated;

-- 7. La observación: vuelve al supervisor con su motivo ----------------------------------------
-- Se puede observar aunque la otra área (o la misma) ya diera su visto, mientras
-- no lo hayan validado las dos: validado, ya puede estar en la planilla.
create or replace function public.observar_reporte_diario(p_id uuid, p_lado text, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_rep    public.reportes_diarios%rowtype;
begin
  if p_lado = 'GERENCIA' then
    perform public.exigir_permiso('reporte_diario.validar_gerencia');
  elsif p_lado = 'RRHH' then
    perform public.exigir_permiso('reporte_diario.validar_rrhh');
  else
    raise exception 'Elige si observas como Gerencia o como Recursos Humanos.' using errcode = 'check_violation';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta qué tiene que corregir el supervisor, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_rep from public.reportes_diarios where id = p_id for update;
  if not found then
    raise exception 'Ese reporte no existe.' using errcode = 'check_violation';
  end if;
  if v_rep.anulado_en is not null then
    raise exception 'Ese reporte está anulado: ya no se observa.' using errcode = 'check_violation';
  end if;
  if v_rep.observado_en is not null then
    if v_rep.observacion_area = p_lado and v_rep.observacion = v_motivo then return p_id; end if;
    raise exception 'Ese reporte ya está observado: espera a que el supervisor lo corrija.' using errcode = 'check_violation';
  end if;
  if v_rep.visto_gerencia_en is not null and v_rep.visto_rrhh_en is not null then
    raise exception 'Ese reporte ya lo validaron Gerencia y Recursos Humanos: si está mal, Recursos Humanos lo anula con su motivo.'
      using errcode = 'check_violation';
  end if;

  update public.reportes_diarios
     set observado_por = v_yo, observado_en = now(), observacion_area = p_lado, observacion = v_motivo
   where id = p_id;

  perform public.notificar_a_usuario(
    v_rep.registrado_por,
    'Reporte observado por ' || case p_lado when 'GERENCIA' then 'Gerencia' else 'Recursos Humanos' end || ': ' || v_rep.asunto,
    left(v_motivo, 200) || ' Corrígelo y súbelo de nuevo.',
    '/reportes-diarios/' || p_id, 'reportes_diarios', p_id, v_yo);
  return p_id;
end;
$$;
revoke all on function public.observar_reporte_diario(uuid, text, text) from public, anon;
grant execute on function public.observar_reporte_diario(uuid, text, text) to authenticated;
