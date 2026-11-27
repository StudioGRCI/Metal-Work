-- =============================================================================
-- EL TRÁMITE NACE DE LA OT
-- -----------------------------------------------------------------------------
-- Plan «El puesto de Tramitador», entrega 4 de 4. El plan aprobado: «Al
-- terminar una OT se crea solo su trámite de tarjeta y placas con el límite de
-- 15 días, la OT muestra si se cumplió, los que se renuevan generan su
-- renovación y Gerencia ve por vencer, vencidos y concluidos».
--
--   · La OT. La regla de la empresa («Tarjeta de propiedad y placas: 15 días
--     hábiles desde el término», docs/ANALISIS-ONEDRIVE.md §5) ya da la fecha
--     límite en la OT. Ahora, al pasar la OT a «Terminada» (o más allá), la
--     base abre sola el trámite de cada tipo del catálogo que lo pida, con esa
--     fecha límite, «Por iniciar» y a nombre del sistema. Cuál tipo y con
--     cuántos días lo dice el catálogo, no esta migración: la tarjeta de
--     propiedad siempre y las placas solo si la unidad todavía no tiene placa,
--     las dos a 15 días hábiles. El Tramitador lo ajusta en «Tipos de trámite».
--     La OT lee sus trámites (`tramites_de_la_orden`) y dice si se cumplieron.
--   · La renovación. El concluido que se renueva (el SOAT, la ITSE) abre solo
--     su renovación cuando llega el primer día de aviso de su tipo, enlazada al
--     que renueva: un TR nuevo «Por iniciar» cuya fecha límite es el día en que
--     vence el documento. Desde ahí avisa la renovación, como cualquier
--     trámite que se lleva, y lo vencido llega también a Gerencia. El
--     Tramitador la puede abrir antes con «Renovar ahora». Si la renovación se
--     anula, el viejo ya no abre otra solo: «Renovar ahora» sigue a mano.
--   · Gerencia. La lista suma «Por vencer» (dentro de los días de aviso de su
--     tipo) para sus cifras de por vencer, vencidos y concluidos.
--
-- Quién: nadie nuevo. El trámite que abre la base va con `registrado_por`
-- vacío y su origen («OT» o «RENOVACION»); el que abre el Tramitador con
-- «Renovar ahora» va a su nombre.
-- =============================================================================

-- 0. Lo que se reemplaza es lo que el repositorio conoce ------------------------------------
-- Cuatro funciones de las entregas 1 a 3 se llevan enteras. Si en producción
-- alguna se arregló a mano, reemplazarla pisaría ese arreglo sin aviso: se
-- detiene. Valen la huella de antes y la de esta migración (volver a correrla).
do $$
declare
  v record;
begin
  for v in
    select f.firma, f.huellas, md5(replace(p.prosrc, E'\r', '')) as huella
      from (values
        ('public.tramites_visibles(uuid)', array['932ac816a97d83a7edfa0d8cda8cf2b9', '944948107db3f5f6141a41244c98c7d0']),
        ('public.revisar_tramites(date)', array['e248129f04dfe8ea5e2394058f79fd76', '9f3fc745b123870d1df332bce128dd56']),
        ('public.fn_tramite_avisa_al_registrarse()', array['277b45dab0880b300b9c8dd67816e1f3', '4ee724521b152ff79bf5c3c9748955e8'])
      ) as f(firma, huellas)
      left join pg_proc p on p.oid = to_regprocedure(f.firma)
  loop
    if v.huella is null then
      raise exception 'Falta %: esta base no tiene las entregas 1 a 3 del Tramitador.', v.firma;
    end if;
    if not (v.huella = any (v.huellas)) then
      raise exception '% no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v.firma, v.huella;
    end if;
  end loop;
  -- El catálogo: la de la entrega 1, o ya la nueva (volver a correrla).
  if to_regprocedure('public.tramites_guardar_tipo(uuid,text,text,text,boolean,jsonb,boolean,boolean)') is not null
     and (select md5(replace(p.prosrc, E'\r', '')) from pg_proc p
           where p.oid = to_regprocedure('public.tramites_guardar_tipo(uuid,text,text,text,boolean,jsonb,boolean,boolean)'))
         <> '3f9d0db5f81ad5232561259e878d70d0' then
    raise exception 'public.tramites_guardar_tipo no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.';
  end if;
end $$;

-- 1. El catálogo dice qué trámite abre la OT ---------------------------------------------------
-- Los dos tipos de la regla de la OT reciben sus días la primera vez, cuando
-- nace la columna: volver a correr la migración no pisa lo que el Tramitador
-- haya ajustado después.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tramite_tipos' and column_name = 'dias_desde_termino_ot') then
    alter table public.tramite_tipos
      add column dias_desde_termino_ot integer,
      add column solo_sin_placa boolean not null default false;
    update public.tramite_tipos set dias_desde_termino_ot = 15
     where lower(nombre) = lower('Tarjeta de propiedad') and ambito = 'UNIDAD';
    update public.tramite_tipos set dias_desde_termino_ot = 15, solo_sin_placa = true
     where lower(nombre) = lower('Placas') and ambito = 'UNIDAD';
  end if;
end $$;
comment on column public.tramite_tipos.dias_desde_termino_ot is
  'Si tiene valor, el trámite de este tipo se abre solo al terminar la OT de la unidad, con su fecha límite a tantos días hábiles del término. Solo en los tipos de una unidad.';
comment on column public.tramite_tipos.solo_sin_placa is
  'Con dias_desde_termino_ot: el trámite se abre solo si la unidad todavía no tiene placa (las placas de una unidad que ya las tiene no se tramitan).';
