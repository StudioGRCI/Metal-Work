'use client'

import { ArrowDown, ArrowUp, FileUp, ListPlus, Save, XCircle } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { ConfirmarAccion, Ventana } from '@/components/ui/ventana'
import { BUCKET_GUIAS_REMISION, MAXIMO_MB_GUIA, NUMERO_GUIA, normalizarNumeroGuia, rutaGuiaRemision } from '@/lib/dominio/logistica'
import { useAccion, useEnvio } from '@/lib/envio'
import { subirArchivoPrivado } from '@/lib/subida-privada'

import { anularGuiaRemision, programarRecojo, quitarDeLaLista, registrarGuiaRemision } from './acciones'

/**
 * El peso y el lugar en la lista del conductor. Sirve para programarla y,
 * ya programada, para cambiarle el peso o pasarla a otro lugar.
 *
 * `cuantas` es cuántas hay en la lista contando esta: los lugares que se le
 * pueden dar.
 */
export function ProgramarRecojo({
  id,
  peso,
  lugar,
  cuantas,
  pesoFijo,
}: {
  id: string
  peso: number | null
  lugar: number | null
  cuantas: number
  /** Con la guía emitida el peso ya no cambia: la guía se hizo con ese peso. */
  pesoFijo: boolean
}) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(programarRecojo, (r) => setMensaje(r.mensaje ?? null))
  const programada = lugar !== null
  return (
    // La clave rehace el formulario cuando la base le cambia el lugar o el
    // peso (otra OC pasó delante, una flecha): sin ella el desplegable se
    // quedaba con el lugar viejo y «Guardar» la devolvía ahí sin querer.
    <form
      key={`${lugar ?? 'fuera'}-${peso ?? 'sin-peso'}`}
      onSubmit={(e) => {
        setMensaje(null)
        alEnviar(e)
      }}
      className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,10rem)_auto] sm:items-end"
    >
      <input type="hidden" name="id" value={id} />
      <Campo etiqueta="Peso (kg)" htmlFor={`peso-${id}`} requerido ayuda={pesoFijo ? 'Ya hay guía con este peso.' : undefined}>
        <Entrada
          id={`peso-${id}`}
          name="peso"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej. 350"
          defaultValue={peso === null ? '' : String(peso)}
          readOnly={pesoFijo}
          required
          disabled={enviando}
        />
      </Campo>
      <Campo etiqueta="Lugar en la lista" htmlFor={`lugar-${id}`}>
        <Seleccion id={`lugar-${id}`} name="lugar" defaultValue={lugar === null ? '' : String(lugar)} disabled={enviando}>
          {!programada && <option value="">Al final ({cuantas}.º)</option>}
          {Array.from({ length: cuantas }, (_, i) => i + 1)
            .filter((n) => programada || n < cuantas)
            .map((n) => (
              <option key={n} value={n}>
                {n}.º{n === 1 ? ' (la primera)' : ''}
              </option>
            ))}
        </Seleccion>
      </Campo>
      <Boton type="submit" variante={programada ? 'secundario' : 'primario'} cargando={enviando}>
        {programada ? <Save aria-hidden className="size-4" /> : <ListPlus aria-hidden className="size-4" />}
        {programada ? 'Guardar' : 'Poner en la lista'}
      </Boton>
      {error && (
        <p role="alert" className="text-sm text-peligro sm:col-span-3">
          {error}
        </p>
      )}
      {mensaje && !error && (
        <p role="status" className="text-sm text-exito sm:col-span-3">
          {mensaje}
        </p>
      )}
    </form>
  )
}

/** Subir o bajar un lugar sin abrir nada: el mismo programar, con el peso que ya tiene. */
export function MoverEnLista({ id, peso, lugar, cuantas, numero }: { id: string; peso: number; lugar: number; cuantas: number; numero: string }) {
  const accion = useAccion(programarRecojo)
  function mover(destino: number) {
    const datos = new FormData()
    datos.set('id', id)
    datos.set('peso', String(peso))
    datos.set('lugar', String(destino))
    accion.ejecutar(datos)
  }
  return (
    <div className="flex items-center gap-1">
      <Boton
        type="button"
        variante="contorno"
        tamano="icono"
        aria-label={`Subir ${numero} un lugar`}
        disabled={lugar <= 1 || accion.enviando}
        onClick={() => mover(lugar - 1)}
      >
        <ArrowUp aria-hidden className="size-4" />
      </Boton>
      <Boton
        type="button"
        variante="contorno"
        tamano="icono"
        aria-label={`Bajar ${numero} un lugar`}
        disabled={lugar >= cuantas || accion.enviando}
        onClick={() => mover(lugar + 1)}
      >
        <ArrowDown aria-hidden className="size-4" />
      </Boton>
      {accion.error && (
        <p role="alert" className="text-xs text-peligro">
          {accion.error}
        </p>
      )}
    </div>
  )
}

