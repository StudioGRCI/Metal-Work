'use client'

import { useRef, useState } from 'react'

import { avisosDeLaOrden, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { moneda as dinero } from '@/lib/format'
import { leerFactura } from '@/lib/leer-factura'

/**
 * El detector, del lado de Logística: lee la factura apenas se elige el PDF.
 * `leer` va en el `onChange` del campo del archivo; un archivo nuevo deja sin
 * efecto la lectura anterior que todavía no terminó.
 */
export function useDetectorDeFactura() {
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [leyendo, setLeyendo] = useState<string | null>(null)
  const turno = useRef(0)
  async function leer(archivo: File | undefined) {
    const vez = ++turno.current
    setLectura(null)
    if (!archivo) return setLeyendo(null)
    setLeyendo('Leyendo la factura…')
    const leida = await leerFactura(archivo, setLeyendo)
    if (vez !== turno.current) return
    setLeyendo(null)
    setLectura(leida)
  }
  return { lectura, leyendo, leer }
}

/** Lo que no calza entre la factura y su orden. Solo avisa: la orden se emite o el PDF se adjunta igual. */
export function AvisoFacturaDeLaOrden({
  lectura,
  leyendo,
  total,
  moneda,
  numero,
}: {
  lectura: LecturaFactura | null
  leyendo: string | null
  /** El total de la orden, con IGV si va con factura. */
  total: number | null
  moneda: string
  /** El número de la orden, si ya lo tiene. */
  numero?: string | null
}) {
  if (leyendo) {
    return (
      <p role="status" className="text-xs text-texto-suave">
        {leyendo}
      </p>
    )
  }
  if (!lectura) return null
  const avisos = avisosDeLaOrden({ lectura, total, moneda, numero }, (monto, m) => dinero(monto, m))
  if (avisos.length === 0) {
    if (lectura.total === null) return null
    const leido = dinero(lectura.total, lectura.moneda ?? (moneda === 'USD' ? 'USD' : 'PEN'))
    // Sin el total de la orden no hay con qué comparar: solo se dice lo leído.
    return total !== null && total > 0 ? (
      <p className="text-xs text-exito">La factura dice {leido}: calza con la orden.</p>
    ) : (
      <p className="text-xs text-texto-suave">La factura dice {leido}.</p>
    )
  }
  return (
    <ul role="status" className="space-y-0.5 text-xs text-aviso">
      {avisos.map((a) => (
        <li key={a}>{a}</li>
      ))}
      <li className="text-texto-suave">Es solo un aviso: puedes seguir igual.</li>
    </ul>
  )
}
