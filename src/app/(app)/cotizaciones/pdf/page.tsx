import { Download, FileText, Hash, History, Hourglass, MessageSquareWarning, ReceiptText, RotateCcw, UserRoundX } from 'lucide-react'
import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoTope } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Recorrido } from '@/components/ui/recorrido'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { etiquetaDeMime } from '@/lib/archivo-cotizacion'
import { catalogosDeCotizacion, listarCotizacionesPdf, unidadesLibresYaFacturadas } from '@/lib/datos/cotizaciones-pdf'
import { recorridoDeCotizaciones } from '@/lib/datos/recorrido'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { estadoFacturaVenta } from '@/lib/dominio/finanzas'
import { describirRecorridoDeLaCotizacion } from '@/lib/dominio/recorrido'
import { diaLima, fecha as fmtFecha, hora, hoyLima, moneda as formatoMoneda } from '@/lib/format'
import { exigirPermiso, puede, puedeCorregirCotizacion, puedeQuitarCotizacion } from '@/lib/sesion'

import { CancelarVenta, CargarCodigoYOt, CorregirCotizacion, EstadoDeLaOt, QuitarCotizacion, RevisarCotizacion } from './acciones-cotizacion'
import { IrALaTarjetaDelAviso } from './ir-a-la-tarjeta-del-aviso'
import { EstadoDeSubirCotizacion, SubirCotizacion } from './subir-cotizacion'

export const metadata = { title: 'Cotización' }

const ESTADOS: Record<string, { etiqueta: string; tono: 'aviso' | 'exito' | 'peligro' }> = {
  POR_REVISAR: { etiqueta: 'Por revisar', tono: 'aviso' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'exito' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
}

// Cómo quedó la versión que se archivó al corregir. La que se corrige antes de
// que Gerencia la mire se archiva POR_REVISAR, y la franja decía «La anterior
// era rechazada» sin que nadie la rechazara (funcionalidad H6 de la
// trigesimoquinta pasada).
const LA_ANTERIOR: Record<string, string> = {
  APROBADA: 'La anterior era aprobada.',
  RECHAZADA: 'La anterior era rechazada.',
  POR_REVISAR: 'La anterior no llegó a revisarse.',
}
const COMO_QUEDO: Record<string, string> = { APROBADA: 'aprobada', RECHAZADA: 'rechazada', POR_REVISAR: 'sin revisar' }

/**
 * «Abrir el PDF» se ve en el navegador; el Word se baja. El PDF lleva además
 * «Descargar», que lo guarda con su nombre: guardado desde el visor salía con
 * el nombre interno del archivo, una serie de letras y números (observación de
 * Gerencia, 27/10). `descarga` es la ruta que lo pide en el momento del toque.
 */
function EnlaceArchivo({ url, mime, nombre, descarga }: { url: string; mime: string | null; nombre: string | null; descarga: string }) {
  const word = etiquetaDeMime(mime) === 'Word'
  const Icono = word ? Download : FileText
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <a
        href={url}
        target={word ? undefined : '_blank'}
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0"
      >
        <Icono aria-hidden className="size-4 shrink-0" />
        <span className="break-words">
          {word ? 'Bajar el Word' : 'Abrir el PDF'}
          {nombre ? ` · ${nombre}` : ''}
        </span>
      </a>
      {/* Sin `download`: el nombre lo pone el almacenamiento, y si falla la ruta
          vuelve a la lista con el motivo en vez de bajar un archivo de error. */}
      {!word && (
        <a
          href={descarga}
          aria-label={nombre ? `Descargar ${nombre}` : 'Descargar la cotización'}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0"
        >
          <Download aria-hidden className="size-4 shrink-0" />
          Descargar
        </a>
      )}
    </span>
  )
}

/**
 * El camino corto de la cotización (migraciones 101 a 103): el vendedor sube la
 * que ya le mandó al cliente, en PDF o en Word; Gerencia la rechaza con su
 * observación —y el vendedor sube ahí mismo la corrección— o la aprueba con un
 * toque, y Administración le da el código interno de la unidad y sube la OT,
 * todo junto (migración 20261027200000). Desde ahí el código interno es la
 * referencia del trabajo.
 *
 * La cotización se arma en Word: rehacerla dentro del sistema era escribir dos
 * veces lo mismo. Lo que el sistema sí guarda es la traza —quién la subió, qué
 * observó Gerencia en cada vuelta, quién la aprobó, qué orden salió— y el papel.
 */
/** El motivo lo escribe una persona, con punto o sin él: la frase que sigue no se le pega. */
function conPuntoFinal(texto: string) {
  const t = texto.trim()
  return /[.!?…]$/.test(t) ? t : `${t}.`
}

