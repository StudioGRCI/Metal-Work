import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { listarPermisos, listarTrabajadores, type Permiso } from '@/lib/datos/rrhh'
import { DESCUENTOS_DESDE, horaCorta, horasCortas, mesDeLima, mesValido, mesVecino, minutosEntre, minutosLargos } from '@/lib/dominio/rrhh'
import { fecha, hoyLima, mesLargo, moneda } from '@/lib/format'
import { editaComoRrhh, exigirPermiso } from '@/lib/sesion'

import { AnularPermiso, DescontarPermiso, JustificarPermiso, RegistrarPermiso, ReportarPermiso } from './controles'

export const metadata = { title: 'Permisos del personal' }

export default async function PaginaPermisos({ searchParams }: PageProps<'/rrhh/permisos'>) {
  const perfil = await exigirPermiso(['rrhh.permisos', 'asistencia.ver'])
  const gestiona = editaComoRrhh(perfil, 'rrhh.permisos')
  const params = await searchParams
  const hoy = hoyLima()
  const mesActual = mesDeLima(hoy)
  const mes = mesValido(params.mes) ? params.mes : mesActual

  const [pendientes, delMes, personal] = await Promise.all([
    listarPermisos(),
    listarPermisos(mes),
    gestiona ? listarTrabajadores('activos') : Promise.resolve([]),
  ])
  const horasPendientes = pendientes.reduce((n, p) => n + p.por_justificar, 0)
  const vigentesDelMes = delMes.filter((p) => !p.anulado_en)
  const horasDelMes = vigentesDelMes.reduce((n, p) => n + p.horas, 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Permisos"
        ayuda="Las horas de permiso que pide cada persona y cómo las devuelve: se justifican con sus horas extras reservadas, de una vez o por partes, y entonces se pagan. Lo que no se justifica, desde el día del permiso, se descuenta (no se paga, o se resta de su próximo pago) o se reporta en sus observaciones. Al lado de cada permiso ves lo que marcó en portería ese día y las horas que le puso el supervisor."
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Permisos' }]}
        acciones={
          gestiona && (
            <RegistrarPermiso hoy={hoy} personal={personal.map((p) => ({ id: p.id, nombre: `${p.nombres} ${p.apellidos}`, cargo: p.cargo }))} />
          )
        }
      />

      <div className="max-w-4xl space-y-5">
        <Tarjeta className="overflow-hidden" data-por-justificar>
          <TarjetaCabecera
            titulo="Por justificar"
            descripcion={
              pendientes.length > 0
                ? `${horasCortas(horasPendientes)} de permiso en ${pendientes.length} ${pendientes.length === 1 ? 'permiso' : 'permisos'}, de cualquier mes`
                : 'Nadie debe horas de permiso.'
            }
            ayuda="Se justifican con las horas extras que Recursos Humanos reservó en «Horas extras». Si no las tiene o no las va a usar, desde el día del permiso se puede descontar o reportar."
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona y día</TH>
                <TH className="text-right">Falta</TH>
                <TH className="hidden text-right sm:table-cell">Horas extras reservadas</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {pendientes.length === 0 ? (
                <SinDatos
                  titulo="Sin permisos por justificar"
                  descripcion={gestiona ? 'Registra un permiso con el botón de arriba cuando alguien lo pida.' : 'Recursos Humanos registra los permisos.'}
                />
              ) : (
                pendientes.map((p) => (
                  <TR key={p.id} data-permiso={p.nombre}>
                    <TD>
                      <p className="font-medium text-texto">{p.nombre}</p>
                      <p className="text-xs text-texto-suave">
                        <span className="tabular">{fecha(p.fecha)}</span> · pidió <span className="tabular">{horasCortas(p.horas)}</span> · {p.motivo}
                      </p>
                      <Porteria permiso={p} hoy={hoy} />
                      {p.reportado && (
                        <p className="mt-1">
                          <Insignia tono="aviso">Reportado</Insignia>
                        </p>
                      )}
                      {/* Las acciones van debajo de la persona: en el teléfono, una columna aparte la dejaba en 110 px. */}
                      {gestiona && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {p.saldo > 0 ? (
                            <JustificarPermiso permisoId={p.id} nombre={p.nombre} porJustificar={p.por_justificar} saldo={p.saldo} />
                          ) : (
                            <Link href="/rrhh/horas-extras" className="inline-flex min-h-9 items-center text-xs font-medium text-acento hover:underline">
                              Sin horas reservadas
                            </Link>
                          )}
                          {p.fecha > hoy ? (
                            <span className="text-xs text-texto-suave">Se descuenta o se reporta desde el día del permiso</span>
                          ) : (
                            <>
                              {p.fecha >= `${DESCUENTOS_DESDE}-01` ? (
                                <DescontarPermiso
                                  permisoId={p.id}
                                  nombre={p.nombre}
                                  dia={fecha(p.fecha)}
                                  horas={p.horas}
                                  porJustificar={p.por_justificar}
                                  justificadas={p.justificadas}
                                  descontadas={p.descontadas}
                                  horasReporte={p.horas_reporte}
                                  valorHora={p.valor_hora}
                                  oficina={p.planilla === 'ADMINISTRATIVA'}
                                />
                              ) : (
                                <span className="text-xs text-texto-suave">De antes de octubre de 2026: se reporta, no se descuenta</span>
                              )}
                              {!p.reportado && <ReportarPermiso permisoId={p.id} nombre={p.nombre} dia={fecha(p.fecha)} />}
                            </>
                          )}
                        </div>
                      )}
                    </TD>
                    <TD className="text-right align-top">
                      <p className="tabular font-semibold whitespace-nowrap text-aviso">{horasCortas(p.por_justificar)}</p>
                      {/* Lo que valen esas horas, a la hora de la persona (DKS, 27/10/2026: porcentaje y costo). */}
                      {p.valor_hora !== null && (
                        <p className="tabular text-xs whitespace-nowrap text-texto-suave">valen {moneda(Math.round(p.por_justificar * p.valor_hora * 100) / 100)}</p>
                      )}
                      {p.justificadas > 0 && <p className="text-xs text-texto-suave">ya justificó {horasCortas(p.justificadas)}</p>}
                    </TD>
                    <TD className="tabular hidden text-right align-top sm:table-cell">{p.saldo > 0 ? horasCortas(p.saldo) : '—'}</TD>
                  </TR>
                ))
              )}
            </tbody>
          </Tabla>
        </Tarjeta>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Link
              href={`/rrhh/permisos?mes=${mesVecino(mes, -1)}`}
              aria-label="Mes anterior"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
            <p className="px-1 text-sm font-medium text-texto first-letter:uppercase">{mesLargo(`${mes}-01`)}</p>
            <Link
              href={`/rrhh/permisos?mes=${mesVecino(mes, 1)}`}
              aria-label="Mes siguiente"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          </div>
          <p className="text-xs text-texto-suave">
            <span className="tabular">{vigentesDelMes.length}</span> {vigentesDelMes.length === 1 ? 'permiso' : 'permisos'} ·{' '}
            <span className="tabular">{horasCortas(horasDelMes)}</span>
          </p>
        </div>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo="Los permisos del mes" ayuda="Del día más reciente al más antiguo. Lo anulado queda tachado, con su motivo." />
          <ul className="divide-y divide-borde">
            {delMes.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-texto-suave">No hay permisos registrados este mes.</li>
            ) : (
              delMes.map((p) => <Registro key={p.id} permiso={p} gestiona={gestiona} hoy={hoy} />)
            )}
          </ul>
        </Tarjeta>
      </div>
    </>
  )
}

