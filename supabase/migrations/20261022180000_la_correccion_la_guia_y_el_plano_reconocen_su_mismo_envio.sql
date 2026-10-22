-- La corrección con justificante, la guía de remisión y el plano de Diseño
-- reconocen el mismo envío por lo que dice, no solo por su id.
--
-- Las tres correcciones (el requerimiento, la OC y la factura de compra)
-- devolvían el id de la corrección si ya existía, sin mirar nada más. La
-- pantalla fija ese id al abrir la ventana: con las dos respuestas perdidas
-- («No se confirmó el registro»), elegir en la misma ventana un justificante de
-- otro tipo y cambiar el motivo terminaba en «corregido», con el primer
-- justificante y el primer motivo guardados, el segundo archivo suelto y la
-- pantalla confirmando lo que no se guardó. Lo encontró la revisión de la rama
-- del PR #148 (undécima pasada), con Requerimientos.
--
-- Ahora el id existente se reconoce solo si la corrección nombra el mismo
-- justificante, la registró la misma persona y el envío trae el mismo motivo y
-- los mismos cambios. Para eso cada corrección guarda la huella de su envío
-- (`huella_del_envio`, el md5 del motivo y los cambios tal como llegaron). Si
-- no, se rechaza con un aviso que dice que esa corrección ya entró la primera
-- vez; la pantalla quita el archivo nuevo, que ninguna fila nombra. Una
-- corrección anterior a esta migración no tiene huella: un reintento suyo se
-- rechaza con el mismo aviso, que no miente.
--
-- La guía de remisión reconocía el mismo envío por la OC, el número y quién la
-- cargó: con la respuesta perdida, cambiar la fecha y volver a pulsar cerraba
-- la ventana como si la fecha nueva hubiera entrado. Ahora mira también la
-- fecha y el nombre del PDF. El plano de Diseño y su revisión tenían lo mismo
-- (el nombre, la observación, «qué cambió»): lo vio el detector del check 417
-- al buscar también por el nombre del PDF.
--
-- Esas seis funciones se reescriben desde su definición vigente, cambiando
-- solo el bloque que reconoce el id: otra migración (la que anula la OC
-- aprobada con su motivo) también redefine dos correcciones, y así no se pisa
-- lo que ella cambie. Si el bloque no está como lo conoce el repositorio, la
-- migración se detiene en vez de adivinar. `registrar_correccion` va entera,
-- con la guardia de su huella como la 20261022160000.

-- 1. La huella del envío ----------------------------------------------------------------------
alter table public.correcciones add column if not exists huella_del_envio text;
comment on column public.correcciones.huella_del_envio is
  'md5 del motivo y los cambios del envío que la registró: un reintento con el mismo id se reconoce por ella, por el justificante y por quién corrige (migración 20261022180000).';

create or replace function public.huella_del_envio_de_correccion(p_motivo text, p_cambios jsonb)
returns text language sql immutable set search_path to 'public' as $$
  select md5(btrim(coalesce(p_motivo, '')) || chr(31) || coalesce(p_cambios::text, ''));
$$;
revoke all on function public.huella_del_envio_de_correccion(text, jsonb) from public, anon, authenticated;

-- 2. registrar_correccion la anota ------------------------------------------------------------
-- La pone quien corrige justo antes de llamarla (`metalwork.envio_correccion`).
do $$
declare
  conocidas constant jsonb := '{
    "registrar_correccion(uuid,text,uuid,text,text,text,text,jsonb,jsonb)": ["dedd41d96a490907635ae8347939de79", "13f2e499226ff4ca2e3ef69f69883196"]
  }';
  firma text;
  huella text;
