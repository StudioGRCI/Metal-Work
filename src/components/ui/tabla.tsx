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
export function Tabla({
  className,
  apilada = false,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  /**
   * Por debajo de `md` (768 px) cada fila pasa a ser una ficha: sus celdas se
   * apilan, la cabecera se va y la celda que lleve `data-rotulo` lo muestra
   * encima. Es para la lista cuyas filas llevan botones o bloques largos
   * (Carrocerías): ahí ni esconder columnas ni `DetalleEnTelefono` alcanzan,
   * porque los botones no se pueden pintar dos veces —cada uno guarda su
   * ventana y su envío—. Una sola fila en el HTML, dos formas de verla
   * (`globals.css`, «UNA TABLA QUE EN EL TELÉFONO ES UNA LISTA DE FICHAS»).
   * La columna que en la ficha no va lleva `hidden md:table-cell` o un corte
   * mayor, nunca `sm:table-cell`: entre 640 y 767 volvería celda a un bloque.
   */
  apilada?: boolean
}) {
  return (
    <div className="tabla-con-corte relative w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', apilada && 'tabla-apilada', className)} {...props} />
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

/**
 * El estado vacío, en dos tamaños.
 *
 * El grande (por omisión) es para la lista que es el trabajo de la pantalla:
 * centrado y con aire, porque no hay nada más que mirar. El `compacto` es para
 * la bandeja que comparte pantalla con otras (lo que espera en el Kardex, un
 * bloque del tablero de la OT): un renglón o dos, a la izquierda, sin el aire
 * que empuja hacia abajo lo que sí tiene trabajo. Antes cada bandeja lo
 * escribía a mano como un `<p>` y había tres aspectos distintos (revisión de
 * diseño del 2026-11-25).
 */
type VacioComun = { titulo: string; descripcion?: string; accion?: React.ReactNode }
/** El grande: dentro de un `<tbody>` (por omisión) o suelto con `enTabla={false}`. */
type VacioGrande = VacioComun & { compacto?: false; colSpan?: number; enTabla?: boolean }
/**
 * El de una bandeja entre varias: sin centrar y sin el aire del grande. Va
 * siempre fuera de tabla —es un `<div>`—, y por eso no admite `colSpan` ni
 * `enTabla`: dentro de un `<tbody>` sería HTML inválido.
 */
type VacioCompacto = VacioComun & { compacto: true; colSpan?: never; enTabla?: never }

export function SinDatos(props: VacioGrande | VacioCompacto) {
  const { titulo, descripcion, accion, compacto = false } = props
  const { colSpan = 99, enTabla = true } = props
  if (compacto) {
    return (
      <div data-sin-datos="compacto">
        <p className="text-sm font-medium text-texto">{titulo}</p>
        {descripcion && <p className="mt-0.5 text-xs text-pretty text-texto-suave">{descripcion}</p>}
        {accion && <div className="mt-2 flex">{accion}</div>}
      </div>
    )
  }

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

/**
 * Los botones de una fila, siempre igual: en un renglón, lo que más se usa
 * primero y con contorno, lo que casi nunca (desactivar, eliminar) al final y
 * sin borde. En el monitor van a la derecha de la fila; en el teléfono, a la
 * izquierda bajo el dato. Si no caben bajan de renglón en vez de ensanchar la
 * tabla, así que **la columna lleva su ancho** (`md:w-80` en la cabecera) para
 * que quepan: sin ancho, la tabla le da el mínimo y quedan uno por renglón.
 * No se fuerza con `flex-nowrap`: a 1280 px un aviso largo en la fila corría
 * la tabla 150 px y dejaba «Desactivar» fuera de la vista (auditoría del
 * 2026-11-25). Había tres maneras: íconos sueltos en Materiales, tres botones
 * apilados en Carrocerías (cada fila medía 84 px) y botón más texto en
 * Unidades.
 *
 * Provisional en una cosa: DKS decidió que borrar y desactivar vayan dentro de
 * un menú «⋯» de la fila (decisión 6 del plan de orden y diseño). Ese menú
 * todavía no existe —una `Ventana` dentro de un desplegable se desmonta al
 * cerrarlo— y hasta que exista van al final y sin borde.
 */
export function AccionesDeFila({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 md:justify-end', className)} {...props} />
}

/**
 * Lo que en el monitor va en sus columnas y en el teléfono baja a la primera
 * celda, debajo del nombre. Es la manera de la casa para que una tabla entre
 * en 390 px (Clientes, Órdenes, el Kardex): las columnas que no caben llevan
 * `hidden sm:table-cell` y su contenido se repite aquí (en una `Tabla apilada`
 * el corte es `md` o mayor: se le pasa en `className`). Una tabla que solo
 * esconde columnas pierde el dato; una que no esconde ninguna se aprieta hasta
 * partir una palabra por renglón (Carrocerías medía 9 856 px de alto).
 */
export function DetalleEnTelefono({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-1.5 space-y-1.5 sm:hidden', className)} {...props} />
}
