-- =============================================================================
-- EL MANTENIMIENTO Y LA GARANTÍA VAN POR EL N.º DE SU OT, NO POR CÓDIGO INTERNO
-- -----------------------------------------------------------------------------
-- El área de Requerimientos devolvió el 2026-11-20 sus observaciones del
-- sistema (PDF «METAL WORK PERU (ERP)», que DKS subió al hilo):
--
--   Registro de vehículos:
--     «Las OT de garantía se maneja por N.º.»
--     «En cuanto a mantenimiento se registra por N.º OT, no tenemos código
--      interno.»
--   Requerimientos:
--     «Solo presenta códigos internos que son de las unidades de fabricación,
--      no N.º de OT en cuanto de mantenimiento ni garantía.»
--
-- Es como trabaja la empresa: el código interno nace con la fabricación de una
-- unidad; el mantenimiento y la garantía se siguen por el número de su OT, y su
-- costeo se archiva como «COSTOS - GT - OT N° - …» (docs/ANALISIS-ONEDRIVE.md,
-- sección 7). Hasta aquí el sistema pedía el código interno de la unidad para
-- todo trabajo del taller (migraciones 20261020166000 y 20261021120000), y el
-- buscador de código del RQ solo ofrecía códigos de unidades.
--
-- Desde aquí:
--
--   * el código de una OT de mantenimiento o de garantía es su número:
--     «OT 2921-2026» (`codigo_de_la_ot`). Con ese texto se piden sus
--     materiales, se compran, salen del almacén y se costean, como cualquier
--     código: lo demás del sistema ya trabaja por el texto del código;
--   * la lista de códigos de los formularios (`codigos_internos_para_elegir`:
--     el RQ, la caja, el reporte diario, las compras, la salida del almacén)
--     ofrece también esas OT, con su tipo, su placa y su vehículo;
--   * el vehículo que entra por mantenimiento o por garantía se registra
--     eligiendo su OT por el número (`vehiculos_ots_para_ingreso` y el
--     parámetro nuevo `p_orden` de `registrar_ingreso_vehiculo`). El cliente, la
--     placa y el vehículo salen de la OT y de su unidad, si la tiene; si no, se
--     anotan. La fabricación y el retorno del arenado siguen entrando por el
--     código interno de la unidad;
--   * como el mantenimiento no tiene código, tampoco tiene un avance que llegue
--     al 100 %: su vehículo sale como el de la garantía, cuando Administración
--     da por terminado el trabajo de la OT (`dar_por_terminada_la_garantia`,
--     que ahora acepta las dos) y con el visto de Tesorería. Lo dijo el hilo a
--     DKS el 2026-11-20 al resumirle cómo se aplicaba;
--   * la OT de garantía ya no exige que su unidad tenga código interno: la
--     exigía solo para que el vehículo pudiera entrar por el código;
--   * un código escrito con la forma de una OT («OT 9999-2026») tiene que ser
--     el de una OT de mantenimiento o de garantía que existe: si no, el costo
--     iba a un código suelto que se lee como si fuera la OT.
--
-- La versión de diez parámetros de `registrar_ingreso_vehiculo` queda como
-- envoltorio de la nueva, sin OT: la pantalla de antes del despliegue sigue
-- registrando fabricación, arenado, cochera y «otro»; el mantenimiento y la
-- garantía le piden recargar. Sin valor por omisión en `p_orden`, para que la
-- llamada vieja no sea ambigua (skill esquema › Trampas).
--
-- En producción, al 2026-11-20, no había ninguna OT de mantenimiento ni de
-- garantía ni ningún vehículo registrado: no hay filas de antes que acomodar.
-- =============================================================================

-- Antes de reemplazarlas se mira que cada función sea la que el repositorio
-- conoce (su texto antes o después de este cambio, sin los `\r` de un pegado
-- desde Windows). Si alguna se cambió a mano en la base, la migración se
-- detiene en vez de pisar ese cambio sin que nadie lo vea. La lista de códigos
-- vale también como la deja «RQ por unidad» (20261120300000, que le suma
-- `requerimientos.area`): se aplicaron en paralelo, y esta ya la incluye.
do $$
declare
  conocidas constant jsonb := '{
    "codigos_internos_para_elegir()": ["ecd61d39ccf3f33ca0f7655cc821fd40", "18ad558f14cc210e38b0ca165edf189f", "2579a4b914aabe315397f954c00c7ac1"],
    "dar_por_terminada_la_garantia(uuid,text)": ["c3ec30bfc7a28c7ec477f39e468fa6fc", "d7cfe455f4cc33df4170d1e31f90a22f"],
    "fn_ot_garantia_con_su_unidad()": ["ea1c79c804600764ac1663ea511691c2", "dff562441149daef324ab2a5ffcb8735"],
    "registrar_ingreso_vehiculo(uuid,text,text,text,text,text,text,timestamp with time zone,text,jsonb)": ["d104813a177931d5c5212f2e8efff2be", "a64a7a922a74f5838b3060e4ff01a857"],
    "rrhh_codigos_internos()": ["79f36ca09fa18fc77b81464adb07e3b2", "7649ddc609fc8e444cbd2faef7cc3cbc"],
    "vehiculo_lo_que_falta_para_salir(uuid,boolean)": ["df7c8cb7e291177910174f2660611bff", "c4cc620bdcd635248d22fcae493b48f7"],
    "vehiculos_codigos_para_ingreso()": ["4bf333007107ea838d7dcd8ab85e3335", "947e2abec3f73a93ada1b83a895a9e85"],
    "vehiculos_estado_de_salida(uuid[])": ["0f57ffcff788a8cb6140ef2dafebcad1", "df877340c1a7bd33820e6f1368425a30"]
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

-- ------------------------------------------- 1. el código de una OT es su N.º
-- «OT » y el número tal como lo guarda la OT («2921-2026»). Inmutable: va en
-- listas y comparaciones, no en índices.
create or replace function public.codigo_de_la_ot(p_numero text)
returns text language sql immutable set search_path to 'public' as $$
  select case when nullif(btrim(coalesce(p_numero, '')), '') is null then null
              else 'OT ' || upper(btrim(p_numero)) end;
