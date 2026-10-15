import { Insignia } from '@/components/ui/etiqueta-estado'
import type { ControlDeFactura } from '@/lib/datos/adquisiciones'
import { avisosDelDetector, textoDelAviso, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { moneda } from '@/lib/format'

/**
 * Lo que el detector leyó de una factura ya registrada, frente a lo registrado y
 * a sus OC. Lo comparten Adquisiciones y Cuentas por pagar. Callado si calza.
 */
export function avisosDeFacturaRegistrada(
  factura: { lectura: LecturaFactura | null; total: number | string | null; moneda: string | null; numero_documento: string | null },
  control: ControlDeFactura | null,
): string[] {
  if (!factura.lectura) return []
  return avisosDelDetector({
    lectura: factura.lectura,
    total: factura.total === null ? null : Number(factura.total),
    moneda: factura.moneda ?? 'PEN',
    numero: factura.numero_documento ?? '',
    marcadas: control?.ordenes ?? [],
  }).map((a) => textoDelAviso(a, (monto, m) => moneda(monto, m), { registrada: true }))
}

/** La insignia del detector, al lado de la del monto. */
export function InsigniaDelDetector({ avisos }: { avisos: string[] }) {
  return avisos.length > 0 ? <Insignia tono="aviso">La factura dice otra cosa</Insignia> : null
}

/** Cada aviso del detector, en una línea. */
export function AvisosDelDetector({ avisos }: { avisos: string[] }) {
  if (avisos.length === 0) return null
  return (
    <ul className="text-xs text-aviso">
      {avisos.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  )
}
