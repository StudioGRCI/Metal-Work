'use client'

import { Ban, CheckCheck, FileUp, Wallet } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoPlanilla } from '@/lib/archivos-planilla'
import { MAXIMO_MB_PLANILLA } from '@/lib/dominio/planilla-diaria'
import { useAccion, useEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'

import { anularPagoPlanilla, anularPlanillaDiaria, entregarBoletaPlanilla, registrarPagoPlanilla, subirBoletaPlanilla } from '../acciones'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/** El archivo del campo, o `null` si no eligieron ninguno. Se saca del FormData: a la acción viaja solo su ruta. */
function sacarArchivo(datos: FormData): File | null {
  const archivo = datos.get('archivo')
  datos.delete('archivo')
  return archivo instanceof File && archivo.size > 0 ? archivo : null
}

/**
 * Tesorería registra un pago: marca a quién le pagó (una persona o varias en
 * lote), el día, el número de operación y el comprobante. El comprobante sube
 * primero a Storage y, si el pago no entra, se retira.
 */
export function RegistrarPago({
  planillaId,
  pagoId,
  hoy,
  porPagar,
}: {
  planillaId: string
  pagoId: string
  hoy: string
  porPagar: { id: string; nombre: string; total: number }[]
}) {
  const [abierta, setAbierta] = useState(false)
  const [marcadas, setMarcadas] = useState<string[]>(() => porPagar.map((p) => p.id))
  const total = porPagar.filter((p) => marcadas.includes(p.id)).reduce((n, p) => n + p.total, 0)

  async function pagar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarArchivo(datos)
    if (!archivo) return { ok: false, error: 'Adjunta el comprobante del pago.' }
    if (marcadas.length === 0) return { ok: false, error: 'Marca a quién le pagaste.' }
    return subirArchivoPlanilla(planillaId, archivo, (ruta) => {
      datos.set('ruta', ruta)
      return registrarPagoPlanilla(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(pagar, () => setAbierta(false))

  return (
    <>
      <Boton type="button" onClick={() => setAbierta(true)} data-registrar-pago>
        <Wallet aria-hidden className="size-4" />
        Registrar pago
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Registrar un pago"
        descripcion="Marca a quién le pagaste con esta operación: a una persona o a varias en lote, con un solo comprobante."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={pagoId} />
          <input type="hidden" name="planilla_id" value={planillaId} />
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium text-texto">A quién le pagaste</legend>
            {porPagar.map((p) => (
              <label key={p.id} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-borde px-3 py-2">
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    name="personas"
                    value={p.id}
                    checked={marcadas.includes(p.id)}
                    onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)))}
                    className="size-5 accent-[var(--acento)]"
                  />
                  <span className="text-sm text-texto">{p.nombre}</span>
                </span>
                <span className="tabular text-sm text-texto">{moneda(p.total)}</span>
              </label>
            ))}
            <p className="pt-1 text-right text-sm font-medium text-texto">
              Total marcado: <span className="tabular">{moneda(total)}</span>
            </p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Día del pago" htmlFor={`pago-fecha-${pagoId}`} requerido>
              <Entrada id={`pago-fecha-${pagoId}`} name="fecha_pago" type="date" required defaultValue={hoy} max={hoy} />
            </Campo>
            <Campo etiqueta="N.º de operación" htmlFor={`pago-operacion-${pagoId}`} ayuda="El que da el banco, si lo hay.">
              <Entrada id={`pago-operacion-${pagoId}`} name="operacion" maxLength={60} autoComplete="off" className="tabular" />
            </Campo>
          </div>
          <Campo etiqueta="Comprobante" htmlFor={`pago-archivo-${pagoId}`} requerido ayuda={`PDF o foto, hasta ${MAXIMO_MB_PLANILLA} MB.`}>
            <Entrada id={`pago-archivo-${pagoId}`} name="archivo" type="file" accept={ACEPTA} required />
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
            <Boton type="submit" cargando={enviando} disabled={marcadas.length === 0}>
              Registrar el pago
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Tesorería adjunta (o cambia, mientras no se entregue) la boleta de pago de una persona. */
export function SubirBoleta({ planillaId, personaId, nombre, cambiar }: { planillaId: string; personaId: string; nombre: string; cambiar: boolean }) {
  const [abierta, setAbierta] = useState(false)

  async function subir(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarArchivo(datos)
    if (!archivo) return { ok: false, error: 'Elige la boleta.' }
    return subirArchivoPlanilla(planillaId, archivo, (ruta) => {
      datos.set('ruta', ruta)
      return subirBoletaPlanilla(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(subir, () => setAbierta(false))

  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={() => setAbierta(true)} data-subir-boleta={personaId}>
        <FileUp aria-hidden className="size-4" />
        {cambiar ? 'Cambiar boleta' : 'Adjuntar boleta'}
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`Boleta de pago de ${nombre}`} ancho="sm">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="persona_id" value={personaId} />
          <input type="hidden" name="planilla_id" value={planillaId} />
          <Campo etiqueta="Boleta" htmlFor={`boleta-${personaId}`} requerido ayuda={`PDF o foto, hasta ${MAXIMO_MB_PLANILLA} MB.`}>
            <Entrada id={`boleta-${personaId}`} name="archivo" type="file" accept={ACEPTA} required />
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
            <Boton type="submit" cargando={enviando}>
              Adjuntar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** RR. HH. marca que ya le entregó la boleta a la persona. */
export function EntregarBoleta({ planillaId, personaId }: { planillaId: string; personaId: string }) {
  const { ejecutar, enviando, error } = useAccion(entregarBoletaPlanilla)
  return (
    <div>
      <Boton
        type="button"
        variante="secundario"
        tamano="sm"
        cargando={enviando}
        onClick={() => {
          const datos = new FormData()
          datos.set('persona_id', personaId)
          datos.set('planilla_id', planillaId)
          ejecutar(datos)
        }}
        data-entregar-boleta={personaId}
      >
        <CheckCheck aria-hidden className="size-4" />
        Entregué la boleta
      </Boton>
      {error && (
        <p role="alert" className="mt-1 text-xs text-peligro">
          {error}
        </p>
      )}
    </div>
  )
}

/** Anular con su motivo: la planilla (RR. HH., sin pagos) o un pago (Tesorería). */
export function AnularConMotivo({
  tipo,
  id,
  planillaId,
  titulo,
  descripcion,
}: {
  tipo: 'planilla' | 'pago'
  id: string
  planillaId: string
  titulo: string
  descripcion: string
}) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(tipo === 'planilla' ? anularPlanillaDiaria : anularPagoPlanilla, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="contornoPeligro" tamano="sm" onClick={() => setAbierta(true)} data-anular={tipo}>
        <Ban aria-hidden className="size-4" />
        {tipo === 'planilla' ? 'Anular planilla' : 'Anular pago'}
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={titulo} descripcion={descripcion} ancho="md">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="planilla_id" value={planillaId} />
          <Campo etiqueta="Motivo" htmlFor={`anular-${tipo}-${id}`} requerido>
            <AreaTexto id={`anular-${tipo}-${id}`} name="motivo" required minLength={10} maxLength={500} />
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
