import { notFound } from 'next/navigation'
import { Download, Pencil } from 'lucide-react'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { BASE_BOTON, TAMANOS, VARIANTES } from '@/components/ui/boton'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { obtenerEvaluacionDiseno } from '@/lib/datos/evaluaciones-diseno'
import { ESTADO_EVALUACION_DISENO, definir } from '@/lib/dominio/estados'
import { ESCALA_DISENO, criteriosPorGrupo, puntajeDiseno } from '@/lib/dominio/evaluacion-diseno'
import { fecha, fechaHora, mesLargo } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'
import { AccionesEvaluacion } from './acciones-evaluacion'

export const metadata = { title: 'Evaluación de desempeño · Diseño e Ingeniería' }

const GRUPOS = criteriosPorGrupo()

export default async function PaginaEvaluacion({ params }: PageProps<'/diseno/evaluaciones/[id]'>) {
  const perfil = await exigirPermiso(['diseno.evaluar', 'administracion.recibir_evaluacion'])
  const { id } = await params
  // Sin acceso, el RLS no la devuelve: para quien no la puede ver, no existe.
  const e = await obtenerEvaluacionDiseno(id)
  if (!e) notFound()

  const estado = definir(ESTADO_EVALUACION_DISENO, e.estado)
  const esSuya = e.evaluador_id === perfil.id && puede(perfil, 'diseno.evaluar')
  const corregible = esSuya && (e.estado === 'BORRADOR' || e.estado === 'OBSERVADA')
  const total = puntajeDiseno(e.respuestas)

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Evaluación de desempeño', ruta: '/diseno/evaluaciones' }, { titulo: e.evaluado_nombre }]}
        titulo={e.evaluado_nombre}
        descripcion={`${e.puesto} · ${e.area_servicio} · evaluado el ${fecha(e.fecha_evaluacion)}`}
        acciones={<>
          {corregible && (
            <EnlaceBoton href={`/diseno/evaluaciones/${e.id}/editar`} variante="secundario">
              <Pencil aria-hidden className="size-4" /> Corregir
            </EnlaceBoton>
          )}
          <a href={`/diseno/evaluaciones/${e.id}/pdf`} download className={cn(BASE_BOTON, VARIANTES.secundario, TAMANOS.md)}>
            <Download aria-hidden className="size-4" /> Descargar PDF
          </a>
        </>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <Tarjeta className="min-w-0">
          <TarjetaCabecera
            titulo="Formato de evaluación del desempeño laboral"
            descripcion="Veinte comportamientos de 1 (muy bajo) a 5 (muy alto). El puntaje total es sobre 100 %."
          />
          <TarjetaCuerpo className="space-y-5">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Dato titulo="Área / servicio" valor={e.area_servicio} />
              <Dato titulo="Evaluado" valor={e.evaluado_nombre} />
              <Dato titulo="Puesto" valor={e.puesto} />
              <Dato titulo="Fecha de ingreso" valor={e.fecha_ingreso ? mesLargo(e.fecha_ingreso) : '—'} />
              <Dato titulo="Evaluador" valor={[e.evaluador_nombre, e.evaluador_cargo].filter(Boolean).join(' · ') || '—'} />
              <Dato titulo="Fecha de evaluación" valor={fecha(e.fecha_evaluacion)} />
            </dl>

            {/* Cabe entera en un teléfono de 360 px: las cinco columnas de la
                escala se angostan y el nombre del nivel se ve desde tableta. */}
            <div className="tabla-con-corte overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Puntaje de cada comportamiento</caption>
                <thead className="border-b border-borde bg-superficie-2 text-[11px] font-semibold tracking-wide text-texto-suave uppercase">
                  <tr>
                    <th scope="col" className="px-2 py-2 text-left sm:px-3">Área del desempeño</th>
                    {ESCALA_DISENO.map((n) => (
                      <th key={n.valor} scope="col" className="w-7 px-0.5 py-2 text-center sm:w-12 sm:px-1" title={n.nivel}>
                        <span className="tabular block text-xs text-texto">{n.valor}</span>
                        <span className="hidden text-[9px] leading-tight font-medium normal-case sm:block">{n.nivel}</span>
                      </th>
                    ))}
                    <th scope="col" className="w-12 px-2 py-2 text-right sm:w-16 sm:px-3">Puntaje</th>
                  </tr>
                </thead>
                {GRUPOS.map((g) => (
                  <tbody key={g.grupo} className="border-b border-borde">
                    <tr>
                      <th scope="colgroup" colSpan={7} className="bg-superficie-2/60 px-2 pt-3 pb-1 text-left text-[11px] font-semibold tracking-wide text-acento uppercase sm:px-3">
                        {g.grupo}
                      </th>
                    </tr>
                    {g.criterios.map(({ indice, nombre }) => {
                      const valor = e.respuestas[indice]
                      return (
                        <tr key={indice} className="border-t border-borde/60">
                          <th scope="row" className="px-2 py-2 text-left font-normal text-texto sm:px-3">
                            <span className="tabular mr-1 text-texto-tenue">{indice + 1}.</span>{nombre}
                          </th>
                          {ESCALA_DISENO.map((n) => (
                            <td key={n.valor} className="px-0.5 py-2 text-center sm:px-1">
                              {valor === n.valor
                                ? <span aria-label={`Marcado ${n.valor}, ${n.nivel.toLowerCase()}`} className="inline-flex size-6 items-center justify-center rounded-full bg-acento text-xs font-bold text-acento-texto">X</span>
                                : <span aria-hidden className="text-texto-tenue">·</span>}
                            </td>
                          ))}
                          <td className="tabular px-2 py-2 text-right font-medium sm:px-3">{valor}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                ))}
                <tfoot>
                  <tr className="border-t-2 border-borde-fuerte">
                    <th scope="row" colSpan={6} className="px-2 py-2 text-right font-semibold text-texto sm:px-3">Puntaje total</th>
                    <td className="tabular px-2 py-2 text-right text-base font-semibold whitespace-nowrap text-texto sm:px-3">{total} %</td>
                  </tr>
                  <tr>
                    <th scope="row" colSpan={6} className="px-2 pb-2 text-right font-normal text-texto-suave sm:px-3">Rendimiento deseado</th>
                    <td className="tabular px-2 pb-2 text-right whitespace-nowrap text-texto-suave sm:px-3">100 %</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div>
              <h3 className="text-xs font-medium text-texto-suave">Comentarios</h3>
              <p className="mt-1 text-sm whitespace-pre-wrap text-texto">{e.comentarios || 'Sin comentarios.'}</p>
            </div>
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera titulo="Estado" acciones={<Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>} />
          <TarjetaCuerpo className="space-y-4">
            {e.estado === 'OBSERVADA' && e.observacion && (
              <div role="note" className="rounded-[var(--radius-base)] border border-aviso/40 bg-aviso-suave p-3 text-sm">
                <p className="font-medium text-aviso">Administración la devolvió para corregir</p>
                <p className="mt-1 whitespace-pre-wrap text-texto">{e.observacion}</p>
              </div>
            )}
            <ol className="space-y-2 text-sm">
              <Paso hecho texto={`Hecha por ${e.evaluador_nombre ?? 'Diseño e Ingeniería'}`} cuando={e.creado_en} />
              <Paso hecho={Boolean(e.enviada_en)} texto="Enviada a Administración" cuando={e.enviada_en} />
              {e.observada_en && e.estado !== 'OBSERVADA' && (
                <Paso hecho texto={`Se devolvió una vez para corregir: «${e.observacion ?? ''}»`} cuando={e.observada_en} />
              )}
              <Paso hecho={Boolean(e.recibida_en)} texto="Recibida por Administración" cuando={e.recibida_en} />
            </ol>
            <AccionesEvaluacion
              id={e.id}
              puedeEnviar={corregible}
              puedeBorrar={esSuya && e.estado === 'BORRADOR' && !e.enviada_en}
              puedeRecibir={puede(perfil, 'administracion.recibir_evaluacion') && e.estado === 'ENVIADA'}
              reenvio={e.estado === 'OBSERVADA'}
            />
          </TarjetaCuerpo>
        </Tarjeta>
      </div>
    </>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-texto-suave">{titulo}</dt>
      <dd className="font-medium break-words text-texto">{valor}</dd>
    </div>
  )
}

function Paso({ hecho, texto, cuando }: { hecho: boolean; texto: string; cuando: string | null }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', hecho ? 'bg-exito' : 'bg-borde')} />
      <span className={cn('min-w-0', !hecho && 'text-texto-tenue')}>
        {texto}
        {cuando && <span className="block text-xs text-texto-suave">{fechaHora(cuando)}</span>}
      </span>
    </li>
  )
}
