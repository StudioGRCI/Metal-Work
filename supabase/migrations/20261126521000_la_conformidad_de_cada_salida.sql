-- =============================================================================
-- La conformidad de cada salida del almacén (plan 2 de Almacén, entrega 2.2)
-- =============================================================================
-- Almacén registra la salida de un insumo del RQ con su foto y quién lo
-- recibió, y ahí terminaba: si al área no le llegó, o le llegó menos, nadie lo
-- dejaba escrito y el reclamo se perdía en el teléfono. Ahora quien pidió el RQ
-- ve cada salida con su foto y puede anotar «no llegó» o «llegó incompleto»
-- (con cuánto llegó). Almacén ve las notas abiertas arriba de Atención de
-- requerimiento, responde qué hizo y la cierra; a quien la anotó le llega el
-- aviso.
--
-- Decisiones de DKS (2026-11-26, «ok» al plan):
--   1. Anotan quien registró el RQ, el área de Requerimientos y el supervisor
--      del área que lo pidió; en un RQ de Administración, Administración.
--      Almacén y Logística no anotan.
--   2. Una nota abierta por salida a la vez. «Llegó incompleto» pide cuánto
--      llegó. La nota no se corrige ni se borra.
--   3. La cierra Almacén escribiendo qué hizo; queda quién y cuándo, y a quien
--      la anotó le llega un aviso.
--   4. La salida del kardex no se toca: la nota es una fila aparte. No tiene
--      plazo.
--
-- La nota se escribe solo por función (`anotar_conformidad_salida`,
-- `atender_conformidad_salida`): la tabla no tiene políticas de escritura. Así
-- el permiso que exige la acción es el que exige la función, y no hay UPDATE que
-- afecte cero filas callado.
--
-- Quien pidió no lee `movimientos_materiales` (guarda el precio y su política
-- pide `almacen.ver`): las salidas de un RQ las da `salidas_de_requerimientos`,
-- sin precio, y la foto la deja leer una política de Storage propia para las
-- salidas de un RQ. Sin `drop`: el conector de Supabase cuelga con cualquiera.
-- =============================================================================

-- ------------------------------------------------------------------ 1. La tabla
create table if not exists public.conformidad_salidas (
  id                     uuid primary key default gen_random_uuid(),
  movimiento_id          uuid not null references public.movimientos_materiales(id),
  requerimiento_id       uuid not null references public.requerimientos(id),
  requerimiento_linea_id uuid not null references public.requerimiento_lineas(id),
  tipo                   text not null check (tipo in ('NO_LLEGO', 'LLEGO_INCOMPLETO')),
  cantidad_recibida      numeric(14,3) check (cantidad_recibida > 0),
  nota                   text not null check (char_length(nota) between 10 and 500),
  registrado_por         uuid not null references public.usuarios(id),
  registrado_en          timestamptz not null default now(),
  respuesta              text check (char_length(respuesta) between 10 and 500),
  atendido_por           uuid references public.usuarios(id),
  atendido_en            timestamptz,
  actualizado_en         timestamptz not null default now(),
  constraint conformidad_salidas_cantidad_del_tipo
    check ((tipo = 'LLEGO_INCOMPLETO') = (cantidad_recibida is not null)),
  constraint conformidad_salidas_cierre_completo
    check ((respuesta is null) = (atendido_en is null) and (atendido_en is null) = (atendido_por is null))
);

comment on table public.conformidad_salidas is
  'Lo que quien pidió el RQ anota sobre una salida del almacén («no llegó», «llegó incompleto») y lo que Almacén respondió al cerrarla. La salida del kardex no cambia.';
comment on column public.conformidad_salidas.cantidad_recibida is
  'Cuánto llegó de la salida, en la unidad del material. Solo en «llegó incompleto».';
comment on column public.conformidad_salidas.respuesta is
  'Qué hizo Almacén al cerrarla (por ejemplo, que lo repuso con otra salida).';

-- Una nota abierta por salida a la vez (decisión 2).
create unique index if not exists ux_conformidad_salidas_abierta
  on public.conformidad_salidas (movimiento_id) where atendido_en is null;
-- Las notas de una salida, abiertas o cerradas: (a) el índice de arriba es
-- parcial y la integridad de la llave no lo puede usar (check 190), y (b) las
-- funciones de lectura buscan por esta columna.
create index if not exists ix_conformidad_salidas_movimiento
  on public.conformidad_salidas (movimiento_id);
-- Las notas de un RQ, para su tarjeta: (b) la aplicación filtra por esta columna.
create index if not exists ix_conformidad_salidas_requerimiento
  on public.conformidad_salidas (requerimiento_id);

