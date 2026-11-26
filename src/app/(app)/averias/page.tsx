import { Camera, Link2 } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { equiposParaReportar, listarAverias, MAXIMO_AVERIAS, type Averia } from '@/lib/datos/averias'
import { ESTADO_AVERIA, ordenarBandeja, TIPO_AVERIA } from '@/lib/dominio/averias'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { EstadoDelReporteDeAveria, ReportarAveria } from './formulario'

export const metadata = { title: 'Averías de equipos' }

const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * La bandeja de Mantenimiento (Plan 16.3): lo que le toca, por gravedad y días
 * en espera; lo que espera que quien la reportó confirme; lo que ya quedó bien;
 * y lo anulado.
 */
const VISTAS = [
  { valor: 'por-atender', titulo: 'Por atender', estados: ['REPORTADA', 'EN_ATENCION'] },
  { valor: 'por-confirmar', titulo: 'Por confirmar', estados: ['CERRADA'] },
  { valor: 'cerradas', titulo: 'Quedaron bien', estados: ['CONFIRMADA'] },
  { valor: 'anuladas', titulo: 'Anuladas', estados: ['ANULADA'] },
] as const
type Vista = (typeof VISTAS)[number]['valor']

const VACIO_DE: Record<Vista, { titulo: string; descripcion: string }> = {
  'por-atender': {
    titulo: 'Nada por atender',
    descripcion: 'Cuando alguien reporte una avería o una posible avería, aparece aquí y en la campana, la más grave primero.',
  },
  'por-confirmar': {
    titulo: 'Nada esperando confirmación',
    descripcion: 'Al cerrar una avería, queda aquí hasta que quien la reportó diga si quedó bien.',
  },
  cerradas: { titulo: 'Todavía ninguna confirmada', descripcion: 'Las averías que quien las reportó dio por arregladas.' },
  anuladas: { titulo: 'No hay reportes anulados', descripcion: 'Un reporte mal hecho se anula desde su ficha, con su motivo.' },
}

/**
 * Los reportes de avería (Plan 16.2). Entra cualquier cuenta: reportar no pide
 * permiso. Qué ve cada quien lo decide la base (`averias_visibles`):
 * Mantenimiento y Gerencia, todos; los demás, los suyos y los del área del equipo.
 */
