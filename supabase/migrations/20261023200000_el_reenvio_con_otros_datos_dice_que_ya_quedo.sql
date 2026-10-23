-- El reenvío con algo cambiado dice que el primero ya quedó, en RR. HH., la
-- caja, el almacén y el gasto del mes.
--
-- Cuando la respuesta se pierde, la persona vuelve a enviar con el mismo id. Si
-- antes cambió un dato —las horas del permiso, el saldo del cierre, la cantidad
-- recibida—, estas funciones veían el id, devolvían lo ya registrado sin mirar
-- lo que traía y la pantalla decía «listo»: lo cambiado no se guardaba y nadie
-- se enteraba (lo encontraron las auditorías del PR #148, el 2026-10-23). Son la
-- observación, el permiso, la carga de horas, el uso de las horas reservadas, la
-- justificación de un permiso y la decisión de las horas extras de RR. HH.; el
-- cierre del día de la caja; la planilla diaria; y la recepción de lo comprado.
-- El despacho con foto, la salida del kardex y el gasto del mes ya comparaban,
-- pero a la misma persona le decían en rojo «ya existe con otros datos», sin
-- decirle que lo primero había quedado; el gasto, además, no miraba el detalle.
--
-- Ahora es la regla de la 20261023100000: el mismo envío repetido devuelve lo
-- mismo; otro envío de la misma persona con el mismo id dice «ya quedó
-- registrado la primera vez que lo enviaste», que la pantalla muestra sin rojo,
-- traba la ventana y la pone al día al cerrarla; y el de otra persona sigue
-- diciendo que ya existe con otros datos. Cada una espera al envío gemelo que
-- todavía corre (el mismo candado por id), en vez de caer en la llave repetida.
--
-- La cuenta nueva de la caja guardaba con un upsert: con el id conservado, el
-- reenvío corregía en silencio la cuenta recién abierta. `guardar_caja` gana un
-- décimo parámetro, `p_alta`, que la ventana de alta manda en verdadero: el alta
-- repetida se reconoce como las demás. La de nueve parámetros queda como
-- envoltorio que corrige, para la pantalla abierta desde antes de esta migración.
--
-- `crear_orden_compra_material` y `despachar_material` también devolvían el id
-- sin mirar, pero ya no las puede llamar nadie (sin `execute` para
-- `authenticated` desde la sustitución por la OC de insumos y el despacho con
-- foto): quedan como están.
--
-- Cada función va entera, tal como queda después de las migraciones anteriores;
-- cambia solo lo que reconoce el id. `create or replace` conserva los permisos.
-- Antes de reemplazarlas se mira que cada una sea la que el repositorio conoce
-- (su texto antes o después de este cambio, sin los `\r` de un pegado desde
-- Windows). Si alguna se cambió a mano en la base, la migración se detiene.
do $$
declare
  conocidas constant jsonb := '{
    "cerrar_dia_caja(uuid,uuid,date,numeric,text)": ["67a0c4e7a9aa1e62ac4c22a771cef507", "a5108b082f137dbd0a1171932b23bca1"],
    "despachar_material_con_foto(uuid,uuid,numeric,uuid,text,text)": ["6e83087104cac27434733cac3f3f8c04", "bb691095122b6680488637e7cf862eea"],
    "enviar_planilla_diaria(uuid)": ["9f523bbc7b625ae15a511e27c117bbdc", "786cfd4a0fd5c917eb3e197c3c86d5ff"],
    "guardar_caja(uuid,text,text,text,text,numeric,date,boolean,text)": ["091a67c3d5d762eaccac09ddedc9d6eb", "1525e7af154ab20a431cbd4c8de1a04f"],
    "guardar_caja(uuid,text,text,text,text,numeric,date,boolean,text,boolean)": ["f2b55a2005e9d2068daa95aeeebefda3"],
    "registrar_gasto_general(uuid,date,text,text,numeric,text,text,numeric)": ["c4a3196f64caff1923efec654dbb36b9", "56b203e6b5b33b7b3a22a592e040f440"],
    "registrar_recepcion_material(uuid,uuid,cantidad,text)": ["1175bde4e8aa9e3a1c806537eaf7eee8", "e11b3b94d3aa5849f5ce3360df44c0f7"],
    "registrar_salida_material(uuid,uuid,numeric,uuid,text,text,text,text,uuid)": ["97a15d64eae1e958d13e73579defdf5e", "2e3093fd45d5e15edf746dfd13b30a9f"],
    "rrhh_decidir_horas_extras(uuid,uuid,date,text)": ["a1952fbfa941d21ec80a07cefef3efb6", "d08e3aac2a7540443f8eba42e630876b"],
    "rrhh_justificar_permiso(uuid,uuid,numeric)": ["18d31ff37806522a78d9774548959a50", "35c7d36a40367c0f210fea378610ab2f"],
    "rrhh_registrar_observacion(uuid,uuid,date,text,text,text,text,integer)": ["a1e250959284ad7fbac2627d65d64b11", "1dd0b6aa2a28e364eeda4ff92986c406"],
    "rrhh_registrar_permiso(uuid,uuid,date,numeric,text)": ["8e49f365409cceba750d1b29af9c6af1", "5f4c69598e6f78242c5a5769d0f371bb"],
    "rrhh_registrar_tareo(uuid,uuid,date,text,numeric,text)": ["e9e47590739188cc24c7641b55846afe", "564e968d613fdd00fab7f84716d4f746"],
    "rrhh_usar_saldo_horas(uuid,uuid,date,numeric,text)": ["5da886881e216b8cdb6fd12efd24f22b", "5ada8e720473f421495e33af787857fc"]
  }';
  firma text;
  huella text;
begin
  for firma in select jsonb_object_keys(conocidas) loop
    select md5(replace(p.prosrc, E'\r', '')) into huella
      from pg_proc p where p.oid = to_regprocedure('public.' || firma);
    -- La de diez parámetros nace aquí: falta la primera vez.
    if huella is null and firma = 'guardar_caja(uuid,text,text,text,text,numeric,date,boolean,text,boolean)' then
      continue;
    end if;
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', firma;
    end if;
    if not conocidas -> firma ? huella then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', firma;
    end if;
  end loop;
end $$;

