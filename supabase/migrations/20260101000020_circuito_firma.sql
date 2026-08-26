-- =============================================================================
-- EL CIRCUITO DE LA FIRMA
-- -----------------------------------------------------------------------------
-- El esquema ya sabía guardar la cadena de firmas de un documento. Lo que le
-- faltaba era lo importante: que la firma sea de quien firma.
--
-- Tal como estaba, cualquiera con el permiso de aprobar podía marcar como
-- firmada una fila que decía el nombre de otro. Un plano aprobado así no vale
-- nada, y el acta que lo respalda tampoco. Acá se cierra eso: se pide la firma
-- por una función, se firma por otra, y la política de la tabla ya no deja que
-- nadie decida en lugar de otro.
-- =============================================================================

-- --------------------------------------------------------------- pedir firmas
-- Arma la cadena de una vez: el primero de la lista firma primero. Volver a
-- llamarla reemplaza la cadena entera mientras nadie haya firmado todavía; si
-- ya hay una decisión tomada, no se toca nada.
create or replace function public.solicitar_firmas(
  p_documento    uuid,
  p_aprobadores  uuid[]
)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_creadas int := 0;
  v_version int;
begin
  if not (public.es_admin()
          or public.tiene_permiso('documentos.subir')
          or public.tiene_permiso('documentos.aprobar')) then
    raise exception 'No tiene permiso para pedir la firma de un documento'
      using errcode = 'insufficient_privilege';
  end if;

  select version_actual into v_version from public.documentos where id = p_documento;

  if v_version is null then
    raise exception 'No existe ese documento';
  end if;
  if v_version = 0 then
    raise exception 'Primero hay que adjuntar el archivo: no se pide la firma de algo que no está'
      using errcode = 'check_violation';
  end if;
  if p_aprobadores is null or array_length(p_aprobadores, 1) is null then
    raise exception 'Hay que decir quién firma' using errcode = 'check_violation';
  end if;
  if array_length(p_aprobadores, 1) > 6 then
    raise exception 'Seis firmas es el máximo razonable para un documento'
      using errcode = 'check_violation';
  end if;

  -- Nadie rehace una cadena en la que ya hay una decisión tomada: eso borraría
  -- una firma, que es justo lo que no puede pasar.
  if exists (
    select 1 from public.aprobaciones
     where documento_id = p_documento and estado <> 'PENDIENTE'
  ) then
    raise exception 'Este documento ya tiene firmas registradas; anúlalo y sube una versión nueva'
      using errcode = 'check_violation';
  end if;

  delete from public.aprobaciones where documento_id = p_documento;

  insert into public.aprobaciones (documento_id, aprobador_id, orden_firma, solicitado_por)
  select p_documento, a.id, a.orden, public.usuario_actual()
    from unnest(p_aprobadores) with ordinality as a(id, orden);

  get diagnostics v_creadas = row_count;
  return v_creadas;
end;
$$;

comment on function public.solicitar_firmas(uuid, uuid[]) is
  'Arma la cadena de firmas de un documento en el orden de la lista. Falla si ya hay alguna firma dada.';