alter table public.conformidad_salidas enable row level security;

-- La lee quien ve el kardex o los requerimientos: es la misma gente que ve la
-- salida o el RQ de donde sale. No hay políticas de escritura: se escribe solo
-- por las funciones de abajo.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conformidad_salidas'
                    and policyname = 'ver_conformidad_salidas') then
    create policy ver_conformidad_salidas on public.conformidad_salidas
      for select to authenticated
      using ((select public.tiene_permiso('almacen.ver')) or (select public.puede_ver_requerimientos()));
  end if;
end $$;

revoke all on public.conformidad_salidas from public, anon, authenticated;
grant select on public.conformidad_salidas to authenticated;

select public.activar_timestamps('conformidad_salidas');
select public.activar_auditoria('conformidad_salidas');
select public.activar_registro_de_prueba('conformidad_salidas');

-- La nota es evidencia: no cambia lo anotado, y lo que respondió Almacén se
-- escribe una vez. Vale también para el dueño de las tablas.
create or replace function public.fn_conformidad_salidas_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if (new.movimiento_id, new.requerimiento_id, new.requerimiento_linea_id, new.tipo, new.cantidad_recibida,
      new.nota, new.registrado_por, new.registrado_en)
     is distinct from
     (old.movimiento_id, old.requerimiento_id, old.requerimiento_linea_id, old.tipo, old.cantidad_recibida,
      old.nota, old.registrado_por, old.registrado_en) then
    raise exception 'Lo anotado sobre una salida no se corrige: si hace falta, Almacén la cierra y se anota otra.'
      using errcode = 'check_violation';
  end if;
  if old.atendido_en is not null
     and (new.respuesta, new.atendido_por, new.atendido_en) is distinct from (old.respuesta, old.atendido_por, old.atendido_en) then
    raise exception 'Esta nota ya se cerró: lo que respondió Almacén no se cambia.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_conformidad_salidas_guardia() from public, anon, authenticated;

create or replace trigger trg_conformidad_salidas_guardia
  before update on public.conformidad_salidas
  for each row execute function public.fn_conformidad_salidas_guardia();

-- Decisión 2: la nota no se borra, ni por el dueño de las tablas. Es la
-- evidencia de lo que dijo quien pidió y de lo que respondió Almacén.
create or replace function public.fn_conformidad_salidas_no_se_borra()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Una nota de la conformidad de una salida no se borra: queda como evidencia.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_conformidad_salidas_no_se_borra() from public, anon, authenticated;

create or replace trigger trg_conformidad_salidas_no_se_borra
  before delete on public.conformidad_salidas
  for each row execute function public.fn_conformidad_salidas_no_se_borra();

-- --------------------------------------------------------- 2. Quién la anota
/**
 * Decisión 1: quien registró el RQ, Requerimientos (`requerimientos.emitir`) y
 * el supervisor del área que lo pidió (`requerimientos.area` y su misma área);
 * en un RQ de Administración, Administración. Quien despacha (Almacén) no anota
 * sobre lo que él mismo entregó. El colaborador de Diseño pide con
 * `requerimientos.emitir`, pero responde solo por los suyos (migración
 * 20261106100000): entra por quien lo registró. Interna: la llaman las
 * funciones de abajo.
 */
create or replace function public.puede_anotar_conformidad(p_rq public.requerimientos)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select not public.tiene_permiso('almacen.despachar')
     and p_rq.estado <> 'ANULADO'
     and (
       p_rq.creado_por = public.usuario_actual()
       or case when p_rq.tipo = 'ADMINISTRACION'
               then public.tiene_permiso('requerimientos.administracion')
               else (public.tiene_permiso('requerimientos.emitir') and public.mi_rol() is distinct from 'DISENO_COLABORADOR')
                    or (public.tiene_permiso('requerimientos.area')
                        and exists (select 1 from public.usuarios u
                                     where u.id = public.usuario_actual() and u.activo and u.area_id = p_rq.area_id))
          end
     );
$$;
revoke all on function public.puede_anotar_conformidad(public.requerimientos) from public, anon, authenticated;

-- ------------------------------------------- 3. Las salidas de cada RQ, sin precio
/**
 * Cada salida del kardex hecha contra un insumo de estos RQ: cuánto, cuándo,
 * quién la recibió y si tiene foto, sin precio. Si quien mira puede anotar su
 * conformidad, y la nota abierta que tenga. La lee quien ve los requerimientos.
 */
