import { AlertTriangle, Clock, Repeat, Wrench } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { averiasDelEquipo, type Averia } from '@/lib/datos/averias'
import { cargarEquipo, historiaDeEquipo } from '@/lib/datos/equipos'
import { ESTADO_AVERIA, horas, horasParadoSugeridas, notaDelParo, TIPO_AVERIA, tiempoParado } from '@/lib/dominio/averias'
import { ESTADO_EQUIPO, type EstadoEquipo } from '@/lib/dominio/equipos'
import { fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Historia del equipo' }

const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * La historia de un equipo (Plan 16.4): cómo está hoy, cuántas veces falló,
 * cuánto estuvo parado, cuántas averías repitieron y cada reporte. Las cifras
 * las cuenta la base con todos los reportes; la lista trae los que quien mira
 * ya podía ver (Mantenimiento y Gerencia, todos; Almacén, los suyos y los de su área).
 */
export default async function PaginaEquipo({ params }: PageProps<'/equipos/[id]'>) {
  // Los mismos permisos que el padrón y la política `ver_equipos`.
  const perfil = await exigirPermiso(['equipos.ver', 'equipos.gestionar', 'equipos.asignar'])
  const { id } = await params
  if (!FORMA_DE_ID.test(id)) notFound()
  const [equipo, historia, averias] = await Promise.all([cargarEquipo(id), historiaDeEquipo(id), averiasDelEquipo(id)])
  if (!equipo) notFound()

  const estado = ESTADO_EQUIPO[equipo.estado as EstadoEquipo]
  const donde = [equipo.area?.nombre, equipo.ubicacion].filter(Boolean).join(' · ')
  const series = [equipo.serie_maquina && `Serie ${equipo.serie_maquina}`, equipo.serie_cabezal && `Cabezal ${equipo.serie_cabezal}`]
    .filter(Boolean)
    .join(' · ')
  const h = historia ?? {
    averias: 0,
    averias90: 0,
    repetidas: 0,
    repetidas90: 0,
    noQuedoBien: 0,
    horasParado: 0,
    horasParado90: 0,
    abiertas: 0,
    paradoPor: null,
    paradoDesde: null,
    ultimaEn: null,
  }
  // Las anuladas se ven en la lista (son un dato), al final, pero no cuentan como averías.
  const vigentes = averias.filter((a) => a.estado !== 'ANULADA')
  const anuladas = averias.filter((a) => a.estado === 'ANULADA')
  const vistas = vigentes.length
  const paradoPorVisible = h.paradoPor ? averias.find((a) => a.numero === h.paradoPor) : undefined
  const llevaParado = h.paradoDesde ? horasParadoSugeridas(h.paradoDesde) : null

  return (
    <>
      <EncabezadoPagina
        titulo={
          <>
            <span className="tabular">{equipo.codigo}</span>
            <span className="font-normal text-texto-suave"> · </span>
            {equipo.descripcion}
          </>
        }
        descripcion={[equipo.categoria?.nombre, donde].filter(Boolean).join(' · ') || undefined}
        migas={[{ titulo: 'Equipos', ruta: '/equipos' }, { titulo: equipo.codigo }]}
        ayuda="La historia del equipo sale de los reportes de avería y de lo que Mantenimiento anotó al atenderlos. Las cifras cuentan todos los reportes, sin los anulados; una avería es repetida si se reportó antes de 30 días desde que se cerró otra del mismo equipo."
        acciones={
          equipo.activo ? (
            <EnlaceBoton href={`/averias?equipo=${equipo.id}`} variante="secundario">
              <AlertTriangle aria-hidden className="size-4" />
              Reportar avería
            </EnlaceBoton>
          ) : undefined
        }
      />

      <div className="space-y-5">
        <Tarjeta>
          <TarjetaCuerpo className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm" data-equipo-hoy>
            <Dato titulo="Hoy">
              {!equipo.activo ? (
                <Insignia tono="neutro">Dado de baja</Insignia>
              ) : estado ? (
                <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
              ) : (
                equipo.estado
              )}
              {equipo.activo && equipo.estado !== 'OPERATIVO' && (
                <span className="mt-1 block max-w-md text-xs text-texto">
                  {/* Si lo paró un reporte, la nota repite su número: va al lado, en «Lo tiene parado». */}
                  {!h.paradoPor && notaDelParo(equipo.estado_nota, puede(perfil, 'averias.atender') || puede(perfil, 'averias.ver'))}
                  <span className="block text-texto-suave">Desde el {fecha(equipo.estado_desde)}</span>
                </span>
              )}
              {!equipo.activo && (
                <span className="mt-1 block max-w-md text-xs text-texto">
                  {equipo.baja_motivo}
                  <span className="block text-texto-suave">Desde el {fecha(equipo.dado_de_baja_en)}</span>
                </span>
              )}
            </Dato>
            {h.paradoPor && (
              <Dato titulo="Lo tiene parado">
                {paradoPorVisible ? (
                  <Link href={`/averias/${paradoPorVisible.id}`} className="tabular text-acento hover:underline">
                    {h.paradoPor}
                  </Link>
                ) : (
                  <span className="tabular">{h.paradoPor}</span>
                )}
                {llevaParado != null && <span className="block text-xs text-texto-suave">Lleva {tiempoParado(llevaParado)} parado</span>}
              </Dato>
            )}
            {equipo.a_cargo_de && <Dato titulo="A cargo de">{equipo.a_cargo_de}</Dato>}
            {(equipo.marca || series) && <Dato titulo="Marca y serie">{[equipo.marca, series].filter(Boolean).join(' · ')}</Dato>}
            {h.ultimaEn && <Dato titulo="Última avería">{fecha(h.ultimaEn)}</Dato>}
          </TarjetaCuerpo>
        </Tarjeta>

        <section aria-label="Cifras del equipo" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-historia-cifras>
          <Indicador
            titulo="Averías"
            icono={Wrench}
            valor={h.averias}
            tono={h.averias90 > 0 ? 'aviso' : 'neutro'}
            pie={`${h.averias90} en los últimos 90 días`}
          />
          <Indicador
            titulo="Tiempo parado"
            icono={Clock}
            valor={horas(h.horasParado)}
            tono={h.horasParado90 > 0 ? 'aviso' : 'neutro'}
            pie={`${horas(h.horasParado90)} en los últimos 90 días`}
          />
          <Indicador
            titulo="Repetidas"
            icono={Repeat}
            valor={h.repetidas}
            tono={h.repetidas > 0 ? 'peligro' : 'neutro'}
            pie="Antes de 30 días del cierre de otra"
          />
          <Indicador
            titulo="No quedó bien"
            icono={AlertTriangle}
            valor={h.noQuedoBien}
            tono={h.noQuedoBien > 0 ? 'peligro' : 'neutro'}
            pie={h.noQuedoBien === 1 ? 'Vez que volvió a Mantenimiento' : 'Veces que volvió a Mantenimiento'}
          />
        </section>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Sus averías"
            descripcion={
              averias.length === 0
                ? undefined
                : [
                    vistas < h.averias
                      ? `Ves ${vistas} de las ${h.averias} averías: las demás son de otras áreas`
                      : `${vistas} ${vistas === 1 ? 'avería' : 'averías'}, de la más reciente a la más antigua`,
                    anuladas.length > 0 ? `y ${anuladas.length} ${anuladas.length === 1 ? 'reporte anulado' : 'reportes anulados'}, al final` : null,
                  ]
                    .filter(Boolean)
                    .join(' ')
            }
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Reporte</TH>
                <TH className="hidden sm:table-cell">Cuándo</TH>
                <TH className="hidden md:table-cell">Qué hizo Mantenimiento</TH>
                <TH className="hidden sm:table-cell">Cómo quedó</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {averias.length === 0 ? (
                <SinDatos
                  titulo={h.averias > 0 ? 'Sus reportes son de otras áreas' : 'Sin averías reportadas'}
                  descripcion={
                    h.averias > 0
                      ? 'Las cifras de arriba los cuentan; cada reporte lo ven Mantenimiento, Gerencia y el área que lo hizo.'
                      : 'Cuando alguien reporte una avería de este equipo, aparece aquí con lo que hizo Mantenimiento.'
                  }
                />
              ) : (
                [...vigentes, ...anuladas].map((a) => <FilaDeLaHistoria key={a.id} averia={a} />)
              )}
            </tbody>
          </Tabla>
        </Tarjeta>
      </div>
    </>
  )
}

function FilaDeLaHistoria({ averia: a }: { averia: Averia }) {
  const tipo = TIPO_AVERIA[a.tipo]
  const estado = ESTADO_AVERIA[a.estado]
  const anulada = a.estado === 'ANULADA'
  const hecho = a.trabajo_hecho ?? a.diagnostico
  // Las horas parado van en la columna de Mantenimiento; en el teléfono y la tableta, debajo del reporte.
  const parado =
    a.horas_parado != null ? (
      <p className="mt-1 text-xs text-texto-suave">
        Parado: <span className="tabular">{horas(a.horas_parado)}</span>
      </p>
    ) : null
  const comoQuedo = (
    <div className="flex flex-wrap items-center gap-1.5">
      {estado ? <Insignia tono={anulada ? 'neutro' : estado.tono}>{estado.etiqueta}</Insignia> : a.estado}
      {a.veces_reabierta > 0 && (
        <Insignia tono="aviso">
          No quedó bien{a.veces_reabierta > 1 ? ` ${a.veces_reabierta} veces` : ''}
        </Insignia>
      )}
    </div>
  )
  return (
    <TR data-averia={a.numero} data-anulada={anulada || undefined}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/averias/${a.id}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
            {a.numero}
          </Link>
          {tipo ? <Insignia tono={anulada ? 'neutro' : tipo.tono}>{tipo.etiqueta}</Insignia> : a.tipo}
          {a.repite_a && !anulada && <Insignia tono="aviso">Repite la {a.repite_a}</Insignia>}
        </div>
        <p className="mt-1 line-clamp-2 max-w-xl text-sm text-texto">{a.descripcion}</p>
        {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
        <div className="mt-1 space-y-1 sm:hidden">
          <p className="tabular text-xs text-texto-suave">{fechaHora(a.creado_en)}</p>
          {hecho && <p className="line-clamp-2 text-xs text-texto-suave md:hidden">{hecho}</p>}
          {parado}
          {comoQuedo}
        </div>
        {hecho && <p className="mt-1 line-clamp-2 hidden text-xs text-texto-suave sm:block md:hidden">{hecho}</p>}
        <div className="hidden sm:block md:hidden">{parado}</div>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs whitespace-nowrap text-texto">{fechaHora(a.creado_en)}</p>
      </TD>
      <TD className="hidden align-top md:table-cell">
        {hecho ? <p className="line-clamp-3 max-w-md text-sm text-texto">{hecho}</p> : <p className="text-sm text-texto-suave">Todavía nada</p>}
        {parado}
      </TD>
      <TD className="hidden align-top sm:table-cell">{comoQuedo}</TD>
    </TR>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-texto-suave">{titulo}</p>
      <div className="text-texto">{children}</div>
    </div>
  )
}