function Registro({ permiso: p, gestiona, hoy }: { permiso: Permiso; gestiona: boolean; hoy: string }) {
  const anulado = p.anulado_en !== null
  return (
    <li className={`flex items-start justify-between gap-3 px-4 py-3 ${anulado ? 'opacity-60' : ''}`} data-registro-permiso={p.nombre}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {anulado ? (
            <Insignia tono="neutro">Anulado</Insignia>
          ) : p.por_justificar > 0 ? (
            <Insignia tono="aviso">Falta {horasCortas(p.por_justificar)}</Insignia>
          ) : p.descontadas > 0 && p.justificadas === 0 ? (
            <Insignia tono="neutro">Descontado</Insignia>
          ) : p.descontadas > 0 ? (
            <Insignia tono="neutro">Justificado y descontado</Insignia>
          ) : (
            <Insignia tono="exito">Justificado</Insignia>
          )}
          {!anulado && p.reportado && <Insignia tono="aviso">Reportado</Insignia>}
          <span className="tabular text-xs text-texto-suave">{fecha(p.fecha)}</span>
          <span className="tabular text-xs font-medium text-texto">{horasCortas(p.horas)}</span>
        </div>
        <p className={`text-sm font-semibold text-texto ${anulado ? 'line-through' : ''}`}>{p.nombre}</p>
        <p className={`text-sm text-texto ${anulado ? 'line-through' : ''}`}>{p.motivo}</p>
        {anulado ? (
          <p className="text-xs text-texto-suave">Anulado: {p.motivo_anulacion}</p>
        ) : (
          <>
            {p.justificadas > 0 && (
              <p className="text-xs text-texto-suave">
                Justificado con {horasCortas(p.justificadas)} de horas extras
                {p.horas_pagadas > 0 && <>; la planilla diaria pagó {horasCortas(p.horas_pagadas)}</>}.
              </p>
            )}
            {p.descontadas > 0 && (
              <p className="text-xs text-texto-suave" data-descontado>
                Descontado: {horasCortas(p.descontadas)}
                <LoDescontado permiso={p} />.
              </p>
            )}
          </>
        )}
        <Porteria permiso={p} hoy={hoy} />
      </div>
      {gestiona && !anulado && <AnularPermiso id={p.id} descripcion={`El permiso de ${p.nombre} del ${fecha(p.fecha)}`} />}
    </li>
  )
}

