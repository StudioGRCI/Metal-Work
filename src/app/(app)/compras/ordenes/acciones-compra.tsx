'use client'

import { FileUp, Pencil, Truck } from 'lucide-react'
import { useState } from 'react'

import { SubirDocumentoCompra } from '@/app/(app)/materiales/atencion/subir-documento-compra'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { CamposDeCorreccion, useCorreccion } from '@/components/correcciones/justificante'
import { AYUDA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { comprobantePedido } from '@/lib/dominio/proveedores'
import { useAccion, useEnvio } from '@/lib/envio'

import { corregirCompra, lineasDeLaCompra, mandarARecojo, type LineaParaCorregir } from './acciones'

/**
 * Lo que Logística hace con una compra desde la lista: mandarla a recojo,
 * adjuntarle el comprobante y corregir si viene con factura o su código interno.
 */
export function AccionesCompra({
  id,
  numero,
  recojo,
  adjuntar,
  conFactura,
  codigoInterno,
  codigosDeInsumos,
  tieneComprobante,
  total,
  moneda,
  entregada,
}: {
  id: string
  numero: string
  /** El total con IGV (si va con factura) y la moneda: el detector compara la factura con ellos. */
  total: number
  moneda: string
  /** Se puede mandar a recojo: aprobada (o sin aprobación) y nadie la llevó todavía. */
  recojo: boolean
  adjuntar: boolean
  conFactura: boolean
  codigoInterno: string | null
  /** Compra insumos de RQ: el código es el de cada insumo y se corrige en su RQ, no aquí. */
  codigosDeInsumos: string[] | null
  /** Con el comprobante ya adjunto, lo de la factura queda fijo; el código interno no. */
  tieneComprobante: boolean
  /** El conductor ya la dejó en almacén: lo que entró no cambia de cantidad ni de precio. */
  entregada: boolean
}) {
  const [documentos, setDocumentos] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [lineas, setLineas] = useState<LineaParaCorregir[] | string | null>(null)
  async function abrirCorreccion() {
    setCorrigiendo(true)
    setLineas(null)
    const r = await lineasDeLaCompra(id).catch(() => null)
    setLineas(r?.ok ? (r.datos ?? []) : (r?.error ?? 'No se pudieron leer las líneas. Vuelve a abrir la corrección.'))
  }
  // El documento lleva un identificador fijo: un reintento no lo duplica. La
  // ventana desmonta el formulario al cerrarse, así que se guarda aquí, y cambia
  // solo cuando uno entró: si no, el segundo documento de la OC volvía con el
  // id y la ruta del primero.
  const [idDocumento, setIdDocumento] = useState(() => crypto.randomUUID())
  const envio = useAccion(mandarARecojo)

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {recojo && (
        <Boton
          type="button"
          variante="secundario"
          tamano="sm"
          cargando={envio.enviando}
          onClick={() => {
            const datos = new FormData()
            datos.set('id', id)
            envio.ejecutar(datos)
          }}
        >
          <Truck aria-hidden className="size-4" />
          Mandar a recojo
        </Boton>
      )}
      {adjuntar && (
        <Boton type="button" variante="contorno" tamano="sm" onClick={() => setDocumentos(true)}>
          <FileUp aria-hidden className="size-4" />
          Adjuntar
        </Boton>
      )}
      {adjuntar && (
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => void abrirCorreccion()} aria-label={`Corregir la compra ${numero}`}>
          <Pencil aria-hidden className="size-4" />
          Corregir
        </Boton>
      )}
      {envio.error && (
        <p role="alert" className="basis-full text-right text-xs text-peligro">
          {envio.error}
        </p>
      )}
      {envio.resultado?.ok && (
        <p role="status" className="basis-full text-right text-xs text-exito">
          {envio.resultado.mensaje}
        </p>
      )}
      <Ventana
        abierta={documentos}
        alCerrar={() => setDocumentos(false)}
        titulo={`Adjuntar a la compra ${numero}`}
        descripcion={
          conFactura
            ? 'La factura, o cualquier PDF de la compra. Queda en la compra y Tesorería lo ve para pagar.'
            : 'Es sin factura: adjunta la boleta, nota de venta o recibo. Queda en la compra y Tesorería lo ve para pagar.'
        }
        ancho="lg"
      >
        <SubirDocumentoCompra
          ordenCompraId={id}
          solicitudId={idDocumento}
          alAdjuntar={() => setIdDocumento(crypto.randomUUID())}
          tipoInicial={conFactura ? 'FACTURA' : 'COMPROBANTE'}
          orden={{ numero, total, moneda }}
        />
      </Ventana>
      <Ventana
        abierta={corrigiendo}
        alCerrar={() => setCorrigiendo(false)}
        titulo={`Corregir la compra ${numero}`}
        descripcion="Cambia solo lo que estaba mal. Queda en su historial con el motivo, quién, cuándo y el justificante."
        ancho="lg"
      >
        {corrigiendo && (
          <CorregirCompra
            id={id}
            conFactura={conFactura}
            codigoInterno={codigoInterno}
            codigosDeInsumos={codigosDeInsumos}
            tieneComprobante={tieneComprobante}
            moneda={moneda}
            entregada={entregada}
            lineas={lineas}
            alTerminar={() => setCorrigiendo(false)}
          />
        )}
      </Ventana>
    </div>
  )
}

