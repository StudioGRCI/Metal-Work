'use client'

import { Ban, Wallet } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoSubcontrato } from '@/lib/archivos-subcontratos'
import { MAXIMO_MB_SUBCONTRATOS } from '@/lib/dominio/subcontratos'
import { useEnvio } from '@/lib/envio'
import { fecha, moneda } from '@/lib/format'

import { anularPagoRecibo, registrarPagoRecibo } from './acciones'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/** El archivo del campo, o `null` si no eligieron ninguno. Se saca del FormData: a la acción viaja solo su ruta. */
function sacarArchivo(datos: FormData): File | null {
  const archivo = datos.get('archivo')
  datos.delete('archivo')
  return archivo instanceof File && archivo.size > 0 ? archivo : null
}

type ReciboAPagar = {
  id: string
  numero: string
  subcontratoId: string
  subcontratista: string
  fechaEmision: string
  neto: number
  moneda: 'PEN' | 'USD'
}

/**
 * Tesorería paga el neto de un recibo y adjunta el voucher. El voucher sube
 * primero a Storage y, si el pago no entra, se retira.
 */
export function PagarRecibo({ recibo, hoy }: { recibo: ReciboAPagar; hoy: string }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-pagar-recibo={recibo.numero}
      >
        <Wallet aria-hidden className="size-4" />
        Registrar pago
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Pagar el recibo ${recibo.numero}`}
        descripcion={`${recibo.subcontratista}: se paga el neto, ${moneda(recibo.neto, recibo.moneda)}. Administración recibe el aviso y ve el voucher.`}
        ancho="sm"
      >
        <FormularioPago key={vez} recibo={recibo} hoy={hoy} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

function FormularioPago({ recibo, hoy, alTerminar }: { recibo: ReciboAPagar; hoy: string; alTerminar: () => void }) {
  // Decidido aquí: un reintento manda el mismo y la base no registra otro pago.
  const [id] = useState(() => crypto.randomUUID())

  async function pagar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarArchivo(datos)
    if (!archivo) return { ok: false, error: 'Adjunta el voucher del pago.' }
    return subirArchivoSubcontrato(recibo.subcontratoId, archivo, (ruta) => {
      datos.set('ruta', ruta)
      return registrarPagoRecibo(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(pagar, alTerminar)
  const prefijo = `pago-${id.slice(0, 8)}`

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="recibo_id" value={recibo.id} />
      <input type="hidden" name="subcontrato_id" value={recibo.subcontratoId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Día del pago" htmlFor={`${prefijo}-fecha`} requerido ayuda={`Desde el ${fecha(recibo.fechaEmision)}, fecha del recibo.`}>
          <Entrada id={`${prefijo}-fecha`} name="fecha_pago" type="date" required defaultValue={hoy} min={recibo.fechaEmision} max={hoy} />
        </Campo>
        <Campo etiqueta="N.º de operación" htmlFor={`${prefijo}-operacion`} ayuda="El que da el banco, si lo hay.">
          <Entrada id={`${prefijo}-operacion`} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
        </Campo>
      </div>
      <Campo etiqueta="Voucher" htmlFor={`${prefijo}-archivo`} requerido ayuda={`PDF o foto, hasta ${MAXIMO_MB_SUBCONTRATOS} MB.`}>
        <Entrada id={`${prefijo}-archivo`} name="archivo" type="file" accept={ACEPTA} required />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando}>
          Registrar el pago
        </Boton>
      </div>
    </form>
  )
}

/** Anular un pago mal registrado, con su motivo: el recibo vuelve a quedar por pagar. */
export function AnularPago({ pagoId, subcontratoId, numero }: { pagoId: string; subcontratoId: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularPagoRecibo, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="contornoPeligro" tamano="sm" onClick={() => setAbierta(true)} data-anular-pago={numero}>
        <Ban aria-hidden className="size-4" />
        Anular pago
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular el pago del recibo ${numero}`}
        descripcion="No se borra: queda con su motivo y su voucher, y el recibo vuelve a quedar por pagar. Administración recibe el aviso."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={pagoId} />
          <input type="hidden" name="subcontrato_id" value={subcontratoId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-pago-${pagoId}`} requerido>
            <AreaTexto id={`anular-pago-${pagoId}`} name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
