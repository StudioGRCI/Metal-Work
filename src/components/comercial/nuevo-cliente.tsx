'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'

import { crearClienteRapido } from '@/app/(app)/clientes/acciones'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

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
  const [abierto, setAbierto] = useState(false)
  // Hay que avisar a quien abrió la ventana en cuanto el cliente existe, sin
  // encadenarlo a un efecto. Tras el éxito la ventana queda con «Cerrar» y sin
  // el botón de registrar: no hay segundo envío posible.
  const { alEnviar, enviando, resultado, limpiar } = useEnvio(
    crearClienteRapido,
    (r) => {
      if (r.datos) onCreado?.(r.datos)
    },
    { refrescar: !onCreado },
  )

  function abrir() {
    limpiar()
    setAbierto(true)
  }

  return (
    <>
      {/* El botón dice qué crea, no solo «Nuevo». En el formulario de cotización
          este está al lado de «Señores» y el de contactos al lado de «Cliente»,
          y con la misma palabra en los dos alguien buscó dónde dar de alta una
          empresa nueva, encontró la que decía «Cliente» y registró la empresa
          como si fuera una persona de otra. Pasó en producción. */}
      <Boton type="button" variante="contorno" tamano="sm" onClick={abrir}>
        <Plus aria-hidden className="size-3.5" />
        Nuevo cliente
      </Boton>

      {/* El portal, el fondo, la caja, el título y el botón de cerrar los pone
          la Ventana; acá queda solo el formulario. */}
      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Nuevo cliente"
        descripcion="Lo justo para cotizar. La ficha completa se llena después en Clientes."
      >
        <form onSubmit={alEnviar} className="space-y-3">
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
            {/* Tras el éxito el botón dice «Cerrar»: la ventana no se cierra
                sola porque cerrarla desde un efecto está prohibido acá. */}
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
      </Ventana>
    </>
  )
}
