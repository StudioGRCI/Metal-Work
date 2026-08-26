'use client'

import { Download } from 'lucide-react'
import { useState } from 'react'

import { csvDelInforme } from './acciones'
import { Boton } from '@/components/ui/boton'

/**
 * Baja el informe como CSV. Se arma en el servidor y se entrega como archivo:
 * así el número que se descarga es exactamente el que se ve en pantalla.
 */
export function DescargarCsv({
  clave,
  desde,
  hasta,
  titulo,
}: {
  clave: string
  desde: string
  hasta: string
  titulo: string
}) {
  const [bajando, setBajando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function bajar() {
    setError(null)
    setBajando(true)
    const resultado = await csvDelInforme(clave, desde, hasta)
    setBajando(false)

    if (!resultado.ok) {
      setError(resultado.error)
      return
    }

    const archivo = new Blob([resultado.csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(archivo)
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = `${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${desde}-a-${hasta}.csv`
    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-peligro">{error}</span>}
      <Boton variante="secundario" tamano="sm" onClick={bajar} cargando={bajando}>
        <Download aria-hidden className="size-3.5" />
        Descargar
      </Boton>
    </div>
  )
}