alter table public.tramite_tipos drop constraint if exists ck_tramite_tipo_ot;
alter table public.tramite_tipos add constraint ck_tramite_tipo_ot check (
  (dias_desde_termino_ot is null or (ambito = 'UNIDAD' and dias_desde_termino_ot between 1 and 60))
  and (not solo_sin_placa or dias_desde_termino_ot is not null));

-- 2. De dónde viene cada trámite -----------------------------------------------------------------
alter table public.tramites
  add column if not exists origen    text not null default 'MANUAL',
  add column if not exists renueva_a uuid constraint tramites_renueva_a_fkey references public.tramites(id) on delete restrict;
comment on column public.tramites.origen is
  'MANUAL: lo registró el Tramitador. OT: lo abrió la base al terminar la OT (orden_id). RENOVACION: es la renovación del trámite renueva_a, abierta por la revisión diaria o con «Renovar ahora».';
comment on column public.tramites.renueva_a is
  'En una renovación, el trámite concluido cuyo documento renueva.';
-- El que abre la base no tiene quién lo registró: queda vacío y su origen lo dice.
alter table public.tramites alter column registrado_por drop not null;
alter table public.tramites drop constraint if exists ck_tramite_origen;
alter table public.tramites add constraint ck_tramite_origen check (
  (origen = 'MANUAL' and registrado_por is not null and renueva_a is null)
  or (origen = 'OT' and registrado_por is null and orden_id is not null and renueva_a is null)
  or (origen = 'RENOVACION' and renueva_a is not null and renueva_a <> id));
-- Índices. La llave hacia la OT: (b), la OT lee sus trámites por aquí, y no hay
-- otro índice que empiece por ella. La llave de la renovación: (b), la ficha y
-- la revisión buscan la renovación de cada trámite; pleno, porque la
-- integridad no usa uno parcial (check 190).
create index if not exists ix_tramites_orden on public.tramites (orden_id);
create index if not exists ix_tramites_renueva_a on public.tramites (renueva_a);
-- Un trámite de cada tipo por OT, abierto por la base, aunque se anule.
create unique index if not exists uq_tramites_de_la_ot on public.tramites (orden_id, tipo_id) where origen = 'OT';
-- Una renovación en pie por trámite: anulada, se puede abrir otra a mano.
create unique index if not exists uq_tramites_renovacion_viva on public.tramites (renueva_a)
  where renueva_a is not null and estado <> 'ANULADO';

-- El origen y lo que renueva se fijan al nacer, como el número y la unidad.
create or replace function public.fn_tramite_origen_fijo()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if (new.origen, new.renueva_a) is distinct from (old.origen, old.renueva_a) then
    raise exception 'De dónde viene el trámite % y lo que renueva no se corrigen.', old.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_tramite_origen_fijo() from public, anon, authenticated;
create or replace trigger trg_tramite_origen_fijo
  before update on public.tramites
  for each row execute function public.fn_tramite_origen_fijo();

-- 3. Al terminar la OT, sus trámites -------------------------------------------------------------
-- Por cada tipo activo de una unidad con días desde el término (y, si pide
-- «solo sin placa», con la unidad sin placa), si la OT todavía no tiene un
-- trámite vivo de ese tipo ni uno que haya abierto la base. La fecha límite,
-- con el término en la hora de Lima. El número se pide solo cuando el trámite
-- va a entrar: no quedan huecos en la serie. Lo de una OT de un lote de prueba
-- va en el mismo lote, para que la limpieza se lo lleve.
create or replace function public.fn_ot_abre_sus_tramites()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_unidad  public.unidades%rowtype;
  v_termino constant date := coalesce((new.fecha_fin_real at time zone 'America/Lima')::date, (now() at time zone 'America/Lima')::date);
  v_lote    uuid;
  v_tipo    record;
  v_id      uuid;
begin
  select * into v_unidad from public.unidades where id = new.unidad_id;
  if not found then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tramites_de_la_ot:' || new.id::text, 0));
  select f.lote_id into v_lote from public.pruebas_filas f where f.tabla = 'ordenes_trabajo' and f.fila_id = new.id;
  for v_tipo in
    select tt.id, tt.nombre, tt.entidad, tt.se_renueva, tt.dias_desde_termino_ot
      from public.tramite_tipos tt
     where tt.activo and tt.ambito = 'UNIDAD' and tt.dias_desde_termino_ot is not null
       and (not tt.solo_sin_placa or nullif(btrim(coalesce(v_unidad.placa::text, '')), '') is null)
       and not exists (select 1 from public.tramites x
                        where x.orden_id = new.id and x.tipo_id = tt.id and (x.estado <> 'ANULADO' or x.origen = 'OT'))
     order by tt.nombre
  loop
    v_id := gen_random_uuid();
    insert into public.tramites (id, numero, tipo_id, tipo_nombre, se_renueva, ambito, entidad, asunto,
                                 unidad_id, cliente_id, orden_id, fecha_limite, estado, registrado_por, origen)
    values (v_id, public.siguiente_correlativo('TRAMITE', '001', null), v_tipo.id, v_tipo.nombre, v_tipo.se_renueva, 'UNIDAD',
            v_tipo.entidad, left(v_tipo.nombre || ' por la OT ' || new.numero, 300),
            new.unidad_id, coalesce(new.cliente_id, v_unidad.cliente_id), new.id,
            public.sumar_dias_habiles(v_termino, v_tipo.dias_desde_termino_ot), 'POR_INICIAR', null, 'OT');
    if v_lote is not null then
      insert into public.pruebas_filas (lote_id, tabla, fila_id) values (v_lote, 'tramites', v_id)
      on conflict (tabla, fila_id) do nothing;
    end if;
  end loop;
  return null;
