-- =============================================================================
-- LA SALIDA DEL ALMACÉN SIN RQ ELIGE EL CÓDIGO DE LA MISMA LISTA
-- -----------------------------------------------------------------------------
-- Desde la migración 20261020190000 todo formulario que pide un código interno
-- lo elige de una lista, con su unidad, porque escrito de memoria cada variante
-- (`SR_O4` con O o con cero, con barra o con guion) era otra unidad en el
-- costeo. Quedaba uno afuera: la salida del kardex que no viene de un RQ, donde
-- Almacén escribía el código de la unidad o su placa a mano. Lo que sale así va
-- al costeo de ese código igual que lo de un RQ, así que la misma variante
-- partía en dos el costo de los materiales de una unidad.
--
-- Ahora la lee también quien registra esa salida (`almacen.despachar`, el
-- permiso que exige `registrar_salida_material`): Almacén. Ve lo mismo que los
-- demás, el código y la placa y marca de su unidad, sin montos. La portería
-- sigue sin leerla: no registra nada con código interno.
--
-- La función es la misma de la 20261020190000 con un permiso más en la puerta.
-- La planilla «Sin internet» del kardex sigue tomando el código como se escribe:
-- se llena sin conexión, donde no hay lista que leer, y la base lo normaliza al
-- registrarla.
-- =============================================================================

create or replace function public.codigos_internos_para_elegir()
returns table (codigo text, unidad text, cerrado boolean, registrada boolean)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('requerimientos.emitir')
          or public.tiene_permiso('requerimientos.administracion') or public.tiene_permiso('tesoreria.caja')
          or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('reporte_diario.registrar')
          or public.tiene_permiso('compras.crear') or public.tiene_permiso('subcontratos.gestionar')
          or public.tiene_permiso('almacen.despachar')) then
    raise exception 'No tienes permiso para ver la lista de códigos internos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with conocido as (
    -- Los mismos que conoce Diseño (`codigos_internos_de_diseno`), más las horas
    -- de RR. HH., los subcontratos, las salidas del almacén y la caja con su código.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo from public.unidades u where u.activo and u.codigo_interno is not null
    union select public.normalizar_codigo_interno(r.codigo_interno) from public.requerimientos r where r.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(c.codigo_interno) from public.ordenes_compra_materiales c
           where c.codigo_interno is not null and c.aprobacion <> 'RECHAZADA'
    union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
           where s.codigo_interno is not null and s.estado <> 'ANULADA'
    union select public.normalizar_codigo_interno(d.codigo_interno) from public.reportes_diarios d where d.anulado_en is null
    union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
           where v.codigo_interno is not null and v.anulado_en is null
    union select public.normalizar_codigo_interno(t.codigo_interno) from public.tareos t where t.anulado_en is null
    union select public.normalizar_codigo_interno(x.codigo_interno) from public.subcontratos x where x.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(m.codigo_interno) from public.movimientos_materiales m
           where m.codigo_interno is not null and m.tipo in ('SALIDA', 'DESPACHO')
    union select p.codigo_interno from public.codigo_planos p where p.anulado_en is null
    union select e.codigo_interno from public.codigo_etapas e where e.quitada_en is null
    union select public.normalizar_codigo_interno(k.codigo_interno) from public.movimientos_caja k where k.codigo_interno is not null and k.anulado_en is null
  ), unidad as (
    -- Como en Diseño: la placa y la marca y modelo de la unidad.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo,
           string_agg(distinct nullif(concat_ws(' · ', nullif(btrim(u.placa), ''), nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')), ''), ', ') as texto,
           bool_or(u.activo) as activa
      from public.unidades u where u.codigo_interno is not null group by 1
  ), porteria as (
    -- La que no está en Unidades, por lo que anotó la portería la última vez que entró.
    select distinct on (public.normalizar_codigo_interno(v.codigo_interno))
           public.normalizar_codigo_interno(v.codigo_interno) as codigo,
           nullif(concat_ws(' · ', nullif(btrim(v.placa), ''), nullif(btrim(v.unidad), '')), '') as texto
      from public.registro_vehiculos v
     where v.codigo_interno is not null and v.anulado_en is null
     order by public.normalizar_codigo_interno(v.codigo_interno), v.ingreso_en desc
  )
  select c.codigo, coalesce(u.texto, p.texto),
         exists (select 1 from public.codigo_interno_cierres k where k.codigo = c.codigo and k.reabierto_en is null),
         coalesce(u.activa, false)
    from conocido c
    left join unidad u on u.codigo = c.codigo
    left join porteria p on p.codigo = c.codigo
   where c.codigo is not null and char_length(c.codigo) between 2 and 60 and c.codigo <> 'TODOS LOS ACTIVOS'
   order by c.codigo;
end;
$$;
comment on function public.codigos_internos_para_elegir() is
  'Los códigos internos que se ofrecen en los formularios (requerimiento, caja diaria, costeo de horas, observaciones, reporte diario, orden de compra, servicio, subcontrato, salida del almacén sin RQ), con su unidad, si su costeo está cerrado (sin montos) y si es de una unidad del padrón.';
revoke all on function public.codigos_internos_para_elegir() from public, anon;
grant execute on function public.codigos_internos_para_elegir() to authenticated;
