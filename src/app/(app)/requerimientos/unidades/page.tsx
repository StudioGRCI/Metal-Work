import Link from 'next/link'
import { redirect } from 'next/navigation'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { etapasDeCodigo, planosDeCodigo, type EtapaDeCodigo } from '@/lib/datos/diseno-codigos'
import {
  cargarRequerimientos,
  catalogosDelRequerimiento,
  seguimientoDeInsumos,
  type RequerimientoListado,
  type SeguimientoDelInsumo,
} from '@/lib/datos/requerimientos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { CODIGO_FIJO_PLANTA, llaveParecido, normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { PERMISO_OTS_DE_MANTENIMIENTO } from '@/lib/dominio/mantenimiento'
import { esGastoOperativo, ESTADOS_RQ_ABIERTOS, estadoDelRequerimiento, GASTO_OPERATIVO } from '@/lib/dominio/requerimientos'
import { diaLima, fecha, hoyLima, porcentaje, sumarDias } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { InsumosDelRequerimiento } from './insumos'
import { AvisoDeLaUnidad, BotonPedirParaUnidad, PedirPorUnidad } from './pedir'

export const metadata = { title: 'RQ por unidad' }

/** Lo de una unidad en el área: sus etapas, los planos que faltan recibir y sus RQ. */
type DeLaUnidad = { etapas: EtapaDeCodigo[]; porRecibir: number; rqs: RequerimientoListado[] }

/** Cuántos RQ en camino se pintan en la tarjeta: en el teléfono, siete ocupaban media pantalla. */
const MAS_EN_LA_TARJETA = 3

/** Los entregados en estos días siguen en la tarjeta, para ver quién recibió cada insumo. */
const DIAS_DEL_ENTREGADO = 7
/** Y como mucho estos, debajo de los que van en camino. */
const ENTREGADOS_EN_LA_TARJETA = 2

/** Cómo va cada insumo: `null` si la base no lo dio; la tarjeta lo dice. */
type Seguimiento = Map<string, SeguimientoDelInsumo> | null

const abierto = (r: RequerimientoListado) => (ESTADOS_RQ_ABIERTOS as readonly string[]).includes(r.estado)
/** Entregado desde `desde` (un día de Lima, YYYY-MM-DD) en adelante. */
const recienEntregado = (r: RequerimientoListado, desde: string) =>
  r.estado === 'ENTREGADO' && r.entregado_en !== null && diaLima(r.entregado_en) >= desde
/** Al área todavía le falta algo con la unidad: una etapa sin terminar, un plano por recibir o un RQ que no llega. */
const sigueEnElArea = (u: DeLaUnidad, desde: string) =>
  u.porRecibir > 0 || u.etapas.some((e) => !e.fin_real) || u.rqs.some((r) => abierto(r) || recienEntregado(r, desde))
/** Ya se trabaja en ella: la etapa empezó o tiene fecha, o hay un plano por recibir. */
const enMarcha = (u: DeLaUnidad) => u.porRecibir > 0 || u.etapas.some((e) => !e.fin_real && (e.inicio_real || e.inicio_plan))

function estadoDeEtapa(e: EtapaDeCodigo): { texto: string; tono: Tono } {
  if (e.fin_real) return { texto: 'Terminada', tono: 'exito' }
  if (e.inicio_real) return { texto: 'En marcha', tono: 'info' }
  if (e.inicio_plan) return { texto: `Empieza ${fecha(e.inicio_plan)}`, tono: 'neutro' }
  return { texto: 'Sin fecha', tono: 'neutro' }
}

/**
 * Las unidades que tiene el área del supervisor, cada una con lo que su área
 * hace en ella y sus requerimientos, para pedir el material de cada una desde
 * su tarjeta (pedido de supervisión de Acabados, 20/11/2026). Una unidad está
 * en el área mientras le falta algo ahí: una etapa sin terminar, un plano por
 * recibir o un RQ que todavía no se entrega. Lo que no es de una unidad va en
 * PLANTA, al final.
 *
 * Las etapas y los planos son los de «Planos y etapas»; los RQ, los que pidió
 * el área. El permiso es el mismo que exige la base para registrar
 * (`requerimientos.area`, `rq_exigir_del_area`).
 */
