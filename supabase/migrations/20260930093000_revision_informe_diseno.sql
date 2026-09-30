-- El colaborador prepara; Diseño verifica y Administración recibe el mismo
-- contenido enviado. La aprobación conserva tareas, planos y texto como evidencia.
insert into public.permisos(codigo,modulo,descripcion) values
 ('diseno.preparar_informe','Diseño','Preparar y enviar el informe semanal'),
 ('diseno.revisar_informe','Diseño','Aprobar u observar el informe semanal'),
 ('administracion.recibir_informe','Administración','Recibir el informe aprobado de Diseño') on conflict(codigo) do nothing;
insert into public.roles_permisos(rol_id,permiso_codigo)
 select r.id,v.permiso from public.roles r join (values
 ('DISENO_COLABORADOR','diseno.preparar_informe'),('DISENO','diseno.revisar_informe'),
 ('DISENO_LIDER','diseno.revisar_informe'),('ADMINISTRACION','administracion.recibir_informe')) v(rol,permiso) on v.rol=r.codigo
 on conflict do nothing;
alter table public.diseno_informes
 add column if not exists estado text not null default 'BORRADOR' check(estado in('BORRADOR','EN_REVISION','OBSERVADO','APROBADO','RECIBIDO')),
 add column if not exists observacion_revision text,
 add column if not exists enviado_en timestamptz,
 add column if not exists revisado_por uuid references public.usuarios(id),
 add column if not exists revisado_en timestamptz,
 add column if not exists recibido_por uuid references public.usuarios(id),
 add column if not exists recibido_en timestamptz,
 add column if not exists contenido_enviado jsonb;
drop policy if exists diseno_informes_crear on public.diseno_informes;
create policy diseno_informes_crear on public.diseno_informes for insert to authenticated with check(
 (select public.tiene_permiso('diseno.preparar_informe')) and creado_por=(select auth.uid()) and actualizado_por=(select auth.uid()));
drop policy if exists diseno_informes_editar on public.diseno_informes;
create policy diseno_informes_editar on public.diseno_informes for update to authenticated using(
 (select public.tiene_permiso('diseno.preparar_informe')) or (select public.tiene_permiso('diseno.revisar_informe'))
 or ((select public.tiene_permiso('administracion.recibir_informe')) and estado in('APROBADO','RECIBIDO'))
) with check(actualizado_por=(select auth.uid()));
drop policy if exists diseno_informes_ver on public.diseno_informes;
create policy diseno_informes_ver on public.diseno_informes for select to authenticated using(
 (select public.tiene_permiso('diseno.planos')) or (select public.tiene_permiso('diseno.subir_pdf'))
 or (select public.tiene_permiso('supervision.general'))
 or ((select public.tiene_permiso('administracion.recibir_informe')) and estado in('APROBADO','RECIBIDO')));

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
     new.contenido_enviado:=jsonb_build_object('tareas',coalesce((select jsonb_agg(jsonb_build_object(
       'id',t.id,'orden_id',t.orden_id,'integrante_id',t.integrante_id,'tipo',t.tipo,'componente',t.componente,
       'fecha_inicio',t.fecha_inicio,'fecha_entrega',t.fecha_entrega,'observacion',t.observacion,'ot',o.numero,'responsable',e.nombre) order by t.fecha_inicio)
       from public.diseno_tareas t join public.ordenes_trabajo o on o.id=t.orden_id join public.ot_equipo_diseno e on e.id=t.integrante_id
       where t.fecha_inicio<=new.semana_inicio+6 and t.fecha_entrega>=new.semana_inicio),'[]'::jsonb),
       'planos',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'ot',o.numero,'numero',p.numero_plano,'nombre',p.nombre,
       'area',a.nombre,'responsable',coalesce(e.nombre,'Sin asignar'),'entregado_en',v.revision_diseno_en,'estado',v.estado) order by v.revision_diseno_en)
       from public.ot_plano_versiones v join public.ot_planos p on p.id=v.plano_id join public.ordenes_trabajo o on o.id=p.orden_id
       join public.areas a on a.id=v.area_id left join public.ot_equipo_diseno e on e.id=p.integrante_diseno_id
       where v.revision_diseno='APROBADO' and v.revision_diseno_en>=new.semana_inicio::timestamp at time zone 'America/Lima'
       and v.revision_diseno_en<(new.semana_inicio+7)::timestamp at time zone 'America/Lima'),'[]'::jsonb));
   elsif old.estado='EN_REVISION' and new.estado in('APROBADO','OBSERVADO') then
     perform public.exigir_permiso('diseno.revisar_informe');
     if new.estado='OBSERVADO' and length(btrim(coalesce(new.observacion_revision,'')))<10 then raise exception 'Explica la observación con al menos 10 caracteres.'; end if;
     new.revisado_por:=public.usuario_actual();new.revisado_en:=now();
   elsif old.estado='APROBADO' and new.estado='RECIBIDO' then
     perform public.exigir_permiso('administracion.recibir_informe');
     new.recibido_por:=public.usuario_actual();new.recibido_en:=now();new.observacion_revision:=old.observacion_revision;
   else raise exception 'Esa transición no corresponde al estado actual del informe.';
   end if;
 else new.observacion_revision:=old.observacion_revision;
 end if;
 return new;
end $$;
revoke all on function public.controlar_revision_informe_diseno() from public,anon,authenticated;
drop trigger if exists trg_revision_informe_diseno on public.diseno_informes;
create trigger trg_revision_informe_diseno before insert or update on public.diseno_informes for each row execute function public.controlar_revision_informe_diseno();
select public.activar_auditoria('diseno_informes');
select public.activar_registro_de_prueba('diseno_informes');

create or replace function public.transitar_informe_diseno(p_informe uuid,p_estado text,p_observacion text default null)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_actual text;
begin
 if p_estado='EN_REVISION' then perform public.exigir_permiso('diseno.preparar_informe');
 elsif p_estado in('APROBADO','OBSERVADO') then perform public.exigir_permiso('diseno.revisar_informe');
 elsif p_estado='RECIBIDO' then perform public.exigir_permiso('administracion.recibir_informe');
 else raise exception 'Elige enviar, aprobar, observar o recibir.'; end if;
 select estado into v_actual from public.diseno_informes where id=p_informe for update;
 if not found then raise exception 'El informe no está disponible.'; end if;
 if v_actual=p_estado then return p_informe; end if;
 update public.diseno_informes set estado=p_estado,observacion_revision=p_observacion,actualizado_por=public.usuario_actual() where id=p_informe;
 return p_informe;
end $$;
revoke all on function public.transitar_informe_diseno(uuid,text,text) from public,anon;
grant execute on function public.transitar_informe_diseno(uuid,text,text) to authenticated;