end;
$$;
comment on function public.fn_ot_abre_sus_tramites() is
  'Al pasar la OT a Terminada (o más allá) con su unidad, abre el trámite de cada tipo del catálogo con días desde el término (la tarjeta de propiedad; las placas si la unidad no tiene), «Por iniciar» y con su fecha límite en días hábiles. Migración 20261127160000.';
revoke all on function public.fn_ot_abre_sus_tramites() from public, anon, authenticated;
-- Disparador propio, sin tocar los de la OT (skill seguridad › el blindaje).
-- Sin lista de columnas: el estado puede ponerlo otro disparador.
create or replace trigger trg_ot_abre_sus_tramites
  after update on public.ordenes_trabajo
  for each row
  when (new.unidad_id is not null
        and new.estado::text in ('TERMINADA', 'ENTREGADA', 'FACTURADA')
        and old.estado::text not in ('TERMINADA', 'ENTREGADA', 'FACTURADA'))
  execute function public.fn_ot_abre_sus_tramites();

-- 4. La renovación --------------------------------------------------------------------------------
-- Ayudante interno: abre la renovación de `p_viejo` con el id `p_id`, a nombre
-- de `p_por` (vacío: la revisión diaria). Devuelve el id, o null si ya tiene
-- una renovación en pie. Quien la llama ya comprobó lo demás.
create or replace function public.tramite_abrir_renovacion(p_viejo uuid, p_id uuid, p_por uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_t    public.tramites%rowtype;
  v_tipo public.tramite_tipos%rowtype;
  v_lote uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('tramite_renovar:' || p_viejo::text, 0));
  if exists (select 1 from public.tramites n where n.renueva_a = p_viejo and n.estado <> 'ANULADO') then
    return null;
  end if;
  select * into v_t from public.tramites where id = p_viejo;
  select * into v_tipo from public.tramite_tipos where id = v_t.tipo_id;
  insert into public.tramites (id, numero, tipo_id, tipo_nombre, se_renueva, ambito, entidad, asunto,
                               unidad_id, cliente_id, orden_id, fecha_limite, estado, registrado_por, origen, renueva_a)
  values (p_id, public.siguiente_correlativo('TRAMITE', '001', null), v_tipo.id, v_tipo.nombre, v_tipo.se_renueva, v_t.ambito,
          v_t.entidad, left('Renovación de ' || v_t.numero || ': ' || v_t.asunto, 300),
          v_t.unidad_id,
          case when v_t.ambito = 'UNIDAD' then coalesce((select u.cliente_id from public.unidades u where u.id = v_t.unidad_id), v_t.cliente_id) end,
          null, v_t.vigente_hasta, 'POR_INICIAR', p_por, 'RENOVACION', p_viejo);
  -- La renovación de un trámite de prueba es de prueba.
  select f.lote_id into v_lote from public.pruebas_filas f where f.tabla = 'tramites' and f.fila_id = p_viejo;
  if v_lote is not null then
    insert into public.pruebas_filas (lote_id, tabla, fila_id) values (v_lote, 'tramites', p_id)
    on conflict (tabla, fila_id) do nothing;
  end if;
  return p_id;
end;
$$;
comment on function public.tramite_abrir_renovacion(uuid, uuid, uuid) is
  'Abre la renovación de un trámite concluido: mismo tipo, entidad y unidad, «Por iniciar», con fecha límite el día en que vence el documento. Ayudante interno de la revisión diaria y de tramites_renovar.';
revoke all on function public.tramite_abrir_renovacion(uuid, uuid, uuid) from public, anon, authenticated;

