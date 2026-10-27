import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { horasEsperandoCosto } from '@/lib/datos/reportes-diarios'
import { codigosParaElegir } from '@/lib/datos/codigos-para-elegir'
import { listarTrabajadores, recargoExtrasDelMes, tareosDelMes, type RecargoExtras, type Tareo } from '@/lib/datos/rrhh'
import { HORAS_DEL_MES, fechaValida, horasCortas, mesDeLima, mesValido, mesVecino } from '@/lib/dominio/rrhh'
import { fecha, fechaLarga, hoyLima, mesLargo, moneda, parteDe, porcentaje, porcentajeCorto } from '@/lib/format'
import { editaComoRrhh, exigirPermiso } from '@/lib/sesion'

import { AnularTareo, CargarHoras } from './formulario'

export const metadata = { title: 'Costeo por código interno' }

type PorPersona = { nombre: string; cargo: string | null; horas: number; costo: number; labores: Set<string> }
type PorCodigo = { codigo: string; horas: number; costo: number; personas: Map<string, PorPersona> }

/** Suma lo vigente del mes por código interno y, dentro, por persona. */
function agrupar(tareos: Tareo[]): PorCodigo[] {
  const codigos = new Map<string, PorCodigo>()
  for (const t of tareos) {
    if (t.anulado_en) continue
    const c = codigos.get(t.codigo_interno) ?? { codigo: t.codigo_interno, horas: 0, costo: 0, personas: new Map() }
    c.horas += t.horas
    c.costo += t.costo
    const nombre = t.trabajador ? `${t.trabajador.apellidos}, ${t.trabajador.nombres}` : 'Persona sin ficha'
    const p = c.personas.get(t.trabajador_id) ?? { nombre, cargo: t.trabajador?.cargo ?? null, horas: 0, costo: 0, labores: new Set() }
    p.horas += t.horas
    p.costo += t.costo
    if (t.labor) p.labores.add(t.labor)
    c.personas.set(t.trabajador_id, p)
    codigos.set(t.codigo_interno, c)
  }
  return [...codigos.values()].sort((a, b) => b.costo - a.costo || a.codigo.localeCompare(b.codigo))
}

/** El recargo del mes por código, con cada planilla que lo pagó. */
function recargoPorCodigo(recargo: RecargoExtras[]) {
  const codigos = new Map<string, { codigo: string; horas: number; monto: number; lineas: RecargoExtras[] }>()
  for (const r of recargo) {
    const c = codigos.get(r.codigo) ?? { codigo: r.codigo, horas: 0, monto: 0, lineas: [] }
    c.horas += r.horas
    c.monto += r.monto
    c.lineas.push(r)
    codigos.set(r.codigo, c)
  }
  return [...codigos.values()].sort((a, b) => b.monto - a.monto || a.codigo.localeCompare(b.codigo))
}

