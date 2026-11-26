import Link from 'next/link'
import { ChevronDown, ClipboardList, PackageCheck, Truck, Workflow } from 'lucide-react'

import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { Insignia, Punto, type Tono } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Recorrido } from '@/components/ui/recorrido'
import { Tarjeta } from '@/components/ui/tarjeta'
import type { CorreccionVista } from '@/lib/datos/correcciones'
import type { MetradoDelInsumo } from '@/lib/datos/metrado-rq'
import type { LineaRequerimiento, MaterialParaRequerimiento, RequerimientoListado } from '@/lib/datos/requerimientos'
import type { CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import type { PasoDescrito } from '@/lib/dominio/recorrido'
import { estaVencido, loQueLoAtrasa, plazoDelRq, textoDelPlazo } from '@/lib/dominio/plazo-rq'
import { cuentaDelMetrado, ESTADO_METRADO, FRENO_DEL_RQ, frenaElRq, frenoDelRq, listaDeItems, pideSustento, queFaltaDelFreno } from '@/lib/dominio/metrado-rq'
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
import { cantidad, diasHasta, fecha, fechaHora, porcentaje } from '@/lib/format'
import { cn } from '@/lib/utils'

import { MaterialDelInsumo } from './avance'
import { AnularRequerimiento } from './controles'
import { CorregirRequerimiento } from './corregir'
import { SustentarInsumos } from './metrado/sustentar'

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
  metrado,
}: {
  requerimientos: RequerimientoListado[]
  /** La lista con solo los RQ que tienen algo para recoger; `null` si ya es esa lista. */
  enlaceRecoger: string | null
  /** El metrado de cada insumo: lo frenado no lo revisa Almacén todavía. `null` si no se pudo leer. */
  metrado: Map<string, MetradoDelInsumo> | null
}) {
  let recoger = 0
  let porLlegar = 0
  let noComprados = 0
  let revisar = 0
  let frenados = 0
  const rqFrenados = new Set<string>()
  // Lo que Gerencia pidió distinguir de un vistazo (PR #76): los dos momentos del recojo del proveedor.
  let esperanRecojo = 0
  let enRecojo = 0
  const compran = new Set<string>()
  for (const rq of requerimientos) {
    // Lo que se pasa del metrado sin el visto de Diseño todavía no le toca a Almacén.
    const frenado = metrado !== null && frenoDelRq(rq, metrado) !== null
    for (const l of rq.lineas) {
      const p = partesDelInsumo(l, rq.estado)
      if (!p) continue
      if (p.recoger > 0) recoger++
      if (p.revisar > 0 && frenado) {
        frenados++
        rqFrenados.add(rq.id)
      }
      else if (p.revisar > 0) revisar++
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
      <Indicador
        titulo="Almacén revisa"
        valor={revisar}
        icono={ClipboardList}
        pie={
          <>
            {revisar === 1 ? 'insumo sin revisar el stock' : 'insumos sin revisar el stock'}
            {frenados > 0 && (
              <span className="block text-aviso" data-esperan-metrado>
                y {frenados} {frenados === 1 ? 'insumo' : 'insumos'} de{' '}
                {rqFrenados.size === 1 ? 'un RQ que espera' : `${rqFrenados.size} RQ que esperan`} el sustento o a Diseño
              </span>
            )}
          </>
        }
      />
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
  metrado,
  recorrido,
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
  /** El metrado de cada insumo, por su id; `null` si no se pudo leer. */
  metrado: Map<string, MetradoDelInsumo> | null
  /** Por dónde pasó, quién lo tiene y hace cuántos días; `null` si no se pudo leer. */
  recorrido: PasoDescrito[] | null
}) {
  // En compra pero con todo ya en almacén, la insignia no dice «En compra»: lo dicen la barra y los pasos.
  // Por atender y frenado por el metrado: la insignia y el primer paso dicen quién lo tiene, no «Almacén revisa».
  const freno = metrado ? frenoDelRq(rq, metrado) : null
  const enEspera = freno ? FRENO_DEL_RQ[freno.freno] : null
  const estado = enEspera
    ? { ...enEspera, descripcion: enEspera.etapa }
    : llegoTodo(rq)
      ? YA_LLEGO_TODO
      : soloFaltaLoNoComprado(rq)
        ? FALTA_LO_NO_COMPRADO
        : estadoDelRequerimiento(rq)
  // Lo que le falta o lleva vencido: solo mientras tiene algo por entregar (plan 3, entrega 3.1).
  const plazo = plazoDelRq(rq.estado, diasHasta(rq.fecha_requerida))
  const textoPlazo = plazo !== null ? textoDelPlazo(plazo) : null
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
            {textoPlazo && (
              <Insignia tono={textoPlazo.tono} data-plazo={plazo}>
                {textoPlazo.etiqueta}
              </Insignia>
            )}
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
        <PasosDelRequerimiento rq={rq} enEspera={enEspera?.etiqueta} />
      )}

      {estaVencido(plazo) && <LoQueLoTieneVencido rq={rq} freno={freno} />}

      {metrado && <FrenoDelMetrado rq={rq} metrado={metrado} sustenta={anula} />}

      <InsumosConPartes rq={rq} abierto={insumosAbiertos} metrado={metrado} />

      {/* Para consultar: quién hizo cada paso, quién lo tiene ahora y hace cuántos días. */}
      <Recorrido pasos={recorrido} className="border-t border-borde" />

      {(rq.nota_almacen || rq.entregado_en || (correcciones && correcciones.length > 0)) && (
        <div className="space-y-0.5 border-t border-borde bg-superficie-2 px-4 py-2 text-xs text-texto-suave">
          {rq.nota_almacen && <p className="break-words">Almacén: {rq.nota_almacen}</p>}
          {rq.entregado_en && (
            <p>
              Entregado {fechaHora(rq.entregado_en)}
              {/* La nota la escribe quien entrega («Lo recogió el supervisor»): con «a» delante no se leía. */}
              {rq.nota_entrega ? ` · ${rq.nota_entrega}` : ''}
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

/**
 * En el RQ vencido, qué insumos lo tienen así: lo que ya se puede ir a recoger
 * primero, después lo que falta que llegue o que Almacén revise. Quien lo pidió
 * ve de un vistazo si le toca ir a Almacén o esperar.
 */
function LoQueLoTieneVencido({ rq, freno }: { rq: RequerimientoListado; freno: ReturnType<typeof frenoDelRq> }) {
  // Lo que la OC no compró ya no está «por llegar»: la tarjeta pide un RQ nuevo para eso.
  const falta = loQueLoAtrasa(
    rq.lineas.map((l) => {
      const p = partesDelInsumo(l, rq.estado)
      return { item: l.item, partes: p && laCompraQuedoCorta(l, p) ? { ...p, porLlegar: 0, sinCompra: p.porLlegar } : p }
    }),
  )
  return (
    <p className="border-t border-borde bg-peligro-suave px-4 py-2 text-xs text-texto" data-lo-vencido={rq.numero}>
      <span className="font-medium text-peligro">Se necesitaba el {fecha(rq.fecha_requerida)}.</span>{' '}
      {/* Frenado por el metrado, Almacén no lo puede revisar: decir «por revisar en Almacén» lo culpaba. */}
      {freno
        ? `Lo detiene el metrado de Diseño. ${queFaltaDelFreno(freno)}.`
        : falta.length > 0
          ? `Lo que falta: ${falta.join('; ')}.`
          : 'Ya salió todo de Almacén: falta que Almacén lo dé por entregado.'}
    </p>
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
function PasosDelRequerimiento({ rq, enEspera }: { rq: RequerimientoListado; enEspera?: string }) {
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
    ) : p === 'REVISION' && enEspera ? (
      enEspera
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
      {/* El porcentaje es el promedio de las etapas de los insumos, no lo recibido (lo dice la «i» de la página).
          Con todo en almacén ya lo dicen los pasos, y un 85 % al lado parecía contradecirlos. */}
      {rq.avance && actual !== 'ENTREGADO' && !llegoTodo(rq) && (
        <p className="mt-1.5 text-xs text-texto-suave">
          Avance <span className="tabular font-medium text-texto">{porcentaje(rq.avance.porcentaje)}</span>
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
function InsumosConPartes({
  rq,
  abierto: abiertoPorDefecto,
  metrado,
}: {
  rq: RequerimientoListado
  abierto: boolean
  metrado: Map<string, MetradoDelInsumo> | null
}) {
  const partes = rq.lineas.map((l) => partesDelInsumo(l, rq.estado))
  const frenanElRq = (metrado && frenoDelRq(rq, metrado)?.items) ?? []
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
          <InsumoConPartes key={l.item} linea={l} partes={partes[i]} rq={rq} metrado={metrado?.get(l.id)} frenanElRq={frenanElRq} />
        ))}
      </ul>
    </details>
  )
}

/** Lo que no salió del kardex al entregar el RQ con faltante; 0 en los demás. */
const sinSalida = (l: LineaRequerimiento, rq: RequerimientoListado) => (rq.estado === 'ENTREGADO' ? Math.max(l.sin_salida ?? 0, 0) : 0)

function InsumoConPartes({
  linea: l,
  partes,
  rq,
  metrado,
  frenanElRq,
}: {
  linea: LineaRequerimiento
  partes: PartesDelInsumo | null
  rq: RequerimientoListado
  metrado: MetradoDelInsumo | undefined
  /** Los insumos que frenan la revisión de todo el RQ; vacío si no frena. */
  frenanElRq: number[]
}) {
  const frena = frenaElRq(metrado?.estado) && rq.estado !== 'ANULADO' && rq.estado !== 'ENTREGADO'
  const tono = tonoPorLlegar(l, partes)
  const noSalio = sinSalida(l, rq)
  const corta = partes !== null && laCompraQuedoCorta(l, partes)
  const etapa = corta ? COMPRA_CORTA : l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : null
  const u = l.unidad
  return (
    <li className="px-4 py-3" data-insumo={l.item}>
      <p className="text-sm break-words text-texto">
        {/* El número del insumo: «los insumos 1 y 3» de la línea del vencido y del metrado lo nombran así. */}
        <span className="tabular text-texto-suave">{l.item}.</span>{' '}
        <span className="tabular font-semibold">
          {cantidad(l.cantidad)} {u}
        </span>{' '}
        {l.descripcion}
      </p>
      <p className="text-xs text-texto-suave">
        <MaterialDelInsumo linea={l} />
        {l.categoria}
      </p>
      {metrado && metrado.estado !== 'NO_APLICA' && <MetradoDeLaLinea metrado={metrado} unidad={u} />}
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
                <span className="text-texto-suave">
                  {frena
                    ? metrado?.estado === 'POR_AUTORIZAR'
                      ? 'por revisar cuando Diseño lo autorice'
                      : 'por revisar cuando se sustente y Diseño lo autorice'
                    : frenanElRq.length > 0
                      ? `por revisar cuando Diseño autorice ${frenanElRq.length === 1 ? 'el insumo' : 'los insumos'} ${listaDeItems(frenanElRq)}`
                      : 'por revisar: Almacén ve si lo tiene'}
                </span>
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

/** «2», «2 y 5», «2, 4 y 5». */
const items = (lineas: LineaRequerimiento[]) => listaDeItems(lineas.map((l) => l.item))

/**
 * Lo que frena el RQ por el metrado de Diseño (migración 20261120400000): qué
 * insumos se pasan, quién tiene que hacer qué y, a quien lo registró, el botón
 * para escribir el sustento. Mientras tanto Almacén no lo revisa, Logística no
 * lo compra y no sale del almacén.
 */
function FrenoDelMetrado({
  rq,
  metrado,
  sustenta,
}: {
  rq: RequerimientoListado
  metrado: Map<string, MetradoDelInsumo>
  /** Quien lleva su tipo: lo sustenta. */
  sustenta: boolean
}) {
  if (rq.estado === 'ANULADO' || rq.estado === 'ENTREGADO') return null
  const frenados = rq.lineas.filter((l) => frenaElRq(metrado.get(l.id)?.estado))
  if (frenados.length === 0) return null
  const sinSustento = frenados.filter((l) => metrado.get(l.id)?.estado !== 'POR_AUTORIZAR')
  const esperan = frenados.filter((l) => metrado.get(l.id)?.estado === 'POR_AUTORIZAR')
  const rechazados = frenados.filter((l) => metrado.get(l.id)?.estado === 'RECHAZADO')
  const queFrena =
    rq.estado === 'POR_ATENDER'
      ? 'Almacén revisa el requerimiento cuando Diseño lo autorice.'
      : frenados.length === 1
        ? 'Ese insumo no se compra ni sale del almacén hasta que Diseño lo autorice.'
        : 'Esos insumos no se compran ni salen del almacén hasta que Diseño los autorice.'
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-borde px-4 py-3 text-sm',
        sinSustento.length > 0 ? 'bg-peligro-suave' : 'bg-aviso-suave',
      )}
      data-metrado-frena={rq.numero}
    >
      <div className="min-w-0 flex-1 basis-64 space-y-0.5">
        <p className="font-medium text-texto">
          {frenados.length === 1 ? `El insumo ${items(frenados)} se pasa` : `Los insumos ${items(frenados)} se pasan`} del metrado de Diseño
        </p>
        <p className="text-xs text-texto">
          {sinSustento.length > 0
            ? `${rechazados.length > 0 ? `Diseño no autorizó ${rechazados.length === 1 ? 'el' : 'los'} ${items(rechazados)}: corrige la cantidad o sustenta otra vez. ` : ''}${
                esperan.length > 0
                  ? `Diseño ya tiene el sustento ${esperan.length === 1 ? 'del insumo' : 'de los insumos'} ${items(esperan)}. `
                  : ''
              }${
                sustenta
                  ? esperan.length > 0
                    ? `Escribe por qué ${sinSustento.length === 1 ? 'hace falta el' : 'hacen falta los'} ${items(sinSustento)}, y Diseño lo autoriza o no.`
                    : `Escribe por qué ${sinSustento.length === 1 ? 'hace' : 'hacen'} falta y Diseño lo autoriza o no.`
                  : 'Quien registró el requerimiento escribe por qué hace falta, y Diseño lo autoriza o no.'
              }`
            : `Diseño tiene el sustento de ${esperan.length === 1 ? 'el insumo' : 'los insumos'} ${items(esperan)}: falta su visto.`}{' '}
          {queFrena}
        </p>
      </div>
      {sustenta && (
        <SustentarInsumos
          id={rq.id}
          numero={rq.numero}
          insumos={(sinSustento.length > 0 ? sinSustento : frenados).map((l) => {
            const m = metrado.get(l.id)!
            return {
              item: l.item,
              descripcion: l.descripcion,
              cantidad: l.cantidad,
              unidad: l.unidad,
              metrado: m.metrado,
              pedido_antes: m.pedido_antes,
              exceso: m.exceso,
              planos: m.planos,
              sustento: m.sustento,
              rechazo: m.estado === 'RECHAZADO' ? (m.nota_decision ?? 'sin nota') : null,
            }
          })}
        />
      )}
    </div>
  )
}

/**
 * El insumo contra el metrado: en qué quedó, la cuenta y, si se pasa, el
 * sustento de quien pidió y el visto de Diseño.
 */
function MetradoDeLaLinea({ metrado: m, unidad }: { metrado: MetradoDelInsumo; unidad: string }) {
  const e = ESTADO_METRADO[m.estado]
  return (
    <div className="mt-1 space-y-0.5 text-xs" data-metrado={m.estado}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Insignia tono={e.tono} title={e.descripcion}>
          {e.etiqueta}
        </Insignia>
        <span className="text-texto-suave">{m.estado === 'EN_METRADO' ? enElMetrado(m, unidad) : cuentaDelMetrado(m, unidad)}</span>
      </p>
      {pideSustento(m.estado) || m.estado === 'AUTORIZADO'
        ? m.sustento && (
            <p className="break-words text-texto-suave">
              <span className="font-medium text-texto">Sustento:</span> {m.sustento}
              {m.sustentado_por && <span className="text-texto-tenue"> · {m.sustentado_por}</span>}
            </p>
          )
        : null}
      {m.decision && m.nota_decision && (
        <p className={cn('break-words', m.decision === 'RECHAZADO' ? 'text-peligro' : 'text-texto-suave')}>
          <span className="font-medium">Diseño:</span> {m.nota_decision}
          {m.decidido_por && <span className="text-texto-tenue"> · {m.decidido_por}</span>}
        </p>
      )}
    </div>
  )
}

/** Lo que el insumo deja del metrado: lo que queda por pedir después de él. */
function enElMetrado(m: MetradoDelInsumo, unidad: string) {
  if (m.metrado === null) return ''
  const planos = m.planos ? ` (${m.planos})` : ''
  return `Diseño metró ${cantidad(m.metrado)} ${unidad}${planos}${m.pedido_antes > 0 ? `; los RQ anteriores pidieron ${cantidad(m.pedido_antes)} ${unidad}` : ''}.`
}