const FILTROS_ESTADO = ['POR_REVISAR', 'APROBADA_MES', 'APROBADA_SIN_OT', 'RECHAZADA', 'CON_OT', 'ANULADA'] as const
type FiltroEstado = (typeof FILTROS_ESTADO)[number]

// «Aprobadas del mes»: las que Gerencia aprobó desde el día 1 del mes en el
// taller. Es la cifra «Aprobadas este mes» del Dashboard, y su enlace llega aquí.
function aprobadaEsteMes(c: { estado: string | null; revisado_en: string | null }, mes: string) {
  return c.estado === 'APROBADA' && !!c.revisado_en && diaLima(c.revisado_en).slice(0, 7) === mes
}

// Le falta alguna OT: la aprobada a la que Administración todavía no le cargó
// todas sus unidades (una OT por unidad, migración 20261126760000).
function faltaSuOt(c: { estado: string | null; ordenes_faltantes: number | null }) {
  return c.estado === 'APROBADA' && (c.ordenes_faltantes ?? 0) > 0
}

// Una OT vigente cuya unidad se quedó sin código interno: no se factura, y
// Administración se lo vuelve a dar con «Editar OT», no cargando otra OT.
function otSinCodigo(c: { ordenes: { codigo_interno: string | null }[] }) {
  return c.ordenes.some((o) => !o.codigo_interno)
}

// Lo que Administración tiene pendiente en la aprobada: alguna OT por cargar o
// alguna OT a la que devolverle el código; va arriba para Administración. El
// filtro «esperan OT» sigue siendo el de las OT por cargar (la misma cuenta del
// menú), y la OT sin código no cuenta como «Con código y OT» (entrega 3).
function esperaAdministracion(c: { estado: string | null; ordenes: { codigo_interno: string | null }[]; ordenes_faltantes: number | null }) {
  return faltaSuOt(c) || (c.estado === 'APROBADA' && otSinCodigo(c))
}

// La OT que fue su venta y pasó a otro comprador con «Editar OT»: esa unidad
// ya no lleva OT y la base no deja cargarle otra (migración 20261126988000,
// DKS 2026-11-26: «Cerrarla: no lleva otra OT»). La de varias unidades la pinta
// como un renglón más de sus OT; esta frase es para la de una. El número llega
// solo a quien lee las órdenes; si no, se dice que pasó, sin él.
function pasoAOtroComprador(salieron: (string | null)[] | null) {
  const todas = salieron ?? []
  if (todas.length === 0) return null
  const cual = todas.length === 1 && todas[0] ? ` ${todas[0]}` : ''
  return `Su OT${cual} pasó a otro comprador: esta venta ya no lleva otra OT.`
}

function enFiltro(
  c: { estado: string | null; ordenes: { codigo_interno: string | null }[]; ordenes_faltantes: number | null; revisado_en: string | null },
  filtro: FiltroEstado | null,
  mes: string,
) {
  switch (filtro) {
    case 'POR_REVISAR':
      return c.estado === 'POR_REVISAR'
    case 'APROBADA_MES':
      return aprobadaEsteMes(c, mes)
    case 'APROBADA_SIN_OT':
      return faltaSuOt(c)
    case 'RECHAZADA':
      return c.estado === 'RECHAZADA'
    case 'CON_OT':
      // Con todas sus OT: la que está a medio cargar sigue en las que esperan.
      return c.ordenes.length > 0 && (c.ordenes_faltantes ?? 0) === 0 && !otSinCodigo(c)
    case 'ANULADA':
      return c.estado === 'ANULADA'
    default:
      return c.estado !== 'ANULADA'
  }
}

