import { ChevronLeft, ChevronRight, FileImage } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { BASE_BOTON, Boton, TAMANOS, VARIANTES } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { DetalleEnTelefono, SinDatos, Tabla, TablaCabecera, TD, TH, TR } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { historiaDeCierres, type CierreDeLaHistoria } from '@/lib/datos/caja'
import { enlaceCaptura, monedaDeCuenta } from '@/lib/dominio/caja'
import { fecha, fechaHora, hoyLima, mesLargo, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Días cerrados de la caja' }

const RUTA = '/tesoreria/caja-diaria/cierres'
/** El primer mes que se puede pedir: antes no hay caja (la de la caja diaria empieza en 2020). */
const PRIMER_MES = '2020-01'

/** El mes de la URL (`2026-11`), si es uno de verdad y no es futuro; si no, el de hoy. */
function mesPedido(texto: string | string[] | undefined, hoy: string) {
  const m = typeof texto === 'string' ? texto : ''
  const actual = hoy.slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || m > actual || m < PRIMER_MES) return actual
  return m
}
function otroMes(mes: string, n: number) {
  const d = new Date(`${mes}-15T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 7)
}
function ultimoDia(mes: string) {
  const d = new Date(`${otroMes(mes, 1)}-01T12:00:00Z`)
  d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}
const enlaceMes = (mes: string, hoy: string) => (mes === hoy.slice(0, 7) ? RUTA : `${RUTA}?mes=${mes}`)

/**
 * La historia del cierre de caja (plan 11, entrega 11.3): los días que se
 * cerraron en el mes, de cada cuenta, con quién lo cerró y a qué hora, el saldo
 * que daba el sistema, el del estado de cuenta y la diferencia. Solo se lee:
 * un cierre no se corrige ni se borra; el último de una cuenta se reabre con
 * motivo en la caja diaria, y aquí queda abajo, con quién, cuándo y por qué.
 * La ven quien lleva la caja y Gerencia (`tesoreria.ver_documentos`).
 */
export default async function PaginaDiasCerrados({ searchParams }: PageProps<'/tesoreria/caja-diaria/cierres'>) {
  const perfil = await exigirPermiso(['tesoreria.caja', 'tesoreria.ver_documentos'])
  const llevaLaCaja = puede(perfil, 'tesoreria.caja')
  const hoy = hoyLima()
  const mes = mesPedido((await searchParams).mes, hoy)
  const cierres = await historiaDeCierres(`${mes}-01`, ultimoDia(mes))
  const vigentes = cierres.filter((k) => !k.reabiertoEn)
  const reabiertos = cierres.filter((k) => k.reabiertoEn)
  const conDiferencia = vigentes.filter((k) => k.diferencia !== 0).length
  const dias = new Set(vigentes.map((k) => k.fecha)).size

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        titulo="Días cerrados de la caja"
        migas={llevaLaCaja ? [{ titulo: 'Caja diaria', ruta: '/tesoreria/caja-diaria' }, { titulo: 'Días cerrados' }] : undefined}
        descripcion={
          vigentes.length > 0
            ? `${mesLargo(mes)}: ${dias === 1 ? 'un día cerrado' : `${dias} días cerrados`}, ${vigentes.length === 1 ? 'un cierre' : `${vigentes.length} cierres`}${conDiferencia > 0 ? ` · ${conDiferencia === 1 ? 'uno no cuadra' : `${conDiferencia} no cuadran`} con el estado de cuenta` : ' · todos cuadran con el estado de cuenta'}.`
            : undefined
        }
        ayuda="Cada día que Tesorería cerró, cuenta por cuenta: el saldo del sistema contra el que decía el estado de cuenta del banco (o el conteo, en la caja chica). Solo se consulta: un cierre no se corrige ni se borra; el último se reabre con su motivo en la caja diaria."
        acciones={<SelectorDeMes mes={mes} hoy={hoy} />}
      />

      <Tarjeta>
        <TarjetaCabecera
          titulo={`Cierres de ${mesLargo(mes)}`}
          ayuda="Del día más reciente al más antiguo. La diferencia es el estado de cuenta menos el saldo del sistema; la captura es la del saldo con que se abrió la cuenta."
        />
        <TarjetaCuerpo className="p-0 sm:p-0">
          <Tabla apilada>
            <TablaCabecera>
              <tr>
                <TH>Día y cuenta</TH>
                <TH className="hidden text-right md:table-cell">Saldo del sistema</TH>
                <TH className="hidden text-right md:table-cell">Estado de cuenta</TH>
                <TH className="hidden text-right md:table-cell">Diferencia</TH>
                <TH className="hidden md:table-cell">Cerró</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {vigentes.length === 0 ? (
                <SinDatos
                  titulo={`No hay días cerrados en ${mesLargo(mes)}`}
                  descripcion="Aparecen cuando Tesorería cierra el día de una cuenta en la caja diaria, con el saldo de su estado de cuenta."
                />
              ) : (
                vigentes.map((k) => <FilaDeCierre key={k.id} cierre={k} />)
              )}
            </tbody>
          </Tabla>
        </TarjetaCuerpo>
      </Tarjeta>

      {reabiertos.length > 0 && (
        <SeccionDesplegable titulo={`Cierres reabiertos (${reabiertos.length})`}>
          <ul className="space-y-3" data-cierres-reabiertos>
            {reabiertos.map((k) => {
              const m = monedaDeCuenta(k.moneda)
              return (
                <li key={k.id} className="rounded-[var(--radius-base)] border border-borde p-3 text-sm" data-cierre={k.id}>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-texto">
                      {fecha(k.fecha)} · {k.cuenta}
                    </span>
                    <Insignia tono="neutro">Reabierto</Insignia>
                  </p>
                  <p className="mt-1 text-xs text-texto-suave">
                    Lo cerró {k.cerradoPor ?? '—'} el {fechaHora(k.cerradoEn)} con <span className="tabular">{moneda(k.saldoFinal, m)}</span> en el sistema y{' '}
                    <span className="tabular">{moneda(k.saldoBanco, m)}</span> en el estado de cuenta.
                  </p>
                  <p className="mt-1 text-xs text-texto">
                    Lo reabrió {k.reabiertoPor ?? '—'} el {fechaHora(k.reabiertoEn)}: «{k.motivoReapertura ?? '—'}»
                  </p>
                </li>
              )
            })}
          </ul>
        </SeccionDesplegable>
      )}
    </div>
  )
}

function FilaDeCierre({ cierre: k }: { cierre: CierreDeLaHistoria }) {
  const m = monedaDeCuenta(k.moneda)
  const cuadra = k.diferencia === 0
  const diferencia = (
    <span className={`tabular ${cuadra ? 'text-texto-suave' : 'font-semibold text-aviso'}`}>
      {cuadra ? 'Cuadra' : `${k.diferencia > 0 ? '+' : ''}${moneda(k.diferencia, m)}`}
    </span>
  )
  return (
    <TR data-cierre={k.id} data-diferencia={k.diferencia}>
      <TD>
        <p className="font-medium text-texto">
          <span className="tabular">{fecha(k.fecha)}</span> · {k.cuenta}
        </p>
        <p className="text-xs text-texto-suave">
          {k.tipo === 'EFECTIVO' ? 'Efectivo' : (k.banco ?? 'Banco')} · {m === 'USD' ? 'dólares' : 'soles'}
          {!k.cuentaActiva && ' · cuenta desactivada'}
        </p>
        {k.conCaptura && (
          <Link
            href={enlaceCaptura(k.cajaId)}
            target="_blank"
            prefetch={false}
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-acento hover:underline sm:min-h-0"
          >
            <FileImage aria-hidden className="size-3.5" />
            Captura del saldo de apertura
          </Link>
        )}
        {k.observaciones && <p className="mt-1 text-xs text-texto">Observaciones: {k.observaciones}</p>}
        {/* En el teléfono, las cifras y quién cerró debajo de la cuenta: la tabla se apila. */}
        <DetalleEnTelefono className="md:hidden sm:block">
          <p className="text-xs text-texto-suave">
            Sistema <span className="tabular text-texto">{moneda(k.saldoFinal, m)}</span> · estado de cuenta{' '}
            <span className="tabular text-texto">{moneda(k.saldoBanco, m)}</span>
          </p>
          <p className="text-xs">{diferencia}</p>
          <p className="text-xs text-texto-suave">
            Cerró {k.cerradoPor ?? '—'} el {fechaHora(k.cerradoEn)}
          </p>
        </DetalleEnTelefono>
      </TD>
      <TD className="hidden text-right tabular md:table-cell">{moneda(k.saldoFinal, m)}</TD>
      <TD className="hidden text-right tabular md:table-cell">{moneda(k.saldoBanco, m)}</TD>
      <TD className="hidden text-right md:table-cell">{diferencia}</TD>
      <TD className="hidden md:table-cell">
        <p className="text-texto">{k.cerradoPor ?? '—'}</p>
        <p className="text-xs text-texto-suave">{fechaHora(k.cerradoEn)}</p>
      </TD>
    </TR>
  )
}

function SelectorDeMes({ mes, hoy }: { mes: string; hoy: string }) {
  const anterior = otroMes(mes, -1)
  const siguiente = otroMes(mes, 1)
  return (
    <form method="get" action={RUTA} className="flex flex-wrap items-center gap-2">
      {/* Cada flecha guarda su sitio aunque no vaya, como en el selector de día: el segundo clic no cae en otro mando. */}
      {anterior >= PRIMER_MES ? (
        <EnlaceBoton href={enlaceMes(anterior, hoy)} variante="contorno" tamano="icono" aria-label="Mes anterior">
          <ChevronLeft aria-hidden className="size-4" />
        </EnlaceBoton>
      ) : (
        <Reservado />
      )}
      <label htmlFor="cierres-mes" className="sr-only">
        Mes
      </label>
      <Entrada key={mes} id="cierres-mes" type="month" name="mes" defaultValue={mes} min={PRIMER_MES} max={hoy.slice(0, 7)} className="w-auto" />
      <Boton type="submit" variante="secundario" tamano="sm">
        Ver
      </Boton>
      {siguiente <= hoy.slice(0, 7) ? (
        <EnlaceBoton href={enlaceMes(siguiente, hoy)} variante="contorno" tamano="icono" aria-label="Mes siguiente">
          <ChevronRight aria-hidden className="size-4" />
        </EnlaceBoton>
      ) : (
        <Reservado />
      )}
    </form>
  )
}

/** El sitio de una flecha que no va, del mismo tamaño e invisible. */
function Reservado() {
  return <span aria-hidden className={cn(BASE_BOTON, VARIANTES.contorno, TAMANOS.icono, 'invisible')} />
}
