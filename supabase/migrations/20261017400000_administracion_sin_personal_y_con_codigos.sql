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
-- escribir esas tablas por su dirección. Por eso se van los tres permisos:
--
--   · usuarios.gestionar: dar de alta cuentas, cambiar puestos, estados y
--     claves (Personal). Ningún otro puesto lo tiene: queda para el
--     administrador del sistema.
--   · configuracion.editar: el calendario laboral, los feriados, la empresa, las
--     series de los documentos y los logos. Tampoco lo tiene nadie más.
--   · configuracion.ver: la pantalla de Configuración y la lectura de la
--     empresa, las series y las plantillas de la ficha técnica. Ninguna pantalla
--     de su trabajo lo necesita (las plantillas son de Diseño, que lo conserva;
--     los catálogos del taller se leen sin él).
--
-- Gana codigos_internos.ver: la lista de códigos y el detalle de cada uno
-- —avance, costeo, compras, documentos y planos—, en lectura. El costo y el
-- margen ya los veía en su Dashboard (costos.ver y cotizaciones.ver_pdf_comercial):
-- son los mismos números. Cerrar y reabrir el costeo sigue siendo de Gerencia
-- (`codigos_internos.cerrar`, que exigen `cerrar_costeo_codigo` y
-- `reabrir_costeo_codigo`).
-- =============================================================================

delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and r.codigo = 'ADMINISTRACION'
   and rp.permiso_codigo in ('usuarios.gestionar', 'configuracion.editar', 'configuracion.ver');

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'codigos_internos.ver'
  from public.roles r
 where r.codigo = 'ADMINISTRACION'
on conflict (rol_id, permiso_codigo) do nothing;
