'use client'

import { ArrowUpFromLine } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { cantidad } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'

import { registrarSalidaAlmacen } from './acciones'

export type MaterialParaSalida = { id: string; codigo: string; descripcion: string; unidad: string | null; disponible: number }
export type UnidadParaElegir = { id: string; nombre: string; vehiculo: string | null; ordenes: string | null }

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Salida de material sin solicitud de OT. Nada sale del almacén sin decir a qué
 * unidad va: un vehículo registrado o, si todavía no está en el sistema, su
 * código interno de fabricación o su placa.
 */
export function NuevaSalida({ materiales, unidades }: { materiales: MaterialParaSalida[]; unidades: UnidadParaElegir[] }) {
  const [abierta, setAbierta] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())
  const [materialId, setMaterialId] = useState('')
  const [destino, setDestino] = useState<'UNIDAD' | 'CODIGO'>(unidades.length > 0 ? 'UNIDAD' : 'CODIGO')
  const [unidadId, setUnidadId] = useState('')

  const { alEnviar, enviando, error, resultado } = useEnvio(async (_previo, datos) => {
    const archivo = datos.get('foto')
    if (!(archivo instanceof File) || archivo.size === 0 || archivo.size > 10485760 || !TIPOS_FOTO.includes(archivo.type)) {
      return { ok: false, error: 'Selecciona una foto JPG, PNG o WebP de hasta 10 MB.' }
    }
    const db = createClient()
    const { data, error: sesion } = await db.auth.getUser()
    if (sesion || !data.user) return { ok: false, error: 'Tu sesión terminó. Ingresa de nuevo.' }
    const extension = archivo.type === 'image/jpeg' ? 'jpg' : archivo.type === 'image/png' ? 'png' : 'webp'
    const ruta = `${data.user.id}/${String(datos.get('operacion_id'))}.${extension}`
    datos.delete('foto')
    datos.set('foto_ruta', ruta)
    return subirArchivoPrivado({
      bucket: 'evidencias-almacen', ruta, archivo, contentType: archivo.type,
      registrar: () => registrarSalidaAlmacen(null, datos),
    })
  }, () => {
    setId(crypto.randomUUID())
    setMaterialId('')
    setUnidadId('')
    setAbierta(false)
  })

  const elegido = materiales.find((m) => m.id === materialId)
  const conSaldo = materiales.filter((m) => m.disponible > 0)

  return (
    <>
      <Boton variante="secundario" onClick={() => setAbierta(true)}>
        <ArrowUpFromLine aria-hidden className="size-4" />Registrar salida
      </Boton>
      {resultado?.ok && <p role="status" className="mt-2 text-sm text-exito">{resultado.mensaje}</p>}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Salida de almacén"
        descripcion="Lo que sale sin solicitud de OT. Toda salida queda vinculada a un vehículo o al código de la unidad."
        ancho="lg"
      >
        <form key={id} onSubmit={alEnviar} className="space-y-5">
          <input type="hidden" name="operacion_id" value={id} />
          <input type="hidden" name="destino" value={destino} />

          <Campo etiqueta="Material" htmlFor="sal-material" requerido
            ayuda={conSaldo.length === 0 ? 'No hay materiales con saldo libre. Registra primero su ingreso.' : undefined}>
            <SeleccionBuscable
              id="sal-material"
              name="material_id"
              requerido
              permiteVaciar={false}
              valor={materialId}
              onChange={setMaterialId}
              marcador="Elige el material"
              marcadorBusqueda="Código o descripción"
              opciones={conSaldo.map((m) => ({
                valor: m.id,
                etiqueta: m.descripcion,
                detalle: `${m.codigo} · libre ${cantidad(m.disponible)} ${m.unidad ?? ''}`,
              }))}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta={`Cantidad${elegido?.unidad ? ` (${elegido.unidad})` : ''}`} htmlFor="sal-cantidad" requerido
              ayuda={elegido ? `Libre en almacén: ${cantidad(elegido.disponible)}` : undefined}>
              <Entrada id="sal-cantidad" name="cantidad" type="number" inputMode="decimal" min={0.001} step="0.001"
                max={elegido?.disponible} required />
            </Campo>
            <Campo etiqueta="Motivo o vale" htmlFor="sal-motivo" requerido>
              <Entrada id="sal-motivo" name="motivo" required minLength={3} maxLength={200} placeholder="Ej.: Vale 0045, discos de corte" />
            </Campo>
          </div>

          <fieldset className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
            <legend className="px-1 text-sm font-medium text-texto">¿A qué unidad va? <span className="text-peligro">*</span></legend>
            <div role="group" aria-label="Destino de la salida" className="flex flex-wrap gap-2">
              <Boton type="button" tamano="sm" variante={destino === 'UNIDAD' ? 'primario' : 'contorno'}
                aria-pressed={destino === 'UNIDAD'} onClick={() => setDestino('UNIDAD')} disabled={unidades.length === 0}>
                Vehículo registrado
              </Boton>
              <Boton type="button" tamano="sm" variante={destino === 'CODIGO' ? 'primario' : 'contorno'}
                aria-pressed={destino === 'CODIGO'} onClick={() => setDestino('CODIGO')}>
                Código de unidad
              </Boton>
            </div>
            {destino === 'UNIDAD' ? (
              <Campo etiqueta="Vehículo" htmlFor="sal-unidad" requerido>
                <SeleccionBuscable
                  id="sal-unidad"
                  name="unidad_id"
                  requerido
                  permiteVaciar={false}
                  valor={unidadId}
                  onChange={setUnidadId}
                  marcador="Elige el vehículo"
                  marcadorBusqueda="Placa, código interno u OT"
                  opciones={unidades.map((u) => ({
                    valor: u.id,
                    etiqueta: u.nombre,
                    detalle: [u.vehiculo, u.ordenes ? `OT ${u.ordenes}` : null].filter(Boolean).join(' · ') || null,
                  }))}
                />
              </Campo>
            ) : (
              <Campo etiqueta="Código de la unidad" htmlFor="sal-codigo" requerido
                ayuda="El código interno de fabricación (VSC_SR_O4_6_26/30) o la placa. Si coincide con una unidad registrada, se vincula a ella.">
                <Entrada id="sal-codigo" name="codigo_unidad" required minLength={3} maxLength={60} autoComplete="off"
                  className="uppercase" placeholder="VSC_SR_O4_6_26/30" />
              </Campo>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Nombre de quien recibe" htmlFor="sal-recibe" requerido>
              <Entrada id="sal-recibe" name="recibido_por_nombre" required minLength={3} maxLength={160} />
            </Campo>
            <Campo etiqueta="Foto de la salida" htmlFor="sal-foto" requerido ayuda="Hasta 10 MB; que se vea el material.">
              <Entrada id="sal-foto" name="foto" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required />
            </Campo>
          </div>

          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          <Boton type="submit" cargando={enviando} disabled={conSaldo.length === 0}>Confirmar salida</Boton>
        </form>
      </Ventana>
    </>
  )
}
