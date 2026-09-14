'use client'

import { Boton } from '@/components/ui/boton'
import { Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'

import { ponerClienteAOrden } from '../acciones'

/**
 * La orden que abrió el taller puede no tener cliente: el taller no lo ve
 * (migración 100). La oficina se lo pone acá; si la unidad tampoco tenía
 * dueño, la base se lo pone a ella también.
 */
export function PonerCliente({
  ordenId,
  clientes,
}: {
  ordenId: string
  clientes: { id: string; razon_social: string }[]
}) {
  const { alEnviar, enviando, error } = useEnvio(ponerClienteAOrden)

  return (
    <form onSubmit={alEnviar} className="space-y-2 py-2">
      <input type="hidden" name="orden_id" value={ordenId} />
      <p className="text-xs text-texto-suave">
        La abrió el taller sin cliente. Ponlo cuando se sepa: hace falta para cobrar y para entregar.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Seleccion
          name="cliente_id"
          required
          defaultValue=""
          aria-label="Cliente de la orden"
          className="min-w-0 flex-1"
        >
          <option value="" disabled>
            Elige el cliente
          </option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razon_social}
            </option>
          ))}
        </Seleccion>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Poner el cliente
        </Boton>
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error}
        </p>
      )}
    </form>
  )
}
