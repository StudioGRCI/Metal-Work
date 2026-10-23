/**
 * Lo que dice una ventana al volver a abrirse cuando el envío anterior, del que
 * no llegó la respuesta, sí entró (`useIdDelEnvio`): cuál quedó, y que lo que se
 * registre ahora es otro. Sin rojo, porque no es un error. La región está
 * siempre montada para que el lector de pantalla lo lea al aparecer: la base
 * contesta con la ventana ya abierta.
 */
export function EnvioAnterior({ texto }: { texto: string | null }) {
  return (
    <div role="status">
      {texto && (
        <p data-envio-anterior className="mb-4 rounded-[var(--radius-base)] bg-info-suave px-3 py-2 text-sm text-texto">
          {texto}
        </p>
      )}
    </div>
  )
}
