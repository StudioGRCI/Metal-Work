-- =============================================================================
-- ADMINISTRACIÓN YA NO ADMINISTRA EL SISTEMA, Y VE LOS CÓDIGOS INTERNOS
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-19: «quita esto del usuario de administración» —la
-- sección «Administración del sistema», con Personal y Configuración— y
-- «ahora en administración falta ver lo de los códigos internos». Ese mismo día
-- aclaró que la cuenta de StudioGRCI es el administrador del sistema: las
-- cuentas, los puestos, las claves y el calendario son de ella, que entra por
-- `es_admin()` sin depender de ningún permiso.
--
-- Quitarlo del menú no bastaba: con el permiso, la base le seguía dejando leer y
-- escribir esas tablas por su dirección. Por eso los tres permisos pasan de
-- Administración al administrador del sistema:
--
--   · usuarios.gestionar: dar de alta cuentas, cambiar puestos, estados y
--     claves (Personal). Ningún otro puesto lo tiene.
--   · configuracion.editar: el calendario laboral, los feriados, la empresa, las
--     series de los documentos y los logos. Tampoco lo tiene nadie más.
--   · configuracion.ver: la pantalla de Configuración y la lectura de la
--     empresa, las series y las plantillas de la ficha técnica. Ninguna pantalla
--     de su trabajo lo necesita (las plantillas son de Diseño, que lo conserva;
--     los catálogos del taller se leen sin él).
--
-- Se mueven al puesto ADMIN en vez de borrarse: ADMIN entra por `es_admin()` y
-- no los necesita, pero así la tabla de permisos dice de quién son, y el
-- conector de producción no deja pasar un `delete`. Si ADMIN ya tuviera alguno,
-- la migración se detiene en vez de dejárselo a Administración.
--
-- Gana codigos_internos.ver: la lista de códigos y el detalle de cada uno
-- —avance, costeo, compras, documentos y planos—, en lectura. El costo y el
-- margen ya los veía en su Dashboard (costos.ver y cotizaciones.ver_pdf_comercial):
-- son los mismos números. Cerrar y reabrir el costeo sigue siendo de Gerencia
-- (`codigos_internos.cerrar`, que exigen `cerrar_costeo_codigo` y
-- `reabrir_costeo_codigo`).
-- =============================================================================

do $$
declare
  v_administracion uuid := (select id from public.roles where codigo = 'ADMINISTRACION');
  v_admin          uuid := (select id from public.roles where codigo = 'ADMIN');
begin
  if v_administracion is null or v_admin is null then
    raise exception 'Faltan los puestos ADMINISTRACION o ADMIN en la tabla de roles.';
  end if;

  update public.roles_permisos rp
     set rol_id = v_admin
   where rp.rol_id = v_administracion
     and rp.permiso_codigo in ('usuarios.gestionar', 'configuracion.editar', 'configuracion.ver')
     and not exists (select 1 from public.roles_permisos x
                      where x.rol_id = v_admin and x.permiso_codigo = rp.permiso_codigo);

  if exists (select 1 from public.roles_permisos
              where rol_id = v_administracion
                and permiso_codigo in ('usuarios.gestionar', 'configuracion.editar', 'configuracion.ver')) then
    raise exception 'Administración sigue con un permiso de Personal o Configuración que ADMIN ya tenía: quítaselo a mano en el SQL Editor.';
  end if;

  insert into public.roles_permisos (rol_id, permiso_codigo)
  values (v_administracion, 'codigos_internos.ver')
  on conflict (rol_id, permiso_codigo) do nothing;
end;
$$;
