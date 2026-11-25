import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import type { OpcionBuscable } from '@/components/ui/seleccion-buscable'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  actividadesConAvance,
  codigoConTiempos,
  etapasConTiempos,
  personasParaAsignar,
  responsablesDeEtapas,
  type ActividadConAvance,
  type EtapaConTiempos,
  type ResponsableDeEtapa,
} from '@/lib/datos/tiempos-entrega'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { RUTA_TIEMPOS, SEMAFORO_DE_CODIGO, comoTermino, plazoEnPalabras } from '@/lib/dominio/tiempos-entrega'
import { fecha, hoyLima } from '@/lib/format'
import { editaComoRrhh, exigirPermiso } from '@/lib/sesion'

import { AsignarResponsable } from '../asignar-responsable'

export const metadata = { title: 'Tiempos de entrega del código' }

/**
 * Los tiempos de un código interno, para Recursos Humanos: la entrega al
 * cliente, cada etapa contra su fecha comprometida y lo que cada área reporta.
 * Solo lectura: las fechas las pone Diseño y las marca el supervisor del área.
 */
export default async function PaginaTiemposDelCodigo({ searchParams }: PageProps<'/rrhh/tiempos-de-entrega/codigo'>) {
  const perfil = await exigirPermiso('rrhh.tiempos_entrega')
  // Asigna solo Recursos Humanos; Gerencia consulta (migración 20261125310000).
  const asigna = editaComoRrhh(perfil, 'rrhh.tiempos_entrega_asignar')
  const params = await searchParams
  if (typeof params.codigo !== 'string' || !params.codigo.trim()) notFound()
  const codigo = normalizarCodigo(params.codigo)

  const [resumen, etapas, actividades, responsables, personas] = await Promise.all([
    codigoConTiempos(codigo),
    etapasConTiempos(codigo),
    actividadesConAvance(codigo),
    responsablesDeEtapas(codigo),
    asigna ? personasParaAsignar() : Promise.resolve([]),
  ])
  const opciones = personas.map((p) => ({ valor: p.id, etiqueta: p.nombre, detalle: p.detalle }))
  // Ni está por entregar ni tiene etapas ni reportes: ese código no es de aquí.
  if (!resumen && etapas.length === 0 && actividades.length === 0) notFound()

  const hoy = hoyLima()
  const arriba = etapas.filter((e) => !e.padre_id)
  const terminadas = arriba.filter((e) => e.fin_real).length
  // Como el tablero: la etapa cuenta una vez, con lo peor de ella y de sus subetapas.
  const conLoSuyo = arriba.map((e) => [e, ...etapas.filter((s) => s.padre_id === e.id)].map((x) => x.semaforo))
  const vencidas = conLoSuyo.filter((s) => s.includes('ROJO')).length
  const porVencer = conLoSuyo.filter((s) => s.includes('AMBAR') && !s.includes('ROJO')).length
  const semaforoEntrega = resumen?.semaforo_entrega ?? 'SIN_FECHA'

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="font-mono break-all">{codigo}</span>}
        descripcion={
          resumen
            ? [resumen.ot_numero ? `OT ${resumen.ot_numero}${resumen.ots_abiertas > 1 ? ` y ${resumen.ots_abiertas - 1} OT más` : ''}` : 'Sin OT abierta', resumen.cliente, resumen.unidad].filter(Boolean).join(' · ')
            : 'Ya no está entre los códigos por entregar'
        }
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Tiempos de entrega', ruta: RUTA_TIEMPOS }, { titulo: codigo }]}
        acciones={resumen && <Insignia tono={SEMAFORO_DE_CODIGO[resumen.semaforo].tono}>{SEMAFORO_DE_CODIGO[resumen.semaforo].etiqueta}</Insignia>}
      />

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador
            titulo="Entrega al cliente"
            valor={resumen?.fecha_entrega ? fecha(resumen.fecha_entrega) : 'Sin fecha'}
            tono={semaforoEntrega === 'ROJO' ? 'peligro' : semaforoEntrega === 'AMBAR' ? 'aviso' : 'neutro'}
            pie={
              resumen?.fecha_entrega
                ? plazoEnPalabras(semaforoEntrega, resumen.dias_habiles_entrega, { fechaPlan: resumen.fecha_entrega, hoy })
                : 'La pone Administración al cargar la OT'
            }
          />
          <Indicador
            titulo="Etapas"
            valor={arriba.length > 0 ? `${terminadas} de ${arriba.length}` : '0'}
            pie={arriba.length > 0 ? 'Terminadas' : 'Diseño todavía no las cargó'}
          />
          <Indicador titulo="Vencidas" valor={String(vencidas)} tono={vencidas > 0 ? 'peligro' : 'neutro'} pie="Ellas o una subetapa pasaron su fecha" />
          <Indicador titulo="Por vencer" valor={String(porVencer)} tono={porVencer > 0 ? 'aviso' : 'neutro'} pie="Hoy o en 3 días hábiles" />
        </div>

        <Tarjeta>
          <TarjetaCabecera
            titulo="Etapas de la unidad"
            ayuda="Las arma Diseño con su fecha comprometida; el supervisor de cada área marca cuándo empezó y terminó la suya, y el avance sale de su reporte diario. Debajo de cada etapa van las subetapas que agregó su área. Recursos Humanos pone a la persona que lleva cada una."
          />
          <TarjetaCuerpo>
            {etapas.length === 0 ? (
              <SinDatos
                enTabla={false}
                titulo="Este código todavía no tiene etapas"
                descripcion="Diseño las arma en «Control de etapas» con su fecha comprometida. Hasta entonces el semáforo sale solo de la fecha de entrega al cliente."
              />
            ) : (
              <ListaDeEtapas etapas={etapas} hoy={hoy} responsables={responsables} opciones={asigna ? opciones : null} />
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera
            titulo="Actividades reportadas"
            descripcion={
              actividades.length > 0
                ? `${actividades.filter((a) => a.avance >= 100).length} de ${actividades.length} terminadas`
                : undefined
            }
            ayuda="Lo que cada área reportó para este código en su reporte diario, con su último avance. Primero lo que falta terminar."
          />
          <TablaDeActividades actividades={actividades} />
        </Tarjeta>
      </div>
    </>
  )
}