create or replace function public.rrhh_registrar_observacion(p_id uuid, p_trabajador_id uuid, p_fecha date, p_tipo text, p_motivo text, p_detalle text, p_codigo_interno text DEFAULT NULL::text, p_dias_suspension integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previo  public.observaciones_personal%rowtype;
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_codigo  text := nullif(upper(btrim(coalesce(p_codigo_interno, ''))), '');
begin
  perform public.exigir_permiso_del_puesto('rrhh.personal');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la observación.' using errcode = 'check_violation';
  end if;
  -- Lo escrito se mira como se guarda: el detalle sin espacios a los lados, el
  -- código en mayúsculas y los días solo en la suspensión.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.observaciones_personal where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Esta observación ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.trabajador_id = p_trabajador_id and v_previo.fecha = p_fecha and v_previo.tipo = p_tipo
       and v_previo.motivo = p_motivo and v_previo.detalle = btrim(coalesce(p_detalle, ''))
       and v_previo.codigo_interno is not distinct from v_codigo
       and v_previo.dias_suspension is not distinct from (case when p_tipo = 'SUSPENSION' then p_dias_suspension end) then
      return p_id;
    end if;
    raise exception 'Esta observación ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;

  if not exists (select 1 from public.trabajadores where id = p_trabajador_id) then
    raise exception 'Elige a una persona del personal.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'Elige el día en que pasó: hoy o un día anterior.' using errcode = 'check_violation';
  end if;
  if p_tipo is null or p_tipo not in ('OBSERVACION', 'AMONESTACION_VERBAL', 'AMONESTACION_ESCRITA', 'SUSPENSION') then
    raise exception 'Elige si es una observación, una amonestación verbal o escrita, o una suspensión.' using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('TARDANZAS', 'FALTA_INJUSTIFICADA', 'EPP', 'SEGURIDAD', 'CALIDAD', 'CONDUCTA', 'OTRO') then
    raise exception 'Elige el motivo.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_detalle, ''))) not between 10 and 1000 then
    raise exception 'Cuenta qué pasó, en 10 a 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if v_codigo is not null and char_length(v_codigo) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if p_tipo = 'SUSPENSION' and (p_dias_suspension is null or p_dias_suspension not between 1 and 30) then
    raise exception 'Una suspensión lleva sus días: de 1 a 30.' using errcode = 'check_violation';
  end if;

  insert into public.observaciones_personal (id, trabajador_id, fecha, tipo, motivo, detalle, codigo_interno, dias_suspension)
  values (p_id, p_trabajador_id, p_fecha, p_tipo, p_motivo, btrim(p_detalle), v_codigo,
          case when p_tipo = 'SUSPENSION' then p_dias_suspension end);
  return p_id;
end;
$function$;

create or replace function public.rrhh_registrar_permiso(p_id uuid, p_trabajador_id uuid, p_fecha date, p_horas numeric, p_motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previo  public.permisos_personal%rowtype;
  v_horas  numeric(4, 2) := round(coalesce(p_horas, 0), 2);
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_trab   public.trabajadores%rowtype;
  v_ya     numeric;
begin
  perform public.exigir_permiso_del_puesto('rrhh.permisos');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del permiso.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.permisos_personal where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Este permiso ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.trabajador_id = p_trabajador_id and v_previo.fecha = p_fecha
       and v_previo.horas = v_horas and v_previo.motivo = v_motivo then
      return p_id;
    end if;
    raise exception 'Este permiso ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  select * into v_trab from public.trabajadores where id = p_trabajador_id;
  if not found then
    raise exception 'Elige a una persona del personal.' using errcode = 'check_violation';
  end if;
  if not v_trab.activo then
    raise exception '% está de baja: no se le registran permisos.', v_trab.nombres || ' ' || v_trab.apellidos using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha < v_hoy - 366 or p_fecha > v_hoy + 366 then
    raise exception 'Elige el día del permiso.' using errcode = 'check_violation';
  end if;
  if v_horas <= 0 or v_horas > 8 then
    raise exception 'Las horas de permiso van de 0,25 a 8 por día: un permiso de varios días se registra día por día.' using errcode = 'check_violation';
  end if;
  if char_length(v_motivo) not between 10 and 300 then
    raise exception 'Cuenta para qué pidió el permiso, en 10 a 300 caracteres.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('extras:' || p_trabajador_id::text, 0));
  select coalesce(sum(horas), 0) into v_ya from public.permisos_personal
   where trabajador_id = p_trabajador_id and fecha = p_fecha and anulado_en is null;
  if v_ya + v_horas > 8 then
    raise exception '% ya tiene % de permiso ese día: con % más pasaría de las 8 horas de la jornada.',
      v_trab.nombres || ' ' || v_trab.apellidos, public.horas_en_texto(v_ya), public.horas_en_texto(v_horas)
      using errcode = 'check_violation';
  end if;

  insert into public.permisos_personal (id, trabajador_id, fecha, horas, motivo)
  values (p_id, p_trabajador_id, p_fecha, v_horas, v_motivo);
  return p_id;
end;
$function$;

create or replace function public.rrhh_registrar_tareo(p_id uuid, p_trabajador_id uuid, p_fecha date, p_codigo_interno text, p_horas numeric, p_labor text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previo  public.tareos%rowtype;
  v_trab    public.trabajadores%rowtype;
  v_costo   numeric(10, 2);
  v_codigo  text := upper(btrim(coalesce(p_codigo_interno, '')));
  v_labor   text := nullif(btrim(coalesce(p_labor, '')), '');
  v_horas   numeric(4, 2) := round(coalesce(p_horas, 0), 2);
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_ya      numeric;
  v_hora    numeric(10, 4);
begin
  perform public.exigir_permiso_del_puesto('rrhh.personal');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de horas.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.tareos where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Esta carga de horas ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.reporte_linea_id is null and v_previo.trabajador_id = p_trabajador_id and v_previo.fecha = p_fecha
       and v_previo.codigo_interno = v_codigo and v_previo.horas = v_horas
       and v_previo.labor is not distinct from v_labor then
      return p_id;
    end if;
    raise exception 'Esta carga de horas ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;

  select * into v_trab from public.trabajadores where id = p_trabajador_id;
  if not found then
    raise exception 'Elige a una persona del personal.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'Elige el día trabajado: hoy o un día anterior.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_hoy - 366 then
    raise exception 'Ese día tiene más de un año: revisa la fecha.' using errcode = 'check_violation';
  end if;
  if char_length(v_codigo) not between 2 and 60 then
    raise exception 'Escribe el código interno (de 2 a 60 caracteres), por ejemplo PLA_SR_O4_1_26/28 o PLANTA.' using errcode = 'check_violation';
  end if;
  if v_horas <= 0 or v_horas > 16 then
    raise exception 'Las horas van de 0,25 a 16.' using errcode = 'check_violation';
  end if;
  if v_labor is not null and char_length(v_labor) > 200 then
    raise exception 'La labor pasa de 200 caracteres.' using errcode = 'check_violation';
  end if;

  select costo_mensual into v_costo from public.trabajador_costos where trabajador_id = p_trabajador_id;
  if v_costo is null then
    raise exception 'Primero pon el costo mensual de % en su ficha de Personal.', v_trab.nombres || ' ' || v_trab.apellidos
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tareo:' || p_trabajador_id::text, 0));
  v_ya := public.rrhh_horas_del_dia(p_trabajador_id, p_fecha);
  if v_ya + v_horas > 16 then
    raise exception '% ya tiene % h cargadas el %: con estas pasaría de 16 horas en el día.',
      v_trab.nombres || ' ' || v_trab.apellidos, rtrim(rtrim(to_char(v_ya, 'FM990.00'), '0'), '.'), to_char(p_fecha, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  v_hora := round(v_costo / 240, 4);
  insert into public.tareos (id, trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo)
  values (p_id, p_trabajador_id, p_fecha, v_codigo, v_horas, v_labor, v_hora, round(v_horas * v_hora, 2));
  return p_id;
end;
$function$;

create or replace function public.rrhh_usar_saldo_horas(p_id uuid, p_trabajador_id uuid, p_fecha date, p_horas numeric, p_motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previo  public.horas_compensadas%rowtype;
  v_horas  numeric(4, 2) := round(coalesce(p_horas, 0), 2);
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_saldo  numeric;
  v_nombre text;
begin
  perform public.exigir_permiso_del_puesto('planilla_diaria.preparar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario.' using errcode = 'check_violation';
  end if;
  -- La misma tabla guarda lo que justifica un permiso: ese no es este envío.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.horas_compensadas where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Este uso de las horas reservadas ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.permiso_id is null and v_previo.trabajador_id = p_trabajador_id and v_previo.fecha = p_fecha
       and v_previo.horas = v_horas and v_previo.motivo = v_motivo then
      return p_id;
    end if;
    raise exception 'Este uso de las horas reservadas ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  select nombres || ' ' || apellidos into v_nombre from public.trabajadores where id = p_trabajador_id;
  if v_nombre is null then
    raise exception 'Elige a una persona del personal.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha < v_hoy - 366 or p_fecha > v_hoy + 366 then
    raise exception 'Elige el día en que usa las horas.' using errcode = 'check_violation';
  end if;
  if v_horas <= 0 or v_horas > 8 then
    raise exception 'Las horas que usa van de 0,25 a 8 por día.' using errcode = 'check_violation';
  end if;
  if char_length(v_motivo) not between 10 and 300 then
    raise exception 'Cuenta para qué usa las horas (un permiso, un descanso), en 10 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('extras:' || p_trabajador_id::text, 0));
  select coalesce(sum(x.horas), 0) into v_saldo from public.horas_extras_decisiones x
   where x.trabajador_id = p_trabajador_id and x.decision = 'RESERVAR' and x.anulado_en is null;
  v_saldo := v_saldo - coalesce((select sum(c.horas) from public.horas_compensadas c
                                  where c.trabajador_id = p_trabajador_id and c.anulado_en is null), 0);
  if v_horas > v_saldo then
    raise exception '% tiene % h reservadas: no le alcanzan para %.', v_nombre,
      rtrim(rtrim(to_char(v_saldo, 'FM990.00'), '0'), '.'), rtrim(rtrim(to_char(v_horas, 'FM990.00'), '0'), '.') || ' h'
      using errcode = 'check_violation';
  end if;
  insert into public.horas_compensadas (id, trabajador_id, fecha, horas, motivo)
  values (p_id, p_trabajador_id, p_fecha, v_horas, v_motivo);
  return p_id;
end;
$function$;

create or replace function public.rrhh_justificar_permiso(p_id uuid, p_permiso_id uuid, p_horas numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previo  public.horas_compensadas%rowtype;
  v_perm    public.permisos_personal%rowtype;
  v_nombre  text;
  v_hechas  numeric;
  v_falta   numeric;
  v_saldo   numeric;
  v_horas   numeric(4, 2);
begin
  perform public.exigir_permiso_del_puesto('rrhh.permisos');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de permisos.' using errcode = 'check_violation';
  end if;
  -- Sin horas escritas se justificaba lo que alcanzaba: cualquier cantidad es
  -- la de aquel envío.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.horas_compensadas where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Esta justificación ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.permiso_id is not distinct from p_permiso_id
       and (p_horas is null or v_previo.horas = round(p_horas, 2)) then
      return p_id;
    end if;
    raise exception 'Esta justificación ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  select * into v_perm from public.permisos_personal where id = p_permiso_id;
  if not found then
    raise exception 'Ese permiso no existe.' using errcode = 'check_violation';
  end if;
  if v_perm.anulado_en is not null then
    raise exception 'Ese permiso está anulado: no se justifica.' using errcode = 'check_violation';
  end if;
  select nombres || ' ' || apellidos into v_nombre from public.trabajadores where id = v_perm.trabajador_id;

  perform pg_advisory_xact_lock(hashtextextended('extras:' || v_perm.trabajador_id::text, 0));
  select coalesce(sum(c.horas), 0) into v_hechas from public.horas_compensadas c
   where c.permiso_id = p_permiso_id and c.anulado_en is null;
  v_falta := v_perm.horas - v_hechas;
  if v_falta <= 0 then
    raise exception 'Ese permiso ya está justificado.' using errcode = 'check_violation';
  end if;
  v_saldo := public.saldo_horas_de(v_perm.trabajador_id);
  if v_saldo <= 0 then
    raise exception '% no tiene horas extras reservadas: resérvalas en «Horas extras» y vuelve a justificar.', v_nombre
      using errcode = 'check_violation';
  end if;

  v_horas := round(coalesce(p_horas, least(v_falta, v_saldo)), 2);
  if v_horas <= 0 then
    raise exception 'Escribe cuántas horas se justifican.' using errcode = 'check_violation';
  end if;
  if v_horas > v_falta then
    raise exception 'A ese permiso le faltan %: no se justifica más que eso.', public.horas_en_texto(v_falta) using errcode = 'check_violation';
  end if;
  if v_horas > v_saldo then
    raise exception '% tiene % reservadas: no le alcanzan para %.', v_nombre, public.horas_en_texto(v_saldo), public.horas_en_texto(v_horas)
      using errcode = 'check_violation';
  end if;

  insert into public.horas_compensadas (id, trabajador_id, fecha, horas, motivo, permiso_id)
  values (p_id, v_perm.trabajador_id, v_perm.fecha, v_horas,
          left('Permiso del ' || to_char(v_perm.fecha, 'DD/MM/YYYY') || ': ' || v_perm.motivo, 300), p_permiso_id);
  return p_id;
end;
$function$;

create or replace function public.rrhh_decidir_horas_extras(p_id uuid, p_trabajador_id uuid, p_fecha date, p_decision text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previo  public.horas_extras_decisiones%rowtype;
  v_j      record;
  v_tramo  numeric := coalesce((select g.horas_tramo1 from public.rrhh_regla_horas_extras g where g.id), 2);
  v_pend   numeric;
  v_t1     numeric;
begin
  perform public.exigir_permiso_del_puesto('planilla_diaria.preparar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de horas extras.' using errcode = 'check_violation';
  end if;
  -- Las horas no las escribe nadie: salen de lo que faltaba decidir ese día.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.horas_extras_decisiones where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Esta decisión ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.trabajador_id = p_trabajador_id and v_previo.fecha = p_fecha and v_previo.decision = p_decision then
      return p_id;
    end if;
    raise exception 'Esta decisión ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  if p_decision not in ('RESERVAR', 'PAGAR') then
    raise exception 'Elige si las horas extras se reservan o se pagan.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('extras:' || p_trabajador_id::text, 0));
  select * into v_j from public.jornadas_validadas() j where j.trabajador_id = p_trabajador_id and j.fecha = p_fecha;
  v_pend := coalesce(v_j.extras - v_j.extras_decididas, 0);
  if v_pend <= 0 then
    raise exception 'Esa persona no tiene horas extras por decidir ese día: recarga la pantalla.' using errcode = 'check_violation';
  end if;
  v_t1 := least(v_pend, greatest(v_tramo - v_j.extras_decididas, 0));
  insert into public.horas_extras_decisiones (id, trabajador_id, fecha, horas, horas_tramo1, horas_tramo2, decision)
  values (p_id, p_trabajador_id, p_fecha, v_pend, v_t1, v_pend - v_t1, p_decision);
  return p_id;
end;
$function$;

create or replace function public.cerrar_dia_caja(p_id uuid, p_caja_id uuid, p_fecha date, p_saldo_banco numeric, p_observaciones text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previo  public.cierres_caja%rowtype;
  v_caja      public.cajas%rowtype;
  v_obs       text := nullif(regexp_replace(btrim(coalesce(p_observaciones, '')), '\s+', ' ', 'g'), '');
  v_ultimo    date;
  v_pendiente date;
  v_inicial   numeric;
  v_ingresos  numeric;
  v_egresos   numeric;
  v_final     numeric;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del cierre.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.cierres_caja where id = p_id;
  if found then
    if v_previo.cerrado_por is distinct from public.usuario_actual() then
      raise exception 'Este cierre del día ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.caja_id = p_caja_id and v_previo.fecha = p_fecha
       and v_previo.saldo_banco = p_saldo_banco and v_previo.observaciones is not distinct from v_obs then
      return p_id;
    end if;
    raise exception 'Este cierre del día ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  if p_saldo_banco is null or p_saldo_banco not between -999999999 and 999999999
     or p_saldo_banco <> round(p_saldo_banco, 2) then
    raise exception 'Escribe el saldo que dice el estado de cuenta, con dos decimales como máximo.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_obs, '')) > 500 then
    raise exception 'Las observaciones pasan de 500 caracteres.' using errcode = 'check_violation';
  end if;
  v_caja := public.caja_dia_abierto(p_caja_id, p_fecha);

  select max(fecha) into v_ultimo from public.cierres_caja where caja_id = p_caja_id and anulado_en is null;
  select min(fecha) into v_pendiente from public.movimientos_caja
   where caja_id = p_caja_id and anulado_en is null and fecha < p_fecha
     and (v_ultimo is null or fecha > v_ultimo);
  if v_pendiente is not null then
    raise exception 'Primero cierra el % de %: tiene movimientos sin cerrar.', public.caja_texto_fecha(v_pendiente), v_caja.nombre
      using errcode = 'check_violation';
  end if;

  v_inicial := public.caja_saldo_al_empezar(p_caja_id, p_fecha);
  select coalesce(sum(monto) filter (where tipo = 'INGRESO'), 0), coalesce(sum(monto) filter (where tipo = 'EGRESO'), 0)
    into v_ingresos, v_egresos
    from public.movimientos_caja where caja_id = p_caja_id and fecha = p_fecha and anulado_en is null;
  v_final := v_inicial + v_ingresos - v_egresos;

  if p_saldo_banco <> v_final and v_obs is null then
    raise exception 'El estado de cuenta dice % y la caja %: cuenta en las observaciones por qué no cuadra.',
      public.caja_texto_monto(p_saldo_banco, v_caja.moneda), public.caja_texto_monto(v_final, v_caja.moneda)
      using errcode = 'check_violation';
  end if;
  if p_saldo_banco <> v_final and char_length(v_obs) < 10 then
    raise exception 'Cuenta un poco más por qué no cuadra: las observaciones van de 10 caracteres como mínimo.'
      using errcode = 'check_violation';
  end if;

  insert into public.cierres_caja (id, caja_id, fecha, saldo_inicial, ingresos, egresos, saldo_final, saldo_banco, observaciones)
  values (p_id, p_caja_id, p_fecha, v_inicial, v_ingresos, v_egresos, v_final, p_saldo_banco, v_obs);
  return p_id;
end;
$function$;

create or replace function public.enviar_planilla_diaria(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_previo  public.planillas_diarias%rowtype;
  v_yo       uuid := public.usuario_actual();
  v_regla    public.rrhh_regla_horas_extras%rowtype;
  v_pend     jsonb;
  v_persona  record;
  v_linea    jsonb;
  v_pid      uuid;
  v_hora     numeric(10, 4);
  v_monto    numeric(12, 2);
  v_ord_h    numeric := 0;
  v_ext_h    numeric := 0;
  v_ord_m    numeric := 0;
  v_ext_m    numeric := 0;
  v_total    numeric := 0;
  v_n        int := 0;
  v_numero   text;
  v_faltan   text;
begin
  perform public.exigir_permiso_del_puesto('planilla_diaria.preparar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de la planilla diaria.' using errcode = 'check_violation';
  end if;
  -- Dos envíos a la vez no se llevan las mismas horas. El repetido espera al
  -- primero y lo encuentra: antes miraba antes de esperar y caía en «No hay
  -- horas validadas por pagar».
  perform pg_advisory_xact_lock(hashtextextended('planilla_diaria', 0));
  select * into v_previo from public.planillas_diarias where id = p_id;
  if found then
    if v_previo.enviada_por is distinct from public.usuario_actual() then
      raise exception 'Esta planilla ya existe. Recarga antes de intentar de nuevo.';
    end if;
    return p_id;
  end if;
  select * into v_regla from public.rrhh_regla_horas_extras where id;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_pend
    from public.planilla_diaria_pendiente() p
   where exists (select 1 from public.trabajador_remuneraciones r where r.trabajador_id = p.trabajador_id);

  if jsonb_array_length(v_pend) = 0 then
    select string_agg(distinct t.nombres || ' ' || t.apellidos, ', ') into v_faltan
      from public.planilla_diaria_pendiente() p join public.trabajadores t on t.id = p.trabajador_id;
    if v_faltan is not null then
      raise exception 'Falta la remuneración mensual de %: pónsela en Personal y vuelve a armar la planilla.', v_faltan
        using errcode = 'check_violation';
    end if;
    raise exception 'No hay horas validadas por pagar: la planilla sale de los reportes con el visto de Gerencia y de Recursos Humanos.'
      using errcode = 'check_violation';
  end if;

  v_numero := public.siguiente_correlativo('PLANILLA_DIARIA', '001', null);
  -- Primero se cuentan las personas y el total: la guardia deja cambiar solo la
  -- anulación, así que van en el mismo insert de la planilla.
  for v_persona in
    select distinct (e->>'trabajador_id')::uuid as trabajador_id, t.nombres || ' ' || t.apellidos as nombre, t.cargo, t.apellidos, t.nombres,
           r.remuneracion_mensual
      from jsonb_array_elements(v_pend) e
      join public.trabajadores t on t.id = (e->>'trabajador_id')::uuid
      join public.trabajador_remuneraciones r on r.trabajador_id = t.id
     order by t.apellidos, t.nombres
  loop
    v_n := v_n + 1;
    v_hora := round(v_persona.remuneracion_mensual / 240, 4);
    v_ord_h := 0; v_ext_h := 0; v_ord_m := 0; v_ext_m := 0;
    for v_linea in select e from jsonb_array_elements(v_pend) e where (e->>'trabajador_id')::uuid = v_persona.trabajador_id loop
      if v_linea->>'concepto' = 'ORDINARIAS' then
        v_monto := round((v_linea->>'horas')::numeric * v_hora, 2);
        v_ord_h := v_ord_h + (v_linea->>'horas')::numeric;
        v_ord_m := v_ord_m + v_monto;
      else
        v_monto := round(v_hora * ((v_linea->>'horas_tramo1')::numeric * (1 + v_regla.recargo_tramo1 / 100)
                                   + (v_linea->>'horas_tramo2')::numeric * (1 + v_regla.recargo_tramo2 / 100)), 2);
        v_ext_h := v_ext_h + (v_linea->>'horas')::numeric;
        v_ext_m := v_ext_m + v_monto;
      end if;
    end loop;
    v_total := v_total + v_ord_m + v_ext_m;
  end loop;

  insert into public.planillas_diarias (id, numero, fecha, personas, total, enviada_por)
  values (p_id, v_numero, (now() at time zone 'America/Lima')::date, v_n, v_total, v_yo);

  for v_persona in
    select distinct (e->>'trabajador_id')::uuid as trabajador_id, t.nombres || ' ' || t.apellidos as nombre, t.cargo, t.apellidos, t.nombres,
           r.remuneracion_mensual
      from jsonb_array_elements(v_pend) e
      join public.trabajadores t on t.id = (e->>'trabajador_id')::uuid
      join public.trabajador_remuneraciones r on r.trabajador_id = t.id
     order by t.apellidos, t.nombres
  loop
    v_hora := round(v_persona.remuneracion_mensual / 240, 4);
    v_ord_h := 0; v_ext_h := 0; v_ord_m := 0; v_ext_m := 0;
    -- Primero los totales de la persona (la guardia no deja cambiarlos después).
    for v_linea in select e from jsonb_array_elements(v_pend) e where (e->>'trabajador_id')::uuid = v_persona.trabajador_id loop
      if v_linea->>'concepto' = 'ORDINARIAS' then
        v_ord_h := v_ord_h + (v_linea->>'horas')::numeric;
        v_ord_m := v_ord_m + round((v_linea->>'horas')::numeric * v_hora, 2);
      else
        v_ext_h := v_ext_h + (v_linea->>'horas')::numeric;
        v_ext_m := v_ext_m + round(v_hora * ((v_linea->>'horas_tramo1')::numeric * (1 + v_regla.recargo_tramo1 / 100)
                                             + (v_linea->>'horas_tramo2')::numeric * (1 + v_regla.recargo_tramo2 / 100)), 2);
      end if;
    end loop;
    insert into public.planilla_diaria_personas (planilla_id, trabajador_id, nombre, cargo, horas_ordinarias, horas_extras,
                                                 monto_ordinarias, monto_extras, total)
    values (p_id, v_persona.trabajador_id, v_persona.nombre, v_persona.cargo, v_ord_h, v_ext_h, v_ord_m, v_ext_m, v_ord_m + v_ext_m)
    returning id into v_pid;

    for v_linea in
      select e from jsonb_array_elements(v_pend) e
       where (e->>'trabajador_id')::uuid = v_persona.trabajador_id
       order by e->>'fecha', e->>'concepto' desc
    loop
      if v_linea->>'concepto' = 'ORDINARIAS' then
        insert into public.planilla_diaria_detalle (persona_id, trabajador_id, fecha, concepto, horas, valor_hora, monto)
        values (v_pid, v_persona.trabajador_id, (v_linea->>'fecha')::date, 'ORDINARIAS', (v_linea->>'horas')::numeric, v_hora,
                round((v_linea->>'horas')::numeric * v_hora, 2));
      else
        insert into public.planilla_diaria_detalle (persona_id, trabajador_id, fecha, concepto, horas, horas_tramo1, horas_tramo2,
                                                    valor_hora, recargo_tramo1, recargo_tramo2, monto, decision_id)
        values (v_pid, v_persona.trabajador_id, (v_linea->>'fecha')::date, 'EXTRAS', (v_linea->>'horas')::numeric,
                (v_linea->>'horas_tramo1')::numeric, (v_linea->>'horas_tramo2')::numeric, v_hora,
                v_regla.recargo_tramo1, v_regla.recargo_tramo2,
                round(v_hora * ((v_linea->>'horas_tramo1')::numeric * (1 + v_regla.recargo_tramo1 / 100)
                                + (v_linea->>'horas_tramo2')::numeric * (1 + v_regla.recargo_tramo2 / 100)), 2),
                (v_linea->>'decision_id')::uuid);
      end if;
    end loop;
  end loop;

  perform public.notificar_a_permiso('planilla_diaria.pagar', 'Planilla diaria por pagar: ' || v_numero,
    v_n || case when v_n = 1 then ' persona · S/ ' else ' personas · S/ ' end || to_char(v_total, 'FM999G999G990D00'),
    '/planilla-diaria/' || p_id, 'planillas_diarias', p_id, v_yo);
  return p_id;
end;
$function$;

create or replace function public.registrar_recepcion_material(p_id uuid, p_orden_compra_detalle_id uuid, p_cantidad cantidad, p_documento_referencia text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_previo public.movimientos_materiales%rowtype; v_req uuid; v_material uuid; v_pendiente numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null or p_cantidad is null or p_cantidad <= 0
     or length(btrim(coalesce(p_documento_referencia, ''))) not between 2 and 100 then
    raise exception 'Indica una cantidad recibida y el documento del proveedor.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.movimientos_materiales where id = p_id;
  if found then
    if v_previo.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Esta recepción ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.tipo = 'INGRESO' and v_previo.orden_compra_detalle_id = p_orden_compra_detalle_id
       and v_previo.cantidad = p_cantidad and v_previo.documento_referencia = btrim(p_documento_referencia) then
      return p_id;
    end if;
    raise exception 'Esta recepción ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  select requerimiento_detalle_id, material_id into v_req, v_material
    from public.orden_compra_material_detalles
   where id = p_orden_compra_detalle_id for update;
  if not found then raise exception 'La línea de compra no existe.' using errcode = 'foreign_key_violation'; end if;
  if exists (select 1 from public.ingresos_pendientes_almacen
              where orden_compra_detalle_id = p_orden_compra_detalle_id and estado = 'PENDIENTE') then
    raise exception 'El conductor ya dejó esta compra en almacén: valídala en el kardex, en «Ingresos por validar».'
      using errcode = 'check_violation';
  end if;
  -- Lo que espera reposición entra solo por `recibir_reposicion`, contra su devolución.
  select ocd.cantidad - k.sin_reponer - k.por_reponer - k.neto
    into v_pendiente from public.orden_compra_material_detalles ocd
   cross join lateral public.cuenta_de_la_linea_de_compra(ocd.id) k
   where ocd.id = p_orden_compra_detalle_id;
  if p_cantidad > v_pendiente then
    raise exception 'La recepción supera lo pendiente de esta compra (%).', v_pendiente using errcode = 'check_violation';
  end if;
  insert into public.movimientos_materiales
    (id, tipo, requerimiento_detalle_id, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por)
  values (p_id, 'INGRESO', v_req, p_orden_compra_detalle_id, case when v_req is null then v_material end, p_cantidad,
          btrim(p_documento_referencia), public.usuario_actual());
  return p_id;
end;
$function$;

create or replace function public.despachar_material_con_foto(p_id uuid, p_detalle uuid, p_cantidad numeric, p_responsable uuid, p_recibe text, p_foto text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_material uuid; v_area text; v_solicitada numeric; v_reserva numeric; v_despachada numeric; v_de_stock numeric;
  v_recibida numeric; v_salida_stock numeric; v_stock numeric; v_objeto storage.objects%rowtype; v_existente public.movimientos_materiales%rowtype;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_cantidad is null or p_cantidad<=0 or p_cantidad<>round(p_cantidad,3)
    or length(btrim(coalesce(p_recibe,''))) not between 3 and 160
    or p_foto is null or p_foto not in (auth.uid()::text||'/'||p_id::text||'.jpg',auth.uid()::text||'/'||p_id::text||'.png',auth.uid()::text||'/'||p_id::text||'.webp') then
    raise exception 'Indica cantidad, destinatario y foto de esta entrega.';
  end if;
  select om.material_id,r.area_destino,d.cantidad_solicitada,coalesce(d.cantidad_stock,case when d.decision_almacen='STOCK' then d.cantidad_solicitada else 0 end)
    into v_material,v_area,v_solicitada,v_reserva from public.requerimiento_material_detalles d
    join public.requerimientos_materiales r on r.id=d.requerimiento_id join public.ot_materiales om on om.id=d.ot_material_id
    join public.ordenes_trabajo ot on ot.id=r.orden_id
    where d.id=p_detalle and d.aprobacion_diseno='APROBADO' and d.decision_almacen in ('STOCK','COMPRA') and ot.estado::text<>'ANULADA' for update of d;
  if not found then raise exception 'Diseño y Almacén deben revisar el material antes de despacharlo.'; end if;
  perform 1 from public.materiales where id=v_material for update;
  select * into v_existente from public.movimientos_materiales where id=p_id;
  if found then
    if v_existente.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Este despacho ya existe con otros datos. Recarga la solicitud.';
    end if;
    if v_existente.tipo='DESPACHO' and v_existente.requerimiento_detalle_id=p_detalle and v_existente.cantidad=p_cantidad
      and v_existente.responsable_id=p_responsable and v_existente.foto_ruta=p_foto and v_existente.recibido_por_nombre=btrim(p_recibe) then return p_id; end if;
    raise exception 'Este despacho ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  select * into v_objeto from storage.objects where bucket_id='evidencias-almacen' and name=p_foto;
  if not found or v_objeto.owner_id is distinct from auth.uid()::text or v_objeto.metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp')
    or coalesce((v_objeto.metadata->>'size')::bigint,0) not between 1 and 10485760 then raise exception 'Carga una foto válida antes de confirmar el despacho.'; end if;
  select coalesce(sum(cantidad) filter(where tipo='DESPACHO'),0),coalesce(sum(cantidad) filter(where tipo='INGRESO'),0),
    coalesce(sum(cantidad_de_stock) filter(where tipo='DESPACHO'),0) into v_despachada,v_recibida,v_salida_stock
    from public.movimientos_materiales where requerimiento_detalle_id=p_detalle;
  v_de_stock:=least(p_cantidad,greatest(v_reserva-v_salida_stock,0));
  if p_cantidad>v_solicitada-v_despachada then raise exception 'La entrega supera la cantidad solicitada.'; end if;
  if p_cantidad-v_de_stock>v_recibida-(v_despachada-v_salida_stock) then raise exception 'Confirma la recepción de la compra antes de entregar el faltante.'; end if;
  if not exists(select 1 from public.usuarios u join public.areas a on a.id=u.area_id where u.id=p_responsable and u.activo and a.codigo=v_area) then
    raise exception 'El destinatario debe pertenecer al área que solicitó el material.';
  end if;
  v_stock:=public.saldo_registrado_material(v_material);
  if p_cantidad>v_stock then raise exception 'No hay saldo físico suficiente para este despacho.'; end if;
  insert into public.movimientos_materiales(id,tipo,requerimiento_detalle_id,material_id,cantidad,responsable_id,registrado_por,
    origen,cantidad_de_stock,foto_ruta,recibido_por_nombre)
    values(p_id,'DESPACHO',p_detalle,v_material,p_cantidad,p_responsable,public.usuario_actual(),'DESPACHO',v_de_stock,p_foto,btrim(p_recibe));
  return p_id;
end $function$;

create or replace function public.registrar_salida_material(p_id uuid, p_material uuid, p_cantidad numeric, p_unidad uuid, p_codigo text, p_motivo text, p_recibe text, p_foto text, p_requerimiento_linea uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Como lo junta el costeo, la lista y la unidad: con otra cuenta de un lado,
  -- la unidad del padrón no se encontraba.
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_unidad uuid := p_unidad;
  v_coincide uuid[];
  v_existente public.movimientos_materiales%rowtype;
  v_objeto storage.objects%rowtype;
  v_reserva numeric;
  v_libre numeric;
  v_almacen text;
  v_codigo_interno text;
  v_linea public.v_rq_lineas_para_salida%rowtype;
  v_rq_codigo text;
  v_llave text;
  v_reservado_otros numeric;
  v_de_la_unidad numeric;
  v_separado numeric;
  v_cubierto numeric;
  v_cargo_unidad numeric;
  v_codigo_del_rq boolean := false;
  -- El código del RQ, o el de la lista escrito como la placa de un vehículo sin
  -- código: la salida queda en el vehículo y sale con ese código.
  v_codigo_aparte boolean := false;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_material is null or p_cantidad is null or p_cantidad <= 0 or p_cantidad <> round(p_cantidad, 3)
     or length(btrim(coalesce(p_motivo, ''))) not between 3 and 200
     or length(btrim(coalesce(p_recibe, ''))) not between 3 and 160
     or p_foto is null
     or p_foto not in (auth.uid()::text || '/' || p_id::text || '.jpg',
                       auth.uid()::text || '/' || p_id::text || '.png',
                       auth.uid()::text || '/' || p_id::text || '.webp') then
    raise exception 'Indica material, cantidad, motivo, quién recibe y la foto de la salida.';
  end if;

  -- Primero el RQ, compartido: la revisión del stock, la corrección y la
  -- anulación lo toman antes que nada, y la revisión toma después el material
  -- (al asociarlo a un insumo). Si la salida tomaba primero el material, las dos
  -- se quedaban esperando una a la otra. Dos salidas del mismo RQ no se estorban.
  if p_requerimiento_linea is not null then
    select r.codigo_interno into v_rq_codigo
      from public.requerimientos r
      join public.requerimiento_lineas l on l.requerimiento_id = r.id
     where l.id = p_requerimiento_linea
       for share of r;
    if not found then
      raise exception 'Ese ítem de requerimiento no existe: recarga el kardex.';
    end if;
    -- Si no se dijo a qué unidad va, va a la del requerimiento.
    if v_unidad is null and v_codigo is null and public.normalizar_codigo_interno(v_rq_codigo) <> 'PLANTA' then
      v_codigo := public.normalizar_codigo_interno(v_rq_codigo);
      v_codigo_del_rq := true;
    end if;
  end if;

  -- Después el material, y al final el insumo.
  perform 1 from public.materiales where id = p_material and activo for update;
  if not found then raise exception 'El material no está activo.'; end if;

  if (v_unidad is null) = (v_codigo is null) then
    raise exception 'Vincula la salida a un vehículo registrado o escribe el código de la unidad, uno de los dos.';
  end if;

  if v_unidad is not null then
    perform 1 from public.unidades where id = v_unidad and activo;
    if not found then raise exception 'La unidad elegida no existe o está desactivada.'; end if;
  else
    -- De 2 a 60, como el código interno de un RQ: uno de dos letras no dejaba
    -- registrar su salida.
    if length(v_codigo) not between 2 and 60 then
      raise exception 'El código de la unidad debe tener de 2 a 60 caracteres.';
    end if;
    -- Si el código escrito es el de una unidad registrada, la salida se vincula
    -- a ella: así el mismo vehículo no aparece con dos nombres en el kardex.
    -- Con los espacios juntados de los dos lados, como lo muestra la lista.
    select array_agg(u.id) into v_coincide from public.unidades u
     where u.activo and public.normalizar_codigo_interno(u.codigo_interno) = v_codigo;
    -- Si no, la placa: primero como se escribió y, si ningún vehículo la tiene
    -- así, solo por sus letras y números («W22MQ0» o «W22 MQ0» es la W22-MQ0;
    -- escrita así, un accesorio salía hacia un vehículo sin código interno como
    -- si fuera un código nuevo). La salida queda en ese vehículo: así entra
    -- también al costeo de su OT. Con qué código sale:
    -- * El del RQ, si viene de él: es el código del pedido. Lo mismo hacía la
    --   salida de antes (20261013140000) con la placa tal cual.
    -- * El escrito, si es un código de la lista y ningún vehículo de esa placa
    --   tiene código interno: Requerimientos usa la placa como código del
    --   vehículo que todavía no lo tiene, y sin él la salida perdía ese costo.
    --   La lista se arma solo en ese caso: con muchos movimientos tarda segundos.
    -- * Si no, el del vehículo: la placa del que ya tiene código va a su código,
    --   aunque siga en la lista de cuando no lo tenía; si no, el costo del mismo
    --   vehículo se partía según se escribiera la placa.
    -- Dos vehículos con la misma placa (de dos clientes, o una con guion y otra
    -- sin él) no se adivinan: con el código del RQ o de la lista, la salida no
    -- queda en ninguno; escrita, se rechaza (como código nuevo, el costo
    -- quedaba en un código de nadie).
    if v_coincide is null then
      select array_agg(u.id) into v_coincide from public.unidades u
       where u.activo and public.normalizar_codigo_interno(u.placa) = v_codigo;
      if v_coincide is null and regexp_replace(upper(v_codigo), '[^A-Z0-9]', '', 'g') <> '' then
        select array_agg(u.id) into v_coincide from public.unidades u
         where u.activo and regexp_replace(upper(coalesce(u.placa, '')), '[^A-Z0-9]', '', 'g')
                            = regexp_replace(upper(v_codigo), '[^A-Z0-9]', '', 'g');
      end if;
      if v_codigo_del_rq then
        v_codigo_aparte := true;
      elsif v_coincide is not null
         and not exists (select 1 from public.unidades u
                          where u.id = any(v_coincide) and public.normalizar_codigo_interno(u.codigo_interno) is not null) then
        v_codigo_aparte := exists (select 1 from public.codigos_internos_para_elegir() c where c.codigo = v_codigo);
      end if;
      if cardinality(v_coincide) > 1 then
        if not v_codigo_aparte then
          raise exception 'La placa % es de más de un vehículo registrado: elige el vehículo en «Vehículo registrado».', v_codigo;
        end if;
        v_coincide := null;
      end if;
    end if;
    if cardinality(v_coincide) = 1 then
      v_unidad := v_coincide[1];
      if not v_codigo_aparte then v_codigo := null; end if;
    end if;
  end if;

  -- Un reintento del mismo envío (la respuesta no llegó) devuelve la salida que
  -- ya entró, aunque mientras tanto su RQ se haya entregado. Se mira con el
  -- material trabado: si los dos envíos llegan a la vez, el segundo espera al
  -- primero y lo encuentra aquí, en vez de chocar al guardar. Con otro destino
  -- no es un reintento. A una unidad registrada, el código lo pone su
  -- disparador (`fn_destino_movimiento_almacen`): basta con que sea la misma.
  select * into v_existente from public.movimientos_materiales where id = p_id;
  if found then
    if v_existente.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Esa salida ya existe con otros datos. Recarga el kardex.';
    end if;
    if v_existente.tipo = 'SALIDA'
       and v_existente.material_id = p_material and v_existente.cantidad = p_cantidad
       and v_existente.foto_ruta = p_foto and v_existente.recibido_por_nombre = btrim(p_recibe)
       and v_existente.documento_referencia = btrim(p_motivo)
       and v_existente.requerimiento_linea_id is not distinct from p_requerimiento_linea
       and v_existente.unidad_id is not distinct from v_unidad
       and (v_unidad is not null or v_existente.codigo_unidad is not distinct from v_codigo) then
      return p_id;
    end if;
    raise exception 'Esta salida ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;

  -- La línea del requerimiento: viva, con saldo por entregar, y del mismo almacén.
  if p_requerimiento_linea is not null then
    -- Dos salidas a la vez para el mismo insumo: la segunda espera y lee lo
    -- que dejó la primera.
    perform 1 from public.requerimiento_lineas where id = p_requerimiento_linea for update;
    select * into v_linea from public.v_rq_lineas_para_salida where linea_id = p_requerimiento_linea;
    if not found then
      raise exception 'Ese requerimiento ya se entregó o se anuló: recarga el kardex.';
    end if;
    if v_linea.pendiente < p_cantidad then
      raise exception 'El requerimiento % pide % % de «%» y ya se entregó %: quedan % por entregar.',
        v_linea.numero, trim_scale(v_linea.cantidad), v_linea.unidad, v_linea.descripcion, trim_scale(v_linea.entregado), trim_scale(v_linea.pendiente);
    end if;
  end if;

  v_almacen := public.almacen_de_material(p_material);
  -- Lo que llegó de la compra del insumo sale para él aunque Logística lo haya
  -- comprado de otra categoría: es justo lo que se compró para ese pedido.
  if v_linea.almacen is not null and v_almacen is not null and v_linea.almacen <> v_almacen
     and p_material is distinct from v_linea.material_comprado then
    raise exception 'El requerimiento % pide «%» (%), y este material es de %: elige un material de ese almacén.',
      v_linea.numero, v_linea.descripcion, v_linea.categoria, lower(replace(v_almacen, '_', ' '));
  end if;

  -- El código interno para el que sale: el del RQ, el escrito, o el de la unidad.
  -- Con los espacios juntados, como en «Stock en almacén» y en el costeo.
  v_codigo_interno := coalesce(
    nullif(public.normalizar_codigo_interno(v_linea.codigo_interno), 'PLANTA'),
    v_codigo,
    (select public.normalizar_codigo_interno(u.codigo_interno) from public.unidades u where u.id = v_unidad));
  -- PLANTA, OFICINA y TODOS LOS ACTIVOS son códigos, pero no de una unidad: un
  -- accesorio sale a uno de ellos solo si su RQ lo pide así. Sin RQ, o hacia
  -- otro de los tres, Almacén no lo decide por su cuenta. Se comparan solo las
  -- letras y los números: un tabulador, un espacio duro o uno de ancho cero
  -- pegados desde Excel no hacen de «OFICINA» otro código.
  v_llave := regexp_replace(upper(coalesce(v_codigo_interno, '')), '[^A-Z0-9]', '', 'g');
  -- El vehículo elegido (o cuya placa se escribió) sin código interno: el
  -- mensaje de abajo le pedía elegir la unidad, que ya estaba elegida.
  if v_almacen = 'ACCESORIOS' and v_codigo_interno is null and v_unidad is not null then
    raise exception 'La unidad elegida no tiene código interno, y un accesorio sale solo para una unidad con código.';
  end if;
  if v_almacen = 'ACCESORIOS' and (v_codigo_interno is null
     or (v_llave in ('PLANTA', 'OFICINA', 'TODOSLOSACTIVOS')
         and v_llave <> regexp_replace(upper(coalesce(v_rq_codigo, '')), '[^A-Z0-9]', '', 'g'))) then
    raise exception 'Un accesorio sale solo para una unidad con código interno: a PLANTA, OFICINA o todos los activos sale solo si lo pide así su requerimiento. Elige el código de la unidad o el requerimiento que lo pide.';
  end if;

  select * into v_objeto from storage.objects where bucket_id = 'evidencias-almacen' and name = p_foto;
  if not found or v_objeto.owner_id is distinct from auth.uid()::text
     or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'Carga una foto válida antes de confirmar la salida.';
  end if;

  -- Lo reservado para solicitudes de OT no se entrega por salida general.
  select coalesce(sum(greatest(coalesce(d.cantidad_stock, case when d.decision_almacen = 'STOCK' then d.cantidad_solicitada else 0 end)
                               + coalesce(s.ingresado, 0) - coalesce(s.cantidad, 0), 0)), 0)
    into v_reserva
    from public.requerimiento_material_detalles d
    join public.ot_materiales om on om.id = d.ot_material_id
    join public.ordenes_trabajo ot on ot.id = om.orden_id
    left join lateral (
      select sum(x.cantidad) filter (where x.tipo = 'DESPACHO') cantidad,
             sum(x.cantidad) filter (where x.tipo = 'INGRESO' and x.origen = 'COMPRA') ingresado
        from public.movimientos_materiales x where x.requerimiento_detalle_id = d.id) s on true
   where om.material_id = p_material and d.decision_almacen in ('STOCK', 'COMPRA') and ot.estado::text <> 'ANULADA';
  v_libre := greatest(public.saldo_registrado_material(p_material) - v_reserva, 0);
  if p_cantidad > v_libre then
    raise exception 'Solo hay % libre de este material; lo demás está reservado para solicitudes de OT o no está en almacén.%', trim_scale(v_libre),
      case when p_requerimiento_linea is not null
           then ' Si llegó de la compra del requerimiento y no está en el kardex, registra antes su ingreso.' else '' end;
  end if;

  -- Un accesorio que entró para una unidad no sale para otra. La misma cuenta
  -- que «Stock en almacén» (accesorios_de_cada_unidad, sección 8).
  if v_almacen = 'ACCESORIOS' then
    select coalesce(sum(greatest(a.saldo, 0)) filter (where a.codigo <> v_codigo_interno), 0),
           coalesce(sum(greatest(a.saldo, 0)) filter (where a.codigo = v_codigo_interno), 0)
      into v_reservado_otros, v_de_la_unidad
      from public.accesorios_de_cada_unidad(array[p_material]) a;
    if p_cantidad > v_libre - v_reservado_otros then
      raise exception 'De este accesorio hay % libre para la unidad %: % entró para otras unidades y sale solo para ellas.',
        trim_scale(greatest(v_libre - v_reservado_otros, 0)), v_codigo_interno, trim_scale(v_reservado_otros);
    end if;
    -- Con un RQ de otro código (uno de PLANTA hacia esta unidad), la salida se
    -- lleva primero lo que separó su línea, si de verdad está fuera de lo que
    -- entró para las unidades; después, lo que entró para esta unidad, y lo
    -- demás, de lo libre. Lo de la unidad queda anotado en la salida (sección 8).
    if p_requerimiento_linea is not null
       and v_codigo_interno is distinct from public.normalizar_codigo_interno(v_rq_codigo) then
      select coalesce(sum(s.cantidad), 0) into v_separado
        from public.separado_de_cada_linea(array[p_material]) s
       where s.linea = p_requerimiento_linea;
      v_cubierto := least(p_cantidad, v_separado, greatest(v_libre - v_reservado_otros - v_de_la_unidad, 0));
      v_cargo_unidad := least(p_cantidad - v_cubierto, v_de_la_unidad);
    end if;
  end if;

  insert into public.movimientos_materiales(id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
    cantidad_de_stock, foto_ruta, recibido_por_nombre, unidad_id, codigo_unidad, codigo_interno, requerimiento_linea_id, de_la_unidad)
  values (p_id, 'SALIDA', p_material, p_cantidad, 'SALIDA_GENERAL', btrim(p_motivo), public.usuario_actual(),
    p_cantidad, p_foto, btrim(p_recibe), v_unidad, v_codigo, v_codigo_interno, p_requerimiento_linea, v_cargo_unidad);
  return p_id;
end $function$;

create or replace function public.registrar_gasto_general(p_id uuid, p_periodo date, p_concepto text, p_descripcion text, p_monto numeric, p_moneda text, p_reparto text, p_tasa numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.gastos_generales_mes%rowtype; v_periodo date := date_trunc('month', p_periodo)::date;
begin
  perform public.exigir_permiso('costos.gastos_generales');
  if p_id is null or p_periodo is null or length(btrim(coalesce(p_descripcion, ''))) not between 3 and 300
     or p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) or p_moneda is null or p_moneda not in ('PEN','USD')
     then
    raise exception 'Indica mes, concepto, detalle (3 a 300 caracteres), importe y moneda.';
  end if;
  -- Lo nuevo va por horas (DKS, 2026-10-20). La tabla sigue admitiendo TASA y
  -- PARTES_IGUALES solo por los gastos que ya se registraron así.
  if p_reparto is distinct from 'HORAS' or p_tasa is not null then
    raise exception 'Los gastos del mes se reparten por horas: ya no se registran con tasa ni en partes iguales.';
  end if;
  perform 1 from public.conceptos_gasto_general where codigo = p_concepto and activo;
  if not found then raise exception 'Elige un concepto de gasto válido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v from public.gastos_generales_mes where id = p_id;
  if found then
    if v.registrado_por is distinct from public.usuario_actual() then
      raise exception 'Ese gasto ya existe con otros datos. Recarga la pantalla.';
    end if;
    if v.estado <> 'ACTIVO' then
      raise exception 'Ese gasto ya se anuló: regístralo de nuevo si corresponde.';
    end if;
    if v.periodo = v_periodo and v.concepto = p_concepto and v.monto = p_monto and v.moneda = p_moneda
       and v.descripcion = btrim(p_descripcion) and v.reparto = p_reparto and v.tasa is not distinct from p_tasa then
      return p_id;
    end if;
    raise exception 'Este gasto ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  insert into public.gastos_generales_mes(id, periodo, concepto, descripcion, monto, moneda, reparto, tasa)
  values (p_id, v_periodo, p_concepto, btrim(p_descripcion), p_monto, p_moneda, p_reparto, p_tasa);
  return p_id;
end $function$;

create or replace function public.guardar_caja(p_id uuid, p_nombre text, p_tipo text, p_banco text, p_moneda text, p_saldo_inicial numeric, p_fecha_inicio date, p_activa boolean, p_apertura_ruta text, p_alta boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_nombre  text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_banco   text := nullif(regexp_replace(btrim(coalesce(p_banco, '')), '\s+', ' ', 'g'), '');
  v_tipo    text := upper(btrim(coalesce(p_tipo, '')));
  v_moneda  text := upper(btrim(coalesce(p_moneda, '')));
  v_activa  boolean := coalesce(p_activa, true);
  v_ruta    text := nullif(btrim(coalesce(p_apertura_ruta, '')), '');
  v_previa  public.cajas%rowtype;
  v_existe  boolean;
  v_con_mov boolean := false;
  v_otra    text;
  v_saldo   numeric;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la cuenta.' using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) not between 2 and 60 then
    raise exception 'Ponle un nombre a la cuenta, de 2 a 60 caracteres: «BCP soles», «Caja chica».' using errcode = 'check_violation';
  end if;
  if v_tipo not in ('BANCO', 'EFECTIVO') then
    raise exception 'Elige si la cuenta es de un banco o en efectivo.' using errcode = 'check_violation';
  end if;
  if v_tipo = 'BANCO' and char_length(coalesce(v_banco, '')) not between 2 and 40 then
    raise exception 'Escribe el banco de la cuenta: BCP, BBVA…' using errcode = 'check_violation';
  end if;
  if v_tipo = 'EFECTIVO' then v_banco := null; end if;
  if v_moneda not in ('PEN', 'USD') then
    raise exception 'Elige la moneda de la cuenta.' using errcode = 'check_violation';
  end if;
  if p_saldo_inicial is null or p_saldo_inicial not between -999999999 and 999999999
     or p_saldo_inicial <> round(p_saldo_inicial, 2) then
    raise exception 'Escribe el saldo inicial con dos decimales como máximo.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is null or p_fecha_inicio > v_hoy then
    raise exception 'Elige el día de ese saldo inicial: hasta hoy.' using errcode = 'check_violation';
  end if;

  -- check_violation y no unique_violation: este mensaje es para la persona, y
  -- `mensajeDeError` cambia cualquier unique_violation por uno genérico.
  select nombre into v_otra from public.cajas where lower(btrim(nombre)) = lower(v_nombre) and id <> p_id;
  if found then
    raise exception 'Ya hay una cuenta que se llama %: ponle otro nombre.', v_otra using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previa from public.cajas where id = p_id for update;
  v_existe := found;
  -- Dar de alta no corrige: con el mismo id, es el alta repetida. La misma da
  -- la cuenta que ya quedó; con algo cambiado, lo nuevo no se guarda. Antes la
  -- segunda vuelta corregía en silencio la cuenta recién abierta.
  if v_existe and coalesce(p_alta, false) then
    if v_previa.creado_por is distinct from public.usuario_actual() then
      raise exception 'Esta cuenta ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    if v_previa.nombre = v_nombre and v_previa.tipo = v_tipo and v_previa.banco is not distinct from v_banco
       and v_previa.moneda = v_moneda and v_previa.saldo_inicial = p_saldo_inicial
       and v_previa.fecha_inicio = p_fecha_inicio and v_previa.activa = v_activa
       and v_previa.apertura_ruta is not distinct from v_ruta then
      return p_id;
    end if;
    raise exception 'Esta cuenta ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  if v_existe then
    v_con_mov := exists (select 1 from public.movimientos_caja where caja_id = p_id)
                 or exists (select 1 from public.cierres_caja where caja_id = p_id);
    if row(v_tipo, v_moneda, p_saldo_inicial, p_fecha_inicio)
       is distinct from row(v_previa.tipo, v_previa.moneda, v_previa.saldo_inicial, v_previa.fecha_inicio)
       and v_con_mov then
      raise exception 'La cuenta % ya tiene movimientos: su tipo, su moneda, su saldo inicial y su fecha no cambian. Si el saldo estaba mal, registra un ingreso o egreso de ajuste.',
        v_previa.nombre using errcode = 'check_violation';
    end if;
  end if;

  -- La captura del saldo: obligatoria al dar de alta un banco, y al pasar a
  -- banco la que era de efectivo (su foto del conteo no es la del aplicativo).
  -- Sin una nueva, se queda la que tenía. Con movimientos, la que ya tiene no
  -- se cambia.
  -- Un banco que se abre, o la caja chica que pasa a banco, trae una captura
  -- nueva: la foto del conteo que ya tenía no es la pantalla del aplicativo.
  if v_tipo = 'BANCO' and (not v_existe or v_previa.tipo <> 'BANCO')
     and (v_ruta is null or v_ruta is not distinct from v_previa.apertura_ruta) then
    raise exception 'Adjunta la captura del aplicativo del banco con el saldo de ese día: es el respaldo del saldo inicial.'
      using errcode = 'check_violation';
  end if;
  if v_ruta is null then
    v_ruta := v_previa.apertura_ruta;
  elsif v_existe and v_ruta is not distinct from v_previa.apertura_ruta then
    null;
  else
    if v_existe and v_previa.apertura_ruta is not null and v_con_mov then
      raise exception 'La cuenta % ya tiene movimientos: la captura de su saldo inicial queda como respaldo y no se cambia.',
        v_previa.nombre using errcode = 'check_violation';
    end if;
    -- Que esté subida, que sea de quien guarda, de esta cuenta, foto o PDF y hasta 10 MB.
    perform public.archivo_subido_por_mi('apertura-caja', v_ruta, p_id,
      array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  end if;

  -- Una cuenta desactivada sale de la tabla y del consolidado: con plata
  -- adentro, esa plata desaparecería del total sin que nadie la haya movido.
  if not v_activa and (not v_existe or v_previa.activa) then
    v_saldo := p_saldo_inicial + coalesce((
      select sum(case when m.tipo = 'INGRESO' then m.monto else -m.monto end)
        from public.movimientos_caja m
       where m.caja_id = p_id and m.anulado_en is null), 0);
    if v_saldo > 0 then
      raise exception 'La cuenta % todavía tiene %: pásalo a otra cuenta con una transferencia y después desactívala.',
        coalesce(v_previa.nombre, v_nombre), public.caja_texto_monto(v_saldo, v_moneda) using errcode = 'check_violation';
    elsif v_saldo < 0 then
      raise exception 'La cuenta % está sobregirada en %: cúbrelo con una transferencia desde otra cuenta y después desactívala.',
        coalesce(v_previa.nombre, v_nombre), public.caja_texto_monto(-v_saldo, v_moneda) using errcode = 'check_violation';
    end if;
  end if;

  if v_existe then
    update public.cajas
       set nombre = v_nombre, tipo = v_tipo, banco = v_banco, moneda = v_moneda,
           saldo_inicial = p_saldo_inicial, fecha_inicio = p_fecha_inicio, activa = v_activa,
           apertura_ruta = v_ruta
     where id = p_id;
  else
    insert into public.cajas (id, nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, activa, apertura_ruta)
    values (p_id, v_nombre, v_tipo, v_banco, v_moneda, p_saldo_inicial, p_fecha_inicio, v_activa, v_ruta);
  end if;
  return p_id;
end;
$function$;

comment on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text, boolean) is
  'Tesorería da de alta (p_alta) o corrige una cuenta de la caja (banco o efectivo, moneda, saldo inicial y su día, y la captura que lo respalda: obligatoria para un banco nuevo), o la desactiva si ya no tiene saldo. El alta repetida con otros datos no corrige: dice que ya quedó. Exige tesoreria.caja.';
revoke all on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text, boolean) from public, anon;
grant execute on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text, boolean) to authenticated;

-- La de nueve parámetros, de una pantalla abierta desde antes: corrige como
-- siempre. Sin valor por omisión en `p_alta`: con él, la llamada con nueve
-- nombres tendría dos funciones posibles y no entraría ninguna.
create or replace function public.guardar_caja(
  p_id uuid, p_nombre text, p_tipo text, p_banco text, p_moneda text,
  p_saldo_inicial numeric, p_fecha_inicio date, p_activa boolean, p_apertura_ruta text
) returns uuid language sql set search_path to 'public' as $$
  select public.guardar_caja(p_id, p_nombre, p_tipo, p_banco, p_moneda, p_saldo_inicial, p_fecha_inicio, p_activa, p_apertura_ruta, false);
$$;
comment on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text) is
  'La versión sin p_alta, para una pantalla abierta antes de la migración 20261023200000: guarda la cuenta como antes.';
revoke all on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text) from public, anon;
grant execute on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text) to authenticated;
