import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { reglaTardanza, resumenTardanzas } from '@/lib/datos/rrhh'
import { mesDeLima, mesValido, mesVecino, minutosLargos } from '@/lib/dominio/rrhh'
import { hoyLima, mesLargo, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FormularioRegla } from './regla'

export const metadata = { title: 'Tardanzas del personal' }

export default async function PaginaTardanzas({ searchParams }: PageProps<'/rrhh/tardanzas'>) {
  const perfil = await exigirPermiso(['asistencia.ver', 'rrhh.personal'])
  const ajusta = puede(perfil, 'rrhh.personal')
  const params = await searchParams
  const mesActual = mesDeLima(hoyLima())
  const mes = mesValido(params.mes) ? params.mes : mesActual

  const [resumen, regla] = await Promise.all([resumenTardanzas(mes), reglaTardanza()])
  const conTardanza = resumen.filter((r) => r.tardanzas > 0)
  const total = conTardanza.reduce((n, r) => n + r.descuento, 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Tardanzas"
        descripcion="Por cada persona, cuántas veces llegó después de su hora en el mes, cuántos minutos suman y el descuento que eso genera, para la planilla."
        migas={[{ titulo: 'Recursos Humanos', ruta: '/rrhh' }, { titulo: 'Tardanzas' }]}
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
          <p className="px-1 text-sm font-medium text-texto capitalize">{mesLargo(`${mes}-01`)}</p>
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
        <p className="text-xs text-texto-suave">
          <span className="tabular">{conTardanza.length}</span> {conTardanza.length === 1 ? 'persona' : 'personas'} con tardanza ·{' '}
          <span className="tabular">{moneda(total)}</span> de descuento
        </p>
      </div>

      <div className="space-y-5">
        <Tarjeta className="overflow-hidden">
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona</TH>
                <TH className="text-right">Días</TH>
                <TH className="text-right">Tardanzas</TH>
                <TH className="hidden text-right sm:table-cell">Minutos</TH>
                <TH className="text-right">Descuento</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {resumen.length === 0 ? (
                <SinDatos titulo="No hay personal registrado" descripcion="Recursos Humanos registra al personal en «Personal»." />
              ) : (
                resumen.map((r) => (
                  <TR key={r.trabajador.id} className={r.trabajador.activo ? undefined : 'opacity-60'}>
                    <TD>
                      <p className="font-medium text-texto">
                        {r.trabajador.apellidos}, {r.trabajador.nombres}
                      </p>
                      <p className="text-xs text-texto-suave">
                        {r.trabajador.cargo ?? 'Sin cargo'}
                        {!r.trabajador.activo && ' · de baja'}
                      </p>
                    </TD>
                    <TD className="tabular text-right">{r.dias_con_ingreso}</TD>
                    <TD className={`tabular text-right ${r.tardanzas > 0 ? 'font-semibold text-peligro' : ''}`}>{r.tardanzas}</TD>
                    <TD className="tabular hidden text-right sm:table-cell">{minutosLargos(r.minutos)}</TD>
                    <TD className="tabular text-right">{r.descuento > 0 ? moneda(r.descuento) : '—'}</TD>
                  </TR>
                ))
              )}
            </tbody>
          </Tabla>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera
            titulo="La regla de tardanza"
            descripcion={
              regla
                ? `Hoy: ${regla.tolerancia_minutos} ${regla.tolerancia_minutos === 1 ? 'minuto' : 'minutos'} de tolerancia y ${moneda(regla.descuento_por_minuto)} por cada minuto de tardanza. Cambiarla no toca las marcas ya hechas.`
                : 'Todavía no hay regla: se usa la de la base.'
            }
          />
          {ajusta && (
            <TarjetaCuerpo>
              <FormularioRegla tolerancia={regla?.tolerancia_minutos ?? 5} descuentoPorMinuto={regla?.descuento_por_minuto ?? 0.08} />
            </TarjetaCuerpo>
          )}
        </Tarjeta>
      </div>
    </>
  )
}
