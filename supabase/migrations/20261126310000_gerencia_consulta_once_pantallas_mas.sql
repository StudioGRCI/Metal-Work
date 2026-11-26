-- Gerencia General consulta, sin registrar, las once pantallas que todavía no
-- le abrían.
--
-- StudioGRCI, 2026-11-25: «en gerencia general verdad quieren ver todo todas
-- las pantallas aunque sean diferentes en slide bar». La entrega 1 (PR 190) le
-- puso en la barra, por área, las 36 que su permiso ya le abría. Esta es la
-- entrega 2 del plan aprobado ese día: las que faltaban, en solo lectura.
--
-- Cuatro le abren con permisos de lectura que ya existían y no escriben nada:
--   * Seguimiento por código y Materiales por código (`codigos_internos.seguimiento`,
--     el de Supervisión general y Almacén: lee planos, materiales y etapas).
--   * Gasto por código interno (`codigos_internos.gasto`, el de Requerimientos).
--   * Carrocerías con su ficha técnica (`configuracion.ver`, el de Diseño). Con
--     él, Configuración le abre por su dirección y en lectura, como a Diseño
--     (decisión 3 del plan); no va en su menú.
--
-- Siete necesitan su permiso de lectura, porque el que las abre también
-- registra. Cada uno abre su pantalla sin un solo botón de escribir, y no le da
-- globos ni avisos a nadie (son pantallas de otro puesto: el globo y el aviso
-- siguen el permiso de trabajo):
--   * Informe semanal de Diseño (`diseno.ver_informes`). La pantalla la abrían
--     Diseño, su colaborador y Supervisión general; Gerencia la dejó de ver el
--     2026-10-20 (migración 20261020206000) junto con lo que era de otro puesto.
--   * Materiales, el catálogo de Diseño (`diseno.ver_materiales`). La tabla ya
--     la lee toda cuenta activa: solo cambia la pantalla.
--   * Archivos DXF (`diseno.ver_dxf`): los descarga, como Maestranza.
--   * Insumos por autorizar (`requerimientos.ver_metrado`): lo que espera el
--     visto de Diseño. El metrado ya lo leía por `requerimientos.ver`.
--   * Gestión de compras (`compras.ver_gestion`): lo que Logística programa y el
--     conductor recoge, con las fotos y lo que no se pudo recoger. Las guías ya
--     las leía por `adquisiciones.ver`.
--   * Caja diaria (`tesoreria.ver_caja`): las cuentas, sus movimientos, sus
--     cierres y la captura del saldo con que se abrió cada una.
--   * Tipo de cambio (`tesoreria.ver_tipo_cambio`). La tabla ya la lee toda
--     cuenta activa: solo cambia la pantalla.
--
-- Y deja de registrar proveedores: StudioGRCI respondió «ok» el 2026-11-26 a
-- «En Proveedores, Gerencia todavía puede registrar. ¿Se lo quito en la entrega
-- 2?». Se le quita `proveedores.editar`, que traía de cuando hacía de todo;
-- sigue viendo el padrón (`proveedores.ver`) y sus cuentas
-- (`proveedores.ver_cuentas`). Es lo mismo que decidió el 2026-10-20 para el
-- almacén y las compras: «Quitar, menos anular».
--
-- No cambia: lo reservado del personal (planillas, costeo por código, pagos de
-- la oficina, DNI, evaluación de desempeño) sigue siendo de RR. HH. y Diseño
-- (decisión 2), y Personal y Configuración no van en su menú (decisión 3).
--
-- Idempotente: los permisos y sus asignaciones van con `on conflict`, las
-- políticas con `alter policy` y las funciones con `create or replace`, cada
-- una con el texto que tiene en producción el 2026-11-26 más el permiso nuevo.

-- 1. Los permisos de lectura -------------------------------------------------

