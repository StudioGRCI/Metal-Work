'use client'

import { useRef, useState } from 'react'

import { Campo, Entrada } from '@/components/ui/campos'
import { revisarArchivo } from '@/components/ui/elegir-archivo'
import { normalizarNumeroFactura } from '@/lib/dominio/finanzas'
import { avisosDeLaOrden, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { moneda as dinero, hoyLima } from '@/lib/format'
import { leerFactura } from '@/lib/leer-factura'

/**
 * El detector, del lado de Logística: lee la factura apenas se elige el PDF.
 * `leer` va en el `onChange` del campo del archivo; un archivo nuevo deja sin
 * efecto la lectura anterior que todavía no terminó. Devuelve lo leído (null si
 * no leyó nada o si otro archivo la reemplazó), para llenar el número y la fecha.
 *
 * Antes de leerlo se mira que sea lo que pide el campo (`accept`, `hastaMb`):
 * un Word con el nombre cambiado a «.pdf» no se lee y su motivo queda en
 * `aviso`. `aviso` y `leyendo` van al `aviso` y al `estado` del campo.
 * `soloRevisar` mira el archivo sin leerlo: el comprobante que no es factura.
 */
export function useDetectorDeFactura(accept: string, hastaMb: number) {
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [leyendo, setLeyendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const turno = useRef(0)
  async function leer(archivo: File | undefined, soloRevisar = false): Promise<LecturaFactura | null> {
    const vez = ++turno.current
    // Lo que diga una lectura que otro archivo ya reemplazó no llega al campo.
    const anotar = (texto: string | null) => {
      if (vez === turno.current) setLeyendo(texto)
    }
    setLectura(null)
    setAviso(null)
    anotar(null)
    if (!archivo) return null
    const motivo = await revisarArchivo(archivo, accept, hastaMb)
    if (vez !== turno.current) return null
    setAviso(motivo)
    if (motivo || soloRevisar) return null
    anotar('Leyendo la factura…')
    const leida = await leerFactura(archivo, anotar)
    if (vez !== turno.current) return null
    anotar(null)
    setLectura(leida)
    return leida
  }
  return { lectura, leyendo, aviso, leer }
}

/**
 * El número y la fecha de la factura que se anexa a la OC. El detector los llena
 * si están vacíos; lo que la persona ya escribió no se toca.
 */
export function useDatosDeFactura() {
  const [numero, setNumero] = useState('')
  const [fecha, setFecha] = useState('')
  function completar(lectura: LecturaFactura | null) {
    if (lectura?.numero) setNumero((n) => n || lectura.numero!)
    if (lectura?.fecha_emision && lectura.fecha_emision <= hoyLima()) setFecha((f) => f || lectura.fecha_emision!)
  }
  function vaciar() {
    setNumero('')
    setFecha('')
  }
  return { numero, setNumero, fecha, setFecha, completar, vaciar }
}

/** Lo que falta para anexar la factura; null si el número y la fecha están bien. */
export function faltaEnLaFactura(numero: string, fecha: string): string | null {
  if (!normalizarNumeroFactura(numero)) return 'Escribe el número de la factura con su serie y su número, como F001-123.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Escribe la fecha de la factura.'
  if (fecha > hoyLima()) return 'La fecha de la factura no puede ser posterior a hoy.'
  return null
}

/** Los dos campos de la factura que se anexa: van con el PDF y Contabilidad la registra con ellos. */
export function CamposDeLaFactura({
  id,
  datos,
  requerido,
  disabled,
}: {
  id: string
  datos: ReturnType<typeof useDatosDeFactura>
  requerido: boolean
  disabled?: boolean
}) {
  return (
    <>
      <Campo etiqueta="Número de la factura" htmlFor={`${id}-numero`} requerido={requerido} ayuda="Serie y número, como F001-123.">
        <Entrada
          id={`${id}-numero`}
          name="factura_numero"
          required={requerido}
          disabled={disabled}
          minLength={3}
          maxLength={40}
          autoComplete="off"
          placeholder="F001-123"
          className="tabular"
          value={datos.numero}
          onChange={(e) => datos.setNumero(e.target.value)}
        />
      </Campo>
      <Campo etiqueta="Fecha de la factura" htmlFor={`${id}-fecha`} requerido={requerido}>
        <Entrada
          id={`${id}-fecha`}
          name="factura_fecha"
          type="date"
          required={requerido}
          disabled={disabled}
          max={hoyLima()}
          value={datos.fecha}
          onChange={(e) => datos.setFecha(e.target.value)}
        />
      </Campo>
    </>
  )
}

/**
 * Lo que no calza entre la factura y su orden. Solo avisa: la orden se emite o
 * el PDF se adjunta igual. Mientras se lee calla: el «Leyendo…» va en el campo.
 */
export function AvisoFacturaDeLaOrden({
  lectura,
  total,
  moneda,
  numero,
  nombre,
  parcialPosible,
}: {
  lectura: LecturaFactura | null
  /** El total de la orden, con IGV si va con factura. */
  total: number | null
  moneda: string
  /** El número de la orden, si ya lo tiene; en la OC sin número, su referencia. */
  numero?: string | null
  /** Cómo se nombra en el aviso: «OC sin número (ref. del proveedor …)». */
  nombre?: string | null
  /** La OC puede ir en varias facturas: si el total no calza, se dice que puede ser una parte. */
  parcialPosible?: boolean
}) {
  if (!lectura) return null
  const avisos = avisosDeLaOrden({ lectura, total, moneda, numero, nombre }, (monto, m) => dinero(monto, m))
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
      <li className="text-texto-suave">
        Es solo un aviso: puedes seguir igual.
        {parcialPosible && ' Si la factura cubre solo una parte de la OC, adjúntala igual: Contabilidad la registra como parcial.'}
      </li>
    </ul>
  )
}
