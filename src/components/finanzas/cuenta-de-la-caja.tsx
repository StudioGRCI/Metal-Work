'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { nombreMoneda, type CuentaParaPagar } from '@/lib/dominio/caja'
import { fecha, type CodigoMoneda } from '@/lib/format'

/**
 * La cuenta de la caja de la que salió un pago o a la que entró un cobro
 * (migración 20261017220000): al registrarlo, la caja diaria se mueve sola.
 * Si la cuenta es de otra moneda que el documento, pide además lo que salió o
 * entró en ella, como dice el estado de cuenta. Va dentro de la rejilla de dos
 * columnas del formulario.
 *
 * Con una sola cuenta activa la deja elegida; con varias no elige ninguna:
 * una cuenta puesta por omisión es la que se queda sin cambiar cuando era otra.
 */
export function CuentaDeLaCaja({
  cuentas,
  monedaDocumento,
  tipo,
  prefijo,
}: {
  cuentas: CuentaParaPagar[]
  monedaDocumento: CodigoMoneda
  tipo: 'pago' | 'cobro'
  /** Para los id de los campos: puede haber varios formularios en la misma pantalla. */
  prefijo: string
}) {
  const [elegida, setElegida] = useState(cuentas.length === 1 ? cuentas[0].id : '')
  const cuenta = cuentas.find((c) => c.id === elegida)
  const otraMoneda = !!cuenta && cuenta.moneda !== monedaDocumento
  const cobro = tipo === 'cobro'
  const id = (nombre: string) => `${nombre}-${prefijo}`

  const notas = cuenta
    ? [
        `Empieza el ${fecha(cuenta.fecha_inicio)}: un ${tipo} de antes ya está en su saldo inicial y no la mueve.`,
        cuenta.cerrada_hasta && `Cerrada hasta el ${fecha(cuenta.cerrada_hasta)}: un ${tipo} de ese día o de antes no entra.`,
      ].filter(Boolean)
    : []

  return (
    <>
      <div className="space-y-1">
        <Campo
          etiqueta={cobro ? 'Cuenta a la que entró' : 'Cuenta de la que salió'}
          htmlFor={id('caja')}
          requerido
          ayuda={cobro ? 'De la caja diaria: el ingreso entra solo, el día del cobro.' : 'De la caja diaria: el egreso sale solo, el día del pago.'}
        >
          <Seleccion id={id('caja')} name="caja_id" value={elegida} onChange={(e) => setElegida(e.target.value)} required>
            <option value="" disabled>
              {cuentas.length === 0 ? 'No hay cuentas en la caja' : 'Elige la cuenta…'}
            </option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · {nombreMoneda(c.moneda)}
              </option>
            ))}
          </Seleccion>
        </Campo>
        {notas.length > 0 && <p className="text-xs text-texto-suave">{notas.join(' ')}</p>}
        {cuentas.length === 0 && (
          <p role="alert" className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-texto">
            Todavía no hay cuentas activas. Da de alta la cuenta, con su saldo inicial, en{' '}
            <Link href="/tesoreria/caja-diaria" className="font-medium text-acento underline underline-offset-2">
              Caja diaria
            </Link>
            .
          </p>
        )}
      </div>
      {otraMoneda && cuenta && (
        <Campo
          etiqueta={`Lo que ${cobro ? 'entró a' : 'salió de'} la cuenta, en ${nombreMoneda(cuenta.moneda)}`}
          htmlFor={id('monto-cuenta')}
          requerido
          ayuda={`Como dice el estado de cuenta. El documento queda ${cobro ? 'cobrado' : 'pagado'} en ${nombreMoneda(monedaDocumento)}.`}
        >
          <Entrada
            id={id('monto-cuenta')}
            name="monto_cuenta"
            inputMode="decimal"
            required
            autoComplete="off"
            className="tabular"
            placeholder={cuenta.moneda === 'USD' ? '1000.00' : '3750.00'}
          />
        </Campo>
      )}
    </>
  )
}
