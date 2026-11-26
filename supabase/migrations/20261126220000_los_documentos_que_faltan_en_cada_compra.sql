-- Qué documento tiene cada OC y cada OS, cuál le falta y desde cuándo.
--
-- Plan 10, entrega 10.2 (DKS, 26/11): «que Contabilidad vea qué documento le
-- falta a cada compra, sin recorrer fila por fila». Hasta hoy Adquisiciones
-- listaba lo que cada orden ya tenía; lo que faltaba había que deducirlo
-- mirando la fila entera, y nada decía desde cuándo faltaba.
--
-- Cada documento cuenta desde que se le puede pedir a alguien:
--
--   · FACTURA, de la OC que va con factura: desde que Gerencia la aprobó (la que
--     no requería aprobación, desde que se emitió). Facturada en parte, es
--     EN_PARTE: tiene factura y le falta lo que no cubre.
--   · BOLETA, de la OC que va sin factura (boleta, nota de venta o recibo, o la
--     factura que el proveedor entregó igual): desde su aprobación. La de antes
--     que se pagó fuera del sistema (`pago_en_tesoreria` falso) no la pide, como
--     Adquisiciones ya no la pedía.
--   · COMPROBANTE, de la OS (factura, boleta o recibo adjuntos): desde que
--     Gerencia la aprobó.
--   · GUIA, la guía de remisión que carga Contabilidad: desde que la OC entró a
--     la lista del conductor, con la regla de su bandeja (`guias_por_emitir`).
--     La OC que el proveedor dejó en el almacén no la lleva.
--   · DETRACCION, de la OS afecta: desde su primer pago al proveedor, que es
--     cuando el depósito en el Banco de la Nación ya corre.
--   · NOTA_CREDITO, de la OC que devolvió algo que el proveedor no repone: desde
--     la devolución (o desde que se dejó de esperar la reposición). Qué
--     devolución la espera lo decide la misma regla que «Esperan nota de
--     crédito» (`devoluciones_sin_nota_credito`).
--
-- La función solo lee: no anula, no borra y no cambia ningún documento. La lee
-- quien lee Adquisiciones (`adquisiciones.ver`, como `trazabilidad_de_compras`).
-- Es `security definer` porque junta tablas que cada puesto lee por su lado
-- (los pagos de la OS, los movimientos del almacén, las notas de crédito), y no
-- devuelve importes: solo qué documento, si está, desde cuándo y su número.
--
-- `rows 400`: sin él el planificador cree que da mil filas por llamada y en un
-- Postgres con JIT la compila en cada lectura (skill `datos` › Rendimiento).
--
-- Idempotente.

