'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'

import { cambiarEstadoParte } from '../acciones'

export function AccionesParte({
  parte,
  permisos,
  esAdmin,
  tieneLineas,
}: {
  parte: { id: string; estado: string }
  permisos: string[]
  esAdmin: boolean
  tieneLineas: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const puede = (permiso: string) => esAdmin || permisos.includes(permiso)

  async function cambiar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await cambiarEstadoParte(null, datos)
    setEnviando(false)

    if (resultado.ok) iniciarTransicion(() => router.refresh())
    else setError(resultado.error)
  }

  const acciones: { estado: string; etiqueta: string; visible: boolean; primario?: boolean }[] = [
    {
      estado: 'CERRADO',
      etiqueta: 'Cerrar parte',
      visible: parte.estado === 'BORRADOR' && puede('produccion.registrar') && tieneLineas,
      primario: true,
    },
    {
      estado: 'BORRADOR',
      etiqueta: 'Reabrir',
      visible: parte.estado === 'CERRADO' && puede('produccion.registrar'),
    },
    {
      estado: 'APROBADO',
      etiqueta: 'Aprobar y cargar horas',
      visible: parte.estado === 'CERRADO' && puede('produccion.aprobar_parte'),
      primario: true,
    },
  ]

  const visibles = acciones.filter((a) => a.visible)
  if (visibles.length === 0 && !error) return null

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {visibles.map((a) => (
          <form key={a.estado} action={cambiar}>
            <input type="hidden" name="parte_id" value={parte.id} />
            <input type="hidden" name="estado" value={a.estado} />
            <Boton
              type="submit"
              tamano="sm"
              cargando={enviando}
              variante={a.primario ? 'primario' : 'secundario'}
            >
              {a.etiqueta}
            </Boton>
          </form>
        ))}
      </div>

      {error && (
        <p role="alert" className="max-w-md rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error}
        </p>
      )}
    </div>
  )
}