/** En soles, lo que el permiso descontado ya restó y lo que falta (solo para quien ve el sueldo). */
function LoDescontado({ permiso: p }: { permiso: Permiso }) {
  // Quien no ve el sueldo solo ve las horas.
  if (p.descontado === null || p.por_restar === null) return null
  const partes: React.ReactNode[] = []
  if (p.descontado !== 0) {
    partes.push(
      <span key="restado">
        <span className="tabular whitespace-nowrap">{moneda(p.descontado)}</span> {p.descontado > 0 ? 'restados de su pago' : 'devueltos'}
      </span>,
    )
  }
  if (p.por_restar !== 0) {
    const cuanto = <span className="tabular whitespace-nowrap">{moneda(Math.abs(p.por_restar))}</span>
    partes.push(
      <span key="falta">
        {cuanto} {p.por_restar > 0 ? 'por restar' : 'por devolver'}
        {p.activo ? ' en su próximo pago' : ': está de baja, ya no tiene próximo pago'}
      </span>,
    )
  }
  if (partes.length === 0) {
    partes.push(
      <span key="nada">
        {p.planilla === 'TALLER'
          ? 'el reporte de ese día no se las contó como trabajadas: no se pagan y no hay nada que restar'
          : 'se resta cuando su ficha tenga la remuneración'}
      </span>,
    )
  }
  return partes.map((x, i) => (
    <span key={i}>
      {' · '}
      {x}
    </span>
  ))
}

/** Lo que marcó en portería el día del permiso y las horas que le puso el supervisor, para decidir. */
function Porteria({ permiso: p, hoy }: { permiso: Permiso; hoy: string }) {
  if (p.fecha > hoy) return null
  const marcas = p.ingreso || p.salida
  const enPlanta = minutosEntre(p.ingreso, p.salida)
  return (
    <p className="mt-0.5 text-xs text-texto-suave" data-porteria>
      Portería:{' '}
      {marcas ? (
        <>
          {p.ingreso ? (
            <>
              entró <span className="tabular text-texto">{horaCorta(p.ingreso)}</span>
            </>
          ) : (
            'sin ingreso'
          )}
          {' · '}
          {p.salida ? (
            <>
              salió <span className="tabular text-texto">{horaCorta(p.salida)}</span>
            </>
          ) : (
            'sin salida'
          )}
          {enPlanta !== null && (
            <>
              {' · '}
              <span className="tabular text-texto">{minutosLargos(enPlanta)}</span> en planta
            </>
          )}
        </>
      ) : (
        'sin marcas ese día'
      )}
      {p.planilla === 'TALLER' && (
        <>
          {' · '}
          {p.horas_reporte === null ? (
            'sin horas en el reporte'
          ) : (
            <>
              <span className="tabular text-texto">{horasCortas(p.horas_reporte)}</span> en el reporte
            </>
          )}
        </>
      )}
    </p>
  )
}
