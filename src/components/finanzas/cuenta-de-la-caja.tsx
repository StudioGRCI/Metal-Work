'use client'

import { Landmark } from 'lucide-react'
import { useState } from 'react'

import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { nombreMoneda, type CuentaParaPagar } from '@/lib/dominio/caja'
import { fecha, type CodigoMoneda } from '@/lib/format'

type Tipo = 'pago' | 'cobro'

/**
 * La cuenta de la caja de la que salió un pago o a la que entró un cobro
 * (migración 20261019100000): al registrarlo, la caja diaria se mueve sola.
 * Si la cuenta es de otra moneda que el documento, pide además lo que salió o
 * entró en ella, como dice el estado de cuenta. Va dentro de la rejilla de dos
 * columnas del formulario, y la cuenta ocupa las dos.
 *
 * Con una sola cuenta activa la deja elegida; con varias no elige ninguna:
 * una cuenta puesta por omisión es la que se queda sin cambiar cuando era otra.
 * Debajo dice solo lo que pasa con el día elegido: si es de antes de que la
 * cuenta lleve la caja, o si ese día ya está cerrado.
 */
export function CuentaDeLaCaja({
  cuentas,
  monedaDocumento,
  tipo,
  dia,
  prefijo,
}: {
  cuentas: CuentaParaPagar[]
  monedaDocumento: CodigoMoneda
  tipo: Tipo
  /** El día del pago o del cobro que tiene escrito el formulario. */
  dia: string
  /** Para los id de los campos: puede haber varios formularios en la misma pantalla. */
  prefijo: string
}) {
  const [elegida, setElegida] = useState(cuentas.length === 1 ? cuentas[0].id : '')
  const cuenta = cuentas.find((c) => c.id === elegida)
  const otraMoneda = !!cuenta && cuenta.moneda !== monedaDocumento
  const cobro = tipo === 'cobro'
  const id = (nombre: string) => `${nombre}-${prefijo}`

  const antesDelInicio = !!cuenta && !!dia && dia < cuenta.fecha_inicio
  const diaCerrado = !!cuenta && !!dia && !antesDelInicio && !!cuenta.cerrada_hasta && dia <= cuenta.cerrada_hasta
  const ayuda = antesDelInicio
    ? `La cuenta lleva la caja desde el ${fecha(cuenta.fecha_inicio)}: este ${tipo} se registra sin moverla, porque ya está en su saldo inicial.`
    : cobro
      ? 'De la caja diaria: el ingreso entra solo, el día del cobro.'
      : 'De la caja diaria: el egreso sale solo, el día del pago.'
  const error = diaCerrado
    ? `La cuenta está cerrada hasta el ${fecha(cuenta.cerrada_hasta!)}: elige un día posterior o reabre ese cierre en Caja diaria.`
    : undefined

  return (
    <>
      {/* Las dos columnas: el nombre de la cuenta y su moneda se leen enteros, que es lo que distingue dos cuentas del mismo banco. */}
      <Campo
        etiqueta={cobro ? 'Cuenta a la que entró' : 'Cuenta de la que salió'}
        htmlFor={id('caja')}
        requerido
        ayuda={ayuda}
        ayudaEnIcono={false}
        error={error}
        className="sm:col-span-2"
      >
        <Seleccion
          id={id('caja')}
          name="caja_id"
          value={elegida}
          onChange={(e) => setElegida(e.target.value)}
          required
          disabled={cuentas.length === 0}
        >
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
            placeholder="0.00"
          />
        </Campo>
      )}
    </>
  )
}

/**
 * Arriba del formulario, cuando no hay de qué cuenta pagar: sin cuenta el pago
 * no se registra, así que se dice antes de que lo llenen. El botón de pagar
 * solo lo ve quien lleva la caja, que es quien da de alta sus cuentas.
 */
export function SinCuentasEnLaCaja({ cuentas, tipo }: { cuentas: CuentaParaPagar[]; tipo: Tipo }) {
  if (cuentas.length > 0) return null
  return (
    <div role="alert" className="space-y-3 rounded-[var(--radius-base)] bg-aviso-suave px-4 py-3 text-sm text-texto">
      <p>
        Cada {tipo} {tipo === 'cobro' ? 'entra a' : 'sale de'} una cuenta de la caja diaria, y todavía no hay ninguna activa. Da de alta la
        cuenta con su saldo inicial y vuelve a este {tipo}.
      </p>
      <EnlaceBoton href="/tesoreria/caja-diaria" variante="contorno" className="min-h-11">
        <Landmark aria-hidden className="size-4" />
        Ir a Caja diaria
      </EnlaceBoton>
    </div>
  )
}