create or replace function public.salidas_de_requerimientos(p_ids uuid[])
returns table (
  movimiento_id          uuid,
  requerimiento_id       uuid,
  requerimiento_linea_id uuid,
  item                   smallint,
  cantidad               numeric,
  unidad                 text,
  material               text,
  numero_salida          text,
  salio_en               timestamptz,
  recibido_por           text,
  con_foto               boolean,
  puede_anotar           boolean,
  nota_abierta           uuid
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select m.id, r.id, l.id, l.item, m.cantidad::numeric, um.codigo::text, mat.descripcion::text, m.numero_salida,
           m.registrado_en, m.recibido_por_nombre, m.foto_ruta is not null,
           public.puede_anotar_conformidad(r),
           (select c.id from public.conformidad_salidas c where c.movimiento_id = m.id and c.atendido_en is null)
      from public.movimientos_materiales m
      join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
      join public.requerimientos r on r.id = l.requerimiento_id
      left join public.materiales mat on mat.id = m.material_id
      left join public.unidades_medida um on um.id = mat.unidad_medida_id
     where m.tipo = 'SALIDA'
       and r.id = any(coalesce(p_ids, '{}'))
     order by r.id, l.item, m.registrado_en, m.id;
end;
$$;
revoke all on function public.salidas_de_requerimientos(uuid[]) from public, anon;
grant execute on function public.salidas_de_requerimientos(uuid[]) to authenticated;

-- ------------------------------------------------- 4. Las notas, con su salida
/**
 * Las notas de conformidad con su RQ, su insumo y su salida, sin precio. Con
 * `p_requerimientos`, solo las de esos RQ; con `p_solo_abiertas`, las que
 * Almacén todavía no cierra (las abiertas primero, la más antigua arriba).
 * La lee quien ve el kardex o los requerimientos, igual que la tabla.
 */
create or replace function public.notas_de_conformidad(p_requerimientos uuid[] default null, p_solo_abiertas boolean default false)
returns table (
  id                 uuid,
  movimiento_id      uuid,
  requerimiento_id   uuid,
  requerimiento      text,
  item               smallint,
  material           text,
  unidad             text,
  salio              numeric,
  numero_salida      text,
  salio_en           timestamptz,
  tipo               text,
  cantidad_recibida  numeric,
  nota               text,
  anotado_por        text,
  anotado_en         timestamptz,
  respuesta          text,
  atendido_por       text,
  atendido_en        timestamptz,
  puede_atender      boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.tiene_permiso('almacen.ver') or public.puede_ver_requerimientos()) then
    raise exception 'No tienes permiso para ver las notas de las salidas.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, c.movimiento_id, r.id, r.numero, l.item, mat.descripcion::text, um.codigo::text, m.cantidad::numeric,
           m.numero_salida, m.registrado_en, c.tipo, c.cantidad_recibida::numeric, c.nota,
           nullif(btrim(concat_ws(' ', ua.nombres, ua.apellidos)), ''), c.registrado_en,
           c.respuesta, nullif(btrim(concat_ws(' ', ut.nombres, ut.apellidos)), ''), c.atendido_en,
           public.tiene_permiso('almacen.despachar')
      from public.conformidad_salidas c
      join public.movimientos_materiales m on m.id = c.movimiento_id
      join public.requerimientos r on r.id = c.requerimiento_id
      join public.requerimiento_lineas l on l.id = c.requerimiento_linea_id
      left join public.materiales mat on mat.id = m.material_id
      left join public.unidades_medida um on um.id = mat.unidad_medida_id
      left join public.usuarios ua on ua.id = c.registrado_por
      left join public.usuarios ut on ut.id = c.atendido_por
     where (p_requerimientos is null or c.requerimiento_id = any(p_requerimientos))
       and (not p_solo_abiertas or c.atendido_en is null)
     order by c.atendido_en is not null, c.registrado_en, c.id;
end;
$$;
revoke all on function public.notas_de_conformidad(uuid[], boolean) from public, anon;
grant execute on function public.notas_de_conformidad(uuid[], boolean) to authenticated;

-- --------------------------------------------------- 5. Anotar «no llegó»
/**
 * Quien pidió el RQ anota que una salida no llegó, o que llegó incompleta y
 * cuánto llegó. Avisa a Almacén. El mismo envío repetido (mismo id, misma
 * salida, misma persona) contesta lo mismo y no anota dos veces.
 */
create or replace function public.anotar_conformidad_salida(
  p_id uuid, p_movimiento uuid, p_tipo text, p_cantidad_recibida numeric, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_mov   public.movimientos_materiales%rowtype;
  v_linea public.requerimiento_lineas%rowtype;
  v_rq    public.requerimientos%rowtype;
  v_yo    uuid := public.usuario_actual();
  v_nota  text := btrim(coalesce(p_nota, ''));
  v_unidad text;
  v_previa public.conformidad_salidas%rowtype;
begin
  if v_yo is null then raise exception 'Vuelve a entrar al sistema.' using errcode = 'insufficient_privilege'; end if;

  select * into v_previa from public.conformidad_salidas where id = p_id;
  if found then
    -- El mismo envío es todo lo que el envío lleva: con otro tipo, otra cantidad
    -- u otra nota no es el mismo, y darlo por anotado guardaría lo de antes.
    if v_previa.registrado_por = v_yo and v_previa.movimiento_id = p_movimiento and v_previa.tipo = p_tipo
       and v_previa.cantidad_recibida is not distinct from (case when p_tipo = 'LLEGO_INCOMPLETO' then p_cantidad_recibida end)
       and v_previa.nota = btrim(coalesce(p_nota, '')) then
      return p_id;
    end if;
    raise exception 'Esta nota ya quedó anotada la primera vez que la enviaste, con lo que decía entonces: recarga la pantalla para ver cómo quedó.'
      using errcode = 'unique_violation';
  end if;

  select * into v_mov from public.movimientos_materiales where id = p_movimiento for update;
  if not found or v_mov.tipo <> 'SALIDA' or v_mov.requerimiento_linea_id is null then
    raise exception 'Esa salida no existe o no es de un requerimiento.' using errcode = 'check_violation';
  end if;
  select * into v_linea from public.requerimiento_lineas where id = v_mov.requerimiento_linea_id;
  select * into v_rq from public.requerimientos where id = v_linea.requerimiento_id;

  if not public.puede_anotar_conformidad(v_rq) then
    raise exception 'La conformidad de la salida la anota quien pidió el requerimiento %: quien lo registró, Requerimientos o el supervisor de su área.', v_rq.numero
      using errcode = 'insufficient_privilege';
  end if;
  if p_tipo not in ('NO_LLEGO', 'LLEGO_INCOMPLETO') then
    raise exception 'Elige si no llegó o si llegó incompleto.' using errcode = 'check_violation';
  end if;
  select um.codigo into v_unidad
    from public.materiales mat left join public.unidades_medida um on um.id = mat.unidad_medida_id
   where mat.id = v_mov.material_id;
  if p_tipo = 'LLEGO_INCOMPLETO'
     and (p_cantidad_recibida is null or round(p_cantidad_recibida, 3) <= 0 or round(p_cantidad_recibida, 3) >= v_mov.cantidad) then
    raise exception 'Indica cuánto llegó: más de 0 y menos de los % % que salieron. Si no llegó nada, marca «No llegó».',
      rtrim(to_char(v_mov.cantidad, 'FM999999990.999'), '.'), coalesce(v_unidad, '') using errcode = 'check_violation';
  end if;
  if char_length(v_nota) not between 10 and 500 then
    raise exception 'Cuenta qué pasó, de 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.conformidad_salidas c where c.movimiento_id = p_movimiento and c.atendido_en is null) then
    raise exception 'Esta salida ya tiene una nota abierta: Almacén la está viendo.' using errcode = 'unique_violation';
  end if;

  insert into public.conformidad_salidas
    (id, movimiento_id, requerimiento_id, requerimiento_linea_id, tipo, cantidad_recibida, nota, registrado_por)
  values (p_id, p_movimiento, v_rq.id, v_linea.id, p_tipo,
          case when p_tipo = 'LLEGO_INCOMPLETO' then p_cantidad_recibida end, v_nota, v_yo);

  perform public.fn_rq_avisar(v_rq,
    case when p_tipo = 'NO_LLEGO' then 'No llegó: ' else 'Llegó incompleto: ' end || v_rq.numero,
    left(coalesce(v_mov.numero_salida || ' · ', '') || 'insumo ' || v_linea.item || ' · '
         || case when p_tipo = 'NO_LLEGO'
                 then 'salieron ' || rtrim(to_char(v_mov.cantidad, 'FM999999990.999'), '.') || ' ' || coalesce(v_unidad, '') || ' y no llegó nada'
                 else 'llegaron ' || rtrim(to_char(p_cantidad_recibida, 'FM999999990.999'), '.') || ' de '
                      || rtrim(to_char(v_mov.cantidad, 'FM999999990.999'), '.') || ' ' || coalesce(v_unidad, '')
            end || ': ' || v_nota, 500),
    'ALMACEN');
  return p_id;
end;
$$;
revoke all on function public.anotar_conformidad_salida(uuid, uuid, text, numeric, text) from public, anon;
grant execute on function public.anotar_conformidad_salida(uuid, uuid, text, numeric, text) to authenticated;

-- ---------------------------------------------------- 6. Almacén la cierra
/**
 * Almacén cierra la nota escribiendo qué hizo. Queda quién y cuándo, y a quien
 * la anotó le llega el aviso. La misma respuesta repetida contesta lo mismo.
 */
create or replace function public.atender_conformidad_salida(p_id uuid, p_respuesta text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_nota public.conformidad_salidas%rowtype;
  v_rq   public.requerimientos%rowtype;
  v_resp text := btrim(coalesce(p_respuesta, ''));
begin
  perform public.exigir_permiso('almacen.despachar');
  select * into v_nota from public.conformidad_salidas where id = p_id for update;
  if not found then raise exception 'Esa nota no existe. Vuelve a cargar la pantalla.' using errcode = 'no_data_found'; end if;
  if v_nota.atendido_en is not null then
    if v_nota.respuesta = v_resp and v_nota.atendido_por = public.usuario_actual() then return p_id; end if;
    if v_nota.atendido_por = public.usuario_actual() then
      raise exception 'Esta nota ya quedó cerrada la primera vez que la enviaste, con lo que respondiste entonces: recarga la pantalla para ver cómo quedó.'
        using errcode = 'check_violation';
    end if;
    raise exception 'Esta nota ya la cerró otra persona de Almacén: recarga la pantalla para ver qué respondió.' using errcode = 'check_violation';
  end if;
  if char_length(v_resp) not between 10 and 500 then
    raise exception 'Escribe qué hizo Almacén, de 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;

  update public.conformidad_salidas
     set respuesta = v_resp, atendido_por = public.usuario_actual(), atendido_en = now()
   where id = p_id;

  select * into v_rq from public.requerimientos where id = v_nota.requerimiento_id;
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Almacén respondió: ' || v_rq.numero, left(v_resp, 500),
         '/requerimientos?rq=' || v_nota.requerimiento_id, 'conformidad_salidas', p_id
    from public.usuarios u
   where u.id = v_nota.registrado_por and u.activo and u.id is distinct from public.usuario_actual();
  return p_id;
end;
$$;
revoke all on function public.atender_conformidad_salida(uuid, text) from public, anon;
grant execute on function public.atender_conformidad_salida(uuid, text) to authenticated;

-- ------------------------------------------------ 7. La foto de la salida de un RQ
/**
 * Si un archivo es la foto de una salida hecha contra un RQ, y quien mira ve los
 * requerimientos: así quien pidió ve la foto sin leer el kardex. La usa la
 * política de Storage de abajo.
 */
create or replace function public.es_foto_de_salida_de_requerimiento(p_nombre text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.puede_ver_requerimientos()
     and exists (select 1 from public.movimientos_materiales m
                  where m.foto_ruta = p_nombre and m.tipo = 'SALIDA' and m.requerimiento_linea_id is not null);
$$;
revoke all on function public.es_foto_de_salida_de_requerimiento(text) from public, anon;
grant execute on function public.es_foto_de_salida_de_requerimiento(text) to authenticated;

/** La ruta de la foto de una salida de RQ, para quien ve los requerimientos; vacía si no tiene. */
create or replace function public.foto_de_salida_de_requerimiento(p_movimiento uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select m.foto_ruta from public.movimientos_materiales m
   where m.id = p_movimiento and m.tipo = 'SALIDA' and m.requerimiento_linea_id is not null
     and public.puede_ver_requerimientos();
$$;
revoke all on function public.foto_de_salida_de_requerimiento(uuid) from public, anon;
grant execute on function public.foto_de_salida_de_requerimiento(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'leer_foto_de_salida_de_requerimiento') then
    create policy leer_foto_de_salida_de_requerimiento on storage.objects
      for select to authenticated
      using (bucket_id = 'evidencias-almacen' and public.es_foto_de_salida_de_requerimiento(name));
  end if;
end $$;

-- ------------------------------------------------------------ 8. Comprobaciones
do $$
begin
  if has_function_privilege('anon', 'public.anotar_conformidad_salida(uuid, uuid, text, numeric, text)', 'execute')
     or has_function_privilege('authenticated', 'public.puede_anotar_conformidad(public.requerimientos)', 'execute') then
    raise exception 'Las funciones de la conformidad quedaron abiertas de más';
  end if;
  if has_table_privilege('authenticated', 'public.conformidad_salidas', 'insert')
     or has_table_privilege('authenticated', 'public.conformidad_salidas', 'update')
     or has_table_privilege('authenticated', 'public.conformidad_salidas', 'delete') then
    raise exception 'conformidad_salidas se puede escribir sin pasar por sus funciones';
  end if;
end $$;