$$;
comment on function public.codigo_de_la_ot(text) is
  'El código con que se costea una OT de mantenimiento o de garantía, que no tienen código interno: «OT » y su número («OT 2921-2026»). Migración 20261120500000.';
revoke all on function public.codigo_de_la_ot(text) from public, anon;
grant execute on function public.codigo_de_la_ot(text) to authenticated;

-- Si lo escrito tiene la forma del número de una OT: «OT 2921-2026», y también
-- a medias o mal escrito («ot2921», «OT-2921-2026»). Ningún código de unidad
-- empieza así (en producción no había ninguno el 2026-11-20).
create or replace function public.es_codigo_de_ot(p_codigo text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(upper(btrim(coalesce(p_codigo, ''))) ~ '^OT[^A-Z0-9]*[0-9]', false);
$$;
comment on function public.es_codigo_de_ot(text) is
  'Si lo escrito tiene la forma del número de una OT («OT 2921-2026», también a medias o con otros separadores): no es el código de una unidad. Migración 20261120500000.';
revoke all on function public.es_codigo_de_ot(text) from public, anon;
grant execute on function public.es_codigo_de_ot(text) to authenticated;

-- Escrito a mano, «OT 9999-2026» (un número mal puesto, o una OT que todavía
-- no se carga) quedaba como un código suelto que se lee como si fuera la OT:
-- el costo iba a parar ahí y no a la OT. Un código con forma de OT tiene que
-- ser el de una OT de mantenimiento o de garantía que exista, y ninguna unidad
-- se llama así (el costeo juntaría lo de las dos). La OT anulada sigue valiendo
-- aquí, para devolver o corregir lo que ya se cargó a ella; los formularios ya
-- no la ofrecen. Solo se juzga el código nuevo o el que cambió: lo de antes
-- se puede anular o corregir.
create or replace function public.fn_el_codigo_de_ot_es_de_su_ot()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := public.normalizar_codigo_interno(to_jsonb(new) ->> 'codigo_interno');
begin
  if v_codigo is null or not public.es_codigo_de_ot(v_codigo) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and v_codigo is not distinct from public.normalizar_codigo_interno(to_jsonb(old) ->> 'codigo_interno') then
    return new;
  end if;
  if tg_table_name = 'unidades' then
    raise exception '% no es el código de una unidad: tiene la forma del número de una OT. Escribe el código interno de la unidad.',
      v_codigo using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.ordenes_trabajo o
                  where o.tipo_trabajo in ('MANTENIMIENTO', 'GARANTIA')
                    and public.codigo_de_la_ot(o.numero) = v_codigo) then
    raise exception 'No hay OT de mantenimiento ni de garantía con el número %: elígela de la lista («OT 2921-2026») o pídele a Administración que la registre.',
      v_codigo using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.fn_el_codigo_de_ot_es_de_su_ot() is
  'Un código con forma de OT («OT 2921-2026») es el de una OT de mantenimiento o de garantía que existe, y ninguna unidad se llama así. Migración 20261120500000.';
revoke all on function public.fn_el_codigo_de_ot_es_de_su_ot() from public, anon, authenticated;

-- Las tablas donde la gente escribe o elige el código: las mismas que suma la
-- lista de los formularios, más la unidad y las observaciones del personal.
do $$
declare
  t text;
