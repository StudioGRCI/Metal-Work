import { ChevronLeft, ChevronRight, FileImage } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { BASE_BOTON, Boton, TAMANOS, VARIANTES } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { DetalleEnTelefono, SinDatos, Tabla, TablaCabecera, TD, TH, TR } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { historiaDeCierres, type CierreDeLaHistoria } from '@/lib/datos/caja'
import { enlaceCaptura, enlaceCapturaDelCierre, monedaDeCuenta } from '@/lib/dominio/caja'
import { fecha, fechaHora, hoyLima, mesLargo, moneda, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
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
/** El enlace a otro mes, con el filtro «No cuadran» puesto si estaba. */
function enlaceMes(mes: string, hoy: string, solo = false) {
  const q = new URLSearchParams()
  if (mes !== hoy.slice(0, 7)) q.set('mes', mes)
  if (solo) q.set('solo', 'diferencia')
  const t = q.toString()
  return t ? `${RUTA}?${t}` : RUTA
}

/**
 * La historia del cierre de caja (plan 11, entrega 11.3): los días que se
 * cerraron en el mes, de cada cuenta, con quién lo cerró y a qué hora, el saldo
 * que daba el sistema, el del estado de cuenta y la diferencia. Solo se lee:
 * un cierre no se corrige ni se borra; el último de una cuenta se reabre con
 * motivo en la caja diaria, y aquí queda abajo, con quién, cuándo y por qué.
 * La ven quien lleva la caja y Gerencia, que la consulta (`tesoreria.ver_caja`);
 * Costos no (StudioGRCI, 2026-11-26).
 */
export default async function PaginaDiasCerrados({ searchParams }: PageProps<'/tesoreria/caja-diaria/cierres'>) {
  await exigirPermiso(['tesoreria.caja', 'tesoreria.ver_caja'])
  const hoy = hoyLima()
  const pedido = await searchParams
  const mes = mesPedido(pedido.mes, hoy)
  const soloDiferencias = pedido.solo === 'diferencia'
  const cierres = await historiaDeCierres(`${mes}-01`, ultimoDia(mes))
  const vigentes = cierres.filter((k) => !k.reabiertoEn)
  const reabiertos = cierres.filter((k) => k.reabiertoEn)
  const conDiferencia = vigentes.filter((k) => k.diferencia !== 0).length
  const filas = soloDiferencias ? vigentes.filter((k) => k.diferencia !== 0) : vigentes
  const dias = new Set(vigentes.map((k) => k.fecha)).size

  return (
    <div className="space-y-5">
      <EncabezadoPagina
        titulo="Días cerrados de la caja"
        migas={[{ titulo: 'Caja diaria', ruta: '/tesoreria/caja-diaria' }, { titulo: 'Días cerrados' }]}
        descripcion={
          vigentes.length > 0
            ? `${mayuscula(mesLargo(mes))}: ${dias === 1 ? 'un día cerrado' : `${dias} días cerrados`}, ${vigentes.length === 1 ? 'un cierre' : `${vigentes.length} cierres`}${conDiferencia > 0 ? ` · ${conDiferencia === 1 ? 'uno no cuadra' : `${conDiferencia} no cuadran`} con el estado de cuenta` : ' · todos cuadran con el estado de cuenta'}.`
            : undefined
        }
        ayuda="Cada día que Tesorería cerró, cuenta por cuenta: el saldo del sistema contra el que decía el estado de cuenta del banco (o el conteo, en la caja chica), con su captura. Solo se consulta: un cierre no se corrige ni se borra; el último se reabre con su motivo en la caja diaria."
        acciones={<SelectorDeMes mes={mes} hoy={hoy} solo={soloDiferencias} />}
      />

      <Tarjeta>
        <TarjetaCabecera
          titulo={`Cierres de ${mesLargo(mes)}`}
          ayuda="Del día más reciente al más antiguo. La diferencia es el estado de cuenta (o el conteo, en la caja chica) menos el saldo del sistema. Desde el 26/11/2026 cada cierre guarda la captura de su día; los de antes no la tienen."
          acciones={
            conDiferencia > 0 || soloDiferencias ? (
              <PastillaFiltro
                ruta={RUTA}
                clave="solo"
                params={pedido}
                activo={soloDiferencias ? 'diferencia' : null}
                etiqueta="Todos los cierres o solo los que no cuadran"
                opciones={[
                  { valor: null, etiqueta: `Todos (${vigentes.length})` },
                  { valor: 'diferencia', etiqueta: `No cuadran (${conDiferencia})` },
                ]}
              />
            ) : undefined
          }
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
              {filas.length === 0 && vigentes.length > 0 ? (
                <SinDatos titulo={`Todos los cierres de ${mesLargo(mes)} cuadran con el estado de cuenta`} />
              ) : filas.length === 0 ? (
                <SinDatos
                  titulo={`No hay días cerrados en ${mesLargo(mes)}`}
                  descripcion="Aparecen cuando Tesorería cierra el día de una cuenta en la caja diaria, con el saldo de su estado de cuenta."
                  accion={
                    otroMes(mes, -1) >= PRIMER_MES ? (
                      <EnlaceBoton href={enlaceMes(otroMes(mes, -1), hoy, soloDiferencias)} variante="contorno" tamano="sm">
                        Ver {mesLargo(otroMes(mes, -1))}
                      </EnlaceBoton>
                    ) : undefined
                  }
                />
              ) : (
                filas.map((k) => <FilaDeCierre key={k.id} cierre={k} />)
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
                    {k.cerradoPor ? `Lo cerró ${k.cerradoPor}` : 'Se cerró'} el {fechaHora(k.cerradoEn)} con <span className="tabular">{moneda(k.saldoFinal, m)}</span> en el sistema y{' '}
                    <span className="tabular">{moneda(k.saldoBanco, m)}</span> en el estado de cuenta
                    {k.diferencia === 0 ? ' (cuadraba)' : <> (diferencia <span className="tabular">{conSigno(k.diferencia, m)}</span>)</>}.
                    {k.observaciones && ` Observaciones: ${k.observaciones}`}
                  </p>
                  {k.conCapturaDelDia && (
                    <EnlaceACaptura href={enlaceCapturaDelCierre(k.id)}>
                      {k.tipo === 'EFECTIVO' ? 'Foto del conteo de ese cierre' : 'Captura del estado de cuenta de ese cierre'}
                    </EnlaceACaptura>
                  )}
                  <p className="mt-1 text-xs text-texto">
                    {k.reabiertoPor ? `Lo reabrió ${k.reabiertoPor}` : 'Se reabrió'} el {fechaHora(k.reabiertoEn)}: «{k.motivoReapertura ?? '—'}»
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
  const diferencia = cuadra ? (
    <span className="text-texto-suave">Cuadra</span>
  ) : (
    <Insignia tono="aviso">
      <span className="tabular">{conSigno(k.diferencia, m)}</span>
    </Insignia>
  )
  const efectivo = k.tipo === 'EFECTIVO'
  return (
    <TR data-cierre={k.id} data-diferencia={k.diferencia}>
      <TD>
        <p className="font-medium text-texto">
          <span className="tabular">{fecha(k.fecha)}</span> · {k.cuenta}
        </p>
        <p className="text-xs text-texto-suave">
          {efectivo ? 'Efectivo' : (k.banco ?? 'Banco')} · {m === 'USD' ? 'dólares' : 'soles'}
          {!k.cuentaActiva && ' · cuenta desactivada'}
        </p>
        <CapturasDelCierre cierre={k} />
        {k.observaciones && <p className="mt-1 text-xs text-texto">Observaciones: {k.observaciones}</p>}
        {/* En el teléfono, las cifras y quién cerró debajo de la cuenta: la tabla se apila. */}
        <DetalleEnTelefono className="md:hidden sm:block">
          <p className="text-xs text-texto-suave">
            Sistema <span className="tabular text-texto">{moneda(k.saldoFinal, m)}</span> · {efectivo ? 'conteo' : 'estado de cuenta'}{' '}
            <span className="tabular text-texto">{moneda(k.saldoBanco, m)}</span>
          </p>
          <p className="flex items-center gap-2 text-xs text-texto-suave">Diferencia: {diferencia}</p>
          <p className="text-xs text-texto-suave">
            {k.cerradoPor ? `Cerró ${k.cerradoPor}` : 'Se cerró'} el {fechaHora(k.cerradoEn)}
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

/**
 * La captura del día, si el cierre la guardó (migración 20261126550000). Los de
 * antes no la tienen: se dice, y queda a mano la captura con que se abrió la
 * cuenta, que es otro saldo y otro día.
 */
function CapturasDelCierre({ cierre: k }: { cierre: CierreDeLaHistoria }) {
  const efectivo = k.tipo === 'EFECTIVO'
  if (k.conCapturaDelDia) {
    return (
      <EnlaceACaptura href={enlaceCapturaDelCierre(k.id)} data-captura-del-dia>
        {efectivo ? 'Foto del conteo de ese día' : 'Captura del estado de cuenta de ese día'}
      </EnlaceACaptura>
    )
  }
  return (
    <p className="mt-1 text-xs text-texto-suave">
      {efectivo ? 'Sin foto del conteo de ese día.' : 'Sin captura del día: se cerró antes de que se pidiera.'}
      {k.conCaptura && (
        <>
          {' '}
          <EnlaceACaptura href={enlaceCaptura(k.cajaId)} enLinea>
            {efectivo ? 'Ver la foto del conteo con que se abrió la cuenta' : 'Ver la captura con que se abrió la cuenta'}
          </EnlaceACaptura>
        </>
      )}
    </p>
  )
}

function EnlaceACaptura({ href, children, enLinea = false, ...resto }: { href: string; children: React.ReactNode; enLinea?: boolean; 'data-captura-del-dia'?: boolean }) {
  return (
    <Link
      href={href}
      target="_blank"
      prefetch={false}
      className={cn(
        'font-medium text-acento hover:underline',
        enLinea ? 'inline-flex min-h-11 items-center sm:min-h-0' : 'mt-1 inline-flex min-h-11 items-center gap-1.5 text-xs sm:min-h-0',
      )}
      {...resto}
    >
      {!enLinea && <FileImage aria-hidden className="size-3.5" />}
      {children}
    </Link>
  )
}

/** La diferencia con el signo antes del símbolo, como los movimientos de la caja: «+S/ 19.50», «−S/ 19.50». */
function conSigno(d: number, m: CodigoMoneda) {
  return `${d > 0 ? '+' : '−'}${moneda(Math.abs(d), m)}`
}

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function SelectorDeMes({ mes, hoy, solo }: { mes: string; hoy: string; solo: boolean }) {
  const anterior = otroMes(mes, -1)
  const siguiente = otroMes(mes, 1)
  return (
    <form method="get" action={RUTA} className="flex flex-wrap items-center gap-2">
      {/* Cada flecha guarda su sitio aunque no vaya, como en el selector de día: el segundo clic no cae en otro mando. */}
      {anterior >= PRIMER_MES ? (
        <EnlaceBoton href={enlaceMes(anterior, hoy, solo)} variante="contorno" tamano="icono" aria-label="Mes anterior">
          <ChevronLeft aria-hidden className="size-4" />
        </EnlaceBoton>
      ) : (
        <Reservado />
      )}
      {solo && <input type="hidden" name="solo" value="diferencia" />}
      <label htmlFor="cierres-mes" className="sr-only">
        Mes
      </label>
      <Entrada key={mes} id="cierres-mes" type="month" name="mes" defaultValue={mes} min={PRIMER_MES} max={hoy.slice(0, 7)} className="w-auto" />
      <Boton type="submit" variante="secundario" tamano="sm">
        Ver
      </Boton>
      {siguiente <= hoy.slice(0, 7) ? (
        <EnlaceBoton href={enlaceMes(siguiente, hoy, solo)} variante="contorno" tamano="icono" aria-label="Mes siguiente">
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
