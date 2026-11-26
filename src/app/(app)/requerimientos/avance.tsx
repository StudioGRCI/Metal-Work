import type { Tono } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import type { LineaRequerimiento, RequerimientoListado } from '@/lib/datos/requerimientos'
import { comoVaLaEntrega, cuentaDelInsumo } from '@/lib/dominio/cuenta-del-insumo'
import { ENTREGADO_CON_FALTANTE, ETAPA_AVANCE_RQ, laCompraQuedoCorta, partesDelInsumo, resumenDeEtapas } from '@/lib/dominio/requerimientos'
import { cantidad, fecha, fechaHora, hoyLima } from '@/lib/format'

const COLOR: Record<Tono, string> = {
  neutro: 'text-texto-suave',
  exito: 'text-exito',
  aviso: 'text-aviso',
  peligro: 'text-peligro',
  info: 'text-info',
  acento: 'text-acento',
}

/**
 * En qué porcentaje va el RQ: la barra, la etapa del insumo más atrasado y,
 * cuando los insumos van separados, cuántos hay en cada etapa. Es de Atención
 * de requerimiento; la lista de Requerimientos lo dice en pasos (`tarjeta.tsx`).
 */
export function AvanceDelRequerimiento({
  rq,
  frenado,
}: {
  rq: RequerimientoListado
  /** El RQ frenado por el metrado: la etapa dice quién lo tiene, no «Almacén revisa». */
  frenado?: { etiqueta: string; tono: Tono }
}) {
  if (!rq.avance) return null
  // Entregado con faltante no es «Entregado» a secas: parte no salió. Y si ya
  // se entregó, la insignia de al lado lo dice: la etapa no lo repite.
  const etapa = frenado ?? (rq.avance.etapa === 'ENTREGADO' && rq.faltante_al_entregar ? ENTREGADO_CON_FALTANTE : ETAPA_AVANCE_RQ[rq.avance.etapa])
  const repite = rq.estado === 'ENTREGADO' && rq.avance.etapa === 'ENTREGADO'
  const resumen = resumenDeEtapas(rq.lineas.map((l) => l.etapa))
  return (
    <div className="mt-2 w-48 max-w-full space-y-0.5">
      <Progreso valor={rq.avance.porcentaje} mostrarValor alto="sm" etiqueta={`Avance de ${rq.numero}`} />
      {!repite && <p className={`text-xs font-medium ${COLOR[etapa?.tono ?? 'neutro']}`}>{etapa?.etiqueta ?? rq.avance.etapa}</p>}
      {resumen && <p className="text-xs text-texto-suave">{resumen}</p>}
    </div>
  )
}

/**
 * De dónde sale el insumo: el código del catálogo de Almacén, o «material nuevo»
 * mientras Almacén no lo da de alta. Va delante de la categoría.
 */
export function MaterialDelInsumo({ linea: l }: { linea: LineaRequerimiento }) {
  if (l.material_nuevo && !l.material_id) {
    return <span className="font-medium text-aviso">Material nuevo: Almacén lo da de alta al revisarlo · </span>
  }
  const recompra = l.recompra && <span className="font-medium text-aviso">Se compra otra vez: el proveedor no repuso lo devuelto · </span>
  if (!l.material_codigo) return recompra || null
  return (
    <>
      {recompra}
      <span className="tabular">{l.material_codigo}</span>
      {l.material_nuevo && <span className="text-texto"> (pedido como material nuevo)</span>}
      {' · '}
    </>
  )
}

/**
 * La OC del insumo y en qué va. Mientras el RQ está por comprar o en compra
 * cada insumo va por su lado (lo que tenía Almacén, su OC, su recojo); antes y
 * después van todos juntos y basta la etapa del RQ.
 */
export function CompraDelInsumo({ linea: l, estadoRq }: { linea: LineaRequerimiento; estadoRq: string }) {
  const porInsumo = estadoRq === 'SIN_STOCK' || estadoRq === 'EN_ATENCION'
  const etapa = porInsumo && l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : null
  // Almacén tenía una parte: se compra solo el resto.
  const parte = porInsumo && l.en_stock !== null && l.en_stock > 0 && l.por_comprar !== null && l.por_comprar > 0
  if (!l.orden_compra && !etapa && !parte) return null
  return (
    <>
      {parte && (
        <>
          {' · '}
          <span className="text-texto">
            Almacén tiene {cantidad(l.en_stock ?? 0)} {l.unidad}, se compran {cantidad(l.por_comprar ?? 0)}
          </span>
        </>
      )}
      {l.orden_compra && (
        <>
          {' · '}
          <span className={`tabular ${l.compra_rechazada ? 'text-peligro' : 'text-texto'}`}>
            {l.orden_compra}
            {l.compra_anulada ? ' anulada' : l.compra_rechazada ? ' rechazada' : ''}
          </span>
        </>
      )}
      {etapa && (
        <>
          {' · '}
          <span className={COLOR[etapa.tono]}>{etapa.etiqueta}</span>
          {l.etapa_desde && <span> desde {fechaHora(l.etapa_desde)}</span>}
        </>
      )}
    </>
  )
}

