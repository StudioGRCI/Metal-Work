-- =============================================================================
-- LOS SUBCONTRATOS VAN A PRODUCCIÓN O A ACABADOS, Y ESAS ÁREAS LOS VEN
-- -----------------------------------------------------------------------------
-- Gerencia lo pidió el 2026-10-15: «ahora Producción y Acabados tienen que ver
-- los subcontratos; al crear un subcontrato tiene que indicar para quién irá,
-- si para Producción o para el área de Acabados».
--
-- El subcontratista trabaja dentro del taller, con la gente de un área: el
-- supervisor de esa área es quien lo ve llegar, le dice qué hacer y sabe si
-- terminó. Hasta hoy solo lo veían Administración, Tesorería, Gerencia y
-- Contabilidad. Así queda:
--
--   * ADMINISTRACIÓN, al registrar un subcontrato, elige para qué ÁREA va:
--     Producción o Acabados. Es obligatoria en los nuevos. Los que ya existían
--     quedan sin área, y Administración se la pone al corregirlos. Cambiarla
--     después también se hace al corregir.
--   * El SUPERVISOR de esa área recibe el aviso y ve sus subcontratos en
--     «Supervisión › Subcontratos» (/subcontratos/area), por código interno:
--     quién hace el trabajo, qué trabajo es, el estado y sus recibos por
--     honorarios con la fecha y si ya se pagaron. SIN MONTOS: lo pactado, el
--     bruto, la retención y lo pagado son de Administración, Tesorería,
--     Gerencia y Contabilidad. Por eso el supervisor no lee las tablas: lee una
--     función que solo devuelve lo suyo y sin un sol (`subcontratos_de_mi_area`).
--   * El supervisor de Maestranza no recibe subcontratos (no es una de las dos
--     áreas), y el jefe de producción, como en los planos, ve los de las dos.
--
-- Las firmas viejas de registrar y corregir (las que llama la pantalla de antes)
-- siguen existiendo porque el conector de producción no deja quitar funciones:
-- registrar sin área se niega con un mensaje que dice qué falta, y corregir
-- sin área conserva la que el subcontrato ya tenía.
-- =============================================================================

-- 1. El permiso del supervisor ------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('subcontratos.area', 'Producción',
   'Ver, sin montos, los subcontratos que Administración registró para su área: quién hace el trabajo, para qué código interno, el estado y sus recibos por honorarios')
on conflict (codigo) do nothing;

-- Los mismos que ven los planos de su área (codigos_internos.area).
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'subcontratos.area' from public.roles r
 where r.codigo in ('SUPERVISOR', 'JEFE_PRODUCCION')
on conflict do nothing;

-- 2. El área del subcontrato -----------------------------------------------------------------
alter table public.subcontratos
  add column if not exists area_id uuid references public.areas(id) on delete restrict;
comment on column public.subcontratos.area_id is
  'Para qué área va el trabajo: Producción (PRD) o Acabados (ACB). Su supervisor lo ve sin montos. Obligatoria desde la migración 20261017100000; los anteriores pueden no tenerla hasta que Administración los corrija.';

-- Que sea Producción o Acabados lo exigen las funciones de abajo: la tabla se
-- escribe solo por ellas.

-- (b): la pantalla del supervisor filtra por esta columna (los de su área);
-- ningún índice de la tabla empieza por ella.
create index if not exists ix_subcontratos_area on public.subcontratos (area_id);

-- 3. Las dos áreas que reciben subcontratos ------------------------------------------------
-- De la pantalla llega el código del área (PRD o ACB); aquí se vuelve su id.
create or replace function public.subcontrato_area(p_area text)
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if p_area is null or upper(btrim(p_area)) not in ('PRD', 'ACB') then
    raise exception 'Elige para qué área va el subcontrato: Producción o Acabados.' using errcode = 'check_violation';
  end if;
  select a.id into v_id from public.areas a where a.codigo = upper(btrim(p_area));
  if v_id is null then
    raise exception 'El área % no está en el catálogo de áreas. Avisa a Sistemas.', upper(btrim(p_area));
  end if;
  return v_id;
end;
$$;
revoke all on function public.subcontrato_area(text) from public, anon, authenticated;

-- 4. El aviso al supervisor del área ---------------------------------------------------------
-- A quien ve los subcontratos de esa área (subcontratos.area), menos a quien lo hizo.
create or replace function public.avisar_area_del_subcontrato(p_area uuid, p_titulo text, p_cuerpo text, p_subcontrato uuid)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, p_titulo, p_cuerpo, '/subcontratos/area', 'subcontratos', p_subcontrato
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'subcontratos.area'
   where u.activo and u.id is distinct from public.usuario_actual()
     and (u.area_id = p_area
          or exists (select 1 from public.roles_permisos x where x.rol_id = u.rol_id and x.permiso_codigo = 'produccion.cualquier_area'));
