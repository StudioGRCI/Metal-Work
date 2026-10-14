import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { listarPermisos, listarTrabajadores, type Permiso } from '@/lib/datos/rrhh'
import { horasCortas, mesDeLima, mesValido, mesVecino } from '@/lib/dominio/rrhh'
import { fecha, hoyLima, mesLargo } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularPermiso, JustificarPermiso, RegistrarPermiso } from './controles'

export const metadata = { title: 'Permisos del personal' }

export default async function PaginaPermisos({ searchParams }: PageProps<'/rrhh/permisos'>) {
  const perfil = await exigirPermiso(['rrhh.permisos', 'asistencia.ver'])
  const gestiona = puede(perfil, 'rrhh.permisos')
  const planillas = puede(perfil, 'rrhh.ver_planillas')
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
        descripcion="Las horas de permiso que pide cada persona y cómo las devuelve: se justifican con sus horas extras reservadas, de una vez o por partes. Mientras le falten horas, el permiso queda por justificar."
        migas={[{ titulo: 'Recursos Humanos', ruta: planillas ? '/rrhh' : undefined }, { titulo: 'Permisos' }]}
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
                ? `${horasCortas(horasPendientes)} de permiso en ${pendientes.length} ${pendientes.length === 1 ? 'permiso' : 'permisos'}, de cualquier mes. Se justifican con las horas extras que Recursos Humanos reservó en «Horas extras».`
                : 'Nadie debe horas de permiso.'
            }
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona y día</TH>
                <TH className="text-right">Falta</TH>
                <TH className="hidden text-right sm:table-cell">Horas extras reservadas</TH>
                {gestiona && <TH className="text-right">Acción</TH>}
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
                    </TD>
                    <TD className="text-right">
                      <p className="tabular font-semibold text-aviso">{horasCortas(p.por_justificar)}</p>
                      {p.justificadas > 0 && <p className="text-xs text-texto-suave">ya justificó {horasCortas(p.justificadas)}</p>}
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">{p.saldo > 0 ? horasCortas(p.saldo) : '—'}</TD>
                    {gestiona && (
                      <TD className="text-right">
                        {p.saldo > 0 ? (
                          <JustificarPermiso permisoId={p.id} nombre={p.nombre} porJustificar={p.por_justificar} saldo={p.saldo} />
                        ) : (
                          <Link href="/rrhh/horas-extras" className="text-xs font-medium text-acento hover:underline">
                            Sin horas reservadas
                          </Link>
                        )}
                      </TD>
                    )}
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
          <TarjetaCabecera titulo="Los permisos del mes" descripcion="Del día más reciente al más antiguo. Lo anulado queda tachado, con su motivo." />
          <ul className="divide-y divide-borde">
            {delMes.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-texto-suave">No hay permisos registrados este mes.</li>
            ) : (
              delMes.map((p) => <Registro key={p.id} permiso={p} gestiona={gestiona} />)
            )}
          </ul>
        </Tarjeta>
      </div>
    </>
  )
}

function Registro({ permiso: p, gestiona }: { permiso: Permiso; gestiona: boolean }) {
  const anulado = p.anulado_en !== null
  return (
    <li className={`flex items-start justify-between gap-3 px-4 py-3 ${anulado ? 'opacity-60' : ''}`} data-registro-permiso={p.nombre}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {anulado ? (
            <Insignia tono="neutro">Anulado</Insignia>
          ) : p.por_justificar > 0 ? (
            <Insignia tono="aviso">Falta {horasCortas(p.por_justificar)}</Insignia>
          ) : (
            <Insignia tono="exito">Justificado</Insignia>
          )}
          <span className="tabular text-xs text-texto-suave">{fecha(p.fecha)}</span>
          <span className="tabular text-xs font-medium text-texto">{horasCortas(p.horas)}</span>
        </div>
        <p className={`text-sm font-semibold text-texto ${anulado ? 'line-through' : ''}`}>{p.nombre}</p>
        <p className={`text-sm text-texto ${anulado ? 'line-through' : ''}`}>{p.motivo}</p>
        {anulado ? (
          <p className="text-xs text-texto-suave">Anulado: {p.motivo_anulacion}</p>
        ) : (
          p.justificadas > 0 && <p className="text-xs text-texto-suave">Justificado con {horasCortas(p.justificadas)} de horas extras.</p>
        )}
      </div>
      {gestiona && !anulado && <AnularPermiso id={p.id} descripcion={`El permiso de ${p.nombre} del ${fecha(p.fecha)}`} />}
    </li>
  )
}