export default async function PaginaRqPorUnidad({ searchParams }: PageProps<'/requerimientos/unidades'>) {
  const perfil = await exigirPermiso('requerimientos.area')
  // Mantenimiento no trabaja unidades de fabricación: pide por el N.º de su OT,
  // desde su lista de OT (A.3). Esta pantalla lee planos y etapas, que no ve.
  if (!puede(perfil, 'requerimientos.emitir') && puede(perfil, PERMISO_OTS_DE_MANTENIMIENTO)) redirect('/mantenimiento')
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const area = perfil.area_id

  // Los RQ en camino se leen aparte: la lista de recientes llega hasta 300, y
  // un RQ abierto más viejo que eso sacaría a su unidad de la pantalla.
  // Con lo entregado de cada insumo: el que ya salió entero va entregado aunque otro del RQ siga en compra.
  const delArea = area ? cargarRequerimientos({ area, tipo: 'OPERACION', conEntregado: true }) : Promise.resolve([])
  const abiertos = area ? cargarRequerimientos({ area, tipo: 'OPERACION', soloAbiertos: true, conEntregado: true }) : Promise.resolve([])
  // Lo que el supervisor no lee de cada insumo (el visto de Diseño, cuándo
  // llega, quién lo recibió), de los RQ que la tarjeta pinta, en cuanto llegan.
  const desde = sumarDias(hoyLima(), -DIAS_DEL_ENTREGADO)
  const delSeguimiento: Promise<Seguimiento> = Promise.all([delArea, abiertos])
    .then(([a, b]) => seguimientoDeInsumos([...a, ...b].filter((r) => abierto(r) || recienEntregado(r, desde)).map((r) => r.id)))
    .catch((e: unknown) => {
      console.error('RQ por unidad: no se pudo leer cómo va cada insumo.', e)
      return null
    })
  const [planos, etapas, recientes, enCamino, catalogos, seguimiento] = await Promise.all([
    area ? planosDeCodigo(null, { conPeso: false }) : Promise.resolve([]),
    area ? etapasDeCodigo(null) : Promise.resolve([]),
    delArea,
    abiertos,
    catalogosDelRequerimiento(),
    delSeguimiento,
  ])
  const requerimientos = [...new Map([...recientes, ...enCamino].map((r) => [r.id, r])).values()]
  // Sin la lista de códigos no se sabe qué unidad está entregada ni cuáles
  // tiene el padrón: se dice, no se pinta vacío.
  const sinPadron = catalogos.codigos === null
  const areaFija = catalogos.areas.find((a) => a.id === area && a.requerimiento === 'OPERACION')
  const unidadDe = new Map((catalogos.codigos ?? []).map((c) => [c.codigo, c.unidad]))
  // Gerencia cerró el costeo al entregarla: la pantalla ya no la ofrece para
  // pedir (la base no lo impide: «Nuevo RQ con otro código» sí la acepta).
  const cerrados = new Set((catalogos.codigos ?? []).filter((c) => c.cerrado).map((c) => c.codigo))

  // Lo de cada código, juntado de una pasada.
  const porCodigo = new Map<string, DeLaUnidad>()
  const de = (codigo: string) => {
    const hay = porCodigo.get(codigo)
    if (hay) return hay
    const nuevo: DeLaUnidad = { etapas: [], porRecibir: 0, rqs: [] }
    porCodigo.set(codigo, nuevo)
    return nuevo
  }
  for (const e of etapas) if (e.area_id === area) de(e.codigo).etapas.push(e)
  for (const p of planos) if (p.area_id === area && !p.anulado_en && !p.recibido_en) de(p.codigo).porRecibir++
  const dePlanta: RequerimientoListado[] = []
  for (const r of requerimientos) {
    if (normalizarCodigo(r.codigo_interno) === CODIGO_FIJO_PLANTA.codigo) dePlanta.push(r)
    else de(normalizarCodigo(r.codigo_interno)).rqs.push(r)
  }

  // Se busca por el código o por la placa y la marca, como en el buscador de código.
  const palabras = palabrasDeBusqueda(q)
  const llave = llaveParecido(q)
  const buscado = (codigo: string) =>
    !q || coincide(palabras, [codigo, unidadDe.get(codigo) ?? '']) || (llave !== '' && llaveParecido(codigo).includes(llave))

  // Una unidad entregada sale aunque Diseño no haya cerrado sus etapas; si le
  // queda un RQ en camino, se ve para seguirlo, sin «Nuevo RQ».
  const enElArea = [...porCodigo.entries()].filter(([codigo, u]) => (cerrados.has(codigo) ? u.rqs.some(abierto) : sigueEnElArea(u, desde)))
  const unidades = enElArea
    .filter(([codigo]) => buscado(codigo))
    .sort(([a, ua], [b, ub]) => Number(enMarcha(ub)) - Number(enMarcha(ua)) || (a < b ? -1 : a > b ? 1 : 0))
  const conRqAbierto = enElArea.filter(([, u]) => u.rqs.some(abierto)).length
  // Las demás unidades del padrón que siguen en el taller (sin costeo cerrado):
  // mientras Diseño no carga etapas ni planos del área, son la única vista
  // previa que tiene el supervisor, y desde ellas también pide.
  const deLaLista = new Set(enElArea.map(([codigo]) => codigo))
  const otras = (catalogos.codigos ?? [])
    .filter((c) => c.registrada && !c.cerrado && c.codigo !== CODIGO_FIJO_PLANTA.codigo && !deLaLista.has(c.codigo))
    .filter((c) => buscado(c.codigo))

  const vistas = [
    { clave: 'unidades', titulo: 'Por unidad', href: '/requerimientos/unidades', activa: true, cuenta: enElArea.length },
    { clave: 'mia', titulo: 'De tu área', href: '/requerimientos', activa: false },
    { clave: 'todas', titulo: 'Todas las áreas', href: '/requerimientos?area=todas', activa: false },
  ]

  if (!area || !areaFija) {
    return (
      <>
        <EncabezadoPagina titulo="RQ por unidad" migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Por unidad' }]} />
        <Tarjeta>
          <SinDatos
            enTabla={false}
            titulo={area ? 'Tu área no pide por el requerimiento de operación' : 'Tu cuenta no tiene área'}
            descripcion="Pide a Administración que revise el área de tu cuenta: con ella ves aquí sus unidades y pides el material de cada una."
          />
        </Tarjeta>
      </>
    )
  }

  return (
    <PedirPorUnidad {...catalogos} tipos={['OPERACION']} areaFija={areaFija}>
      <EncabezadoPagina
        titulo="RQ por unidad"
        descripcion={`${areaFija.nombre} · ${enElArea.length} ${enElArea.length === 1 ? 'unidad' : 'unidades'}${
          conRqAbierto > 0 ? `, ${conRqAbierto} con requerimientos en camino` : ''
        }`}
        ayuda="Cada unidad que tiene trabajo en tu área, con sus etapas y sus requerimientos. Pide el material de una unidad con «Nuevo RQ» en su tarjeta: el código y el área ya van puestos y le llega a Almacén. En cada requerimiento, «Cómo va cada insumo» dice en qué paso va cada uno, cuándo llega lo que se compra y quién lo recibió del almacén. En la tarjeta de cada unidad quedan los dos últimos RQ entregados en los 7 días, con quién recibió cada insumo. Una unidad sale de aquí cuando tu área terminó sus etapas, recibió sus planos y no tiene RQ en camino ni entregados en esos 7 días; la unidad ya entregada al cliente sale apenas no le queda ningún RQ en camino. Debajo están las demás unidades del taller, para pedir aunque Diseño todavía no cargue el trabajo de tu área. Lo que tu área usa sin ser de una unidad (herramientas, consumibles), pídelo en «Gasto operativo del área», al final: no se carga a ninguna OT."
        migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Por unidad' }]}
        acciones={<BotonPedirParaUnidad codigo={null}>Nuevo RQ con otro código</BotonPedirParaUnidad>}
        estado={<AvisoDeLaUnidad codigo={null} />}
      />

      {/* 20 px entre bloques, 12 entre las tarjetas de la lista (la escala de la skill diseno). */}
      <div className="mb-5 space-y-3">
        {seguimiento === null && (
          <p role="status" className="text-sm text-aviso" data-seguimiento-sin-leer>
            No se pudo leer el visto de Diseño, la fecha en que llega cada compra ni quién recibió cada insumo: los pasos salen sin eso. Recarga la
            página; si continúa, avisa al administrador.
          </p>
        )}
        <Vistas etiqueta="Requerimiento" vistas={vistas} />
        <BuscadorSimple ruta="/requerimientos/unidades" etiqueta="Buscar unidad" marcador="Código interno, placa o marca" />
      </div>

      {unidades.length === 0 ? (
        <Tarjeta className="mb-5">
          <SinDatos
            enTabla={false}
            titulo={q ? 'Ninguna unidad de tu área con esta búsqueda' : 'Ninguna unidad tiene todavía trabajo cargado para tu área'}
            descripcion={
              q && otras.length > 0
                ? 'Está entre las demás unidades del taller: pide desde ahí.'
                : otras.length > 0
                ? 'Aparecen aquí cuando Diseño carga una etapa o un plano de tu área. Mientras tanto, pide desde las demás unidades del taller.'
                : q
                  ? 'Borra la búsqueda con «Limpiar», o pide con «Nuevo RQ con otro código» si la unidad todavía no llega al taller.'
                  : 'Aparecen aquí cuando Diseño carga una etapa o un plano de tu área. Si necesitas material para una unidad, pídelo con «Nuevo RQ con otro código».'
            }
            accion={
              otras.length > 0 ? (
                <a href="#otras-unidades" className="inline-flex min-h-11 items-center text-sm font-medium text-acento hover:underline sm:min-h-0">
                  Ver las demás unidades del taller
                </a>
              ) : undefined
            }
          />
        </Tarjeta>
      ) : (
        <ul className="mb-5 grid items-start gap-3 lg:grid-cols-2" aria-label={`Unidades de ${areaFija.nombre}`}>
          {unidades.map(([codigo, u]) => (
            <li key={codigo}>
              <TarjetaDeUnidad
                yo={perfil.id}
                codigo={codigo}
                unidad={unidadDe.get(codigo) ?? null}
                entregada={cerrados.has(codigo)}
                delArea={u}
                seguimiento={seguimiento}
                desde={desde}
              />
            </li>
          ))}
        </ul>
      )}

      {sinPadron && (
        <Tarjeta className="mb-5">
          <SinDatos
            enTabla={false}
            titulo="No se pudo leer el padrón de unidades"
            descripcion="Faltan las demás unidades del taller y no se sabe cuáles ya se entregaron. Recarga la pantalla; si sigue, pide con «Nuevo RQ con otro código»."
          />
        </Tarjeta>
      )}

      {otras.length > 0 && (
        <Tarjeta className="mb-5" id="otras-unidades">
          <TarjetaCabecera
            titulo={`Las demás unidades del taller (${otras.length})`}
            descripcion="Del padrón de unidades, sin trabajo cargado para tu área todavía. Si ya trabajas en una, pide su material desde aquí."
          />
          <ul className="divide-y divide-borde" aria-label="Las demás unidades del taller">
            {otras.map((c) => (
              <li key={c.codigo} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block font-mono text-sm font-medium text-texto">{c.codigo}</span>
                  {c.unidad && <span className="block truncate text-xs text-texto-suave">{c.unidad}</span>}
                  <AvisoDeLaUnidad codigo={c.codigo} className="mt-1" />
                </span>
                <BotonPedirParaUnidad codigo={c.codigo} variante="contorno" />
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {!q && (
        <Tarjeta>
          <TarjetaCabecera
            titulo={
              <span className="flex flex-wrap items-baseline gap-x-2">
                Gasto operativo del área <span className="font-mono text-sm font-normal text-texto-suave">{CODIGO_FIJO_PLANTA.codigo}</span>
              </span>
            }
            descripcion="Herramientas, consumibles y lo que tu área usa sin ser de una unidad: no se carga a ninguna OT."
            acciones={<BotonPedirParaUnidad codigo={CODIGO_FIJO_PLANTA.codigo} />}
          />
          <TarjetaCuerpo className="space-y-3">
            <AvisoDeLaUnidad codigo={CODIGO_FIJO_PLANTA.codigo} />
            <RequerimientosDeLaUnidad codigo={CODIGO_FIJO_PLANTA.codigo} rqs={dePlanta} seguimiento={seguimiento} desde={desde} yo={perfil.id} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </PedirPorUnidad>
  )
}

function TarjetaDeUnidad({
  codigo,
  unidad,
  entregada,
  delArea,
  seguimiento,
  desde,
  yo,
}: {
  codigo: string
  unidad: string | null
  entregada: boolean
  delArea: DeLaUnidad
  seguimiento: Seguimiento
  desde: string
  yo: string
}) {
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={<span className="font-mono">{codigo}</span>}
        descripcion={unidad ?? undefined}
        // Con borde y no lleno: una tarjeta por unidad son decenas de botones
        // iguales, y llenos ninguno llamaba la atención (entrega 5).
        acciones={entregada ? <Insignia tono="neutro">Entregada</Insignia> : <BotonPedirParaUnidad codigo={codigo} variante="contorno" />}
      />
      <TarjetaCuerpo className="space-y-3">
        <AvisoDeLaUnidad codigo={codigo} />
        {entregada && (
          <p className="text-sm text-texto-suave">Gerencia ya cerró su costeo al entregarla: aquí solo sigues lo que quedó en camino.</p>
        )}
        {(delArea.etapas.length > 0 || delArea.porRecibir > 0) && (
          <div>
            <h3 className="text-xs font-medium text-texto-suave">En tu área</h3>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1.5 text-sm">
              {delArea.etapas.map((e) => {
                const estado = estadoDeEtapa(e)
                return (
                  <li key={e.id} className="flex items-center gap-1.5">
                    <span className="text-texto">{e.nombre}</span>
                    <Insignia tono={estado.tono}>{estado.texto}</Insignia>
                  </li>
                )
              })}
              {delArea.porRecibir > 0 && (
                <li>
                  <Link
                    href={`/planos?ver=por-recibir&q=${encodeURIComponent(codigo)}`}
                    className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0"
                  >
                    {delArea.porRecibir === 1 ? '1 plano por recibir' : `${delArea.porRecibir} planos por recibir`}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        )}
        <RequerimientosDeLaUnidad codigo={codigo} rqs={delArea.rqs} seguimiento={seguimiento} desde={desde} yo={yo} />
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/**
 * Los RQ que van en camino, uno por renglón con cómo va cada insumo, los
 * entregados de esta semana (para ver quién recibió cada insumo) y cuántos más
 * hay.
 */
function RequerimientosDeLaUnidad({
  codigo,
  rqs,
  seguimiento,
  desde,
  yo,
}: {
  codigo: string
  rqs: RequerimientoListado[]
  seguimiento: Seguimiento
  desde: string
  /** Quien mira: el sustento se le pide solo en los RQ que registró. */
  yo: string
}) {
  // Los tres más recientes en camino; el resto, en «Ver sus N».
  const enCaminoTodos = rqs.filter(abierto)
  const enCamino = enCaminoTodos.slice(0, MAS_EN_LA_TARJETA)
  const sinVer = enCaminoTodos.length - enCamino.length
  // Los últimos que se entregaron, no los últimos que se pidieron.
  const recien = rqs
    .filter((r) => recienEntregado(r, desde))
    .sort((a, b) => (b.entregado_en ?? '').localeCompare(a.entregado_en ?? ''))
    .slice(0, ENTREGADOS_EN_LA_TARJETA)
  const entregados = rqs.filter((r) => r.estado === 'ENTREGADO').length - recien.length
  const anulados = rqs.filter((r) => r.estado === 'ANULADO').length
  const yaCerrados = [
    entregados > 0 ? (entregados === 1 ? `1 entregado${recien.length > 0 ? ' antes' : ''}` : `${entregados} entregados${recien.length > 0 ? ' antes' : ''}`) : null,
    anulados > 0 ? (anulados === 1 ? '1 anulado' : `${anulados} anulados`) : null,
  ].filter(Boolean)
  const aVer = [...enCamino, ...recien]
  return (
    <div>
      <h3 className="text-xs font-medium text-texto-suave">Requerimientos de tu área</h3>
      {rqs.length === 0 ? (
        <p className="mt-1 text-sm text-texto-suave">Ninguno todavía.</p>
      ) : (
        <>
          {aVer.length > 0 && (
            <ul className="mt-1 space-y-3 text-sm">
              {aVer.map((r) => {
                const estado = estadoDelRequerimiento(r)
                return (
                  <li key={r.id} data-rq-de-la-unidad={r.numero}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`/requerimientos?rq=${r.id}`}
                        className="inline-flex min-h-11 items-center font-mono font-medium text-acento hover:underline sm:min-h-0"
                      >
                        {r.numero}
                      </Link>
                      {estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
                      {esGastoOperativo(r) && (
                        <Insignia tono={GASTO_OPERATIVO.tono} title={GASTO_OPERATIVO.descripcion} data-gasto-operativo>
                          {GASTO_OPERATIVO.etiqueta}
                        </Insignia>
                      )}
                      {r.avance && r.estado !== 'ENTREGADO' && <span className="tabular text-xs text-texto-suave">{porcentaje(r.avance.porcentaje)}</span>}
                      {r.estado === 'ENTREGADO' && r.entregado_en && <span className="tabular text-xs text-texto-suave">{fecha(r.entregado_en)}</span>}
                      <span className="min-w-0 basis-full truncate text-xs text-texto-suave sm:basis-auto sm:flex-1">
                        {r.lineas.length === 1 ? r.lineas[0].descripcion : `${r.lineas.length} insumos`}
                      </span>
                    </div>
                    <InsumosDelRequerimiento rq={r} seguimiento={seguimiento} yo={yo} />
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-1 text-xs text-texto-suave">
            {[sinVer > 0 ? (sinVer === 1 ? '1 más en camino' : `${sinVer} más en camino`) : null, ...yaCerrados].filter(Boolean).join(', ')}
            {(sinVer > 0 || yaCerrados.length > 0) && ' · '}
            <Link
              href={`/requerimientos?codigo=${encodeURIComponent(codigo)}`}
              className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0"
            >
              {rqs.length === 1 ? 'Ver su requerimiento' : `Ver sus ${rqs.length} requerimientos`}
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
