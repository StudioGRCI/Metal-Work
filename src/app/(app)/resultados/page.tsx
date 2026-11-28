import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { ACTIVA, GRUPO_PASTILLAS, INACTIVA, PASTILLA } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { DetalleEnTelefono, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { resultadosDeMetalWork, type CodigoDelPeriodo, type GastoDelPeriodo } from '@/lib/datos/resultados'
import { enlaceCodigo } from '@/lib/dominio/codigos-internos'
import {
  enOtraEscala,
  etiquetaDeOficina,
  leerPeriodo,
  periodoDeAlLado,
  sinRepartirDe,
  totalDeMetalWork,
  type Escala,
  type Periodo,
} from '@/lib/dominio/resultados'
import { fechaLarga, hoyLima, mesLargo, moneda, parteDe, porcentaje } from '@/lib/format'
import { cn } from '@/lib/utils'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Resultados de Metal Work' }

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const FLECHA =
  'inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] border border-borde text-texto hover:bg-superficie-2 sm:size-9'
const ESCALAS: { escala: Escala; etiqueta: string }[] = [
  { escala: 'dia', etiqueta: 'Día' },
  { escala: 'mes', etiqueta: 'Mes' },
  { escala: 'ano', etiqueta: 'Año' },
]

/** «28 de noviembre de 2026», «noviembre de 2026» o «2026». */
function nombreDelPeriodo(p: Periodo) {
  if (p.escala === 'dia') return fechaLarga(p.valor)
  if (p.escala === 'mes') return mesLargo(`${p.valor}-01`)
  return p.valor
}
/** «el día», «el mes», «el año»: para decir qué no tuvo. */
const elPeriodo = (p: Periodo) => (p.escala === 'dia' ? 'ese día' : p.escala === 'mes' ? 'ese mes' : 'ese año')

/**
 * Los resultados de Metal Work (plan del gasto operativo, entrega 3): primero
 * cada carrocería (código interno) con su ingreso y su ganancia; después el
 * total de la empresa, que resta una sola vez el gasto operativo, el de oficina
 * y lo que no se repartió a ninguna unidad. Gerencia y Contabilidad, en lectura.
 */
export default async function PaginaResultados({ searchParams }: PageProps<'/resultados'>) {
  const perfil = await exigirPermiso('resultados.ver')
  const params = await searchParams
  const hoy = hoyLima()
  const p = leerPeriodo(typeof params.periodo === 'string' ? params.periodo : undefined, hoy)
  const r = await resultadosDeMetalWork(p.desde, p.hasta)
  const total = totalDeMetalWork(r)
  const nombre = nombreDelPeriodo(p)
  const anterior = periodoDeAlLado(p, -1, hoy)
  const siguiente = periodoDeAlLado(p, 1, hoy)
  const enlace = (periodo: string) => `/resultados?${new URLSearchParams({ periodo })}`
  const verCodigos = puede(perfil, 'codigos_internos.ver')
  const verOperativo = puede(perfil, 'gasto_operativo.ver')
  const verCambio = puede(perfil, ['tesoreria.tipo_cambio', 'tesoreria.ver_tipo_cambio'])
  // Las carrocerías de más ganancia arriba; las que no se pueden decir en soles, al final.
  const codigos = [...r.codigos].sort(
    (a, b) => Number(a.ganancia === null) - Number(b.ganancia === null) || (b.ganancia ?? 0) - (a.ganancia ?? 0) || a.codigo.localeCompare(b.codigo),
  )
  const gastos = total.operativo + total.oficina + total.sinRepartir

  return (
    <>
      <EncabezadoPagina
        titulo="Resultados de Metal Work"
        ayuda="Primero cada carrocería, por su código interno: lo facturado sin IGV y en soles, el costo que le toca y lo que deja. Una factura lleva la parte del costo que factura: un adelanto del 50 % lleva la mitad del costo de la unidad, y la factura que la completa, el resto. Lo facturado de más no lleva costo. El costo es el que Gerencia cerró o, si sigue abierto, el de hoy: por eso un periodo cambia hasta que se cierra el costeo de sus carrocerías. Después, el total de Metal Work: la suma de las carrocerías menos el gasto operativo de las áreas, el gasto de oficina y lo que no se repartió a ninguna unidad. Las facturas en dólares pasan a soles con el cambio de compra de su día."
      />

      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <nav aria-label="Ver por" className={GRUPO_PASTILLAS}>
            {ESCALAS.map((e) => (
              <Link
                key={e.escala}
                href={enlace(enOtraEscala(p, e.escala, hoy))}
                aria-current={e.escala === p.escala ? 'page' : undefined}
                className={cn(PASTILLA, e.escala === p.escala ? ACTIVA : INACTIVA)}
              >
                {e.etiqueta}
              </Link>
            ))}
          </nav>
          <nav aria-label="Periodo" className="flex items-center gap-2">
            {anterior ? (
              <Link href={enlace(anterior)} aria-label="Periodo anterior" className={FLECHA}>
                <ChevronLeft aria-hidden className="size-4" />
              </Link>
            ) : (
              <span aria-hidden className={`${FLECHA} pointer-events-none opacity-40`}>
                <ChevronLeft className="size-4" />
              </span>
            )}
            <span className="min-w-44 text-center text-base font-semibold text-texto first-letter:uppercase" data-periodo>
              {nombre}
            </span>
            {siguiente ? (
              <Link href={enlace(siguiente)} aria-label="Periodo siguiente" className={FLECHA}>
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            ) : (
              <span aria-hidden className={`${FLECHA} pointer-events-none opacity-40`}>
                <ChevronRight className="size-4" />
              </span>
            )}
          </nav>
        </div>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-cifras-resultados>
          <Cifra rotulo="Facturado sin IGV" valor={total.ingreso} dato="ingreso" />
          <Cifra rotulo="Costo de lo facturado" valor={total.costo} dato="costo" />
          <Cifra rotulo="Gastos de la empresa" valor={gastos} dato="gastos" pie="Operativo, oficina y sin repartir" />
          <Cifra rotulo="Ganancia de Metal Work" valor={total.ganancia} dato="ganancia" destacada rojoSiPierde />
        </dl>

        {total.codigosFuera > 0 && (
          <p className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-pretty text-texto" data-sin-cambio>
            {plural(total.codigosFuera, 'carrocería no entra', 'carrocerías no entran')} en el total: {total.codigosFuera === 1 ? 'tiene' : 'tienen'}{' '}
            facturas en dólares sin el cambio de su día (<span className="tabular whitespace-nowrap">{moneda(total.usdFuera, 'USD')}</span> sin IGV).{' '}
            {verCambio ? (
              <Link href="/tesoreria/tipo-de-cambio" className="font-medium text-acento hover:underline">
                Registrar el tipo de cambio
              </Link>
            ) : (
              'Entran cuando Tesorería registre el tipo de cambio de ese día.'
            )}
          </p>
        )}

        <Tarjeta className="overflow-hidden" data-por-codigo>
          <TarjetaCabecera
            titulo="Por carrocería"
            descripcion={codigos.length > 0 ? `${plural(codigos.length, 'código interno facturado', 'códigos internos facturados')} en ${nombre}.` : undefined}
            ayuda="Cada código interno con lo que se le facturó en el periodo. «Costo» es la parte de su costo que lleva lo facturado; el porcentaje dice qué parte de la unidad se facturó."
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Código interno</TH>
                <TH className="hidden text-right sm:table-cell">Facturado sin IGV</TH>
                <TH className="hidden text-right sm:table-cell">Costo</TH>
                <TH className="text-right">Ganancia</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {codigos.length === 0 ? (
                <SinDatos
                  colSpan={4}
                  titulo={`Ninguna factura de venta en ${nombre}`}
                  descripcion="Aparece aquí cada código interno al que Contabilidad le registra una factura de venta, con la fecha de emisión dentro del periodo."
                />
              ) : (
                codigos.map((c) => <FilaDeCodigo key={c.codigo} c={c} enlace={verCodigos} />)
              )}
            </tbody>
          </Tabla>
        </Tarjeta>

        <Tarjeta className="overflow-hidden" data-total-metal-work>
          <TarjetaCabecera
            titulo="Total de Metal Work"
            descripcion={`${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}, en soles.`}
            ayuda="Lo que dejan todas las carrocerías juntas y, una sola vez al final, lo que la empresa gastó para trabajar sin cargarlo a ninguna unidad. El sueldo de la oficina, la luz y los demás gastos del mes ya van dentro del costo de cada carrocería, repartidos por sus horas; aquí solo se resta lo que no le tocó a ninguna. Lo comprado no se resta: entra al almacén y cuenta cuando sale."
          />
          <dl className="divide-y divide-borde text-sm">
            <Renglon rotulo="Facturado sin IGV" valor={total.ingreso} dato="ingreso" />
            <Renglon rotulo="Costo de lo facturado" valor={restado(total.costo)} dato="costo" />
            <Renglon rotulo="Lo que dejan las carrocerías" valor={total.margen} dato="margen" fuerte pie={total.ingreso > 0 ? `${porcentaje(parteDe(total.margen, total.ingreso))} de lo facturado` : undefined} />
            <Bloque
              rotulo="Gasto operativo"
              valor={total.operativo}
              dato="operativo"
              vacio={`Ninguna área tuvo gasto operativo ${elPeriodo(p)}.`}
              partes={r.operativo.map((g) => ({ clave: g.clave ?? 'sin-area', etiqueta: g.nombre ?? 'Planta, sin área', gasto: g }))}
              enlace={verOperativo && p.escala !== 'ano' ? { href: `/gasto-operativo?${new URLSearchParams({ mes: p.desde.slice(0, 7) })}`, texto: 'Ver el gasto operativo del mes' } : null}
            />
            <Bloque
              rotulo="Gasto de oficina"
              valor={total.oficina}
              dato="oficina"
              vacio={`Nada cargado a OFICINA ${elPeriodo(p)}.`}
              partes={r.oficina.map((g) => ({ clave: g.clave ?? 'otros', etiqueta: etiquetaDeOficina(g.clave), gasto: g }))}
            />
            <Bloque
              rotulo="Sin repartir a ninguna unidad"
              valor={total.sinRepartir}
              dato="sin-repartir"
              vacio="Todo lo de la empresa se repartió entre las carrocerías."
              partes={r.sinRepartir.map((g) => ({ clave: g.clave ?? 'otros', etiqueta: sinRepartirDe(g.clave).etiqueta, porque: sinRepartirDe(g.clave).porque, gasto: g }))}
            />
            <Renglon rotulo="Ganancia de Metal Work" valor={total.ganancia} dato="ganancia" fuerte destacada />
          </dl>
        </Tarjeta>
      </div>
    </>
  )
}

function Cifra({ rotulo, valor, dato, pie, destacada, rojoSiPierde }: { rotulo: string; valor: number; dato: string; pie?: string; destacada?: boolean; rojoSiPierde?: boolean }) {
  return (
    <div className={cn('rounded-[var(--radius-base)] border bg-superficie px-3 py-2', destacada ? 'border-acento' : 'border-borde')} data-cifra={dato}>
      <dt className="text-xs text-texto-suave">{rotulo}</dt>
      <dd className={cn('tabular mt-1 text-lg font-semibold', rojoSiPierde && valor < 0 ? 'text-peligro' : 'text-texto')}>{moneda(valor)}</dd>
      {pie && <dd className="text-xs text-texto-suave">{pie}</dd>}
    </div>
  )
}

function FilaDeCodigo({ c, enlace }: { c: CodigoDelPeriodo; enlace: boolean }) {
  const facturado = (
    <>
      <span className="whitespace-nowrap">{moneda(c.ingreso)}</span>
      {c.usdSinCambio > 0 && (
        <span className="block text-xs text-aviso">
          + <span className="whitespace-nowrap">{moneda(c.usdSinCambio, 'USD')}</span> sin cambio
        </span>
      )}
    </>
  )
  const costo = (
    <>
      <span className="whitespace-nowrap">{moneda(c.costo)}</span>
      <span className="block text-xs text-texto-suave">
        {porcentaje(c.parteDelCosto * 100)} de <span className="whitespace-nowrap">{moneda(c.costoDelCodigo)}</span>
      </span>
    </>
  )
  return (
    <TR data-codigo={c.codigo}>
      <TD>
        {enlace ? (
          <Link href={enlaceCodigo(c.codigo, 'costeo')} className="inline-flex min-h-11 items-center font-medium break-all text-acento hover:underline sm:min-h-0">
            {c.codigo}
          </Link>
        ) : (
          <span className="font-medium break-all text-texto">{c.codigo}</span>
        )}
        {c.cliente && <span className="block text-xs text-pretty text-texto-suave">{c.cliente}</span>}
        <span className="block text-xs text-texto-suave">
          {plural(c.facturas, 'factura', 'facturas')}
          {c.costoCerrado ? ' · costeo cerrado' : ' · costo de hoy'}
        </span>
        {(c.costoIncompleto > 0 || c.sinPrecioDeVenta) && (
          <span className="mt-1 flex flex-wrap gap-1">
            {c.costoIncompleto > 0 && (
              <Insignia tono="aviso" title="Hay salidas sin precio, horas sin costo o líneas en dólares sin cambio: el costo todavía va a subir.">
                Costo incompleto
              </Insignia>
            )}
            {c.sinPrecioDeVenta && (
              <Insignia tono="aviso" title="Su cotización no tiene monto o va en otra moneda: el costo se reparte entre sus facturas por lo facturado hasta hoy.">
                Sin precio de venta
              </Insignia>
            )}
          </span>
        )}
        <DetalleEnTelefono>
          <span className="tabular block text-xs text-texto-suave">Facturado: {moneda(c.ingreso)}{c.usdSinCambio > 0 && ` + ${moneda(c.usdSinCambio, 'USD')} sin cambio`}</span>
          <span className="tabular block text-xs text-texto-suave">
            Costo: {moneda(c.costo)} ({porcentaje(c.parteDelCosto * 100)} de {moneda(c.costoDelCodigo)})
          </span>
        </DetalleEnTelefono>
      </TD>
      <TD className="tabular hidden text-right sm:table-cell">{facturado}</TD>
      <TD className="tabular hidden text-right sm:table-cell">{costo}</TD>
      <TD className="tabular text-right">
        {c.ganancia === null ? (
          <Insignia tono="aviso" className="ml-auto flex w-fit">
            Sin cambio
          </Insignia>
        ) : (
          <>
            <span className={cn('font-semibold whitespace-nowrap', c.ganancia < 0 ? 'text-peligro' : 'text-texto')}>{moneda(c.ganancia)}</span>
            {c.ingreso > 0 && <span className="block text-xs text-texto-suave">{porcentaje(parteDe(c.ganancia, c.ingreso))}</span>}
          </>
        )}
      </TD>
    </TR>
  )
}

function Renglon({
  rotulo,
  valor,
  dato,
  pie,
  fuerte,
  destacada,
}: {
  rotulo: string
  valor: number
  dato: string
  pie?: string
  fuerte?: boolean
  destacada?: boolean
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 px-4 py-3', destacada && 'bg-acento-suave')} data-renglon={dato}>
      <dt className={cn(fuerte ? 'font-semibold text-texto' : 'text-texto-suave')}>
        {rotulo}
        {pie && <span className="block text-xs font-normal text-texto-suave">{pie}</span>}
      </dt>
      <dd className={cn('tabular whitespace-nowrap', fuerte && 'text-base font-semibold', valor < 0 && fuerte ? 'text-peligro' : 'text-texto')}>{moneda(valor)}</dd>
    </div>
  )
}

/**
 * Lo que se resta, con su signo: el gasto de 50 sale «S/ -50.00» y una nota de
 * crédito que lo deja en -5 sale «S/ 5.00», porque suma. Sin el `|| 0`, el cero
 * salía «S/ -0.00».
 */
const restado = (v: number) => -v || 0

type Parte = { clave: string; etiqueta: string; porque?: string; gasto: GastoDelPeriodo }

/** Un renglón que resta, con sus partes debajo: cada área, cada grupo o cada cosa sin repartir. */
function Bloque({
  rotulo,
  valor,
  dato,
  partes,
  vacio,
  enlace,
}: {
  rotulo: string
  valor: number
  dato: string
  partes: Parte[]
  vacio: string
  enlace?: { href: string; texto: string } | null
}) {
  const sinCambio = partes.reduce((s, x) => s + x.gasto.lineasSinCambio, 0)
  return (
    <div className="space-y-2 px-4 py-3" data-renglon={dato}>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-texto-suave">{rotulo}</dt>
        <dd className="tabular whitespace-nowrap text-texto">{moneda(restado(valor))}</dd>
      </div>
      {partes.length === 0 ? (
        <dd className="text-xs text-texto-suave">{vacio}</dd>
      ) : (
        <dd>
          <ul className="space-y-1 border-l-2 border-borde pl-3 text-xs">
            {partes.map((x) => (
              <li key={x.clave} className="flex items-baseline justify-between gap-4" data-parte={x.clave}>
                <span className="min-w-0 text-texto-suave">
                  {x.etiqueta}
                  {x.porque && <span className="block text-pretty text-texto-tenue">{x.porque}</span>}
                </span>
                <span className="tabular whitespace-nowrap text-texto">{moneda(restado(x.gasto.soles))}</span>
              </li>
            ))}
          </ul>
        </dd>
      )}
      {sinCambio > 0 && (
        <dd className="text-xs text-aviso">{plural(sinCambio, 'línea en dólares todavía no suma', 'líneas en dólares todavía no suman')}: falta el cambio de su día.</dd>
      )}
      {enlace && (
        <dd>
          <Link href={enlace.href} className="text-xs font-medium text-acento hover:underline">
            {enlace.texto}
          </Link>
        </dd>
      )}
    </div>
  )
}
