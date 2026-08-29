'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'

import { crearContactoRapido } from '@/app/(app)/clientes/acciones'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'

export type ContactoElegible = { id: string; nombre: string; cargo: string | null }

/**
 * Alta de la persona a la que se dirige la cotización, sin salir del formulario.
 *
 * El papel encabeza con «Atención» y lleva su teléfono y su correo, pero la
 * tabla de contactos estaba vacía y no había ninguna pantalla para llenarla:
 * todas las cotizaciones salían con «Atención —» y «Correo —». Se da de alta
 * desde donde hace falta —igual que el cliente y la unidad— porque parar una
 * cotización para ir a otra pantalla es lo que hace que el dato no se cargue
 * nunca.
 */
export function NuevoContacto({
  clienteId,
  onCreado,
}: {
  clienteId: string
  onCreado?: (contacto: ContactoElegible) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<
    { ok: true; mensaje?: string } | { ok: false; error: string } | null
  >(null)

  // Sin useActionState, como en `NuevoCliente`: hay que avisar a quien abrió la
  // ventana en cuanto el contacto existe, y encadenarlo a un efecto dispara
  // renderizados de más —y la regla del proyecto lo prohíbe—.
  async function enviar(datos: FormData) {
    setEnviando(true)
    const salida = await crearContactoRapido(null, datos)
    setEnviando(false)
    setResultado(salida)

    if (salida.ok && salida.datos) {
      onCreado?.(salida.datos)
      setAbierto(false)
    }
  }

  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        aria-label="Nuevo contacto"
        onClick={() => {
          setResultado(null)
          setAbierto(true)
        }}
      >
        <Plus aria-hidden className="size-3.5" />
        Nuevo
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Nuevo contacto"
        descripcion="La persona del cliente a la que se dirige la cotización. Su nombre, teléfono y correo salen impresos en el papel."
      >
        <form action={enviar} className="space-y-3">
          <input type="hidden" name="cliente_id" value={clienteId} />

          <Campo etiqueta="Nombre" htmlFor="ncto-nombre" requerido>
            <Entrada
              id="ncto-nombre"
              name="nombre"
              autoFocus
              autoComplete="off"
              placeholder="Juan Pérez Quispe"
              required
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Cargo" htmlFor="ncto-cargo">
              <Entrada
                id="ncto-cargo"
                name="cargo"
                autoComplete="off"
                placeholder="Jefe de mantenimiento"
              />
            </Campo>

            <Campo etiqueta="Teléfono" htmlFor="ncto-telefono">
              {/* `inputMode` saca el teclado numérico del teléfono; el tipo se
                  queda en texto porque hay números con anexo y con guiones. */}
              <Entrada
                id="ncto-telefono"
                name="telefono"
                inputMode="tel"
                autoComplete="off"
                placeholder="987 654 321"
              />
            </Campo>
          </div>

          <Campo etiqueta="Correo" htmlFor="ncto-correo">
            <Entrada
              id="ncto-correo"
              name="correo"
              type="email"
              autoComplete="off"
              placeholder="jperez@cliente.com.pe"
            />
          </Campo>

          {resultado?.ok === false && (
            <p
              role="alert"
              className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro"
            >
              {resultado.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="sm" cargando={enviando}>
              Registrar contacto
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