function CorregirCompra({
  id,
  conFactura,
  codigoInterno,
  codigosDeInsumos,
  tieneComprobante,
  moneda,
  entregada,
  lineas,
  alTerminar,
}: {
  id: string
  conFactura: boolean
  codigoInterno: string | null
  codigosDeInsumos: string[] | null
  tieneComprobante: boolean
  moneda: string
  entregada: boolean
  /** null mientras se leen; un texto si no se pudieron leer. */
  lineas: LineaParaCorregir[] | string | null
  alTerminar: () => void
}) {
  const [factura, setFactura] = useState(conFactura)
  const [codigo, setCodigo] = useState(codigoInterno ?? '')
  const [valores, setValores] = useState<Record<string, { cantidad: string; precio: string }>>({})
  const { corregir, otra } = useCorreccion(id, corregirCompra)
  const { alEnviar, enviando, error } = useEnvio(corregir, () => {
    otra()
    alTerminar()
  })
  const lista = Array.isArray(lineas) ? lineas : []
  const valor = (l: LineaParaCorregir) =>
    valores[l.detalle_id] ?? { cantidad: String(l.cantidad), precio: l.precio_unitario === null ? '' : String(l.precio_unitario) }

  // Solo viaja lo que cambió: la base anota antes y después.
  const cambios: Record<string, unknown> = {}
  if (factura !== conFactura) cambios.con_factura = factura
  if (!codigosDeInsumos && codigo.trim() !== (codigoInterno ?? '')) cambios.codigo_interno = codigo.trim()
  const lineasCambiadas = lista.flatMap((l) => {
    const v = valor(l)
    const c: { detalle_id: string; cantidad?: number; precio_unitario?: number } = { detalle_id: l.detalle_id }
    if (v.cantidad !== '' && Number(v.cantidad) !== l.cantidad) c.cantidad = Number(v.cantidad)
    if (v.precio !== '' && Number(v.precio) !== l.precio_unitario) c.precio_unitario = Number(v.precio)
    return c.cantidad !== undefined || c.precio_unitario !== undefined ? [c] : []
  })
  if (lineasCambiadas.length) cambios.lineas = lineasCambiadas
  const sinCambios = Object.keys(cambios).length === 0

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="cambios" value={JSON.stringify(cambios)} />
      {codigosDeInsumos ? (
        <div className="text-sm">
          <p className="font-medium text-texto">Código interno</p>
          <p className="tabular text-texto">{codigosDeInsumos.join(', ') || '—'}</p>
          <p className="text-xs text-texto-suave">Cada insumo lleva el código de su requerimiento: si está mal, corrige el requerimiento.</p>
        </div>
      ) : (
        <Campo etiqueta="Código interno" htmlFor={`corregir-codigo-${id}`} requerido ayuda={AYUDA_CODIGO_INTERNO}>
          <Entrada
            id={`corregir-codigo-${id}`}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
            minLength={2}
            maxLength={60}
            autoComplete="off"
          />
        </Campo>
      )}
      <Campo
        etiqueta="Comprobante"
        htmlFor={`corregir-factura-${id}`}
        ayuda={tieneComprobante ? 'El comprobante ya está adjunto: esto ya no se cambia.' : comprobantePedido(factura).pide}
      >
        <Seleccion
          id={`corregir-factura-${id}`}
          value={factura ? 'true' : 'false'}
          onChange={(e) => setFactura(e.target.value === 'true')}
          disabled={tieneComprobante}
        >
          <option value="true">Con factura</option>
          <option value="false">Sin factura</option>
        </Seleccion>
      </Campo>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-texto">Líneas</legend>
        <p className="text-xs text-texto-suave">
          Precio unitario sin IGV, en {moneda === 'USD' ? 'dólares' : 'soles'}.
          {entregada && ' Lo que ya entró al almacén no cambia: quedó en el kardex con ese precio.'}
        </p>
        {lineas === null && <p className="text-sm text-texto-suave">Leyendo las líneas…</p>}
        {typeof lineas === 'string' && (
          <p role="alert" className="text-sm text-peligro">
            {lineas}
          </p>
        )}
        {lista.map((l, i) => {
          const v = valor(l)
          const poner = (parcial: Partial<{ cantidad: string; precio: string }>) =>
            setValores((todos) => ({ ...todos, [l.detalle_id]: { ...v, ...parcial } }))
          return (
            <div key={l.detalle_id} className="grid gap-2 rounded-[var(--radius-base)] border border-borde p-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]">
              <div className="text-sm">
                <p className="text-texto">{l.material}</p>
                <p className="text-[11px] text-texto-suave">{[l.codigo, `línea ${i + 1}`].filter(Boolean).join(' · ')}</p>
              </div>
              <Campo etiqueta={`Cantidad${l.unidad ? ` (${l.unidad})` : ''}`} htmlFor={`corregir-cant-${l.detalle_id}`}>
                <Entrada
                  id={`corregir-cant-${l.detalle_id}`}
                  type="number"
                  inputMode="decimal"
                  min="0.001"
                  step="0.001"
                  value={v.cantidad}
                  onChange={(e) => poner({ cantidad: e.target.value })}
                  required
                />
              </Campo>
              <Campo etiqueta="Precio sin IGV" htmlFor={`corregir-precio-${l.detalle_id}`}>
                <Entrada
                  id={`corregir-precio-${l.detalle_id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={v.precio}
                  onChange={(e) => poner({ precio: e.target.value })}
                />
              </Campo>
            </div>
          )
        })}
      </fieldset>

      <CamposDeCorreccion id={id} disabled={enviando} />
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {sinCambios && <p className="mr-auto text-xs text-texto-suave">Todavía no cambiaste nada.</p>}
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando} disabled={sinCambios}>
          Corregir
        </Boton>
      </div>
    </form>
  )
}
