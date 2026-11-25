'use client'

import { FileCheck2, Printer } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { Campo } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { ALMACENES, esAlmacen } from '@/lib/dominio/almacen'
import { SIN_RESPUESTA, useEnvio } from '@/lib/envio'
import { cantidad, fechaHora } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'

import { cerrarSalidaConFormato } from './acciones'

export type SalidaParaCerrar = {
  id: string
  fecha: string | null
  material: string | null
  material_codigo: string | null
  unidad_medida: string | null
  salida: number | null
  codigo_unidad: string | null
  recibido_por_nombre: string | null
  almacen: string | null
  requerimiento_numero: string | null
  /** El SA-… impreso en la hoja; las salidas de antes de la serie no lo tienen. */
  numero_salida: string | null
}

const TIPOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/**
 * Las salidas de materia prima y de EPP que siguen abiertas. Cada una se
 * imprime con su formato, se firma a mano por el almacenero y por quien
 * recibe, y se cierra cargando el escaneo o la foto del formato firmado.
 */
export function SalidasPorCerrar({ salidas, puedeCerrar, almacen = null }: { salidas: SalidaParaCerrar[]; puedeCerrar: boolean; almacen?: string | null }) {
  // El aviso de la salida que se cerró vive aquí y no en su fila: al ponerse al
  // día la pantalla, la salida cerrada sale de la lista y se llevaba el aviso
  // con ella. Se pinta donde estaba la fila (`indice`) y se lleva el cursor y la
  // vista (`AvisoEnfocado`): arriba de la lista quedaba 560 px por encima de la
  // pantalla en el teléfono, y el cursor caía en la página con el botón que se
  // desmontó. La `key` de cada cierre lo vuelve a enfocar y a anunciar.
  const [cerrada, setCerrada] = useState<{ texto: string; vez: number; indice: number } | null>(null)
  // Con un almacén elegido lo dice, para que no parezca que no hay ninguna en los demás.
  const donde = almacen && esAlmacen(almacen) ? ` en ${ALMACENES[almacen].etiqueta}` : ''
  const filas = salidas.map((s, i) => (
    <Salida key={s.id} salida={s} puedeCerrar={puedeCerrar}
      alEmpezar={() => setCerrada(null)}
      alCerrar={(texto) => setCerrada((c) => ({ texto, vez: (c?.vez ?? 0) + 1, indice: i }))} />
  ))
  if (cerrada) {
    filas.splice(Math.min(cerrada.indice, filas.length), 0, (
      <li key={`cerrada-${cerrada.vez}`} className="py-3">
        <AvisoEnfocado>
          <FileCheck2 aria-hidden className="mr-1 inline size-4" />
          {cerrada.texto}
        </AvisoEnfocado>
      </li>
    ))
  }
  return (
    <div className="space-y-2">
      {filas.length > 0 && <ul className="divide-y divide-borde">{filas}</ul>}
      {salidas.length === 0 && (
        <p className="text-sm text-texto-suave">Ninguna salida abierta{donde}: las de materia prima y EPP tienen su formato firmado.</p>
      )}
    </div>
  )
}

