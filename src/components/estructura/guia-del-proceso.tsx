import { ChevronDown } from 'lucide-react'

/** Guía del procedimiento; no marca pasos como cumplidos sin evidencia. */
export function GuiaDelProceso() {
  return (
    <details className="group mb-4 rounded-[var(--radius-base)] border border-borde bg-superficie">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-texto">
        De la cotización a la salida · quién hace cada paso
        <ChevronDown aria-hidden className="size-4 shrink-0 text-acento transition-transform group-open:rotate-180" />
      </summary>
      <ol className="grid gap-4 border-t border-borde p-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ['Subir cotización', 'Ventas', 'Carga el PDF o Word enviado al cliente y comprueba número, cliente y carrocería.'],
          ['Revisar y aprobar', 'Gerencia', 'Aprueba o explica el rechazo. Ventas sube la corrección en la misma cotización; las versiones anteriores quedan en el historial.'],
          ['Emitir la orden', 'Administración', 'Desde la cotización aprobada, adjunta el PDF de la OT e identifica la unidad y la fecha comprometida.'],
          ['Preparar y fabricar', 'Diseño y Taller', 'Organizan planos, piezas, materiales, actividades y plazos. Cada área reporta sus avances; el responsable revisa y termina el trabajo.'],
          ['Liberar y entregar', 'Administración y responsable de entrega', 'Tesorería libera la salida. Después se registra el acta con la persona que recibe la unidad.'],
          ['Avisar a portería', 'Quien coordina la entrega', 'Con el acta registrada, confirma el aviso a portería. Marcar la orden facturada no sustituye este paso.'],
          ['Registrar salida física', 'Responsable de entrega', 'Cuando el vehículo haya salido, deja la constancia. El sistema registra quién confirmó y cuándo.'],
        ].map(([titulo, responsable, detalle], indice) => (
          <li key={titulo} className="flex min-w-0 gap-3">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-acento-suave text-sm font-semibold text-acento">{indice + 1}</span>
            <div>
              <p className="text-sm font-semibold text-texto">{titulo}</p>
              <p className="mt-0.5 text-xs font-medium text-acento">{responsable}</p>
              <p className="mt-1 text-xs leading-relaxed text-texto-suave">{detalle}</p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  )
}
