'use client'

import { Pencil } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { guardarDatosDeCuenta } from './acciones'

/** El lápiz de una cuenta y su ventana con el DNI. */
export function EditarDatosDeCuenta({ usuarioId, nombre, documento }: { usuarioId: string; nombre: string; documento: string | null }) {
  const [abierta, setAbierta] = useState(false)
  const envio = useEnvio(guardarDatosDeCuenta, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Cambiar el DNI de ${nombre}`} onClick={() => setAbierta(true)}>
        <Pencil aria-hidden className="size-4" />
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={nombre}
        descripcion="El DNI de su cuenta. Solo lo ven Recursos Humanos y el administrador."
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="usuario_id" value={usuarioId} />
          <Campo etiqueta="DNI o carné de extranjería" htmlFor={`doc-${usuarioId}`}>
            <Entrada id={`doc-${usuarioId}`} name="documento" maxLength={20} autoComplete="off" defaultValue={documento ?? ''} className="tabular" />
          </Campo>
          {envio.error && (
            <p role="alert" className="text-sm text-peligro">
              {envio.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={envio.enviando}>
              Guardar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