-- -------------------------------------------------------------------- firmar
-- La firma es personal: solo el aprobador designado la da. La administración
-- puede destrabar un circuito, y queda en la auditoría quién lo hizo.
create or replace function public.firmar_documento(
  p_aprobacion uuid,
  p_estado     text,
  p_comentario text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_aprobador uuid;
  v_estado    public.estado_aprobacion;
begin
  if p_estado not in ('APROBADO', 'OBSERVADO', 'RECHAZADO') then
    raise exception 'Una firma solo puede aprobar, observar o rechazar'
      using errcode = 'check_violation';
  end if;
  v_estado := p_estado::public.estado_aprobacion;

  select aprobador_id into v_aprobador from public.aprobaciones where id = p_aprobacion;

  if v_aprobador is null then
    raise exception 'No existe esa firma pendiente';
  end if;

  if v_aprobador <> public.usuario_actual() and not public.es_admin() then
    raise exception 'Esta firma le corresponde a otra persona'
      using errcode = 'insufficient_privilege';
  end if;

  update public.aprobaciones
     set estado     = v_estado,
         comentario = nullif(btrim(coalesce(p_comentario, '')), '')
   where id = p_aprobacion;
end;
$$;

comment on function public.firmar_documento(uuid, text, text) is
  'Registra la decisión del aprobador designado. Nadie firma en lugar de otro; el trigger sigue exigiendo el orden de la cadena.';

revoke all on function public.solicitar_firmas(uuid, uuid[])       from public, anon;
revoke all on function public.firmar_documento(uuid, text, text)   from public, anon;
grant execute on function public.solicitar_firmas(uuid, uuid[])     to authenticated;
grant execute on function public.firmar_documento(uuid, text, text) to authenticated;

-- ------------------------------------------------- la firma no cambia de dueño
-- Sin esto se podía pedir la firma a nombre de uno y, antes de que firmara,
-- cambiarle el nombre a la fila.
create or replace function public.fn_aprobacion_dueno()
returns trigger
language plpgsql
as $$
begin
  if new.aprobador_id is distinct from old.aprobador_id and old.estado <> 'PENDIENTE' then
    raise exception 'Una firma ya dada no cambia de responsable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aprobacion_dueno on public.aprobaciones;
create trigger trg_aprobacion_dueno
  before update on public.aprobaciones
  for each row execute function public.fn_aprobacion_dueno();

-- ---------------------------------------------------------------- la política
-- La escritura directa sobre la tabla queda solo para armar y desarmar la
-- cadena; la decisión entra por firmar_documento(), que corre como definidora.
drop policy if exists crear_aprobaciones  on public.aprobaciones;
drop policy if exists editar_aprobaciones on public.aprobaciones;
drop policy if exists borrar_aprobaciones on public.aprobaciones;

create policy crear_aprobaciones on public.aprobaciones
  for insert to authenticated
  with check (
    public.es_admin()
    or public.tiene_permiso('documentos.subir')
    or public.tiene_permiso('documentos.aprobar')
  );

-- Nadie decide en lugar de otro, ni siquiera teniendo el permiso de aprobar.
create policy editar_aprobaciones on public.aprobaciones
  for update to authenticated
  using (public.es_admin() or aprobador_id = public.usuario_actual())
  with check (public.es_admin() or aprobador_id = public.usuario_actual());

create policy borrar_aprobaciones on public.aprobaciones
  for delete to authenticated
  using (
    public.es_admin()
    or (estado = 'PENDIENTE' and solicitado_por = public.usuario_actual())
  );

-- ----------------------------------------------------- la bandeja de firmas
-- Lo que espera mi firma, con lo suficiente para decidir sin abrir otra
-- pantalla: de qué orden es, qué versión se está firmando y si ya me toca.
create or replace view public.mis_firmas_pendientes as
select
  a.id                        as aprobacion_id,
  a.documento_id,
  a.orden_firma,
  a.solicitado_en,
  d.titulo,
  d.descripcion,
  d.numero_externo,
  d.fecha_documento,
  d.version_actual,
  d.orden_id,
  o.numero                    as orden_numero,
  c.razon_social              as cliente,
  u.placa,
  t.codigo                    as tipo_codigo,
  t.nombre                    as tipo_nombre,
  t.categoria                 as tipo_categoria,
  (s.nombres || ' ' || s.apellidos) as solicitado_por_nombre,
  not exists (
    select 1 from public.aprobaciones p
     where p.documento_id = a.documento_id
       and p.orden_firma  < a.orden_firma
       and p.estado = 'PENDIENTE'
  )                           as le_toca,
  (select count(*) from public.aprobaciones p where p.documento_id = a.documento_id) as firmas_total
from public.aprobaciones a
join public.documentos d       on d.id = a.documento_id
join public.tipos_documento t  on t.id = d.tipo_documento_id
left join public.ordenes_trabajo o on o.id = d.orden_id
left join public.clientes c    on c.id = o.cliente_id
left join public.unidades u    on u.id = o.unidad_id
left join public.usuarios s    on s.id = a.solicitado_por
where a.estado = 'PENDIENTE'
  and d.estado = 'VIGENTE'
  and a.aprobador_id = public.usuario_actual();

comment on view public.mis_firmas_pendientes is
  'La bandeja de firmas del usuario que consulta: qué documentos esperan su decisión y cuáles ya le tocan.';

-- ------------------------------------------------------ la cadena de un documento
create or replace view public.documento_firmas as
select
  a.id            as aprobacion_id,
  a.documento_id,
  a.orden_firma,
  a.estado,
  a.comentario,
  a.fecha,
  a.version_aprobada,
  a.solicitado_en,
  a.aprobador_id,
  (p.nombres || ' ' || p.apellidos) as aprobador,
  p.cargo         as aprobador_cargo,
  (s.nombres || ' ' || s.apellidos) as solicitado_por_nombre,
  not exists (
    select 1 from public.aprobaciones q
     where q.documento_id = a.documento_id
       and q.orden_firma  < a.orden_firma
       and q.estado = 'PENDIENTE'
  )               as le_toca
from public.aprobaciones a
join public.usuarios p      on p.id = a.aprobador_id
left join public.usuarios s on s.id = a.solicitado_por;

comment on view public.documento_firmas is
  'La cadena de firmas de un documento con el nombre y el cargo de cada firmante.';

alter view public.mis_firmas_pendientes set (security_invoker = on);
alter view public.documento_firmas      set (security_invoker = on);
grant select on public.mis_firmas_pendientes, public.documento_firmas to authenticated;