begin
  foreach t in array array['requerimientos', 'ordenes_compra_materiales', 'ordenes_servicio', 'reportes_diarios',
                           'tareos', 'subcontratos', 'movimientos_materiales', 'movimientos_caja',
                           'observaciones_personal', 'unidades'] loop
    execute format('create or replace trigger trg_%s_codigo_de_ot before insert or update of codigo_interno on public.%I
                      for each row execute function public.fn_el_codigo_de_ot_es_de_su_ot()', t, t);
  end loop;
end $$;

-- ---------------------------- 2. el trabajo de la OT, dado por terminado
comment on table public.ot_garantia_terminada is
  'Cuándo y quién dio por terminado el trabajo de una OT de garantía o de mantenimiento (migraciones 20261021120000 y 20261120500000). Lo anota Administración con dar_por_terminada_la_garantia; deja salir al vehículo con el visto de Tesorería. No se edita ni se borra.';
comment on function public.orden_garantia_terminada(uuid) is
  'Si el trabajo de la OT ya está terminado: anotado por Administración (garantía o mantenimiento) o la OT en Terminada, Entregada o Facturada.';

create or replace function public.dar_por_terminada_la_garantia(p_orden uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_nota  text := nullif(regexp_replace(btrim(coalesce(p_nota, '')), '\s+', ' ', 'g'), '');
  v_registro public.registro_vehiculos%rowtype;
  v_titulo text;
begin
  perform public.exigir_permiso('ordenes.editar');
  select * into v_orden from public.ordenes_trabajo where id = p_orden for update;
  if not found then
    raise exception 'No se encontró la orden de trabajo.' using errcode = 'check_violation';
  end if;
  if v_orden.tipo_trabajo not in ('GARANTIA', 'MANTENIMIENTO') then
    raise exception 'La OT % no es de garantía ni de mantenimiento: solo esas se dan por terminadas así.', v_orden.numero
      using errcode = 'check_violation';
  end if;
  if public.orden_garantia_terminada(p_orden) then
    return p_orden;
  end if;
  if v_orden.estado = 'ANULADA' then
    raise exception 'La OT % está anulada.', v_orden.numero using errcode = 'check_violation';
  end if;
  if v_orden.estado = 'BORRADOR' then
    raise exception 'La OT de % % espera la aprobación de Gerencia: se da por terminada después.',
      case v_orden.tipo_trabajo when 'GARANTIA' then 'garantía' else 'mantenimiento' end, v_orden.numero
      using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;

  insert into public.ot_garantia_terminada (orden_id, terminada_por, nota)
  values (p_orden, public.usuario_actual(), v_nota);

  -- Si su vehículo está en la planta, Requerimientos ya puede pedirle la
  -- revisión a Tesorería.
  select * into v_registro from public.registro_vehiculos
   where orden_id = p_orden and salida_en is null and anulado_en is null
   order by ingreso_en desc limit 1;
  if found then
    v_titulo := case v_orden.tipo_trabajo
                  when 'GARANTIA' then 'La garantía de la OT ' || v_orden.numero || ' está terminada'
                  else 'El mantenimiento de la OT ' || v_orden.numero || ' está terminado' end;
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id, v_titulo,
           'Pídele a Tesorería la revisión de la salida del vehículo '
             || coalesce(v_registro.placa, v_registro.chasis, v_registro.codigo_interno, v_registro.unidad) || '.',
           '/vehiculos/' || v_registro.id, 'registro_vehiculos', v_registro.id
      from public.usuarios u
      join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'vehiculos.registrar'
     where u.activo and u.id is distinct from public.usuario_actual();
  end if;
  return p_orden;
end;
$$;
comment on function public.dar_por_terminada_la_garantia(uuid, text) is
  'Administración (ordenes.editar) da por terminado el trabajo de una OT de garantía o de mantenimiento aprobada, cuando el taller avisa. Con eso y el visto de Tesorería sale su vehículo. Repetirla no hace otra; no se deshace.';

-- La OT de garantía va con la unidad que vuelve. Ya no hace falta que esa
-- unidad tenga código interno: el vehículo entra por el número de la OT.
create or replace function public.fn_ot_garantia_con_su_unidad()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.tipo_trabajo = 'GARANTIA' and new.estado <> 'ANULADA' and new.unidad_id is null then
    raise exception 'La OT de garantía va con la unidad que vuelve: elige su unidad.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ------------------------------------------- 3. lo que le falta para salir
-- Igual que en 20261021120000; el ingreso atado a una OT de mantenimiento
-- espera, como el de garantía, que Administración dé por terminado su trabajo.
create or replace function public.vehiculo_lo_que_falta_para_salir(p_registro uuid, p_con_tesoreria boolean)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_reg     public.registro_vehiculos%rowtype;
  v_orden   public.ordenes_trabajo%rowtype;
  v_avance  integer;
  v_ultima  text;
begin
  select * into v_reg from public.registro_vehiculos where id = p_registro;
  if not found or not public.vehiculo_motivo_exige_codigo(v_reg.motivo) or v_reg.codigo_interno is null then
    return null;
  end if;
  select * into v_orden from public.ordenes_trabajo where id = v_reg.orden_id;
  if v_orden.tipo_trabajo in ('GARANTIA', 'MANTENIMIENTO') then
    -- Anulada con el vehículo adentro (Gerencia la rechazó): ya no hay
    -- trabajo que terminar, y esperarlo lo dejaría en la planta para siempre.
    -- Sale como los demás, con el visto de Tesorería, que ve si hay algo que
    -- cobrar.
    if v_orden.estado = 'ANULADA' then
      null;
    elsif v_orden.estado = 'BORRADOR' then
      return case v_orden.tipo_trabajo
        when 'GARANTIA' then format('La OT de garantía %s espera la aprobación de Gerencia; después, Administración la da por terminada cuando el taller avise.', v_orden.numero)
        else format('La OT de mantenimiento %s espera la aprobación de Gerencia; después, Administración da por terminado el mantenimiento cuando el taller avise.', v_orden.numero) end;
    elsif not public.orden_garantia_terminada(v_orden.id) then
      return case v_orden.tipo_trabajo
        when 'GARANTIA' then format('Administración todavía no da por terminada la garantía de la OT %s: la salida se habilita cuando la marque.', v_orden.numero)
        else format('Administración todavía no da por terminado el mantenimiento de la OT %s: la salida se habilita cuando lo marque.', v_orden.numero) end;
    end if;
  else
    v_avance := public.vehiculo_avance_del_codigo(v_reg.codigo_interno);
    if v_avance < 100 then
      return format('El código %s va en %s %%: la salida se habilita con el 100 %% del avance.', v_reg.codigo_interno, v_avance);
    end if;
  end if;
  if p_con_tesoreria then
    select r.estado into v_ultima from public.registro_vehiculo_revisiones r
     where r.registro_id = p_registro order by r.creado_en desc limit 1;
    if v_ultima is null then
      return 'Falta la aprobación de Tesorería: pídele la revisión de la salida.';
    elsif v_ultima = 'PENDIENTE' then
      return 'Falta la aprobación de Tesorería: tu pedido de revisión está esperando su respuesta.';
    elsif v_ultima = 'OBSERVADA' then
      return 'Tesorería observó la salida: atiende su observación y vuelve a pedirle la revisión.';
    end if;
  end if;
  return null;
end;
$$;

-- Lo que la pantalla necesita saber: igual que en 20261021120000, con la OT de
-- mantenimiento en las mismas columnas que la de garantía (`garantia_ot` y
-- `garantia_estado` dicen la OT y si su trabajo está terminado; el motivo del
-- ingreso dice cuál de las dos es). Mismas columnas: no se vuelve a crear.
create or replace function public.vehiculos_estado_de_salida(p_registros uuid[])
returns table (registro_id uuid, exige boolean, avance integer, tesoreria text, falta_para_pedir text, falta_para_salir text,
               garantia_ot text, garantia_estado text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('vehiculos.ver') or public.tiene_permiso('vehiculos.registrar')) then
    raise exception 'No tiene permiso para consultar los vehículos.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_registros, 1), 0) > 500 then
    raise exception 'Se consultan hasta 500 ingresos a la vez.' using errcode = 'check_violation';
  end if;
  return query
  select v.id,
         public.vehiculo_motivo_exige_codigo(v.motivo) and v.codigo_interno is not null,
         case when public.vehiculo_motivo_exige_codigo(v.motivo) and v.codigo_interno is not null
                   and (o.tipo_trabajo is null or o.tipo_trabajo not in ('GARANTIA', 'MANTENIMIENTO'))
              then public.vehiculo_avance_del_codigo(v.codigo_interno) end,
         (select r.estado from public.registro_vehiculo_revisiones r where r.registro_id = v.id order by r.creado_en desc limit 1),
         public.vehiculo_lo_que_falta_para_salir(v.id, false),
         public.vehiculo_lo_que_falta_para_salir(v.id, true),
         case when o.tipo_trabajo in ('GARANTIA', 'MANTENIMIENTO') then o.numero::text end,
         case when o.tipo_trabajo in ('GARANTIA', 'MANTENIMIENTO') then
           case when o.estado = 'ANULADA' then 'ANULADA'
                when public.orden_garantia_terminada(o.id) then 'TERMINADA' else o.estado::text end end
    from public.registro_vehiculos v
    left join public.ordenes_trabajo o on o.id = v.orden_id
   where v.id = any (p_registros) and v.salida_en is null and v.anulado_en is null;
end;
$$;
comment on function public.vehiculos_estado_de_salida(uuid[]) is
  'Para cada ingreso en la planta: si es trabajo del taller, el avance de su código (o, si entró con una OT de garantía o de mantenimiento, el número de esa OT y si su trabajo está terminado), la última respuesta de Tesorería y lo que le falta para pedir la revisión y para salir (null si nada). Exige vehiculos.ver o vehiculos.registrar.';

-- ------------------------------------ 4. lo que ofrece la ventana del ingreso
-- Los códigos para fabricación y arenado: su OT vigente es la de la unidad que
-- no es de mantenimiento ni de garantía, que entran por su número; la unidad
-- con una de esas abierta no está, porque entra por ella. Mismas columnas que
-- en 20261021120000: la pantalla de antes del despliegue lee `garantia_numero`,
-- que ahora sale siempre vacía.
create or replace function public.vehiculos_codigos_para_ingreso()
returns table (codigo_interno text, unidad_id uuid, orden_id uuid, orden_numero text, cliente text,
               unidad text, placa text, chasis text, en_planta boolean, garantia_numero text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('vehiculos.registrar');
  return query
  select public.normalizar_codigo_interno(u.codigo_interno), u.id, o.id, o.numero::text,
         coalesce(cl.razon_social, 'Sin cliente')::text,
         public.vehiculo_descripcion_de_unidad(u.id),
         u.placa::text, nullif(btrim(coalesce(u.numero_chasis, '')), ''),
         exists (select 1 from public.registro_vehiculos v
                  where v.unidad_id = u.id and v.salida_en is null and v.anulado_en is null),
         null::text
    from public.unidades u
    join lateral (select x.id, x.numero from public.ordenes_trabajo x
                   where x.unidad_id = u.id and x.estado <> 'ANULADA'
                     and x.tipo_trabajo not in ('MANTENIMIENTO', 'GARANTIA')
                   order by x.creado_en desc limit 1) o on true
    left join public.clientes cl on cl.id = u.cliente_id
   where u.activo and public.normalizar_codigo_interno(u.codigo_interno) is not null
     -- La unidad con una OT de mantenimiento o de garantía abierta entra por esa OT.
     and not exists (select 1 from public.ordenes_trabajo g
                      where g.unidad_id = u.id and g.tipo_trabajo in ('MANTENIMIENTO', 'GARANTIA') and g.estado <> 'ANULADA'
                        and not public.orden_garantia_terminada(g.id))
   order by 1;
end;
$$;
comment on function public.vehiculos_codigos_para_ingreso() is
  'Los códigos internos con los que entra un vehículo por fabricación o retorno del arenado: su unidad tiene una OT vigente que no es de mantenimiento ni de garantía, y ninguna de esas abierta (entra por ella). Exige vehiculos.registrar.';

-- Las OT con las que entra un vehículo por mantenimiento o por garantía: las
-- de ese tipo que no están anuladas ni con su trabajo terminado. Si la OT
-- tiene unidad, de ella salen la placa y el vehículo.
create or replace function public.vehiculos_ots_para_ingreso()
returns table (orden_id uuid, orden_numero text, tipo text, estado text, cliente text,
               unidad_id uuid, unidad text, placa text, chasis text, en_planta boolean)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('vehiculos.registrar');
  return query
  select o.id, o.numero::text, o.tipo_trabajo::text, o.estado::text,
         coalesce(cl.razon_social, 'Sin cliente')::text,
         u.id, case when u.id is not null then public.vehiculo_descripcion_de_unidad(u.id) end,
         nullif(btrim(coalesce(u.placa, '')), ''), nullif(btrim(coalesce(u.numero_chasis, '')), ''),
         exists (select 1 from public.registro_vehiculos v
                  where v.salida_en is null and v.anulado_en is null
                    and (v.orden_id = o.id or (u.id is not null and v.unidad_id = u.id)))
    from public.ordenes_trabajo o
    left join public.unidades u on u.id = o.unidad_id
    left join public.clientes cl on cl.id = coalesce(u.cliente_id, o.cliente_id)
   where o.tipo_trabajo in ('MANTENIMIENTO', 'GARANTIA') and o.estado <> 'ANULADA'
     and not public.orden_garantia_terminada(o.id)
   order by o.creado_en desc;
end;
$$;
comment on function public.vehiculos_ots_para_ingreso() is
  'Las OT de mantenimiento y de garantía con las que puede entrar un vehículo (ni anuladas ni con su trabajo terminado), con su cliente, su unidad si la tiene y si ya está en la planta. Exige vehiculos.registrar. Migración 20261120500000.';
revoke all on function public.vehiculos_ots_para_ingreso() from public, anon;
grant execute on function public.vehiculos_ots_para_ingreso() to authenticated;

-- ------------------------------------------------------- 5. el ingreso
-- Igual que en 20261021120000 con la huella de 20261022194000, más la OT: el
-- mantenimiento y la garantía entran eligiendo su OT (`p_orden`), y su código
-- es el de la OT. La fabricación y el arenado siguen por el código interno, con
-- la OT de la unidad que no es de mantenimiento ni de garantía.
create or replace function public.registrar_ingreso_vehiculo(
  p_id uuid, p_placa text, p_chasis text, p_codigo_interno text, p_unidad text, p_empresa text,
  p_motivo text, p_ingreso_en timestamptz, p_observacion text, p_fotos jsonb, p_orden uuid
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_placa   text := public.normalizar_placa(p_placa);
  v_chasis  text := nullif(upper(btrim(coalesce(p_chasis, ''))), '');
  v_codigo  text := nullif(btrim(coalesce(p_codigo_interno, '')), '');
  v_unidad_texto  text := btrim(coalesce(p_unidad, ''));
  v_empresa text := btrim(coalesce(p_empresa, ''));
  v_cuando  timestamptz := coalesce(p_ingreso_en, now());
  v_actual  public.registro_vehiculos%rowtype;
  v_clave   text;
  v_unidad  public.unidades%rowtype;
  v_ot      public.ordenes_trabajo%rowtype;
  v_orden   uuid;
  v_trabajo text := case p_motivo when 'MANTENIMIENTO' then 'mantenimiento' when 'GARANTIA' then 'garantía' end;
  -- Sin OT, la huella es la de 20261022194000: un reintento de la pantalla de
  -- antes se sigue reconociendo.
  v_envio   jsonb := jsonb_build_array(p_placa, p_chasis, p_codigo_interno, p_unidad, p_empresa, p_motivo, p_ingreso_en, p_observacion, p_fotos)
                     || case when p_orden is null then '[]'::jsonb else jsonb_build_array(p_orden) end;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del ingreso.' using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('FABRICACION', 'MANTENIMIENTO', 'GARANTIA', 'ARENADO', 'COCHERA', 'OTRO') then
    raise exception 'Elige el motivo del ingreso.' using errcode = 'check_violation';
  end if;

  -- Un reintento con el mismo p_id devuelve el ingreso que ya entró.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.registro_vehiculos where id = p_id;
  if found then
    if v_actual.ingreso_por = public.usuario_actual() then
      if public.mismo_envio(p_id, 'INGRESO', v_envio) then return p_id; end if;
      raise exception 'Este ingreso ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.' using errcode = 'check_violation';
    end if;
    raise exception 'Este ingreso ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;

  if p_orden is not null and v_trabajo is null then
    raise exception 'La OT se elige solo para mantenimiento o garantía: los demás motivos entran por el código interno o la placa.'
      using errcode = 'check_violation';
  end if;

  if v_trabajo is not null then
    -- Mantenimiento y garantía: por el número de su OT.
    if p_orden is null then
      raise exception 'Elige la OT de %: el vehículo entra por el número de su OT. Si la ventana no la ofrece, recarga la pantalla.', v_trabajo
        using errcode = 'check_violation';
    end if;
    select * into v_ot from public.ordenes_trabajo where id = p_orden;
    if not found then
      raise exception 'No se encontró esa OT: recarga la pantalla.' using errcode = 'check_violation';
    end if;
    if v_ot.tipo_trabajo::text <> p_motivo then
      raise exception 'La OT % no es de %: elige una OT de %.', v_ot.numero, v_trabajo, v_trabajo
        using errcode = 'check_violation';
    end if;
    if v_ot.estado = 'ANULADA' then
      raise exception 'La OT % está anulada: con ella no entra ningún vehículo.', v_ot.numero using errcode = 'check_violation';
    end if;
    if public.orden_garantia_terminada(v_ot.id) then
      raise exception 'El trabajo de la OT % ya está terminado: con ella no vuelve a entrar el vehículo.', v_ot.numero
        using errcode = 'check_violation';
    end if;
    -- Dos pestañas con la misma OT (sin unidad, cada una con su placa) entraban
    -- las dos: el candado de arriba es por el envío, no por la OT.
    perform pg_advisory_xact_lock(hashtextextended('ingreso-de-la-ot:' || v_ot.id::text, 0));
    if exists (select 1 from public.registro_vehiculos
                where orden_id = v_ot.id and salida_en is null and anulado_en is null) then
      raise exception 'El vehículo de la OT % ya está en la planta: marca primero su salida.', v_ot.numero
        using errcode = 'unique_violation';
    end if;
    v_orden := v_ot.id;
    v_codigo := public.codigo_de_la_ot(v_ot.numero);
    if v_ot.unidad_id is not null then
      select * into v_unidad from public.unidades where id = v_ot.unidad_id;
      if exists (select 1 from public.registro_vehiculos
                  where unidad_id = v_unidad.id and salida_en is null and anulado_en is null) then
        raise exception 'El vehículo de la OT % ya está en la planta: marca primero su salida.', v_ot.numero
          using errcode = 'unique_violation';
      end if;
      v_placa := coalesce(v_placa, public.normalizar_placa(v_unidad.placa));
      v_chasis := coalesce(v_chasis, nullif(upper(btrim(coalesce(v_unidad.numero_chasis, ''))), ''));
      v_unidad_texto := coalesce(nullif(btrim(coalesce(public.vehiculo_descripcion_de_unidad(v_unidad.id), '')), ''), v_unidad_texto);
    elsif coalesce(v_placa, v_chasis) is null then
      raise exception 'Anota la placa o el número de chasis: la OT % no tiene su unidad registrada.', v_ot.numero
        using errcode = 'check_violation';
    end if;
    -- El cliente de la unidad; si la unidad no lo tiene, el de la OT.
    select cl.razon_social into v_empresa
      from public.clientes cl where cl.id = coalesce(v_unidad.cliente_id, v_ot.cliente_id);
    v_empresa := coalesce(nullif(btrim(coalesce(v_empresa, '')), ''), btrim(coalesce(p_empresa, '')));
  elsif public.vehiculo_motivo_exige_codigo(p_motivo) then
    -- Fabricación y retorno del arenado: por el código interno de la unidad.
    if v_codigo is null then
      raise exception 'Elige el código interno del vehículo: para % entra solo un vehículo con código interno y OT.',
        case p_motivo when 'FABRICACION' then 'fabricación' else 'el retorno del arenado' end
        using errcode = 'check_violation';
    end if;
    v_clave := upper(regexp_replace(v_codigo, '[^A-Za-z0-9]', '', 'g'));
    select u.* into v_unidad from public.unidades u
     where upper(regexp_replace(btrim(coalesce(u.codigo_interno, '')), '[^A-Za-z0-9]', '', 'g')) = v_clave
       and u.activo
     limit 1;
    if not found then
      raise exception 'El código interno % no es de ninguna unidad: el código nace cuando se aprueba la cotización y Administración carga su OT.',
        v_codigo using errcode = 'check_violation';
    end if;
    -- La unidad con una OT de mantenimiento o de garantía abierta entra por esa
    -- OT, también al volver del arenado: por el código quedaba atada a su OT de
    -- fabricación y salía sin que Administración diera por terminado el trabajo
    -- (lo vio el auditor de funcionamiento). Como en 20261021120000 con la
    -- garantía: mientras esté abierta, manda ella.
    select o.* into v_ot from public.ordenes_trabajo o
     where o.unidad_id = v_unidad.id and o.tipo_trabajo in ('MANTENIMIENTO', 'GARANTIA') and o.estado <> 'ANULADA'
       and not public.orden_garantia_terminada(o.id)
     order by o.creado_en desc limit 1;
    if found then
      raise exception 'El vehículo del código % tiene abierta la OT % de %: entra con el motivo % y esa OT, también al volver del arenado.',
        v_codigo, v_ot.numero,
        case v_ot.tipo_trabajo when 'MANTENIMIENTO' then 'mantenimiento' else 'garantía' end,
        case v_ot.tipo_trabajo when 'MANTENIMIENTO' then 'Mantenimiento' else 'Garantía' end
        using errcode = 'check_violation';
    end if;
    select o.id into v_orden from public.ordenes_trabajo o
     where o.unidad_id = v_unidad.id and o.estado <> 'ANULADA'
       and o.tipo_trabajo not in ('MANTENIMIENTO', 'GARANTIA')
     order by o.creado_en desc limit 1;
    if v_orden is null then
      raise exception 'El código interno % no tiene una OT vigente: sin OT el vehículo no entra a trabajo. Si viene por mantenimiento o garantía, elige ese motivo y su OT.', v_codigo
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.registro_vehiculos
                where unidad_id = v_unidad.id and salida_en is null and anulado_en is null) then
      raise exception 'El vehículo del código % ya está en la planta: marca primero su salida.', v_codigo
        using errcode = 'unique_violation';
    end if;
    v_codigo := public.normalizar_codigo_interno(v_unidad.codigo_interno);
    v_placa := coalesce(v_placa, public.normalizar_placa(v_unidad.placa));
    v_chasis := coalesce(v_chasis, nullif(upper(btrim(coalesce(v_unidad.numero_chasis, ''))), ''));
    v_unidad_texto := public.vehiculo_descripcion_de_unidad(v_unidad.id);
    -- El cliente de la unidad; si la unidad no lo tiene, el de su OT.
    select cl.razon_social into v_empresa
      from public.ordenes_trabajo o join public.clientes cl on cl.id = coalesce(v_unidad.cliente_id, o.cliente_id)
     where o.id = v_orden;
    v_empresa := coalesce(nullif(btrim(coalesce(v_empresa, '')), ''), btrim(coalesce(p_empresa, '')));
  elsif coalesce(v_placa, v_chasis, v_codigo) is null then
    raise exception 'Anota la placa, el número de chasis o el código interno: sin eso no se sabe qué vehículo entró.'
      using errcode = 'check_violation';
  elsif v_codigo is not null and exists (
          select 1 from public.ordenes_trabajo o
           where o.tipo_trabajo in ('MANTENIMIENTO', 'GARANTIA') and o.estado <> 'ANULADA'
             and not public.orden_garantia_terminada(o.id)
             and public.codigo_de_la_ot(o.numero) = public.normalizar_codigo_interno(v_codigo)) then
    -- La OT de mantenimiento o de garantía escrita como código en la cochera.
    raise exception 'La % es de un trabajo en el taller: elige el motivo (mantenimiento o garantía) y su OT.',
      public.normalizar_codigo_interno(v_codigo) using errcode = 'check_violation';
  elsif v_codigo is not null and exists (
          select 1 from public.unidades u join public.ordenes_trabajo o on o.unidad_id = u.id
           where o.estado not in ('ANULADA', 'TERMINADA', 'ENTREGADA', 'FACTURADA')
             and not (o.tipo_trabajo in ('GARANTIA', 'MANTENIMIENTO') and public.orden_garantia_terminada(o.id))
             and upper(regexp_replace(btrim(coalesce(u.codigo_interno, '')), '[^A-Za-z0-9]', '', 'g'))
               = upper(regexp_replace(v_codigo, '[^A-Za-z0-9]', '', 'g'))) then
    -- Un código con OT en el taller que entra como cochera u «otro» se saltaría
    -- la regla: no figuraría en la planta y saldría sin el 100 % ni Tesorería.
    -- El vehículo ya entregado sí vuelve a la cochera, por código o por placa.
    raise exception 'El código interno % es de un vehículo con OT en el taller: elige el motivo del trabajo (fabricación, mantenimiento, garantía o arenado).',
      v_codigo using errcode = 'check_violation';
  elsif exists (
          select 1 from public.unidades u join public.ordenes_trabajo o on o.unidad_id = u.id
           where o.estado not in ('ANULADA', 'TERMINADA', 'ENTREGADA', 'FACTURADA')
             and not (o.tipo_trabajo in ('GARANTIA', 'MANTENIMIENTO') and public.orden_garantia_terminada(o.id))
             and ((v_placa is not null and public.normalizar_placa(u.placa) = v_placa)
               or (v_chasis is not null and upper(btrim(coalesce(u.numero_chasis, ''))) = v_chasis))) then
    -- Lo mismo por la placa o el chasis.
    raise exception 'Ese vehículo tiene una OT en el taller: elige el motivo del trabajo y su código interno o su OT.'
      using errcode = 'check_violation';
  end if;

  if v_placa is not null and char_length(v_placa) not between 3 and 15 then
    raise exception 'La placa % no parece válida.', v_placa using errcode = 'check_violation';
  end if;
  if v_chasis is not null and char_length(v_chasis) not between 3 and 40 then
    raise exception 'El número de chasis va de 3 a 40 caracteres.' using errcode = 'check_violation';
  end if;
  if v_codigo is not null and char_length(v_codigo) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(v_unidad_texto) not between 2 and 120 then
    raise exception 'Describe el vehículo: tipo, marca o carrocería.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_empresa, '')) not between 2 and 160 then
    raise exception 'Anota la empresa o el dueño del vehículo.' using errcode = 'check_violation';
  end if;
  if v_cuando > now() + interval '5 minutes' then
    raise exception 'La hora de ingreso no puede ser futura.' using errcode = 'check_violation';
  end if;
  if v_cuando < now() - interval '30 days' then
    raise exception 'Solo se registran ingresos de los últimos 30 días.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_observacion, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  -- Por cochera u «otro» con el código de una unidad: se anota la unidad. Sin
  -- eso el mismo vehículo podía estar dos veces en la planta —en cochera y en
  -- trabajo— y salir por el registro de cochera, sin el avance ni Tesorería.
  if v_unidad.id is null and v_orden is null and v_codigo is not null then
    select u.* into v_unidad from public.unidades u
     where upper(regexp_replace(btrim(coalesce(u.codigo_interno, '')), '[^A-Za-z0-9]', '', 'g'))
           = upper(regexp_replace(v_codigo, '[^A-Za-z0-9]', '', 'g'))
       and u.activo
     limit 1;
    if v_unidad.id is not null and exists (select 1 from public.registro_vehiculos
                                            where unidad_id = v_unidad.id and salida_en is null and anulado_en is null) then
      raise exception 'El vehículo del código % ya está en la planta: marca primero su salida.', v_codigo
        using errcode = 'unique_violation';
    end if;
  end if;
  if v_placa is not null and exists (select 1 from public.registro_vehiculos
                                       where placa = v_placa and salida_en is null and anulado_en is null) then
    raise exception 'El vehículo de placa % ya está en la planta: marca primero su salida.', v_placa
      using errcode = 'unique_violation';
  end if;
  if v_chasis is not null and exists (select 1 from public.registro_vehiculos
                                        where chasis = v_chasis and salida_en is null and anulado_en is null) then
    raise exception 'El chasis % ya está en la planta: marca primero su salida.', v_chasis
      using errcode = 'unique_violation';
  end if;

  insert into public.registro_vehiculos
    (id, placa, chasis, codigo_interno, unidad, empresa, motivo, ingreso_en, observacion_ingreso, ingreso_por,
     unidad_id, orden_id)
  values
    (p_id, v_placa, v_chasis, v_codigo, v_unidad_texto, v_empresa, p_motivo, v_cuando,
     nullif(btrim(coalesce(p_observacion, '')), ''), public.usuario_actual(),
     v_unidad.id, v_orden);
  perform public.vehiculo_anotar_fotos(p_id, 'INGRESO', p_fotos);
  perform public.anotar_envio(p_id, 'INGRESO', v_envio);
  return p_id;
end;
$$;
comment on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text, jsonb, uuid) is
  'Registra el ingreso de un vehículo con sus fotos. Fabricación y retorno del arenado entran por el código interno de una unidad con OT; mantenimiento y garantía, por su OT (p_orden), y su código es el de la OT; cochera y «otro», por la placa, el chasis o un código escrito. Exige vehiculos.registrar. Migración 20261120500000.';
revoke all on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text, jsonb, uuid) from public, anon;
grant execute on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text, jsonb, uuid) to authenticated;

