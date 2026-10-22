import Link from 'next/link'
import { ChevronDown, ClipboardList, PackageCheck, Truck, Workflow } from 'lucide-react'

import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { Insignia, Punto, type Tono } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Tarjeta } from '@/components/ui/tarjeta'
import type { CorreccionVista } from '@/lib/datos/correcciones'
import type { LineaRequerimiento, MaterialParaRequerimiento, RequerimientoListado } from '@/lib/datos/requerimientos'
import type { CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import {
  COMPRA_CORTA,
  estadoDelRequerimiento,
  ESTADOS_RQ_ABIERTOS,
  ETAPA_AVANCE_RQ,
  ETAPAS_DE_RECOJO,
  FALTA_LO_NO_COMPRADO,
  laCompraQuedoCorta,
  PASOS_DEL_RQ,
  partesDelInsumo,
  pasoDelRequerimiento,
  quienCompra,
  YA_LLEGO_TODO,
  yaLlegoTodo,
  type PartesDelInsumo,
  type PasoDelRq,
} from '@/lib/dominio/requerimientos'
import { cantidad, diasHasta, fecha, fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'

import { MaterialDelInsumo } from './avance'
import { AnularRequerimiento } from './controles'
import { CorregirRequerimiento } from './corregir'

const abierto = (estado: string) => (ESTADOS_RQ_ABIERTOS as readonly string[]).includes(estado)

/** El color de lo que falta que llegue, por la etapa de su compra. Cada clase entera: Tailwind no ve las que se arman. */
const BARRA: Record<Tono, string> = {
  neutro: 'bg-texto-tenue',
  exito: 'bg-exito',
  aviso: 'bg-aviso',
  peligro: 'bg-peligro',
  info: 'bg-info',
  acento: 'bg-acento',
}
const TEXTO: Record<Tono, string> = {
  neutro: 'text-texto-suave',
  exito: 'text-exito',
  aviso: 'text-aviso',
  peligro: 'text-peligro',
  info: 'text-info',
  acento: 'text-acento',
}

/**
 * El tono de lo que falta que llegue: el de la etapa de su OC, o rojo si Gerencia
 * la rechazó. Lo que falta nunca va en verde: si la OC ya entró y no alcanzó, ámbar.
 */
function tonoPorLlegar(l: LineaRequerimiento, partes: PartesDelInsumo | null): Tono {
  if (l.compra_rechazada) return 'peligro'
  if (partes && laCompraQuedoCorta(l, partes)) return COMPRA_CORTA.tono
  return (l.etapa && ETAPA_AVANCE_RQ[l.etapa]?.tono) || 'aviso'
}

/**
 * Los dos recojos no son el mismo: el conductor recoge la compra del proveedor
 * y el área recoge lo suyo en Almacén. Junto a «para recoger en Almacén», la
 * etapa de la compra dice de dónde.
 */
const delProveedor = (etapa: string | null) => (ETAPAS_DE_RECOJO as readonly (string | null)[]).includes(etapa)

/** ¿Está en compra y ya llegó todo lo que faltaba? Almacén todavía no lo marca listo. */
function llegoTodo(rq: RequerimientoListado): boolean {
  return (rq.estado === 'SIN_STOCK' || rq.estado === 'EN_ATENCION') && yaLlegoTodo(rq.lineas.map((l) => partesDelInsumo(l, rq.estado)))
}

/**
 * Las partes con lo que la OC no compró fuera de «por llegar»: nadie lo trae, así
 * que no detiene el paso en la compra. Lo que se pinta en la barra no cambia.
 */
function partesParaElPaso(rq: RequerimientoListado): (PartesDelInsumo | null)[] {
  return rq.lineas.map((l) => {
    const p = partesDelInsumo(l, rq.estado)
    return p && laCompraQuedoCorta(l, p) ? { ...p, porLlegar: 0 } : p
  })
}

/** ¿En compra, con lo comprado ya en almacén y el resto sin ninguna compra? */
function soloFaltaLoNoComprado(rq: RequerimientoListado): boolean {
  return (rq.estado === 'SIN_STOCK' || rq.estado === 'EN_ATENCION') && !llegoTodo(rq) && yaLlegoTodo(partesParaElPaso(rq))
}

/** ¿Tiene algún insumo que ya se puede recoger en Almacén? */
export function tieneParaRecoger(rq: RequerimientoListado): boolean {
  return rq.lineas.some((l) => (partesDelInsumo(l, rq.estado)?.recoger ?? 0) > 0)
}

/**
 * Las cuatro cifras de arriba: cuántos insumos ya se pueden recoger en Almacén
 * (al tocarla, solo esos RQ), cuántos faltan que lleguen y cuántos de ellos
 * esperan su recojo del proveedor o van en él, cuántos revisa Almacén y cuántos
 * RQ van en camino. Cuentan insumos, no unidades: cada uno va en la suya.
 */
export function ResumenDeRequerimientos({
  requerimientos,
  enlaceRecoger,
}: {
  requerimientos: RequerimientoListado[]
  /** La lista con solo los RQ que tienen algo para recoger; `null` si ya es esa lista. */
  enlaceRecoger: string | null
}) {
  let recoger = 0
  let porLlegar = 0
  let noComprados = 0
  let revisar = 0
  // Lo que Gerencia pidió distinguir de un vistazo (PR #76): los dos momentos del recojo del proveedor.
  let esperanRecojo = 0
  let enRecojo = 0
  const compran = new Set<string>()
  for (const rq of requerimientos) {
    for (const l of rq.lineas) {
      const p = partesDelInsumo(l, rq.estado)
      if (!p) continue
      if (p.recoger > 0) recoger++
      if (p.revisar > 0) revisar++
      // Lo que la OC no compró ya no lo trae nadie: se cuenta aparte, no como de Logística.
      if (p.porLlegar > 0 && laCompraQuedoCorta(l, p)) noComprados++
      else if (p.porLlegar > 0) {
        porLlegar++
        compran.add(quienCompra(rq))
        if (l.etapa === 'PENDIENTE_RECOJO') esperanRecojo++
        if (l.etapa === 'EN_RECOJO') enRecojo++
      }
    }
  }
  const enCamino = requerimientos.filter((r) => abierto(r.estado)).length
  const listos = requerimientos.filter((r) => r.estado === 'LISTO_EN_ALMACEN' || llegoTodo(r)).length
  const quien = compran.size === 1 ? `que trae ${[...compran][0]}` : compran.size > 1 ? 'que traen Logística y Administración' : 'que se compran'
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-resumen-rq>
      <Indicador
        titulo="Para recoger en Almacén"
        valor={recoger}
        icono={PackageCheck}
        tono={recoger > 0 ? 'exito' : 'neutro'}
        pie={
          recoger > 0
            ? `${recoger === 1 ? 'insumo ya en almacén' : 'insumos ya en almacén'}${enlaceRecoger ? ': tócalo para ver cuáles' : ': son los de abajo'}`
            : 'nada en almacén todavía'
        }
        href={recoger > 0 && enlaceRecoger ? enlaceRecoger : undefined}
      />
      <Indicador
        titulo="Por llegar"
        valor={porLlegar}
        icono={Truck}
        tono={porLlegar > 0 || noComprados > 0 ? 'aviso' : 'neutro'}
        pie={
          <>
            {(porLlegar > 0 || noComprados === 0) && `${porLlegar === 1 ? 'insumo' : 'insumos'} ${quien}`}
            {noComprados > 0 && (
              <span className="block text-aviso">
                {porLlegar > 0 ? 'y ' : ''}
                {noComprados} que la OC compró de menos: {noComprados === 1 ? 'se pide' : 'se piden'} en un RQ nuevo
              </span>
            )}
            {(esperanRecojo > 0 || enRecojo > 0) && (
              <span className="block">
                {[
                  esperanRecojo > 0 ? `${esperanRecojo} ${esperanRecojo === 1 ? 'espera' : 'esperan'} su recojo del proveedor` : null,
                  enRecojo > 0 ? `${enRecojo} en recojo` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </>
        }
      />
      <Indicador titulo="Almacén revisa" valor={revisar} icono={ClipboardList} pie={revisar === 1 ? 'insumo sin revisar el stock' : 'insumos sin revisar el stock'} />
      <Indicador
        titulo="Requerimientos en camino"
        valor={enCamino}
        icono={Workflow}
        tono={enCamino > 0 ? 'acento' : 'neutro'}
        pie={listos > 0 ? `${listos} ${listos === 1 ? 'completo' : 'completos'} en almacén` : 'ninguno completo todavía'}
      />
    </div>
  )
}

/**
 * Un requerimiento como tarjeta: arriba qué es y para qué unidad, en medio los
 * cuatro pasos, y abajo cada insumo con su barra partida en lo que ya se
 * entregó, lo que se recoge en Almacén y lo que falta que traiga Logística.
 * Rehecha el 2026-10-20 a pedido de DKS: la tabla decía «Almacén 10 · compra 5»
 * en letra chica y Maestranza no veía de un vistazo qué podía ir a recoger.
 */
export function TarjetaRequerimiento({
  rq,
  insumosAbiertos,
  enlaceCodigo,
  anula,
  materiales,
  codigos,
  correcciones,
}: {
  rq: RequerimientoListado
  insumosAbiertos: boolean
  /** A dónde lleva el código interno: la lista con solo los RQ de ese código. */
  enlaceCodigo: string
  /** Quien lleva su tipo: lo anula y lo corrige. */
  anula: boolean
  materiales: MaterialParaRequerimiento[]
  codigos: CodigoParaElegir[] | null
  correcciones: CorreccionVista[] | undefined
}) {
  // En compra pero con todo ya en almacén, la insignia no dice «En compra»: lo dicen la barra y los pasos.
  const estado = llegoTodo(rq) ? YA_LLEGO_TODO : soloFaltaLoNoComprado(rq) ? FALTA_LO_NO_COMPRADO : estadoDelRequerimiento(rq)
  const plazo = abierto(rq.estado) ? diasHasta(rq.fecha_requerida) : null
  const corrige = anula && rq.estado !== 'ENTREGADO' && rq.estado !== 'ANULADO'
  const anulable = anula && (rq.estado === 'POR_ATENDER' || rq.estado === 'SIN_STOCK')
  return (
    <Tarjeta className="overflow-hidden" data-rq={rq.numero}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="tabular text-base leading-tight font-semibold text-texto">{rq.numero}</h2>
            {estado ? (
              <Insignia tono={estado.tono} title={estado.descripcion}>
                {estado.etiqueta}
              </Insignia>
            ) : (
              <Insignia>{rq.estado}</Insignia>
            )}
            {rq.tipo === 'ADMINISTRACION' && <Insignia tono="acento">Administración</Insignia>}
            {plazo !== null && plazo < 0 && <Insignia tono="peligro">Se necesitaba el {fecha(rq.fecha_requerida)}</Insignia>}
            {plazo === 0 && <Insignia tono="aviso">Se necesita hoy</Insignia>}
            {plazo === 1 && <Insignia tono="aviso">Se necesita mañana</Insignia>}
          </div>
          <p className="mt-1 text-sm text-texto">
            {rq.area} ·{' '}
            <Link
              href={`${enlaceCodigo}${encodeURIComponent(rq.codigo_interno)}`}
              title="Ver los requerimientos de este código interno"
              className="inline-flex min-h-11 items-center font-mono font-medium text-acento hover:underline sm:min-h-0"
            >
              {rq.codigo_interno}
            </Link>
          </p>
          <p className="mt-1 text-sm break-words text-texto-suave">{rq.justificacion}</p>
          <p className="mt-0.5 text-xs text-texto-tenue">
            {[`Registrado ${fechaHora(rq.creado_en)}`, rq.fecha_requerida ? `se necesita el ${fecha(rq.fecha_requerida)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {(corrige || anulable) && (
          <div className="flex flex-wrap items-center gap-2">
            {corrige && <CorregirRequerimiento rq={rq} materiales={materiales} codigos={codigos} />}
            {anulable && <AnularRequerimiento id={rq.id} numero={rq.numero} />}
          </div>
        )}
      </div>

      {rq.estado === 'ANULADO' ? (
        rq.motivo_anulacion && <p className="px-4 pb-3 text-sm text-peligro">Anulado: {rq.motivo_anulacion}</p>
      ) : (
        <PasosDelRequerimiento rq={rq} />
      )}

      <InsumosConPartes rq={rq} abierto={insumosAbiertos} />

      {(rq.nota_almacen || rq.entregado_en || (correcciones && correcciones.length > 0)) && (
        <div className="space-y-0.5 border-t border-borde bg-superficie-2 px-4 py-2 text-xs text-texto-suave">
          {rq.nota_almacen && <p className="break-words">Almacén: {rq.nota_almacen}</p>}
          {rq.entregado_en && (
            <p>
              Entregado {fechaHora(rq.entregado_en)}
              {rq.nota_entrega ? ` a ${rq.nota_entrega}` : ''}
            </p>
          )}
          {/* Entregado con faltante: qué no salió del kardex y por qué, para quien lo pidió. */}
          {rq.faltante_al_entregar && (
            <div className="space-y-0.5" data-faltante>
              <p className="break-words text-texto">
                <span className="font-medium text-aviso">No salió del kardex:</span> {rq.faltante_al_entregar}
              </p>
              {rq.motivo_del_faltante && (
                <p className="break-words">
                  <span className="font-medium text-texto">Motivo:</span> {rq.motivo_del_faltante}
                </p>
              )}
            </div>
          )}
          <HistorialDeCorrecciones correcciones={correcciones} />
        </div>
      )}
    </Tarjeta>
  )
}

const TITULO_PASO: Record<PasoDelRq, string> = {
  REVISION: 'Almacén revisa',
  COMPRA: 'compra',
  EN_ALMACEN: 'Para recoger',
  ENTREGADO: 'Entregado',
}

/**
 * Los cuatro pasos del RQ: Almacén lo revisa, Logística compra lo que falta, el
 * área lo recoge y queda entregado. El de ahora va marcado; la compra dice «no
 * hizo falta» cuando Almacén tenía todo.
 */
function PasosDelRequerimiento({ rq }: { rq: RequerimientoListado }) {
  const actual = pasoDelRequerimiento(rq.estado, partesParaElPaso(rq))
  if (!actual) return null
  const indice = PASOS_DEL_RQ.indexOf(actual)
  const sinCompra =
    indice >= PASOS_DEL_RQ.indexOf('EN_ALMACEN') && rq.lineas.every((l) => !l.orden_compra && l.en_stock !== null && l.en_stock >= l.cantidad)
  // Mientras se compra el resto, lo que Almacén ya tenía se puede ir recogiendo:
  // el paso queda a medias, como dice la barra de cada insumo.
  const aMedias = indice < PASOS_DEL_RQ.indexOf('EN_ALMACEN') && tieneParaRecoger(rq)
  const etiqueta = (p: PasoDelRq) =>
    p === 'COMPRA' ? (
      <>
        {/* En el teléfono la columna mide unos 77 px: «Administración» no entra. */}
        <span className="sm:hidden">Compra</span>
        <span className="hidden sm:inline">{quienCompra(rq)} compra</span>
      </>
    ) : (
      TITULO_PASO[p]
    )
  return (
    <div className="px-4 pb-3">
      <ol className="grid grid-cols-4 gap-1.5" aria-label={`En qué va ${rq.numero}`}>
        {PASOS_DEL_RQ.map((p, i) => {
          const hecho = i < indice || actual === 'ENTREGADO'
          const ahora = i === indice && actual !== 'ENTREGADO'
          const saltado = p === 'COMPRA' && sinCompra
          const parcial = p === 'EN_ALMACEN' && aMedias
          return (
            <li key={p} aria-current={ahora ? 'step' : undefined} className="min-w-0" data-paso={p}>
              <span
                aria-hidden
                className={cn(
                  'block h-1.5 overflow-hidden rounded-full',
                  saltado ? 'bg-neutro-suave' : hecho ? 'bg-exito' : ahora ? 'bg-acento' : 'bg-neutro-suave',
                )}
              >
                {parcial && <span className="block h-full w-1/2 bg-exito" />}
              </span>
              <span
                className={cn(
                  'mt-1 block text-xs leading-tight',
                  ahora ? 'font-semibold text-texto' : (hecho && !saltado) || parcial ? 'text-texto-suave' : 'text-texto-tenue',
                )}
              >
                {etiqueta(p)}
                {saltado && <span className="block">no hizo falta</span>}
                {parcial && <span className="block font-medium text-exito">ya hay una parte</span>}
                <span className="sr-only">{hecho && !saltado ? ': hecho' : ahora ? ': va aquí' : ''}</span>
              </span>
            </li>
          )
        })}
      </ol>
      {/* El porcentaje sale de la etapa del insumo más atrasado, no de lo recibido (lo dice la «i» de la página).
          Con todo en almacén ya lo dicen los pasos, y un 85 % al lado parecía contradecirlos. */}
      {rq.avance && actual !== 'ENTREGADO' && !llegoTodo(rq) && (
        <p className="mt-1.5 text-xs text-texto-suave">
          Avance <span className="tabular font-medium text-texto">{rq.avance.porcentaje} %</span>
        </p>
      )}
    </div>
  )
}

/**
 * Los insumos, cada uno con su barra. Cerrado, dice cuántos tienen algo para
 * recoger, por llegar, por revisar o ya entregado. Se abre solo mientras el RQ
 * va en camino: lo entregado y lo anulado quedan para consultar.
 */
function InsumosConPartes({ rq, abierto: abiertoPorDefecto }: { rq: RequerimientoListado; abierto: boolean }) {
  const partes = rq.lineas.map((l) => partesDelInsumo(l, rq.estado))
  const cuenta = (k: keyof PartesDelInsumo) => partes.filter((p) => p && p[k] > 0).length
  const fichas = [
    { n: cuenta('recoger'), texto: 'para recoger', tono: 'exito' as Tono },
    { n: cuenta('porLlegar'), texto: 'por llegar', tono: 'aviso' as Tono },
    { n: cuenta('revisar'), texto: 'por revisar', tono: 'neutro' as Tono },
    { n: cuenta('entregado'), texto: cuenta('entregado') === 1 ? 'entregado' : 'entregados', tono: 'neutro' as Tono },
    { n: rq.lineas.filter((l) => sinSalida(l, rq) > 0).length, texto: 'no salió del kardex', tono: 'aviso' as Tono },
  ].filter((f) => f.n > 0)
  const total = rq.lineas.length
  return (
    <details open={abiertoPorDefecto || undefined} className="group border-t border-borde" data-insumos={rq.numero}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-superficie-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-sm font-medium text-texto">
          <ChevronDown aria-hidden className="size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-180" />
          {total} {total === 1 ? 'insumo' : 'insumos'}
        </span>
        {/* Abierto, cada insumo lo dice en su unidad: las fichas, que cuentan insumos, se esconden para no leer «1 para recoger» junto a «7 UND para recoger». */}
        {fichas.length > 0 && (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-texto-suave group-open:hidden">
            {fichas.map((f) => (
              <span key={f.texto} className="inline-flex items-center gap-1.5">
                <Punto tono={f.tono} />
                {f.n} {f.texto}
              </span>
            ))}
          </span>
        )}
      </summary>
      <ul className="divide-y divide-borde border-t border-borde">
        {rq.lineas.map((l, i) => (
          <InsumoConPartes key={l.item} linea={l} partes={partes[i]} rq={rq} />
        ))}
      </ul>
    </details>
  )
}

/** Lo que no salió del kardex al entregar el RQ con faltante; 0 en los demás. */
const sinSalida = (l: LineaRequerimiento, rq: RequerimientoListado) => (rq.estado === 'ENTREGADO' ? Math.max(l.sin_salida ?? 0, 0) : 0)

function InsumoConPartes({ linea: l, partes, rq }: { linea: LineaRequerimiento; partes: PartesDelInsumo | null; rq: RequerimientoListado }) {
  const tono = tonoPorLlegar(l, partes)
  const noSalio = sinSalida(l, rq)
  const corta = partes !== null && laCompraQuedoCorta(l, partes)
  const etapa = corta ? COMPRA_CORTA : l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : null
  const u = l.unidad
  return (
    <li className="px-4 py-3" data-insumo={l.item}>
      <p className="text-sm break-words text-texto">
        <span className="tabular font-semibold">
          {cantidad(l.cantidad)} {u}
        </span>{' '}
        {l.descripcion}
      </p>
      <p className="text-xs text-texto-suave">
        <MaterialDelInsumo linea={l} />
        {l.categoria}
      </p>
      {partes && (
        <>
          <BarraDePartes partes={partes} tonoPorLlegar={tono} noSalio={noSalio} />
          <ul className="mt-1.5 flex flex-col gap-1 text-xs sm:flex-row sm:flex-wrap sm:gap-x-5">
            {partes.recoger > 0 && (
              <Parte color="bg-exito" cifra={`${cantidad(partes.recoger)} ${u}`} data-parte="recoger">
                <span className="font-medium text-exito">para recoger en Almacén</span>
                {rq.estado === 'LISTO_EN_ALMACEN' && rq.listo_en_almacen_en && (
                  <span className="text-texto-suave"> desde {fechaHora(rq.listo_en_almacen_en)}</span>
                )}
              </Parte>
            )}
            {partes.porLlegar > 0 && (
              <Parte color={BARRA[tono]} cifra={`${cantidad(partes.porLlegar)} ${u}`} data-parte="por-llegar">
                <span className="text-texto">
                  {partes.porLlegar === 1 ? 'falta' : 'faltan'}
                  {!corta && ` de ${quienCompra(rq)}`}
                </span>
                {l.orden_compra && (
                  <span className={cn('tabular', l.compra_rechazada ? 'text-peligro' : 'text-texto-suave')}>
                    {' · '}
                    {l.orden_compra}
                    {l.compra_anulada ? ' anulada' : l.compra_rechazada ? ' rechazada' : ''}
                  </span>
                )}
                {etapa && (
                  <span className={TEXTO[tono]}>
                    {' · '}
                    {etapa.etiqueta}
                    {delProveedor(l.etapa) && ' del proveedor'}
                  </span>
                )}
                {l.etapa_desde && !corta && <span className="text-texto-suave"> desde {fechaHora(l.etapa_desde)}</span>}
              </Parte>
            )}
            {partes.revisar > 0 && (
              <Parte color="bg-borde-fuerte" cifra={`${cantidad(partes.revisar)} ${u}`} data-parte="revisar">
                <span className="text-texto-suave">por revisar: Almacén ve si lo tiene</span>
              </Parte>
            )}
            {partes.entregado > 0 && (
              <Parte color="bg-texto-suave" cifra={`${cantidad(partes.entregado)} ${u}`} data-parte="entregado">
                <span className="text-texto-suave">{partes.entregado === 1 ? 'ya se entregó' : 'ya se entregaron'}</span>
              </Parte>
            )}
            {noSalio > 0 && (
              <Parte color="bg-aviso" cifra={`${cantidad(noSalio)} ${u}`} data-parte="no-salio">
                <span className="font-medium text-aviso">no salió del kardex</span>
                <span className="text-texto-suave"> · entregado con faltante</span>
              </Parte>
            )}
          </ul>
        </>
      )}
    </li>
  )
}

/**
 * La barra del insumo, partida en proporción a lo pedido: de lo ya hecho a lo
 * que falta. Primero lo entregado, apagado porque ya no pide nada (en el color
 * del texto, en modo oscuro era el tramo blanco y el que más llamaba); después
 * lo que se recoge, lo que falta y lo que Almacén revisa, al otro extremo para
 * que su gris no se junte con el de lo entregado; en un RQ entregado con
 * faltante, al final lo que no salió del kardex. Es solo para el ojo: la
 * leyenda de abajo dice lo mismo con números, primero lo que pide ir a Almacén.
 */
function BarraDePartes({ partes, tonoPorLlegar, noSalio }: { partes: PartesDelInsumo; tonoPorLlegar: Tono; noSalio: number }) {
  const tramos = [
    { n: partes.entregado, clase: 'bg-texto-suave' },
    { n: partes.recoger, clase: 'bg-exito' },
    { n: partes.porLlegar, clase: BARRA[tonoPorLlegar] },
    { n: partes.revisar, clase: 'bg-borde-fuerte' },
    { n: noSalio, clase: 'bg-aviso' },
  ].filter((t) => t.n > 0)
  return (
    <div aria-hidden className="mt-2 flex h-2.5 w-full max-w-xl gap-0.5 overflow-hidden rounded-full bg-neutro-suave">
      {tramos.map((t, i) => (
        <span key={i} className={cn('h-full min-w-1.5', t.clase)} style={{ flex: `${t.n} 1 0%` }} />
      ))}
    </div>
  )
}

function Parte({ color, cifra, children, ...props }: { color: string; cifra: string; children: React.ReactNode; 'data-parte': string }) {
  return (
    <li className="flex items-start gap-1.5" {...props}>
      <span aria-hidden className={cn('mt-1 size-2 shrink-0 rounded-full', color)} />
      <span className="min-w-0">
        <span className="tabular font-semibold text-texto">{cifra}</span> {children}
      </span>
    </li>
  )
}
