import { Camera } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
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
  type AccionSsoma,
  type ReporteSsoma,
  type SeguimientoSsoma,
} from '@/lib/datos/ssoma'
import { cuandoVence, diasEnEspera, ESTADO_ACCION_SSOMA, ESTADO_REPORTE_SSOMA, TIPO_REPORTE_SSOMA } from '@/lib/dominio/ssoma'
import { fecha, fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'
import { exigirSesion, puede } from '@/lib/sesion'

import { EstadoDelReporteSsoma, ReportarIncidente } from './formulario'

export const metadata = { title: 'Seguridad: reportes' }

const VISTAS = [
  { valor: 'vigentes', titulo: 'Reportes' },
  { valor: 'acciones', titulo: 'Acciones correctivas' },
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
  const vista = veTodo && (params.vista === 'anulados' || params.vista === 'acciones') ? params.vista : 'vigentes'

  const [reportes, areas, personal, acciones] = await Promise.all([
    // A SSOMA, lo que espera por ella primero.
    listarReportesSsoma({ porClasificarPrimero: gestiona }),
    areasParaReportar(),
    porOtro ? personalParaReportar() : Promise.resolve([]),
    listarAccionesSsoma(),
  ])
  // Cómo va cada reporte de la lista: pide los que se muestran, no «todos».
  const porReporte = await seguimientoDeReportes(reportes.map((r) => r.id))
  const alTope = reportes.length >= MAXIMO_REPORTES_SSOMA
  const accionesAlTope = acciones.length >= MAXIMO_ACCIONES_SSOMA
  // Lo que la persona tiene a su cargo: las vencidas arriba (`listarAccionesSsoma` ya las ordena).
  const mias = acciones.filter((a) => a.responsable_id === perfil.id && a.estado !== 'ANULADA')
  const miasAbiertas = mias.filter((a) => a.estado === 'ABIERTA')
  const miasVencidas = miasAbiertas.filter((a) => (a.dias_para_vencer ?? 0) < 0)

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
    const lista = vista === 'anulados' ? anulados : vigentes
    return (
      <>
        <EncabezadoPagina
          titulo="Reportes de seguridad"
          ayuda="Cada accidente, incidente o condición insegura que reporta la gente desde su teléfono, con su número RI. Llega aquí y a la campana de SSOMA apenas se envía. Un reporte no se borra: si está mal, SSOMA lo anula con su motivo."
          migas={[{ titulo: 'SSOMA' }]}
          acciones={boton}
          estado={<EstadoDelReporteSsoma />}
        />
        <Vistas
          etiqueta="Vista"
          className="mb-3"
          vistas={VISTAS.map((v) => ({
            clave: v.valor,
            titulo: v.titulo,
            href: v.valor === 'vigentes' ? '/ssoma' : `/ssoma?vista=${v.valor}`,
            activa: vista === v.valor,
            cuenta: v.valor === 'anulados' ? anulados.length : v.valor === 'acciones' ? acciones.length : vigentes.length,
          }))}
        />
        {vista === 'acciones' ? (
          <Tarjeta className="overflow-hidden">
            <TablaDeAcciones
              acciones={acciones}
              cuentaId={perfil.id}
              conReporte
              vacio={{
                titulo: 'Todavía no hay acciones correctivas',
                descripcion: 'Se encargan desde cada reporte, después de clasificarlo y anotar la causa.',
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
                  : {
                      titulo: 'Todavía no hay reportes',
                      descripcion:
                        'Cuando alguien reporte un accidente, un incidente o una condición insegura, aparece aquí y en la campana.',
                    }
              }
            />
          </Tarjeta>
        )}
        {alTope && vista !== 'acciones' && <Tope />}
        {accionesAlTope && vista === 'acciones' && (
          <p className="mt-3 text-xs text-texto-suave">
            Se muestran {MAXIMO_ACCIONES_SSOMA} acciones: primero las vencidas y las abiertas.
          </p>
        )}
      </>
    )
  }

  const mios = reportes.filter((r) => r.alcance === 'PROPIO')
  const miasCerradas = mias.filter((a) => a.estado === 'CERRADA')
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
        {mias.length > 0 && (
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
              <TablaDeAcciones acciones={miasAbiertas} cuentaId={perfil.id} conReporte vacio={{ titulo: '', descripcion: '' }} />
            )}
            {/* Las cerradas no empujan hacia abajo lo que sí falta: van plegadas. */}
            {miasCerradas.length > 0 && (
              <div className="border-t border-borde px-4">
                <Pliegue titulo={`Ver las cerradas (${miasCerradas.length})`} data-tus-cerradas="">
                  <div className="-mx-4 border-t border-borde">
                    <TablaDeAcciones acciones={miasCerradas} cuentaId={perfil.id} conReporte vacio={{ titulo: '', descripcion: '' }} />
                  </div>
                </Pliegue>
              </div>
            )}
          </Tarjeta>
        )}
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Tus reportes"
            descripcion={mios.length > 0 ? `${mios.length} ${mios.length === 1 ? 'reporte' : 'reportes'}` : undefined}
          />
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
      {alTope && <Tope />}
    </>
  )
}

function Tope() {
  return <p className="mt-3 text-xs text-texto-suave">Se muestran los {MAXIMO_REPORTES_SSOMA} reportes más recientes.</p>
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
  const tipo = TIPO_REPORTE_SSOMA[r.tipo]
  const anulado = r.estado === 'ANULADO'
  const autor = r.reporto ? [r.reporto, r.reporto_puesto].filter(Boolean).join(' · ') : null
  return (
    <TR data-reporte-ssoma={r.numero} data-anulado={anulado || undefined}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* En el teléfono, un blanco de 44 px de alto: el número es el único camino a la ficha. */}
          <Link
            href={`/ssoma/${r.id}`}
            className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0"
          >
            {r.numero}
          </Link>
          {tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : r.tipo}
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
 * fila lleva a la acción dentro de su reporte, donde se cierra con evidencia.
 */
function TablaDeAcciones({
  acciones,
  cuentaId,
  conReporte = false,
  vacio,
}: {
  acciones: AccionSsoma[]
  cuentaId: string
  conReporte?: boolean
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
          acciones.map((a) => <FilaAccion key={a.id} accion={a} mia={a.responsable_id === cuentaId} conReporte={conReporte} />)
        )}
      </tbody>
    </Tabla>
  )
}

function FilaAccion({ accion: a, mia, conReporte }: { accion: AccionSsoma; mia: boolean; conReporte: boolean }) {
  const vence = a.estado === 'ABIERTA' ? cuandoVence(a.dias_para_vencer) : null
  const vencida = a.estado === 'ABIERTA' && (a.dias_para_vencer ?? 0) < 0
  const tipo = TIPO_REPORTE_SSOMA[a.reporte_tipo]
  const href = `/ssoma/${a.reporte_id}#accion-${a.id}`
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
            {a.reporte_numero}
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
