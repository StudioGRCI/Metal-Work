import { cn } from '@/lib/utils'

/**
 * Bloque que ocupa el sitio de un dato mientras llega del servidor. No anuncia
 * nada al lector de pantalla: quien espera ya oyó «cargando» del contenedor.
 */
export function Esqueleto({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-[var(--radius-base)] bg-borde motion-reduce:animate-none',
        className,
      )}
    />
  )
}

/** Encabezado de pantalla: título, descripción y el botón de la derecha. */
function EsqueletoEncabezado({ conMigas = false }: { conMigas?: boolean }) {
  return (
    <div className="mb-6">
      {conMigas && <Esqueleto className="mb-2 h-3 w-52" />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <Esqueleto className="h-6 w-56" />
          <Esqueleto className="h-4 w-72" />
        </div>
        <Esqueleto className="h-9 w-36" />
      </div>
    </div>
  )
}

/** Tabla en gris, del alto que tendrá la de verdad, para que nada salte. */
export function EsqueletoTabla({ filas = 8, columnas = 6 }: { filas?: number; columnas?: number }) {
  const anchos = ['w-32', 'w-40', 'w-24', 'w-28', 'w-20', 'w-36', 'w-24', 'w-28']

  return (
    <div className="rounded-[var(--radius-base)] border border-borde bg-superficie shadow-[var(--sombra)]">
      <div className="flex gap-3 border-b border-borde bg-superficie-2 px-3 py-2.5">
        {Array.from({ length: columnas }, (_, c) => (
          <Esqueleto key={c} className={cn('h-3 flex-1', anchos[c % anchos.length])} />
        ))}
      </div>
      {Array.from({ length: filas }, (_, f) => (
        <div key={f} className="flex items-center gap-3 border-b border-borde px-3 py-3 last:border-0">
          {Array.from({ length: columnas }, (_, c) => (
            <Esqueleto key={c} className={cn('h-4 flex-1', anchos[(f + c) % anchos.length])} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Pantalla de listado: encabezado, barra de filtros y tabla. */
export function EsqueletoListado({ filas = 8, columnas = 6 }: { filas?: number; columnas?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando la pantalla">
      <EsqueletoEncabezado />
      <div className="mb-4 flex flex-wrap gap-2">
        <Esqueleto className="h-9 min-w-56 flex-1" />
        <Esqueleto className="h-9 w-44" />
        <Esqueleto className="h-9 w-36" />
      </div>
      <EsqueletoTabla filas={filas} columnas={columnas} />
    </div>
  )
}

/** Pantalla de detalle: migas, encabezado, pestañas y tarjetas de contenido. */
export function EsqueletoDetalle() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando el detalle">
      <EsqueletoEncabezado conMigas />

      <div className="mb-4 flex gap-2 border-b border-borde pb-2">
        {['w-24', 'w-20', 'w-28', 'w-24'].map((ancho) => (
          <Esqueleto key={ancho} className={cn('h-7', ancho)} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <EsqueletoTarjeta lineas={5} />
          <EsqueletoTarjeta lineas={3} />
        </div>
        <div className="space-y-4">
          <EsqueletoTarjeta lineas={4} />
          <EsqueletoTarjeta lineas={2} />
        </div>
      </div>
    </div>
  )
}

/** Tarjeta suelta: cabecera y unas cuantas líneas de dato. */
export function EsqueletoTarjeta({ lineas = 4, className }: { lineas?: number; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-base)] border border-borde bg-superficie shadow-[var(--sombra)]',
        className,
      )}
    >
      <div className="border-b border-borde px-4 py-3">
        <Esqueleto className="h-4 w-40" />
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: lineas }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Esqueleto className="h-3.5 w-28" />
            <Esqueleto className="h-3.5 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Tablero: la fila de indicadores y las dos tarjetas de abajo. */
export function EsqueletoTablero() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando el tablero">
      <div className="mb-6 space-y-2">
        <Esqueleto className="h-6 w-48" />
        <Esqueleto className="h-4 w-64" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius-base)] border border-borde bg-superficie p-4 shadow-[var(--sombra)]"
          >
            <Esqueleto className="h-3.5 w-24" />
            <Esqueleto className="mt-3 h-7 w-12" />
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <EsqueletoTarjeta lineas={6} className="lg:col-span-2" />
        <EsqueletoTarjeta lineas={4} />
      </div>
    </div>
  )
}

/** Formulario: encabezado y una tarjeta con sus campos. */
export function EsqueletoFormulario({ campos = 6 }: { campos?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando el formulario">
      <EsqueletoEncabezado conMigas />

      <div className="rounded-[var(--radius-base)] border border-borde bg-superficie shadow-[var(--sombra)]">
        <div className="border-b border-borde px-4 py-3">
          <Esqueleto className="h-4 w-44" />
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {Array.from({ length: campos }, (_, i) => (
            <div key={i} className="space-y-2">
              <Esqueleto className="h-3 w-28" />
              <Esqueleto className="h-9 w-full" />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-borde px-4 py-3">
          <Esqueleto className="h-9 w-24" />
          <Esqueleto className="h-9 w-32" />
        </div>
      </div>
    </div>
  )
}

/** Rejilla de tarjetas: informes, configuración, bandeja de firmas. */
export function EsqueletoTarjetas({
  cantidad = 6,
  columnas = 'md:grid-cols-2 xl:grid-cols-3',
  lineas = 3,
}: {
  cantidad?: number
  columnas?: string
  lineas?: number
}) {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando la pantalla">
      <EsqueletoEncabezado />
      <div className={cn('grid gap-4', columnas)}>
        {Array.from({ length: cantidad }, (_, i) => (
          <EsqueletoTarjeta key={i} lineas={lineas} />
        ))}
      </div>
    </div>
  )
}
