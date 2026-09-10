'use client'

import { useRouter } from 'next/navigation'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { useEnvio } from '@/lib/envio'

import { registrarUnidadSinOrden } from '../../acciones-flota'

/**
 * Al registrar, la pantalla se va a la unidad recién creada: no hace falta
 * repintar esta.
 */
export function FormularioUnidad() {
  const router = useRouter()
  const { alEnviar, enviando, resultado, error } = useEnvio(
    registrarUnidadSinOrden,
    (r) => {
      if (r.datos) router.push(`/avance/flota/${r.datos.id}`)
    },
    { refrescar: false },
  )
  const sinAbrir = resultado?.ok && !resultado.datos

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          etiqueta="Placa"
          htmlFor="placa"
          ayuda="Como está en la tarjeta: ABC-123. Si no tiene, déjala vacía y describe la unidad."
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
        <Campo etiqueta="Qué unidad es" htmlFor="descripcion">
          <Entrada
            id="descripcion"
            name="descripcion"
            autoComplete="off"
            placeholder="Volquete Volvo FMX 8x4, tolva de 20 m³"
            maxLength={200}
          />
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="De quién es" htmlFor="cliente" ayuda="La empresa, como la nombra el chofer">
          <Entrada id="cliente" name="cliente" autoComplete="off" maxLength={200} />
        </Campo>
        <Campo etiqueta="Quién la trajo" htmlFor="trajo" ayuda="Nombre y celular del chofer">
          <Entrada id="trajo" name="trajo" autoComplete="off" maxLength={200} />
        </Campo>
      </div>

      <Campo etiqueta="A qué entró" htmlFor="trabajo" requerido>
        <AreaTexto
          id="trabajo"
          name="trabajo"
          rows={3}
          required
          placeholder="Cambio de compuerta posterior y fisura en el lateral izquierdo."
        />
      </Campo>

      {(error || sinAbrir) && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error ?? 'La unidad se registró pero no se pudo abrir.'}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <EnlaceBoton href="/avance/flota" variante="contorno">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" cargando={enviando}>
          Registrar la unidad
        </Boton>
      </div>
    </form>
  )
}
