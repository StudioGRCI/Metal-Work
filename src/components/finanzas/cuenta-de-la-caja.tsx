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
 * (migración 20261017220000): al registrarlo, la caja diaria se mueve sola.
 * Si la cuenta es de otra moneda que el documento, pide además lo que salió o
 * entró en ella, como dice el estado de cuenta. Va dentro de la rejilla de dos
 * columnas del formulario.
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
  /** `null`: quien mira no lleva la caja. */
  cuentas: CuentaParaPagar[] | null
  monedaDocumento: CodigoMoneda
  tipo: Tipo
  /** El día del pago o del cobro que tiene escrito el formulario. */
  dia: string
  /** Para los id de los campos: puede haber varios formularios en la misma pantalla. */
  prefijo: string
}) {
  const lista = cuentas ?? []
  const [elegida, setElegida] = useState(lista.length === 1 ? lista[0].id : '')
  const cuenta = lista.find((c) => c.id === elegida)
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
      <Campo
        etiqueta={cobro ? 'Cuenta a la que entró' : 'Cuenta de la que salió'}
        htmlFor={id('caja')}
        requerido
        ayuda={ayuda}
        ayudaEnIcono={false}
        error={error}
      >
        <Seleccion
          id={id('caja')}
          name="caja_id"
          value={elegida}
          onChange={(e) => setElegida(e.target.value)}
          required
          disabled={lista.length === 0}
        >
          <option value="" disabled>
            {lista.length === 0 ? 'No hay cuentas en la caja' : 'Elige la cuenta…'}
          </option>
          {lista.map((c) => (
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
            placeholder={cuenta.moneda === 'USD' ? '1000.00' : '3750.00'}
          />
        </Campo>
      )}
    </>
  )
}

/**
 * Arriba del formulario, cuando no hay de qué cuenta pagar: sin cuenta el pago
 * no se registra, así que se dice antes de que lo llenen. Quien no lleva la caja
 * no puede darla de alta, y eso también se dice.
 */
export function SinCuentasEnLaCaja({ cuentas, tipo }: { cuentas: CuentaParaPagar[] | null; tipo: Tipo }) {
  if (cuentas && cuentas.length > 0) return null
  return (
    <div role="alert" className="space-y-3 rounded-[var(--radius-base)] bg-aviso-suave px-4 py-3 text-sm text-texto">
      {cuentas === null ? (
        <p>
          Cada {tipo} sale de una cuenta de la caja diaria, y tu cuenta no lleva la caja: pídele a Administración el permiso de la caja
          diaria.
        </p>
      ) : (
        <>
          <p>
            Cada {tipo} {tipo === 'cobro' ? 'entra a' : 'sale de'} una cuenta de la caja diaria, y todavía no hay ninguna activa. Da de alta la
            cuenta con su saldo inicial y vuelve a este {tipo}.
          </p>
          <EnlaceBoton href="/tesoreria/caja-diaria" variante="contorno" className="min-h-11">
            <Landmark aria-hidden className="size-4" />
            Ir a Caja diaria
          </EnlaceBoton>
        </>
      )}
    </div>
  )
}

/** Sin cuenta de dónde pagar, el botón de registrar no se ofrece activo. */
export function hayCuentas(cuentas: CuentaParaPagar[] | null) {
  return !!cuentas && cuentas.length > 0
}
