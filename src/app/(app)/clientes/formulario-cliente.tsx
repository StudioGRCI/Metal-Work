'use client'

import { useActionState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { Tablas } from '@/types/database'

import { guardarCliente } from './acciones'

const DEPARTAMENTOS = [
  'Amazonas', 'Áncash', 'Apurímac', 'Arequipa', 'Ayacucho', 'Cajamarca', 'Callao', 'Cusco',
  'Huancavelica', 'Huánuco', 'Ica', 'Junín', 'La Libertad', 'Lambayeque', 'Lima', 'Loreto',
  'Madre de Dios', 'Moquegua', 'Pasco', 'Piura', 'Puno', 'San Martín', 'Tacna', 'Tumbes', 'Ucayali',
]

export function FormularioCliente({ cliente }: { cliente?: Tablas<'clientes'> }) {
  const [resultado, ejecutar, pendiente] = useActionState(guardarCliente, null)
  const editando = Boolean(cliente)

  return (
    <form action={ejecutar} className="max-w-3xl space-y-4">
      {cliente && <input type="hidden" name="id" value={cliente.id} />}

      <Tarjeta>
        <TarjetaCabecera titulo="Identificación" />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-3">
          <Campo etiqueta="Tipo de documento" htmlFor="tipo_documento" requerido>
            <Seleccion
              id="tipo_documento"
              name="tipo_documento"
              defaultValue={cliente?.tipo_documento ?? 'RUC'}
            >
              <option value="RUC">RUC</option>
              <option value="DNI">DNI</option>
              <option value="CE">Carné de extranjería</option>
              <option value="PASAPORTE">Pasaporte</option>
            </Seleccion>
          </Campo>

          <Campo etiqueta="Número" htmlFor="numero_documento" requerido>
            <Entrada
              id="numero_documento"
              name="numero_documento"
              required
              inputMode="numeric"
              autoComplete="off"
              defaultValue={cliente?.numero_documento ?? ''}
              className="tabular"
              placeholder="20512345678"
            />
          </Campo>

          <Campo
            etiqueta="Condición de pago"
            htmlFor="condicion_pago_dias"
            ayuda="Días de crédito; 0 es contado"
          >
            <Entrada
              id="condicion_pago_dias"
              name="condicion_pago_dias"
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              defaultValue={cliente?.condicion_pago_dias ?? 0}
              className="tabular text-right"
            />
          </Campo>

          <Campo etiqueta="Razón social" htmlFor="razon_social" requerido className="sm:col-span-2">
            <Entrada
              id="razon_social"
              name="razon_social"
              required
              minLength={3}
              autoComplete="off"
              defaultValue={cliente?.razon_social ?? ''}
              placeholder="TRANSPORTES ANDINOS S.A.C."
            />
          </Campo>

          <Campo etiqueta="Nombre comercial" htmlFor="nombre_comercial">
            <Entrada
              id="nombre_comercial"
              name="nombre_comercial"
              autoComplete="off"
              defaultValue={cliente?.nombre_comercial ?? ''}
            />
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Contacto y ubicación" />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-3">
          <Campo etiqueta="Dirección fiscal" htmlFor="direccion_fiscal" className="sm:col-span-3">
            <Entrada
              id="direccion_fiscal"
              name="direccion_fiscal"
              autoComplete="off"
              defaultValue={cliente?.direccion_fiscal ?? ''}
            />
          </Campo>

          <Campo etiqueta="Distrito" htmlFor="distrito">
            <Entrada
              id="distrito"
              name="distrito"
              autoComplete="off"
              defaultValue={cliente?.distrito ?? ''}
            />
          </Campo>

          <Campo etiqueta="Provincia" htmlFor="provincia">
            <Entrada
              id="provincia"
              name="provincia"
              autoComplete="off"
              defaultValue={cliente?.provincia ?? ''}
            />
          </Campo>

          <Campo etiqueta="Departamento" htmlFor="departamento">
            <Seleccion
              id="departamento"
              name="departamento"
              defaultValue={cliente?.departamento ?? ''}
            >
              <option value="">Sin especificar</option>
              {DEPARTAMENTOS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Teléfono" htmlFor="telefono">
            <Entrada
              id="telefono"
              name="telefono"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              defaultValue={cliente?.telefono ?? ''}
            />
          </Campo>

          <Campo etiqueta="Correo electrónico" htmlFor="correo" className="sm:col-span-2">
            {/* Sin autocompletado: el navegador ofrece el correo de quien está
                dentro del sistema, y este es el correo del cliente. */}
            <Entrada
              id="correo"
              name="correo"
              type="email"
              autoComplete="off"
              defaultValue={cliente?.correo ?? ''}
            />
          </Campo>

          <Campo etiqueta="Observaciones" htmlFor="observaciones" className="sm:col-span-3">
            <AreaTexto
              id="observaciones"
              name="observaciones"
              rows={2}
              defaultValue={cliente?.observaciones ?? ''}
            />
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      {resultado && !resultado.ok && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          {resultado.error}
        </p>
      )}
      {resultado?.ok && resultado.mensaje && (
        <p className="rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          {resultado.mensaje}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <EnlaceBoton href={cliente ? `/clientes/${cliente.id}` : '/clientes'} variante="fantasma">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" cargando={pendiente}>
          {editando ? 'Guardar cambios' : 'Registrar cliente'}
        </Boton>
      </div>
    </form>
  )
}
