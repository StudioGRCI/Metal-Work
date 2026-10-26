import { AlertTriangle, ChevronDown } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { planillaAjusteDesde, planillaAlCosto, restadoDelMes, type PersonaAlCosto } from '@/lib/datos/rrhh'
import { TIPO_PLANILLA, definir } from '@/lib/dominio/estados'
import { detallePlanilla } from '@/lib/dominio/planilla-excel'
import { DESCUENTOS_DESDE, horasCortas } from '@/lib/dominio/rrhh'
import { hoyLima, moneda, periodo } from '@/lib/format'
import { editaComoRrhh, exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { CrearPlanilla } from './crear-planilla'
import { AgregarPersona, CerrarPlanilla, QuitarPersona } from './formularios'
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
  const gestiona = editaComoRrhh(perfil, 'rrhh.gestionar_planillas')
  const db = await createClient()
  const planillas = await db.from('planillas').select('id,tipo,periodo,moneda,estado').order('periodo', { ascending: false }).limit(50)
  if (planillas.error) throw new Error(`No se pudieron cargar las planillas: ${planillas.error.message}`)
  // Las personas de ESTAS planillas, enteras. Antes se pedían las de todas las
  // planillas de la historia, del más viejo al más nuevo y con el tope de 1000
  // filas del servicio: pasados unos meses las planillas nuevas salían con 0
  // personas y S/ 0.00.
  const esteMes = `${hoyLima().slice(0, 7)}-01`
  // Lo que el sistema ya restó en cada mes de las de taller en preparación, para
  // compararlo con los descuentos del Excel: no se vuelve a restar.
  const veRestado = puede(perfil, ['rrhh.personal', 'planilla_diaria.preparar'])
  const mesesAbiertos = [
    ...new Set((planillas.data ?? []).filter((p) => p.tipo === 'TALLER' && p.estado === 'BORRADOR').map((p) => p.periodo.slice(0, 7))),
  ]
  const [personas, alCosto, restados, ajusteDesde] = await Promise.all([
    enTandas((planillas.data ?? []).map((p) => p.id), (tanda, desde) =>
      db.from('planilla_personas').select('id,planilla_id,nombre,documento,monto,detalle,origen_hoja,fila_origen')
        .in('planilla_id', tanda).order('creado_en').order('id').range(desde, desde + POR_PAGINA - 1)),
    // Cómo entra al costo cada persona de las de taller (migración 20261026210000): por sus horas y el ajuste al cerrar.
    Promise.all((planillas.data ?? []).filter((p) => p.tipo === 'TALLER' && p.moneda === 'PEN').map((p) => planillaAlCosto(p.id))),
    veRestado ? Promise.all(mesesAbiertos.map(async (m) => [m, await restadoDelMes(m)] as const)) : Promise.resolve([]),
    // Desde qué mes la de taller ajusta (noviembre de 2026): la de antes queda como registro.
    planillaAjusteDesde(),
  ])
  const restadoDe = new Map(restados)
  const comoEntra = new Map<string, PersonaAlCosto>(alCosto.flatMap((m) => [...m]))
  const sinPlanillas = (planillas.data ?? []).length === 0

  return (
    <>
      <EncabezadoPagina
        titulo="Planillas"
        ayuda="Tres planillas por mes: taller, administrativa y subcontratos. Se importan del Excel de la planilla. La de taller completa la mano de obra de cada código: por las horas de los reportes ya entró el costo mensual de cada persona entre 240 (y el recargo de sus horas extras), y al cerrar, la diferencia con su costo real del Excel se reparte entre los códigos que trabajó, por esas mismas horas. Quien no tiene ficha en Personal o no cargó horas reparte su costo por las horas de todos. El ajuste va desde noviembre de 2026: la de taller de octubre y las de antes quedan como registro. El costeo de una unidad se cierra cuando está cerrada la planilla de taller de cada mes en que trabajó, desde noviembre. La administrativa y la de subcontratos quedan como registro: la oficina entra por Pagos de la oficina y los subcontratos por Subcontratos."
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Planillas' }]}
      />

      {gestiona && <CrearPlanilla sinPlanillas={sinPlanillas} />}

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
          const deEsta = personas
            .filter((x) => x.planilla_id === p.id)
            .map((x) => {
              const detalle = detallePlanilla.safeParse(x.detalle)
              return { ...x, monto: Number(x.monto), costo: comoEntra.get(x.id) ?? null, detalle: detalle.success ? detalle.data : null }
            })
          const total = deEsta.reduce((n, x) => n + x.monto, 0)
          const deTaller = p.tipo === 'TALLER' && p.moneda === 'PEN'
          // La de taller de antes de noviembre de 2026 queda como registro: no ajusta nada (DKS, 2026-10-26).
          const soloRegistro = deTaller && p.periodo < ajusteDesde
          // Lo que de verdad llega a los códigos, no el ajuste teórico: un mes sin horas no tiene adónde.
          const ajuste = deEsta.reduce((n, x) => n + (x.costo?.entra ?? 0), 0)
          const sinFicha = deEsta.filter((x) => x.costo?.como === 'SIN_FICHA').length
          // Quien tiene ajuste y no lo lleva a ningún código: el mes sin horas. La de antes de noviembre no lleva ajuste.
          const sinDestino = deEsta.filter((x) => x.costo && x.costo.como !== 'ANTES' && x.costo.ajuste !== 0 && x.costo.entra === 0).length
          const restadoDelMes = restadoDe.get(p.periodo.slice(0, 7))
          const porEmpresa = new Map<string, { n: number; monto: number }>()
          for (const x of deEsta) {
            const e = x.detalle ? (x.detalle.empresa ?? 'Sin empresa') : 'Registro manual'
            const v = porEmpresa.get(e) ?? { n: 0, monto: 0 }
            porEmpresa.set(e, { n: v.n + 1, monto: v.monto + x.monto })
          }
          const abierta = p.estado === 'BORRADOR'
          const mesTerminado = p.periodo < esteMes
          // La planilla de taller de un mes que ya pasó, sin cerrar: es la que cuenta el globo de Planillas.
          const esperaCierre = deTaller && !soloRegistro && abierta && mesTerminado

          return (
            <Tarjeta key={p.id}>
              <TarjetaCabecera
                titulo={`${definir(TIPO_PLANILLA, p.tipo).etiqueta} · ${periodo(p.periodo)}`}
                descripcion={`${abierta ? 'En preparación' : 'Cerrada'} · ${deEsta.length} ${deEsta.length === 1 ? 'persona' : 'personas'} · costo ${moneda(total, divisa)}${
                  deTaller && deEsta.length > 0
                    ? soloRegistro
                      ? ' · queda como registro'
                      : ` · ajuste ${moneda(ajuste)}${abierta ? ' al cerrar' : ' en los códigos'}`
                    : ''
                }${deTaller && sinFicha > 0 ? ` · ${sinFicha} sin ficha` : ''}`}
                acciones={
                  gestiona && abierta && p.moneda === 'PEN' ? (
                    <ImportarPlanilla planillaId={p.id} restaSola={p.periodo >= `${DESCUENTOS_DESDE}-01`} />
                  ) : undefined
                }
              />
              <TarjetaCuerpo className="space-y-4">
                {esperaCierre && (
                  <p className="text-xs text-texto-suave" data-espera-cierre>
                    <Insignia tono="aviso">Mes terminado, sin cerrar</Insignia>{' '}
                    {deEsta.length > 0
                      ? 'Mientras siga en preparación, su ajuste no entra a la mano de obra de los códigos.'
                      : 'Se cierra cuando tenga a su gente: su ajuste completa la mano de obra de los códigos del mes.'}
                  </p>
                )}
                {porEmpresa.size > 0 && (
                  <ul className="flex flex-wrap gap-2 text-xs" aria-label="Costo por empresa">
                    {[...porEmpresa].map(([empresa, v]) => (
                      <li key={empresa} className="rounded-[var(--radius-base)] bg-superficie-2 px-2.5 py-1.5 text-texto">
                        <span className="font-medium">{empresa}</span> · {v.n} · <span className="tabular">{moneda(v.monto, divisa)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {soloRegistro && deEsta.length > 0 && (
                  <p className="text-xs text-texto-suave" data-solo-registro>
                    Queda como registro: el ajuste de la planilla de taller empieza en noviembre de 2026, así que la diferencia con lo que entró
                    por horas no se reparte entre los códigos.
                  </p>
                )}

                {!deTaller && deEsta.length > 0 && (
                  <p className="text-xs text-texto-suave">
                    {p.tipo === 'ADMINISTRATIVA'
                      ? 'Queda como registro: el costo de la oficina entra por Pagos de la oficina.'
                      : p.tipo === 'SUBCONTRATOS'
                        ? 'Queda como registro: los subcontratos entran al costo por Subcontratos.'
                        : 'Queda como registro: solo la planilla de taller en soles ajusta la mano de obra de los códigos.'}
                  </p>
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
                      <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 px-4 py-3 text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento [&::-webkit-details-marker]:hidden">
                        <span className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
                          <span className="min-w-0">
                            <strong className="block text-sm">{x.nombre}</strong>
                            <span className="text-xs text-texto-suave">
                              {x.detalle
                                ? `${x.detalle.puesto || 'Sin puesto'}${x.detalle.empresa ? ` · ${x.detalle.empresa}` : ''}`
                                : 'Registro manual'}
                              {x.costo && <> · {resumenAlCosto(x.costo)}</>}
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
                        <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-180" />
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
                            <Pliegue titulo="Ver conceptos del Excel">
                              <dl className="divide-y divide-borde">
                                {x.detalle.conceptos.map((c, i) => (
                                  <div key={i} className="flex justify-between gap-4 py-2 text-sm">
                                    <dt className="text-texto-suave">
                                      {c.nombre} · {c.tipo === 'INGRESO' ? 'Ingreso' : 'Descuento'}
                                    </dt>
                                    <dd className="tabular text-texto">{moneda(c.importe, divisa)}</dd>
                                  </div>
                                ))}
                              </dl>
                            </Pliegue>
                          </>
                        )}
                        {x.costo && <p className="text-xs text-texto-suave" data-al-costo>{explicacionAlCosto(x.costo, abierta)}</p>}
                        {x.costo?.trabajador_id && restadoDelMes && <YaRestado restado={restadoDelMes.get(x.costo.trabajador_id)} mes={periodo(p.periodo)} />}
                        {gestiona && abierta && (
                          <div className="flex justify-end border-t border-borde pt-3">
                            <QuitarPersona personaId={x.id} nombre={x.nombre} />
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })}

                {/* Pliegues de un formulario dentro de la tarjeta de la planilla: el
                    pliegue chico, no la sección. */}
                {gestiona && abierta && (
                  <>
                    <Pliegue titulo="Agregar persona o subcontrato a mano" enCaja>
                      <AgregarPersona planillaId={p.id} tipo={p.tipo} />
                    </Pliegue>
                    <CerrarPlanilla
                      id={p.id}
                      titulo={`${definir(TIPO_PLANILLA, p.tipo).etiqueta.toLowerCase()} de ${periodo(p.periodo)}`}
                      deTaller={deTaller}
                      soloRegistro={soloRegistro}
                      entra={ajuste}
                      sinDestino={sinDestino}
                      mesTerminado={mesTerminado}
                    />
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

const SIN_HORAS_EN_EL_MES = 'ese mes no tiene horas en ningún código: su costo no llega a ninguna unidad'

/** «41 h en 2 códigos · ajuste S/ 590,00», en la fila de la persona. */
function resumenAlCosto(c: PersonaAlCosto) {
  switch (c.como) {
    case 'HORAS':
      return `${horasCortas(c.horas)} en ${c.codigos} ${c.codigos === 1 ? 'código' : 'códigos'} · ajuste ${moneda(c.ajuste)}`
    case 'SIN_COSTO':
      return `${horasCortas(c.horas)} en el reporte, sin costo mensual en su ficha · ajuste ${moneda(c.ajuste)}`
    case 'SIN_FICHA':
      return c.mes_con_horas ? 'sin ficha en Personal: su costo se reparte entre todos los códigos del mes' : `sin ficha en Personal: ${SIN_HORAS_EN_EL_MES}`
    case 'SIN_HORAS':
      return c.mes_con_horas ? 'sin horas en el mes: su costo se reparte entre todos los códigos del mes' : `sin horas: ${SIN_HORAS_EN_EL_MES}`
    case 'OFICINA':
      return 'de planilla administrativa: no entra por aquí'
    case 'ANTES':
      return 'de antes de noviembre de 2026: queda como registro'
  }
}

/** Lo mismo, con las cuentas, al abrir la fila. */
function explicacionAlCosto(c: PersonaAlCosto, abierta: boolean) {
  const cuando = abierta ? 'Al cerrar la planilla' : 'Con la planilla cerrada'
  const reparte = abierta ? 'se reparte' : 'se repartió'
  const recargo = c.recargo !== 0 ? `, y ${moneda(c.recargo)} del recargo de sus horas extras que pagó la planilla diaria` : ''
  const deTodos = c.mes_con_horas
    ? `${cuando}, su costo (${moneda(c.costo)}) ${reparte} entre los códigos del mes por las horas de todos.`
    : `Ese mes no tiene horas en ningún código: su costo (${moneda(c.costo)}) no llega a ninguna unidad.`
  switch (c.como) {
    case 'HORAS':
      return `Por sus ${horasCortas(c.horas)} de los reportes del mes ya entraron ${moneda(c.costo_horas)} a ${c.codigos === 1 ? 'su código' : `sus ${c.codigos} códigos`}${recargo}. ${cuando}, la diferencia con su costo real (${moneda(c.costo)}), ${moneda(c.ajuste)}, ${reparte} entre esos códigos por las mismas horas.`
    case 'SIN_COSTO':
      return `${c.trabajador ?? 'Esta persona'} tiene ${horasCortas(c.horas)} en los reportes del mes, pero su ficha no tiene costo mensual: esas horas todavía no suman${recargo}. ${cuando}, ${moneda(c.ajuste)} de su costo real (${moneda(c.costo)}) ${reparte} entre ${c.codigos === 1 ? 'su código' : `sus ${c.codigos} códigos`} por esas horas. Cuando su ficha tenga el costo mensual, sus horas entran por él y el ajuste se rehace solo.`
    case 'SIN_FICHA':
      return `No se encontró su ficha en Personal por su DNI ni por su nombre. ${deTodos} Si es de la empresa, puede que su nombre o su DNI no sean los de su ficha.`
    case 'SIN_HORAS':
      return `${c.trabajador ?? 'Esta persona'} no tiene horas en los reportes del mes. ${deTodos}`
    case 'OFICINA':
      return `${c.trabajador ?? 'Esta persona'} es de planilla administrativa en Personal: su costo entra por Pagos de la oficina, no por esta planilla.`
    case 'ANTES':
      return 'Es de antes de noviembre de 2026, cuando empezó el ajuste: la planilla queda como registro y la diferencia con su costo real no se reparte. A los códigos de ese mes solo les entró la mano de obra por las horas que tarearon los supervisores, si las hubo.'
  }
}

/** Lo que el sistema ya le restó en el mes: si el Excel también lo trae en sus descuentos, es el mismo. */
function YaRestado({ restado, mes }: { restado: { tardanzas: number; permisos: number } | undefined; mes: string }) {
  if (!restado || (restado.tardanzas === 0 && restado.permisos === 0)) return null
  const partes = [
    restado.tardanzas !== 0 && `tardanzas ${moneda(restado.tardanzas)}`,
    restado.permisos !== 0 && `permisos ${moneda(restado.permisos)}`,
  ].filter(Boolean)
  return (
    <p className="text-xs text-texto-suave" data-ya-restado>
      En {mes} el sistema ya le restó de su pago{' '}
      <span className="tabular whitespace-nowrap text-texto">{moneda(restado.tardanzas + restado.permisos)}</span> ({partes.join(', ')}). Si el Excel
      trae tardanzas o permisos en sus descuentos, es el mismo descuento.
    </p>
  )
}
