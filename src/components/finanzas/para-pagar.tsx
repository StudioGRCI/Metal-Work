import { FileText, Landmark } from 'lucide-react'

import type { CodigoMoneda } from '@/lib/format'

/**
 * Un documento que Tesorería mira antes de pagar: la OC, la factura, la boleta,
 * el contrato. `descarga`, para el PDF que arma la aplicación (la OC): viene como
 * adjunto del mismo dominio, y en otra pestaña solo deja una pestaña en blanco.
 */
export type DocumentoParaPagar = { clave: string; etiqueta: string; url: string | null; descarga?: boolean }
/** Una cuenta activa del proveedor, como la registró Logística en Proveedores. */
export type CuentaParaTransferir = { id: string; banco: string; numero_cuenta: string; titular: string; moneda: string }

/**
 * Lo que Tesorería mira para saber cuánto y a dónde pagar (DKS, 20/10: «visualizar
 * la OC y la factura para ver cuánto pagar, aparte de la cuenta de banco»): los
 * documentos, que se abren en otra pestaña, y las cuentas del proveedor, la de la
 * moneda del documento primero. Va en la tarjeta y dentro de la ventana del pago.
 *
 * `sinCuentas` dice por qué no hay cuentas; sin él, y sin cuentas, no se pinta
 * esa parte (quien no tiene `proveedores.ver_cuentas` no las recibe).
 */
export function ParaPagar({
  documentos,
  cuentas,
  monedaDocumento,
  sinCuentas,
}: {
  documentos: DocumentoParaPagar[]
  cuentas: CuentaParaTransferir[]
  monedaDocumento: CodigoMoneda
  sinCuentas?: string | null
}) {
  const ordenadas = [...cuentas].sort((a, b) => Number(b.moneda === monedaDocumento) - Number(a.moneda === monedaDocumento))
  if (documentos.length === 0 && ordenadas.length === 0 && !sinCuentas) return null
  return (
    <div className="space-y-1.5 rounded-[var(--radius-base)] bg-superficie-2 p-2 text-xs text-texto-suave" data-para-pagar>
      {documentos.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {documentos.map((d) => (
            <li key={d.clave}>
              {d.url ? (
                <a
                  href={d.url}
                  {...(d.descarga ? { download: '' } : { target: '_blank', rel: 'noreferrer' })}
                  className="inline-flex min-h-11 items-center gap-1 font-medium text-acento hover:underline sm:min-h-0"
                >
                  <FileText aria-hidden className="size-3.5 shrink-0" />
                  <span>{d.etiqueta}</span>
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 text-texto">
                  <FileText aria-hidden className="size-3.5 shrink-0" />
                  <span>{d.etiqueta}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {ordenadas.length > 0 ? (
        <ul className="space-y-0.5" aria-label="Cuentas del proveedor">
          {ordenadas.map((c) => (
            <li key={c.id} className="flex items-start gap-1.5">
              <Landmark aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {c.banco} · <span className="tabular text-texto">{c.numero_cuenta}</span> · {c.moneda === 'USD' ? 'dólares' : 'soles'} · {c.titular}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        sinCuentas && (
          <p className="flex items-start gap-1.5">
            <Landmark aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{sinCuentas}</span>
          </p>
        )
      )}
    </div>
  )
}
