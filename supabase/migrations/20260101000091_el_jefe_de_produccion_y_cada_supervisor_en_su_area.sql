-- =============================================================================
-- EL JEFE DE PRODUCCIÓN, Y CADA SUPERVISOR EN LO SUYO
-- -----------------------------------------------------------------------------
-- «Quiero cuatro perfiles: uno de jefe de producción, donde lleguen todos los
-- avances diarios, y usuarios para supervisor de producción, supervisor de
-- acabados y supervisor de maestranza.»
--
-- La migración 090 le dio a cada área su hoja: Producción arma la suya por
-- carrocería, Maestranza la suya por pieza solicitada, y cada una lleva su
-- propio 100 %. Lo que no tenía era dueño: cualquiera con
-- `produccion.actividades` podía armar la lista de cualquier área y reportar
-- avance en la de otro. Con un solo supervisor daba igual; con tres —Producción,
-- Acabados y Maestranza— deja de darlo: el peso que pone uno cambia el avance
-- que reporta el otro, y nadie sabría quién lo movió.
--
-- Dos piezas, entonces:
--
--   1. **Un área es de quien trabaja en ella.** La hoja de un área la escribe
--      quien pertenece a esa área (`usuarios.area_id`), y lo dice la base, no la
--      pantalla. El de Acabados no puede tocar la de Maestranza aunque llegue
--      por otra vía.
--   2. **Alguien tiene que verlas todas**, o el jefe de producción no podría
--      hacer su trabajo. Eso es un permiso —`produccion.cualquier_area`— y no un
--      rol escrito a mano en la política: así se reparte el día que haga falta
--      sin volver a tocar el RLS.
--
-- Los tres supervisores llevan el rol `SUPERVISOR` que ya existe, porque su
-- permiso es idéntico: lo que los separa es el área, que es exactamente el dato
-- que aquí empieza a mandar. El jefe de producción sí estrena rol, porque su
-- trabajo no es el de ninguno de los que había: mira las tres áreas, aprueba los
-- partes y programa, pero no ve costos —los subcontratos los ve sin monto, como
-- dejó dicho la 090—.
-- =============================================================================

-- =============================================================================
-- 1. EL ROL DEL JEFE DE PRODUCCIÓN
-- -----------------------------------------------------------------------------
-- Entre el supervisor (60) y el jefe de taller (70): manda sobre las tres áreas
-- del taller, y no sobre la entrega ni sobre la orden, que siguen siendo de
-- quien las tenía.
-- =============================================================================
insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema)
values ('JEFE_PRODUCCION', 'Jefe de producción',
        'Recibe el avance diario de todas las áreas del taller, arma sus listas, aprueba los partes y programa el trabajo.',
        65, true)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion,
      nivel = excluded.nivel;

-- =============================================================================
-- 2. EL PERMISO DE ENTRAR EN LA HOJA DE OTRA ÁREA
-- =============================================================================
insert into public.permisos (codigo, modulo, descripcion) values
  ('produccion.cualquier_area', 'Producción',
   'Armar y reportar la hoja de cualquier área, no solo la propia')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- Un permiso que no tiene ningún rol es una puerta tapiada: se reparte en la
-- misma migración que lo crea. Lo lleva quien responde por el taller entero.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'produccion.cualquier_area'
  from public.roles r
 where r.codigo in ('JEFE_PRODUCCION', 'JEFE_TALLER', 'GERENTE')
on conflict do nothing;

