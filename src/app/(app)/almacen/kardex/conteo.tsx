'use client'

import { ClipboardCheck } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { cantidad } from '@/lib/format'

import { registrarConteo } from '../../materiales/atencion/acciones'

export type MaterialParaContar = { id: string; codigo: string; descripcion: string; unidad: string | null; saldo: number }

/**
 * El conteo físico: lo que hay de verdad en el anaquel. La base guarda la
 * diferencia con el saldo registrado como un ajuste del kardex, con el motivo y
 * quién contó; el saldo no se escribe a mano.
 */
export function ConteoFisico({ materiales }: { materiales: MaterialParaContar[] }) {
  const [abierta, setAbierta] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())
  const [materialId, setMaterialId] = useState('')
  const [contado, setContado] = useState('')

  const { alEnviar, enviando, error, resultado } = useEnvio(registrarConteo, () => {
    setId(crypto.randomUUID())
    setMaterialId('')
    setContado('')
    setAbierta(false)
  })

  const elegido = materiales.find((m) => m.id === materialId)
  const diferencia = elegido && contado !== '' && Number.isFinite(Number(contado)) ? Number(contado) - elegido.saldo : null

  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierta(true)}>
        <ClipboardCheck aria-hidden className="size-4" />Conteo físico
      </Boton>
      {resultado?.ok && <p role="status" className="mt-2 text-sm text-exito">Conteo registrado en el kardex como ajuste.</p>}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Conteo físico"
        descripcion="Cuenta lo que hay en el almacén. La diferencia con el saldo registrado queda en el kardex como ajuste, con el motivo y quién contó."
      >
        <form key={id} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="operacion_id" value={id} />

          <Campo etiqueta="Material" htmlFor="conteo-material" requerido>
            <SeleccionBuscable
              id="conteo-material"
              name="material_id"
              requerido
              permiteVaciar={false}
              valor={materialId}
              onChange={setMaterialId}
              marcador="Elige el material"
              marcadorBusqueda="Código o descripción"
              opciones={materiales.map((m) => ({
                valor: m.id,
                etiqueta: m.descripcion,
                detalle: `${m.codigo} · registrado ${cantidad(m.saldo)} ${m.unidad ?? ''}`,
              }))}
            />
          </Campo>

          <Campo etiqueta={`Cantidad contada${elegido?.unidad ? ` (${elegido.unidad})` : ''}`} htmlFor="conteo-cantidad" requerido
            ayuda={elegido ? `Saldo registrado: ${cantidad(elegido.saldo)}` : undefined}>
            <Entrada id="conteo-cantidad" name="cantidad_fisica" type="number" inputMode="decimal" min={0} step="0.001" required
              value={contado} onChange={(e) => setContado(e.target.value)} />
          </Campo>
          {diferencia !== null && diferencia !== 0 && (
            <p className={`text-sm ${diferencia > 0 ? 'text-exito' : 'text-peligro'}`}>
              Quedará un ajuste de {diferencia > 0 ? '+' : ''}{cantidad(diferencia)} {elegido?.unidad ?? ''}.
            </p>
          )}
          {diferencia === 0 && <p className="text-sm text-texto-suave">Coincide con el saldo registrado.</p>}

          <Campo etiqueta="Motivo o acta" htmlFor="conteo-motivo" requerido>
            <Entrada id="conteo-motivo" name="motivo" minLength={10} maxLength={300} required placeholder="Ej.: Inventario mensual, acta 012" />
          </Campo>

          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          <Boton type="submit" cargando={enviando} disabled={materiales.length === 0}>Guardar conteo</Boton>
        </form>
      </Ventana>
    </>
  )
}
