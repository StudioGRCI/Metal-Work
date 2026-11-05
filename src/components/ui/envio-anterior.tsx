/**
 * Lo que dice una ventana al volver a abrirse cuando el envío anterior, del que
 * no llegó la respuesta, sí entró (`useIdDelEnvio`): cuál quedó, y que lo que se
 * registre ahora es otro. Sin rojo, porque no es un error. La región está
 * siempre montada para que el lector de pantalla lo lea al aparecer: la base
 * contesta con la ventana ya abierta. Es `aria-live` y no `role="status"`: el
 * aviso de la ventana es su primer `status`, y una región vacía delante lo
 * tapaba para quien lo busca por su papel.
 *
 * Que en otra pestaña entró otra cuenta no va aquí: lo dice el pie, que traba
 * la ventana (`PieDeVentana`).
 */
export function EnvioAnterior({ texto }: { texto: string | null }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {texto && (
        <p data-envio-anterior className="mb-4 rounded-[var(--radius-base)] bg-info-suave px-3 py-2 text-sm text-texto">
          {texto}
        </p>
      )}
    </div>
  )
}
