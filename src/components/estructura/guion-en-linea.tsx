/**
 * Un guion que corre mientras el navegador lee el HTML, antes de pintar nada.
 *
 * En el servidor se emite como JavaScript de verdad; en el navegador, como
 * texto muerto. React avisa en desarrollo cuando un componente devuelve una
 * etiqueta <script>, porque al re-renderizar no la vuelve a ejecutar; con el
 * tipo cambiado no hay nada que ejecutar y el aviso desaparece. La diferencia
 * de tipo entre uno y otro lado es a propósito, y por eso se silencia.
 */
export function GuionEnLinea({ html }: { html: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
