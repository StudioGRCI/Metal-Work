'use client'

import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { crearProveedor } from '@/app/(app)/almacen/proveedores/acciones'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { cn } from '@/lib/utils'

const CONDICIONES = [
  ['CONTADO', 'Contado'],
  ['CREDITO_7', 'Crédito 7 días'],
  ['CREDITO_15', 'Crédito 15 días'],
  ['CREDITO_30', 'Crédito 30 días'],
  ['CREDITO_45', 'Crédito 45 días'],
  ['CREDITO_60', 'Crédito 60 días'],
  ['LETRAS', 'Letras'],
] as const

/**
 * Alta de proveedor sin salir de donde uno está.
 *
 * El proveedor nuevo aparece justo cuando hay que emitirle algo: se está
 * llenando la orden de servicio y el tornero no está en la lista. Mandar a la
 * persona a otra pantalla es perder lo que ya escribió, así que se da de alta
 * acá y queda elegido al volver.
 *
 * `onCreado` lo usa el formulario que lo abrió para quedarse con el proveedor
 * recién creado. Sin él, sirve igual como alta suelta desde la pantalla de
 * proveedores.
 */
export function NuevoProveedor({
  onCreado,
  etiqueta = 'Nuevo proveedor',
  compacto = false,
}: {
  onCreado?: (proveedor: { id: string; razon_social: string }) => void
  etiqueta?: string
  compacto?: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<
    { ok: true; mensaje?: string } | { ok: false; error: string } | null
  >(null)

  // Se llama a la acción directamente en vez de con useActionState: hace falta
  // avisarle a quien abrió la ventana en cuanto el proveedor queda creado, y
  // eso encadenado a un efecto dispara renderizados de más.
  async function enviar(datos: FormData) {
    setEnviando(true)
    const salida = await crearProveedor(null, datos)
    setEnviando(false)

    if (!salida.ok) {
      setResultado(salida)
      return
    }

    setResultado({ ok: true, mensaje: salida.mensaje })
    if (salida.datos) onCreado?.(salida.datos)
    // Sin quien lo escuche, es un alta suelta: se refresca la lista de atrás.
    if (!onCreado) iniciarTransicion(() => router.refresh())
  }

  return (
    <>
      <Boton
        type="button"
        variante={compacto ? 'contorno' : 'secundario'}
        tamano="sm"
        onClick={() => setAbierto(true)}
      >
        <Plus aria-hidden className="size-3.5" />
        {etiqueta}
      </Boton>

      {/* El portal, el fondo, la caja, el título y el botón de cerrar los pone
          la Ventana; acá queda solo el formulario. */}
      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Nuevo proveedor"
        descripcion="Con el RUC y la razón social alcanza. Lo demás se puede completar después desde Proveedores."
      >
        <form action={enviar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="RUC o DNI" htmlFor="numero_documento" requerido>
              <Entrada
                id="numero_documento"
                name="numero_documento"
                required
                inputMode="numeric"
                placeholder="20601234567"
                autoComplete="off"
              />
            </Campo>
            <Campo etiqueta="Razón social" htmlFor="razon_social" requerido className="sm:col-span-2">
              <Entrada
                id="razon_social"
                name="razon_social"
                required
                placeholder="ARENADOS DEL NORTE E.I.R.L."
                autoComplete="off"
              />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Nombre comercial" htmlFor="nombre_comercial">
              <Entrada id="nombre_comercial" name="nombre_comercial" autoComplete="off" />
            </Campo>
            <Campo etiqueta="Contacto" htmlFor="contacto_nombre">
              <Entrada id="contacto_nombre" name="contacto_nombre" autoComplete="off" />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Teléfono" htmlFor="telefono">
              <Entrada id="telefono" name="telefono" autoComplete="off" />
            </Campo>
            <Campo etiqueta="Correo" htmlFor="correo">
              <Entrada id="correo" name="correo" type="email" autoComplete="off" />
            </Campo>
          </div>

          <Campo etiqueta="Condición de pago" htmlFor="condicion_pago">
            <Seleccion id="condicion_pago" name="condicion_pago" defaultValue="CONTADO">
              {CONDICIONES.map(([valor, texto]) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {resultado && (
            <p
              role={resultado.ok === false ? 'alert' : 'status'}
              className={cn(
                'rounded-[var(--radius-base)] px-3 py-2 text-xs',
                resultado.ok === false
                  ? 'bg-peligro-suave text-peligro'
                  : 'bg-exito-suave text-exito',
              )}
            >
              {resultado.ok === false ? resultado.error : resultado.mensaje}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            {/* Tras el éxito el botón dice «Cerrar»: la ventana no se cierra
                sola porque cerrarla desde un efecto está prohibido acá. */}
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              {resultado?.ok ? 'Cerrar' : 'Cancelar'}
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Registrar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
