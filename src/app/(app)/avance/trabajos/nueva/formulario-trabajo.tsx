'use client'

import { useRouter } from 'next/navigation'

import { YaQuedo } from '@/components/estructura/ida-que-no-salio'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { navegarSiEsDeLaPestana, useEnvio } from '@/lib/envio'

import { registrarTrabajoSinOrden } from '../../acciones-flota'

/**
 * Un trabajo sin orden puede ser una unidad de un cliente o algo que el taller
 * implementa para sí. «Qué es» va primero porque vale para los dos; la placa y
 * quién la trajo, solo cuando es una unidad. La base exige al menos una de las
 * dos cosas —qué es, o la placa— para que el trabajo tenga nombre.
 *
 * Al registrar, la pantalla se va al trabajo recién creado: no hace falta
 * repintar esta. Y el formulario se traba: si la ida no sale, un segundo toque
 * registraba otro trabajo igual (`YaQuedo`).
 */
export function FormularioTrabajo() {
  const router = useRouter()
  const { alEnviar, enviando, resultado, error } = useEnvio(
    registrarTrabajoSinOrden,
    (r, desde) => {
      if (r.datos) {
        const { url, ...dicho } = idaAlTrabajo(r.datos.id)
        navegarSiEsDeLaPestana(router, url, desde, { ...dicho, juntoAlBoton: true })
      }
    },
    { refrescar: false },
  )
  const sinAbrir = resultado?.ok && !resultado.datos
  const entro = resultado?.ok && resultado.datos ? idaAlTrabajo(resultado.datos.id) : null

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <fieldset disabled={Boolean(entro)} className="min-w-0 space-y-4">
        <Campo
          etiqueta="Qué es"
          htmlFor="descripcion"
          ayuda="La unidad, o lo que se está implementando en el taller"
        >
          <Entrada
            id="descripcion"
            name="descripcion"
            autoComplete="off"
            placeholder="Volquete Volvo FMX 8x4 · Cabina de pintura nueva"
            maxLength={200}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Placa"
            htmlFor="placa"
            ayuda="Solo si es una unidad: como está en la tarjeta, ABC-123"
          >
            <Entrada
              id="placa"
              name="placa"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="ABC-123"
              maxLength={20}
            />
          </Campo>
          <Campo etiqueta="De quién es" htmlFor="cliente" ayuda="La empresa del cliente, o Metal Work si es del taller">
            <Entrada id="cliente" name="cliente" autoComplete="off" maxLength={200} />
          </Campo>
        </div>

        <Campo etiqueta="Quién la trajo" htmlFor="trajo" ayuda="Si es una unidad: nombre y celular del chofer">
          <Entrada id="trajo" name="trajo" autoComplete="off" maxLength={200} />
        </Campo>

        <Campo etiqueta="Qué se va a hacer" htmlFor="trabajo" requerido>
          <AreaTexto
            id="trabajo"
            name="trabajo"
            rows={3}
            required
            placeholder="Cambio de compuerta posterior y fisura en el lateral izquierdo."
          />
        </Campo>
      </fieldset>

      {(error || sinAbrir) && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error ?? 'El trabajo se registró pero no se pudo abrir.'}
        </p>
      )}

      <YaQuedo ida={entro} />

      <div className="flex justify-end gap-2 pt-1">
        <EnlaceBoton href="/avance/trabajos" variante="contorno">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" cargando={enviando} disabled={Boolean(entro)}>
          Registrar el trabajo
        </Boton>
      </div>
    </form>
  )
}

const idaAlTrabajo = (id: string) => ({ url: `/avance/trabajos/${id}`, dice: 'El trabajo quedó registrado.', enlace: 'Ver el trabajo' })
