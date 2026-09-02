-- =============================================================================
-- LAS PUERTAS TAPIADAS
-- -----------------------------------------------------------------------------
-- Un permiso que no tiene ningún rol es una puerta tapiada: la política está
-- bien escrita, la tabla está llena, y todo el mundo salvo el administrador ve
-- que el botón no hace nada. Ya pasó una vez con `configuracion.ver` y once
-- catálogos, y la regla quedó escrita en la skill `seguridad`. Volvió a pasar,
-- esta vez con cuatro permisos que se crearon y no se repartieron:
--
--   configuracion.editar   lo exigen 35 políticas y una función. Sin él, nadie
--                          fuera del administrador puede tocar un catálogo, una
--                          serie, un feriado ni el tipo de cambio.
--   usuarios.gestionar     lo exigen 2 políticas y las cuatro funciones de
--                          personal: dar de alta a alguien, cambiarle la clave
--                          o darlo de baja no lo puede hacer nadie más.
--   documentos.eliminar    lo exige la política de borrado de documentos; sin
--                          él, el «deshacer» de una subida fallida no borra
--                          nada y devuelve éxito.
--   usuarios.ver           no lo exige nadie: no se reparte, se retira.
--
-- Los tres primeros van a Gerencia, que es el rol más alto que usa gente
-- (nivel 90; el administrador entra por `es_admin()` y no pasa por acá). Si la
-- empresa prefiere otra mano, se cambia esta asignación y nada más.
-- Volver a correr esto deja lo mismo.
-- =============================================================================

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  join public.permisos p on p.codigo in ('configuracion.editar', 'usuarios.gestionar', 'documentos.eliminar')
 where r.codigo = 'GERENTE'
    on conflict do nothing;

-- Y con él, el de ver: `configuracion.ver` lo tenía solo Diseño, que hoy no
-- tiene a nadie activo. Sin ver no se edita, y no por una regla nuestra sino
-- por cómo funciona Postgres: un `update … where id = …` tiene que leer esa
-- columna, y leer hace que la política de lectura también se evalúe. Sin
-- `configuracion.ver` el UPDATE afecta cero filas y no da error —el fallo de
-- siempre—, así que dar `configuracion.editar` a secas no habría servido de
-- nada. Comprobado con el rol de Gerencia: 0 filas con el `where`, 1 sin él.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'configuracion.ver'
  from public.roles r
 where r.codigo = 'GERENTE'
    on conflict do nothing;

-- `usuarios.ver` no lo exige ninguna política ni ninguna función: se queda en
-- el catálogo sin repartir a propósito, y este comentario es para que la
-- próxima revisión no lo vuelva a marcar como olvido. Quien necesita ver a la
-- gente del taller entra por `es_usuario_activo()`, que es lo que pide la
-- política de `usuarios`.

-- Comprobación: después de esto no debe quedar ningún permiso exigido por una
-- política o una función que ningún rol tenga.
do $$
declare v_huerfanos text;
begin
  select string_agg(p.codigo, ', ' order by p.codigo) into v_huerfanos
    from public.permisos p
   where not exists (select 1 from public.roles_permisos rp where rp.permiso_codigo = p.codigo)
     and (exists (select 1 from pg_policies pol
                   where pol.schemaname = 'public'
                     and (coalesce(pol.qual, '') || coalesce(pol.with_check, ''))
                         like '%''' || p.codigo || '''%')
       or exists (select 1 from pg_proc pr
                   where pr.pronamespace = 'public'::regnamespace
                     and position('''' || p.codigo || '''' in pr.prosrc) > 0));

  if v_huerfanos is not null then
    raise exception 'Quedan puertas tapiadas: % los exige la base y no los tiene ningún rol', v_huerfanos;
  end if;
end $$;

-- Y que nadie quede con permiso de editar algo que no puede ver: es el mismo
-- fallo mudo, un rol a la vez.
do $$
declare v_cojos text;
begin
  select string_agg(format('%s sin %s', r.codigo, replace(rp.permiso_codigo, '.editar', '.ver')), ', ')
    into v_cojos
    from public.roles_permisos rp
    join public.roles r on r.id = rp.rol_id
   where rp.permiso_codigo like '%.editar'
     and exists (select 1 from public.permisos v where v.codigo = replace(rp.permiso_codigo, '.editar', '.ver'))
     and not exists (select 1 from public.roles_permisos q
                      where q.rol_id = rp.rol_id
                        and q.permiso_codigo = replace(rp.permiso_codigo, '.editar', '.ver'));

  if v_cojos is not null then
    raise exception 'Hay roles que editan lo que no pueden ver: %', v_cojos;
  end if;
end $$;