export default async function PaginaAverias({ searchParams }: PageProps<'/averias'>) {
  const perfil = await exigirSesion()
  const veTodo = puede(perfil, ['averias.atender', 'averias.ver'])
  const atiende = puede(perfil, 'averias.atender')
  const params = await searchParams
  const vista: Vista = VISTAS.find((v) => v.valor === params.vista)?.valor ?? 'por-atender'
  const equipoInicial = typeof params.equipo === 'string' && FORMA_DE_ID.test(params.equipo) ? params.equipo : ''

  const [{ averias, alTope }, equipos] = await Promise.all([listarAverias(), equiposParaReportar()])

  // Sin equipos en el padrón no hay qué elegir: en vez de una ventana que no deja
  // enviar, se dice por qué y qué hacer.
  const boton = equipos.length > 0 ? <ReportarAveria cuentaId={perfil.id} equipos={equipos} equipoInicial={equipoInicial} /> : null
  const sinPadron = equipos.length === 0 && <PadronVacio carga={puede(perfil, 'equipos.gestionar')} />

  if (veTodo) {
    const de = (v: (typeof VISTAS)[number]) => averias.filter((a) => (v.estados as readonly string[]).includes(a.estado))
    const actual = VISTAS.find((v) => v.valor === vista) ?? VISTAS[0]
    // Lo que le toca a Mantenimiento, la más grave primero; lo demás, lo más reciente primero.
    const lista = vista === 'por-atender' ? ordenarBandeja(de(actual)) : de(actual)
    return (
      <>
        <EncabezadoPagina
          titulo="Averías de equipos"
          ayuda={
            atiende
              ? 'Cada avería o posible avería que reporta la gente desde su teléfono, con su número AV, la más grave primero y, entre las iguales, la que lleva más días esperando. Ábrela para anotar el diagnóstico, enlazar el RQ de los repuestos y cerrarla con el trabajo hecho: el equipo vuelve a operativo y quien la reportó confirma si quedó bien. Un reporte no se borra: si está mal, se anula con su motivo.'
              : 'Cada avería o posible avería que reporta la gente, con su número AV, y cómo la atiende Mantenimiento: la más grave primero y, entre las iguales, la que lleva más días esperando. Aquí se consulta; la atiende Mantenimiento.'
          }
          migas={[{ titulo: 'Mantenimiento' }]}
          acciones={boton}
          estado={<EstadoDelReporteDeAveria />}
        />
        {sinPadron}
        {/* Mantenimiento o Gerencia también reportan: las suyas por confirmar, arriba, como a los demás. */}
        <PorConfirmar averias={averias.filter((a) => a.es_mia && a.estado === 'CERRADA')} className="mb-4" />
        <Vistas
          etiqueta="Vista"
          className="mb-4"
          vistas={VISTAS.map((v) => ({
            clave: v.valor,
            titulo: v.titulo,
            href: v.valor === 'por-atender' ? '/averias' : `/averias?vista=${v.valor}`,
            activa: vista === v.valor,
            cuenta: de(v).length,
          }))}
        />
        <Tarjeta className="overflow-hidden">
          <TablaDeAverias averias={lista} conAutor vacio={VACIO_DE[vista]} />
        </Tarjeta>
        {alTope && <Tope />}
      </>
    )
  }

  const mias = averias.filter((a) => a.alcance === 'PROPIA')
  // Lo que Mantenimiento cerró y espera que la persona diga si quedó bien: va
  // primero, y no se repite en «Tus reportes».
  const porConfirmar = mias.filter((a) => a.estado === 'CERRADA')
  const otrasMias = mias.filter((a) => a.estado !== 'CERRADA')
  // Lo del área y lo de riesgo: lo que todavía espera a alguien.
  const delArea = averias.filter((a) => a.alcance === 'AREA' && a.espera_de != null)
  // SSOMA recibe las que son un riesgo para las personas.
  const deRiesgo = averias.filter((a) => a.alcance === 'RIESGO' && a.espera_de != null)
  return (
    <>
      <EncabezadoPagina
        titulo="Reportar avería"
        ayuda="Una máquina o una herramienta que falla, o que está por fallar: repórtala en el momento, con foto si puedes. Tu reporte le llega a Mantenimiento al instante, con su número, y al responsable del área del equipo. Si es un riesgo para las personas, también a SSOMA. Aquí ves cómo va cada uno de los tuyos y los de tu área."
        migas={[{ titulo: 'Reportar' }]}
        acciones={boton}
        estado={<EstadoDelReporteDeAveria />}
      />
      {sinPadron}
      <div className="space-y-5">
        <PorConfirmar averias={porConfirmar} />
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo="Tus reportes" descripcion={otrasMias.length > 0 ? `${otrasMias.length} ${otrasMias.length === 1 ? 'reporte' : 'reportes'}` : undefined} />
          <TablaDeAverias
            averias={otrasMias}
            vacio={{
              titulo: 'Todavía no has reportado nada',
              descripcion: 'Si una máquina falla o hace algo raro, toca «Reportar avería». Toma un minuto.',
            }}
          />
        </Tarjeta>
        {delArea.length > 0 && (
          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera titulo="En tu área" ayuda="Lo que se reportó de los equipos de tu área, o del área que tienes a cargo, para que estés al tanto." />
            <TablaDeAverias averias={delArea} vacio={{ titulo: 'Nada reportado en tu área', descripcion: '' }} />
          </Tarjeta>
        )}
        {deRiesgo.length > 0 && (
          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera
              titulo="Con riesgo para las personas"
              ayuda="Las averías que alguien marcó como un riesgo para las personas: te llegan para que SSOMA tome sus medidas. Las atiende Mantenimiento."
            />
            <TablaDeAverias averias={deRiesgo} conAutor vacio={{ titulo: 'Nada con riesgo', descripcion: '' }} />
          </Tarjeta>
        )}
      </div>
      {alTope && <Tope />}
    </>
  )
}

/**
 * El padrón todavía vacío: no hay equipo que elegir. A quien lo carga se le dice
 * dónde; a los demás, a quién avisar mientras tanto. A Mantenimiento no se le
 * pide que se avise a sí mismo.
 */
