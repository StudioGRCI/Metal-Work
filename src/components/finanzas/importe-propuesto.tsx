'use client'

import { useState, type ComponentProps } from 'react'

import { Entrada } from '@/components/ui/campos'

/**
 * El importe que propone una ventana de pago: el saldo. Si se abrió antes de
 * que la pantalla se pusiera al día, el saldo nuevo cambia el propuesto, pero
 * no lo que la persona ya escribió: con `key={saldo}` el refresco tardío lo
 * borraba y un pago a cuenta salía por el saldo entero (decimoquinta pasada).
 */
export function ImportePropuesto({ saldo, ...props }: { saldo: number } & Omit<ComponentProps<typeof Entrada>, 'value' | 'defaultValue' | 'onChange'>) {
  const propuesto = saldo > 0 ? saldo.toFixed(2) : ''
  const [monto, setMonto] = useState(propuesto)
  const [visto, setVisto] = useState(propuesto)
  if (visto !== propuesto) {
    setVisto(propuesto)
    if (monto === visto) setMonto(propuesto)
  }
  return <Entrada {...props} value={monto} onChange={(e) => setMonto(e.target.value)} />
}