export default async function PaginaCotizacionesPdf({ searchParams }: PageProps<'/cotizaciones/pdf'>) {
  const perfil = await exigirPermiso(['cotizaciones.ver_pdf_comercial', 'cotizaciones.ver_aprobadas', 'tesoreria.ver_documentos'])
  const params = await searchParams

  const puedeSubir = puede(perfil, 'cotizaciones.crear')
  const revisa = puede(perfil, 'cotizaciones.revisar')
  // Quien da el código interno y sube la OT de la aprobada: Administración.
  const cargaOt = puede(perfil, 'ordenes.crear')
  const veCodigos = puede(perfil, 'codigos_internos.ver')
  // Gerencia Comercial (2026-11-25) sigue la cotización hasta su OT: la abre desde aquí.
  const veOt = puede(perfil, 'ordenes.ver')
  // Quien le devuelve el código a la OT que se quedó sin él, con «Editar OT».
  const editaOt = puede(perfil, 'ordenes.editar')

  const [todas, catalogos] = await Promise.all([
    listarCotizacionesPdf(),
    puedeSubir ? catalogosDeCotizacion() : Promise.resolve({ clientes: [], carrocerias: [] }),
  ])

  // «Las tuyas»: Ventas recorta la lista a lo que subió. Es el recorte con que
  // el Dashboard cuenta sus cifras, y su enlace llega con `de=mias`.
  const soloMias = puedeSubir && params.de === 'mias'
  const cotizaciones = soloMias ? todas.filter((c) => c.registrado_por === perfil.id) : todas

  const mes = hoyLima().slice(0, 7)
  const porRevisar = cotizaciones.filter((c) => c.estado === 'POR_REVISAR').length
  const delMes = cotizaciones.filter((c) => aprobadaEsteMes(c, mes)).length
  const sinOrden = cotizaciones.filter(faltaSuOt).length
  const rechazadas = cotizaciones.filter((c) => c.estado === 'RECHAZADA').length
  const conOrden = cotizaciones.filter((c) => enFiltro(c, 'CON_OT', mes)).length
  const anuladas = cotizaciones.filter((c) => c.estado === 'ANULADA').length

  // Los filtros y la búsqueda se resuelven en memoria: la lista ya viene entera
  // (hasta 200) y así los enlaces del Dashboard y de la campana caen en lo suyo.
  const filtro = (FILTROS_ESTADO as readonly string[]).includes(String(params.estado))
    ? (params.estado as FiltroEstado)
    : null
  const palabras = palabrasDeBusqueda(typeof params.q === 'string' ? params.q : '')
  const buscada = (c: (typeof cotizaciones)[number]) => coincide(palabras, [c.numero, c.cliente, c.carroceria, c.codigo_interno, ...c.ordenes.map((o) => o.codigo_interno)])
  // Sin filtro, primero lo que quien mira puede mover: Gerencia ve arriba las
  // que esperan su visto; Administración, las aprobadas que esperan su código y
  // su OT; Ventas, las suyas rechazadas. El orden por fecha se conserva dentro de cada grupo.
  const sinCodigo = faltaSuOt
  // La venta que se reabrió (su OT pasó a otro comprador y allí se anuló) la
  // decide quien la registró: sigue, o la cancela (migración 20261126988000).
  const cancelaComoAutor = (c: (typeof cotizaciones)[number]) =>
    puedeSubir && c.estado === 'APROBADA' && c.reabierta_por_ot_anulada !== null && c.registrado_por === perfil.id && !c.facturada
  // Gerencia también tiene el botón, por si quien la registró ya no está
  // (StudioGRCI, 2026-11-26; migración 20261126998600). No se le sube arriba
  // como suya mientras esa persona siga con cuenta: la decide primero quien la
  // vendió. Si ya no tiene cuenta activa o cambió de puesto, la decide Gerencia y sí sube.
  const puedeCancelar = (c: (typeof cotizaciones)[number]) =>
    cancelaComoAutor(c) || (revisa && c.estado === 'APROBADA' && c.reabierta_por_ot_anulada !== null && !c.facturada)
  const cancelaPorQuienSeFue = (c: (typeof cotizaciones)[number]) =>
    revisa && c.estado === 'APROBADA' && c.reabierta_por_ot_anulada?.sin_quien_la_registro === true && !c.facturada
  // La que espera su decisión, aunque tenga una factura por anular antes: Inicio las cuenta todas.
  const esperaSuDecision = (c: (typeof cotizaciones)[number]) =>
    puedeSubir && c.estado === 'APROBADA' && c.reabierta_por_ot_anulada !== null && c.registrado_por === perfil.id
  const meToca = (c: (typeof cotizaciones)[number]) =>
    (revisa && c.estado === 'POR_REVISAR') ||
    (cargaOt && esperaAdministracion(c)) ||
    (puedeCorregirCotizacion(perfil, c) && !c.facturada) ||
    cancelaComoAutor(c) ||
    cancelaPorQuienSeFue(c)
  // La que Gerencia acaba de revisar se queda donde estaba, ya aprobada o
  // rechazada, también en «Por revisar»: si se iba al fondo, bajo el dedo
  // quedaba el «Aprobar» de otra y un segundo toque aprobaba la equivocada.
  const ahora = new Date().getTime()
  const recienRevisada = (c: (typeof cotizaciones)[number]) =>
    revisa && (c.estado === 'APROBADA' || c.estado === 'RECHAZADA') && c.revisado_en !== null
    && ahora - new Date(c.revisado_en).getTime() < 15 * 60 * 1000
  const arriba = (c: (typeof cotizaciones)[number]) => meToca(c) || recienRevisada(c)
  const visibles = cotizaciones
    .filter((c) => (enFiltro(c, filtro, mes) || (filtro === 'POR_REVISAR' && recienRevisada(c))) && buscada(c))
    // Primero la venta que se reabrió y espera a quien la registró: «decide si sigue» (Inicio lleva aquí).
    .sort((a, b) => Number(esperaSuDecision(b)) - Number(esperaSuDecision(a)) || Number(arriba(b)) - Number(arriba(a)))

  // El recorrido de las que se muestran. Sin él, la tarjeta sigue con todo lo demás y lo dice en su lugar.
  const recorridos = await recorridoDeCotizaciones(visibles.flatMap((c) => (c.id ? [c.id] : []))).catch((e: unknown) => {
    console.error('Cotización: no se pudo leer el recorrido.', e)
    return null
  })

  // A quien carga la OT: las unidades libres que ya tienen factura, para avisarle antes de que
  // otro vehículo se quede con ella. Solo puede pasar si falta más de una OT. Es un aviso de
  // más: si no se lee, la ventana sigue como siempre.
  const yaFacturadas = cargaOt
    ? await unidadesLibresYaFacturadas(
        visibles.flatMap((c) => (c.id && sinCodigo(c) && (c.cantidad_unidades ?? 1) > 1 && (c.ordenes_faltantes ?? 0) > 1 ? [c.id] : [])),
      ).catch((e: unknown) => {
        console.error('Cotización: no se pudo leer qué unidades sin OT ya tienen factura.', e)
        return null
      })
    : null

  const opciones = [
    { valor: null, etiqueta: `Vigentes (${cotizaciones.length - anuladas})` },
    { valor: 'POR_REVISAR', etiqueta: `Por revisar (${porRevisar})` },
    { valor: 'APROBADA_MES', etiqueta: `Aprobadas del mes (${delMes})` },
    { valor: 'APROBADA_SIN_OT', etiqueta: `Aprobadas que esperan OT (${sinOrden})` },
    { valor: 'RECHAZADA', etiqueta: `Rechazadas (${rechazadas})` },
    { valor: 'CON_OT', etiqueta: `Con código y OT (${conOrden})` },
    { valor: 'ANULADA', etiqueta: `Anuladas (${anuladas})` },
  ]

  return (
    <>
      <EncabezadoPagina
        titulo="Cotización"
        ayuda="Ventas sube la cotización, Gerencia la aprueba y Administración le da el código interno de la unidad y sube su OT. Aprobada, la ven también Contabilidad, que la factura, y Tesorería, que la cobra."
        acciones={puedeSubir && <SubirCotizacion clientes={catalogos.clientes} carrocerias={catalogos.carrocerias} />}
        estado={
          (puedeSubir || cargaOt) && (
            <>
              {puedeSubir && <EstadoDeSubirCotizacion />}
              {cargaOt && <EstadoDeLaOt />}
            </>
          )
        }
      />

      {params.descarga === 'fallo' && (
        <AvisoEnfocado rol="alert" className="mb-5">
          No se pudo bajar la cotización. Vuelve a intentarlo; si se repite, avisa al administrador.
        </AvisoEnfocado>
      )}

      {todas.length > 0 && (
        <>
          <BuscadorSimple ruta="/cotizaciones/pdf" etiqueta="Buscar cotizaciones" marcador="Número, cliente, carrocería o código" />
          <PastillaFiltro
            ruta="/cotizaciones/pdf"
            clave="estado"
            opciones={opciones}
            params={params}
            activo={filtro}
            etiqueta="Filtrar por estado"
            className={puedeSubir ? 'mt-3 mb-3' : 'mt-3 mb-5'}
          />
          {puedeSubir && (
            <PastillaFiltro
              ruta="/cotizaciones/pdf"
              clave="de"
              opciones={[
                { valor: null, etiqueta: 'De todos' },
                { valor: 'mias', etiqueta: `Las que subiste (${todas.filter((c) => c.registrado_por === perfil.id).length})` },
              ]}
              params={params}
              activo={soloMias ? 'mias' : null}
              etiqueta="Filtrar por quién la subió"
              className="mb-5"
            />
          )}
        </>
      )}

      {cotizaciones.length > 0 && visibles.length === 0 && (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              {filtro === 'APROBADA_SIN_OT' && palabras.length === 0 ? 'Ninguna aprobada espera su código' : 'Ninguna cotización con ese filtro'}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              {filtro === 'APROBADA_SIN_OT' && palabras.length === 0
                ? 'Todas las aprobadas ya tienen su código interno y su OT.'
                : 'Prueba con otro estado o quita la búsqueda.'}{' '}
              <Link href="/cotizaciones/pdf" className="text-acento hover:underline">
                Ver todas
              </Link>
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {cotizaciones.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              {soloMias && todas.length > 0 ? 'Todavía no subiste ninguna cotización' : 'Todavía no hay cotizaciones subidas'}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              {soloMias && todas.length > 0 ? (
                <>
                  Las demás están en{' '}
                  <Link href="/cotizaciones/pdf" className="text-acento hover:underline">
                    De todos
                  </Link>
                  .
                </>
              ) : puedeSubir ? (
                'Sube la primera con «Subir cotización», arriba: el PDF o el Word que se le mandó al cliente.'
              ) : (
                'Las sube el vendedor cuando se la manda al cliente.'
              )}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          <IrALaTarjetaDelAviso />
          {visibles.map((c) => {
            const estado = ESTADOS[c.estado ?? ''] ?? { etiqueta: c.estado ?? '—', tono: 'neutro' as const }
            const quitable = puedeQuitarCotizacion(perfil, c)
            // La facturada ya no se corrige (la base lo impide): sin el botón,
            // y con la razón a la vista para quien lo habría tenido.
            const corregiria = puedeCorregirCotizacion(perfil, c)
            const corrige = corregiria && !c.facturada
            const version = c.version ?? 1
            const versionAnterior = c.versiones[0]
            // Una cotización de varias unidades lleva una OT por cada una (migración 20261126760000).
            const unidades = c.cantidad_unidades ?? 1
            const varias = unidades > 1
            const faltan = c.ordenes_faltantes ?? 0
            // Las OT que se quedaron sin código: no se carga otra, se les devuelve con «Editar OT».
            const otsSinCodigo = c.estado === 'APROBADA' ? c.ordenes.filter((o) => !o.codigo_interno) : []
            // La unidad que sigue: la primera sin OT vigente (si se anuló la 2, la 2).
            // La unidad que pasó a otro comprador tampoco se vuelve a cargar: la base la salta.
            const pasaron = c.unidades_a_otro_comprador
            const tomadas = new Set([...c.ordenes.map((o, i) => o.unidad ?? i + 1), ...pasaron.map((p) => p.unidad)])
            // Las unidades que esperan su OT: Administración elige cuál carga (entrega 3).
            const libres = Array.from({ length: unidades }, (_, i) => i + 1).filter((k) => !tomadas.has(k))
            const siguiente = libres[0] ?? c.ordenes.length + 1
            // La frase, solo si no le queda ninguna OT; si le queda alguna (la cantidad
            // se corrigió después, o se cargó otra antes de 20261126988000), la que
            // pasó va como un renglón más de sus OT.
            const pasada = c.ordenes.length === 0 && !varias ? pasoAOtroComprador(c.ordenes_a_otro_comprador) : null
            // La venta que se reabrió: su OT pasó a otro comprador y allí se anuló. Espera su OT
            // hasta que la cancele quien la registró (StudioGRCI, 2026-11-26; migración 20261126988000).
            const reabierta = c.estado === 'APROBADA' ? c.reabierta_por_ot_anulada : null
            const esMia = c.registrado_por === perfil.id
            const cancela = puedeCancelar(c)
            // Sus OT y, en la de varias, las unidades que pasaron, por número de unidad.
            const filasDeOt: { unidad: number; o?: (typeof c.ordenes)[number]; numero?: string | null }[] = [
              ...c.ordenes.map((o, i) => ({ unidad: o.unidad ?? i + 1, o })),
              ...(pasada ? [] : pasaron.map((p) => ({ unidad: p.unidad, numero: p.numero }))),
            ].sort((x, y) => x.unidad - y.unidad)

            return (
              // Con `id`: el aviso de la campana aterriza en esta fila (`#id`), y
              // `IrALaTarjetaDelAviso` la marca con `data-del-aviso`.
              <li key={c.id} id={c.id ?? undefined} className="scroll-mt-20 outline-none data-del-aviso:[&>div]:border-acento data-del-aviso:[&>div]:ring-1 data-del-aviso:[&>div]:ring-acento">
                <Tarjeta>
                  <TarjetaCuerpo className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-texto">{c.numero}</span>
                        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                        {pasada && <Insignia tono="neutro">Pasó a otro comprador</Insignia>}
                        {version > 1 && (
                          <span className="text-xs font-medium text-texto-suave">versión {version}</span>
                        )}
                      </span>
                      <span className="text-xs text-texto-tenue">
                        {c.registrado_por_nombre ?? 'Ventas'} · {fmtFecha(c.creado_en)} {hora(c.creado_en)}
                      </span>
                    </div>

                    {/* La observación de Gerencia y el motivo de la anulación van arriba, antes que el
                        cliente y el monto: es lo primero que el vendedor tiene que leer (Plan 9.1). */}
                    {c.estado === 'RECHAZADA' && c.observacion && (
                      <div className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-2 text-sm text-peligro">
                        <MessageSquareWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <p>
                            <span className="font-medium">{c.revisado_por_nombre ?? 'Gerencia'} la rechazó</span>
                            {c.revisado_en ? ` el ${fmtFecha(c.revisado_en)}` : ''}: {c.observacion}
                          </p>
                          {corrige && (
                            <p className="mt-0.5 text-xs">Corrígela y súbela con «Subir corrección»: vuelve a Gerencia con el mismo número.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {c.estado === 'ANULADA' && (
                      <p className="rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-2 text-sm text-peligro">
                        Anulada: {c.observacion?.trim() ? conPuntoFinal(c.observacion) : 'Consulta el motivo con Gerencia.'} El número y el archivo se conservan en el historial.
                      </p>
                    )}

                    <p className="text-sm text-texto">
                      {c.cliente ?? 'Cliente reservado'}
                      {c.carroceria && <span className="text-texto-suave"> · {c.carroceria}</span>}
                      {varias && <span className="font-medium text-texto"> · {unidades} unidades</span>}
                    </p>

                    <p className="text-sm font-semibold tabular text-texto">
                      {c.monto_venta !== null && c.monto_venta !== undefined
                        ? `Total de venta: ${formatoMoneda(c.monto_venta, c.moneda ?? 'PEN')}`
                        : 'Monto total pendiente de confirmar'}
                      {varias && c.monto_venta !== null && c.monto_venta !== undefined && (
                        <span className="font-normal text-texto-suave">
                          {' '}· {formatoMoneda(Math.round((c.monto_venta / unidades) * 100) / 100, c.moneda ?? 'PEN')} en promedio por unidad
                        </span>
                      )}
                    </p>

                    {c.url ? <EnlaceArchivo url={c.url} mime={c.mime_type} nombre={c.nombre_archivo} descarga={`/cotizaciones/pdf/archivo/${c.id}`} /> : (
                      <p role="alert" className="text-sm text-aviso">No se pudo abrir el archivo de esta cotización. Recarga la página; si continúa, avisa al administrador.</p>
                    )}

                    {c.estado === 'POR_REVISAR' && versionAnterior && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <History aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">Corregida {fmtFecha(c.archivo_subido_en)}.</span>{' '}
                          La nueva versión espera a Gerencia. {LA_ANTERIOR[versionAnterior.estado_al_archivar ?? ''] ?? LA_ANTERIOR.POR_REVISAR}
                        </span>
                      </p>
                    )}

                    {c.estado === 'APROBADA' && (
                      <p className="text-xs text-texto-tenue">
                        Aprobada por {c.revisado_por_nombre ?? 'Gerencia'}
                        {c.revisado_en ? ` el ${fmtFecha(c.revisado_en)}` : ''}
                      </p>
                    )}

                    {c.facturas.length > 0 && (
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-texto-suave">
                        <ReceiptText aria-hidden className="size-3.5" />
                        {c.facturas.map((f) => (
                          <Insignia key={f.id} tono={estadoFacturaVenta(f).tono}>
                            Factura {f.numero} · {formatoMoneda(f.total, f.moneda === 'USD' ? 'USD' : 'PEN')} · {estadoFacturaVenta(f).etiqueta.toLowerCase()}
                          </Insignia>
                        ))}
                      </p>
                    )}

                    {c.versiones.length > 0 && (
                      <details className="group rounded-[var(--radius-base)] border border-borde">
                        <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 px-2.5 text-xs font-medium text-texto-suave sm:min-h-8">
                          <History aria-hidden className="size-3.5" />
                          Historial: {c.versiones.length} {c.versiones.length === 1 ? 'versión anterior' : 'versiones anteriores'}
                        </summary>
                        <ol className="space-y-2 border-t border-borde px-2.5 py-2">
                          {c.versiones.map((v) => (
                            <li key={v.id} className="space-y-0.5 text-xs">
                              <p className="text-texto">
                                <span className="font-medium">Versión {v.version} · {COMO_QUEDO[v.estado_al_archivar ?? ''] ?? COMO_QUEDO.POR_REVISAR}</span>
                                <span className="text-texto-tenue">
                                  {' '}
                                  · subida {fmtFecha(v.subido_en)}
                                  {v.rechazado_en ? ` · revisada por ${v.rechazado_por_nombre ?? 'Gerencia'} el ${fmtFecha(v.rechazado_en)}` : ''}
                                </span>
                              </p>
                              <p className="text-texto-suave">«{v.observacion}»</p>
                              {v.url ? <EnlaceArchivo url={v.url} mime={v.mime_type} nombre={v.nombre_archivo} descarga={`/cotizaciones/pdf/archivo/${c.id}?version=${v.id}`} /> : (
                                <p className="text-aviso">Archivo no disponible. Recarga la página o avisa al administrador.</p>
                              )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}

                    {reabierta && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso" data-venta-reabierta>
                        <RotateCcw aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">
                            Su OT{reabierta.numero ? ` ${reabierta.numero}` : ''} pasó a otro comprador y allí se anuló: la venta volvió a esperar su OT.
                          </span>{' '}
                          {cancela && esMia
                            ? 'Si la venta sigue, Administración le carga su OT. Si ya no sigue, cancélala con «Cancelar la venta».'
                            : puedeSubir && esMia
                              ? 'Si la venta sigue, Administración le carga su OT. Para cancelarla, Contabilidad anula primero su factura.'
                              : revisa
                                ? reabierta.sin_quien_la_registro
                                  ? `Quien la registró ya no tiene cuenta activa o cambió de puesto. Si la venta ya no sigue, ${c.facturada ? 'la cancelas tú después de que Contabilidad anule su factura' : 'cancélala tú con «Cancelar la venta»'}.`
                                  : `Si la venta ya no sigue, la cancela quien la registró${c.registrado_por_nombre ? ` (${c.registrado_por_nombre})` : ''}. También puedes cancelarla tú${c.facturada ? ', después de que Contabilidad anule su factura' : ' con «Cancelar la venta»'}.`
                                : cargaOt
                                  ? `Antes de cargarle otra OT, confirma con ${c.registrado_por_nombre ?? 'quien la registró'} si la venta sigue; si no sigue, la cancela esa persona o Gerencia General${c.facturada ? ', después de que Contabilidad anule su factura' : ''}.`
                                  : `Si la venta ya no sigue, la cancela quien la registró${c.registrado_por_nombre ? ` (${c.registrado_por_nombre})` : ''} o Gerencia General.`}
                        </span>
                      </p>
                    )}

                    {/* Una aprobada que espera su código: quien no lo da tiene
                        que saber por qué no avanza y quién la destraba. */}
                    {!cargaOt && sinCodigo(c) && !reabierta && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">
                            {!varias
                              ? 'Falta que Administración le dé su código interno y suba la OT.'
                              : faltan === unidades
                                ? `Falta que Administración le dé a cada una de las ${unidades} unidades su código interno y suba su OT.`
                                : `${faltan === 1 ? 'Falta 1 OT' : `Faltan ${faltan} OT`} de ${unidades}: Administración le da a cada unidad su código y sube su OT.`}
                          </span>{' '}
                          Sin código no se factura ni Diseño empieza.
                        </span>
                      </p>
                    )}
                    {!editaOt && otsSinCodigo.length > 0 && (
                      <p data-ot-sin-codigo className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">
                            {otsSinCodigo.length === 1 ? 'La OT' : 'Las OT'}
                            {otsSinCodigo.some((o) => o.numero) ? ` ${otsSinCodigo.flatMap((o) => (o.numero ? [o.numero] : [])).join(', ')}` : ''}
                            {otsSinCodigo.length === 1 ? ' se quedó' : ' se quedaron'} sin código interno: Administración se lo vuelve a dar con «Editar OT».
                          </span>{' '}
                          Sin código no se factura.
                        </span>
                      </p>
                    )}

                    {filasDeOt.length > 0 && (
                      <ul className="space-y-1" aria-label={varias ? `OT de las ${unidades} unidades` : undefined}>
                        {filasDeOt.map((f, i) => {
                          // La unidad cuya OT pasó a otro comprador, en su lugar entre las demás (20261126988000).
                          if (!f.o) {
                            return (
                              <li key={`paso-${f.unidad}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-paso-a-otro-comprador>
                                <UserRoundX aria-hidden className="size-4 text-texto-suave" />
                                {varias && <span className="text-xs font-medium text-texto-suave">Unidad {f.unidad}</span>}
                                {f.numero && <span className="text-texto-suave">OT {f.numero}</span>}
                                <Insignia tono="neutro">Pasó a otro comprador: ya no lleva OT</Insignia>
                              </li>
                            )
                          }
                          const o = f.o
                          return (
                            <li key={o.id ?? `${o.codigo_interno ?? 'sin-codigo'}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                              <Hash aria-hidden className="size-4 text-texto-suave" />
                              {varias && <span className="text-xs font-medium text-texto-suave">Unidad {f.unidad}</span>}
                              {o.codigo_interno ? (
                                veCodigos ? (
                                  <Link
                                    href={`/codigos-internos/detalle?codigo=${encodeURIComponent(o.codigo_interno)}`}
                                    className="font-mono font-medium break-all text-acento hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                                  >
                                    {o.codigo_interno}
                                  </Link>
                                ) : (
                                  <span className="font-mono font-medium break-all text-texto">{o.codigo_interno}</span>
                                )
                              ) : (
                                <Insignia tono="aviso">Sin código interno</Insignia>
                              )}
                              {o.numero &&
                                (veOt && o.id ? (
                                  <Link href={`/ordenes/${o.id}`} className="font-medium text-acento hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                                    · OT {o.numero}
                                  </Link>
                                ) : (
                                  <span className="text-texto-suave">· OT {o.numero}</span>
                                ))}
                              {o.estado && (
                                <Insignia tono={definir(ESTADO_OT, o.estado).tono}>{definir(ESTADO_OT, o.estado).etiqueta}</Insignia>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {pasada && (
                      <p className="flex items-start gap-1.5 text-xs text-texto-suave" data-paso-a-otro-comprador>
                        <UserRoundX aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>{pasada}</span>
                      </p>
                    )}
                    {corregiria && c.facturada && (
                      <p className="text-xs text-texto-suave">
                        {/* La reabierta ya dice arriba que Contabilidad anula primero la factura. */}
                        Ya está facturada: no se corrige.{reabierta && esMia ? '' : ' Si hay que cambiarla, Contabilidad anula primero la factura.'}
                      </p>
                    )}
                    {/* Para consultar, justo encima de las acciones: quién hizo cada paso, quién la tiene ahora y hace cuántos días. */}
                    <Recorrido
                      pasos={recorridos ? describirRecorridoDeLaCotizacion((c.id && recorridos.get(c.id)) || []) : null}
                      className="rounded-[var(--radius-base)] border border-borde"
                      relleno="px-2.5"
                      femenino
                    />

                    {(revisa && c.estado === 'POR_REVISAR' || cargaOt && sinCodigo(c) || (editaOt && otsSinCodigo.some((o) => o.id)) || corrige || quitable || cancela) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {revisa && c.estado === 'POR_REVISAR' && c.id && (
                          <RevisarCotizacion id={c.id} conOrden={c.ordenes.length > 0} />
                        )}
                        {cargaOt && sinCodigo(c) && c.id && (
                          <CargarCodigoYOt
                            cotizacionId={c.id}
                            numero={c.numero ?? 'cotización'}
                            tipoUnidad={c.tipo_unidad}
                            unidad={{
                              cual: siguiente,
                              de: unidades,
                              libres,
                              otras: c.ordenes.flatMap((o, i) => (o.codigo_interno ? [{ unidad: o.unidad ?? i + 1, codigo: o.codigo_interno }] : [])),
                              facturadas: yaFacturadas?.get(c.id),
                            }}
                          />
                        )}
                        {editaOt &&
                          otsSinCodigo.flatMap((o) =>
                            o.id ? [
                              <EnlaceBoton key={`codigo-${o.id}`} href={`/ordenes/${o.id}?editar=codigo`} variante="contorno" tamano="sm" data-darle-el-codigo>
                                {`Darle el código a la OT${o.numero ? ` ${o.numero}` : ''}`}
                              </EnlaceBoton>,
                            ] : [],
                          )}
                        {corrige && c.id && (
                          <CorregirCotizacion id={c.id} numero={c.numero ?? ''} observacion={c.observacion}
                            rechazada={c.estado === 'RECHAZADA'} aprobada={c.estado === 'APROBADA'}
                            version={c.version ?? 1} clienteId={c.cliente_id ?? ''} carroceriaId={c.tipo_carroceria_id ?? ''}
                            unidades={unidades} conOrdenes={c.ordenes.length} pasaron={c.ordenes_a_otro_comprador?.length ?? 0}
                            unidadMayor={Math.max(0, ...c.ordenes.map((o) => o.unidad ?? 1))}
                            clientes={catalogos.clientes} carrocerias={catalogos.carrocerias} />
                        )}
                        {!c.orden_id && quitable && c.id && <QuitarCotizacion id={c.id} numero={c.numero ?? ''} />}
                        {cancela && c.id && <CancelarVenta id={c.id} numero={c.numero ?? ''} />}
                      </div>
                    )}
                  </TarjetaCuerpo>
                </Tarjeta>
              </li>
            )
          })}
        </ul>
      )}

      <AvisoTope mostradas={todas.length} tope={200} />
    </>
  )
}
