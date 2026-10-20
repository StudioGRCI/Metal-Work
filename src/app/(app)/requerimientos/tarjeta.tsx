import Link from 'next/link'
import { ChevronDown, ClipboardList, PackageCheck, Truck, Workflow } from 'lucide-react'

import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import type { CodigoParaElegir } from '@/components/codigo-interno/elegir-codigo'
import { Insignia, Punto, type Tono } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Tarjeta } from '@/components/ui/tarjeta'
import type { CorreccionVista } from '@/lib/datos/correcciones'
import type { LineaRequerimiento, MaterialParaRequerimiento, RequerimientoListado } from '@/lib/datos/requerimientos'
import {
  ESTADO_REQUERIMIENTO,
  ESTADOS_RQ_ABIERTOS,
  ETAPA_AVANCE_RQ,
  PASOS_DEL_RQ,
  partesDelInsumo,
  pasoDelRequerimiento,
  quienCompra,
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

/** El tono de lo que falta que llegue: el de la etapa de su OC, o rojo si Gerencia la rechazó. */
function tonoPorLlegar(l: LineaRequerimiento): Tono {
  if (l.compra_rechazada) return 'peligro'
  return (l.etapa && ETAPA_AVANCE_RQ[l.etapa]?.tono) || 'aviso'
}

/**
 * Las cuatro cifras de arriba: cuántos insumos ya se pueden recoger en Almacén,
 * cuántos faltan que lleguen, cuántos revisa Almacén y cuántos RQ van en camino.
 * Cuentan insumos, no unidades: cada uno va en la suya.
 */
export function ResumenDeRequerimientos({ requerimientos }: { requerimientos: RequerimientoListado[] }) {
  let recoger = 0
  let porLlegar = 0
  let revisar = 0
  const compran = new Set<string>()
  for (const rq of requerimientos) {
    for (const l of rq.lineas) {
      const p = partesDelInsumo(l, rq.estado)
      if (!p) continue
      if (p.recoger > 0) recoger++
      if (p.revisar > 0) revisar++
      if (p.porLlegar > 0) {
        porLlegar++
        compran.add(quienCompra(rq))
      }
    }
  }
  const enCamino = requerimientos.filter((r) => abierto(r.estado)).length
  const listos = requerimientos.filter((r) => r.estado === 'LISTO_EN_ALMACEN').length
  const quien = compran.size === 1 ? `que trae ${[...compran][0]}` : compran.size > 1 ? 'que traen Logística y Administración' : 'que se compran'
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-resumen-rq>
      <Indicador titulo="Para recoger en Almacén" valor={recoger} icono={PackageCheck} tono={recoger > 0 ? 'exito' : 'neutro'} pie={recoger === 1 ? 'insumo ya en almacén' : 'insumos ya en almacén'} />
      <Indicador titulo="Por llegar" valor={porLlegar} icono={Truck} tono={porLlegar > 0 ? 'aviso' : 'neutro'} pie={`${porLlegar === 1 ? 'insumo' : 'insumos'} ${quien}`} />
      <Indicador titulo="Almacén revisa" valor={revisar} icono={ClipboardList} pie={revisar === 1 ? 'insumo sin revisar el stock' : 'insumos sin revisar el stock'} />
      <Indicador
        titulo="Requerimientos en camino"
        valor={enCamino}
        icono={Workflow}
        tono={enCamino > 0 ? 'acento' : 'neutro'}
        pie={listos > 0 ? `${listos} ${listos === 1 ? 'listo' : 'listos'} en almacén` : 'ninguno listo todavía'}
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
  const estado = ESTADO_REQUERIMIENTO[rq.estado]
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
              className="font-mono font-medium text-acento hover:underline"
            >
              {rq.codigo_interno}
            </Link>
          </p>
          <p className="mt-1 text-sm break-words text-texto-suave">{rq.justificacion}</p>
          <p className="mt-0.5 text-[11px] text-texto-tenue">
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
  const actual = pasoDelRequerimiento(rq.estado)
  if (!actual) return null
  const indice = PASOS_DEL_RQ.indexOf(actual)
  const sinCompra =
    indice >= PASOS_DEL_RQ.indexOf('EN_ALMACEN') && rq.lineas.every((l) => !l.orden_compra && l.en_stock !== null && l.en_stock >= l.cantidad)
  const etiqueta = (p: PasoDelRq) => (p === 'COMPRA' ? `${quienCompra(rq)} compra` : TITULO_PASO[p])
  return (
    <div className="px-4 pb-3">
      <ol className="grid grid-cols-4 gap-1.5" aria-label={`En qué va ${rq.numero}`}>
        {PASOS_DEL_RQ.map((p, i) => {
          const hecho = i < indice || actual === 'ENTREGADO'
          const ahora = i === indice && actual !== 'ENTREGADO'
          const saltado = p === 'COMPRA' && sinCompra
          return (
            <li key={p} aria-current={ahora ? 'step' : undefined} className="min-w-0">
              <span
                aria-hidden
                className={cn('block h-1.5 rounded-full', saltado ? 'bg-neutro-suave' : hecho ? 'bg-exito' : ahora ? 'bg-acento' : 'bg-neutro-suave')}
              />
              <span
                className={cn(
                  'mt-1 block text-[11px] leading-tight',
                  ahora ? 'font-semibold text-texto' : hecho && !saltado ? 'text-texto-suave' : 'text-texto-tenue',
                )}
              >
                {etiqueta(p)}
                {saltado && <span className="block">no hizo falta</span>}
                <span className="sr-only">{hecho && !saltado ? ': hecho' : ahora ? ': va aquí' : ''}</span>
              </span>
            </li>
          )
        })}
      </ol>
      {rq.avance && actual !== 'ENTREGADO' && (
        <p className="mt-1.5 text-[11px] text-texto-suave">
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
  ].filter((f) => f.n > 0)
  const total = rq.lineas.length
  return (
    <details open={abiertoPorDefecto || undefined} className="group border-t border-borde" data-insumos={rq.numero}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-superficie-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5 text-sm font-medium text-texto">
          <ChevronDown aria-hidden className="size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-180" />
          {total} {total === 1 ? 'insumo' : 'insumos'}
        </span>
        {fichas.length > 0 && (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-texto-suave">
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

function InsumoConPartes({ linea: l, partes, rq }: { linea: LineaRequerimiento; partes: PartesDelInsumo | null; rq: RequerimientoListado }) {
  const tono = tonoPorLlegar(l)
  const etapa = l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : null
  const u = l.unidad
  return (
    <li className="px-4 py-3" data-insumo={l.item}>
      <p className="text-sm break-words text-texto">
        <span className="tabular font-semibold">
          {cantidad(l.cantidad)} {u}
        </span>{' '}
        {l.descripcion}
      </p>
      <p className="text-[11px] text-texto-suave">
        <MaterialDelInsumo linea={l} />
        {l.categoria}
      </p>
      {partes && (
        <>
          <BarraDePartes partes={partes} tonoPorLlegar={tono} />
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
                  {partes.porLlegar === 1 ? 'falta' : 'faltan'} de {quienCompra(rq)}
                </span>
                {l.orden_compra && (
                  <span className={cn('tabular', l.compra_rechazada ? 'text-peligro' : 'text-texto-suave')}>
                    {' · '}
                    {l.orden_compra}
                    {l.compra_rechazada ? ' rechazada' : ''}
                  </span>
                )}
                {etapa && (
                  <span className={TEXTO[tono]}>
                    {' · '}
                    {etapa.etiqueta}
                  </span>
                )}
                {l.etapa_desde && <span className="text-texto-suave"> desde {fechaHora(l.etapa_desde)}</span>}
              </Parte>
            )}
            {partes.revisar > 0 && (
              <Parte color="bg-borde-fuerte" cifra={`${cantidad(partes.revisar)} ${u}`} data-parte="revisar">
                <span className="text-texto-suave">por revisar: Almacén ve si lo tiene</span>
              </Parte>
            )}
            {partes.entregado > 0 && (
              <Parte color="bg-texto-tenue" cifra={`${cantidad(partes.entregado)} ${u}`} data-parte="entregado">
                <span className="text-texto-suave">{partes.entregado === 1 ? 'ya se entregó' : 'ya se entregaron'}</span>
              </Parte>
            )}
          </ul>
        </>
      )}
    </li>
  )
}

/**
 * La barra del insumo, partida en lo entregado, lo que se recoge, lo que falta
 * y lo que Almacén revisa, en proporción a lo pedido. Es solo para el ojo: la
 * leyenda de abajo dice lo mismo con números.
 */
function BarraDePartes({ partes, tonoPorLlegar }: { partes: PartesDelInsumo; tonoPorLlegar: Tono }) {
  const tramos = [
    { n: partes.entregado, clase: 'bg-texto-tenue' },
    { n: partes.recoger, clase: 'bg-exito' },
    { n: partes.porLlegar, clase: BARRA[tonoPorLlegar] },
    { n: partes.revisar, clase: 'bg-borde-fuerte' },
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
