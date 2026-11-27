import { AlarmClock, Camera, ClipboardList, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import {
  areasParaReportar,
  listarAccionesSsoma,
  listarReportesSsoma,
  MAXIMO_ACCIONES_SSOMA,
  MAXIMO_REPORTES_SSOMA,
  personalParaReportar,
  seguimientoDe,
  seguimientoDeReportes,
  seguridadDeLaPlanta,
  seguridadPorArea,
  type AccionSsoma,
  type ReporteSsoma,
  type SeguimientoSsoma,
  type SeguridadDeLaPlanta,
  type SeguridadDelArea,
} from '@/lib/datos/ssoma'
import {
  CLASIFICACION_SSOMA,
  cuandoVence,
  diasEnEspera,
  ESTADO_ACCION_SSOMA,
  ESTADO_REPORTE_SSOMA,
  rutaDeAccion,
  TIPO_REPORTE_SSOMA,
} from '@/lib/dominio/ssoma'
import { fecha, fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'
import { exigirSesion, puede } from '@/lib/sesion'

import { EstadoDelReporteSsoma, ReportarIncidente } from './formulario'

export const metadata = { title: 'Seguridad: reportes' }

const VISTAS = [
  { valor: 'vigentes', titulo: 'Reportes' },
  { valor: 'acciones', titulo: 'Acciones correctivas' },
  { valor: 'areas', titulo: 'Por área' },
  { valor: 'anulados', titulo: 'Anulados' },
] as const

/**
 * Los reportes de seguridad. Entra cualquier cuenta: reportar no pide permiso.
 * Qué ve cada quien lo decide la base (`ssoma_reportes_visibles`): SSOMA y
 * Gerencia, todos; los demás, los suyos y los de su área sin quién los reportó.
 */
export default async function PaginaSsoma({ searchParams }: PageProps<'/ssoma'>) {
  const perfil = await exigirSesion()
  const veTodo = puede(perfil, ['ssoma.ver', 'ssoma.gestionar'])
  const gestiona = puede(perfil, 'ssoma.gestionar')
  const porOtro = puede(perfil, 'ssoma.reportar_por_otro')
  const params = await searchParams
  const vista =
    veTodo && (params.vista === 'anulados' || params.vista === 'acciones' || params.vista === 'areas') ? params.vista : 'vigentes'

  const [{ reportes, cortados }, areas, personal, acciones, planta, porArea] = await Promise.all([
    // A SSOMA, lo que espera por ella primero.
    listarReportesSsoma({ porClasificarPrimero: gestiona }),
    areasParaReportar(),
    porOtro ? personalParaReportar() : Promise.resolve([]),
    listarAccionesSsoma(),
    // La lectura de Gerencia (15.6): las tres cifras arriba, y cada área en su pestaña.
    veTodo ? seguridadDeLaPlanta() : Promise.resolve(null),
    vista === 'areas' ? seguridadPorArea() : Promise.resolve([]),
  ])
  // Cómo va cada reporte de la lista: pide los que se muestran, no «todos».
  const porReporte = await seguimientoDeReportes(reportes.map((r) => r.id))
  const alTope = cortados.porClasificar || cortados.recientes
  const accionesAlTope = acciones.length >= MAXIMO_ACCIONES_SSOMA
  // Lo que la persona tiene a su cargo: las vencidas arriba (`listarAccionesSsoma` ya las ordena).
  const mias = acciones.filter((a) => a.responsable_id === perfil.id && a.estado !== 'ANULADA')

  const boton = (
    <ReportarIncidente
      cuentaId={perfil.id}
      areaDeLaCuenta={perfil.area_id}
      areas={areas}
      personal={personal}
      // El mismo permiso con que la base deja registrar fuera de los 30 días.
      sinPlazo={gestiona}
    />
  )

  if (veTodo) {
    // Para SSOMA, después de los por clasificar, los clasificados sin ninguna
    // acción: si no, se quedan quietos sin que nadie se entere.
    const esperando = (r: ReporteSsoma) =>
      !gestiona ? 2 : r.estado === 'REPORTADO' ? 0 : r.estado === 'CLASIFICADO' && seguimientoDe(porReporte, r.id).acciones === 0 ? 1 : 2
    const vigentes = reportes
      .filter((r) => r.estado !== 'ANULADO')
      .map((r, i) => ({ r, i }))
      .sort((a, b) => esperando(a.r) - esperando(b.r) || a.i - b.i)
      .map(({ r }) => r)
    const anulados = reportes.filter((r) => r.estado === 'ANULADO')
    // Los corregidos (todas sus acciones cerradas) ya no están abiertos: van plegados al pie,
    // y la pestaña cuenta lo mismo que la cifra «Reportes abiertos» de arriba.
    const abiertos = vigentes.filter((r) => r.estado !== 'CERRADO')
    const corregidos = vigentes.filter((r) => r.estado === 'CERRADO')
    const lista = vista === 'anulados' ? anulados : abiertos
    return (
      <>
        <EncabezadoPagina
          titulo="Reportes de seguridad"
          ayuda="Cada accidente, incidente o condición insegura que reporta la gente desde su teléfono, con su número RI. Llega aquí y a la campana de SSOMA apenas se envía. Un reporte no se borra: si está mal, SSOMA lo anula con su motivo."
          migas={[{ titulo: 'SSOMA' }]}
          acciones={boton}
          estado={<EstadoDelReporteSsoma />}
        />
        {/* Gerencia o SSOMA también pueden tener una acción a su cargo: no se pierde entre las demás. */}
        {mias.some((a) => a.estado === 'ABIERTA') && (
          <div className="mb-5">
            <TusAcciones mias={mias} cuentaId={perfil.id} />
          </div>
        )}
        {planta && <CifrasDeSeguridad planta={planta} />}
        <Vistas
          etiqueta="Vista"
          className="mb-3"
          vistas={VISTAS.map((v) => ({
            clave: v.valor,
            titulo: v.titulo,
            href: v.valor === 'vigentes' ? '/ssoma' : `/ssoma?vista=${v.valor}`,
            activa: vista === v.valor,
            cuenta:
              v.valor === 'areas'
                ? undefined
                : v.valor === 'anulados'
                  ? anulados.length
                  : v.valor === 'acciones'
                    ? acciones.length
                    : abiertos.length,
          }))}
        />
        {vista === 'areas' ? (
          <SeguridadPorArea
            areas={porArea}
            vencidas={acciones.filter((a) => a.estado === 'ABIERTA' && (a.dias_para_vencer ?? 0) < 0)}
            porReporte={porReporte}
            cuentaId={perfil.id}
          />
        ) : vista === 'acciones' ? (
          <Tarjeta className="overflow-hidden">
            <TablaDeAcciones
              acciones={acciones}
              cuentaId={perfil.id}
              conReporte
              porReporte={porReporte}
              vacio={{
                titulo: 'Todavía no hay acciones correctivas',
                descripcion: 'Se encargan desde cada reporte, después de clasificarlo y anotar la causa, y nacen con cada hallazgo de una inspección.',
              }}
            />
          </Tarjeta>
        ) : (
          <Tarjeta className="overflow-hidden">
            <TablaDeReportes
              reportes={lista}
              porReporte={porReporte}
              conAutor
              paraSsoma={gestiona}
              vacio={
                vista === 'anulados'
                  ? {
                      titulo: 'No hay reportes anulados',
                      descripcion: 'Un reporte mal hecho se anula desde su ficha, con su motivo.',
                    }
                  : corregidos.length > 0
                    ? {
                        titulo: 'Ningún reporte abierto',
                        descripcion: 'Todos los reportes vigentes tienen sus acciones cerradas: están en «Ver los corregidos».',
                      }
                    : {
                        titulo: 'Todavía no hay reportes',
                        descripcion:
                          'Cuando alguien reporte un accidente, un incidente o una condición insegura, aparece aquí y en la campana.',
                      }
              }
            />
            {vista === 'vigentes' && corregidos.length > 0 && (
              <div className="border-t border-borde px-4">
                <Pliegue
                  titulo={corregidos.length === 1 ? 'Ver el corregido' : `Ver los corregidos (${corregidos.length})`}
                  data-reportes-corregidos={String(corregidos.length)}
                >
                  <div className="-mx-4 border-t border-borde">
                    <TablaDeReportes
                      reportes={corregidos}
                      porReporte={porReporte}
                      conAutor
                      paraSsoma={gestiona}
                      vacio={{ titulo: '', descripcion: '' }}
                    />
                  </div>
                </Pliegue>
              </div>
            )}
          </Tarjeta>
        )}
        {alTope && (vista === 'vigentes' || vista === 'anulados') && <Tope cortados={cortados} />}
        {accionesAlTope && (vista === 'acciones' || vista === 'areas') && (
          <p className="mt-3 text-xs text-texto-suave">
            Se muestran {MAXIMO_ACCIONES_SSOMA} acciones: primero las vencidas y las abiertas.
          </p>
        )}
      </>
    )
  }

  const mios = reportes.filter((r) => r.alcance === 'PROPIO')
  const delArea = reportes.filter((r) => r.alcance === 'AREA')
  return (
    <>
      <EncabezadoPagina
        titulo={mias.length > 0 ? 'Seguridad: reportes y acciones' : 'Reportar a SSOMA'}
        descripcion="Un accidente, un incidente o algo inseguro que viste: repórtalo en el momento, con foto si puedes."
        ayuda="Tu reporte le llega a SSOMA al instante, con su número. Aquí ves cómo va cada uno de los tuyos. Quién reportó lo ven solo SSOMA y Gerencia: tu área ve el hecho, no tu nombre."
        migas={[{ titulo: 'SSOMA' }]}
        acciones={boton}
        estado={<EstadoDelReporteSsoma />}
      />
      <div className="space-y-5">
        {mias.length > 0 && <TusAcciones mias={mias} cuentaId={perfil.id} />}
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo="Tus reportes" descripcion={mios.length > 0 ? `${mios.length} ${mios.length === 1 ? 'reporte' : 'reportes'}` : undefined} />
          <TablaDeReportes
            reportes={mios}
            porReporte={porReporte}
            vacio={{
              titulo: 'Todavía no has reportado nada',
              descripcion: 'Si ves algo inseguro o pasa un incidente, toca «Reportar incidente». Toma un minuto.',
            }}
          />
        </Tarjeta>
        {delArea.length > 0 && (
          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera
              titulo="En tu área"
              descripcion="Lo que se reportó donde trabajas, para que estés al tanto. No se muestra quién lo reportó."
            />
            <TablaDeReportes reportes={delArea} porReporte={porReporte} vacio={{ titulo: 'Nada reportado en tu área', descripcion: '' }} />
          </Tarjeta>
        )}
      </div>
      {alTope && <Tope cortados={cortados} />}
    </>
  )
}

/** «40 días», «1 día». */
function dias(n: number) {
  return `${n} ${n === 1 ? 'día' : 'días'}`
}

/**
 * La lectura de Gerencia de toda la planta (15.6), arriba de las pestañas: los días
 * sin accidentes, los reportes abiertos y las acciones vencidas. Cada cifra lleva a
 * la pestaña donde se ve el detalle.
 */
function CifrasDeSeguridad({ planta: p }: { planta: SeguridadDeLaPlanta }) {
  const sinAccidentes = p.ultimoAccidente
    ? `Último: ${fecha(p.ultimoAccidente)}${p.areaDelUltimo ? ` · ${p.areaDelUltimo}` : ''}`
    : p.registroDesde
      ? `Ningún accidente desde el primer registro, el ${fecha(p.registroDesde)}`
      : 'Todavía no hay reportes'
  return (
    <section aria-label="Cómo va la seguridad de la planta" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3" data-cifras-ssoma>
      <Indicador
        // En el teléfono va sola a todo lo ancho: es la que se viene a mirar.
        className="col-span-2 sm:col-span-1 [&_.rotulo-indicador]:min-h-0"
        titulo="Días sin accidentes"
        icono={ShieldCheck}
        valor={p.diasSinAccidentes ?? '—'}
        pie={sinAccidentes}
        href="/ssoma?vista=areas"
      />
      <Indicador
        titulo="Reportes abiertos"
        icono={ClipboardList}
        valor={p.reportesAbiertos}
        tono={p.porClasificar > 0 ? 'aviso' : 'neutro'}
        pie={p.porClasificar > 0 ? `${p.porClasificar} por clasificar` : p.reportesAbiertos > 0 ? 'Todos clasificados' : 'Ninguno abierto'}
        href="/ssoma"
      />
      <Indicador
        titulo="Acciones vencidas"
        icono={AlarmClock}
        valor={p.accionesVencidas}
        tono={p.accionesVencidas > 0 ? 'peligro' : 'neutro'}
        pie={`De ${p.accionesAbiertas} ${p.accionesAbiertas === 1 ? 'abierta' : 'abiertas'}`}
        // Lleva a la lista de las vencidas, no a todas las abiertas.
        href="/ssoma?vista=areas#vencidas"
      />
    </section>
  )
}

/**
 * Cada área con sus días sin accidentes, sus reportes abiertos y sus acciones
 * vencidas, en el orden de la empresa; debajo, cuáles son las vencidas.
 */
function SeguridadPorArea({
  areas,
  vencidas: todas,
  porReporte,
  cuentaId,
}: {
  areas: SeguridadDelArea[]
  vencidas: AccionSsoma[]
  porReporte: Record<string, SeguimientoSsoma>
  cuentaId: string
}) {
  // Las vencidas, agrupadas por área en el orden de la tabla; dentro, la más atrasada primero (ya vienen así).
  const orden = new Map(areas.map((a, i) => [a.area, i]))
  const vencidas = todas
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (orden.get(x.a.area) ?? areas.length) - (orden.get(y.a.area) ?? areas.length) || x.i - y.i)
    .map(({ a }) => a)
  // Las que nunca tuvieron un accidente ni tienen nada abierto dicen todas lo mismo: van plegadas.
  const conAlgo = areas.filter((a) => a.ultimoAccidente || a.reportesAbiertos > 0 || a.accionesAbiertas > 0)
  const tranquilas = areas.filter((a) => !conAlgo.includes(a))
  return (
    <div className="space-y-5">
      <Tarjeta className="overflow-hidden" data-seguridad-por-area>
        <TarjetaCabecera
          titulo="Por área"
          descripcion="Días sin accidentes, reportes abiertos y acciones vencidas de cada área."
          ayuda="Accidente es lo que SSOMA clasificó como accidente leve, incapacitante o mortal, y lo que se reportó como accidente y todavía no se clasifica. Los días se cuentan desde el día en que pasó. Si un área nunca tuvo uno, se cuentan desde el día en que entró el primer reporte al sistema, o desde que se creó el área si es más nueva. Un reporte está abierto mientras no se cierren todas sus acciones, y una acción está vencida si su fecha límite ya pasó."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Área</TH>
              <TH className="hidden sm:table-cell">Días sin accidentes</TH>
              <TH className="hidden sm:table-cell">Reportes abiertos</TH>
              <TH className="hidden sm:table-cell">Acciones vencidas</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {conAlgo.length === 0 ? (
              <SinDatos
                titulo="Ninguna área con accidentes ni nada abierto"
                descripcion="Cuando un área tenga un accidente, un reporte abierto o una acción correctiva, aparece aquí."
              />
            ) : (
              conAlgo.map((a) => <FilaDeArea key={a.area_id} area={a} />)
            )}
          </tbody>
        </Tabla>
        {tranquilas.length > 0 && (
          <div className="border-t border-borde px-4">
            <Pliegue
              titulo={
                tranquilas.length === 1
                  ? 'Ver el área sin accidentes ni nada abierto'
                  : `Ver las ${tranquilas.length} áreas sin accidentes ni nada abierto`
              }
              data-areas-tranquilas={String(tranquilas.length)}
            >
              <p className="pb-2 text-xs text-texto-suave">
                Ningún accidente registrado, ni reportes ni acciones abiertas. Los días, desde el primer registro o desde que se creó el
                área.
              </p>
              <ul className="grid gap-x-6 gap-y-1 pb-3 text-sm text-texto sm:grid-cols-2 lg:grid-cols-3">
                {tranquilas.map((a) => (
                  <li key={a.area_id} data-area-tranquila={a.area} className="flex items-baseline justify-between gap-3">
                    <span>{a.area}</span>
                    <span className="tabular text-xs whitespace-nowrap text-texto-suave">
                      {a.diasSinAccidentes === null ? '—' : dias(a.diasSinAccidentes)}
                    </span>
                  </li>
                ))}
              </ul>
            </Pliegue>
          </div>
        )}
      </Tarjeta>
      <Tarjeta id="vencidas" className="scroll-mt-4 overflow-hidden" data-vencidas-por-area>
        <TarjetaCabecera
          titulo="Acciones vencidas"
          descripcion={
            vencidas.length > 0
              ? `${vencidas.length} ${vencidas.length === 1 ? 'acción' : 'acciones'}, por área y la más atrasada primero`
              : undefined
          }
        />
        <TablaDeAcciones
          acciones={vencidas}
          cuentaId={cuentaId}
          conReporte
          porReporte={porReporte}
          vacio={{ titulo: 'Ninguna acción vencida', descripcion: 'Todas las acciones abiertas están dentro de su fecha límite.' }}
        />
      </Tarjeta>
    </div>
  )
}

function FilaDeArea({ area: a }: { area: SeguridadDelArea }) {
  const ultimo = a.ultimoAccidente
    ? `último el ${fecha(a.ultimoAccidente)}`
    : a.diasSinAccidentes === null
      ? 'sin registro todavía'
      : 'desde el primer registro'
  const reportes = `${a.reportesAbiertos} ${a.reportesAbiertos === 1 ? 'reporte abierto' : 'reportes abiertos'}`
  const vencidas = `${a.accionesVencidas} ${a.accionesVencidas === 1 ? 'acción vencida' : 'acciones vencidas'}`
  return (
    <TR data-area-ssoma={a.area} data-vencidas={a.accionesVencidas || undefined}>
      <TD className={cn('align-top', a.accionesVencidas > 0 && 'border-l-2 border-l-peligro')}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-texto">{a.area}</span>
          {!a.activa && <Insignia tono="neutro">dada de baja</Insignia>}
        </div>
        {/* En el teléfono, las tres cifras van aquí: la tabla no se desliza de costado. */}
        <div className="mt-1 space-y-1 text-xs text-texto-suave sm:hidden">
          <p className="tabular">
            {a.diasSinAccidentes === null ? 'Sin registro de accidentes todavía' : `${dias(a.diasSinAccidentes)} sin accidentes · ${ultimo}`}
          </p>
          <p className="tabular">
            {reportes}
            {a.porClasificar > 0 && <span className="text-aviso"> · {a.porClasificar} por clasificar</span>}
          </p>
          <p className={cn('tabular', a.accionesVencidas > 0 && 'font-medium text-peligro')}>
            {vencidas}
            {a.accionesAbiertas > 0 ? ` de ${a.accionesAbiertas} ${a.accionesAbiertas === 1 ? 'abierta' : 'abiertas'}` : ''}
          </p>
        </div>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-sm font-semibold text-texto">{a.diasSinAccidentes ?? '—'}</p>
        <p className="tabular text-xs text-texto-suave">{ultimo}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-sm text-texto">{a.reportesAbiertos}</p>
        {a.porClasificar > 0 && <p className="tabular text-xs text-aviso">{a.porClasificar} por clasificar</p>}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className={cn('tabular text-sm', a.accionesVencidas > 0 ? 'font-semibold text-peligro' : 'text-texto')}>{a.accionesVencidas}</p>
        <p className="tabular text-xs text-texto-suave">
          {a.accionesAbiertas > 0 ? `de ${a.accionesAbiertas} ${a.accionesAbiertas === 1 ? 'abierta' : 'abiertas'}` : 'ninguna abierta'}
          {a.vencidaMasAntigua ? ` · la más vieja vencía el ${fecha(a.vencidaMasAntigua)}` : ''}
        </p>
      </TD>
    </TR>
  )
}

/** Dice cuál de las dos consultas se cortó: la de los que esperan clasificación (solo SSOMA) o la de los recientes. */
function Tope({ cortados }: { cortados: { porClasificar: boolean; recientes: boolean } }) {
  const texto =
    cortados.porClasificar && cortados.recientes
      ? `Se muestran los ${MAXIMO_REPORTES_SSOMA} reportes por clasificar más antiguos y, del resto, los ${MAXIMO_REPORTES_SSOMA} más recientes.`
      : cortados.porClasificar
        ? `Se muestran los ${MAXIMO_REPORTES_SSOMA} reportes por clasificar más antiguos.`
        : `Se muestran los ${MAXIMO_REPORTES_SSOMA} reportes más recientes.`
  return <p className="mt-3 text-xs text-texto-suave">{texto}</p>
}

function TablaDeReportes({
  reportes,
  porReporte,
  conAutor = false,
  paraSsoma = false,
  vacio,
}: {
  reportes: ReporteSsoma[]
  /** Cómo va cada uno: sus acciones abiertas y vencidas. */
  porReporte: Record<string, SeguimientoSsoma>
  /** La columna de quién reportó: solo para SSOMA y Gerencia. */
  conAutor?: boolean
  /** Quien mira es SSOMA: el estado dice lo que le toca hacer. */
  paraSsoma?: boolean
  vacio: { titulo: string; descripcion: string }
}) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Reporte</TH>
          <TH className="hidden md:table-cell">Dónde</TH>
          {conAutor && <TH className="hidden lg:table-cell">Reportó</TH>}
          <TH className="hidden sm:table-cell">Cuándo pasó</TH>
          <TH className="hidden sm:table-cell">Cómo va</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {reportes.length === 0 ? (
          <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
        ) : (
          reportes.map((r) => (
            <FilaReporte key={r.id} reporte={r} seg={seguimientoDe(porReporte, r.id)} conAutor={conAutor} paraSsoma={paraSsoma} />
          ))
        )}
      </tbody>
    </Tabla>
  )
}