export default async function PaginaCosteo({ searchParams }: PageProps<'/rrhh/costeo'>) {
  const perfil = await exigirPermiso('rrhh.personal')
  // Carga y anula solo RR. HH.; el administrador lo ve (migración 20261020167000).
  const edita = editaComoRrhh(perfil, 'rrhh.personal')
  const params = await searchParams
  const hoy = hoyLima()
  const mesActual = mesDeLima(hoy)
  const mes = mesValido(params.mes) ? params.mes : mesActual

  const [tareos, personal, codigos, esperando, recargo] = await Promise.all([
    tareosDelMes(mes),
    listarTrabajadores('activos'),
    // La lista es para cargar horas: quien solo mira no la necesita.
    edita ? codigosParaElegir() : Promise.resolve(null),
    horasEsperandoCosto(),
    // Lo que la planilla diaria pagó de más por las horas extras (migración 20261026200000).
    recargoExtrasDelMes(mes),
  ])
  const grupos = agrupar(tareos)
  const recargos = recargoPorCodigo(recargo)
  const totalRecargo = recargos.reduce((n, r) => n + r.monto, 0)
  // El recargo de cada código, para sumarlo a su mano de obra (la ayuda decía «se suma aparte» y nadie lo sumaba).
  const recargoDe = new Map(recargos.map((r) => [r.codigo, r.monto]))
  const manoDeObraDe = new Map(grupos.map((g) => [g.codigo, g.costo]))
  // El detalle va por día, como llega el parte: por defecto, el último día con horas cargadas.
  const dias = [...new Set(tareos.map((t) => t.fecha))].sort()
  const dia = fechaValida(params.dia) && dias.includes(params.dia) ? params.dia : dias.at(-1)
  const delDia = tareos.filter((t) => t.fecha === dia)
  const horasDelDia = delDia.filter((t) => !t.anulado_en).reduce((n, t) => n + t.horas, 0)
  const cargasDelDia = delDia.filter((t) => !t.anulado_en).length
  const horas = grupos.reduce((n, g) => n + g.horas, 0)
  const costo = grupos.reduce((n, g) => n + g.costo, 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Costeo por código interno"
        ayuda={`Las horas que cada persona trabajó en cada unidad y lo que cuestan. Las del reporte diario de los supervisores entran solas; las demás las carga Recursos Humanos. La hora vale el costo mensual de la persona entre ${HORAS_DEL_MES}.`}
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Costeo por código interno' }]}
        acciones={
          edita && (
          <CargarHoras
            hoy={hoy}
            codigos={codigos}
            personal={personal.map((p) => ({
              id: p.id,
              nombre: `${p.nombres} ${p.apellidos}`,
              cargo: p.cargo,
              costo_mensual: p.costo_mensual,
            }))}
          />
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link
            href={`/rrhh/costeo?mes=${mesVecino(mes, -1)}`}
            aria-label="Mes anterior"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <p className="px-1 text-sm font-medium text-texto first-letter:uppercase">{mesLargo(`${mes}-01`)}</p>
          {mes < mesActual && (
            <Link
              href={`/rrhh/costeo?mes=${mesVecino(mes, 1)}`}
              aria-label="Mes siguiente"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
        <p className="text-xs text-texto-suave">
          <span className="tabular">{horasCortas(horas)}</span> · <span className="tabular">{moneda(costo)}</span> en{' '}
          <span className="tabular">{grupos.length}</span> {grupos.length === 1 ? 'código' : 'códigos'}
          {totalRecargo > 0 && (
            <>
              {' '}
              · con el recargo de las extras <span className="tabular whitespace-nowrap">{moneda(costo + totalRecargo)}</span>
            </>
          )}
        </p>
      </div>

      <div className="space-y-5">
        {esperando.length > 0 && (
          <Tarjeta className="border-aviso">
            <TarjetaCabecera
              titulo="Horas de los reportes que esperan su costo"
              descripcion="Tienen horas en reportes diarios pero todavía no tienen costo mensual."
              ayuda="Con su costo mensual en Personal, sus horas entran solas al costeo."
            />
            <TarjetaCuerpo>
              <ul className="space-y-1 text-sm">
                {esperando.map((e) => (
                  <li key={e.trabajador_id} className="flex flex-wrap justify-between gap-2">
                    <span className="text-texto">{e.nombre}</span>
                    <span className="text-xs text-texto-suave">
                      <span className="tabular">{horasCortas(e.horas)}</span> en {e.lineas} {e.lineas === 1 ? 'carga' : 'cargas'} desde el{' '}
                      {fecha(e.desde)}
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/rrhh/personal" className="mt-2 inline-block text-sm font-medium text-acento hover:underline">
                Ir a Personal
              </Link>
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        <Tarjeta>
          <TarjetaCabecera
            titulo="Mano de obra por código interno"
            ayuda="Toca un código para ver quién trabajó en él, cuántas horas y en qué."
          />
          <TarjetaCuerpo className="space-y-2">
            {grupos.length === 0 ? (
              <p className="text-sm text-texto-suave">Todavía no hay horas cargadas este mes. Carga las primeras con «Cargar horas».</p>
            ) : (
              grupos.map((g) => (
                <details key={g.codigo} className="rounded-lg border border-borde" data-codigo={g.codigo}>
                  <summary className="cursor-pointer px-4 py-3 text-texto">
                    <span className="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-center justify-between gap-2 align-middle">
                      <span className="min-w-0">
                        <strong className="block font-mono text-sm">{g.codigo}</strong>
                        <span className="text-xs text-texto-suave">
                          {g.personas.size} {g.personas.size === 1 ? 'persona' : 'personas'} · <span className="tabular">{horasCortas(g.horas)}</span>
                        </span>
                      </span>
                      <span className="text-right">
                        <strong className="tabular block text-sm">{moneda(g.costo)}</strong>
                        {/* «del costo del mes»: Gastos del mes reparte por horas y da otro %; aquí es por costo. */}
                        <span className="tabular block text-xs text-texto-suave">{porcentaje(costo > 0 ? (g.costo / costo) * 100 : 0)} del costo del mes</span>
                        {(recargoDe.get(g.codigo) ?? 0) > 0 && (
                          <span className="tabular block text-xs whitespace-nowrap text-texto-suave">
                            con recargo {moneda(g.costo + (recargoDe.get(g.codigo) ?? 0))}
                          </span>
                        )}
                      </span>
                    </span>
                  </summary>
                  <div className="border-t border-borde">
                    <Tabla>
                      <TablaCabecera>
                        <tr>
                          <TH>Persona</TH>
                          <TH className="text-right">Horas</TH>
                          <TH className="text-right">Costo</TH>
                        </tr>
                      </TablaCabecera>
                      <tbody>
                        {[...g.personas.values()]
                          .sort((a, b) => b.costo - a.costo)
                          .map((p) => (
                            <TR key={p.nombre}>
                              <TD>
                                <p className="font-medium text-texto">{p.nombre}</p>
                                <p className="text-xs text-texto-suave">
                                  {p.cargo ?? 'Sin cargo'}
                                  {p.labores.size > 0 && ` · ${[...p.labores].join(', ')}`}
                                </p>
                              </TD>
                              <TD className="tabular text-right">{horasCortas(p.horas)}</TD>
                              <TD className="tabular text-right">{moneda(p.costo)}</TD>
                            </TR>
                          ))}
                      </tbody>
                    </Tabla>
                  </div>
                </details>
              ))
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta data-recargo-extras>
          <TarjetaCabecera
            titulo="Recargo de las horas extras"
            descripcion={recargos.length > 0 ? `${moneda(totalRecargo)} en ${recargos.length} ${recargos.length === 1 ? 'código' : 'códigos'}` : undefined}
            ayuda="Lo que la planilla diaria pagó de más por cada hora extra (el recargo de la regla sobre la hora de la persona), repartido entre los códigos que esa persona trabajó ese día por sus horas validadas. Las horas de arriba van a su costo; el recargo se suma aparte a la mano de obra de cada código. Las extras que se reservan no llevan recargo hasta que se pagan."
          />
          <TarjetaCuerpo className="space-y-2">
            {recargos.length === 0 ? (
              <p className="text-sm text-texto-suave">Ninguna planilla diaria pagó horas extras este mes.</p>
            ) : (
              recargos.map((r) => (
                <details key={r.codigo} className="rounded-lg border border-borde" data-recargo={r.codigo}>
                  <summary className="cursor-pointer px-4 py-3 text-texto">
                    <span className="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-center justify-between gap-2 align-middle">
                      <span className="min-w-0">
                        <strong className="block font-mono text-sm">{r.codigo}</strong>
                        <span className="text-xs text-texto-suave">
                          <span className="tabular">{horasCortas(r.horas)}</span> extras en {r.lineas.length}{' '}
                          {r.lineas.length === 1 ? 'día' : 'días'}
                        </span>
                      </span>
                      <span className="text-right">
                        <strong className="tabular block text-sm">{moneda(r.monto)}</strong>
                        {parteDe(r.monto, manoDeObraDe.get(r.codigo) ?? 0) !== null && (
                          <span className="tabular block text-xs whitespace-nowrap text-texto-suave">
                            {porcentajeCorto(parteDe(r.monto, manoDeObraDe.get(r.codigo) ?? 0))} de su mano de obra
                          </span>
                        )}
                      </span>
                    </span>
                  </summary>
                  <ul className="divide-y divide-borde border-t border-borde text-sm">
                    {r.lineas.map((l) => (
                      <li key={`${l.fecha}-${l.documento}`} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                        <span className="text-texto">
                          <span className="tabular">{fecha(l.fecha)}</span> ·{' '}
                          {l.planilla_id ? (
                            <Link href={`/planilla-diaria/${l.planilla_id}`} className="font-mono text-acento hover:underline">
                              {l.documento}
                            </Link>
                          ) : (
                            <span className="font-mono">{l.documento}</span>
                          )}
                          <span className="text-xs text-texto-suave">
                            {' '}
                            · {l.personas} {l.personas === 1 ? 'persona' : 'personas'} · <span className="tabular">{horasCortas(l.horas)}</span>
                          </span>
                        </span>
                        <span className="tabular text-texto">{moneda(l.monto)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="overflow-hidden" id="dia">
          <TarjetaCabecera
            titulo={dia ? `Horas cargadas el ${fechaLarga(dia)}` : 'Horas cargadas'}
            ayuda="Cada carga con su costo. Una mal cargada se anula con su motivo: queda tachada y deja de sumar."
            descripcion={
              dia
                ? `${horasCortas(horasDelDia)} en ${cargasDelDia} ${cargasDelDia === 1 ? 'carga' : 'cargas'}`
                : undefined
            }
          />
          {dias.length > 1 && (
            <nav aria-label="Días con horas cargadas" className="flex flex-wrap gap-1.5 px-4 pb-3">
              {dias.map((d) => (
                <Link
                  key={d}
                  href={`/rrhh/costeo?mes=${mes}&dia=${d}#dia`}
                  aria-current={d === dia ? 'page' : undefined}
                  className={`tabular inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-2 text-xs font-medium sm:min-h-8 sm:min-w-8 ${
                    d === dia ? 'border-acento bg-acento-suave text-texto' : 'border-borde text-texto-suave hover:text-texto'
                  }`}
                >
                  {Number(d.slice(8, 10))}
                </Link>
              ))}
            </nav>
          )}
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona</TH>
                <TH className="hidden md:table-cell">Código interno</TH>
                <TH className="text-right">Horas</TH>
                <TH className="text-right">Costo</TH>
                <TH className="text-right">
                  <span className="sr-only">Acciones</span>
                </TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {delDia.length === 0 ? (
                <SinDatos titulo="Sin horas este mes" descripcion="Carga las horas del parte con el botón de arriba." />
              ) : (
                delDia.map((t) => {
                  const nombre = t.trabajador ? `${t.trabajador.nombres} ${t.trabajador.apellidos}` : 'Persona sin ficha'
                  const anulado = t.anulado_en !== null
                  return (
                    <TR key={t.id} className={anulado ? 'opacity-60' : undefined}>
                      <TD className="align-top">
                        <p className={`font-medium text-texto ${anulado ? 'line-through' : ''}`}>{nombre}</p>
                        <p className="font-mono text-xs text-texto-suave md:hidden">{t.codigo_interno}</p>
                        {t.labor && <p className="text-xs text-texto-suave">{t.labor}</p>}
                        {t.reporte && (
                          <Link href={`/reportes-diarios/${t.reporte.id}`} className="text-xs text-acento hover:underline">
                            Del reporte diario{t.reporte.area ? ` de ${t.reporte.area}` : ''}: {t.reporte.asunto}
                          </Link>
                        )}
                        {anulado && <p className="text-xs text-texto-suave">Anulado: {t.motivo_anulacion}</p>}
                      </TD>
                      <TD className="hidden align-top font-mono text-xs md:table-cell">{t.codigo_interno}</TD>
                      <TD className={`tabular text-right align-top ${anulado ? 'line-through' : ''}`}>{horasCortas(t.horas)}</TD>
                      <TD className={`tabular text-right align-top ${anulado ? 'line-through' : ''}`}>
                        {moneda(t.costo)}
                        <p className="text-xs whitespace-nowrap text-texto-suave">{moneda(t.costo_hora)} la hora</p>
                      </TD>
                      <TD className="text-right align-top">
                        {edita && !anulado && (
                          <AnularTareo id={t.id} descripcion={`${horasCortas(t.horas)} de ${nombre} en ${t.codigo_interno} el ${fecha(t.fecha)}`} />
                        )}
                      </TD>
                    </TR>
                  )
                })
              )}
            </tbody>
          </Tabla>
        </Tarjeta>
      </div>
    </>
  )
}
