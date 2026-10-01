import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { conceptosGastoGeneral, gastosGeneralesDelMes } from '@/lib/datos/gastos-generales'
import { cantidad, fechaHora, hoyLima, mesLargo, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularGastoGeneral, NuevoGastoGeneral } from './formularios'

export const metadata = { title: 'Gastos del mes' }

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/

const GRUPO: Record<string, string> = { LOCAL: 'Servicios del local', OPERACION: 'Gastos de operación' }

/** El mes de al lado, como `YYYY-MM`, sin pasar por Date ni por husos. */
function otroMes(mes: string, delta: number) {
  const [a, m] = mes.split('-').map(Number)
  const total = a * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

const nombreDe = (u: { nombres: string; apellidos: string } | null) => (u ? `${u.nombres} ${u.apellidos}`.trim() : null)

/**
 * Lo que Administración paga cada mes y no es de una OT: los servicios del
 * local (luz, agua, internet…) y los gastos de operación (depreciación de
 * maquinaria y equipos). Cada uno se reparte entre las OT trabajadas ese mes
 * —las que figuran en una planilla cerrada— y llega a su costeo.
 *
 * Escribe `costos.gastos_generales` (Administración); lee también `costos.ver`,
 * igual que la política `ver_gastos_generales_mes`.
 */
export default async function PaginaGastosGenerales({ searchParams }: PageProps<'/costos/gastos-generales'>) {
  const perfil = await exigirPermiso(['costos.gastos_generales', 'costos.ver'])
  const params = await searchParams
  const pedido = typeof params.mes === 'string' ? params.mes : ''
  const mes = MES.test(pedido) ? pedido : hoyLima().slice(0, 7)
  const puedeRegistrar = puede(perfil, 'costos.gastos_generales')

  const [conceptos, gastos] = await Promise.all([conceptosGastoGeneral(), gastosGeneralesDelMes(`${mes}-01`)])
  const porCodigo = new Map(conceptos.map((c) => [c.codigo, c]))

  const totales = new Map<string, { grupo: string; moneda: 'PEN' | 'USD'; monto: number }>()
  for (const g of gastos) {
    if (g.estado !== 'ACTIVO' || (g.moneda !== 'PEN' && g.moneda !== 'USD')) continue
    const grupo = porCodigo.get(g.concepto)?.grupo ?? 'LOCAL'
    const clave = `${grupo}-${g.moneda}`
    const previo = totales.get(clave) ?? { grupo, moneda: g.moneda, monto: 0 }
    previo.monto += Number(g.monto)
    totales.set(clave, previo)
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Gastos del mes"
        descripcion="Servicios del local y gastos de operación que paga Administración. Cada uno se reparte entre las OT trabajadas ese mes y llega a su costeo cuando RR.HH. cierra la planilla."
        acciones={puedeRegistrar && (
          <NuevoGastoGeneral mes={mes}
            conceptos={conceptos.map((c) => ({ codigo: c.codigo, nombre: c.nombre, grupo: c.grupo, tasa: c.tasa_sugerida === null ? null : Number(c.tasa_sugerida) }))} />
        )}
      />

      <nav aria-label="Mes" className="mb-4 flex items-center gap-2">
        <Link href={`/costos/gastos-generales?mes=${otroMes(mes, -1)}`} aria-label="Mes anterior"
          className="inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] border border-borde text-texto hover:bg-superficie-2 sm:size-9">
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
        <span className="min-w-40 text-center text-base font-semibold capitalize text-texto">{mesLargo(`${mes}-01`)}</span>
        <Link href={`/costos/gastos-generales?mes=${otroMes(mes, 1)}`} aria-label="Mes siguiente"
          className="inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] border border-borde text-texto hover:bg-superficie-2 sm:size-9">
          <ChevronRight aria-hidden className="size-4" />
        </Link>
      </nav>

      {totales.size > 0 && (
        <dl className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[...totales.values()].sort((a, b) => a.grupo.localeCompare(b.grupo) || a.moneda.localeCompare(b.moneda)).map((t) => (
            <div key={`${t.grupo}-${t.moneda}`} className="rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2">
              <dt className="text-[11px] text-texto-suave">{GRUPO[t.grupo] ?? t.grupo}</dt>
              <dd className="tabular mt-1 text-lg font-semibold text-texto">{moneda(t.monto, t.moneda)}</dd>
            </div>
          ))}
        </dl>
      )}

      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo={`Gastos de ${mesLargo(`${mes}-01`)}`}
          descripcion="Con tasa, cada OT trabajada en el mes carga ese porcentaje del gasto; con partes iguales, el gasto se divide entre todas. Un gasto anulado deja de sumar y queda a la vista."
        />
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Concepto</TH>
              <TH className="hidden md:table-cell">Detalle</TH>
              <TH>Reparto</TH>
              <TH className="text-right">Importe</TH>
              <TH className="hidden lg:table-cell">Registro</TH>
              {puedeRegistrar && <TH><span className="sr-only">Acción</span></TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {gastos.length === 0 ? (
              <SinDatos
                colSpan={puedeRegistrar ? 6 : 5}
                titulo="Ningún gasto registrado en este mes"
                descripcion={puedeRegistrar
                  ? 'Registra la luz, el agua, el internet y la depreciación del mes con «Registrar gasto».'
                  : 'Administración registra aquí los servicios del local y los gastos de operación.'}
              />
            ) : gastos.map((g) => {
              const concepto = porCodigo.get(g.concepto)
              const anulado = g.estado === 'ANULADO'
              const monedaGasto = g.moneda === 'USD' ? 'USD' : 'PEN'
              return (
                <TR key={g.id}>
                  <TD className="max-w-60">
                    <span className={`block text-sm font-medium ${anulado ? 'text-texto-suave line-through' : 'text-texto'}`}>{concepto?.nombre ?? g.concepto}</span>
                    <span className="block text-[11px] text-texto-suave">{GRUPO[concepto?.grupo ?? ''] ?? ''}</span>
                    <span className="block text-[11px] text-texto-suave md:hidden">{g.descripcion}</span>
                  </TD>
                  <TD className="hidden max-w-72 md:table-cell">
                    <span className="line-clamp-2 text-sm">{g.descripcion}</span>
                    {anulado && (
                      <span className="mt-1 block text-[11px] text-peligro">
                        Anulado{nombreDe(g.anulador) ? ` por ${nombreDe(g.anulador)}` : ''} el {fechaHora(g.anulado_en)}: {g.motivo_anulacion}
                      </span>
                    )}
                  </TD>
                  <TD>
                    {g.reparto === 'TASA'
                      ? <span className="tabular block text-sm">{cantidad(g.tasa)} % por OT</span>
                      : <span className="block text-sm">Partes iguales</span>}
                    {anulado && <Insignia tono="peligro" className="mt-1 flex w-fit md:hidden">Anulado</Insignia>}
                  </TD>
                  <TD className={`tabular text-right ${anulado ? 'text-texto-suave line-through' : ''}`}>{moneda(g.monto, monedaGasto)}</TD>
                  <TD className="hidden text-[11px] text-texto-suave lg:table-cell">
                    {nombreDe(g.registrador) ?? '—'}
                    <span className="block">{fechaHora(g.creado_en)}</span>
                  </TD>
                  {puedeRegistrar && (
                    <TD className="text-right">
                      {!anulado && <AnularGastoGeneral id={g.id} nombre={concepto?.nombre ?? 'el gasto'} />}
                    </TD>
                  )}
                </TR>
              )
            })}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
