'use client'

import { Ban, CheckCheck, PencilLine, Play } from 'lucide-react'
import { useState } from 'react'

import { CodigoInternoConLista } from '@/components/codigo-interno/elegir-codigo'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { AYUDA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { CODIGOS_FIJOS, type CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { NO_SUJETA, type DetraccionDeServicio, type TipoDetraccion } from '@/lib/dominio/detraccion'
import { useAccion, useEnvio } from '@/lib/envio'

import { avanzarOrdenServicio, corregirOrdenServicio } from './acciones'
import { SelectorDetraccion } from './selector-detraccion'

type Paso = 'CONFORME' | 'ANULADA'

/** Lo que Logística marca en una orden de servicio: que empezó, que volvió conforme o que se anula. */
export function AvanceServicio({
  id,
  numero,
  iniciar,
  conformar,
  anular,
}: {
  id: string
  numero: string
  iniciar: boolean
  conformar: boolean
  anular: boolean
}) {
  const [paso, setPaso] = useState<Paso | null>(null)
  const inicio = useAccion(avanzarOrdenServicio, undefined, { documento: id })
  const cierre = useEnvio(avanzarOrdenServicio, () => setPaso(null))

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {iniciar && (
        <Boton
          type="button"
          variante="secundario"
          tamano="sm"
          cargando={inicio.enviando}
          onClick={() => {
            const datos = new FormData()
            datos.set('id', id)
            datos.set('paso', 'EN_EJECUCION')
            inicio.ejecutar(datos)
          }}
        >
          <Play aria-hidden className="size-4" />
          En ejecución
        </Boton>
      )}
      {conformar && (
        <Boton type="button" variante="secundario" tamano="sm" onClick={() => setPaso('CONFORME')}>
          <CheckCheck aria-hidden className="size-4" />
          Conforme
        </Boton>
      )}
      {anular && (
        // Sin borde: corrige un error y no pesa como el paso de la OS.
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setPaso('ANULADA')}>
          <Ban aria-hidden className="size-4 text-peligro" />
          Anular
        </Boton>
      )}
      {inicio.error && (
        <p role="alert" className="basis-full text-right text-xs text-peligro">
          {inicio.error}
        </p>
      )}
      <Ventana
        abierta={paso !== null}
        alCerrar={() => setPaso(null)}
        titulo={paso === 'ANULADA' ? `Anular la orden de servicio ${numero}` : `Conformidad de la orden de servicio ${numero}`}
        descripcion={
          paso === 'ANULADA'
            ? 'No se borra: queda con su número, el motivo, quién y cuándo.'
            : 'El trabajo volvió bien. Con la conformidad, Tesorería puede pagarla.'
        }
        ancho="md"
      >
        <form onSubmit={cierre.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="paso" value={paso ?? ''} />
          <Campo
            etiqueta={paso === 'ANULADA' ? 'Motivo' : 'Observación (opcional)'}
            htmlFor={`os-nota-${id}`}
            requerido={paso === 'ANULADA'}
          >
            <AreaTexto
              id={`os-nota-${id}`}
              name="nota"
              required={paso === 'ANULADA'}
              minLength={paso === 'ANULADA' ? 10 : undefined}
              maxLength={500}
              placeholder={paso === 'ANULADA' ? 'Por ejemplo: el proveedor no puede hacerlo a tiempo; se encarga a otro.' : undefined}
            />
          </Campo>
          {cierre.error && (
            <p role="alert" className="text-sm text-peligro">
              {cierre.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setPaso(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante={paso === 'ANULADA' ? 'peligro' : 'primario'} cargando={cierre.enviando}>
              {paso === 'ANULADA' ? 'Anular' : 'Registrar conformidad'}
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}

/**
 * Corregir el código interno (Logística, antes de la conformidad) o la
 * detracción (Logística o Contabilidad). La base decide qué puede cada uno.
 */
export function CorregirServicio({
  id,
  numero,
  codigoInterno,
  detraccion,
  montoSinIgvPen,
  enDolares,
  tipos,
  codigos,
  cambiaCodigo,
}: {
  id: string
  numero: string
  codigoInterno: string | null
  detraccion: DetraccionDeServicio
  montoSinIgvPen: number | null
  enDolares: boolean
  tipos: TipoDetraccion[]
  /** Para el buscador de código interno; `null` si no se pudo leer o no se cambia el código. */
  codigos: CodigoParaElegir[] | null
  cambiaCodigo: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const envio = useEnvio(corregirOrdenServicio, () => setAbierta(false))
  const inicial = detraccion.afecta === null ? '' : detraccion.afecta ? (detraccion.codigo ?? '') : NO_SUJETA

  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <PencilLine aria-hidden className="size-4" />
        {cambiaCodigo ? 'Código y detracción' : 'Detracción'}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`${cambiaCodigo ? 'Código y detracción' : 'Detracción'} de la orden de servicio ${numero}`}
        descripcion="Si eliges otra vez el mismo tipo, la orden conserva el porcentaje con que se emitió."
        ancho="md"
      >
        {/* La clave rehace el formulario cada vez que se abre, con lo que la orden tiene ahora. */}
        <form key={vez} onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          {cambiaCodigo && (
            <Campo etiqueta="Código interno" htmlFor={`os-codigo-${id}`} requerido ayuda={AYUDA_CODIGO_INTERNO}>
              <CodigoInternoConLista
                id={`os-codigo-${id}`}
                name="codigo_interno"
                requerido
                valorInicial={codigoInterno ?? ''}
                codigos={codigos}
                fijos={CODIGOS_FIJOS}
              />
            </Campo>
          )}
          <SelectorDetraccion
            id={`os-detraccion-${id}`}
            tipos={tipos}
            inicial={inicial}
            motivoInicial={detraccion.motivo ?? ''}
            montoSinIgvPen={montoSinIgvPen}
            enDolares={enDolares}
          />
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
