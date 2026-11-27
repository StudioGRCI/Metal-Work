import { ClipboardPen } from 'lucide-react'
import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { otsDeMantenimiento, type OtDeMantenimiento } from '@/lib/datos/mantenimiento'
import { cargarRequerimientos, catalogosDelRequerimiento, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { definir, PRIORIDAD } from '@/lib/dominio/estados'
import { PERMISO_OTS_DE_MANTENIMIENTO, situacionDeLaOt, tieneTrabajoHoy } from '@/lib/dominio/mantenimiento'
import { ESTADOS_RQ_ABIERTOS, estadoDelRequerimiento } from '@/lib/dominio/requerimientos'
import { fecha, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AvisoDeLaUnidad, BotonPedirParaUnidad, PedirPorUnidad } from '../requerimientos/unidades/pedir'

export const metadata = { title: 'OT de mantenimiento' }

/** Cuántos RQ se pintan en la tarjeta de cada OT: los demás, en «Ver sus N». */
const RQ_EN_LA_TARJETA = 3

const enCamino = (r: RequerimientoListado) => (ESTADOS_RQ_ABIERTOS as readonly string[]).includes(r.estado)

/**
 * Las OT de mantenimiento de las unidades de los clientes, para el puesto de
 * Mantenimiento (plan «Las demás áreas», A.3): qué hay que hacer en cada una,
 * si el vehículo ya entró, su último reporte y los RQ que su área pidió con el
 * N.º de la OT. Desde cada tarjeta pide el material («Nuevo RQ») y sube el
 * reporte del día, con el código de la OT ya puesto.
 *
 * Solo lectura de la OT y sin montos: todo sale de `mantenimiento_ots`, que
 * exige el mismo permiso que esta pantalla. La OT la da por terminada
 * Administración, y entonces pasa a «Terminadas».
 */
export default async function PaginaOtsDeMantenimiento({ searchParams }: PageProps<'/mantenimiento'>) {
  const perfil = await exigirPermiso(PERMISO_OTS_DE_MANTENIMIENTO)
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const verTerminadas = params.ver === 'terminadas'
  const area = perfil.area_id
  const pide = puede(perfil, 'requerimientos.area') && area !== null
  const reporta = puede(perfil, 'reporte_diario.registrar')

  const [ots, recientes, enCaminoDelArea, catalogos] = await Promise.all([
    otsDeMantenimiento(),
    // Los RQ que pidió su área: los de cada OT se reconocen por su código.
    pide && area ? cargarRequerimientos({ area, tipo: 'OPERACION', conEntregado: true }) : Promise.resolve([]),
    // Los que van en camino se leen aparte, como en «RQ por unidad»: la lista de
    // recientes llega hasta 300, y uno abierto más viejo que eso no saldría en su OT.
    pide && area ? cargarRequerimientos({ area, tipo: 'OPERACION', soloAbiertos: true, conEntregado: true }) : Promise.resolve([]),
    pide ? catalogosDelRequerimiento() : Promise.resolve(null),
  ])
  const rqs = [...new Map([...recientes, ...enCaminoDelArea].map((r) => [r.id, r])).values()]
  const areaFija = pide ? catalogos?.areas.find((a) => a.id === area && a.requerimiento === 'OPERACION') : undefined

  const porCodigo = new Map<string, RequerimientoListado[]>()
  for (const r of rqs) {
    const codigo = normalizarCodigo(r.codigo_interno)
    porCodigo.set(codigo, [...(porCodigo.get(codigo) ?? []), r])
  }

  const abiertas = ots.filter((o) => o.abierta)
  const terminadas = ots.filter((o) => !o.abierta)
  const palabras = palabrasDeBusqueda(q)
  const deLaVista = (verTerminadas ? terminadas : abiertas).filter(
    (o) => !q || coincide(palabras, [o.numero, o.codigo, o.cliente, o.placa ?? '', o.vehiculo ?? '', o.descripcion]),
  )
  const hoy = hoyLima()
  const conQ = (href: string) => (q ? `${href}${href.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}` : href)

  const lista = (
    <>
      <EncabezadoPagina
        titulo="OT de mantenimiento"
        descripcion={
          abiertas.length === 0
            ? 'Ninguna abierta'
            : `${abiertas.length} ${abiertas.length === 1 ? 'abierta' : 'abiertas'}${
                abiertas.some((o) => o.en_planta) ? `, ${abiertas.filter((o) => o.en_planta).length} con el vehículo en la planta` : ''
              }`
        }
        ayuda="Las órdenes de mantenimiento de las unidades de los clientes, desde que Gerencia las aprueba. El mantenimiento se sigue por el N.º de su OT: con ese número pides sus materiales («Nuevo RQ») y subes el reporte del día («Reportar el día»). El ingreso del vehículo lo registra Requerimientos. Cuando el trabajo está hecho, avisa a Administración: ella da la OT por terminada y pasa a «Terminadas». Aquí no hay montos."
        migas={[{ titulo: 'OT de mantenimiento' }]}
      />

      <div className="mb-5 space-y-3">
        <Vistas
          etiqueta="OT de mantenimiento"
          vistas={[
            { clave: 'abiertas', titulo: 'Abiertas', href: conQ('/mantenimiento'), activa: !verTerminadas, cuenta: abiertas.length },
            { clave: 'terminadas', titulo: 'Terminadas', href: conQ('/mantenimiento?ver=terminadas'), activa: verTerminadas, cuenta: terminadas.length },
          ]}
        />
        <BuscadorSimple
          ruta={verTerminadas ? '/mantenimiento?ver=terminadas' : '/mantenimiento'}
          etiqueta="Buscar OT de mantenimiento"
          marcador="N.º de OT, placa o cliente"
        />
        {pide && !areaFija && (
          <p role="status" className="text-sm text-aviso" data-sin-area-que-pida>
            Tu área no pide por el requerimiento de operación: no puedes registrar el RQ desde aquí. Pide a Administración que revise el área de tu
            cuenta.
          </p>
        )}
      </div>

      {deLaVista.length === 0 ? (
        <Tarjeta>
          <SinDatos
            enTabla={false}
            titulo={
              q
                ? 'Ninguna OT de mantenimiento con esta búsqueda'
                : verTerminadas
                  ? 'Todavía no hay OT de mantenimiento terminadas'
                  : 'No hay OT de mantenimiento abiertas'
            }
            descripcion={
              q
                ? 'Borra la búsqueda con «Limpiar», o mira en la otra pestaña.'
                : verTerminadas
                  ? 'Aparecen aquí cuando Administración da el trabajo por terminado.'
                  : 'Aparecen aquí cuando Administración registra una OT de mantenimiento y Gerencia la aprueba.'
            }
          />
        </Tarjeta>
      ) : (
        <ul className="grid items-start gap-3 lg:grid-cols-2" aria-label={verTerminadas ? 'OT de mantenimiento terminadas' : 'OT de mantenimiento abiertas'}>
          {deLaVista.map((o) => (
            <li key={o.orden}>
              <TarjetaDeLaOt ot={o} rqs={porCodigo.get(o.codigo) ?? []} hoy={hoy} pide={Boolean(areaFija)} reporta={reporta} />
            </li>
          ))}
        </ul>
      )}
    </>
  )

  // La ventana del RQ es una sola para todas las tarjetas, como en «RQ por unidad».
  return catalogos && areaFija ? (
    <PedirPorUnidad {...catalogos} tipos={['OPERACION']} areaFija={areaFija}>
      {lista}
    </PedirPorUnidad>
  ) : (
    lista
  )
}

function TarjetaDeLaOt({
  ot,
  rqs,
  hoy,
  pide,
  reporta,
}: {
  ot: OtDeMantenimiento
  rqs: RequerimientoListado[]
  /** Hoy en Lima (YYYY-MM-DD), para decir si la fecha comprometida ya pasó. */
  hoy: string
  pide: boolean
  reporta: boolean
}) {
  const situacion = situacionDeLaOt(ot)
  // La prioridad se dice solo cuando no es la de siempre: una insignia en cada tarjeta no diría nada.
  const prioridad = ot.abierta && (ot.prioridad === 'ALTA' || ot.prioridad === 'URGENTE') ? definir(PRIORIDAD, ot.prioridad) : null
  // «Reportar el día» es lo primero solo donde hay trabajo hoy: el vehículo en la planta y la OT sin pausa.
  const hayTrabajoHoy = tieneTrabajoHoy(ot)
  const vencida = ot.abierta && ot.entrega !== null && ot.entrega < hoy
  const deLaUnidad = [ot.placa, ot.vehiculo].filter(Boolean).join(' · ')
  return (
    <Tarjeta data-ot-de-mantenimiento={ot.numero}>
      <TarjetaCabecera
        titulo={<span className="font-mono">{ot.codigo}</span>}
        descripcion={
          <>
            <span className="uppercase">{ot.cliente}</span>
            {deLaUnidad && <span> · {deLaUnidad}</span>}
          </>
        }
        acciones={
          <span className="flex flex-wrap items-center gap-1.5">
            {prioridad && (
              <Insignia tono={prioridad.tono} data-prioridad={ot.prioridad}>
                Prioridad {prioridad.etiqueta.toLowerCase()}
              </Insignia>
            )}
            <Insignia tono={situacion.tono}>{situacion.etiqueta}</Insignia>
          </span>
        }
      />
      <TarjetaCuerpo className="space-y-4">
        <AvisoDeLaUnidad codigo={ot.codigo} />
        {ot.motivo_pausa && (
          <p className="text-sm text-aviso" data-motivo-pausa>
            Pausada: {ot.motivo_pausa}
          </p>
        )}
        <div>
          <h3 className="text-xs font-medium text-texto-suave">Qué hay que hacer</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-texto">{ot.descripcion || 'La OT no lo dice: pregunta a Administración.'}</p>
        </div>

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-texto-suave">Entrega comprometida</dt>
            <dd className={vencida ? 'tabular font-medium text-peligro' : 'tabular text-texto'} data-entrega>
              {ot.entrega ? fecha(ot.entrega) : 'Sin fecha'}
              {vencida && <span className="font-normal"> · ya pasó</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-texto-suave">Vehículo</dt>
            <dd className="text-texto" data-vehiculo>
              {ot.en_planta && ot.ingreso_en
                ? `En la planta desde el ${fecha(ot.ingreso_en)}`
                : ot.salida_en
                  ? `Salió el ${fecha(ot.salida_en)}`
                  : ot.abierta
                    ? 'Todavía no ingresa'
                    : 'No ingresó por esta OT'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-texto-suave">{ot.abierta ? 'Último reporte de tu área' : 'Terminada'}</dt>
            <dd className="text-texto" data-ultimo-reporte>
              {ot.abierta
                ? ot.ultimo_reporte
                  ? `${ot.ultimo_reporte === hoy ? 'Hoy' : fecha(ot.ultimo_reporte)}${ot.reportes > 1 ? ` · ${ot.reportes} en total` : ''}`
                  : 'Ninguno todavía'
                : ot.terminada_en
                  ? `El ${fecha(ot.terminada_en)}, por Administración`
                  : 'Sí'}
            </dd>
          </div>
        </dl>

        <RequerimientosDeLaOt codigo={ot.codigo} rqs={rqs} />

        {ot.abierta && (pide || reporta) && (
          <div className="flex flex-wrap gap-2 border-t border-borde pt-3">
            {reporta && (
              <EnlaceBoton
                href={`/reportes-diarios/nuevo?codigo=${encodeURIComponent(ot.codigo)}`}
                variante={hayTrabajoHoy ? 'primario' : 'contorno'}
                tamano="sm"
              >
                <ClipboardPen aria-hidden className="size-4" />
                Reportar el día<span className="sr-only"> de la {ot.codigo}</span>
              </EnlaceBoton>
            )}
            {pide && <BotonPedirParaUnidad codigo={ot.codigo} variante="contorno" />}
          </div>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** Los RQ que el área pidió con el N.º de esta OT: los que van en camino primero. */
function RequerimientosDeLaOt({ codigo, rqs }: { codigo: string; rqs: RequerimientoListado[] }) {
  const vivos = rqs.filter((r) => r.estado !== 'ANULADO')
  const ordenados = [...vivos.filter(enCamino), ...vivos.filter((r) => !enCamino(r))]
  const aVer = ordenados.slice(0, RQ_EN_LA_TARJETA)
  return (
    <div>
      <h3 className="text-xs font-medium text-texto-suave">Requerimientos de tu área</h3>
      {vivos.length === 0 ? (
        <div className="mt-1">
          <SinDatos compacto titulo="Ninguno todavía" />
        </div>
      ) : (
        <>
          <ul className="mt-1 space-y-1 text-sm">
            {aVer.map((r) => {
              const estado = estadoDelRequerimiento(r)
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-rq-de-la-ot={r.numero}>
                  <Link
                    href={`/requerimientos?rq=${r.id}`}
                    className="inline-flex min-h-11 items-center font-mono font-medium text-acento hover:underline sm:min-h-0"
                  >
                    {r.numero}
                  </Link>
                  {estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
                  <span className="min-w-0 basis-full truncate text-xs text-texto-suave sm:basis-auto sm:flex-1">
                    {r.lineas.length === 1 ? r.lineas[0].descripcion : `${r.lineas.length} insumos`}
                  </span>
                </li>
              )
            })}
          </ul>
          {vivos.length > aVer.length && (
            <p className="mt-1 text-xs text-texto-suave">
              <Link
                href={`/requerimientos?codigo=${encodeURIComponent(codigo)}`}
                className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0"
              >
                Ver sus {vivos.length} requerimientos
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  )
}
