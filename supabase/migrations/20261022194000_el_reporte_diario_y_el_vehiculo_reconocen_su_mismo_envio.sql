-- El reporte diario y el ingreso y la salida del vehículo reconocen el mismo
-- envío por todo lo que lleva, fotos incluidas, no solo por su id.
--
-- Las seis funciones devolvían el id si ya existía y era de quien envía, sin
-- mirar nada más (`registrar_reportes_diarios`, `registrar_reporte_diario`,
-- `registrar_reporte_corregido`), o mirando solo el motivo (el ingreso), o solo
-- que el vehículo ya hubiera salido (las dos salidas). La pantalla fija ese id
-- al abrir el formulario: con la respuesta perdida, cambiar el asunto, las
-- horas o las fotos y volver a pulsar terminaba en «subido», con lo de la
-- primera vez guardado, lo nuevo perdido y la foto nueva suelta en Storage sin
-- ninguna fila que la nombrara. Lo encontró la revisión de la rama del PR #148
-- (duodécima pasada) con el supervisor de Maestranza, en SQL con su rol.
--
-- Ahora cada envío deja su huella (el md5 de lo que trajo, tal como llegó) en
-- `huellas_de_envio`, y un reintento con el mismo id se reconoce solo si trae
-- la misma. Si no, se rechaza con el aviso de los demás envíos repetidos, «…
-- ya quedó registrado la primera vez que lo enviaste: recarga la pantalla
-- para ver cómo quedó», que la pantalla reconoce: se pone al día, no ofrece
-- enviarlo otra vez y quita las fotos nuevas, que ninguna fila nombra. Un
-- registro anterior a esta migración no tiene huella: su reintento recibe el
-- mismo aviso, que no miente. La salida que marcó otra persona dice «Ese
-- vehículo ya salió.»; antes también se daba por buena.
--
-- Las funciones se reescriben desde su definición vigente, cambiando solo el
-- bloque que reconoce el id y la línea que termina el registro: si otra
-- migración las redefine después, se vuelve a pegar esta. Si un bloque no está
-- como lo conoce el repositorio, la migración se detiene en vez de adivinar.

-- 1. La huella de cada envío ------------------------------------------------------------------
-- Solo la leen y la escriben las funciones de abajo, que corren como su dueño:
-- nadie la consulta directamente, así que no lleva políticas.
create table if not exists public.huellas_de_envio (
  registro   uuid        not null,
  momento    text        not null,
  huella     text        not null,
  anotado_en timestamptz not null default now(),
  primary key (registro, momento)
);
alter table public.huellas_de_envio enable row level security;
revoke all on public.huellas_de_envio from public, anon, authenticated;
comment on table public.huellas_de_envio is
  'md5 de lo que trajo el envío que creó cada reporte diario, ingreso o salida de vehículo: un reintento con el mismo id se reconoce por ella (migración 20261022194000). Sin políticas: solo la tocan las funciones que registran.';

create or replace function public.anotar_envio(p_registro uuid, p_momento text, p_envio jsonb)
returns uuid language sql set search_path to 'public' as $$
  insert into public.huellas_de_envio (registro, momento, huella)
  values (p_registro, p_momento, md5(p_envio::text))
  on conflict (registro, momento) do update set huella = excluded.huella, anotado_en = now();
  select p_registro;
$$;

create or replace function public.mismo_envio(p_registro uuid, p_momento text, p_envio jsonb)
returns boolean language sql stable set search_path to 'public' as $$
  select exists (select 1 from public.huellas_de_envio
                  where registro = p_registro and momento = p_momento and huella = md5(p_envio::text));
