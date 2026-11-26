'use client'

import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { FILTROS_QUE_VUELVEN } from '@/lib/dominio/adquisiciones'

/**
 * El Excel del mes (Plan 10): las OC y OS emitidas ese mes, con las columnas de
 * la tabla y un documento por columna. El navegador baja el archivo de
 * `/adquisiciones/excel`, que pide el mismo permiso que la pantalla.
 *
 * Si no sale, la ruta vuelve a la lista con los mismos filtros y `?excel=` para
 * decirlo aquí. Ese `excel` se quita de la dirección en cuanto se lee, para que
 * no lo arrastren el buscador, los filtros ni la paginación, y el aviso se va con
 * la descarga siguiente: decía que algo falló cuando ya había salido bien.
 */
export function ExcelDelMes({
  mes,
  aviso: avisoDeLaRuta,
  filtros,
}: {
  mes: string
  aviso: 'mes' | 'fallo' | null
  filtros: Partial<Record<(typeof FILTROS_QUE_VUELVEN)[number], string>>
}) {
  // El formulario es del navegador, sin JavaScript de por medio: la vuelta con
  // aviso es una carga entera de la página, y el estado nace de nuevo con ella.
  const [aviso, setAviso] = useState(avisoDeLaRuta)

  useEffect(() => {
    if (!avisoDeLaRuta) return
    const url = new URL(window.location.href)
    if (!url.searchParams.has('excel')) return
    url.searchParams.delete('excel')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [avisoDeLaRuta])

  return (
    <form method="get" action="/adquisiciones/excel" className="space-y-1" onSubmit={() => setAviso(null)}>
      {FILTROS_QUE_VUELVEN.map((clave) => (filtros[clave] ? <input key={clave} type="hidden" name={clave} value={filtros[clave]} /> : null))}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="excel-mes" className="text-sm text-texto-suave">
          Excel del mes
        </label>
        {/* Donde el navegador no tiene calendario de meses (Safari de escritorio) es un campo de texto: el formato lo dice el ejemplo. */}
        <Entrada
          id="excel-mes"
          type="month"
          name="mes"
          defaultValue={mes}
          max={mes}
          pattern="[0-9]{4}-[0-9]{2}"
          placeholder={mes}
          title="El mes, como año-mes: 2026-11"
          required
          aria-invalid={aviso === 'mes' || undefined}
          aria-describedby={aviso ? 'excel-aviso' : undefined}
          className="w-auto"
        />
        <Boton type="submit" variante="contorno">
          <Download aria-hidden className="size-4" />
          Descargar Excel
        </Boton>
      </div>
      {aviso && (
        <div id="excel-aviso">
          <AvisoEnfocado rol="alert">
            {aviso === 'mes'
              ? 'Ese mes no se entiende: elígelo en el calendario o escríbelo como año-mes (2026-11).'
              : 'No se pudo armar el Excel. Vuelve a intentarlo en un momento.'}
          </AvisoEnfocado>
        </div>
      )}
    </form>
  )
}
