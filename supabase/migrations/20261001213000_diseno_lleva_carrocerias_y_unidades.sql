-- =============================================================================
-- CARROCERÍAS Y UNIDADES LAS LLEVA DISEÑO; A ADMINISTRACIÓN, SOLO LA EVALUACIÓN
-- -----------------------------------------------------------------------------
-- La empresa revisó el menú de Administración el 2026-10-01 y pidió:
--
--   · La valorización del almacén es de Logística, no de Administración.
--   · De Preparación técnica, a Administración solo le llega la evaluación de
--     desempeño. El informe semanal lo llena el colaborador de Diseño, lo
--     revisa Diseño y ahí termina: Administración ya no lo recibe.
--   · Unidades y Carrocerías las ve y las corrige Diseño e Ingeniería.
--
-- Hasta hoy Diseño solo podía mirar: el catálogo de carrocerías lo corregía
-- Administración (`configuracion.editar`) y las unidades, Ventas
-- (`clientes.editar`). Y ni siquiera miraba bien: las fichas técnicas de cada
-- carrocería se leían con `cotizaciones.ver`, un permiso que no tiene ningún
-- puesto desde que la cotización pasó a PDF. Con la cuenta real de Diseño, la
-- pantalla Carrocerías veía 0 de las 38 fichas y 0 de sus 1 753 líneas: decía
-- «Sin ficha técnica registrada» en todas.
--
-- 1. Dos permisos nuevos para Diseño e ingeniería y para Líder de Diseño:
--    `diseno.carrocerias` (nombre, descripción, medidas técnicas y si la
--    carrocería está activa) y `diseno.unidades` (los datos del vehículo y si
--    está activo). Ventas sigue corrigiendo unidades con `clientes.editar` y
--    el nombre de una carrocería con `editar_carroceria_ventas`.
--    Administración sigue dando de alta la carrocería que falta al cargar una
--    OT (`ordenes.crear`), pero ya no corrige el catálogo: su
--    `configuracion.editar` queda para el calendario y los catálogos del
--    taller.
-- 2. Las fichas técnicas se leen con los mismos permisos que las pantallas que
--    las muestran: `diseno.planos` (Carrocerías) y `configuracion.ver`
--    (Configuración). Siguen siendo de solo lectura: se corrigen por migración.
-- 3. El informe semanal termina en APROBADO. Se retiran el paso RECIBIDO y el
--    permiso `administracion.recibir_informe`; al aprobarse, el aviso le llega
--    al colaborador. En producción todavía no había ningún informe.
--
-- La valorización no necesita cambio en la base: Administración la veía con
-- `costos.ver`, que conserva para el costo de las OT; la pantalla deja de
-- aceptarlo y el menú deja de mostrársela.
-- =============================================================================

-- 1. Permisos de Diseño -------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('diseno.carrocerias', 'Diseño', 'Corregir el catálogo de carrocerías: nombre, descripción, medidas técnicas y si está activa'),
  ('diseno.unidades', 'Diseño', 'Corregir los datos de las unidades de los clientes y activarlas o desactivarlas')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  cross join (values ('diseno.carrocerias'), ('diseno.unidades')) as p(codigo)
 where r.codigo in ('DISENO', 'DISENO_LIDER')
on conflict do nothing;

-- El catálogo de carrocerías: lo corrige Diseño. Dar de alta una que falta
-- sigue abierto a quien carga la OT o cotiza.
alter policy crear_tipos_carroceria on public.tipos_carroceria
  with check (
    (select public.es_admin())
    or (select public.tiene_permiso('diseno.carrocerias'))
    or (select public.tiene_permiso('cotizaciones.crear'))
    or (select public.tiene_permiso('ordenes.crear'))
  );

alter policy editar_tipos_carroceria on public.tipos_carroceria
  using ((select public.es_admin()) or (select public.tiene_permiso('diseno.carrocerias')))
  with check ((select public.es_admin()) or (select public.tiene_permiso('diseno.carrocerias')));

-- Las unidades: Ventas como hasta hoy y, ahora, Diseño. El alta sigue en la
-- ficha del cliente, con `clientes.editar`.
alter policy editar_unidades on public.unidades
  using (
    (select public.es_admin())
    or (select public.tiene_permiso('clientes.editar'))
    or (select public.tiene_permiso('diseno.unidades'))
  )
  with check (
    (select public.es_admin())
    or (select public.tiene_permiso('clientes.editar'))
    or (select public.tiene_permiso('diseno.unidades'))
  );

