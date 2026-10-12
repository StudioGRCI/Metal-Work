'use client'

import { PackageCheck } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { IngresoPorValidar } from '@/lib/datos/recojos'
import { useEnvio } from '@/lib/envio'
import { cantidad, fechaHora } from '@/lib/format'

import { validarIngresoCompra } from './acciones'

/**
 * Lo que el conductor dejó en almacén y falta ingresar. Cada compra llega con
 * sus materiales y lo pendiente ya escrito: si llegó todo, basta con validar;
 * si llegó menos, se corrige la cantidad y lo demás sigue pendiente.
 */
export function IngresosPorValidar({ ingresos }: { ingresos: IngresoPorValidar[] }) {
  // El aviso vive aquí y no en la tarjeta: validada por completo, la compra
  // sale de la lista y su tarjeta desaparece con el refresco.
  const [aviso, setAviso] = useState<string | null>(null)
  if (ingresos.length === 0 && !aviso) return null
  return (
    <section id="por-validar" aria-labelledby="titulo-por-validar" className="mb-4 scroll-mt-20 space-y-3">
      <div>
        <h2 id="titulo-por-validar" className="text-base font-semibold text-texto">
          {ingresos.length === 0 ? 'Sin ingresos por validar' : ingresos.length === 1 ? '1 ingreso por validar' : `${ingresos.length} ingresos por validar`}
        </h2>
        <p className="text-sm text-texto-suave">Compras que el conductor dejó en almacén. Revisa lo que llegó y valídalo: entra al kardex con el precio de la compra.</p>
      </div>
      {aviso && <p role="status" className="rounded-md bg-exito-suave px-3 py-2 text-sm text-exito">{aviso}</p>}
      {ingresos.map((i) => <IngresoCompra key={i.id} ingreso={i} alValidar={setAviso} />)}
    </section>
  )
}

function IngresoCompra({ ingreso: i, alValidar }: { ingreso: IngresoPorValidar; alValidar: (mensaje: string | null) => void }) {
  const [operacion, setOperacion] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, error } = useEnvio(validarIngresoCompra, (r) => {
    setOperacion(crypto.randomUUID())
    alValidar(r.mensaje ? `${i.referencia}: ${r.mensaje}` : null)
  })
  const recibidoAntes = i.lineas.some((l) => Number(l.recibido) > 0)
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={`${i.referencia} · ${i.proveedor}`}
        descripcion={[
          i.dejado_en ? `Dejada el ${fechaHora(i.dejado_en)}${i.dejado_por ? ` por ${i.dejado_por}` : ''}` : null,
          i.ordenes.length > 0 ? `OT ${i.ordenes.join(', ')}` : 'Para almacén',
        ].filter(Boolean).join(' · ')}
        acciones={<Insignia tono="aviso">Por validar</Insignia>}
      />
      <TarjetaCuerpo>
        {/* La llave rehace los campos cuando cambia lo pendiente, tras validar una parte. */}
        <form key={i.lineas.map((l) => l.pendiente).join('|')} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="operacion_id" value={operacion} />
          <input type="hidden" name="compra_id" value={i.id} />
          <Campo etiqueta="Guía o factura" htmlFor={`val-doc-${i.id}`} requerido ayuda={i.documento_entrega ? 'La que anotó el conductor. Corrígela si el papel dice otra cosa.' : undefined}>
            <Entrada id={`val-doc-${i.id}`} name="documento" required minLength={2} maxLength={100} defaultValue={i.documento_entrega ?? ''} autoComplete="off" className="sm:max-w-xs" />
          </Campo>
          <ul className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
            {i.lineas.map((l) => (
              <li key={l.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <input type="hidden" name="linea_id" value={l.id} />
                <div className="min-w-0">
                  <p className="text-sm text-texto">{l.material}</p>
                  <p className="text-[11px] text-texto-suave">
                    <span className="font-mono">{l.material_codigo}</span>
                    {l.orden ? ` · OT ${l.orden}` : ''}
                    {` · comprado ${cantidad(l.comprado)} ${l.unidad ?? ''}`}
                    {Number(l.recibido) > 0 ? ` · ya ingresó ${cantidad(l.recibido)}` : ''}
                  </p>
                </div>
                <Campo etiqueta={`Llegó (${l.unidad ?? 'cantidad'})`} htmlFor={`val-${l.id}`}>
                  <Entrada id={`val-${l.id}`} name={`cantidad_${l.id}`} type="number" inputMode="decimal" min={0} max={Number(l.pendiente)} step="0.001"
                    defaultValue={Number(l.pendiente)} required className="tabular w-full sm:w-32" />
                </Campo>
              </li>
            ))}
          </ul>
          {recibidoAntes && <p className="text-xs text-texto-suave">Parte de esta compra ya entró antes: las cantidades son lo que falta.</p>}
          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          <Boton type="submit" cargando={enviando} className="w-full sm:w-auto">
            <PackageCheck aria-hidden className="size-4" />Validar ingreso
          </Boton>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