begin
  for firma in select jsonb_object_keys(conocidas) loop
    select md5(replace(p.prosrc, E'\r', '')) into huella
      from pg_proc p where p.oid = to_regprocedure('public.' || firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', firma;
    end if;
    if not conocidas -> firma ? huella then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', firma;
    end if;
  end loop;
end $$;

create or replace function public.registrar_correccion(
  p_id uuid, p_documento text, p_documento_id uuid, p_numero text, p_motivo text, p_ruta text, p_nombre text,
  p_antes jsonb, p_despues jsonb
) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_obj storage.objects%rowtype;
begin
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se corrige, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  if p_ruta is null or p_ruta !~ ('^' || p_documento_id::text || '/' || p_id::text || '\.(pdf|jpg|png|webp)$') then
    raise exception 'Adjunta el justificante de la corrección: el PDF o la foto que la respalda.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('justificantes-correccion', p_ruta, p_documento_id,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  if p_antes = p_despues then
    raise exception 'No hay nada que corregir: cambia algún dato.' using errcode = 'check_violation';
  end if;
  insert into public.correcciones (id, documento, documento_id, numero, motivo, antes, despues, justificante_ruta,
                                   justificante_nombre, justificante_mime, justificante_tamano, corregido_por,
                                   huella_del_envio)
  values (p_id, p_documento, p_documento_id, p_numero, btrim(p_motivo), p_antes, p_despues, p_ruta,
          left(coalesce(nullif(btrim(p_nombre), ''), 'justificante'), 200), v_obj.metadata->>'mimetype',
          (v_obj.metadata->>'size')::integer, public.usuario_actual(),
          nullif(current_setting('metalwork.envio_correccion', true), ''));
  -- Que no la herede otra corrección de la misma transacción que no la puso.
  perform set_config('metalwork.envio_correccion', '', true);
end $$;
revoke all on function public.registrar_correccion(uuid, text, uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- 3. Las tres correcciones reconocen su mismo envío -------------------------------------------
-- Cada una, desde su definición vigente: solo cambia el bloque del id.
do $$
declare
  v_nuevo constant text := $b$
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    -- El mismo envío repetido (la respuesta se perdió) se reconoce por todo lo
    -- que dice: el justificante, quién corrige, el motivo y los cambios. Otro
    -- envío con el mismo id (otro archivo, otro motivo, otros datos) no.
    if exists (select 1 from public.correcciones
                where id = p_correccion and documento_id = p_id
                  and justificante_ruta = p_justificante and corregido_por = public.usuario_actual()
                  and huella_del_envio = public.huella_del_envio_de_correccion(p_motivo, p_cambios)) then
      return p_id;
    end if;
    raise exception 'Esta corrección ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'
      using errcode = 'check_violation';
  end if;
  perform set_config('metalwork.envio_correccion', public.huella_del_envio_de_correccion(p_motivo, p_cambios), true);
$b$;
  v_funcion text;
  v_viejo   text;
  v_def     text;
begin
  foreach v_funcion in array array[
    'corregir_requerimiento(uuid,uuid,text,text,text,jsonb)',
    'corregir_orden_compra(uuid,uuid,text,text,text,jsonb)',
    'corregir_factura_compra(uuid,uuid,text,text,text,jsonb)'
  ] loop
    v_viejo := E'\n  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then\n    return p_id;'
            || case when v_funcion like 'corregir_requerimiento%' then '  -- un reintento de la misma corrección' else '' end
            || E'\n  end if;\n';
    -- Sin los `\r` de un pegado desde Windows: el texto se compara línea por línea.
    v_def := replace(pg_get_functiondef(('public.' || v_funcion)::regprocedure), E'\r', '');
    if position(v_nuevo in v_def) > 0 then
      continue;  -- ya estaba
    end if;
    if (char_length(v_def) - char_length(replace(v_def, v_viejo, ''))) / char_length(v_viejo) <> 1 then
      raise exception '% cambió: el bloque que reconoce el id no está como lo conoce el repositorio. Revisarla a mano antes de seguir.', v_funcion;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
  end loop;
end $$;

-- 4. La guía de remisión y los planos de Diseño miran todo lo que dice el envío ----------------
-- La guía, la fecha y el nombre del PDF; el plano, su nombre, su observación y
-- el nombre del PDF; la revisión del plano, lo que cambió y el nombre del PDF.
do $$
declare
  v_cambio record;
  v_def    text;
begin
  for v_cambio in
    select * from (values
      ('cargar_guia_remision(uuid,uuid,text,date,text)',
       E'    if v_existe.orden_compra_id = p_compra and v_existe.numero = v_numero and v_existe.cargada_por = v_yo then\n',
       E'    -- El mismo envío repetido (la respuesta se perdió) trae todo igual: con\n'
       || E'    -- otra fecha o el PDF de otro nombre ya no es el mismo (undécima pasada).\n'
       || E'    if v_existe.orden_compra_id = p_compra and v_existe.numero = v_numero and v_existe.cargada_por = v_yo\n'
       || E'       and v_existe.fecha_emision = p_fecha and v_existe.nombre_archivo = btrim(p_nombre_archivo) then\n'),
      ('registrar_plano_codigo(uuid,uuid,text,text,text,uuid,text,text)',
       E'       and v_existe.creado_por = v_yo\n'
       || E'       and exists (select 1 from public.codigo_plano_revisiones r where r.id = p_revision and r.plano_id = p_plano) then\n',
       E'       and v_existe.creado_por = v_yo\n'
       || E'       -- Con otro nombre, otra observación o el PDF de otro nombre ya no es el\n'
       || E'       -- mismo envío (undécima pasada).\n'
       || E'       and v_existe.nombre = v_nombre and v_existe.observacion is not distinct from v_obs\n'
       || E'       and exists (select 1 from public.codigo_plano_revisiones r\n'
       || E'                    where r.id = p_revision and r.plano_id = p_plano and r.nombre_archivo = btrim(p_nombre_archivo)) then\n'),
      ('subir_revision_plano(uuid,uuid,text,text)',
       E'    if v_existe.plano_id = p_plano and v_existe.subido_por = v_yo then\n'
       || E'      return p_revision;\n'
       || E'    end if;\n'
       || E'    raise exception ''Ese PDF ya se registró en otro plano. Vuelve a cargar la pantalla.'' using errcode = ''check_violation'';\n',
       E'    -- El mismo envío repetido trae todo igual: con otro «qué cambió» o el PDF\n'
       || E'    -- de otro nombre ya no es el mismo (undécima pasada).\n'
       || E'    if v_existe.plano_id = p_plano and v_existe.subido_por = v_yo\n'
       || E'       and v_existe.cambios is not distinct from v_cambios and v_existe.nombre_archivo = btrim(p_nombre_archivo) then\n'
       || E'      return p_revision;\n'
       || E'    end if;\n'
       || E'    raise exception ''Esa revisión ya se cargó con otros datos. Vuelve a cargar la pantalla.'' using errcode = ''check_violation'';\n')
    ) as c(funcion, viejo, nuevo)
  loop
    v_def := replace(pg_get_functiondef(('public.' || v_cambio.funcion)::regprocedure), E'\r', '');
    if position(v_cambio.nuevo in v_def) > 0 then
      continue;  -- ya estaba
    end if;
    if (char_length(v_def) - char_length(replace(v_def, v_cambio.viejo, ''))) / char_length(v_cambio.viejo) <> 1 then
      raise exception '% cambió: el bloque que reconoce el id no está como lo conoce el repositorio. Revisarla a mano antes de seguir.', v_cambio.funcion;
    end if;
    execute replace(v_def, v_cambio.viejo, v_cambio.nuevo);
  end loop;
end $$;