-- 2. Las fichas técnicas, legibles para quien abre las pantallas que las muestran.
alter policy ver_plantillas_ficha on public.plantillas_ficha
  using ((select public.es_admin()) or (select public.tiene_permiso('diseno.planos')) or (select public.tiene_permiso('configuracion.ver')));

alter policy ver_plantilla_ficha_lineas on public.plantilla_ficha_lineas
  using ((select public.es_admin()) or (select public.tiene_permiso('diseno.planos')) or (select public.tiene_permiso('configuracion.ver')));

alter policy ver_plantilla_ficha_accesorios on public.plantilla_ficha_accesorios
  using ((select public.es_admin()) or (select public.tiene_permiso('diseno.planos')) or (select public.tiene_permiso('configuracion.ver')));

-- 3. El informe semanal termina cuando Diseño lo aprueba ---------------------
create or replace function public.transitar_informe_diseno(p_informe uuid, p_estado text, p_observacion text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_actual text;
begin
 if p_estado = 'EN_REVISION' then perform public.exigir_permiso('diseno.preparar_informe');
 elsif p_estado in ('APROBADO', 'OBSERVADO') then perform public.exigir_permiso('diseno.revisar_informe');
 else raise exception 'Elige enviar, aprobar u observar: el informe termina cuando Diseño lo aprueba.'; end if;
 select estado into v_actual from public.diseno_informes where id = p_informe for update;
 if not found then raise exception 'El informe no está disponible.'; end if;
 if v_actual = p_estado then return p_informe; end if;
 update public.diseno_informes set estado = p_estado, observacion_revision = p_observacion, actualizado_por = public.usuario_actual() where id = p_informe;
 return p_informe;
end $$;
revoke all on function public.transitar_informe_diseno(uuid, text, text) from public, anon;
grant execute on function public.transitar_informe_diseno(uuid, text, text) to authenticated;

-- La de 20261001201500 sin el paso APROBADO → RECIBIDO: cualquier otro cambio
-- de estado después de aprobar cae en «Esa transición no corresponde…».
create or replace function public.controlar_revision_informe_diseno()
returns trigger language plpgsql security definer set search_path='public' as $$
declare v_cuerpo_nuevo jsonb; v_cuerpo_anterior jsonb;
begin
 if tg_op='INSERT' then
   perform public.exigir_permiso('diseno.preparar_informe');
   new.estado:='BORRADOR';new.contenido_enviado:=null;new.enviado_en:=null;new.revisado_por:=null;new.revisado_en:=null;new.recibido_por:=null;new.recibido_en:=null;new.observacion_revision:=null;
   return new;
 end if;
 v_cuerpo_nuevo:=to_jsonb(new)-array['estado','observacion_revision','enviado_en','revisado_por','revisado_en','recibido_por','recibido_en','contenido_enviado','actualizado_por','actualizado_en'];
 v_cuerpo_anterior:=to_jsonb(old)-array['estado','observacion_revision','enviado_en','revisado_por','revisado_en','recibido_por','recibido_en','contenido_enviado','actualizado_por','actualizado_en'];
 if v_cuerpo_nuevo is distinct from v_cuerpo_anterior then
   perform public.exigir_permiso('diseno.preparar_informe');
   if old.estado not in('BORRADOR','OBSERVADO') then raise exception 'El informe enviado está cerrado a edición. Diseño debe observarlo antes de corregirlo.'; end if;
 end if;
 new.contenido_enviado:=old.contenido_enviado;new.enviado_en:=old.enviado_en;new.revisado_por:=old.revisado_por;new.revisado_en:=old.revisado_en;new.recibido_por:=old.recibido_por;new.recibido_en:=old.recibido_en;
 if new.estado is distinct from old.estado then
   if new.estado='EN_REVISION' and old.estado in('BORRADOR','OBSERVADO') then
     perform public.exigir_permiso('diseno.preparar_informe');
     if length(btrim(new.resumen))<10 then raise exception 'Completa el resumen antes de enviar el informe.'; end if;
     new.enviado_en:=now();new.observacion_revision:=null;
     new.contenido_enviado:=jsonb_build_object(
       'tareas',coalesce((select jsonb_agg(jsonb_build_object(
         'id',t.id,'orden_id',t.orden_id,'integrante_id',t.integrante_id,'tipo',t.tipo,'componente',t.componente,
         'fecha_inicio',t.fecha_inicio,'fecha_entrega',t.fecha_entrega,'observacion',t.observacion,'ot',o.numero,
         'codigo_interno',nullif(btrim(u.codigo_interno),''),'tipo_unidad',o.tipo_unidad,'responsable',e.nombre) order by t.fecha_inicio,t.creado_en)
         from public.diseno_tareas t join public.ordenes_trabajo o on o.id=t.orden_id
         left join public.unidades u on u.id=o.unidad_id
         join public.ot_equipo_diseno e on e.id=t.integrante_id
        where t.fecha_inicio<=new.semana_inicio+6 and t.fecha_entrega>=new.semana_inicio),'[]'::jsonb),
       'entregas',coalesce((select jsonb_agg(jsonb_build_object(
         'id',d.id,'orden_id',d.orden_id,'integrante_id',d.integrante_id,'tipo_plano',d.tipo_plano,'n_planos',d.n_planos,
         'n_piezas',d.n_piezas,'fecha_entrega',d.fecha_entrega,'estado',d.estado,'entregado_a',to_jsonb(d.entregado_a),
         'ot',o.numero,'codigo_interno',nullif(btrim(u.codigo_interno),''),'tipo_unidad',o.tipo_unidad,'responsable',e.nombre)
         order by d.fecha_entrega nulls last,d.creado_en)
         from public.diseno_entregas_planos d join public.ordenes_trabajo o on o.id=d.orden_id
         left join public.unidades u on u.id=o.unidad_id
         join public.ot_equipo_diseno e on e.id=d.integrante_id
        where d.semana_inicio=new.semana_inicio),'[]'::jsonb));
   elsif old.estado='EN_REVISION' and new.estado in('APROBADO','OBSERVADO') then
     perform public.exigir_permiso('diseno.revisar_informe');
     if new.estado='OBSERVADO' and length(btrim(coalesce(new.observacion_revision,'')))<10 then raise exception 'Explica la observación con al menos 10 caracteres.'; end if;
     new.revisado_por:=public.usuario_actual();new.revisado_en:=now();
   else raise exception 'Esa transición no corresponde al estado actual del informe.';
   end if;
 else new.observacion_revision:=old.observacion_revision;
 end if;
 return new;
end $$;
revoke all on function public.controlar_revision_informe_diseno() from public,anon,authenticated;

-- Aprobado, el aviso es para el colaborador que lo llenó, no para Administración.
create or replace function public.notificar_revision_informe_diseno()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_permiso text; v_titulo text;
begin
 if new.estado = old.estado then return new; end if;
 if new.estado = 'EN_REVISION' then v_permiso := 'diseno.revisar_informe'; v_titulo := 'Informe de Diseño pendiente de revisión';
 elsif new.estado = 'APROBADO' then v_permiso := 'diseno.preparar_informe'; v_titulo := 'Informe de Diseño aprobado';
 elsif new.estado = 'OBSERVADO' then v_permiso := 'diseno.preparar_informe'; v_titulo := 'Informe de Diseño con observaciones';
 else return new; end if;
 perform public.notificar_a_permiso(v_permiso, v_titulo, 'Informe N.º ' || new.numero || ' · semana ' || to_char(new.semana_inicio, 'DD/MM/YYYY'),
   '/diseno/informe-semanal?semana=' || new.semana_inicio, 'diseno_informes', new.id, public.usuario_actual());
 return new;
end $$;
revoke all on function public.notificar_revision_informe_diseno() from public, anon, authenticated;

alter policy diseno_informes_ver on public.diseno_informes
  using (
    (select public.tiene_permiso('diseno.planos'))
    or (select public.tiene_permiso('diseno.subir_pdf'))
    or (select public.tiene_permiso('supervision.general'))
  );

alter policy diseno_informes_editar on public.diseno_informes
  using ((select public.tiene_permiso('diseno.preparar_informe')) or (select public.tiene_permiso('diseno.revisar_informe')))
  with check (actualizado_por = (select auth.uid()));

-- 4. Lo que sobra -------------------------------------------------------------
-- El permiso de recibir el informe ya no lo exige nada; se retira del catálogo
-- (la llave de roles_permisos lo quita también de Administración).
delete from public.permisos where codigo = 'administracion.recibir_informe';

-- La importación de planilla de una sola hoja, reemplazada por
-- importar_planilla_excel en 20261001203000. Se repite aquí porque en
-- producción esa línea quedó sin aplicar.
drop function if exists public.importar_detalle_planilla(uuid, uuid, text, jsonb);
