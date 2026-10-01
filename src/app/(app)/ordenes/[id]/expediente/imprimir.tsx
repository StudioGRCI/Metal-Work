'use client'

import { Printer } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'

/**
 * Las fotos del expediente cargan cuando se acercan a la pantalla: las que la
 * persona no llegó a ver saldrían en blanco en el papel. Esto las pide todas y
 * devuelve las que todavía no llegaron.
 */
function pedirTodasLasFotos() {
  const diferidas = Array.from(document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]'))
  for (const img of diferidas) img.loading = 'eager'
  return diferidas.filter((img) => !img.complete)
}

function cuandoLlegue(img: HTMLImageElement) {
  return new Promise<void>((listo) => {
    img.addEventListener('load', () => listo(), { once: true })
    img.addEventListener('error', () => listo(), { once: true })
  })
}

/**
 * Imprime el expediente o lo guarda en PDF con el diálogo del navegador. No
 * pasa por el servidor: lo que se imprime es exactamente lo que la persona ve,
 * con los mismos permisos.
 */
export function BotonImprimir() {
  const [preparando, setPreparando] = useState(false)

  // Con Ctrl+P no se pasa por el botón: al menos las fotos empiezan a llegar.
  useEffect(() => {
    const alImprimir = () => void pedirTodasLasFotos()
    window.addEventListener('beforeprint', alImprimir)
    return () => window.removeEventListener('beforeprint', alImprimir)
  }, [])

  async function imprimir() {
    const faltan = pedirTodasLasFotos()
    if (faltan.length > 0) {
      setPreparando(true)
      // Diez segundos como mucho: una foto rota no puede impedir imprimir el resto.
      await Promise.race([
        Promise.all(faltan.map(cuandoLlegue)),
        new Promise((listo) => setTimeout(listo, 10000)),
      ])
      setPreparando(false)
    }
    window.print()
  }

  return (
    <Boton type="button" variante="secundario" tamano="sm" onClick={imprimir} cargando={preparando} className="print:hidden">
      <Printer aria-hidden className="size-4" />
      {preparando ? 'Cargando las fotos…' : 'Imprimir o guardar PDF'}
    </Boton>
  )
}