-- =============================================================================
-- 3. DE QUIÉN ES LA HOJA DE UN ÁREA
-- -----------------------------------------------------------------------------
-- Estas dos funciones responden al alcance y nada más: si además hace falta el
-- permiso del módulo lo exige la política, que es donde se lee de un vistazo.
-- =============================================================================
create or replace function public.puede_hoja_de_area(p_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.es_admin()
      or public.tiene_permiso('produccion.cualquier_area')
      or exists (
           select 1
             from public.usuarios u
            where u.id = public.usuario_actual()
              and u.activo
              and u.area_id = p_area_id
         );
$$;

comment on function public.puede_hoja_de_area(uuid) is
  'Si el usuario actual puede meterse en la hoja de esa área: la suya siempre; las demás solo con produccion.cualquier_area.';

-- El avance del día cuelga de la actividad, y el área es de la actividad. Sin
-- esto la política del reporte tendría que repetir el join en cada una.
create or replace function public.puede_hoja_de_actividad(p_actividad_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.ot_actividades a
     where a.id = p_actividad_id
       and public.puede_hoja_de_area(a.area_id)
  );
$$;

comment on function public.puede_hoja_de_actividad(uuid) is
  'Si el usuario actual puede reportar sobre esa actividad: depende del área a la que la actividad pertenece.';

revoke all on function public.puede_hoja_de_area(uuid)      from public, anon;
revoke all on function public.puede_hoja_de_actividad(uuid) from public, anon;
grant execute on function public.puede_hoja_de_area(uuid)      to authenticated;
grant execute on function public.puede_hoja_de_actividad(uuid) to authenticated;

-- =============================================================================
-- 4. LAS POLÍTICAS, AHORA CON ALCANCE
-- -----------------------------------------------------------------------------
-- Leer no cambia: el avance de las tres áreas se mira entero, que es el punto de
-- una hoja por orden. Lo que se cierra es escribir en el área ajena.
--
-- El permiso que exige cada política es el mismo que exige la acción de la
-- pantalla (`produccion.actividades` para armar, `produccion.registrar` para
-- reportar): si no coincidieran, el UPDATE afectaría cero filas sin error y la
-- pantalla diría «listo» sin haber hecho nada.
-- =============================================================================
drop policy if exists crear_ot_actividades on public.ot_actividades;
create policy crear_ot_actividades on public.ot_actividades
  for insert to authenticated
  with check (
    public.es_admin()
    or (public.tiene_permiso('produccion.actividades') and public.puede_hoja_de_area(area_id))
  );

-- `using` y `with check` a la vez, y a propósito: sin el segundo, el supervisor
-- de Acabados podría mudar su actividad a Maestranza de un update.
drop policy if exists editar_ot_actividades on public.ot_actividades;
create policy editar_ot_actividades on public.ot_actividades
  for update to authenticated
  using (
    public.es_admin()
    or (public.tiene_permiso('produccion.actividades') and public.puede_hoja_de_area(area_id))
  )
  with check (
    public.es_admin()
    or (public.tiene_permiso('produccion.actividades') and public.puede_hoja_de_area(area_id))
  );

drop policy if exists borrar_ot_actividades on public.ot_actividades;
create policy borrar_ot_actividades on public.ot_actividades
  for delete to authenticated
  using (
    public.es_admin()
    or (public.tiene_permiso('produccion.actividades') and public.puede_hoja_de_area(area_id))
  );

drop policy if exists crear_ot_actividad_avances on public.ot_actividad_avances;
create policy crear_ot_actividad_avances on public.ot_actividad_avances
  for insert to authenticated
  with check (
    public.es_admin()
    or (public.tiene_permiso('produccion.registrar') and public.puede_hoja_de_actividad(actividad_id))
  );

drop policy if exists editar_ot_actividad_avances on public.ot_actividad_avances;
create policy editar_ot_actividad_avances on public.ot_actividad_avances
  for update to authenticated
  using (
    public.es_admin()
    or (public.tiene_permiso('produccion.registrar') and public.puede_hoja_de_actividad(actividad_id))
  )
  with check (
    public.es_admin()
    or (public.tiene_permiso('produccion.registrar') and public.puede_hoja_de_actividad(actividad_id))
  );

-- =============================================================================
-- 5. QUÉ PUEDE EL JEFE DE PRODUCCIÓN
-- -----------------------------------------------------------------------------
-- Lo del supervisor, más las tres áreas, más programar y ver los indicadores.
-- Sin `costos.ver` a propósito: lo que necesita del subcontrato es qué está
-- esperando del tercero, no lo que cuesta.
-- =============================================================================
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  join (values
    ('almacen.ver'),               -- si hay material para lo que va a mandar
    ('calidad.ver'),               -- las observaciones que le devuelven trabajo
    ('documentos.subir'),
    ('documentos.ver'),
    ('garantias.ver'),
    ('ordenes.cambiar_estado'),    -- iniciar, pausar y reanudar lo del taller
    ('ordenes.listar'),
    ('ordenes.ver'),
    ('produccion.actividades'),    -- armar la hoja de cualquiera de sus áreas
    ('produccion.aprobar_parte'),
    ('produccion.cualquier_area'),
    ('produccion.planificar'),     -- fechas y personal: reparte el trabajo
    ('produccion.registrar'),      -- y corrige el reporte del día de sus áreas
    ('produccion.ver'),
    ('reportes.ver'),
    ('requerimientos.crear'),
    ('requerimientos.ver')
  ) as p(codigo) on true
 where r.codigo = 'JEFE_PRODUCCION'
   and exists (select 1 from public.permisos x where x.codigo = p.codigo)
on conflict do nothing;

-- =============================================================================
-- 6. COMPROBACIONES
-- =============================================================================

-- Que el rol no haya nacido mudo: un rol sin permisos entra y no ve nada.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.roles_permisos rp
    join public.roles r on r.id = rp.rol_id
   where r.codigo = 'JEFE_PRODUCCION';

  if v_n < 17 then
    raise exception 'El jefe de producción quedó con % permisos de 17: revisar qué código del catálogo cambió de nombre.', v_n;
  end if;
end $$;

-- Que el permiso nuevo lo tenga alguien: si la política lo exige y ningún rol lo
-- lleva, la puerta queda tapiada y solo el administrador pasa.
do $$
begin
  if not exists (select 1 from public.roles_permisos
                  where permiso_codigo = 'produccion.cualquier_area') then
    raise exception 'produccion.cualquier_area no lo tiene ningún rol: puerta tapiada.';
  end if;
end $$;

-- Y quién queda mudo por no tener área. No corta la migración —es un dato de
-- personal, no un error del esquema— pero se dice en voz alta: desde hoy, quien
-- reporta avance sin área asignada escribe cero filas sin error.
do $$
declare v_mudos text;
begin
  select string_agg(u.correo, ', ' order by u.correo) into v_mudos
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id
   where u.activo
     and u.area_id is null
     and rp.permiso_codigo in ('produccion.registrar', 'produccion.actividades')
     and not exists (select 1 from public.roles_permisos q
                      where q.rol_id = u.rol_id
                        and q.permiso_codigo = 'produccion.cualquier_area');

  if v_mudos is not null then
    raise warning 'Estas cuentas reportan producción y no tienen área: %. Asignarles una desde Personal o no podrán escribir.', v_mudos;
  end if;
end $$;