$$;
revoke all on function public.avisar_area_del_subcontrato(uuid, text, text, uuid) from public, anon, authenticated;

-- 5. Registrar, ahora con el área ---------------------------------------------------------------
create or replace function public.registrar_subcontrato(
  p_id uuid, p_subcontratista_id uuid, p_codigo_interno text, p_descripcion text, p_moneda text, p_monto numeric,
  p_fecha_inicio date, p_fecha_fin date, p_area text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_sub     public.subcontratistas%rowtype;
  v_actual  public.subcontratos%rowtype;
  v_codigo  text := public.normalizar_codigo_interno(p_codigo_interno);
  v_area    uuid;
  v_numero  text;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del subcontrato.' using errcode = 'check_violation'; end if;
  perform public.subcontrato_datos_validos(p_codigo_interno, p_descripcion, p_monto, p_fecha_inicio, p_fecha_fin);
  if p_moneda is null or p_moneda not in ('PEN', 'USD') then raise exception 'Elige la moneda de lo pactado.' using errcode = 'check_violation'; end if;
  v_area := public.subcontrato_area(p_area);
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.subcontratos where id = p_id;
  if found then
    -- El reintento del mismo formulario no registra otro.
    if v_actual.creado_por = public.usuario_actual() and v_actual.subcontratista_id = p_subcontratista_id
       and v_actual.monto = p_monto and v_actual.moneda = p_moneda and v_actual.area_id is not distinct from v_area then
      return p_id;
    end if;
    raise exception 'Este subcontrato ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;
  select * into v_sub from public.subcontratistas where id = p_subcontratista_id;
  if not found then raise exception 'Elige un subcontratista del padrón.' using errcode = 'check_violation'; end if;
  if not v_sub.activo then raise exception '% está dado de baja en el padrón: reactívalo o elige otro.', v_sub.nombre using errcode = 'check_violation'; end if;
  v_numero := public.siguiente_correlativo('SUBCONTRATO', '001', null);
  insert into public.subcontratos (id, numero, subcontratista_id, codigo_interno, descripcion, moneda, monto, fecha_inicio, fecha_fin, area_id)
  values (p_id, v_numero, p_subcontratista_id, v_codigo, btrim(p_descripcion), p_moneda, p_monto, p_fecha_inicio, p_fecha_fin, v_area);
  perform public.avisar_area_del_subcontrato(v_area,
    'Subcontrato para tu área: ' || v_numero,
    format('%s hará «%s» en %s.', v_sub.nombre, left(btrim(p_descripcion), 140), v_codigo),
    p_id);
  return p_id;
end; $$;
revoke all on function public.registrar_subcontrato(uuid, uuid, text, text, text, numeric, date, date, text) from public, anon;
grant execute on function public.registrar_subcontrato(uuid, uuid, text, text, text, numeric, date, date, text) to authenticated;

-- La firma de antes, sin área: la pantalla vieja la llama hasta que se despliegue
-- la nueva. Ya no registra; dice qué falta.
create or replace function public.registrar_subcontrato(
  p_id uuid, p_subcontratista_id uuid, p_codigo_interno text, p_descripcion text, p_moneda text, p_monto numeric,
  p_fecha_inicio date, p_fecha_fin date
) returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  raise exception 'Elige para qué área va el subcontrato: Producción o Acabados. Si el formulario no te lo pide, recarga la página.'
    using errcode = 'check_violation';
end; $$;
revoke all on function public.registrar_subcontrato(uuid, uuid, text, text, text, numeric, date, date) from public, anon;
grant execute on function public.registrar_subcontrato(uuid, uuid, text, text, text, numeric, date, date) to authenticated;

-- 6. Corregir, ahora con el área ---------------------------------------------------------------
-- Con área (PRD o ACB) se pone o se cambia. Sin área (null) se queda como está:
-- así se corrige uno viejo sin obligarlo, pero a uno que ya tiene área no se
-- le quita.
create or replace function public.corregir_subcontrato(
  p_id uuid, p_codigo_interno text, p_descripcion text, p_monto numeric, p_fecha_inicio date, p_fecha_fin date, p_area text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_sc    public.subcontratos%rowtype;
  v_area  uuid;
  v_nombre text;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  perform public.subcontrato_datos_validos(p_codigo_interno, p_descripcion, p_monto, p_fecha_inicio, p_fecha_fin);
  select * into v_sc from public.subcontratos where id = p_id for update;
  if not found then raise exception 'Ese subcontrato no existe.' using errcode = 'check_violation'; end if;
  if v_sc.estado <> 'VIGENTE' then
    raise exception 'El subcontrato % está %: ya no se corrige.', v_sc.numero,
      case when v_sc.estado = 'ANULADO' then 'anulado' else 'terminado (reábrelo si hace falta)' end using errcode = 'check_violation';
  end if;
  v_area := case when nullif(btrim(coalesce(p_area, '')), '') is null then v_sc.area_id else public.subcontrato_area(p_area) end;
  update public.subcontratos
     set codigo_interno = public.normalizar_codigo_interno(p_codigo_interno), descripcion = btrim(p_descripcion),
         monto = p_monto, fecha_inicio = p_fecha_inicio, fecha_fin = p_fecha_fin, area_id = v_area
   where id = p_id;
  -- La otra área se entera de que ahora le toca.
  if v_area is not null and v_area is distinct from v_sc.area_id then
    select s.nombre into v_nombre from public.subcontratistas s where s.id = v_sc.subcontratista_id;
    perform public.avisar_area_del_subcontrato(v_area,
      'Subcontrato para tu área: ' || v_sc.numero,
      format('%s hará «%s» en %s.', v_nombre, left(btrim(p_descripcion), 140), public.normalizar_codigo_interno(p_codigo_interno)),
      p_id);
  end if;
  return p_id;
end;
$$;
revoke all on function public.corregir_subcontrato(uuid, text, text, numeric, date, date, text) from public, anon;
grant execute on function public.corregir_subcontrato(uuid, text, text, numeric, date, date, text) to authenticated;

-- La firma de antes: corrige igual y deja el área como estaba.
create or replace function public.corregir_subcontrato(
  p_id uuid, p_codigo_interno text, p_descripcion text, p_monto numeric, p_fecha_inicio date, p_fecha_fin date
) returns uuid language sql security definer set search_path to 'public' as $$
  select public.corregir_subcontrato(p_id, p_codigo_interno, p_descripcion, p_monto, p_fecha_inicio, p_fecha_fin, null::text);
$$;
revoke all on function public.corregir_subcontrato(uuid, text, text, numeric, date, date) from public, anon;
grant execute on function public.corregir_subcontrato(uuid, text, text, numeric, date, date) to authenticated;

-- 7. Lo que ve el supervisor ---------------------------------------------------------------------
-- Los subcontratos de su área (de las dos, para quien tiene produccion.cualquier_area),
-- sin los anulados y SIN MONTOS: ni lo pactado, ni el bruto, ni la retención,
-- ni lo pagado. De cada recibo vigente, el número, la fecha, qué cubre y si ya
-- se pagó.
create or replace function public.subcontratos_de_mi_area()
returns table (
  id uuid, numero text, codigo_interno text, descripcion text, estado text,
  area_codigo text, area_nombre text, subcontratista text,
  fecha_inicio date, fecha_fin date, creado_en timestamptz, terminado_en timestamptz,
  recibos jsonb
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('subcontratos.area');
  return query
  with mias as (
    select a.id, a.codigo, a.nombre from public.areas a
     where a.codigo in ('PRD', 'ACB') and public.puede_hoja_de_area(a.id)
  )
  select s.id, s.numero, s.codigo_interno, s.descripcion, s.estado,
         m.codigo, m.nombre, sc.nombre,
         s.fecha_inicio, s.fecha_fin, s.creado_en, s.terminado_en,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'numero', r.numero, 'fecha_emision', r.fecha_emision, 'concepto', r.concepto,
                    'pagado', exists (select 1 from public.pagos_recibo_honorarios p where p.recibo_id = r.id and p.anulado_en is null))
                  order by r.fecha_emision, r.creado_en)
             from public.recibos_honorarios r
            where r.subcontrato_id = s.id and r.anulado_en is null), '[]'::jsonb)
    from public.subcontratos s
    join mias m on m.id = s.area_id
    join public.subcontratistas sc on sc.id = s.subcontratista_id
   where s.estado <> 'ANULADO'
   order by s.codigo_interno, s.creado_en desc;
end;
$$;
revoke all on function public.subcontratos_de_mi_area() from public, anon;
grant execute on function public.subcontratos_de_mi_area() to authenticated;
comment on function public.subcontratos_de_mi_area() is
  'Los subcontratos que Administración registró para el área de quien mira (Producción o Acabados), sin anulados y sin montos, con sus recibos vigentes y si están pagados. Exige subcontratos.area.';