$$;
revoke all on function public.anotar_envio(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.mismo_envio(uuid, text, jsonb) from public, anon, authenticated;

-- 2. Las seis funciones la anotan y la miran -------------------------------------------------
do $$
declare
  -- Lo que trae cada envío, igual al anotarlo y al compararlo.
  e_varios    constant text := 'jsonb_build_array(p_fecha, p_asunto, p_descripcion, p_codigos)';
  e_uno       constant text := 'jsonb_build_array(p_fecha, p_codigo_interno, p_asunto, p_descripcion, p_trabajos, p_personal_general, p_fotos)';
  e_corregido constant text := 'jsonb_build_array(p_reemplaza, p_fecha, p_codigo_interno, p_asunto, p_descripcion, p_trabajos, p_personal_general, p_fotos)';
  e_ingreso   constant text := 'jsonb_build_array(p_placa, p_chasis, p_codigo_interno, p_unidad, p_empresa, p_motivo, p_ingreso_en, p_observacion, p_fotos)';
  e_salida    constant text := 'jsonb_build_array(''PLANTA''::text, p_salida_en, p_observacion, p_fotos)';
  e_arenado   constant text := 'jsonb_build_array(''ARENADO''::text, p_salida_en, p_observacion, p_fotos)';
  ya_reporte  constant text := 'raise exception ''Este reporte ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.'' using errcode = ''check_violation'';';
  ya_salio    constant text := 'raise exception ''Ese vehículo ya salió: la salida quedó registrada la primera vez que la enviaste. Recarga la pantalla para ver cómo quedó.'' using errcode = ''check_violation'';';
  v_cambio record;
  v_def    text;
begin
  for v_cambio in
    select * from (values
      -- El reporte de varios códigos: todos o ninguno, y el reintento trae lo mismo.
      -- Si lo que ya entró es de quien envía, es su primer envío: con otros
      -- datos, o con un código que agregó después.
      ('registrar_reportes_diarios(date,text,text,jsonb)',
       E'  if v_hechos = cardinality(v_ids)\n'
       || E'     and not exists (select 1 from public.reportes_diarios where id = any(v_ids) and registrado_por is distinct from v_yo) then\n'
       || E'    return v_ids;\n'
       || E'  end if;\n'
       || E'  if v_hechos > 0 then\n',
       E'  if v_hechos = cardinality(v_ids)\n'
       || E'     and not exists (select 1 from public.reportes_diarios where id = any(v_ids) and registrado_por is distinct from v_yo)\n'
       || E'     and not exists (select 1 from unnest(v_ids) i where not public.mismo_envio(i, ''REPORTES_DIARIOS'', ' || e_varios || E')) then\n'
       || E'    return v_ids;\n'
       || E'  end if;\n'
       || E'  if v_hechos > 0 and not exists (select 1 from public.reportes_diarios where id = any(v_ids) and registrado_por is distinct from v_yo) then\n'
       || E'    ' || ya_reporte || E'\n'
       || E'  end if;\n'
       || E'  if v_hechos > 0 then\n'),
      ('registrar_reportes_diarios(date,text,text,jsonb)',
       E'  return v_salida;\n',
       E'  perform public.anotar_envio(i, ''REPORTES_DIARIOS'', ' || e_varios || E') from unnest(v_salida) i;\n'
       || E'  return v_salida;\n'),
      -- El reporte de un código.
      ('registrar_reporte_diario(uuid,date,text,text,text,jsonb,jsonb,jsonb)',
       E'    if v_reporte.registrado_por = v_yo then return p_id; end if;\n',
       E'    if v_reporte.registrado_por = v_yo then\n'
       || E'      if public.mismo_envio(p_id, ''REPORTE_DIARIO'', ' || e_uno || E') then return p_id; end if;\n'
       || E'      ' || ya_reporte || E'\n'
       || E'    end if;\n'),
      ('registrar_reporte_diario(uuid,date,text,text,text,jsonb,jsonb,jsonb)',
       E'  return public.reporte_diario_insertar(p_id, p_fecha, p_codigo_interno, p_asunto, p_descripcion,\n'
       || E'                                        p_trabajos, p_personal_general, p_fotos, null);\n',
       E'  return public.anotar_envio(public.reporte_diario_insertar(p_id, p_fecha, p_codigo_interno, p_asunto, p_descripcion,\n'
       || E'                                        p_trabajos, p_personal_general, p_fotos, null), ''REPORTE_DIARIO'', ' || e_uno || E');\n'),
      -- El reporte corregido.
      ('registrar_reporte_corregido(uuid,uuid,date,text,text,text,jsonb,jsonb,jsonb)',
       E'    if v_reporte.registrado_por = v_yo and v_reporte.reemplaza_a is not distinct from p_reemplaza then return p_id; end if;\n',
       E'    if v_reporte.registrado_por = v_yo and v_reporte.reemplaza_a is not distinct from p_reemplaza then\n'
       || E'      if public.mismo_envio(p_id, ''REPORTE_CORREGIDO'', ' || e_corregido || E') then return p_id; end if;\n'
       || E'      ' || ya_reporte || E'\n'
       || E'    end if;\n'),
      ('registrar_reporte_corregido(uuid,uuid,date,text,text,text,jsonb,jsonb,jsonb)',
       E'  return public.reporte_diario_insertar(p_id, p_fecha, p_codigo_interno, p_asunto, p_descripcion,\n'
       || E'                                        p_trabajos, p_personal_general, p_fotos, p_reemplaza);\n',
       E'  return public.anotar_envio(public.reporte_diario_insertar(p_id, p_fecha, p_codigo_interno, p_asunto, p_descripcion,\n'
       || E'                                        p_trabajos, p_personal_general, p_fotos, p_reemplaza), ''REPORTE_CORREGIDO'', ' || e_corregido || E');\n'),
      -- El ingreso del vehículo: el motivo solo no alcanzaba.
      ('registrar_ingreso_vehiculo(uuid,text,text,text,text,text,text,timestamp with time zone,text,jsonb)',
       E'    if v_actual.ingreso_por = public.usuario_actual() and v_actual.motivo = p_motivo then\n'
       || E'      return p_id;\n'
       || E'    end if;\n',
       E'    if v_actual.ingreso_por = public.usuario_actual() then\n'
       || E'      if public.mismo_envio(p_id, ''INGRESO'', ' || e_ingreso || E') then return p_id; end if;\n'
       || E'      raise exception ''Este ingreso ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.'' using errcode = ''check_violation'';\n'
       || E'    end if;\n'),
      ('registrar_ingreso_vehiculo(uuid,text,text,text,text,text,text,timestamp with time zone,text,jsonb)',
       E'  perform public.vehiculo_anotar_fotos(p_id, ''INGRESO'', p_fotos);\n',
       E'  perform public.vehiculo_anotar_fotos(p_id, ''INGRESO'', p_fotos);\n'
       || E'  perform public.anotar_envio(p_id, ''INGRESO'', ' || e_ingreso || E');\n'),
      -- La salida: que ya hubiera salido no decía que fuera este envío.
      ('registrar_salida_vehiculo(uuid,timestamp with time zone,text,jsonb)',
       E'  if v_reg.salida_en is not null then return p_id; end if;\n',
       E'  if v_reg.salida_en is not null then\n'
       || E'    if v_reg.salida_por = public.usuario_actual() then\n'
       || E'      if public.mismo_envio(p_id, ''SALIDA'', ' || e_salida || E') then return p_id; end if;\n'
       || E'      ' || ya_salio || E'\n'
       || E'    end if;\n'
       || E'    raise exception ''Ese vehículo ya salió.'' using errcode = ''check_violation'';\n'
       || E'  end if;\n'),
      ('registrar_salida_vehiculo(uuid,timestamp with time zone,text,jsonb)',
       E'  perform public.vehiculo_anotar_fotos(p_id, ''SALIDA'', p_fotos);\n',
       E'  perform public.vehiculo_anotar_fotos(p_id, ''SALIDA'', p_fotos);\n'
       || E'  perform public.anotar_envio(p_id, ''SALIDA'', ' || e_salida || E');\n'),
      ('registrar_salida_al_arenado(uuid,timestamp with time zone,text,jsonb)',
       E'    if v_reg.sale_al_arenado then return p_id; end if;\n'
       || E'    raise exception ''Ese vehículo ya salió.'' using errcode = ''check_violation'';\n',
       E'    if v_reg.salida_por = public.usuario_actual() then\n'
       || E'      if public.mismo_envio(p_id, ''SALIDA'', ' || e_arenado || E') then return p_id; end if;\n'
       || E'      ' || ya_salio || E'\n'
       || E'    end if;\n'
       || E'    raise exception ''Ese vehículo ya salió.'' using errcode = ''check_violation'';\n'),
      ('registrar_salida_al_arenado(uuid,timestamp with time zone,text,jsonb)',
       E'  perform public.vehiculo_anotar_fotos(p_id, ''SALIDA'', p_fotos);\n',
       E'  perform public.vehiculo_anotar_fotos(p_id, ''SALIDA'', p_fotos);\n'
       || E'  perform public.anotar_envio(p_id, ''SALIDA'', ' || e_arenado || E');\n')
    ) as c(funcion, viejo, nuevo)
  loop
    v_def := replace(pg_get_functiondef(('public.' || v_cambio.funcion)::regprocedure), E'\r', '');
    if position(v_cambio.nuevo in v_def) > 0 then
      continue;  -- ya estaba
    end if;
    if (char_length(v_def) - char_length(replace(v_def, v_cambio.viejo, ''))) / char_length(v_cambio.viejo) <> 1 then
      raise exception '% cambió: el bloque que reconoce el envío no está como lo conoce el repositorio. Revisarla a mano antes de seguir.', v_cambio.funcion;
    end if;
    execute replace(v_def, v_cambio.viejo, v_cambio.nuevo);
  end loop;
end $$;
