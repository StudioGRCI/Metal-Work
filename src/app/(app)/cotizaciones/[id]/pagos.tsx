'use client'

import { CalendarCheck, Plus, Wallet } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { PagoCliente, ResumenPagos } from '@/lib/datos/pagos'
import { fecha as fmtFecha, hoyLima, moneda as fmtMoneda } from '@/lib/format'

import { registrarPago } from './acciones-pagos'

const TIPOS = [
  { valor: 'ADELANTO', etiqueta: 'Adelanto' },
  { valor: 'PARCIAL', etiqueta: 'Pago parcial' },
  { valor: 'SALDO', etiqueta: 'Saldo' },
]

const MEDIOS = [
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
  { valor: 'DEPOSITO', etiqueta: 'Depósito' },
  { valor: 'CHEQUE', etiqueta: 'Cheque' },
  { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
  { valor: 'LETRA', etiqueta: 'Letra' },
  { valor: 'OTRO', etiqueta: 'Otro' },
]

const etiqueta = (lista: { valor: string; etiqueta: string }[], valor: string) =>
  lista.find((x) => x.valor === valor)?.etiqueta ?? valor

/**
 * Los pagos del cliente contra esta cotización.
 *
 * El número que importa no es cuánto se pagó sino **desde cuándo corre el
 * plazo**: la casa cobra «50 % de adelanto y lo demás a la entrega», y el taller
 * no empieza hasta que entra ese adelanto. Por eso el primer pago sella la fecha
 * de arranque y las catorce etapas de la orden se reprograman desde ahí, sin que
 * nadie tenga que ir a moverlas.
 */
export function PagosDelCliente({
  cotizacionId,
  pagos,
  resumen,
  puedeRegistrar,
}: {
  cotizacionId: string
  pagos: PagoCliente[]
  resumen: ResumenPagos | null
  /** `pagos.registrar`: Tesorería y Administración. */
  puedeRegistrar: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const money = (v: number | null | undefined) =>
    fmtMoneda(Number(v ?? 0), resumen?.moneda ?? 'PEN')

  async function enviar(datos: FormData) {
    if (enviando) return
    setError(null)
    setEnviando(true)
    const resultado = await registrarPago(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setAbierto(false)
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Pagos del cliente"
        descripcion="Lo que el cliente ya pagó de esta cotización. El primer pago es el que arranca el plazo de fabricación."
        acciones={
          puedeRegistrar && !abierto ? (
            <Boton variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>
              <Plus aria-hidden className="size-3.5" />
              Registrar pago
            </Boton>
          ) : null
        }
      />

      <TarjetaCuerpo className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-texto-suave">Pagado</p>
            <p className="text-2xl font-semibold tabular text-texto">{money(resumen?.pagado)}</p>
            {resumen?.precio_venta ? (
              <p className="text-[11px] text-texto-suave">de {money(resumen.precio_venta)}</p>
            ) : (
              <p className="text-[11px] text-texto-suave">la cotización no tiene precio puesto</p>
            )}
          </div>
          <div>
            <p className="text-xs text-texto-suave">Saldo</p>
            <p className="text-2xl font-semibold tabular text-texto">{money(resumen?.saldo)}</p>
            <p className="text-[11px] text-texto-suave">
              {resumen?.pagos ? `${resumen.pagos} pago(s) registrados` : 'todavía no pagó nada'}
            </p>
          </div>
          <div>
            <p className="text-xs text-texto-suave">El plazo corre desde</p>
            {resumen?.plazo_arranca_en ? (
              <>
                <p className="flex items-center gap-1.5 text-lg font-semibold text-exito">
                  <CalendarCheck aria-hidden className="size-4" />
                  {fmtFecha(resumen.plazo_arranca_en)}
                </p>
                <p className="text-[11px] text-texto-suave">lo selló el primer pago</p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-texto-tenue">sin arrancar</p>
                <p className="text-[11px] text-texto-suave">
                  el taller cuenta desde que entra el adelanto
                </p>
              </>
            )}
          </div>
        </div>

        {resumen?.pagado_pct != null && <Progreso valor={Math.min(resumen.pagado_pct, 100)} />}

        {abierto && puedeRegistrar && (
          <form action={enviar} className="grid gap-3 rounded-[var(--radius-base)] bg-superficie-2 p-3 sm:grid-cols-6">
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />

            <Campo etiqueta="Qué pago es" htmlFor="pg-tipo">
              <Seleccion id="pg-tipo" name="tipo" defaultValue="ADELANTO">
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo etiqueta="Fecha" htmlFor="pg-fecha" requerido ayuda="El día que entró">
              <Entrada id="pg-fecha" name="fecha" type="date" required defaultValue={hoyLima()} />
            </Campo>

            <Campo etiqueta="Monto" htmlFor="pg-monto" requerido>
              <Entrada
                id="pg-monto"
                name="monto"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                required
                className="tabular"
              />
            </Campo>

            <Campo etiqueta="Medio" htmlFor="pg-medio">
              <Seleccion id="pg-medio" name="medio" defaultValue="TRANSFERENCIA">
                {MEDIOS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.etiqueta}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo
              etiqueta="N.º de operación"
              htmlFor="pg-referencia"
              ayuda="Para cruzarlo con el extracto"
              className="sm:col-span-2"
            >
              <Entrada id="pg-referencia" name="referencia" placeholder="OP-000123" />
            </Campo>

            <Campo etiqueta="Observación" htmlFor="pg-obs" className="sm:col-span-6">
              <Entrada id="pg-obs" name="observaciones" placeholder="Opcional" />
            </Campo>

            {error && (
              <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro sm:col-span-6">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 sm:col-span-6">
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierto(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" tamano="sm" cargando={enviando}>
                <Wallet aria-hidden className="size-4" />
                Registrar el pago
              </Boton>
            </div>
          </form>
        )}

        {pagos.length === 0 ? (
          <p className="text-sm text-texto-suave">
            {puedeRegistrar
              ? 'Todavía no hay pagos. El primero que se registre arranca el plazo de fabricación.'
              : 'Todavía no hay pagos registrados.'}
          </p>
        ) : (
          <Tabla>
            <TablaCabecera>
              <TR>
                <TH>Fecha</TH>
                <TH>Qué</TH>
                <TH>Medio</TH>
                <TH>N.º operación</TH>
                <TH className="text-right">Monto</TH>
                <TH>Lo anotó</TH>
              </TR>
            </TablaCabecera>
            <tbody>
              {pagos.map((p, i) => (
                <TR key={p.id}>
                  <TD className="whitespace-nowrap text-sm">
                    {fmtFecha(p.fecha)}
                    {i === 0 && (
                      <Insignia tono="exito" className="ml-2">
                        arrancó el plazo
                      </Insignia>
                    )}
                  </TD>
                  <TD className="text-sm">{etiqueta(TIPOS, p.tipo)}</TD>
                  <TD className="text-sm text-texto-suave">{etiqueta(MEDIOS, p.medio)}</TD>
                  <TD className="text-xs text-texto-suave">{p.referencia ?? '—'}</TD>
                  <TD className="text-right tabular text-sm font-medium">{money(p.monto)}</TD>
                  <TD className="text-xs text-texto-suave">
                    {p.registrado ? `${p.registrado.nombres} ${p.registrado.apellidos}` : '—'}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Tabla>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