insert into public.permisos (codigo, modulo, descripcion) values
  ('diseno.ver_informes', 'Diseño', 'Consultar, sin llenar ni aprobar, el informe semanal de Diseño e Ingeniería'),
  ('diseno.ver_materiales', 'Diseño', 'Consultar, sin crear ni corregir, el catálogo de materiales de Diseño'),
  ('diseno.ver_dxf', 'Diseño', 'Consultar y descargar, sin subir ni quitar, los DXF de cada código interno'),
  ('requerimientos.ver_metrado', 'Requerimientos', 'Consultar, sin autorizar, los insumos de un requerimiento que esperan el visto de Diseño'),
  ('compras.ver_gestion', 'Compras', 'Consultar, sin programar, la gestión de compras: lo que recoge el conductor, sus fotos y lo que no se pudo recoger'),
  ('tesoreria.ver_caja', 'Tesorería', 'Consultar, sin registrar ni cerrar, la caja diaria: cada cuenta, sus movimientos y sus cierres'),
  ('tesoreria.ver_tipo_cambio', 'Contabilidad', 'Consultar, sin registrar, el tipo de cambio de cada día')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
 cross join (values ('diseno.ver_informes'), ('diseno.ver_materiales'), ('diseno.ver_dxf'), ('requerimientos.ver_metrado'),
                    ('compras.ver_gestion'), ('tesoreria.ver_caja'), ('tesoreria.ver_tipo_cambio'),
                    ('codigos_internos.seguimiento'), ('codigos_internos.gasto'), ('configuracion.ver')) as p(codigo)
 where r.codigo = 'GERENTE'
on conflict do nothing;

-- 2. Gerencia no registra proveedores ----------------------------------------

delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id and r.codigo = 'GERENTE' and rp.permiso_codigo = 'proveedores.editar';

-- 3. Informe semanal de Diseño -----------------------------------------------

alter policy diseno_informes_ver on public.diseno_informes
  using ((select public.tiene_permiso('diseno.planos')) or (select public.tiene_permiso('diseno.subir_pdf'))
         or (select public.tiene_permiso('supervision.general')) or (select public.tiene_permiso('diseno.ver_informes')));

alter policy diseno_tareas_ver on public.diseno_tareas
  using ((public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')
          or public.tiene_permiso('supervision.general') or public.tiene_permiso('diseno.ver_informes'))
         and public.puede_ver_orden(orden_id));

alter policy diseno_entregas_ver on public.diseno_entregas_planos
  using (((select public.tiene_permiso('diseno.planos')) or (select public.tiene_permiso('diseno.subir_pdf'))
          or (select public.tiene_permiso('supervision.general')) or (select public.tiene_permiso('diseno.ver_informes')))
         and public.puede_ver_orden(orden_id));

-- El recorrido de cada informe (`recorrido_de_informes_diseno`, migración
-- 20261126300000, del hilo del informe semanal) copia la condición de
-- `diseno_informes_ver` y se cierra a quien no la cumple: sin esto la pantalla
-- se le caería a Gerencia. Se le suma el permiso de lectura sin reescribir su
-- cuerpo; si la función todavía no existe en esta base, no hay nada que tocar.
do $$
declare
  v_def text;
  v_viejo constant text := 'or public.tiene_permiso(''supervision.general'')) then';
  v_nuevo constant text := 'or public.tiene_permiso(''supervision.general'') or public.tiene_permiso(''diseno.ver_informes'')) then';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recorrido_de_informes_diseno';
  if v_def is not null and position('diseno.ver_informes' in v_def) = 0 then
    if position(v_viejo in v_def) = 0 then
      raise exception 'La función recorrido_de_informes_diseno ya no abre con la condición esperada: revisa la migración.';
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
  end if;
end $$;

create or replace function public.identificacion_ot_diseno(p_ordenes uuid[])
 returns table(orden_id uuid, numero text, codigo_interno text, tipo_unidad text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select o.id, o.numero, nullif(btrim(u.codigo_interno), ''), o.tipo_unidad::text
    from public.ordenes_trabajo o
    left join public.unidades u on u.id = o.unidad_id
   where o.id = any(p_ordenes)
     and (public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')
          or public.tiene_permiso('supervision.general') or public.tiene_permiso('diseno.ver_informes'))
     and public.puede_ver_orden(o.id)
$function$;

-- 4. Archivos DXF ------------------------------------------------------------
-- `codigo_dxf` y su bucket leen por `puede_ver_dxf()`: con el permiso de
-- lectura, la lista y la descarga. Subir y quitar siguen pidiendo `diseno.codigos`.

create or replace function public.puede_ver_dxf()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.es_admin() or public.tiene_permiso('diseno.codigos') or public.tiene_permiso('diseno.ver_dxf')
      or (public.tiene_permiso('codigos_internos.area')
          and (public.puede_hoja_de_area((select a.id from public.areas a where a.codigo = 'MTZ'))
               or public.puede_hoja_de_area((select a.id from public.areas a where a.codigo = 'PRD'))));
$function$;

-- 5. Insumos por autorizar ---------------------------------------------------
-- La lista de lo que espera el visto. Autorizar o rechazar sigue en
-- `autorizar_insumos`, que pide `requerimientos.autorizar_metrado`.

create or replace function public.requerimientos_por_autorizar()
 returns table(requerimiento_id uuid)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('requerimientos.autorizar_metrado')
          or public.tiene_permiso('requerimientos.ver_metrado')) then
    return;
  end if;
  return query
  select distinct m.requerimiento_id
    from public.metrado_por_linea(array(
           select distinct l.requerimiento_id
             from public.requerimiento_sustentos s
             join public.requerimiento_lineas l on l.id = s.requerimiento_linea_id
             join public.requerimientos r on r.id = l.requerimiento_id
            where s.decision is null and r.estado not in ('ANULADO', 'ENTREGADO'))) m
   where m.estado = 'POR_AUTORIZAR';
