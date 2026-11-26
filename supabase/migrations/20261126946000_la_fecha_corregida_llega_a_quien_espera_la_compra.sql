-- =============================================================================
-- LA FECHA CORREGIDA LLEGA A QUIEN ESPERA LA COMPRA
-- =============================================================================
-- Desde la entrega 4.2 (20261126462000) Logística corrige la fecha que prometió
-- el proveedor cuando avisa otra, y Compras cuenta el atraso contra esa. Las
-- demás pantallas seguían con la fecha que salió en el documento, y quien
-- espera la compra la esperaba el día equivocado. El 2026-11-26 DKS pidió que
-- la corregida llegue también al conductor, a Atención de RQ, al kardex y a
-- Aprobación.
--
-- Atención de RQ y el kardex los usa gente que lee la OC: esas pantallas leen el
-- seguimiento con su RLS (src/lib/datos/plazos-compras.ts). Las otras tres no la
-- leen, y la fecha les llega por una función `security definer`:
--
--   compras_en_gestion       el conductor («Lista desde…») y Logística en Gestión
--   documentos_por_aprobar   Gerencia, en Aprobación, de la OC y de la OS
--   seguimiento_de_insumos   el supervisor, «se espera el…» de su insumo
--
-- Las tres pasan a dar la fecha que vale hoy (`fecha_prometida_de_compra`): la
-- última corregida o, si nunca se corrigió, la del documento. El documento y su
-- PDF siguen con la fecha que salió al emitirlo.
--
-- Cada cambio busca el texto exacto que reemplaza: si otra migración cambió la
-- función, se detiene y pide revisarla a mano. Idempotente y sin DROP.

do $$
declare
  v_cambio record;
  v_def    text;
  v_hecho  boolean;
  v_tiene  boolean;
begin
  for v_cambio in
    select * from (values
      ('public.compras_en_gestion()', 1,
       $v$         c.fecha_estimada, c.creado_en,$v$,
       $v$         public.fecha_prometida_de_compra(c.id, null), c.creado_en,$v$),
      ('public.documentos_por_aprobar()', 1,
       $v$c.dias_credito, c.fecha_estimada, c.aprobacion as x_aprobacion,$v$,
       $v$c.dias_credito, public.fecha_prometida_de_compra(c.id, null), c.aprobacion as x_aprobacion,$v$),
      ('public.documentos_por_aprobar()', 2,
       $v$s.dias_credito, s.fecha_fin, s.aprobacion,$v$,
       $v$s.dias_credito, public.fecha_prometida_de_compra(null, s.id), s.aprobacion,$v$),
      ('public.seguimiento_de_insumos(uuid[])', 1,
       $v$then c.fecha_estimada end,$v$,
       $v$then public.fecha_prometida_de_compra(c.id, null) end,$v$)
    ) as x(funcion, paso, viejo, nuevo)
    order by funcion, paso
  loop
    select replace(pg_get_functiondef(v_cambio.funcion::regprocedure), E'\r', '') into v_def;
    v_hecho := position(v_cambio.nuevo in v_def) > 0;
    v_tiene := position(v_cambio.viejo in v_def) > 0;
    if v_hecho and not v_tiene then
      continue;
    end if;
    if not v_tiene or (length(v_def) - length(replace(v_def, v_cambio.viejo, ''))) <> length(v_cambio.viejo) then
      raise exception '% ya no tiene la fecha que esta migración cambia, o la tiene más de una vez: revísala a mano.', v_cambio.funcion;
    end if;
    execute replace(v_def, v_cambio.viejo, v_cambio.nuevo);
  end loop;
end $$;

comment on function public.seguimiento_de_insumos(uuid[]) is
  'Lo que el supervisor no lee de cada insumo de sus RQ: el visto de Diseño si se pasa del metrado, la fecha en que se espera su compra (la corregida por Logística si la corrigió, 20261126946000; solo la fecha: ni proveedor ni precio) y quién lo recibió del almacén y cuándo. Solo los RQ del área de quien llama (requerimientos.area) y los de tipo ADMINISTRACION para quien tiene requerimientos.administracion.';