function Salida({ salida, puedeCerrar, alEmpezar, alCerrar }: {
  salida: SalidaParaCerrar
  puedeCerrar: boolean
  /** Antes de enviar: el aviso de un cierre anterior ya no es lo último que pasó. */
  alEmpezar: () => void
  /** Lo que dice la lista cuando esta salida se cerró, aunque la fila ya no esté. */
  alCerrar: (texto: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  // Cerrada, la fila se va en el acto: sin esto quedaba un momento con «Cargar
  // firmado» hasta que la pantalla se ponía al día, y el aviso lo da la lista.
  const [cerrada, setCerrada] = useState(false)
  const def = esAlmacen(salida.almacen) ? ALMACENES[salida.almacen] : null

  const { alEnviar, enviando, error } = useEnvio(async (_previo, datos) => {
    const archivo = datos.get('formato')
    if (!(archivo instanceof File) || archivo.size === 0 || archivo.size > 10485760 || !TIPOS.includes(archivo.type)) {
      return { ok: false, error: 'Selecciona el formato firmado en PDF o foto (JPG, PNG o WebP) de hasta 10 MB.' }
    }
    const db = createClient()
    const { data, error: sesion } = await db.auth.getUser()
    // Sin señal, supabase-js devuelve el fallo como error de sesión: no es que haya terminado.
    if (sesion?.name === 'AuthRetryableFetchError') return { ok: false, error: SIN_RESPUESTA }
    if (sesion || !data.user) return { ok: false, error: 'Tu sesión terminó. Ingresa de nuevo.' }
    const extension = archivo.type === 'application/pdf' ? 'pdf' : archivo.type === 'image/jpeg' ? 'jpg' : archivo.type === 'image/png' ? 'png' : 'webp'
    const ruta = `${data.user.id}/${salida.id}-formato.${extension}`
    datos.delete('formato')
    datos.set('formato_ruta', ruta)
    return subirArchivoPrivado({
      bucket: 'evidencias-almacen', ruta, archivo, contentType: archivo.type,
      registrar: () => cerrarSalidaConFormato(null, datos),
    })
  }, (r) => {
    setAbierto(false)
    setCerrada(true)
    alCerrar(`${salida.numero_salida ? `${salida.numero_salida} · ` : ''}${salida.material ?? 'Material'} · ${cantidad(salida.salida)} ${salida.unidad_medida ?? ''}: ${r.mensaje ?? 'salida cerrada con su formato firmado.'}`)
  }, { siSeVa: { que: 'el formato firmado', enlace: 'Volver a la salida' }, documento: salida.id })

  if (cerrada) return null

  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-medium">
          {salida.numero_salida && <span className="mr-2 font-mono text-texto">{salida.numero_salida}</span>}
          {salida.material ?? 'Material'}
          <span className="ml-2 font-mono text-xs font-normal text-texto-tenue">{salida.material_codigo}</span>
        </p>
        <p className="tabular text-xs text-texto-suave">
          {cantidad(salida.salida)} {salida.unidad_medida ?? ''} · {salida.codigo_unidad ?? 'sin unidad'}
          {salida.requerimiento_numero ? ` · ${salida.requerimiento_numero}` : ''}
          {salida.recibido_por_nombre ? ` · recibió ${salida.recibido_por_nombre}` : ''} · {fechaHora(salida.fecha)}
        </p>
      </div>
      {def && <Insignia tono={def.tono}>{def.etiqueta}</Insignia>}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/almacen/movimientos/${salida.id}/formato`} target="_blank"
          className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-base)] border border-borde-fuerte px-3 text-sm font-medium text-texto hover:bg-superficie-2 sm:min-h-9">
          <Printer aria-hidden className="size-4" />Imprimir formato
        </Link>
        {puedeCerrar && (
          <Boton type="button" tamano="sm" variante={abierto ? 'secundario' : 'primario'} onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
            {abierto ? 'Cancelar' : 'Cargar firmado'}
          </Boton>
        )}
      </div>
      {abierto && puedeCerrar && (
        <form onSubmit={(e) => { alEmpezar(); alEnviar(e) }} className="flex w-full flex-wrap items-end gap-3">
          <input type="hidden" name="movimiento_id" value={salida.id} />
          <Campo etiqueta="Formato firmado (escaneo o foto)" htmlFor={`fmt-${salida.id}`} requerido
            ayuda="Firmado por el almacenero y por quien recibe." className="min-w-0 flex-1 basis-64">
            <ElegirArchivo id={`fmt-${salida.id}`} name="formato" accept="application/pdf,image/jpeg,image/png,image/webp" hastaMb={10} required />
          </Campo>
          <Boton type="submit" cargando={enviando}>Cerrar salida</Boton>
          {error && <p role="alert" className="w-full text-sm text-peligro">{error}</p>}
        </form>
      )}
    </li>
  )
}