type PropsDeLista = {
  hoy: string
  responsables: Map<string, ResponsableDeEtapa>
  /** El personal para elegir; vacío si quien mira no asigna. */
  opciones: OpcionBuscable[] | null
}

function ListaDeEtapas({ etapas, ...props }: { etapas: EtapaConTiempos[] } & PropsDeLista) {
  const ids = new Set(etapas.map((e) => e.id))
  const arriba = etapas.filter((e) => !e.padre_id || !ids.has(e.padre_id))
  return (
    <ol className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
      {arriba.map((etapa, i) => {
        const subetapas = etapas.filter((s) => s.padre_id === etapa.id)
        return (
          <li key={etapa.id}>
            <FilaDeEtapa e={etapa} numero={`${i + 1}.`} {...props} />
            {subetapas.length > 0 && (
              <ol aria-label={`Subetapas de ${etapa.nombre}`} className="ml-6 border-l-2 border-borde pb-1">
                {subetapas.map((s, j) => (
                  <li key={s.id} className="border-t border-borde first:border-t-0">
                    <FilaDeEtapa e={s} numero={`${i + 1}.${j + 1}`} {...props} sub />
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function FilaDeEtapa({ e, numero, hoy, responsables, opciones, sub = false }: { e: EtapaConTiempos; numero: string; sub?: boolean } & PropsDeLista) {
  const responsable = responsables.get(e.id) ?? null
  // Una sola insignia por etapa: cómo terminó, o cómo va contra su fecha.
  const estado = e.fin_real
    ? comoTermino(e.fin_plan, e.fin_real)
    : { etiqueta: plazoEnPalabras(e.semaforo, e.dias_habiles, { fechaPlan: e.fin_plan, hoy }), tono: SEMAFORO_DE_CODIGO[e.semaforo].tono }
  return (
    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between" data-etapa={e.nombre} data-semaforo={e.semaforo}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular text-xs text-texto-suave">{numero}</span>
          <p className={sub ? 'text-sm text-texto' : 'font-medium text-texto'}>{e.nombre}</p>
          {!sub && <span className="text-xs text-texto-suave">{e.area ?? 'Sin área del taller'}</span>}
          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
          {!e.fin_real && <span className="text-xs text-texto-suave">{e.inicio_real ? 'En proceso' : 'Por empezar'}</span>}
        </div>
        <p className="text-xs text-texto-suave">
          Plan: {e.inicio_plan ? fecha(e.inicio_plan) : 'sin inicio'} → {e.fin_plan ? fecha(e.fin_plan) : 'sin fin'}
          {(e.inicio_real || e.fin_real) && (
            <span className="text-texto">
              {' '}
              · Real: {e.inicio_real ? fecha(e.inicio_real) : '—'} → {e.fin_real ? fecha(e.fin_real) : 'en curso'}
            </span>
          )}
        </p>
        {!e.fin_real && e.avance_reportado !== null && (
          <div className="flex max-w-sm items-center gap-2">
            <Progreso valor={e.avance_reportado} mostrarValor alto="sm" etiqueta={`Avance de ${e.nombre}`} className="flex-1" />
            {e.ultimo_reporte && <span className="shrink-0 text-xs text-texto-suave">al {fecha(e.ultimo_reporte)}</span>}
          </div>
        )}
        {e.nota && <p className="text-xs text-texto-suave">Nota: {e.nota}</p>}
        {(responsable || !e.fin_real) && (
          <p className="text-xs" data-responsable={responsable?.nombre ?? ''}>
            {responsable ? (
              <>
                <span className="text-texto-suave">La lleva: </span>
                <span className="font-medium text-texto">{responsable.nombre}</span>
                {responsable.area && <span className="text-texto-suave"> ({responsable.area})</span>}
              </>
            ) : (
              <span className="text-texto-suave">Nadie a cargo todavía</span>
            )}
          </p>
        )}
      </div>
      {opciones && !e.fin_real && (
        <div className="flex flex-wrap items-center gap-1">
          <AsignarResponsable
            etapa={{ id: e.id, nombre: e.nombre }}
            actual={responsable ? { trabajador_id: responsable.trabajador_id, nombre: responsable.nombre } : null}
            personas={opciones}
          />
        </div>
      )}
    </div>
  )
}

function TablaDeActividades({ actividades }: { actividades: ActividadConAvance[] }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Actividad</TH>
          <TH className="hidden sm:table-cell">Área</TH>
          <TH className="w-40">Avance</TH>
          <TH className="hidden sm:table-cell">Último reporte</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {actividades.length === 0 ? (
          <SinDatos
            titulo="Ningún área reportó trabajo para este código"
            descripcion="Las actividades aparecen con el primer reporte diario que el supervisor sube para el código."
          />
        ) : (
          actividades.map((a) => (
            <TR key={a.clave}>
              <TD>
                <p className="text-texto">{a.descripcion}</p>
                <p className="text-xs text-texto-suave sm:hidden">
                  {[a.area ?? 'Sin área', a.ultima_fecha ? `al ${fecha(a.ultima_fecha)}` : null].filter(Boolean).join(' · ')}
                </p>
              </TD>
              <TD className="hidden sm:table-cell">{a.area ?? 'Sin área'}</TD>
              <TD>
                <Progreso valor={a.avance} mostrarValor alto="sm" etiqueta={`Avance de ${a.descripcion}`} />
              </TD>
              <TD className="hidden whitespace-nowrap sm:table-cell">
                {a.ultima_fecha ? fecha(a.ultima_fecha) : '—'}
                <span className="text-xs text-texto-suave"> · {a.reportes} {a.reportes === 1 ? 'reporte' : 'reportes'}</span>
              </TD>
            </TR>
          ))
        )}
      </tbody>
    </Tabla>
  )
}
