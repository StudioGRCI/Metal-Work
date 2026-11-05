import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Envoltura con scroll horizontal propio: las tablas del sistema son anchas.
 *
 * En el teléfono una tabla de ocho columnas entra a medias y el corte no se ve:
 * la fila termina en el borde de la pantalla como si ahí se acabara, y el
 * estado, el avance y la fecha de entrega quedan del otro lado sin que nadie
 * sospeche que están. En las capturas del recorrido, la lista de órdenes cortaba
 * «Fabricación de…» a mitad de palabra y no había nada que invitara a arrastrar.
 *
 * La sombra del borde derecho lo dice sin palabras y desaparece sola al llegar
 * al final, porque es un degradado anclado al contenido —`background-attachment:
 * local` para el fondo blanco y `scroll` para la sombra—: no hace falta
 * JavaScript ni escuchar el desplazamiento.
 *
 * Va `relative` para que lo que se posiciona en absoluto dentro de la tabla —el
 * `sr-only` de una cabecera sin título visible— quede contenido en ella: sin eso
 * se medía contra la página y la ensanchaba en el teléfono (la lista de
 * requerimientos medía 685 px en una pantalla de 390).
 */
export function Tabla({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="tabla-con-corte relative w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  )
}

export function TablaCabecera({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-borde bg-superficie-2', className)} {...props} />
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-left text-xs font-semibold tracking-normal text-texto-suave uppercase sm:tracking-wide',
        className,
      )}
      {...props}
    />
  )
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b border-borde last:border-0 hover:bg-superficie-2', className)} {...props} />
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2 align-middle text-texto', className)} {...props} />
}

export function SinDatos({
  titulo,
  descripcion,
  accion,
  colSpan = 99,
  enTabla = true,
}: {
  titulo: string
  descripcion?: string
  accion?: React.ReactNode
  colSpan?: number
  enTabla?: boolean
}) {
  const contenido = (
    <>
      <p className="text-sm font-medium text-texto">{titulo}</p>
      {descripcion && <p className="mt-1 text-xs text-texto-suave">{descripcion}</p>}
      {accion && <div className="mt-4 flex justify-center">{accion}</div>}
    </>
  )

  if (!enTabla) return <div className="px-3 py-12 text-center">{contenido}</div>

  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-12 text-center">
        {contenido}
      </td>
    </tr>
  )
}
