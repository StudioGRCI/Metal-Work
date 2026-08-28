'use client'

import { Camera, Plus, X } from 'lucide-react'
import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

import { registrarAvance } from './acciones'

export type EtapaElegible = { id: string; nombre: string; estado: string; avance: number }

type FotoLista = {
  archivo: File
  vistaPrevia: string
  ruta?: string
  subiendo: boolean
  error?: string
}

const MAXIMO_MB = 10
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

/**
 * El parte visual del día. La foto viaja del navegador a Storage sin pasar por
 * el servidor de la aplicación, igual que los documentos; acá solo se guarda su
 * ubicación cuando el avance se registra.
 */
export function RegistrarAvance({
  ordenId,
  etapas,
  compacto = false,
}: {
  ordenId: string
  etapas: EtapaElegible[]
  compacto?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [fotos, setFotos] = useState<FotoLista[]>([])
  const [etapaId, setEtapaId] = useState('')
  const [resultado, accion, enviando] = useActionState(registrarAvance, null)

  const hoy = new Date().toISOString().slice(0, 10)
  const enCurso = etapas.filter((e) => !['TERMINADA', 'OMITIDA'].includes(e.estado))

  async function agregar(lista: FileList | null) {
    if (!lista) return
    const supabase = createClient()

    for (const archivo of Array.from(lista)) {
      if (!TIPOS.includes(archivo.type)) {
        setFotos((f) => [
          ...f,
          { archivo, vistaPrevia: '', subiendo: false, error: 'Solo fotos JPG, PNG o WEBP.' },
        ])
        continue
      }
      if (archivo.size > MAXIMO_MB * 1024 * 1024) {
        setFotos((f) => [
          ...f,
          {
            archivo,
            vistaPrevia: '',
            subiendo: false,
            error: `La foto pesa más de ${MAXIMO_MB} MB.`,
          },
        ])
        continue
      }

      const vistaPrevia = URL.createObjectURL(archivo)
      setFotos((f) => [...f, { archivo, vistaPrevia, subiendo: true }])

      // La ruta empieza por ot/{orden_id}: las políticas de Storage se apoyan
      // en esa convención para decidir quién puede ver la foto.
      const extension = (archivo.name.split('.').pop() ?? 'jpg').toLowerCase()
      const ruta = `ot/${ordenId}/avance/${crypto.randomUUID()}.${extension}`

      const { error } = await supabase.storage
        .from('fotos-avance')
        .upload(ruta, archivo, { contentType: archivo.type, upsert: false })

      setFotos((f) =>
        f.map((item) =>
          item.archivo === archivo
            ? {
                ...item,
                subiendo: false,
                ruta: error ? undefined : ruta,
                error: error ? 'No se pudo subir la foto.' : undefined,
              }
            : item,
        ),
      )
    }
  }

  async function quitar(foto: FotoLista) {
    if (foto.ruta) {
      const supabase = createClient()
      await supabase.storage.from('fotos-avance').remove([foto.ruta])
    }
    if (foto.vistaPrevia) URL.revokeObjectURL(foto.vistaPrevia)
    setFotos((f) => f.filter((item) => item !== foto))
  }

  const subidas = fotos.filter((f) => f.ruta)

  return (
    <>
      <Boton tamano={compacto ? 'sm' : undefined} variante={compacto ? 'secundario' : undefined} onClick={() => setAbierto(true)}>
        <Camera aria-hidden className={compacto ? 'size-3.5' : 'size-4'} />
        Registrar avance
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Avance del día"
        descripcion="Qué se hizo hoy en esta unidad. Con la foto, el cliente y la gerencia ven cómo va sin tener que bajar al taller."
        ancho="lg"
      >
        <form
          action={(datos) => {
            datos.set(
              'fotos',
              JSON.stringify(
                subidas.map((f) => ({
                  ruta_storage: f.ruta,
                  nombre_archivo: f.archivo.name,
                  mime_type: f.archivo.type,
                  tamano_bytes: f.archivo.size,
                })),
              ),
            )
            return accion(datos)
          }}
          className="space-y-3"
        >
          <input type="hidden" name="orden_id" value={ordenId} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Fecha" htmlFor="fecha" requerido>
              <Entrada id="fecha" name="fecha" type="date" required defaultValue={hoy} max={hoy} />
            </Campo>
            <Campo etiqueta="Etapa" htmlFor="etapa_id" ayuda="En qué está la unidad ahora">
              <Seleccion
                id="etapa_id"
                name="etapa_id"
                value={etapaId}
                onChange={(e) => setEtapaId(e.target.value)}
              >
                <option value="">Sin etapa en particular</option>
                {enCurso.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre} · {e.avance}%
                  </option>
                ))}
              </Seleccion>
            </Campo>
          </div>

          <Campo etiqueta="Qué se hizo" htmlFor="descripcion" requerido>
            <AreaTexto
              id="descripcion"
              name="descripcion"
              rows={3}
              required
              placeholder="Se soldaron los travesaños del piso y se dejó lista la compuerta para pintura."
            />
          </Campo>

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              etiqueta="Avance de la etapa"
              htmlFor="avance_porcentaje"
              ayuda={
                etapaId ? 'A cuánto quedó, de 0 a 100' : 'Elige primero la etapa'
              }
            >
              <Entrada
                id="avance_porcentaje"
                name="avance_porcentaje"
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                step="1"
                disabled={!etapaId}
                placeholder="60"
              />
            </Campo>
            <Campo
              etiqueta="¿Algo la traba?"
              htmlFor="impedimento"
              ayuda="Material que falta, plano pendiente, pieza en el proveedor"
            >
              <Entrada id="impedimento" name="impedimento" autoComplete="off" placeholder="Nada" />
            </Campo>
          </div>

          {/* -------------------------------------------------------- fotos */}
          <div>
            <p className="mb-1.5 text-sm font-medium text-texto">Fotos</p>
            <div className="flex flex-wrap gap-2">
              {fotos.map((foto, i) => (
                <div
                  key={`${foto.archivo.name}-${i}`}
                  className={cn(
                    'relative size-24 overflow-hidden rounded-[var(--radius-base)] border',
                    foto.error ? 'border-peligro' : 'border-borde',
                  )}
                >
                  {foto.vistaPrevia ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={foto.vistaPrevia}
                      alt={foto.archivo.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <p className="p-1.5 text-[10px] text-peligro">{foto.error}</p>
                  )}

                  {foto.subiendo && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] font-medium text-white">
                      subiendo…
                    </div>
                  )}

                  {/* Sin confirmación a propósito: la foto todavía no es parte de
                      ningún avance —el parte no se ha registrado— y se vuelve a
                      poner con el mismo botón de «Agregar» que está al lado. */}
                  <button
                    type="button"
                    onClick={() => quitar(foto)}
                    aria-label={`Quitar ${foto.archivo.name}`}
                    className="absolute top-1 right-1 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 sm:p-0.5"
                  >
                    <X aria-hidden className="size-3" />
                  </button>
                </div>
              ))}

              <label className="flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-base)] border border-dashed border-borde text-texto-suave hover:bg-superficie-2 hover:text-texto">
                <Plus aria-hidden className="size-5" />
                <span className="text-[11px]">Agregar</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    void agregar(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <p className="mt-1 text-[11px] text-texto-tenue">
              Desde el celular abre la cámara. Hasta {MAXIMO_MB} MB por foto.
            </p>
          </div>

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
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              {resultado?.ok ? 'Cerrar' : 'Cancelar'}
            </Boton>
            <Boton
              type="submit"
              cargando={enviando}
              disabled={fotos.some((f) => f.subiendo)}
            >
              Registrar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