-- «Renovar ahora»: el Tramitador abre la renovación antes de que la abra la
-- revisión. Un reintento con el mismo p_nuevo devuelve la que ya entró.
create or replace function public.tramites_renovar(p_id uuid, p_nuevo uuid)
returns table (tramite uuid, numero_tramite text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_t    public.tramites%rowtype;
  v_n    public.tramites%rowtype;
  v_tipo public.tramite_tipos%rowtype;
  v_otra text;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para llevar los trámites.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null or p_nuevo is null then
    raise exception 'Vuelve a abrir la ventana para renovar el trámite.' using errcode = 'check_violation';
  end if;
  select * into v_n from public.tramites where id = p_nuevo;
  if found then
    if v_n.renueva_a = p_id and v_n.registrado_por = v_yo then
      return query select v_n.id, v_n.numero;
      return;
    end if;
    raise exception 'Vuelve a abrir la ventana para renovar el trámite.' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tramites where id = p_id;
  if not found then
    raise exception 'Ese trámite no existe. Recarga la pantalla.' using errcode = 'check_violation';
  end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: queda como evidencia.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', v_t.numero using errcode = 'check_violation';
  end if;
  if not v_t.se_renueva then
    raise exception 'El trámite % no se renueva.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.estado <> 'CONCLUIDO' then
    raise exception 'El trámite % todavía no está concluido: se renueva el documento que ya se tiene.', v_t.numero using errcode = 'check_violation';
  end if;
  select * into v_tipo from public.tramite_tipos where id = v_t.tipo_id;
  if not v_tipo.activo then
    raise exception 'El tipo «%» está desactivado en «Tipos de trámite»: actívalo para renovar.', v_tipo.nombre using errcode = 'check_violation';
  end if;
  if public.tramite_abrir_renovacion(p_id, p_nuevo, v_yo) is null then
    select n.numero into v_otra from public.tramites n where n.renueva_a = p_id and n.estado <> 'ANULADO' limit 1;
    raise exception 'El trámite % ya se renueva con el %. Recarga la pantalla.', v_t.numero, v_otra using errcode = 'unique_violation';
  end if;
  return query select t.id, t.numero from public.tramites t where t.id = p_nuevo;
end;
$$;
comment on function public.tramites_renovar(uuid, uuid) is
  'Quien lleva los trámites (tramites.gestionar) abre la renovación de un concluido que se renueva, sin esperar a la revisión diaria. Da el número TR-… de la renovación.';
revoke all on function public.tramites_renovar(uuid, uuid) from public, anon;
grant execute on function public.tramites_renovar(uuid, uuid) to authenticated;

-- 5. El aviso del trámite nuevo dice de dónde viene ------------------------------------------------
create or replace function public.fn_tramite_avisa_al_registrarse()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_quien  text;
  v_origen text;
  v_viejo  public.tramites%rowtype;
begin
  select btrim(u.nombres || ' ' || u.apellidos) || coalesce(' (' || r.nombre || ')', '')
    into v_quien
    from public.usuarios u left join public.roles r on r.id = u.rol_id
   where u.id = new.registrado_por;
  if new.origen = 'OT' then
    v_origen := '. Lo abrió el sistema al terminar la OT ' || coalesce((select o.numero::text from public.ordenes_trabajo o where o.id = new.orden_id), '');
  elsif new.origen = 'RENOVACION' then
    select * into v_viejo from public.tramites where id = new.renueva_a;
    -- El asunto ya dice qué renueva; la fecha límite es el día en que vence el documento.
    v_origen := coalesce('. El documento del ' || v_viejo.numero || ' vale hasta el ' || to_char(v_viejo.vigente_hasta, 'DD/MM/YYYY'), '')
                || coalesce('. La abrió ' || v_quien, '. La abrió el sistema al acercarse el vencimiento');
  else
    v_origen := coalesce('. Lo registró ' || v_quien, '');
  end if;
  perform public.avisar_a_permiso(
    'tramites.gestionar',
    case when new.origen = 'RENOVACION' then 'Renovación abierta: ' else 'Trámite nuevo: ' end || new.numero,
    public.tramite_en_texto(new.id)
      || v_origen
      || case when new.fecha_limite is not null and new.origen <> 'RENOVACION' then '. Fecha límite: ' || to_char(new.fecha_limite, 'DD/MM/YYYY') else '' end
      || '.',
    '/tramites/' || new.id, 'tramites', new.id);
  return null;
end;
$$;
comment on function public.fn_tramite_avisa_al_registrarse() is
  'Al registrarse un trámite, avisa a quien tiene tramites.gestionar, salvo a quien lo registró, diciendo de dónde viene: lo registró alguien, lo abrió la OT al terminar o es una renovación. Migraciones 20261127004000 y 20261127160000.';
revoke all on function public.fn_tramite_avisa_al_registrarse() from public, anon, authenticated;

-- 6. La revisión diaria abre las renovaciones --------------------------------------------------------
-- Lo que ya se llevaba (la fecha límite) sigue igual. Lo que cambia es el
-- concluido que se renueva: en vez de avisar por su vigencia, al llegar el
-- primer día de aviso de su tipo abre su renovación (si su tipo sigue activo),
-- y desde ahí avisa la renovación por su fecha límite, que es la misma fecha.
-- El aviso de esa apertura es el del trámite nuevo; queda anotado como el día
-- de aviso que tocaba, para que la renovación no lo repita al día siguiente.
-- Un concluido con renovación, aunque se haya anulado, ya no abre otra solo.
alter table public.tramite_avisos drop constraint if exists ck_tramite_aviso_tipo;
alter table public.tramite_avisos add constraint ck_tramite_aviso_tipo
  check (tipo in ('POR_VENCER', 'VENCIDO', 'POR_RENOVAR', 'VIGENCIA_VENCIDA', 'RENOVACION', 'REVISION'));
alter table public.tramite_avisos drop constraint if exists ck_tramite_aviso_forma;
alter table public.tramite_avisos add constraint ck_tramite_aviso_forma check (
  (tipo = 'REVISION' and tramite_id is null and fecha is null and dias is null)
  or (tipo in ('POR_VENCER', 'POR_RENOVAR') and tramite_id is not null and fecha is not null and dias is not null)
  or (tipo in ('VENCIDO', 'VIGENCIA_VENCIDA') and tramite_id is not null and fecha is not null and dias is null)
  -- La renovación que se abrió: en el trámite viejo, por su vigencia; `dias`,
  -- el día de aviso que tocaba (vacío si ya había vencido).
  or (tipo = 'RENOVACION' and tramite_id is not null and fecha is not null));
comment on table public.tramite_avisos is
  'Cada aviso de vencimiento de un trámite que salió (de qué trámite, de qué tipo, por qué fecha y por cuál de los días de aviso de su tipo, a cuántas cuentas), cada renovación que abrió la revisión (RENOVACION, en el trámite que se renueva) y cada revisión diaria que corrió (REVISION). Lo escribe solo la revisión diaria. POR_RENOVAR y VIGENCIA_VENCIDA son de antes de la entrega 4. Migraciones 20261127004000 y 20261127160000.';

create or replace function public.revisar_tramites(p_hoy date default null)
returns table (tipo text, avisos integer, cuentas integer)
language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_hoy constant date := coalesce(p_hoy, (now() at time zone 'America/Lima')::date);
  r record;
  v_dia integer;
  v_cuentas integer;
  v_titulo text;
  v_cuerpo text;
  v_nuevo uuid;
  v_por_vencer integer := 0;  v_c_por_vencer integer := 0;
  v_vencidos integer := 0;    v_c_vencidos integer := 0;
  v_renovados integer := 0;   v_c_renovados integer := 0;
  v_hay_tramitador boolean;
begin
  -- Dos corridas a la vez (la de pg_cron y una a mano) no se duplican: la
  -- segunda espera a la primera y ya encuentra todo anotado.
  perform pg_advisory_xact_lock(hashtext('revisar_tramites'));

  insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision, avisados)
  values (null, 'REVISION', null, null, v_hoy, 0)
  on conflict (dia_revision) where tipo = 'REVISION' do update set actualizado_en = now();

  -- Solo en día laborable: lo que cae el domingo o el feriado sale el día siguiente.
  if not public.es_laborable(v_hoy) then
    return query values ('POR_VENCER', 0, 0), ('VENCIDO', 0, 0), ('RENOVACION', 0, 0);
    return;
  end if;

  -- Sin ningún Tramitador activo ese día (quien atiende el aviso), nada se
  -- anota ni se abre: si se anotara, no le llegaría nunca, sin que nada lo
  -- dijera. Sale en la primera revisión en que haya a quién.
  select exists (select 1 from public.usuarios u join public.roles_permisos rp on rp.rol_id = u.rol_id
                  where u.activo and rp.permiso_codigo = 'tramites.gestionar')
    into v_hay_tramitador;
  if not v_hay_tramitador then
    return query values ('POR_VENCER', 0, 0), ('VENCIDO', 0, 0), ('RENOVACION', 0, 0);
    return;
  end if;

  for r in
    select t.id, t.numero, x.que, x.fecha, x.fecha - v_hoy as d, tt.dias_aviso, tt.activo
      from public.tramites t
      join public.tramite_tipos tt on tt.id = t.tipo_id
      cross join lateral (
        select 'LIMITE'::text as que, t.fecha_limite as fecha
         where t.estado in ('POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO') and t.fecha_limite is not null
        union all
        select 'VIGENCIA', t.vigente_hasta
         where t.estado = 'CONCLUIDO' and t.se_renueva and t.vigente_hasta is not null
           -- El documento de antes que se carga ya vencido es historia: no se renueva solo.
           and t.vigente_hasta >= (t.concluido_en at time zone 'America/Lima')::date
           -- Ya tiene su renovación (aunque se haya anulado): avisa ella.
           and not exists (select 1 from public.tramites n where n.renueva_a = t.id)
      ) x
     where not (t.anulacion_pedida_en is not null and t.anulacion_rechazada_en is null)
       -- Lo de un lote de prueba no avisa a nadie ni deja filas que impidan limpiarlo.
       and not exists (select 1 from public.pruebas_filas f where f.tabla = 'tramites' and f.fila_id = t.id)
     -- Lo más lejano primero: la campana muestra lo último arriba, y así lo
     -- vencido queda a la vista aunque la corrida sea larga.
     order by x.fecha desc, t.numero desc
  loop
    if r.que = 'VIGENCIA' then
      -- Se abre al llegar el primer día de aviso de su tipo, o ya vencido si la
      -- revisión no lo alcanzó antes. Con el tipo desactivado, no se lleva más.
      continue when not r.activo or r.d > (select max(a) from unnest(r.dias_aviso) a);
      v_nuevo := public.tramite_abrir_renovacion(r.id, gen_random_uuid(), null);
      continue when v_nuevo is null;
      select count(*)::integer into v_cuentas from public.notificaciones n
       where n.origen_tabla = 'tramites' and n.origen_id = v_nuevo;
      select min(a) into v_dia from unnest(r.dias_aviso) a where a >= r.d;
      insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision, avisados)
      values (r.id, 'RENOVACION', r.fecha, case when r.d >= 0 then v_dia end, v_hoy, v_cuentas)
      on conflict do nothing;
      -- El aviso de apertura ya dijo cuánto falta: la renovación no lo repite.
      if r.d >= 0 then
        insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision, avisados)
        values (v_nuevo, 'POR_VENCER', r.fecha, v_dia, v_hoy, 0)
        on conflict do nothing;
      end if;
      v_renovados := v_renovados + 1; v_c_renovados := v_c_renovados + v_cuentas;
      continue;
    end if;

    if r.d < 0 then
      -- Venció: una vez, al Tramitador y a Gerencia.
      insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision)
      values (r.id, 'VENCIDO', r.fecha, null, v_hoy)
      on conflict do nothing;
      continue when not found;
      v_titulo := 'Venció el trámite ' || r.numero;
      v_cuerpo := public.tramite_en_texto(r.id) || '. Su fecha límite era el ' || to_char(r.fecha, 'DD/MM/YYYY') || '.';
      v_cuentas := public.avisar_tramite(r.id, v_titulo, v_cuerpo, true);
      update public.tramite_avisos set avisados = v_cuentas
       where tramite_id = r.id and tipo = 'VENCIDO' and fecha = r.fecha and dias is null;
      v_vencidos := v_vencidos + 1; v_c_vencidos := v_c_vencidos + v_cuentas;
      continue;
    end if;

    -- Por vencer: el menor día de aviso que ya se cumplió.
    select min(a) into v_dia from unnest(r.dias_aviso) a where a >= r.d;
    continue when v_dia is null;
    -- Si los días del tipo cambiaron a medio camino, no se manda un día de aviso
    -- mayor que uno que ya salió para esta misma fecha: sería casi repetido.
    continue when exists (select 1 from public.tramite_avisos a
                           where a.tramite_id = r.id and a.fecha = r.fecha and a.dias <= v_dia and a.tipo = 'POR_VENCER');
    insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision)
    values (r.id, 'POR_VENCER', r.fecha, v_dia, v_hoy)
    on conflict do nothing;
    continue when not found;
    v_titulo := 'Por vencer: ' || r.numero || ' · '
                || case r.d when 0 then 'vence hoy' when 1 then 'vence mañana' else 'vence en ' || r.d || ' días' end;
    v_cuerpo := public.tramite_en_texto(r.id) || '. Su fecha límite es el ' || to_char(r.fecha, 'DD/MM/YYYY') || '.';
    v_cuentas := public.avisar_tramite(r.id, v_titulo, v_cuerpo, false);
    update public.tramite_avisos set avisados = v_cuentas
     where tramite_id = r.id and tipo = 'POR_VENCER' and fecha = r.fecha and dias = v_dia;
    v_por_vencer := v_por_vencer + 1; v_c_por_vencer := v_c_por_vencer + v_cuentas;
  end loop;

  return query values
    ('POR_VENCER', v_por_vencer, v_c_por_vencer),
    ('VENCIDO', v_vencidos, v_c_vencidos),
    ('RENOVACION', v_renovados, v_c_renovados);
