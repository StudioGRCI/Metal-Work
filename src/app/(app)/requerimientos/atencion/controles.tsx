'use client'

import { Check, PackageCheck, PackageX, ShoppingCart } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { marcarPasoRequerimiento } from './acciones'

type Paso = 'sin_stock' | 'listo' | 'en_atencion' | 'entregado'

const PASO = {
  sin_stock: {
    texto: 'Sin stock',
    icono: PackageX,
    variante: 'contornoPeligro' as const,
    titulo: 'No hay stock: pasa a Logística',
    descripcion: 'Logística recibe el aviso y hace la orden de compra. Cuando el conductor lo deje, lo recepcionas aquí mismo.',
    nota: 'Qué falta o cuánto queda (opcional)',
    ejemplo: 'Por ejemplo: quedan 2 planchas de 3 mm, de 2 mm no hay.',
    boton: 'Marcar sin stock',
  },
  listo: {
    texto: 'Listo en almacén',
    icono: PackageCheck,
    variante: 'primario' as const,
    titulo: 'Listo en almacén',
    descripcion: 'Al supervisor del área le llega el aviso para que venga a recogerlo.',
    nota: 'Dónde está o qué llegó (opcional)',
    ejemplo: 'Por ejemplo: estante B, 3 planchas. Llegó con el conductor.',
    boton: 'Dejar listo',
  },
  en_atencion: {
    texto: 'Lo estoy comprando',
    icono: ShoppingCart,
    variante: 'primario' as const,
    titulo: 'Logística lo compra',
    descripcion: 'Queda «En compra». La orden de compra se vincula desde Órdenes de compra; Almacén lo recepciona cuando llegue.',
    nota: 'Con quién o cuándo (opcional)',
    ejemplo: 'Por ejemplo: cotizando con Aceros Arequipa, llega el jueves.',
    boton: 'Marcar en compra',
  },
  entregado: {
    texto: 'Entregado',
    icono: Check,
    variante: 'primario' as const,
    titulo: 'Entregar al área',
    descripcion: 'Cierra el requerimiento. Anota quién lo recogió: es lo que después se cruza con el formato firmado.',
    nota: 'Quién lo recogió',
    ejemplo: 'Por ejemplo: supervisor de Maestranza.',
    boton: 'Registrar entrega',
  },
} satisfies Record<Paso, unknown>

/** Un botón por paso; cada uno abre su ventana con la nota y manda a la base. */
export function PasoRequerimiento({ id, numero, paso }: { id: string; numero: string; paso: Paso }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(marcarPasoRequerimiento, () => setAbierta(false))
  const d = PASO[paso]
  const Icono = d.icono
  return (
    <>
      <Boton type="button" variante={d.variante} tamano="sm" onClick={() => setAbierta(true)}>
        <Icono aria-hidden className="size-4" />
        {d.texto}
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`${d.titulo} · ${numero}`} descripcion={d.descripcion} ancho="md">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="paso" value={paso} />
          <Campo etiqueta={d.nota} htmlFor={`rq-${paso}-${id}`} requerido={paso === 'entregado'}>
            <AreaTexto id={`rq-${paso}-${id}`} name="nota" rows={2} maxLength={500} required={paso === 'entregado'} minLength={paso === 'entregado' ? 3 : undefined} placeholder={d.ejemplo} />
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
            <Boton type="submit" variante={paso === 'sin_stock' ? 'peligro' : 'primario'} cargando={enviando}>
              {d.boton}
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