end;
$function$;

-- 6. Gestión de compras ------------------------------------------------------
-- Programar, quitar de la lista y marcar lo no recogido siguen pidiendo
-- `compras.programar_recojo`. Aquí solo se lee.

alter policy ver_programacion_recojo on public.programacion_recojo
  using ((select public.es_admin()) or (select public.tiene_permiso('compras.programar_recojo'))
         or (select public.tiene_permiso('compras.recojo')) or (select public.tiene_permiso('compras.ver_gestion')));

alter policy ver_recojo_fotos on public.recojo_fotos
  using ((select public.es_admin()) or (select public.tiene_permiso('compras.programar_recojo'))
         or (select public.tiene_permiso('compras.ver_gestion')));

alter policy ver_recojos_no_logrados on public.recojos_no_logrados
  using ((select public.es_admin()) or (select public.tiene_permiso('compras.programar_recojo'))
         or (select public.tiene_permiso('compras.ver_gestion')));

alter policy recojo_ver_foto on storage.objects
  using (bucket_id = 'fotos-recojo'
         and (owner_id = ((select auth.uid()))::text
              or (((select public.es_admin()) or (select public.tiene_permiso('compras.recojo'))
                   or (select public.tiene_permiso('compras.programar_recojo')) or (select public.tiene_permiso('compras.ver_gestion')))
                  and public.foto_de_recojo_anotada(name))));

do $$
declare
  v_fn text;
  v_def text;
  v_viejo constant text := 'public.tiene_permiso(''compras.programar_recojo'') or public.tiene_permiso(''compras.recojo''))';
  v_nuevo constant text := 'public.tiene_permiso(''compras.programar_recojo'') or public.tiene_permiso(''compras.recojo'') or public.tiene_permiso(''compras.ver_gestion''))';
begin
  -- Las tres funciones de la pantalla abren con la misma condición; se le suma
  -- el permiso de lectura sin reescribir sus cuerpos largos. Si ya lo tiene
  -- (segunda corrida), no se toca.
  foreach v_fn in array array['compras_en_gestion', 'recojo_fotos_en_gestion', 'recojos_no_logrados_en_gestion'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn and p.pronargs = 0;
    if v_def is null then
      raise exception 'No existe la función %.', v_fn;
    end if;
    if position('compras.ver_gestion' in v_def) = 0 then
      if position(v_viejo in v_def) = 0 then
        raise exception 'La función % ya no abre con la condición esperada: revisa la migración.', v_fn;
      end if;
      execute replace(v_def, v_viejo, v_nuevo);
    end if;
  end loop;
end $$;

-- 7. Caja diaria -------------------------------------------------------------
-- `caja_del_dia`, `movimientos_caja_del_dia` y `cierres_caja_reabiertos` leen
-- con los permisos de quien llama: basta con las políticas. Registrar,
-- transferir, cerrar, reabrir y anular siguen pidiendo `tesoreria.caja`.

alter policy ver_cajas on public.cajas
  using ((select (public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_caja'))));

alter policy ver_movimientos_caja on public.movimientos_caja
  using ((select (public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_caja'))));

alter policy ver_cierres_caja on public.cierres_caja
  using ((select (public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_caja'))));

alter policy apertura_caja_ver on storage.objects
  using (bucket_id = 'apertura-caja'
         and (select (public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_caja')))
         and (owner_id = ((select auth.uid()))::text
              or exists (select 1 from public.cajas c where c.apertura_ruta = objects.name)));
