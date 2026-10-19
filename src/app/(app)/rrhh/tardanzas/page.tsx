import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { reglaTardanza, resumenTardanzas } from '@/lib/datos/rrhh'
import { mesDeLima, mesValido, mesVecino, minutosLargos, porcentajeCorto } from '@/lib/dominio/rrhh'
import { hoyLima, mesLargo, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FormularioRegla } from './regla'

export const metadata = { title: 'Tardanzas del personal' }

export default async function PaginaTardanzas({ searchParams }: PageProps<'/rrhh/tardanzas'>) {
  const perfil = await exigirPermiso(['asistencia.ver', 'rrhh.personal'])
  const ajusta = puede(perfil, 'rrhh.personal')
  // El monto sale de la remuneración, que solo ve RR. HH. (la misma regla que
  // aplica `rrhh_tardanzas_del_mes`). Gerencia y Administración ven el porcentaje.
  const veSueldo = ajusta || puede(perfil, 'planilla_diaria.preparar')
  // La miga lleva a las planillas solo a quien las abre: Gerencia y
  // Administración consultan esto con `asistencia.ver` y ahí las rebotaban.
  const planillas = puede(perfil, 'rrhh.ver_planillas')
  const params = await searchParams
  const mesActual = mesDeLima(hoyLima())
  const mes = mesValido(params.mes) ? params.mes : mesActual

  const [resumen, regla] = await Promise.all([resumenTardanzas(mes), reglaTardanza()])
  const cada = regla?.tardanzas_por_descuento ?? 3
  const pct = regla?.porcentaje_descuento ?? 5
  const conDescuento = resumen.filter((r) => r.porcentaje > 0)
  const total = conDescuento.reduce((n, r) => n + (r.descuento ?? 0), 0)
  const sinRemuneracion = conDescuento.filter((r) => r.remuneracion_mensual === null).length

  return (
    <>
      <EncabezadoPagina
        titulo="Tardanzas"
        ayuda={`Por cada persona, cuántas veces llegó después de su hora y su tolerancia en el mes. Cada ${cada} tardanzas se descuenta el ${porcentajeCorto(pct)} de su remuneración mensual; el mes siguiente empieza de cero.`}
        migas={[{ titulo: 'Recursos Humanos', ruta: planillas ? '/rrhh' : undefined }, { titulo: 'Tardanzas' }]}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link
            href={`/rrhh/tardanzas?mes=${mesVecino(mes, -1)}`}
            aria-label="Mes anterior"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <p className="px-1 text-sm font-medium text-texto first-letter:uppercase">{mesLargo(`${mes}-01`)}</p>
          {mes < mesActual && (
            <Link
              href={`/rrhh/tardanzas?mes=${mesVecino(mes, 1)}`}
              aria-label="Mes siguiente"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
        <p className="text-xs text-texto-suave" data-resumen-tardanzas>
          <span className="tabular">{conDescuento.length}</span> {conDescuento.length === 1 ? 'persona' : 'personas'} con descuento
          {veSueldo && conDescuento.length > 0 && (
            <>
              {' '}
              · <span className="tabular">{moneda(total)}</span>
              {sinRemuneracion > 0 && ` (${sinRemuneracion} sin remuneración en su ficha)`}
            </>
          )}
        </p>
      </div>

      <div className="space-y-5">
        <Tarjeta className="overflow-hidden">
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona</TH>
                <TH className="hidden text-right sm:table-cell">Días</TH>
                <TH className="text-right">Tardanzas</TH>
                <TH className="hidden text-right sm:table-cell">Minutos</TH>
                <TH className="text-right">Descuento</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {resumen.length === 0 ? (
                <SinDatos titulo="No hay personal registrado" descripcion="Recursos Humanos registra al personal en «Personal»." />
              ) : (
                resumen.map((r) => {
                  const faltan = cada - (r.tardanzas % cada)
                  return (
                    <TR key={r.trabajador.id} className={r.trabajador.activo ? undefined : 'opacity-60'} data-tardanzas={r.trabajador.dni}>
                      <TD>
                        <p className="font-medium text-texto">
                          {r.trabajador.apellidos}, {r.trabajador.nombres}
                        </p>
                        <p className="text-xs text-texto-suave">
                          {r.trabajador.cargo ?? 'Sin cargo'}
                          {!r.trabajador.activo && ' · de baja'}
                        </p>
                      </TD>
                      <TD className="tabular hidden text-right sm:table-cell">{r.dias_con_ingreso}</TD>
                      <TD className="text-right">
                        <p className={`tabular ${r.tardanzas > 0 ? 'font-semibold text-peligro' : ''}`}>{r.tardanzas}</p>
                        {r.tardanzas > 0 && (
                          <p className="text-xs text-texto-suave">
                            {faltan === 1 ? 'Le falta 1' : `Le faltan ${faltan}`} para {r.porcentaje > 0 ? 'otro' : 'el'} descuento
                          </p>
                        )}
                      </TD>
                      <TD className="tabular hidden text-right sm:table-cell">{minutosLargos(r.minutos)}</TD>
                      <TD className="text-right">
                        {r.porcentaje > 0 ? (
                          <>
                            <p className="tabular font-semibold text-texto">{porcentajeCorto(r.porcentaje)}</p>
                            {veSueldo && (
                              <p className="text-xs text-texto-suave">
                                {r.descuento === null ? 'Falta su remuneración' : <span className="tabular">{moneda(r.descuento)}</span>}
                              </p>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </TD>
                    </TR>
                  )
                })
              )}
            </tbody>
          </Tabla>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera
            titulo="La regla de tardanza"
            ayuda={
              regla
                ? `Hoy: ${regla.tolerancia_minutos} ${regla.tolerancia_minutos === 1 ? 'minuto' : 'minutos'} de tolerancia; cada ${cada} tardanzas del mes se descuenta el ${porcentajeCorto(pct)} de la remuneración mensual. Si una marca fue tardanza queda fijo al marcar; el descuento del mes se calcula con la regla de hoy. Las tardanzas no se compensan con horas extras: eso es para los permisos.`
                : 'Todavía no hay regla: se usa la de la base.'
            }
          />
          {ajusta && (
            <TarjetaCuerpo>
              <FormularioRegla tolerancia={regla?.tolerancia_minutos ?? 5} tardanzasPorDescuento={cada} porcentajeDescuento={pct} />
            </TarjetaCuerpo>
          )}
        </Tarjeta>
      </div>
    </>
  )
}
