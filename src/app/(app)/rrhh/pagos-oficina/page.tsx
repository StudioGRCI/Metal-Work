import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { inicioDelRegistroDePagos, listarTrabajadores, pagosOficinaDelMes, periodosAnteriores } from '@/lib/datos/rrhh'
import { diasEntre, diasSinPago, finDeMes, parteDelMes } from '@/lib/dominio/pagos-oficina'
import { mesDeLima, mesValido, mesVecino } from '@/lib/dominio/rrhh'
import { fecha, fechaHora, hoyLima, mesLargo, moneda, sumarDias } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularPago, RegistrarPago } from './formulario'

export const metadata = { title: 'Pagos de la oficina' }

/**
 * Lo que se le paga de verdad a la gente de la oficina (StudioGRCI eligió «Cada
 * pago» el 2026-10-20): cada pago con su semana, quincena, mes o los días que
 * sean. De aquí sale el sueldo de la oficina que se reparte por horas entre las
 * unidades (`sueldos_oficina_del_mes`). Solo RR. HH. (`rrhh.personal`), igual que
 * la política `ver_oficina_pagos`.
 */
export default async function PaginaPagosOficina({ searchParams }: PageProps<'/rrhh/pagos-oficina'>) {
  const perfil = await exigirPermiso('rrhh.personal')
  const planillas = puede(perfil, 'rrhh.ver_planillas')
  const params = await searchParams
  const hoy = hoyLima()
  const mesActual = mesDeLima(hoy)
  const mes = mesValido(params.mes) ? params.mes : mesActual
  const inicio = `${mes}-01`
  const fin = finDeMes(mes)

  const [pagos, personal, registro, periodos] = await Promise.all([
    pagosOficinaDelMes(mes, fin),
    listarTrabajadores('todos'),
    inicioDelRegistroDePagos(),
    periodosAnteriores(),
  ])
  const vigentes = pagos.filter((p) => !p.anulado_en)
  const totalDelMes = vigentes.reduce((n, p) => n + parteDelMes(p, mes), 0)
  // La gente de planilla administrativa que trabajó algún día de este mes, según su ingreso y su
  // baja, o en un periodo anterior si volvió a entrar.
  const enElMes = (desde: string | null, hasta: string | null) => (desde === null || desde <= fin) && (hasta === null || hasta >= inicio)
  const deOficina = personal.filter(
    (t) =>
      t.planilla === 'ADMINISTRATIVA' &&
      (t.activo || t.fecha_baja !== null) &&
      (enElMes(t.fecha_ingreso, t.fecha_baja) || (periodos.get(t.id) ?? []).some((q) => enElMes(q.ingreso, q.baja))),
  )
  const pagosDe = (id: string) => vigentes.filter((p) => p.trabajador_id === id)
  const faltan = deOficina.map((t) => ({ t, ...diasSinPago(t, pagosDe(t.id), mes, hoy, registro.get(t.id) ?? inicio, periodos.get(t.id)) })).filter((f) => f.dias > 0)
  const nombre = (t: { nombres: string; apellidos: string }) => `${t.nombres} ${t.apellidos}`
  // Al elegir a la persona, «Desde» se llena con su primer día sin pago, o con el día
  // siguiente a su último pago del mes, o con el 1.
  const primerDiaLibre = (id: string) => {
    const hueco = faltan.find((f) => f.t.id === id)?.desde
    if (hueco) return hueco
    const ultimo = pagosDe(id).reduce<string | null>((u, p) => (u === null || p.hasta > u ? p.hasta : u), null)
    return ultimo ? sumarDias(ultimo, 1) : inicio
  }
  // Los vigentes primero; los anulados quedan al final, como evidencia.
  const ordenados = [...vigentes, ...pagos.filter((p) => p.anulado_en)]

  return (
    <>
      <EncabezadoPagina
        titulo="Pagos de la oficina"
        ayuda="Lo que se le paga a cada persona de planilla administrativa (la planilla se elige en su ficha de Personal, no depende del área), como se le paga: por semana, por quincena o por mes. Cada pago entra al sueldo de la oficina de cada mes por los días que caen en él, con sus aportes, y ese sueldo se reparte por horas entre las unidades que trabajaron el mes. Lo que esa persona cargó en horas a una unidad ya va en la mano de obra y se descuenta. Solo lo ve Recursos Humanos; Administración y Gerencia ven el total."
        migas={[{ titulo: 'Recursos Humanos', ruta: planillas ? '/rrhh' : undefined }, { titulo: 'Pagos de la oficina' }]}
        acciones={
          <RegistrarPago
            inicio={inicio}
            personal={deOficina
              .filter((t) => t.activo || (t.fecha_baja !== null && t.fecha_baja >= inicio))
              .map((t) => ({ id: t.id, nombre: nombre(t), cargo: t.cargo, inicio: primerDiaLibre(t.id) }))}
          />
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link
            href={`/rrhh/pagos-oficina?mes=${mesVecino(mes, -1)}`}
            aria-label="Mes anterior"
            className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto sm:size-9"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <p className="px-1 text-sm font-medium text-texto first-letter:uppercase">{mesLargo(inicio)}</p>
          {/* Hasta el mes que viene: la base acepta pagos que empiezan hasta 31 días adelante. */}
          {mes <= mesActual && (
            <Link
              href={`/rrhh/pagos-oficina?mes=${mesVecino(mes, 1)}`}
              aria-label="Mes siguiente"
              className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto sm:size-9"
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
        <p className="text-xs text-texto-suave" data-total-del-mes>
          <span className="tabular">{moneda(totalDelMes)}</span> de este mes en{' '}
          <span className="tabular">{vigentes.length}</span> {vigentes.length === 1 ? 'pago' : 'pagos'}
        </p>
      </div>

      <div className="space-y-5">
        {faltan.length > 0 && (
          <Tarjeta className="border-aviso" data-faltan-pagos>
            <TarjetaCabecera
              titulo="Les faltan días pagados"
              descripcion={`${faltan.length} ${faltan.length === 1 ? 'persona' : 'personas'} de planilla administrativa con días de este mes sin pago registrado.`}
              ayuda="Cuenta los días entre su ingreso y su baja, hasta hoy, que ningún pago cubre. Cuenta desde octubre de 2026, cuando RR. HH. empieza a registrar los pagos, o desde antes si hay pagos u horas de meses anteriores. Mientras falten, el sueldo de la oficina del mes sale incompleto en el costeo de cada unidad. Si alguien ya no trabaja, dalo de baja en Personal con su último día."
            />
            <TarjetaCuerpo>
              <ul className="max-w-2xl space-y-2 text-sm">
                {faltan.map((f) => (
                  <li key={f.t.id} className="flex flex-wrap justify-between gap-2">
                    <span className="text-texto">{nombre(f.t)}</span>
                    <span className="text-xs text-texto-suave">
                      <span className="tabular">{f.dias}</span> {f.dias === 1 ? 'día' : 'días'} sin pago, desde el {fecha(f.desde)}
                      {f.t.fecha_ingreso === null && (
                        <>
                          {' · '}
                          <Link href="/rrhh/personal" className="text-acento underline-offset-2 hover:underline">
                            sin fecha de ingreso
                          </Link>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Pagos que tocan este mes"
            ayuda="Un pago que cruza de un mes a otro se parte por días: una semana del 28 al 3 deja 4 de 7 partes en un mes y 3 en el otro. Uno mal registrado se anula con su motivo: queda tachado y deja de sumar."
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona</TH>
                <TH>Días que paga</TH>
                <TH className="hidden text-right sm:table-cell">Pagado</TH>
                <TH className="text-right">En este mes</TH>
                <TH className="text-right">
                  <span className="sr-only">Acciones</span>
                </TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {pagos.length === 0 ? (
                <SinDatos titulo="Sin pagos este mes" descripcion="Registra el primero con «Registrar pago»." />
              ) : (
                ordenados.map((p) => {
                  const quien = p.trabajador ? nombre(p.trabajador) : 'Persona sin ficha'
                  const anulado = p.anulado_en !== null
                  const dias = diasEntre(p.desde, p.hasta)
                  return (
                    <TR key={p.id}>
                      <TD className="align-top">
                        <p className={`font-medium text-texto ${anulado ? 'line-through' : ''}`}>{quien}</p>
                        {p.nota && <p className="text-xs text-texto-suave">{p.nota}</p>}
                        {anulado && (
                          <>
                            <Insignia tono="peligro" className="mt-1">
                              Anulado
                            </Insignia>
                            <p className="mt-1 text-xs text-texto-suave">
                              {p.anulador ? `Por ${nombre(p.anulador)} el ` : 'El '}
                              {fechaHora(p.anulado_en!)}: {p.motivo_anulacion}
                            </p>
                          </>
                        )}
                      </TD>
                      <TD className="align-top">
                        <p className="tabular text-sm text-texto">
                          {fecha(p.desde)} al {fecha(p.hasta)}
                        </p>
                        <p className="tabular text-[11px] text-texto-suave">
                          {dias} {dias === 1 ? 'día' : 'días'}
                        </p>
                      </TD>
                      <TD className={`tabular hidden text-right align-top whitespace-nowrap sm:table-cell ${anulado ? 'line-through' : ''}`}>
                        {moneda(p.monto + p.aportes)}
                        {p.aportes > 0 && <p className="text-[11px] text-texto-suave">con {moneda(p.aportes)} de aportes</p>}
                      </TD>
                      <TD className={`tabular text-right align-top font-semibold whitespace-nowrap ${anulado ? 'line-through' : ''}`}>
                        {moneda(parteDelMes(p, mes))}
                      </TD>
                      <TD className="text-right align-top">
                        {!anulado && <AnularPago id={p.id} descripcion={`El pago de ${quien} del ${fecha(p.desde)} al ${fecha(p.hasta)}`} />}
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
