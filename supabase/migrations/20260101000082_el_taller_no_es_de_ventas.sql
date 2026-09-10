-- =============================================================================
-- EL TALLER NO ES DE VENTAS
-- -----------------------------------------------------------------------------
-- La ejecutiva comercial no tiene nada que hacer en «Órdenes de trabajo» ni en
-- «Control de plazos»: vende, y lo que pasa en maestranza no es asunto suyo.
-- Hoy las ve porque el menú cuelga de `ordenes.ver`, y ese permiso lo tienen
-- los doce roles.
--
-- Lo obvio sería quitarle `ordenes.ver` al VENDEDOR. Se midió antes de hacerlo,
-- y rompe dos pantallas que sí son suyas:
--
--   · Garantías. La pantalla lee `garantias_resumen`, que sale de
--     `ot_entregas`, y la política de esa tabla pide `ordenes.ver`. Sin el
--     permiso, la lista de garantías le sale vacía —no da error: sale vacía,
--     que es el fallo más caro que ha tenido este proyecto—.
--   · Documentos. `ver_documentos` exige `documentos.ver` Y
--     `puede_ver_orden(orden_id)`, y esa función, para quien no es operario,
--     resuelve por `ordenes.ver`. Sin él solo vería documentos sueltos, no los
--     de ninguna orden.
--
-- Así que `ordenes.ver` se queda donde está: es la llave de lectura de datos de
-- OT que otras pantallas necesitan de refilón. Lo que se separa es otra cosa,
-- que hasta hoy no tenía nombre propio: **entrar al módulo**. Eso pasa a ser
-- `ordenes.listar`, y lo tienen todos los roles menos ventas.
-- =============================================================================

insert into public.permisos (codigo, modulo, descripcion) values
  ('ordenes.listar', 'Órdenes de trabajo',
   'Entrar al módulo de órdenes de trabajo y al control de plazos')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- Quien hoy lee órdenes entra al módulo, salvo ventas. La lista no se escribe a
-- mano: se deriva de quién tiene `ordenes.ver`, para que un rol nuevo no se
-- quede fuera por olvido y para que reaplicar esto no invente asignaciones.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'ordenes.listar'
  from public.roles r
 where r.codigo <> 'VENDEDOR'
   and exists (
     select 1 from public.roles_permisos rp
      where rp.rol_id = r.id and rp.permiso_codigo = 'ordenes.ver'
   )
on conflict do nothing;

-- Y si alguna vez se le dio, se le quita: esta migración manda sobre lo que
-- hubiera antes.
delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and rp.permiso_codigo = 'ordenes.listar'
   and r.codigo = 'VENDEDOR';