end;
$$;
comment on function public.revisar_tramites(date) is
  'La revisión diaria de los trámites (7:00 a. m. de Lima, día laborable): por la fecha límite de los que se llevan avisa al Tramitador al cumplirse cada día de aviso de su tipo, y al pasar la fecha límite avisa una vez al Tramitador y a Gerencia. El concluido que se renueva abre su renovación al llegar el primer día de aviso de su tipo, y desde ahí avisa la renovación. No repite: anota cada aviso, cada renovación y cada corrida en tramite_avisos. La corre pg_cron; cerrada a la gente.';
revoke all on function public.revisar_tramites(date) from public, anon, authenticated;

-- 7. El catálogo: el formulario suma los días desde el término de la OT ------------------------------
-- p_solo_sin_placa vacío es la pantalla de antes del despliegue: no toca lo de
-- la OT. La pantalla nueva siempre lo manda.
drop function if exists public.tramites_guardar_tipo(uuid, text, text, text, boolean, jsonb, boolean, boolean);
create or replace function public.tramites_guardar_tipo(
  p_id uuid, p_nombre text, p_entidad text, p_ambito text, p_se_renueva boolean, p_dias_aviso jsonb, p_activo boolean,
  p_alta boolean, p_dias_ot integer default null, p_solo_sin_placa boolean default null
) returns table (tipo uuid, creado boolean)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_nombre  text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_entidad text := btrim(regexp_replace(coalesce(p_entidad, ''), '\s+', ' ', 'g'));
  v_dias    integer[];
  v_actual  public.tramite_tipos%rowtype;
  v_otro    text;
  v_dias_ot integer;
  v_solo    boolean;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para cambiar los tipos de trámite.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del tipo.' using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) not between 3 and 80 then
    raise exception 'Escribe el nombre del tipo de trámite, en 3 a 80 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(v_entidad) not between 2 and 80 then
    raise exception 'Escribe ante qué entidad se hace, en 2 a 80 caracteres.' using errcode = 'check_violation';
  end if;
  if p_ambito is null or p_ambito not in ('UNIDAD', 'EMPRESA') then
    raise exception 'Elige si el trámite es de una unidad o de la empresa.' using errcode = 'check_violation';
  end if;
  if p_dias_aviso is null or jsonb_typeof(p_dias_aviso) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_dias_aviso) d
                 where jsonb_typeof(d) <> 'number' or (d #>> '{}') !~ '^[0-9]{1,3}$' or (d #>> '{}')::integer > 120) then
    raise exception 'Los días de aviso van en números enteros de 0 a 120.' using errcode = 'check_violation';
  end if;
  -- De más a menos y sin repetir: así se leen y así se avisan.
  select coalesce(array_agg(x.d order by x.d desc), '{}') into v_dias
    from (select distinct (d #>> '{}')::integer as d from jsonb_array_elements(p_dias_aviso) d) x;
  if cardinality(v_dias) not between 1 and 5 then
    raise exception 'Pon de 1 a 5 avisos antes del vencimiento.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tramites_guardar_tipo:' || lower(v_nombre), 0));
  select t.nombre into v_otro from public.tramite_tipos t where lower(t.nombre) = lower(v_nombre) and t.id <> p_id;
  if v_otro is not null then
    raise exception 'Ya hay un tipo de trámite «%»: corrige ese en vez de crear otro.', v_otro using errcode = 'unique_violation';
  end if;

  select * into v_actual from public.tramite_tipos where id = p_id for update;
  -- Lo de la OT: lo que manda la pantalla, o lo que ya tenía si es la de antes.
  if p_solo_sin_placa is null then
    v_dias_ot := v_actual.dias_desde_termino_ot;
    v_solo := coalesce(v_actual.solo_sin_placa, false);
  else
    v_dias_ot := p_dias_ot;
    v_solo := p_solo_sin_placa and p_dias_ot is not null;
  end if;
  if v_dias_ot is not null and p_ambito <> 'UNIDAD' then
    raise exception 'Solo el trámite de una unidad se abre al terminar la OT: deja vacíos los días desde el término.' using errcode = 'check_violation';
  end if;
  if v_dias_ot is not null and v_dias_ot not between 1 and 60 then
    raise exception 'Los días hábiles desde que termina la OT van de 1 a 60.' using errcode = 'check_violation';
  end if;

  if v_actual.id is null then
    if not coalesce(p_alta, false) then
      raise exception 'Ese tipo de trámite ya no está en el catálogo. Recarga la pantalla.' using errcode = 'no_data_found';
    end if;
    insert into public.tramite_tipos (id, nombre, entidad, ambito, se_renueva, dias_aviso, activo, dias_desde_termino_ot, solo_sin_placa, creado_por)
    values (p_id, v_nombre, v_entidad, p_ambito, coalesce(p_se_renueva, false), v_dias, coalesce(p_activo, true), v_dias_ot, v_solo, v_yo);
    return query select p_id, true;
    return;
  end if;
  -- El alta que se repite (se perdió la respuesta y se volvió a enviar) no
  -- corrige: con lo mismo, es el mismo envío; con otra cosa, dice que ya quedó.
  if coalesce(p_alta, false) then
    if (v_actual.nombre, v_actual.entidad, v_actual.ambito, v_actual.se_renueva, v_actual.dias_aviso, v_actual.activo,
        v_actual.dias_desde_termino_ot, v_actual.solo_sin_placa)
       is not distinct from (v_nombre, v_entidad, p_ambito, coalesce(p_se_renueva, false), v_dias, coalesce(p_activo, true), v_dias_ot, v_solo) then
      return query select p_id, true;
      return;
    end if;
    raise exception 'El tipo «%» ya quedó agregado la primera vez que lo enviaste: lo que cambiaste después no se guardó. Corrígelo con «Editar».', v_actual.nombre
      using errcode = 'unique_violation';
  end if;
  if v_actual.ambito <> p_ambito and exists (select 1 from public.tramites x where x.tipo_id = p_id) then
    raise exception 'El tipo «%» ya tiene trámites registrados: no cambia de % a %. Crea otro tipo.', v_actual.nombre,
      case v_actual.ambito when 'UNIDAD' then 'unidad' else 'empresa' end,
      case p_ambito when 'UNIDAD' then 'unidad' else 'empresa' end
      using errcode = 'check_violation';
  end if;
  update public.tramite_tipos
     set nombre = v_nombre, entidad = v_entidad, ambito = p_ambito, se_renueva = coalesce(p_se_renueva, false),
         dias_aviso = v_dias, activo = coalesce(p_activo, true), dias_desde_termino_ot = v_dias_ot, solo_sin_placa = v_solo
   where id = p_id
     and (nombre, entidad, ambito, se_renueva, dias_aviso, activo, dias_desde_termino_ot, solo_sin_placa)
         is distinct from (v_nombre, v_entidad, p_ambito, coalesce(p_se_renueva, false), v_dias, coalesce(p_activo, true), v_dias_ot, v_solo);
  return query select p_id, false;
end;
$$;
comment on function public.tramites_guardar_tipo(uuid, text, text, text, boolean, jsonb, boolean, boolean, integer, boolean) is
  'Quien lleva los trámites (tramites.gestionar) da de alta un tipo de trámite (p_alta) o lo corrige: nombre, entidad, si es de una unidad o de la empresa, si se renueva, los días de aviso, si sigue en uso y, en los de una unidad, si se abre solo al terminar la OT (a cuántos días hábiles, y si solo cuando la unidad no tiene placa). El alta repetida con lo mismo devuelve el mismo tipo; con otra cosa, dice que ya quedó.';
revoke all on function public.tramites_guardar_tipo(uuid, text, text, text, boolean, jsonb, boolean, boolean, integer, boolean) from public, anon;
grant execute on function public.tramites_guardar_tipo(uuid, text, text, text, boolean, jsonb, boolean, boolean, integer, boolean) to authenticated;

-- 8. Lo que cada quien lee ----------------------------------------------------------------------------
-- Suma de dónde viene, lo que renueva y con qué se renovó, si quien pregunta
-- puede renovarlo y si está por vencer (dentro de los días de aviso de su
-- tipo: lo que Gerencia cuenta como «por vencer»). El que abrió la base no
-- tiene quién lo registró. Cambian las columnas: la función se vuelve a crear.
drop function if exists public.tramites_visibles(uuid);
create function public.tramites_visibles(p_id uuid)
returns table (
  id uuid, numero text, estado text, situacion text, creado_en timestamptz, actualizado_en timestamptz,
  tipo_id uuid, tipo text, se_renueva boolean, ambito text, entidad text, asunto text, expediente text,
  fecha_inicio date, fecha_limite date, dias_para_limite integer, vencido boolean, nota text,
  unidad_id uuid, placa text, codigo_interno text, carroceria text, cliente text,
  orden_id uuid, orden_numero text,
  registro text, registro_puesto text,
  anulacion_pedida_en timestamptz, anulacion_pidio text, motivo_anulacion text,
  anulacion_rechazada_en timestamptz, anulacion_rechazo text, anulacion_rechazo_motivo text,
  anulado_en timestamptz, anulo text,
  puede_actualizar boolean, puede_pedir_anulacion boolean, puede_resolver_anulacion boolean,
  fecha_conclusion date, vigente_hasta date, concluido_en timestamptz, concluyo text,
  archivos integer, puede_llevar_expediente boolean, puede_concluir boolean,
  origen text, por_vencer boolean,
  renueva_a uuid, renueva_numero text,
  renovado_con uuid, renovado_numero text, renovado_estado text,
  puede_renovar boolean)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
#variable_conflict use_column
declare
  v_todos    boolean := public.tramites_ve_todos();
  v_unidades boolean := public.tramites_ve_los_de_unidades();
  v_gestiona boolean;
  v_aprueba  boolean;
  v_hoy      constant date := (now() at time zone 'America/Lima')::date;
begin
  if not (v_todos or v_unidades) then
    return;
  end if;
  v_gestiona := public.es_admin() or public.tiene_permiso('tramites.gestionar');
  v_aprueba  := public.es_admin() or public.tiene_permiso('tramites.aprobar_anulacion');
  return query
  with base as (
    select t.*,
           (t.estado <> 'ANULADO' and t.anulacion_pedida_en is not null and t.anulacion_rechazada_en is null) as espera_visto,
           -- Mientras se lleva: ni anulado ni concluido.
           t.estado in ('POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO') as abierto
      from public.tramites t
     where (p_id is null or t.id = p_id)
       and (v_todos or t.ambito = 'UNIDAD')
  )
  select b.id, b.numero, b.estado, case when b.espera_visto then 'POR_ANULAR' else b.estado end,
         b.creado_en, b.actualizado_en,
         b.tipo_id, b.tipo_nombre, b.se_renueva, b.ambito, b.entidad, b.asunto, b.expediente,
         b.fecha_inicio, b.fecha_limite,
         case when b.abierto and b.fecha_limite is not null then b.fecha_limite - v_hoy end,
         b.abierto and b.fecha_limite is not null and b.fecha_limite < v_hoy,
         b.nota,
         b.unidad_id, u.placa::text, u.codigo_interno::text, tc.nombre::text, c.razon_social::text,
         b.orden_id, o.numero::text,
         btrim(re.nombres || ' ' || re.apellidos), rre.nombre::text,
         b.anulacion_pedida_en, btrim(pi.nombres || ' ' || pi.apellidos), b.motivo_anulacion,
         b.anulacion_rechazada_en, btrim(rz.nombres || ' ' || rz.apellidos), b.anulacion_rechazo_motivo,
         b.anulado_en, btrim(an.nombres || ' ' || an.apellidos),
         v_gestiona and b.abierto and not b.espera_visto,
         v_gestiona and b.estado <> 'ANULADO' and not b.espera_visto,
         v_aprueba and b.espera_visto,
         b.fecha_conclusion, b.vigente_hasta, b.concluido_en, btrim(co.nombres || ' ' || co.apellidos),
         (select count(*)::integer from public.tramite_archivos a where a.tramite_id = b.id and a.retirado_en is null),
         v_gestiona and b.estado <> 'ANULADO' and not b.espera_visto,
         v_gestiona and b.estado in ('EN_TRAMITE', 'OBSERVADO') and not b.espera_visto,
         b.origen,
         b.abierto and b.fecha_limite is not null and b.fecha_limite >= v_hoy
           and b.fecha_limite - v_hoy <= (select max(a) from unnest(tt.dias_aviso) a),
         b.renueva_a, vj.numero,
         nv.id, nv.numero, nv.estado,
         v_gestiona and b.estado = 'CONCLUIDO' and b.se_renueva and not b.espera_visto
           and (nv.id is null or nv.estado = 'ANULADO')
    from base b
    join public.tramite_tipos tt on tt.id = b.tipo_id
    left join public.unidades u on u.id = b.unidad_id
    left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
    left join public.clientes c on c.id = b.cliente_id
    left join public.ordenes_trabajo o on o.id = b.orden_id
    left join public.usuarios re on re.id = b.registrado_por
    left join public.roles rre on rre.id = re.rol_id
    left join public.usuarios pi on pi.id = b.anulacion_pedida_por
    left join public.usuarios rz on rz.id = b.anulacion_rechazada_por
    left join public.usuarios an on an.id = b.anulado_por
    left join public.usuarios co on co.id = b.concluido_por
    left join public.tramites vj on vj.id = b.renueva_a
    -- La renovación: la que está en pie o, si se anularon, la última.
    left join lateral (
      select n.id, n.numero, n.estado from public.tramites n
       where n.renueva_a = b.id
       order by (n.estado = 'ANULADO'), n.creado_en desc
       limit 1
    ) nv on true
   order by b.creado_en desc, b.numero desc;
end;
$$;
comment on function public.tramites_visibles(uuid) is
  'Los trámites (uno, o todos con p_id vacío) para quien puede verlos —todos, o solo los de una unidad para Ventas—, con su tipo, su unidad, su cliente, su OT, de dónde viene (registrado, abierto por la OT o renovación), lo que renueva y con qué se renovó, los días que faltan para su fecha límite (con la fecha de Lima; uno concluido ya no vence), si está por vencer según los días de aviso de su tipo, su cierre, cuántos archivos tiene su expediente y lo que quien pregunta puede hacer en cada uno.';
revoke all on function public.tramites_visibles(uuid) from public, anon;
grant execute on function public.tramites_visibles(uuid) to authenticated;

-- 9. Lo que la OT lee de sus trámites ------------------------------------------------------------------
-- Quien ve la OT ve en qué van sus trámites (no su expediente): el número, el
-- tipo, el estado, la fecha límite y cuándo se concluyó. Sin los anulados.
-- `ve` dice si puede abrir la ficha del trámite.
create or replace function public.tramites_de_la_orden(p_orden uuid)
returns table (id uuid, numero text, tipo text, origen text, estado text, situacion text,
               fecha_limite date, fecha_conclusion date, vencido boolean, ve boolean)
language plpgsql stable security definer set search_path to 'public' rows 5 as $$
#variable_conflict use_column
declare
  v_ve  boolean := public.tramites_ve_todos() or public.tramites_ve_los_de_unidades();
  v_hoy constant date := (now() at time zone 'America/Lima')::date;
begin
  if public.usuario_actual() is null or not public.es_usuario_activo() or not (v_ve or public.puede_ver_orden(p_orden)) then
    return;
  end if;
  return query
  select t.id, t.numero, t.tipo_nombre, t.origen, t.estado,
         case when t.anulacion_pedida_en is not null and t.anulacion_rechazada_en is null then 'POR_ANULAR' else t.estado end,
         t.fecha_limite, t.fecha_conclusion,
         t.estado in ('POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO') and t.fecha_limite is not null and t.fecha_limite < v_hoy,
         v_ve
    from public.tramites t
   where t.orden_id = p_orden and t.estado <> 'ANULADO'
   order by t.creado_en, t.numero;
end;
$$;
comment on function public.tramites_de_la_orden(uuid) is
  'Los trámites sin anular de una OT (los que abrió al terminar y los que se registraron con ella) para quien ve la OT o los trámites: número, tipo, de dónde viene, estado, fecha límite, cuándo se concluyó, si venció y si quien pregunta puede abrir su ficha.';
revoke all on function public.tramites_de_la_orden(uuid) from public, anon;
grant execute on function public.tramites_de_la_orden(uuid) to authenticated;
