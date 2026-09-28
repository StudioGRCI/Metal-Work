'use client'

import { useEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'

type DocumentoPdf = Awaited<ReturnType<(typeof import('unpdf'))['getDocumentProxy']>>

/** Dibuja el PDF dentro del sistema aunque el navegador no tenga visor integrado. */
export function VistaPreviaPdf({ archivo, titulo }: { archivo: File; titulo: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const documento = useRef<DocumentoPdf | null>(null)
  const [paginas, setPaginas] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [estado, setEstado] = useState<'cargando' | 'lista' | 'error'>('cargando')

  useEffect(() => {
    let vigente = true
    async function abrir() {
      try {
        const { getDocumentProxy } = await import('unpdf')
        const pdf = await getDocumentProxy(new Uint8Array(await archivo.arrayBuffer()))
        if (!vigente) { void pdf.cleanup(); return }
        documento.current = pdf
        setPagina(1)
        setPaginas(pdf.numPages)
      } catch {
        if (vigente) setEstado('error')
      }
    }
    void abrir()
    return () => {
      vigente = false
      const pdf = documento.current
      documento.current = null
      if (pdf) void pdf.cleanup()
    }
  }, [archivo])

  useEffect(() => {
    if (!paginas || !documento.current) return
    let vigente = true
    let cancelar: (() => void) | null = null
    async function dibujar() {
      try {
        const pdf = documento.current
        const lienzo = canvas.current
        if (!pdf || !lienzo) return
        const hoja = await pdf.getPage(pagina)
        if (!vigente) return
        const anchoOriginal = hoja.getViewport({ scale: 1 }).width
        const anchoDisponible = lienzo.parentElement?.clientWidth ?? anchoOriginal
        const escala = Math.min(2, Math.max(0.2, anchoDisponible / anchoOriginal))
        const resolucion = Math.min(window.devicePixelRatio || 1, 2)
        const vista = hoja.getViewport({ scale: escala * resolucion })
        lienzo.width = Math.ceil(vista.width)
        lienzo.height = Math.ceil(vista.height)
        lienzo.style.width = `${Math.ceil(vista.width / resolucion)}px`
        lienzo.style.height = `${Math.ceil(vista.height / resolucion)}px`
        const contexto = lienzo.getContext('2d')
        if (!contexto) throw new Error('No se pudo dibujar el PDF')
        const tarea = hoja.render({ canvas: lienzo, canvasContext: contexto, viewport: vista })
        cancelar = () => tarea.cancel()
        await tarea.promise
        if (vigente) setEstado('lista')
        hoja.cleanup()
      } catch {
        if (vigente) setEstado('error')
      }
    }
    void dibujar()
    return () => { vigente = false; cancelar?.() }
  }, [archivo, pagina, paginas])

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center justify-between gap-2 border-b border-borde px-3 py-2 text-xs text-texto-suave">
      <span className="truncate" title={titulo}>{titulo}</span>
      {paginas > 0 && <div className="flex shrink-0 items-center gap-2">
        <Boton type="button" tamano="sm" variante="fantasma" disabled={pagina === 1} onClick={() => { setEstado('cargando'); setPagina((n) => n - 1) }} aria-label="Página anterior">‹</Boton>
        <span className="tabular">{pagina} de {paginas}</span>
        <Boton type="button" tamano="sm" variante="fantasma" disabled={pagina === paginas} onClick={() => { setEstado('cargando'); setPagina((n) => n + 1) }} aria-label="Página siguiente">›</Boton>
      </div>}
    </div>
    <div className="min-h-[20rem] flex-1 overflow-auto bg-white p-2 text-center">
      {estado === 'cargando' && <p role="status" className="py-4 text-sm text-texto-suave">Preparando la vista previa…</p>}
      {estado === 'error' && <p role="alert" className="py-4 text-sm text-peligro">No se pudo mostrar el PDF. Comprueba el archivo y vuelve a elegirlo.</p>}
      <canvas ref={canvas} role="img" aria-label={`Página ${pagina} de ${paginas || 1} del PDF`} className={estado === 'lista' ? 'mx-auto block max-w-full' : 'hidden'} />
    </div>
  </div>
}