/**
 * Qué falta entregar del insumo, en cifras (plan 2, entrega 2.1): lo entregado
 * de lo pedido y, de lo que falta, cuánto está separado en almacén, cuánto viene
 * en su OC (con la fecha en que se espera) y cuánto falta comprar. Es la misma
 * cuenta que la tarjeta del RQ (`partesDelInsumo`). Sin precios.
 *
 * Necesita lo entregado (`cargarRequerimientos` con `conEntregado`); sin eso no
 * dice nada, porque un cero diría «nada entregado».
 */
export function EntregaDelInsumo({ linea: l, estadoRq }: { linea: LineaRequerimiento; estadoRq: string }) {
  const partes = partesDelInsumo(l, estadoRq)
  if (!partes) return null
  const compraViva = Boolean(l.orden_compra) && !l.compra_rechazada && !laCompraQuedoCorta(l, partes)
  const c = cuentaDelInsumo(l.cantidad, partes, compraViva)
  const como = comoVaLaEntrega(c)
  // Entregado el RQ, lo que no salió ya lo dice «No salió del kardex» junto al insumo.
  const cerrado = estadoRq === 'ENTREGADO'
  if (cerrado && como !== 'PARCIAL') return null
  // Nada entregado y todo por revisar: la etapa del RQ ya lo dice.
  if (como === 'NADA' && c.porRevisar === c.falta) return null
  const u = l.unidad
  // La fecha de la OC ya pasada se dice en pasado: «se esperaba el …». Sin
  // color: todavía no hay colores por demora (decisión del plan 0).
  const vencida = l.fecha_esperada !== null && l.fecha_esperada < hoyLima()
  const todas = [
    c.separado > 0 && { clave: 'separado', texto: `Separado ${cantidad(c.separado)}`, clase: 'text-exito' },
    c.porLlegar > 0 && {
      clave: 'por-llegar',
      texto: `Por llegar ${cantidad(c.porLlegar)}${l.fecha_esperada ? ` (${vencida ? 'se esperaba' : 'se espera'} el ${fecha(l.fecha_esperada)})` : ''}`,
      clase: 'text-info',
    },
    c.porComprar > 0 && { clave: 'por-comprar', texto: `Por comprar ${cantidad(c.porComprar)}`, clase: 'text-aviso' },
    c.porRevisar > 0 && { clave: 'por-revisar', texto: `Por revisar ${cantidad(c.porRevisar)}`, clase: 'text-texto-suave' },
  ].filter((p): p is { clave: string; texto: string; clase: string } => Boolean(p))
  // Nada entregado y todo lo que falta por comprar: «faltan 6» basta junto a la
  // etapa «Por comprar» del insumo, que ya lo dice.
  const partesQueFaltan = como === 'NADA' && todas.length === 1 && todas[0].clave === 'por-comprar' ? [] : todas
  const falta = (n: number) => `${n === 1 ? 'falta' : 'faltan'} ${cantidad(n)}`
  return (
    <span
      className="mt-0.5 block text-xs"
      data-entrega-insumo={como}
      data-pedido={c.pedido}
      data-entregado={c.entregado}
      data-separado={c.separado}
      data-por-llegar={c.porLlegar}
      data-por-comprar={c.porComprar}
      data-por-revisar={c.porRevisar}
    >
      <span className={`tabular font-medium ${como === 'COMPLETA' ? 'text-exito' : 'text-texto'}`}>
        {como === 'COMPLETA'
          ? `Entregado completo: ${cantidad(c.pedido)} ${u}`
          : cerrado
            ? `Entregado ${cantidad(c.entregado)} de ${cantidad(c.pedido)} ${u}`
            : como === 'PARCIAL'
              ? `Entregado ${cantidad(c.entregado)} de ${cantidad(c.pedido)} ${u} · ${falta(c.falta)}`
              : `Nada entregado · ${falta(c.falta)} ${u}`}
      </span>
      {!cerrado &&
        partesQueFaltan.map((p) => (
          <span key={p.clave} className="tabular">
            {' · '}
            <span className={p.clase} data-parte={p.clave}>
              {p.texto}
            </span>
          </span>
        ))}
    </span>
  )
}