function PadronVacio({ carga }: { carga: boolean }) {
  return (
    <Tarjeta className="mb-5">
      <TarjetaCuerpo data-padron-vacio>
        {carga ? (
          <SinDatos
            compacto
            titulo="Todavía no hay equipos en el padrón"
            descripcion="Para reportar una avería, la gente elige el equipo de la lista, y la lista sale del padrón. Cárgalo en Equipos."
            accion={
              <Link href="/equipos" className="text-sm font-medium text-acento hover:underline">
                Ir a Equipos
              </Link>
            }
          />
        ) : (
          <SinDatos
            compacto
            titulo="Todavía no hay equipos en el padrón"
            descripcion="Para reportar una avería se elige el equipo de la lista, y Mantenimiento todavía no la cargó. Mientras tanto, avísale a Mantenimiento por teléfono o en persona."
          />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Tope() {
  return <p className="mt-3 text-xs text-texto-suave">De los que quedaron bien y los anulados se muestran los {MAXIMO_AVERIAS} más recientes; los que esperan a alguien salen todos.</p>
}

function TablaDeAverias({
  averias,
  conAutor = false,
  vacio,
}: {
  averias: Averia[]
  /** La columna de quién reportó: para Mantenimiento y Gerencia. */
  conAutor?: boolean
  vacio: { titulo: string; descripcion: string }
}) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Reporte</TH>
          <TH className="hidden md:table-cell">Equipo</TH>
          {conAutor && <TH className="hidden lg:table-cell">Reportó</TH>}
          <TH className="hidden sm:table-cell">Cuándo</TH>
          <TH className="hidden sm:table-cell">Cómo va</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {averias.length === 0 ? (
          <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
        ) : (
          averias.map((a) => <FilaAveria key={a.id} averia={a} conAutor={conAutor} />)
        )}
      </tbody>
    </Tabla>
  )
}

/** Lo urgente de un reporte, en insignias: si detiene el trabajo y si es un riesgo. */
function Urgencia({ averia: a }: { averia: Averia }) {
  return (
    <>
      {a.detiene_trabajo && <Insignia tono="peligro">Detiene el trabajo</Insignia>}
      {a.riesgo_personas && <Insignia tono="peligro">Riesgo para las personas</Insignia>}
    </>
  )
}

function FilaAveria({ averia: a, conAutor }: { averia: Averia; conAutor: boolean }) {
  const tipo = TIPO_AVERIA[a.tipo]
  const anulada = a.estado === 'ANULADA'
  const equipo = `${a.equipo_codigo} · ${a.equipo_descripcion}`
  const donde = [a.area, a.equipo_ubicacion].filter(Boolean).join(' · ')
  return (
    <TR data-averia={a.numero} data-anulada={anulada || undefined}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* En el teléfono, un blanco de 44 px de alto: el número es el único camino a la ficha. */}
          <Link href={`/averias/${a.id}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
            {a.numero}
          </Link>
          {tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : a.tipo}
          {/* En rojo solo mientras espera a Mantenimiento: cerrada, el equipo ya no está parado por ella. */}
          {a.espera_de === 'MANTENIMIENTO' && <Urgencia averia={a} />}
        </div>
        <p className="mt-1 text-sm font-medium text-texto md:hidden">{equipo}</p>
        <p className="mt-1 line-clamp-2 max-w-xl text-sm text-texto">{a.descripcion}</p>
        {(a.fotos > 0 || a.rq_enlazados > 0) && (
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-texto-suave">
            {a.fotos > 0 && (
              <span className="inline-flex items-center gap-1">
                <Camera aria-hidden className="size-3.5" />
                {a.fotos} {a.fotos === 1 ? 'foto' : 'fotos'}
              </span>
            )}
            {a.rq_enlazados > 0 && (
              <span className="inline-flex items-center gap-1">
                <Link2 aria-hidden className="size-3.5" />
                {a.rq_enlazados} RQ de repuestos
              </span>
            )}
          </p>
        )}
        {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
        {donde && <p className="mt-1 text-xs text-texto-suave md:hidden">{donde}</p>}
        {conAutor && (
          <p className="mt-1 text-xs text-texto-suave lg:hidden">
            Reportó {[a.reporto, a.reporto_puesto].filter(Boolean).join(' · ')}
          </p>
        )}
        <div className="mt-1 space-y-1 sm:hidden">
          <p className="tabular text-xs text-texto-suave">{fechaHora(a.creado_en)}</p>
          <Situacion averia={a} />
        </div>
      </TD>
      <TD className="hidden align-top md:table-cell">
        <p className="text-sm text-texto">{equipo}</p>
        {donde && <p className="max-w-[16rem] text-xs text-texto-suave">{donde}</p>}
      </TD>
      {conAutor && (
        <TD className="hidden align-top lg:table-cell">
          <p className="text-sm text-texto">{a.reporto || '—'}</p>
          {a.reporto_puesto && <p className="text-xs text-texto-suave">{a.reporto_puesto}</p>}
        </TD>
      )}
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs whitespace-nowrap text-texto">{fechaHora(a.creado_en)}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <Situacion averia={a} />
      </TD>
    </TR>
  )
}

/** En qué va el reporte, quién lo tiene y desde cuándo. */
function Situacion({ averia: a }: { averia: Averia }) {
  const estado = ESTADO_AVERIA[a.estado]
  const deQuienReporto = a.espera_de === 'QUIEN_REPORTO'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : a.estado}
      <DiasEnEspera
        dias={a.dias_en_espera}
        desde={a.espera_desde}
        quien={deQuienReporto ? 'quien la reportó' : 'Mantenimiento'}
      />
      {a.veces_reabierta > 0 && a.estado === 'EN_ATENCION' && <Insignia tono="aviso">No quedó bien</Insignia>}
    </div>
  )
}

/** Las averías que reportó quien mira, cerradas por Mantenimiento, esperando que diga si quedaron bien. */
function PorConfirmar({ averias, className }: { averias: Averia[]; className?: string }) {
  if (averias.length === 0) return null
  return (
    <Tarjeta className={`overflow-hidden ${className ?? ''}`} data-por-confirmar>
      <TarjetaCabecera
        titulo="¿Quedaron bien?"
        descripcion={`Mantenimiento cerró ${averias.length === 1 ? 'una avería que reportaste' : `${averias.length} averías que reportaste`}: ábrela, prueba el equipo y dinos si quedó bien.`}
      />
      <TablaDeAverias averias={averias} vacio={{ titulo: '', descripcion: '' }} />
    </Tarjeta>
  )
}
