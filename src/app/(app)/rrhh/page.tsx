import { AlertTriangle } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TIPO_PLANILLA, definir } from '@/lib/dominio/estados'
import { detallePlanilla } from '@/lib/dominio/planilla-excel'
import { moneda, periodo, porcentaje } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { AgregarPersona, CerrarPlanilla, Distribuir, NuevaPlanilla, RepartirPartesIguales } from './formularios'
import { ImportarPlanilla } from './importar'

export const metadata = { title: 'Planillas' }

/** Lo que el servicio entrega por consulta, como mucho. */
const POR_PAGINA = 1000

/**
 * Lee todas las filas de una consulta `.in()`: de a 150 identificadores, para
 * no alargar la URL, y cada tanda de a 1000 filas hasta que no quede nada.
 */
async function enTandas<T>(
  ids: string[],
  leer: (tanda: string[], desde: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const filas: T[] = []
  for (let i = 0; i < ids.length; i += 150) {
    for (let desde = 0; ; desde += POR_PAGINA) {
      const { data, error } = await leer(ids.slice(i, i + 150), desde)
      if (error) throw new Error(`No se pudieron cargar las planillas: ${error.message}`)
      filas.push(...(data ?? []))
      if ((data ?? []).length < POR_PAGINA) break
    }
  }
  return filas
}

export default async function PaginaRRHH() {
  const perfil = await exigirPermiso('rrhh.ver_planillas')
  const gestiona = puede(perfil, 'rrhh.gestionar_planillas')
  const db = await createClient()
  const [planillas, ordenes] = await Promise.all([
    db.from('planillas').select('id,tipo,periodo,moneda,estado').order('periodo', { ascending: false }).limit(50),
    db.from('ordenes_trabajo').select('id,numero,unidad_id').neq('estado', 'ANULADA').order('creado_en', { ascending: false }).limit(200),
  ])
  for (const r of [planillas, ordenes]) if (r.error) throw new Error(`No se pudieron cargar las planillas: ${r.error.message}`)
  // Las personas y los repartos de ESTAS planillas, enteros. Antes se pedían los
  // de todas las planillas de la historia, del más viejo al más nuevo y con el
  // tope de 1000 filas del servicio: pasados unos meses las planillas nuevas
  // salían con 0 personas y S/ 0.00, y el «asignado %» de cada una, falso.
  const personas = { data: await enTandas((planillas.data ?? []).map((p) => p.id), (tanda, desde) =>
    db.from('planilla_personas').select('id,planilla_id,nombre,documento,monto,detalle,origen_hoja,fila_origen')
      .in('planilla_id', tanda).order('creado_en').order('id').range(desde, desde + POR_PAGINA - 1)) }
  const distribuciones = { data: await enTandas((personas.data ?? []).map((p) => p.id), (tanda, desde) =>
    db.from('planilla_distribuciones').select('id,persona_id,orden_id,porcentaje')
      .in('persona_id', tanda).order('id').range(desde, desde + POR_PAGINA - 1)) }
  const ids = (ordenes.data ?? []).map((o) => o.unidad_id).filter((id): id is string => Boolean(id))
  const unidades = ids.length
    ? await db.from('unidades').select('id,codigo_interno,placa,numero_fmi').in('id', ids)
    : { data: [], error: null }
  if (unidades.error) throw new Error(`No se pudieron cargar unidades: ${unidades.error.message}`)
  const mapa = new Map((unidades.data ?? []).map((u) => [u.id, u.codigo_interno || u.placa || u.numero_fmi || 'Unidad sin código']))
  const opciones = (ordenes.data ?? []).map((o) => ({ id: o.id, numero: o.numero, unidad: mapa.get(o.unidad_id ?? '') ?? 'Sin unidad' }))
  const numeroOt = new Map(opciones.map((o) => [o.id, o.numero]))
  const sinPlanillas = (planillas.data ?? []).length === 0

  return (
    <>
      <EncabezadoPagina
        titulo="Planillas"
        ayuda="Tres planillas por mes: taller, administrativa y subcontratos. Se importan del Excel de la planilla y el costo de cada persona se reparte al 100 % entre las OT antes de cerrar."
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Planillas' }]}
      />

      {/* Abierta mientras no haya ninguna: es lo único que se puede hacer. */}
      {gestiona && (
        <SeccionDesplegable titulo="Crear planilla del mes" abierta={sinPlanillas} className="mb-5">
          <NuevaPlanilla />
        </SeccionDesplegable>
      )}

      <div className="space-y-5">
        {sinPlanillas && (
          <Tarjeta>
            <TarjetaCuerpo>
              <SinDatos
                enTabla={false}
                titulo="Todavía no hay planillas"
                descripcion={
                  gestiona
                    ? 'Crea la del mes en «Crear planilla del mes» y después importa su Excel.'
                    : 'Las crea Recursos Humanos cada mes; aparecen aquí en cuanto se crean.'
                }
              />
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        {(planillas.data ?? []).map((p) => {
          const divisa = p.moneda === 'USD' ? 'USD' : 'PEN'
          const deEsta = (personas.data ?? [])
            .filter((x) => x.planilla_id === p.id)
            .map((x) => {
              const partes = (distribuciones.data ?? []).filter((d) => d.persona_id === x.id)
              const detalle = detallePlanilla.safeParse(x.detalle)
              return {
                ...x,
                monto: Number(x.monto),
                partes,
                asignado: partes.reduce((n, d) => n + Number(d.porcentaje), 0),
                detalle: detalle.success ? detalle.data : null,
              }
            })
          const total = deEsta.reduce((n, x) => n + x.monto, 0)
          const pendientes = deEsta.filter((x) => Math.abs(x.asignado - 100) > 0.001).length
          const porEmpresa = new Map<string, { n: number; monto: number }>()
          for (const x of deEsta) {
            const e = x.detalle ? (x.detalle.empresa ?? 'Sin empresa') : 'Registro manual'
            const v = porEmpresa.get(e) ?? { n: 0, monto: 0 }
            porEmpresa.set(e, { n: v.n + 1, monto: v.monto + x.monto })
          }
          const abierta = p.estado === 'BORRADOR'

          return (
            <Tarjeta key={p.id}>
              <TarjetaCabecera
                titulo={`${definir(TIPO_PLANILLA, p.tipo).etiqueta} · ${periodo(p.periodo)}`}
                descripcion={`${abierta ? 'En preparación' : 'Cerrada'} · ${deEsta.length} ${deEsta.length === 1 ? 'persona' : 'personas'} · costo ${moneda(total, divisa)}${abierta && pendientes ? ` · ${pendientes} sin repartir al 100 %` : ''}`}
                acciones={gestiona && abierta && p.moneda === 'PEN' ? <ImportarPlanilla planillaId={p.id} /> : undefined}
              />
              <TarjetaCuerpo className="space-y-4">
                {porEmpresa.size > 0 && (
                  <ul className="flex flex-wrap gap-2 text-xs" aria-label="Costo por empresa">
                    {[...porEmpresa].map(([empresa, v]) => (
                      <li key={empresa} className="rounded-[var(--radius-base)] bg-superficie-2 px-2.5 py-1.5 text-texto">
                        <span className="font-medium">{empresa}</span> · {v.n} · <span className="tabular">{moneda(v.monto, divisa)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {abierta && deEsta.length === 0 && (
                  <p className="text-sm text-texto-suave">
                    {!gestiona
                      ? 'Sin personas todavía: Recursos Humanos la está preparando.'
                      : p.moneda === 'PEN'
                        ? 'Sin personas todavía. Importa el Excel de la planilla con el botón de la cabecera o agrega a alguien a mano.'
                        : 'Sin personas todavía. Agrégalas a mano con «Agregar persona o subcontrato a mano».'}
                  </p>
                )}

                {/* Cada persona es una fila que se abre: pliegue chico, no sección. */}
                {deEsta.map((x) => {
                  const avisos = x.detalle?.avisos ?? []
                  return (
                    <details key={x.id} className="group rounded-lg border border-borde">
                      <summary className="cursor-pointer px-4 py-3 text-texto">
                        <span className="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-start justify-between gap-2 align-top">
                          <span className="min-w-0">
                            <strong className="block text-sm">{x.nombre}</strong>
                            <span className="text-xs text-texto-suave">
                              {x.detalle
                                ? `${x.detalle.puesto || 'Sin puesto'}${x.detalle.empresa ? ` · ${x.detalle.empresa}` : ''}`
                                : 'Registro manual'}{' '}
                              · Repartido {porcentaje(x.asignado, 2)}
                            </span>
                            {avisos.length > 0 && (
                              <Insignia tono="aviso" className="ml-2">
                                <AlertTriangle aria-hidden className="size-3" />
                                {avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`}
                              </Insignia>
                            )}
                          </span>
                          <strong className="tabular text-sm">{moneda(x.monto, divisa)}</strong>
                        </span>
                      </summary>
                      <div className="space-y-4 border-t border-borde p-4">
                        {avisos.length > 0 && (
                          <ul className="space-y-1 text-sm text-aviso">
                            {avisos.map((a, i) => (
                              <li key={i} className="flex items-start gap-1.5">
                                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                                {a}
                              </li>
                            ))}
                          </ul>
                        )}
                        {x.detalle && (
                          <>
                            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                              {(
                                [
                                  ['Remuneración bruta', x.detalle.ingresos],
                                  ['Descuentos', x.detalle.descuentos],
                                  ['Neto a pagar', x.detalle.neto],
                                  ['EsSalud (empresa)', x.detalle.aporte_empleador],
                                ] as const
                              ).map(([etiqueta, valor]) => (
                                <div key={etiqueta}>
                                  <dt className="text-xs text-texto-suave">{etiqueta}</dt>
                                  <dd className="mt-1 tabular font-semibold text-texto">{moneda(valor, divisa)}</dd>
                                </div>
                              ))}
                            </dl>
                            <p className="text-xs text-texto-suave">
                              {x.detalle.dias} días · {x.detalle.horas} horas · {x.detalle.horas_extras} horas extra
                              {x.origen_hoja && (
                                <>
                                  {' '}
                                  · {x.origen_hoja}, fila {x.fila_origen}
                                </>
                              )}
                            </p>
                            <details>
                              <summary className="cursor-pointer text-sm text-acento">Ver conceptos del Excel</summary>
                              <dl className="mt-2 divide-y divide-borde">
                                {x.detalle.conceptos.map((c, i) => (
                                  <div key={i} className="flex justify-between gap-4 py-2 text-sm">
                                    <dt className="text-texto-suave">
                                      {c.nombre} · {c.tipo === 'INGRESO' ? 'Ingreso' : 'Descuento'}
                                    </dt>
                                    <dd className="tabular text-texto">{moneda(c.importe, divisa)}</dd>
                                  </div>
                                ))}
                              </dl>
                            </details>
                          </>
                        )}
                        <p className="text-xs text-texto-suave">
                          Reparto:{' '}
                          {x.partes.length
                            ? x.partes.map((d) => `OT ${numeroOt.get(d.orden_id) ?? '—'}: ${porcentaje(d.porcentaje, 2)}`).join(' · ')
                            : 'Pendiente de repartir entre las OT.'}
                        </p>
                        {gestiona && abierta && <Distribuir personaId={x.id} ordenes={opciones} />}
                      </div>
                    </details>
                  )
                })}

                {/* Pliegues de un formulario dentro de la tarjeta de la planilla: se
                    quedan como `<details>` sueltos. La prueba de los buscadores
                    (herramientas/banco/probar-buscadores.mjs) abre el reparto por
                    su texto y su `summary`. */}
                {gestiona && abierta && (
                  <>
                    {deEsta.length > 0 && (
                      <details className="rounded-[var(--radius-base)] border border-borde p-3">
                        <summary className="cursor-pointer text-sm font-medium text-acento">
                          Repartir en partes iguales entre varias OT
                        </summary>
                        <div className="pt-3">
                          <RepartirPartesIguales
                            planillaId={p.id}
                            ordenes={opciones}
                            personas={deEsta.map((x) => ({ id: x.id, nombre: x.nombre, asignado: x.asignado }))}
                          />
                        </div>
                      </details>
                    )}
                    <details>
                      <summary className="cursor-pointer py-2 text-sm text-acento">Agregar persona o subcontrato a mano</summary>
                      <AgregarPersona planillaId={p.id} tipo={p.tipo} />
                    </details>
                    <CerrarPlanilla id={p.id} />
                  </>
                )}
              </TarjetaCuerpo>
            </Tarjeta>
          )
        })}
      </div>
    </>
  )
}
