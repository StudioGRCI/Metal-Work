-- =============================================================================
-- EL CÓDIGO INTERNO SE ELIGE DE UNA LISTA, CON SU UNIDAD
-- -----------------------------------------------------------------------------
-- DKS, el 2026-10-20, con la cuenta de Requerimientos: «en código interno no le
-- sale una barra con los códigos que deben ser… o sea no aparece una ayuda para
-- seleccionar el código». Y después, mirando el Reporte diario: «mejora el
-- buscador». En el RQ (y en el RQA de la administradora) el código interno se
-- escribía de memoria, letra por letra: `PLA_SR_O4_1_26/28` con O o con cero,
-- con barra o con guion. Cada variante es otro código para el costeo, y Gerencia
-- los junta a mano en «Parecidos a otro». Los demás formularios ofrecían una
-- lista del navegador (`datalist`): angosta, corta los códigos largos, no busca
-- por la placa y en el teléfono sale distinta en cada marca.
--
-- Esta función le da a todo formulario que pide un código interno la misma
-- lista: los códigos que conoce el sistema, escritos como los guarda el costeo,
-- con su unidad (placa, marca y modelo, o el vehículo que registró la portería)
-- para buscarlos por el código o por la unidad. Por defecto se ofrecen los
-- abiertos: el código cuyo costeo cerró Gerencia al entregar la unidad viene
-- marcado (`cerrado`) para que la pantalla avise si alguien lo escribe, sin
-- ofrecerlo. Del cierre sale solo si existe: el costo, el precio y el margen
-- congelados siguen tapados (`codigo_interno_cierres` se lee con su propia
-- política).
--
-- La lee quien registra algo con código interno: Requerimientos
-- (`requerimientos.emitir`) y la administradora (`requerimientos.
-- administracion`) en el requerimiento, Tesorería en la caja diaria
-- (`tesoreria.caja`), RR. HH. en el costeo de horas (`rrhh.personal`) y
-- Supervisión en el reporte diario (`reporte_diario.registrar`): los mismos
-- permisos que piden esos formularios. TODOS LOS ACTIVOS no viene: no es un
-- código, es «Se carga a todos» del RQA.
-- =============================================================================

create or replace function public.codigos_internos_para_elegir()
returns table (codigo text, unidad text, cerrado boolean)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('requerimientos.emitir')
          or public.tiene_permiso('requerimientos.administracion') or public.tiene_permiso('tesoreria.caja')
          or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('reporte_diario.registrar')) then
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
           string_agg(distinct nullif(concat_ws(' · ', nullif(btrim(u.placa), ''), nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')), ''), ', ') as texto
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
         exists (select 1 from public.codigo_interno_cierres k where k.codigo = c.codigo and k.reabierto_en is null)
    from conocido c
    left join unidad u on u.codigo = c.codigo
    left join porteria p on p.codigo = c.codigo
   where c.codigo is not null and char_length(c.codigo) between 2 and 60 and c.codigo <> 'TODOS LOS ACTIVOS'
   order by c.codigo;
end;
$$;
comment on function public.codigos_internos_para_elegir() is
  'Los códigos internos que se ofrecen en los formularios (requerimiento, caja diaria, costeo de horas, reporte diario), con su unidad y si su costeo está cerrado (sin montos).';
revoke all on function public.codigos_internos_para_elegir() from public, anon;
grant execute on function public.codigos_internos_para_elegir() to authenticated;
