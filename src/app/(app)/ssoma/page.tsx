import { Camera } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import {
  areasParaReportar,
  listarReportesSsoma,
  MAXIMO_REPORTES_SSOMA,
  personalParaReportar,
  type ReporteSsoma,
} from '@/lib/datos/ssoma'
import { diasEnEspera, ESTADO_REPORTE_SSOMA, TIPO_REPORTE_SSOMA } from '@/lib/dominio/ssoma'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { EstadoDelReporteSsoma, ReportarIncidente } from './formulario'

export const metadata = { title: 'Seguridad: reportes' }

const VISTAS = [
  { valor: 'vigentes', titulo: 'Vigentes' },
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
  const porOtro = puede(perfil, 'ssoma.reportar_por_otro')
  const params = await searchParams
  const vista = veTodo && params.vista === 'anulados' ? 'anulados' : 'vigentes'

  const [reportes, areas, personal] = await Promise.all([
    listarReportesSsoma(),
    areasParaReportar(),
    porOtro ? personalParaReportar() : Promise.resolve([]),
  ])
  const alTope = reportes.length >= MAXIMO_REPORTES_SSOMA

  const boton = (
    <ReportarIncidente
      cuentaId={perfil.id}
      areaDeLaCuenta={perfil.area_id}
      areas={areas}
      personal={personal}
      // El mismo permiso con que la base deja registrar fuera de los 30 días.
      sinPlazo={puede(perfil, 'ssoma.gestionar')}
    />
  )

  if (veTodo) {
    const vigentes = reportes.filter((r) => r.estado !== 'ANULADO')
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
            cuenta: v.valor === 'anulados' ? anulados.length : vigentes.length,
          }))}
        />
        <Tarjeta className="overflow-hidden">
          <TablaDeReportes
            reportes={lista}
            conAutor
            vacio={
              vista === 'anulados'
                ? { titulo: 'No hay reportes anulados', descripcion: 'Un reporte mal hecho se anula desde su ficha, con su motivo.' }
                : {
                    titulo: 'Todavía no hay reportes',
                    descripcion: 'Cuando alguien reporte un accidente, un incidente o una condición insegura, aparece aquí y en la campana.',
                  }
            }
          />
        </Tarjeta>
        {alTope && <Tope />}
      </>
    )
  }

  const mios = reportes.filter((r) => r.alcance === 'PROPIO')
  const delArea = reportes.filter((r) => r.alcance === 'AREA')
  return (
    <>
      <EncabezadoPagina
        titulo="Reportar a SSOMA"
        descripcion="Un accidente, un incidente o algo inseguro que viste: repórtalo en el momento, con foto si puedes."
        ayuda="Tu reporte le llega a SSOMA al instante, con su número. Aquí ves cómo va cada uno de los tuyos. Quién reportó lo ven solo SSOMA y Gerencia: tu área ve el hecho, no tu nombre."
        migas={[{ titulo: 'SSOMA' }]}
        acciones={boton}
        estado={<EstadoDelReporteSsoma />}
      />
      <div className="space-y-5">
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo="Tus reportes" descripcion={mios.length > 0 ? `${mios.length} ${mios.length === 1 ? 'reporte' : 'reportes'}` : undefined} />
          <TablaDeReportes
            reportes={mios}
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
            <TablaDeReportes reportes={delArea} vacio={{ titulo: 'Nada reportado en tu área', descripcion: '' }} />
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
  conAutor = false,
  vacio,
}: {
  reportes: ReporteSsoma[]
  /** La columna de quién reportó: solo para SSOMA y Gerencia. */
  conAutor?: boolean
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
          reportes.map((r) => <FilaReporte key={r.id} reporte={r} conAutor={conAutor} />)
        )}
      </tbody>
    </Tabla>
  )
}

function FilaReporte({ reporte: r, conAutor }: { reporte: ReporteSsoma; conAutor: boolean }) {
  const tipo = TIPO_REPORTE_SSOMA[r.tipo]
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
          <Situacion reporte={r} />
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
        <Situacion reporte={r} />
      </TD>
    </TR>
  )
}

/** En quién está el reporte y desde cuándo. */
function Situacion({ reporte: r }: { reporte: ReporteSsoma }) {
  const estado = ESTADO_REPORTE_SSOMA[r.estado]
  const espera = diasEnEspera(r.dias_en_espera)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : r.estado}
      {espera && <span className="text-xs text-texto-suave">desde {espera}</span>}
    </div>
  )
}