/** Sacarla de la lista del conductor: pide confirmar, porque a él le llega el aviso. */
export function QuitarDeLaLista({ id, numero }: { id: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const accion = useAccion(quitarDeLaLista, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)}>
        <XCircle aria-hidden className="size-4" />
        Sacar de la lista
      </Boton>
      {accion.error && !abierta && (
        <p role="alert" className="text-xs text-peligro">
          {accion.error}
        </p>
      )}
      <ConfirmarAccion
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`¿Sacar ${numero} de la lista del conductor?`}
        detalle="Al conductor le llega el aviso de que no salga a recogerla. Se queda con su peso; la puedes volver a poner cuando quieras."
        etiquetaConfirmar="Sí, sacarla"
        trabajando={accion.enviando}
        alConfirmar={() => {
          const datos = new FormData()
          datos.set('id', id)
          accion.ejecutar(datos)
        }}
      />
    </>
  )
}

/**
 * Contabilidad carga la guía: número, fecha de emisión y el PDF. El PDF sube
 * primero al almacenamiento y después la acción lo comprueba y lo registra; si
 * el registro falla, el PDF suelto se retira (ver `subirArchivoPrivado`).
 */
export function CargarGuia({ ordenCompraId, solicitudId, hoy }: { ordenCompraId: string; solicitudId: string; hoy: string }) {
  const [id, setId] = useState(solicitudId)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(
    async (_previo, datos) => {
      setMensaje(null)
      const numero = normalizarNumeroGuia(String(datos.get('numero') ?? ''))
      if (!NUMERO_GUIA.test(numero)) {
        return { ok: false, error: 'Escribe el número de la guía como figura en ella: serie y número, por ejemplo T001-00000123.' }
      }
      const archivo = datos.get('archivo')
      if (
        !(archivo instanceof File) ||
        archivo.size < 1 ||
        archivo.size > MAXIMO_MB_GUIA * 1024 * 1024 ||
        (await archivo.slice(0, 5).text()) !== '%PDF-'
      ) {
        return { ok: false, error: `Elige el PDF de la guía, de hasta ${MAXIMO_MB_GUIA} MB.` }
      }
      datos.delete('archivo')
      datos.set('numero', numero)
      datos.set('nombre_archivo', archivo.name.trim().slice(0, 200) || `${numero}.pdf`)
      return subirArchivoPrivado({
        bucket: BUCKET_GUIAS_REMISION,
        ruta: rutaGuiaRemision(ordenCompraId, id),
        archivo,
        contentType: 'application/pdf',
        registrar: () => registrarGuiaRemision(null, datos),
      })
    },
    (r) => {
      setMensaje(r.mensaje ?? 'Guía cargada.')
      setId(crypto.randomUUID())
    },
  )
  return (
    <form
      key={id}
      onSubmit={alEnviar}
      className="grid gap-3 rounded-[var(--radius-base)] border border-borde bg-superficie-2 p-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-end"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="orden_compra_id" value={ordenCompraId} />
      <Campo etiqueta="N.º de guía" htmlFor={`guia-numero-${ordenCompraId}`} requerido>
        <Entrada
          id={`guia-numero-${ordenCompraId}`}
          name="numero"
          placeholder="T001-00000123"
          autoComplete="off"
          autoCapitalize="characters"
          required
          disabled={enviando}
        />
      </Campo>
      <Campo etiqueta="Emitida el" htmlFor={`guia-fecha-${ordenCompraId}`} requerido>
        <Entrada id={`guia-fecha-${ordenCompraId}`} name="fecha" type="date" max={hoy} defaultValue={hoy} required disabled={enviando} />
      </Campo>
      <Campo etiqueta="PDF de la guía" htmlFor={`guia-pdf-${ordenCompraId}`} requerido>
        <ElegirArchivo id={`guia-pdf-${ordenCompraId}`} name="archivo" accept="application/pdf,.pdf" hastaMb={MAXIMO_MB_GUIA} required disabled={enviando} />
      </Campo>
      <Boton type="submit" cargando={enviando}>
        <FileUp aria-hidden className="size-4" />
        Cargar guía
      </Boton>
      {error && (
        <p role="alert" className="text-sm text-peligro sm:col-span-4">
          {error}
        </p>
      )}
      {mensaje && !error && (
        <p role="status" className="text-sm text-exito sm:col-span-4">
          {mensaje}
        </p>
      )}
    </form>
  )
}

/** Anular una guía mal emitida, con su motivo. Queda como evidencia. */
export function AnularGuia({ id, numero }: { id: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularGuiaRemision, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)}>
        <XCircle aria-hidden className="size-4" />
        Anular guía
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular la guía ${numero}`}
        descripcion="La guía queda en el sistema como anulada, con su motivo, y al conductor le llega el aviso de que ya no vale. Después cargas la buena."
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Por qué se anula" htmlFor={`motivo-guia-${id}`} requerido>
            <AreaTexto id={`motivo-guia-${id}`} name="motivo" rows={3} minLength={5} maxLength={500} required disabled={enviando} />
          </Campo>
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular guía
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