-- La de diez parámetros, la que llama la pantalla de antes del despliegue,
-- pasa a la nueva sin OT. `create or replace` conserva sus permisos.
create or replace function public.registrar_ingreso_vehiculo(
  p_id uuid, p_placa text, p_chasis text, p_codigo_interno text, p_unidad text, p_empresa text,
  p_motivo text, p_ingreso_en timestamptz, p_observacion text, p_fotos jsonb
) returns uuid language sql set search_path to 'public' as $$
  select public.registrar_ingreso_vehiculo(p_id, p_placa, p_chasis, p_codigo_interno, p_unidad, p_empresa,
                                           p_motivo, p_ingreso_en, p_observacion, p_fotos, null::uuid);
$$;

-- ------------------------------------- 6. el código de la OT en los formularios
-- Igual que en 20261022150000, más las OT de mantenimiento y de garantía que no
-- están anuladas, con su número por código, y su tipo, placa y vehículo (o su
-- cliente, si no tiene unidad) por detalle. Cuentan como «registradas»: entre
-- dos casi iguales, la de la OT es la buena.
create or replace function public.codigos_internos_para_elegir()
returns table (codigo text, unidad text, cerrado boolean, registrada boolean)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('requerimientos.emitir')
          or public.tiene_permiso('requerimientos.administracion') or public.tiene_permiso('requerimientos.area') or public.tiene_permiso('tesoreria.caja')
          or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('reporte_diario.registrar')
          or public.tiene_permiso('compras.crear') or public.tiene_permiso('subcontratos.gestionar')
          or public.tiene_permiso('almacen.despachar')) then
    raise exception 'No tienes permiso para ver la lista de códigos internos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with ot as (
    -- Las OT de mantenimiento y de garantía: su número es su código.
    select distinct on (public.codigo_de_la_ot(o.numero))
           public.codigo_de_la_ot(o.numero) as codigo,
           nullif(concat_ws(' · ', case o.tipo_trabajo when 'MANTENIMIENTO' then 'Mantenimiento' else 'Garantía' end,
                            nullif(btrim(u.placa), ''), nullif(btrim(concat_ws(' ', u.marca, u.modelo)), ''),
                            case when u.id is null then nullif(btrim(cl.razon_social), '') end), '') as texto
      from public.ordenes_trabajo o
      left join public.unidades u on u.id = o.unidad_id
      left join public.clientes cl on cl.id = o.cliente_id
     where o.tipo_trabajo in ('MANTENIMIENTO', 'GARANTIA') and o.estado <> 'ANULADA'
     order by public.codigo_de_la_ot(o.numero), o.creado_en desc
  ), conocido as (
    -- Los mismos que conoce Diseño (`codigos_internos_de_diseno`), más las horas
    -- de RR. HH., los subcontratos, las salidas del almacén y la caja con su código.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo from public.unidades u where u.activo and u.codigo_interno is not null
    union select public.normalizar_codigo_interno(r.codigo_interno) from public.requerimientos r where r.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(c.codigo_interno) from public.ordenes_compra_materiales c
           where c.codigo_interno is not null and c.aprobacion not in ('RECHAZADA', 'ANULADA')
    union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
           where s.codigo_interno is not null and s.estado <> 'ANULADA'
    union select public.normalizar_codigo_interno(d.codigo_interno) from public.reportes_diarios d where d.anulado_en is null
    union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
           where v.codigo_interno is not null and v.anulado_en is null
    union select public.normalizar_codigo_interno(t.codigo_interno) from public.tareos t where t.anulado_en is null
    union select public.normalizar_codigo_interno(x.codigo_interno) from public.subcontratos x where x.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(m.codigo_interno) from public.movimientos_materiales m
           where m.codigo_interno is not null and m.tipo in ('SALIDA', 'DESPACHO')
    union select p.codigo_interno from public.codigo_planos p where p.anulado_en is null
    union select e.codigo_interno from public.codigo_etapas e where e.quitada_en is null
    union select public.normalizar_codigo_interno(k.codigo_interno) from public.movimientos_caja k where k.codigo_interno is not null and k.anulado_en is null
    union select ot.codigo from ot
  ), unidad as (
    -- Como en Diseño: la placa y la marca y modelo de la unidad.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo,
           string_agg(distinct nullif(concat_ws(' · ', nullif(btrim(u.placa), ''), nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')), ''), ', ') as texto,
           bool_or(u.activo) as activa
      from public.unidades u where u.codigo_interno is not null group by 1
  ), porteria as (
    -- La que no está en Unidades, por lo que anotó la portería la última vez que entró.
    select distinct on (public.normalizar_codigo_interno(v.codigo_interno))
           public.normalizar_codigo_interno(v.codigo_interno) as codigo,
           nullif(concat_ws(' · ', nullif(btrim(v.placa), ''), nullif(btrim(v.unidad), '')), '') as texto
      from public.registro_vehiculos v
     where v.codigo_interno is not null and v.anulado_en is null
     order by public.normalizar_codigo_interno(v.codigo_interno), v.ingreso_en desc
  )
  select c.codigo, coalesce(u.texto, ot.texto, p.texto),
         exists (select 1 from public.codigo_interno_cierres k where k.codigo = c.codigo and k.reabierto_en is null),
         coalesce(u.activa, false) or ot.codigo is not null
    from conocido c
    left join unidad u on u.codigo = c.codigo
    left join ot on ot.codigo = c.codigo
    left join porteria p on p.codigo = c.codigo
   where c.codigo is not null and char_length(c.codigo) between 2 and 60 and c.codigo <> 'TODOS LOS ACTIVOS'
   order by c.codigo;
end;
$$;
comment on function public.codigos_internos_para_elegir() is
  'Los códigos internos que se ofrecen en los formularios (requerimiento, caja diaria, costeo de horas, observaciones, reporte diario, orden de compra, servicio, subcontrato, salida del almacén sin RQ), con su unidad, si su costeo está cerrado (sin montos) y si es de una unidad del padrón o de una OT de mantenimiento o garantía («OT 2921-2026», migración 20261120500000).';

-- Los códigos del reporte diario y del costeo de horas de RR. HH.: los mismos
-- de 20261014180000, más las OT de mantenimiento y de garantía que no están
-- anuladas, para cargarles las horas de quien trabajó en ellas. La terminada
-- sale de la lista al mes de terminarse: la lista se corta en 500 por orden
-- alfabético, y las OT de siempre empujarían fuera a los códigos que van
-- después de «OT …». La que ya tiene horas sigue en ella por su reporte.
create or replace function public.rrhh_codigos_internos()
returns table (codigo text) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('reporte_diario.registrar')) then
    raise exception 'No tiene permiso para consultar los códigos internos.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c from (
      select upper(btrim(r.codigo_interno)) as c from public.requerimientos r
      union select upper(btrim(o.codigo_interno)) from public.ordenes_compra_materiales o where o.codigo_interno is not null
      union select upper(btrim(u.codigo_interno)) from public.unidades u where u.codigo_interno is not null
      union select upper(btrim(v.codigo_interno)) from public.registro_vehiculos v where v.codigo_interno is not null
      union select t.codigo_interno from public.tareos t where t.anulado_en is null
      union select d.codigo_interno from public.reportes_diarios d where d.anulado_en is null
      union select public.codigo_de_la_ot(o.numero) from public.ordenes_trabajo o
              left join public.ot_garantia_terminada g on g.orden_id = o.id
             where o.tipo_trabajo in ('MANTENIMIENTO', 'GARANTIA') and o.estado <> 'ANULADA'
               and coalesce(g.terminada_en,
                            case when o.estado in ('TERMINADA', 'ENTREGADA', 'FACTURADA') then o.actualizado_en end,
                            now()) > now() - interval '30 days'
    ) x
    where char_length(c) between 2 and 60
    order by c
    limit 500;
end;
$$;