create or replace function public.documentos_de_las_compras()
returns table (
  tipo text, compra uuid, documento text, situacion text, desde timestamptz, dias integer, numeros text
)
language plpgsql stable security definer set search_path to 'public' rows 400 as $$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'No tienes permiso para ver Adquisiciones.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with
  -- Las OC que siguen en pie: aprobadas o sin aprobación que pedir.
  oc as (
    select c.id, c.con_factura, c.pago_en_tesoreria, c.recojo, coalesce(c.aprobado_en, c.creado_en) as aprobada_en
      from public.ordenes_compra_materiales c
     where c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
  ),
  facturado as (
    select f.orden_compra_id, f.facturado, (f.completa or f.facturado >= f.total - 1) as entera,
           (select string_agg(e->>'numero_documento', ', ' order by e->>'numero_documento')
              from jsonb_array_elements(f.facturas) e) as numeros
      from public.compras_facturadas(null, null) f
  ),
  -- 1. La factura de la OC con factura.
  factura as (
    select 'OC'::text, c.id, 'FACTURA'::text,
           case when coalesce(f.entera, false) then 'ESTA'
                when coalesce(f.facturado, 0) > 0 then 'EN_PARTE'
                else 'FALTA' end,
           c.aprobada_en, f.numeros
      from oc c
      left join facturado f on f.orden_compra_id = c.id
     where c.con_factura
  ),
  -- 2. El comprobante de la OC con boleta: la boleta adjunta, o la factura que el proveedor entregó igual.
  boleta as (
    select 'OC'::text, c.id, 'BOLETA'::text,
           case when d.numeros is not null or d.hay or coalesce(f.facturado, 0) > 0 then 'ESTA' else 'FALTA' end,
           c.aprobada_en, coalesce(f.numeros, d.numeros)
      from oc c
      left join facturado f on f.orden_compra_id = c.id
      left join lateral (
        select bool_or(true) as hay, string_agg(x.numero_documento, ', ' order by x.numero_documento) as numeros
          from public.documentos_compra_material x
         where x.orden_compra_id = c.id and x.anulado_en is null and x.tipo in ('COMPROBANTE', 'FACTURA')
      ) d on true
     where not c.con_factura and c.pago_en_tesoreria
  ),
  -- 3. La guía de remisión, desde que la OC entró a la lista del conductor.
  guia as (
    select 'OC'::text, c.id, 'GUIA'::text,
           case when g.numero is not null then 'ESTA' else 'FALTA' end,
           coalesce(pr.programado_en, pr.creado_en), g.numero
      from oc c
      join public.programacion_recojo pr on pr.orden_compra_id = c.id
      left join public.guias_remision_compra g on g.orden_compra_id = c.id and g.anulada_en is null
     -- La misma condición que `guias_por_emitir`, la bandeja de Contabilidad.
     where g.numero is not null
        or c.recojo in ('EN_RECOJO', 'RECOGIDO') or (c.recojo = 'POR_RECOGER' and pr.posicion is not null)
  ),
  -- 4. La nota de crédito de lo devuelto que el proveedor no repone. Qué devolución
  --    la espera es lo mismo que dice `devoluciones_sin_nota_credito`: no se repone y
  --    le queda algo sin reponer; la que ya tiene su nota, está.
  devuelto as (
    select det.orden_compra_id, m.id as movimiento,
           coalesce(m.reposicion_cancelada_en, m.registrado_en) as desde,
           (select n.numero from public.notas_credito_compra n
             where n.devolucion_id = m.id and n.anulado_en is null
             order by n.creado_en limit 1) as nota
      from public.movimientos_materiales m
      join public.orden_compra_material_detalles det on det.id = m.orden_compra_detalle_id
     where m.tipo = 'DEVOLUCION_PROVEEDOR' and not m.se_repone
       and m.cantidad::numeric > coalesce((select sum(r.cantidad::numeric) from public.movimientos_materiales r
                                            where r.repone_devolucion = m.id), 0)
  ),
  nota as (
    select 'OC'::text, c.id, 'NOTA_CREDITO'::text,
           case when bool_and(d.nota is not null) then 'ESTA'
                when bool_or(d.nota is not null) then 'EN_PARTE'
                else 'FALTA' end,
           min(d.desde) filter (where d.nota is null),
           string_agg(d.nota, ', ' order by d.nota)
      from oc c
      join devuelto d on d.orden_compra_id = c.id
     group by c.id
  ),
  -- Las OS aprobadas que no se anularon.
  os as (
    select s.id, s.aprobado_en, coalesce(s.detraccion_afecta, false) as afecta, s.detraccion_monto
      from public.ordenes_servicio s
     where s.aprobacion = 'APROBADA' and s.estado <> 'ANULADA'
  ),
  -- 5. El comprobante de la OS: su factura, boleta o recibo adjuntos.
  comprobante as (
    select 'OS'::text, s.id, 'COMPROBANTE'::text,
           case when d.numeros is not null or d.hay then 'ESTA' else 'FALTA' end,
           s.aprobado_en, d.numeros
      from os s
      left join lateral (
        select bool_or(true) as hay, string_agg(x.numero, ', ' order by x.numero) as numeros
          from public.documentos_orden_servicio x
         where x.orden_servicio_id = s.id and x.anulado_en is null and x.tipo in ('FACTURA', 'BOLETA', 'RECIBO')
      ) d on true
  ),
  -- 6. La detracción de la OS afecta, desde su primer pago al proveedor.
  pagos_os as (
    select g.orden_servicio_id,
           min(g.creado_en) filter (where g.destino = 'PROVEEDOR') as primer_pago,
           coalesce(sum(g.monto) filter (where g.destino = 'DETRACCION'), 0) as depositado,
           string_agg(g.operacion, ', ' order by g.fecha_pago) filter (where g.destino = 'DETRACCION') as operaciones
      from public.pagos_orden_servicio g
     where g.anulado_en is null
     group by g.orden_servicio_id
  ),
  detraccion as (
    select 'OS'::text, s.id, 'DETRACCION'::text,
           case when coalesce(p.depositado, 0) > 0
                     and (s.detraccion_monto is null or p.depositado >= s.detraccion_monto - 0.005) then 'ESTA'
                when coalesce(p.depositado, 0) > 0 then 'EN_PARTE'
                else 'FALTA' end,
           p.primer_pago, p.operaciones
      from os s
      join pagos_os p on p.orden_servicio_id = s.id
     where s.afecta and (p.primer_pago is not null or p.depositado > 0)
  ),
  todo (tipo, compra, documento, situacion, desde, numeros) as (
    select * from factura
    union all select * from boleta
    union all select * from guia
    union all select * from nota
    union all select * from comprobante
    union all select * from detraccion
  )
  select t.tipo, t.compra, t.documento, t.situacion,
         t.desde,
         case when t.situacion <> 'ESTA' and t.desde is not null then public.dias_en_espera(t.desde) end,
         t.numeros
    from todo t;
end;
$$;

comment on function public.documentos_de_las_compras() is
  'De cada OC y OS en pie: qué documento lleva (factura, boleta, comprobante de la OS, guía, detracción, nota de crédito), si está (ESTA, EN_PARTE o FALTA), desde cuándo falta, los días y sus números. Solo lee. La lee quien lee Adquisiciones.';
revoke all on function public.documentos_de_las_compras() from public, anon;
grant execute on function public.documentos_de_las_compras() to authenticated;
