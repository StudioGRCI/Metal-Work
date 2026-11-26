import { CalendarClock, ChevronLeft, ChevronRight, Clock, MessageSquareWarning, Wallet } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { pagosDeLaPersona, tardanzasDeLaPersona, type PagoDeLaHoja, type TardanzaDeLaHoja } from '@/lib/datos/hoja-personal'
import { listarObservaciones, listarPermisos, resumenTardanzas, trabajadorPorId, type Observacion, type Permiso } from '@/lib/datos/rrhh'
import {
  HORAS_DEL_MES,
  MOTIVO_OBSERVACION,
  TIPO_CUENTA,
  TIPO_OBSERVACION,
  horaCorta,
  horasCortas,
  mesDeLima,
  mesValido,
  mesVecino,
  minutosLargos,
  porcentajeCorto,
} from '@/lib/dominio/rrhh'
import { fecha, hoyLima, mesLargo, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Hoja de la persona' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Las cuatro partes de la hoja. Cada una se pide solo si quien mira tiene el permiso de su pantalla. */
const PARTES = {
  tardanzas: { titulo: 'Tardanzas' },
  permisos: { titulo: 'Permisos' },
  observaciones: { titulo: 'Observaciones' },
  pagos: { titulo: 'Pagos' },
} as const
type Parte = keyof typeof PARTES

/** Un renglón de la línea de tiempo, ya con su parte y su día. */
type Suceso =
  | { parte: 'tardanzas'; fecha: string; orden: string; tardanza: TardanzaDeLaHoja }
  | { parte: 'permisos'; fecha: string; orden: string; permiso: Permiso }
  | { parte: 'observaciones'; fecha: string; orden: string; observacion: Observacion }
  | { parte: 'pagos'; fecha: string; orden: string; pago: PagoDeLaHoja }

export default async function PaginaHojaDeLaPersona({ params, searchParams }: PageProps<'/rrhh/personal/[id]'>) {
  const perfil = await exigirPermiso(['rrhh.personal', 'asistencia.ver'])
  const { id } = await params
  if (!GUID.test(id)) notFound()
  const busqueda = await searchParams
  const hoy = hoyLima()
  const mesActual = mesDeLima(hoy)
  const mes = mesValido(busqueda.mes) && busqueda.mes <= mesActual ? busqueda.mes : mesActual

  // Lo que muestra cada pantalla de RR. HH. hoy, y nada más (plan 13, decisión
  // «los demás ven solo lo que ya ven»): Gerencia y Administración consultan
  // tardanzas, permisos y observaciones sin soles, sin cuenta y sin el costo de
  // la persona; los pagos, el sueldo y el costo son de Recursos Humanos.
  const llevaElPersonal = puede(perfil, 'rrhh.personal')
  const ve: Record<Parte, boolean> = {
    tardanzas: true, // la misma puerta de la página: `rrhh.personal` o `asistencia.ver`, como Tardanzas
    permisos: puede(perfil, ['rrhh.permisos', 'asistencia.ver']),
    observaciones: true, // como Observaciones
    pagos: llevaElPersonal, // como Pagos de la oficina
  }
  // La planilla diaria, además, con el permiso de su pantalla y de su política (`puede_ver_planilla_diaria`).
  const veDiarias = llevaElPersonal && puede(perfil, 'planilla_diaria.preparar')
  const veSueldo = puede(perfil, ['rrhh.personal', 'planilla_diaria.preparar'])

  const [persona, marcas, resumen, permisos, observaciones, pagos] = await Promise.all([
    trabajadorPorId(id, { conDni: llevaElPersonal }),
    tardanzasDeLaPersona(id, mes),
    resumenTardanzas(mes).then((r) => r.find((x) => x.trabajador.id === id) ?? null),
    ve.permisos ? listarPermisos(mes).then((l) => l.filter((p) => p.trabajador_id === id)) : Promise.resolve([] as Permiso[]),
    listarObservaciones({ trabajadorId: id, mes }),
    ve.pagos ? pagosDeLaPersona(id, mes, { diarias: veDiarias }) : Promise.resolve([] as PagoDeLaHoja[]),
  ])
  if (!persona) notFound()

  const sucesos: Suceso[] = [
    ...marcas.tardanzas.map((t) => ({ parte: 'tardanzas' as const, fecha: t.fecha, orden: `1${t.hora}`, tardanza: t })),
    ...permisos.map((p) => ({ parte: 'permisos' as const, fecha: p.fecha, orden: `2${p.creado_en}`, permiso: p })),
    ...observaciones.map((o) => ({ parte: 'observaciones' as const, fecha: o.fecha, orden: `3${o.creado_en}`, observacion: o })),
    ...pagos.map((p) => ({ parte: 'pagos' as const, fecha: p.fecha, orden: `4${p.id}`, pago: p })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha) || a.orden.localeCompare(b.orden))

  const filtro = typeof busqueda.ver === 'string' && busqueda.ver in PARTES && ve[busqueda.ver as Parte] ? (busqueda.ver as Parte) : null
  const visibles = filtro ? sucesos.filter((s) => s.parte === filtro) : sucesos
  const dias = agruparPorDia(visibles)

  const vigentes = {
    tardanzas: marcas.tardanzas.filter((t) => !t.anulado_en),
    permisos: permisos.filter((p) => !p.anulado_en),
    observaciones: observaciones.filter((o) => !o.anulado_en),
    pagos: pagos.filter((p) => !p.anulado_en),
  }
  const minutos = vigentes.tardanzas.reduce((n, t) => n + t.minutos, 0)
  const horasPermiso = vigentes.permisos.reduce((n, p) => n + p.horas, 0)
  const porJustificar = vigentes.permisos.reduce((n, p) => n + p.por_justificar, 0)
  const amonestaciones = vigentes.observaciones.filter((o) => o.tipo !== 'OBSERVACION').length
  // Pagado es lo que ya salió: la planilla diaria cuando Tesorería la pagó; el pago de la oficina, en el mes
  // en que termina su tramo (si pasa de un mes a otro, no se cuenta dos veces).
  const yaPagados = vigentes.pagos.filter((p) => (p.clase === 'OFICINA' ? p.hasta.slice(0, 7) === mes : p.pagado_el !== null))
  const pagado = yaPagados.reduce((n, p) => n + (p.clase === 'OFICINA' ? p.monto : p.total), 0)
  const porPagar = vigentes.pagos.reduce((n, p) => n + (p.clase === 'PLANILLA_DIARIA' && p.pagado_el === null ? p.total : 0), 0)

  const enlace = (cambios: { mes?: string; ver?: Parte | null }) => {
    const m = cambios.mes ?? mes
    const v = cambios.ver === undefined ? filtro : cambios.ver
    const q = new URLSearchParams()
    if (m !== mesActual) q.set('mes', m)
    if (v) q.set('ver', v)
    const s = q.toString()
    return `/rrhh/personal/${id}${s ? `?${s}` : ''}`
  }
  const partesVisibles = (Object.keys(PARTES) as Parte[]).filter((p) => ve[p])
  const nombre = `${persona.apellidos}, ${persona.nombres}`

  return (
    <>
      <EncabezadoPagina
        titulo={nombre}
        descripcion={[persona.cargo ?? 'Sin cargo', persona.area?.nombre, persona.planilla === 'ADMINISTRATIVA' ? 'Planilla administrativa' : 'Planilla de taller']
          .filter(Boolean)
          .join(' · ')}
        ayuda={
          llevaElPersonal
            ? 'Todo lo de la persona en un mes, día por día: sus tardanzas, sus permisos, lo que se le observó y lo que se le pagó. La flecha de cada renglón abre su pantalla, donde se corrige o se anula. Lo anulado queda tachado, con su motivo.'
            : 'Las tardanzas, los permisos y lo que se le observó a la persona en un mes, día por día. La flecha de cada renglón abre su pantalla. Los pagos, el sueldo, el costo y la cuenta los lleva Recursos Humanos.'
        }
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Personal', ruta: '/rrhh/personal' }, { titulo: nombre }]}
      />

      <div className="space-y-5" data-hoja-persona={persona.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Link
              href={enlace({ mes: mesVecino(mes, -1) })}
              aria-label="Mes anterior"
              className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
            <p className="px-1 text-sm font-medium text-texto first-letter:uppercase" data-mes-hoja={mes}>
              {mesLargo(`${mes}-01`)}
            </p>
            {mes < mesActual && (
              <Link
                href={enlace({ mes: mesVecino(mes, 1) })}
                aria-label="Mes siguiente"
                className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
              >
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            )}
          </div>
          {!persona.activo && <Insignia tono="neutro">De baja{persona.fecha_baja ? ` desde el ${fecha(persona.fecha_baja)}` : ''}</Insignia>}
        </div>

        <div className={`grid grid-cols-2 gap-3 ${ve.pagos ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`} data-cifras-hoja>
          <Indicador
            titulo="Tardanzas"
            icono={Clock}
            valor={<span className="tabular">{vigentes.tardanzas.length}</span>}
            tono={resumen && resumen.porcentaje > 0 ? 'aviso' : 'neutro'}
            pie={pieDeTardanzas(minutos, marcas.diasConIngreso, resumen, veSueldo)}
            href={`/rrhh/tardanzas?mes=${mes}`}
          />
          {ve.permisos && (
            <Indicador
              titulo="Permisos"
              icono={CalendarClock}
              valor={<span className="tabular">{horasCortas(horasPermiso)}</span>}
              tono={porJustificar > 0 ? 'aviso' : 'neutro'}
              pie={
                vigentes.permisos.length === 0
                  ? 'Sin permisos'
                  : porJustificar > 0
                    ? `${horasCortas(porJustificar)} por justificar`
                    : `${vigentes.permisos.length} ${vigentes.permisos.length === 1 ? 'permiso' : 'permisos'}, sin horas por justificar`
              }
              href={`/rrhh/permisos?mes=${mes}`}
            />
          )}
          <Indicador
            // Con tres cifras en el teléfono, la tercera va a todo el ancho: no queda un hueco.
            className={!ve.pagos && ve.permisos ? 'col-span-2 lg:col-span-1' : undefined}
            titulo="Observaciones"
            icono={MessageSquareWarning}
            valor={<span className="tabular">{vigentes.observaciones.length}</span>}
            tono={amonestaciones > 0 ? 'aviso' : 'neutro'}
            pie={amonestaciones > 0 ? `${amonestaciones} ${amonestaciones === 1 ? 'amonestación o suspensión' : 'amonestaciones o suspensiones'}` : 'Sin amonestaciones'}
            href={`/rrhh/observaciones?persona=${id}&mes=${mes}`}
          />
          {ve.pagos && (
            <Indicador
              titulo="Pagado"
              icono={Wallet}
              valor={<span className="tabular">{moneda(pagado)}</span>}
              tono={porPagar > 0 ? 'aviso' : 'neutro'}
              pie={
                vigentes.pagos.length === 0
                  ? 'Sin pagos este mes'
                  : [
                      `${yaPagados.length} ${yaPagados.length === 1 ? 'pago' : 'pagos'}`,
                      porPagar > 0 ? `${moneda(porPagar)} por pagar` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
              }
            />
          )}
        </div>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Lo del mes, día por día"
            ayuda={
              llevaElPersonal
                ? 'Del día más reciente al más antiguo. La flecha de cada renglón abre su pantalla, donde se corrige o se anula.'
                : 'Del día más reciente al más antiguo. La flecha de cada renglón abre su pantalla.'
            }
          />
          {partesVisibles.length > 1 && (
            <div className="border-b border-borde px-4 py-3">
              <Vistas
                etiqueta="Qué mostrar"
                vistas={[
                  { clave: 'todo', titulo: 'Todo', href: enlace({ ver: null }), activa: filtro === null, cuenta: sucesos.length },
                  ...partesVisibles.map((p) => ({
                    clave: p,
                    titulo: PARTES[p].titulo,
                    href: enlace({ ver: p }),
                    activa: filtro === p,
                    cuenta: sucesos.filter((s) => s.parte === p).length,
                  })),
                ]}
              />
            </div>
          )}
          {dias.length === 0 ? (
            <SinDatos
              enTabla={false}
              titulo={filtro ? `Sin ${PARTES[filtro].titulo.toLowerCase()} este mes` : 'Nada registrado este mes'}
              descripcion="Mira otro mes con las flechas de arriba."
            />
          ) : (
            <ol className="divide-y divide-borde" data-linea-de-tiempo>
              {dias.map(([dia, del]) => (
                <li key={dia} className="px-4 py-3" data-dia={dia}>
                  <h3 className="tabular text-xs font-semibold tracking-wide text-texto-suave uppercase">{diaConSemana(dia)}</h3>
                  <ul className="mt-2 space-y-3">
                    {del.map((s) => (
                      <Renglon key={`${s.parte}-${'tardanza' in s ? s.tardanza.id : 'permiso' in s ? s.permiso.id : 'observacion' in s ? s.observacion.id : s.pago.id}`} suceso={s} mes={mes} id={id} veSueldo={veSueldo} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Tarjeta>

        <Ficha persona={persona} llevaElPersonal={llevaElPersonal} />
      </div>
    </>
  )
}

function pieDeTardanzas(
  minutos: number,
  diasConIngreso: number,
  resumen: { porcentaje: number; descuento: number | null } | null,
  veSueldo: boolean,
): string {
  const partes = [
    minutos > 0
      ? `${minutosLargos(minutos)} en total`
      : diasConIngreso === 0
        ? 'Sin ingresos marcados'
        : `Marcó su ingreso ${diasConIngreso} ${diasConIngreso === 1 ? 'día' : 'días'}, a tiempo`,
  ]
  if (resumen && resumen.porcentaje > 0) {
    partes.push(
      veSueldo && resumen.descuento !== null
        ? `se descuenta ${porcentajeCorto(resumen.porcentaje)} · ${moneda(resumen.descuento)}`
        : `se descuenta ${porcentajeCorto(resumen.porcentaje)} de su remuneración`,
    )
  }
  return partes.join(' · ')
}

function agruparPorDia(sucesos: Suceso[]): [string, Suceso[]][] {
  const dias = new Map<string, Suceso[]>()
  for (const s of sucesos) dias.set(s.fecha, [...(dias.get(s.fecha) ?? []), s])
  return [...dias.entries()]
}

/** «Lun 24/11»: el día de la semana dice más en la hoja que el año, que ya está arriba. */
function diaConSemana(dia: string) {
  const d = new Date(`${dia}T12:00:00Z`)
  const semana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][d.getUTCDay()]
  return `${semana} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

/** Un renglón: su insignia, lo que pasó y, a la derecha, el enlace a la pantalla que lo lleva. */
function Renglon({ suceso: s, mes, id, veSueldo }: { suceso: Suceso; mes: string; id: string; veSueldo: boolean }) {
  switch (s.parte) {
    case 'tardanzas': {
      const t = s.tardanza
      return (
        <Linea
          anulado={t.anulado_en !== null}
          motivoAnulacion={t.motivo_anulacion}
          insignia={<Insignia tono="aviso">Tardanza</Insignia>}
          href={`/rrhh/asistencia?fecha=${t.fecha}`}
          irA="Ver la asistencia del día"
          parte="tardanzas"
          cuando={diaConSemana(s.fecha)}
        >
          Marcó su ingreso a las <span className="tabular">{horaCorta(t.hora)}</span>: <span className="tabular">{minutosLargos(t.minutos)}</span> tarde
        </Linea>
      )
    }
    case 'permisos': {
      const p = s.permiso
      return (
        <Linea
          anulado={p.anulado_en !== null}
          motivoAnulacion={p.motivo_anulacion}
          insignia={<Insignia tono="info">Permiso · {horasCortas(p.horas)}</Insignia>}
          estado={<EstadoDelPermiso permiso={p} />}
          href={`/rrhh/permisos?mes=${mes}`}
          irA="Ver en Permisos"
          parte="permisos"
          cuando={diaConSemana(s.fecha)}
          detalle={detalleDelPermiso(p, veSueldo)}
        >
          {p.motivo}
        </Linea>
      )
    }
    case 'observaciones': {
      const o = s.observacion
      const tipo = TIPO_OBSERVACION[o.tipo] ?? { etiqueta: o.tipo, tono: 'neutro' as const }
      return (
        <Linea
          anulado={o.anulado_en !== null}
          motivoAnulacion={o.motivo_anulacion}
          insignia={
            <Insignia tono={tipo.tono}>
              {tipo.etiqueta}
              {o.dias_suspension ? ` · ${o.dias_suspension} ${o.dias_suspension === 1 ? 'día' : 'días'}` : ''}
            </Insignia>
          }
          href={`/rrhh/observaciones?persona=${id}&mes=${mes}`}
          irA="Ver en Observaciones"
          parte="observaciones"
          cuando={diaConSemana(s.fecha)}
          detalle={o.codigo_interno ? `Código ${o.codigo_interno}` : undefined}
        >
          <span className="font-medium">{MOTIVO_OBSERVACION[o.motivo]?.etiqueta ?? o.motivo}</span>: {o.detalle}
        </Linea>
      )
    }
    case 'pagos': {
      const p = s.pago
      if (p.clase === 'PLANILLA_DIARIA') {
        const horas = [
          p.horas_ordinarias > 0 && horasCortas(p.horas_ordinarias),
          p.horas_extras > 0 && `${horasCortas(p.horas_extras)} extras`,
          p.horas_permiso > 0 && `${horasCortas(p.horas_permiso)} de permiso`,
        ].filter(Boolean)
        return (
          <Linea
            anulado={p.anulado_en !== null}
            motivoAnulacion={p.motivo_anulacion}
            insignia={<Insignia tono="exito">Planilla diaria</Insignia>}
            estado={p.anulado_en ? undefined : p.pagado_el ? <Insignia tono="exito">Pagada el {fecha(p.pagado_el)}</Insignia> : <Insignia tono="aviso">Por pagar</Insignia>}
            href={`/planilla-diaria/${p.planilla_id}`}
            irA={`Ver la ${p.numero}`}
            parte="pagos"
            cuando={diaConSemana(s.fecha)}
            detalle={[
              horas.join(' + '),
              p.monto_descuentos > 0 && `se restó ${moneda(p.monto_descuentos)} por tardanzas y permisos`,
              p.boleta_entregada && 'boleta entregada',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <span className="tabular">{p.numero}</span>: <span className="tabular font-semibold">{moneda(p.total)}</span>
          </Linea>
        )
      }
      return (
        <Linea
          anulado={p.anulado_en !== null}
          motivoAnulacion={p.motivo_anulacion}
          insignia={<Insignia tono="exito">Pago de la oficina</Insignia>}
          href={`/rrhh/pagos-oficina?mes=${mes}`}
          irA="Ver en Pagos de la oficina"
          parte="pagos"
          cuando={diaConSemana(s.fecha)}
          detalle={[
            `aportes ${moneda(p.aportes)}`,
            p.descuentos !== 0 && (p.descuentos > 0 ? `se restó ${moneda(p.descuentos)}` : `se devolvió ${moneda(-p.descuentos)}`),
            p.nota,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          Del <span className="tabular">{fecha(p.desde)}</span> al <span className="tabular">{fecha(p.hasta)}</span>:{' '}
          <span className="tabular font-semibold">{moneda(p.monto)}</span>
        </Linea>
      )
    }
  }
}

function EstadoDelPermiso({ permiso: p }: { permiso: Permiso }) {
  if (p.anulado_en) return null
  return (
    <>
      {p.por_justificar > 0 ? (
        <Insignia tono="aviso">Falta {horasCortas(p.por_justificar)}</Insignia>
      ) : p.descontadas > 0 && p.justificadas === 0 ? (
        <Insignia tono="neutro">Descontado</Insignia>
      ) : p.descontadas > 0 ? (
        <Insignia tono="neutro">Justificado y descontado</Insignia>
      ) : (
        <Insignia tono="exito">Justificado</Insignia>
      )}
      {p.reportado && <Insignia tono="aviso">Reportado</Insignia>}
    </>
  )
}

/** Con qué se cubrió el permiso; en soles solo para quien ve el sueldo (la base lo da vacío a los demás). */
function detalleDelPermiso(p: Permiso, veSueldo: boolean): string | undefined {
  const partes: string[] = []
  if (p.justificadas > 0) partes.push(`justificado con ${horasCortas(p.justificadas)} de horas extras`)
  if (p.descontadas > 0) {
    partes.push(
      veSueldo && p.descontado !== null && p.descontado !== 0
        ? `${horasCortas(p.descontadas)} descontadas (${moneda(p.descontado)})`
        : `${horasCortas(p.descontadas)} descontadas`,
    )
  }
  return partes.length > 0 ? partes.join(' · ') : undefined
}

function Linea({
  insignia,
  estado,
  children,
  detalle,
  anulado,
  motivoAnulacion,
  href,
  irA,
  cuando,
  parte,
}: {
  insignia: ReactNode
  estado?: ReactNode
  children: ReactNode
  detalle?: string
  anulado: boolean
  motivoAnulacion: string | null
  href: string
  irA: string
  /** El día del renglón, para que el lector de pantalla no oiga diez enlaces iguales. */
  cuando: string
  parte: Parte
}) {
  return (
    <li className="flex items-start justify-between gap-3" data-suceso={parte} data-anulado={anulado || undefined}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {insignia}
          {anulado ? <Insignia tono="neutro">Anulado</Insignia> : estado}
        </div>
        <p className={`text-sm text-pretty ${anulado ? 'text-texto-suave line-through' : 'text-texto'}`}>{children}</p>
        {detalle && <p className={`text-xs text-pretty text-texto-suave ${anulado ? 'line-through' : ''}`}>{detalle}</p>}
        {anulado && motivoAnulacion && <p className="text-xs text-pretty text-texto">Motivo de la anulación: {motivoAnulacion}</p>}
      </div>
      <Link
        href={href}
        aria-label={`${irA} (${cuando})`}
        title={irA}
        className="-my-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-texto-suave hover:bg-superficie-2 hover:text-acento"
      >
        <ChevronRight aria-hidden className="size-4" />
      </Link>
    </li>
  )
}

/** Los datos de la ficha: para consultar, al final. La cuenta, el sueldo y el costo solo para RR. HH. */
function Ficha({ persona: t, llevaElPersonal }: { persona: NonNullable<Awaited<ReturnType<typeof trabajadorPorId>>>; llevaElPersonal: boolean }) {
  const datos: [string, ReactNode][] = [
    ...(llevaElPersonal ? ([['DNI', t.dni ?? 'Sin DNI']] as [string, ReactNode][]) : []),
    ['Horario', `${horaCorta(t.hora_entrada)} – ${horaCorta(t.hora_salida)}`],
    ['Ingreso', t.fecha_ingreso ? fecha(t.fecha_ingreso) : 'Sin fecha de ingreso'],
    ...(t.fecha_baja ? ([['Último día', fecha(t.fecha_baja)]] as [string, ReactNode][]) : []),
  ]
  if (llevaElPersonal) {
    datos.push(
      [
        'Cuenta',
        t.cuenta
          ? `${t.cuenta.banco} · ${TIPO_CUENTA[t.cuenta.tipo_cuenta]?.etiqueta ?? t.cuenta.tipo_cuenta} · ${t.cuenta.numero_cuenta}${t.cuenta.cci ? ` · CCI ${t.cuenta.cci}` : ''}`
          : 'Sin cuenta',
      ],
      ['Gana al mes', t.remuneracion_mensual ? `${moneda(t.remuneracion_mensual)} · ${moneda(t.remuneracion_mensual / HORAS_DEL_MES)} la hora` : 'Sin remuneración'],
      ['Cuesta al mes', t.costo_mensual ? `${moneda(t.costo_mensual)} · ${moneda(t.costo_mensual / HORAS_DEL_MES)} la hora` : 'Sin costo mensual'],
    )
  }
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Ficha"
        ayuda={llevaElPersonal ? 'Se corrige en Personal, con «Editar» en su fila.' : undefined}
      />
      <TarjetaCuerpo>
        <dl className="grid gap-3 sm:grid-cols-2" data-ficha-hoja>
          {datos.map(([rotulo, valor]) => (
            <div key={rotulo} className="space-y-1">
              <dt className="text-xs text-texto-suave">{rotulo}</dt>
              <dd className="tabular text-sm text-texto">{valor}</dd>
            </div>
          ))}
        </dl>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