function FilaReporte({
  reporte: r,
  seg,
  conAutor,
  paraSsoma,
}: {
  reporte: ReporteSsoma
  seg: SeguimientoSsoma
  conAutor: boolean
  paraSsoma: boolean
}) {
  // Lo que SSOMA clasificó manda sobre lo que se reportó: es lo que cuentan las cifras de arriba.
  // La clasificación solo llega a SSOMA y Gerencia; a los demás, el tipo con que se reportó.
  const reportado = TIPO_REPORTE_SSOMA[r.tipo]
  const clasificado = seg.clasificacion ? CLASIFICACION_SSOMA[seg.clasificacion] : undefined
  const tipo = clasificado ?? reportado
  const cambio = clasificado && reportado && !clasificado.etiqueta.startsWith(reportado.etiqueta)
  const anulado = r.estado === 'ANULADO'
  const autor = r.reporto ? [r.reporto, r.reporto_puesto].filter(Boolean).join(' · ') : null
  return (
    <TR data-reporte-ssoma={r.numero} data-anulado={anulado || undefined}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* En el teléfono, un blanco de 44 px de alto: el número es el único camino a la ficha. */}
          <Link href={`/ssoma/${r.id}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
            {r.numero}
          </Link>
          {tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : r.tipo}
          {cambio && reportado && <span className="text-xs text-texto-suave">reportado como {reportado.etiqueta.toLowerCase()}</span>}
        </div>
        <p className="mt-1 line-clamp-2 max-w-xl text-sm text-texto">{r.descripcion}</p>
        {r.fotos > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-texto-suave">
            <Camera aria-hidden className="size-3.5" />
            {r.fotos} {r.fotos === 1 ? 'foto' : 'fotos'}
          </p>
        )}
        {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
        <div className="mt-1 space-y-1 text-xs text-texto-suave md:hidden">
          <p>
            {r.area} · {r.lugar}
          </p>
        </div>
        {!conAutor && r.a_nombre_de && <p className="mt-1 text-xs text-texto-suave">A nombre de {r.a_nombre_de}</p>}
        {conAutor && autor && (
          <p className="mt-1 text-xs text-texto-suave lg:hidden">
            Reportó {autor}
            {r.a_nombre_de ? `, a nombre de ${r.a_nombre_de}` : ''}
          </p>
        )}
        <div className="mt-1 space-y-1 sm:hidden">
          <p className="tabular text-xs text-texto-suave">Pasó {fechaHora(r.ocurrido_en)}</p>
          <Situacion reporte={r} seg={seg} paraSsoma={paraSsoma} />
        </div>
      </TD>
      <TD className="hidden align-top md:table-cell">
        <p className="text-sm text-texto">{r.area}</p>
        <p className="max-w-[16rem] text-xs text-texto-suave">{r.lugar}</p>
      </TD>
      {conAutor && (
        <TD className="hidden align-top lg:table-cell">
          <p className="text-sm text-texto">{r.reporto ?? '—'}</p>
          {r.reporto_puesto && <p className="text-xs text-texto-suave">{r.reporto_puesto}</p>}
          {r.a_nombre_de && <p className="mt-1 text-xs text-texto-suave">A nombre de {r.a_nombre_de}</p>}
        </TD>
      )}
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs whitespace-nowrap text-texto">{fechaHora(r.ocurrido_en)}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <Situacion reporte={r} seg={seg} paraSsoma={paraSsoma} />
      </TD>
    </TR>
  )
}

/** En quién está el reporte y desde cuándo; si está en corrección, cuántas acciones faltan. */
function Situacion({ reporte: r, seg, paraSsoma }: { reporte: ReporteSsoma; seg: SeguimientoSsoma; paraSsoma: boolean }) {
  // Para SSOMA, «En SSOMA» es «te toca clasificarlo».
  const estado =
    paraSsoma && r.estado === 'REPORTADO' ? { etiqueta: 'Por clasificar', tono: 'aviso' as const } : ESTADO_REPORTE_SSOMA[r.estado]
  const espera = diasEnEspera(r.dias_en_espera)
  const faltan = r.estado === 'CLASIFICADO' ? seg.abiertas : 0
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : r.estado}
      {espera && <span className="text-xs text-texto-suave">desde {espera}</span>}
      {r.estado === 'CLASIFICADO' &&
        seg.acciones === 0 &&
        (paraSsoma ? (
          <Insignia tono="aviso">sin acción encargada</Insignia>
        ) : (
          <span className="text-xs text-texto-suave">sin acciones aún</span>
        ))}
      {faltan > 0 && (
        <span className="text-xs text-texto-suave">
          {faltan} {faltan === 1 ? 'acción abierta' : 'acciones abiertas'}
        </span>
      )}
      {seg.vencidas > 0 && (
        <Insignia tono="peligro">
          {seg.vencidas} {seg.vencidas === 1 ? 'vencida' : 'vencidas'}
        </Insignia>
      )}
    </div>
  )
}

/**
 * Las acciones correctivas, con las vencidas arriba (ya vienen ordenadas). Cada
 * fila lleva a la acción dentro de su reporte o de su inspección, donde se
 * cierra con evidencia.
 */
function TablaDeAcciones({
  acciones,
  cuentaId,
  conReporte = false,
  porReporte,
  vacio,
}: {
  acciones: AccionSsoma[]
  cuentaId: string
  conReporte?: boolean
  /** Para SSOMA y Gerencia: la clasificación de cada reporte, que manda sobre el tipo reportado. */
  porReporte?: Record<string, SeguimientoSsoma>
  vacio: { titulo: string; descripcion: string }
}) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Acción</TH>
          <TH className="hidden md:table-cell">Responsable</TH>
          <TH className="hidden sm:table-cell">Fecha límite</TH>
          <TH className="hidden sm:table-cell">Cómo va</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {acciones.length === 0 ? (
          <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
        ) : (
          acciones.map((a) => (
            <FilaAccion
              key={a.id}
              accion={a}
              mia={a.responsable_id === cuentaId}
              conReporte={conReporte}
              clasificacion={porReporte && a.reporte_id ? seguimientoDe(porReporte, a.reporte_id).clasificacion : null}
            />
          ))
        )}
      </tbody>
    </Tabla>
  )
}

function FilaAccion({
  accion: a,
  mia,
  conReporte,
  clasificacion,
}: {
  accion: AccionSsoma
  mia: boolean
  conReporte: boolean
  clasificacion: string | null
}) {
  const vence = a.estado === 'ABIERTA' ? cuandoVence(a.dias_para_vencer) : null
  const vencida = a.estado === 'ABIERTA' && (a.dias_para_vencer ?? 0) < 0
  const tipo = (clasificacion ? CLASIFICACION_SSOMA[clasificacion] : undefined) ?? TIPO_REPORTE_SSOMA[a.reporte_tipo]
  // A su reporte o a su inspección: donde se cierra con evidencia.
  const href = rutaDeAccion(a)
  return (
    <TR data-accion-ssoma={a.id} data-estado={a.estado} data-vencida={vencida || undefined}>
      <TD className={cn('align-top', vencida && 'border-l-2 border-l-peligro')}>
        <Link
          href={href}
          className={cn(
            'inline-flex min-h-11 items-center text-sm font-medium text-texto hover:text-acento hover:underline sm:min-h-0',
            a.estado === 'ANULADA' && 'text-texto-suave line-through',
          )}
        >
          <span className="line-clamp-2 max-w-xl">{a.descripcion}</span>
        </Link>
        {conReporte && (
          <p className="tabular mt-0.5 text-xs text-texto-suave">
            {a.reporte_numero ?? `Inspección${a.inspeccion_fecha ? ` del ${fecha(a.inspeccion_fecha)}` : ''}`}
            {tipo ? ` · ${tipo.etiqueta}` : ''} · {a.area}
          </p>
        )}
        {mia && a.estado === 'ABIERTA' && <p className="mt-0.5 text-xs font-medium text-acento">A tu cargo</p>}
        {!(mia && a.estado === 'ABIERTA') && (
          <div className="mt-1 space-y-1 text-xs text-texto-suave md:hidden">
            <p>
              {a.responsable}
              {a.responsable_puesto ? ` · ${a.responsable_puesto}` : ''}
            </p>
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:hidden">
          <EstadoDeAccion accion={a} />
          <span className="tabular text-xs text-texto-suave">hasta el {fecha(a.fecha_limite)}</span>
          {vence && <span className={cn('text-xs', vencida ? 'font-medium text-peligro' : 'text-texto-suave')}>· {vence.texto}</span>}
        </div>
      </TD>
      <TD className="hidden align-top md:table-cell">
        <p className="text-sm text-texto">{a.responsable}</p>
        {a.responsable_puesto && <p className="text-xs text-texto-suave">{a.responsable_puesto}</p>}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs whitespace-nowrap text-texto">{fecha(a.fecha_limite)}</p>
        {vence && (
          <p className={cn('text-xs', vence.tono === 'peligro' ? 'font-medium text-peligro' : 'text-texto-suave')}>{vence.texto}</p>
        )}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <EstadoDeAccion accion={a} />
      </TD>
    </TR>
  )
}

function EstadoDeAccion({ accion: a }: { accion: AccionSsoma }) {
  const vencida = a.estado === 'ABIERTA' && (a.dias_para_vencer ?? 0) < 0
  const estado = vencida ? { etiqueta: 'Vencida', tono: 'peligro' as const } : ESTADO_ACCION_SSOMA[a.estado]
  return estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : <>{a.estado}</>
}

/** Lo que SSOMA le encargó a quien mira: las abiertas (la vencida arriba) y las cerradas plegadas. */
function TusAcciones({ mias, cuentaId }: { mias: AccionSsoma[]; cuentaId: string }) {
  const miasAbiertas = mias.filter((a) => a.estado === 'ABIERTA')
  const miasVencidas = miasAbiertas.filter((a) => (a.dias_para_vencer ?? 0) < 0)
  const miasCerradas = mias.filter((a) => a.estado === 'CERRADA')
  return (
    <Tarjeta className="overflow-hidden" data-tus-acciones>
      <TarjetaCabecera
        titulo="Tus acciones correctivas"
        descripcion={
          miasAbiertas.length === 0
            ? 'Todas cerradas.'
            : [
                `${miasAbiertas.length} ${miasAbiertas.length === 1 ? 'abierta' : 'abiertas'}`,
                miasVencidas.length > 0 && `${miasVencidas.length} ${miasVencidas.length === 1 ? 'vencida' : 'vencidas'}`,
              ]
                .filter(Boolean)
                .join(' · ')
        }
        ayuda="Lo que SSOMA te encargó corregir. Ábrela, haz lo que pide y ciérrala con fotos de lo que hiciste: SSOMA recibe el aviso."
      />
      {miasAbiertas.length > 0 && (
        <TablaDeAcciones acciones={miasAbiertas} cuentaId={cuentaId} conReporte vacio={{ titulo: '', descripcion: '' }} />
      )}
      {/* Las cerradas no empujan hacia abajo lo que sí falta: van plegadas. */}
      {miasCerradas.length > 0 && (
        <div className="border-t border-borde px-4">
          <Pliegue titulo={`Ver las cerradas (${miasCerradas.length})`} data-tus-cerradas="">
            <div className="-mx-4 border-t border-borde">
              <TablaDeAcciones acciones={miasCerradas} cuentaId={cuentaId} conReporte vacio={{ titulo: '', descripcion: '' }} />
            </div>
          </Pliegue>
        </div>
      )}
    </Tarjeta>
  )
}
