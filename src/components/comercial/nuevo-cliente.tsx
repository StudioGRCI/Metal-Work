'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'

import { crearClienteRapido } from '@/app/(app)/clientes/acciones'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'

/**
 * Alta de cliente sin salir del formulario.
 *
 * El cliente nuevo aparece justo cuando se está cotizando: mandarlo a la
 * pantalla de clientes es perder lo que ya se escribió. Acá se piden los
 * cuatro datos con los que se puede cotizar y el cliente queda elegido;
 * la ficha completa se termina después, con calma.
 */
export function NuevoCliente({
  onCreado,
}: {
  onCreado?: (cliente: { id: string; razon_social: string; numero_documento: string }) => void
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<
    { ok: true; mensaje?: string } | { ok: false; error: string } | null
  >(null)

  // La acción se llama directo, sin useActionState: hay que avisar a quien
  // abrió la ventana en cuanto el cliente existe, y encadenarlo a un efecto
  // dispara renderizados de más.
  async function enviar(datos: FormData) {
    setEnviando(true)
    const salida = await crearClienteRapido(null, datos)
    setEnviando(false)
    setResultado(salida)

    if (salida.ok && salida.datos) {
      onCreado?.(salida.datos)
      if (!onCreado) iniciarTransicion(() => router.refresh())
    }
  }

  function abrir() {
    setResultado(null)
    setAbierto(true)
  }

  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={abrir}>
        <Plus aria-hidden className="size-3.5" />
        Nuevo
      </Boton>

      {abierto &&
        // En un portal a propósito: el diálogo lleva su propio <form> y, si se
        // renderizara dentro del formulario que lo abrió, quedarían anidados
        // —HTML no lo permite y React envía el de afuera—.
        createPortal(
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Nuevo cliente"
            className="w-full max-w-lg rounded-[calc(var(--radius-base)*1.5)] border border-borde bg-superficie p-5 shadow-2xl shadow-black/30"
          >
            <h2 className="text-base font-semibold text-texto">Nuevo cliente</h2>
            <p className="mt-0.5 text-xs text-texto-suave">
              Lo justo para cotizar. La ficha completa se llena después en Clientes.
            </p>

            <form action={enviar} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <Campo etiqueta="Documento" htmlFor="nc-tipo" requerido>
                  <Seleccion id="nc-tipo" name="tipo_documento" defaultValue="RUC" required>
                    <option value="RUC">RUC</option>
                    <option value="DNI">DNI</option>
                    <option value="CE">CE</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </Seleccion>
                </Campo>
                <Campo etiqueta="Número" htmlFor="nc-numero" requerido>
                  <Entrada id="nc-numero" name="numero_documento" required inputMode="numeric" placeholder="20601538840" />
                </Campo>
              </div>

              <Campo etiqueta="Razón social" htmlFor="nc-razon" requerido>
                <Entrada id="nc-razon" name="razon_social" required placeholder="TRANSPORTES ANDINOS S.A.C." />
              </Campo>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Teléfono" htmlFor="nc-telefono">
                  <Entrada id="nc-telefono" name="telefono" inputMode="tel" />
                </Campo>
                <Campo etiqueta="Correo" htmlFor="nc-correo">
                  <Entrada id="nc-correo" name="correo" type="email" />
                </Campo>
              </div>

              {resultado && !resultado.ok && (
                <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
                  {resultado.error}
                </p>
              )}
              {resultado?.ok && resultado.mensaje && (
                <p role="status" className="rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-xs text-exito">
                  {resultado.mensaje}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierto(false)}>
                  {resultado?.ok ? 'Cerrar' : 'Cancelar'}
                </Boton>
                {!resultado?.ok && (
                  <Boton type="submit" tamano="sm" cargando={enviando}>
                    Registrar cliente
                  </Boton>
                )}
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
