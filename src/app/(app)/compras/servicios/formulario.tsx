'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'

import { CodigoInternoConLista } from '@/components/codigo-interno/elegir-codigo'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import { yaEntroEnLaVentana, yaEntroLaPrimeraVez, type ResultadoAccion } from '@/lib/acciones'
import { subirArchivoFinanzas } from '@/lib/archivos-finanzas'
import type { AreaSolicitante, OtParaLogistica } from '@/lib/datos/logistica'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { AYUDA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { CODIGOS_FIJOS, type CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import type { TipoDetraccion } from '@/lib/dominio/detraccion'
import { BUCKET_DOCUMENTOS_SERVICIO, MAXIMO_MB_FINANZAS, TIPOS_COMPROBANTE_PAGO } from '@/lib/dominio/finanzas'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'

import { SelectorProveedor } from '../selector-proveedor'
import { adjuntarDocumentoServicio, emitirOrdenServicio } from './acciones'
import { SelectorDetraccion } from './selector-detraccion'

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/**
 * La orden de servicio: quién hace el trabajo, qué, para qué código interno, OT
 * o área, cuánto, cuándo, si lleva detracción y, si ya está, su contrato.
 */
export function NuevaOrdenServicio({
  proveedores,
  ordenes,
  areas,
  tipos,
  codigos,
  puedeRegistrarProveedor,
}: {
  proveedores: ProveedorParaCompra[]
  ordenes: OtParaLogistica[]
  areas: AreaSolicitante[]
  tipos: TipoDetraccion[]
  /** Para el buscador de código interno; `null` si la lista no se pudo leer. */
  codigos: CodigoParaElegir[] | null
  puedeRegistrarProveedor: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  // Los ids de la orden y de su contrato viven aquí, fuera del formulario que
  // se rehace al abrir: tras «No llegó la respuesta», cancelar y volver a abrir
  // lleva los mismos, y la base no emite otra OS numerada con lo mismo. Antes
  // nacían con el formulario y salían dos OS numeradas iguales (decimoquinta
  // pasada). Se renuevan con el ok, cuando la base dice que ya quedó o cuando,
  // al volver a abrir, la base dice que aquella OS entró.
  const contrato = useIdDelEnvio(undefined, undefined, 'contrato-de-la-os')
  const orden = useIdDelEnvio('orden_servicio', (cuentas) => contrato.otro(cuentas))
  const [aviso, setAviso] = useState<string | null>(null)
  // La OS entró pero su contrato no: se dice por qué y dónde adjuntarlo.
  const [faltaContrato, setFaltaContrato] = useState<string | null>(null)
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          setFaltaContrato(null)
          orden.abrir()
          contrato.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <Plus aria-hidden className="size-4" />
        Nueva orden de servicio
      </Boton>
      {aviso && (
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
        </p>
      )}
      {faltaContrato && (
        <p role="alert" className="basis-full text-sm text-aviso">
          {faltaContrato}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Nueva orden de servicio"
        descripcion="Un trabajo que hace un tercero. El número OS-…-MW lo pone el sistema y Gerencia la aprueba antes de que el proveedor empiece."
        ancho="lg"
      >
        <EnvioAnterior texto={orden.anterior} />
        {orden.id && contrato.id && (
          <FormularioServicio
            key={vez}
            id={orden.id}
            contratoId={contrato.id}
            alSalir={() => {
              orden.salio()
              contrato.salio()
            }}
            alYaEntrar={() => {
              orden.otro()
              contrato.otro()
            }}
            alCancelar={() => setAbierta(false)}
            proveedores={proveedores}
            ordenes={ordenes}
            areas={areas}
            tipos={tipos}
            codigos={codigos}
            puedeRegistrarProveedor={puedeRegistrarProveedor}
            alTerminar={(mensaje, sinContrato) => {
              setAbierta(false)
              orden.otro()
              contrato.otro()
              setAviso(mensaje)
              setFaltaContrato(sinContrato)
            }}
          />
        )}
      </Ventana>
    </>
  )
}

function FormularioServicio({
  id,
  contratoId,
  alSalir,
  alYaEntrar,
  alCancelar,
  proveedores,
  ordenes,
  areas,
  tipos,
  codigos,
  puedeRegistrarProveedor,
  alTerminar,
}: {
  id: string
  contratoId: string
  /** Al enviar: los ids salieron con este envío. */
  alSalir: () => void
  alYaEntrar: () => void
  alCancelar: () => void
  proveedores: ProveedorParaCompra[]
  ordenes: OtParaLogistica[]
  areas: AreaSolicitante[]
  tipos: TipoDetraccion[]
  codigos: CodigoParaElegir[] | null
  puedeRegistrarProveedor: boolean
  alTerminar: (mensaje: string, faltaContrato: string | null) => void
}) {
  const [proveedorId, setProveedorId] = useState('')
  const [ordenId, setOrdenId] = useState('')
  const [condicion, setCondicion] = useState('CONTADO')
  const [dias, setDias] = useState(0)
  const [divisa, setDivisa] = useState('PEN')
  const [monto, setMonto] = useState('')

  /**
   * Emite la OS y, si se eligió, adjunta después su contrato con la función de
   * los documentos de la OS (tipo CONTRATO, en `documentos-servicio/{OS}/…`).
   * El archivo se revisa antes de emitir; si la OS entra y el contrato no, la
   * OS queda emitida y se avisa para adjuntarlo desde su fila.
   */
  async function emitir(previo: unknown, datos: FormData): Promise<ResultadoAccion<{ faltaContrato: string }>> {
    const elegido = datos.get('contrato')
    datos.delete('contrato')
    const contrato = elegido instanceof File && elegido.size > 0 ? elegido : null
    if (contrato && !TIPOS_COMPROBANTE_PAGO[contrato.type]) return { ok: false, error: 'El contrato va en PDF o en foto (JPG, PNG o WEBP).' }
    if (contrato && contrato.size > MAXIMO_MB_FINANZAS * 1024 * 1024) return { ok: false, error: `El contrato pesa más de ${MAXIMO_MB_FINANZAS} MB.` }

    alSalir()
    const emitida = await emitirOrdenServicio(previo, datos)
    // Con «ya quedó» la OS es la de la primera vez y el contrato no sube: se dice
    // dónde adjuntarlo. El aviso decía solo que lo cambiado no se guardó, y quien
    // cambió el monto no entendía que el contrato tampoco (decimosexta pasada).
    if (!emitida.ok && contrato && yaEntroLaPrimeraVez(emitida.error)) {
      return { ok: false, error: `${yaEntroEnLaVentana(emitida.error)} El contrato que elegiste no se adjuntó: adjúntalo desde la fila de la orden, con «Adjuntar documento».` }
    }
    if (!emitida.ok || !contrato) return emitida
    const documento = new FormData()
    documento.set('id', contratoId)
    documento.set('orden_servicio_id', id)
    documento.set('tipo', 'CONTRATO')
    documento.set('nombre', contrato.name)
    const adjunto = await subirArchivoFinanzas(BUCKET_DOCUMENTOS_SERVICIO, id, contrato, TIPOS_COMPROBANTE_PAGO, (ruta) => {
      documento.set('ruta', ruta)
      return adjuntarDocumentoServicio(null, documento)
    })
    if (adjunto.ok) return { ok: true, mensaje: `${emitida.mensaje ?? 'Orden de servicio emitida.'} Su contrato quedó adjunto.` }
    // La ventana ya se cerró: el aviso no pide «vuelve a intentar», dice dónde adjuntarlo.
    // Sin respuesta, el contrato pudo quedar: primero se mira (`subirArchivoFinanzas`).
    const faltaContrato = adjunto.error.startsWith('No llegó la respuesta')
      ? 'No llegó la respuesta al adjuntar el contrato: recarga la pantalla y mira en la fila de la orden si quedó; si no, adjúntalo con «Adjuntar documento».'
      : `${
          adjunto.error.startsWith('No se pudo subir')
            ? 'El contrato no subió (revisa la señal).'
            : `El contrato no se adjuntó: ${adjunto.error.charAt(0).toLowerCase()}${adjunto.error.slice(1).replace(/ Vuelve a intentar\.$/, '')}`
        } Adjúntalo desde la fila de la orden, con «Adjuntar documento».`
    return { ok: true, mensaje: emitida.mensaje, datos: { faltaContrato } }
  }
  const { alEnviar, enviando, error } = useEnvio(
    emitir,
    (r) => alTerminar(r.mensaje ?? 'Orden de servicio emitida.', r.datos?.faltaContrato ?? null),
    { alYaEntrar },
  )

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="operacion_id" value={id} />
      <SelectorProveedor
        id="os-proveedor"
        proveedores={proveedores}
        puedeRegistrar={puedeRegistrarProveedor}
        valor={proveedorId}
        alElegir={(p) => {
          setProveedorId(p?.id ?? '')
          if (p) {
            setCondicion(p.condicion_pago)
            setDias(p.dias_credito)
          }
        }}
      />
      <Campo etiqueta="Qué se hace" htmlFor="os-descripcion" requerido>
        <AreaTexto
          id="os-descripcion"
          name="descripcion"
          required
          minLength={10}
          maxLength={1000}
          rows={3}
          placeholder="Por ejemplo: torneado de 4 ejes de 2 in según plano, con el material que entrega Metal Work."
        />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Código interno" htmlFor="os-codigo" requerido ayuda={AYUDA_CODIGO_INTERNO}>
          <CodigoInternoConLista id="os-codigo" name="codigo_interno" requerido codigos={codigos} fijos={CODIGOS_FIJOS} />
        </Campo>
        <Campo etiqueta="Para la OT (opcional)" htmlFor="os-orden" ayuda="Si el servicio es para una unidad en taller.">
          <SeleccionBuscable
            id="os-orden"
            name="orden_id"
            valor={ordenId}
            onChange={setOrdenId}
            marcador="Sin OT"
            marcadorBusqueda="Número de OT o unidad…"
            opciones={ordenes.map((o) => ({ valor: o.id, etiqueta: `OT ${o.numero}`, detalle: o.unidad ?? undefined }))}
          />
        </Campo>
        <Campo etiqueta="Área que lo pide (opcional)" htmlFor="os-area">
          <Seleccion id="os-area" name="area_id" defaultValue="">
            <option value="">Sin área</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Referencia del proveedor" htmlFor="os-referencia" ayuda="Su cotización o proforma, si la hay.">
          <Entrada id="os-referencia" name="referencia" maxLength={100} placeholder="COT-0123" />
        </Campo>
        <Campo etiqueta="Monto sin IGV" htmlFor="os-monto" requerido>
          <div className="flex gap-2">
            <Seleccion id="os-moneda" name="moneda" value={divisa} onChange={(e) => setDivisa(e.target.value)} aria-label="Moneda" className="w-28">
              <option value="PEN">Soles</option>
              <option value="USD">Dólares</option>
            </Seleccion>
            <Entrada
              id="os-monto"
              name="monto"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              required
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="min-w-0 flex-1"
            />
          </div>
        </Campo>
        <Campo etiqueta="Inicio" htmlFor="os-inicio">
          <Entrada id="os-inicio" name="fecha_inicio" type="date" />
        </Campo>
        <Campo etiqueta="Entrega" htmlFor="os-fin">
          <Entrada id="os-fin" name="fecha_fin" type="date" />
        </Campo>
        <Campo etiqueta="Pago" htmlFor="os-pago">
          <Seleccion
            id="os-pago"
            name="condicion"
            value={condicion}
            onChange={(e) => {
              setCondicion(e.target.value)
              if (e.target.value === 'CONTADO') setDias(0)
            }}
          >
            <option value="CONTADO">Contado</option>
            <option value="CREDITO">Crédito</option>
          </Seleccion>
        </Campo>
        <Campo etiqueta="Días de crédito" ayuda="0 para contado" htmlFor="os-dias">
          <Entrada
            id="os-dias"
            name="dias"
            type="number"
            min={condicion === 'CREDITO' ? 1 : 0}
            max={condicion === 'CREDITO' ? 365 : 0}
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
          />
        </Campo>
      </div>
      <SelectorDetraccion
        id="os-detraccion"
        tipos={tipos}
        montoSinIgvPen={divisa === 'PEN' && monto !== '' ? Number(monto) : null}
        enDolares={divisa === 'USD'}
      />
      <Campo
        etiqueta="Contrato (opcional)"
        htmlFor="os-contrato"
        ayuda="Si llega después, se adjunta desde la fila de la orden."
      >
        <ElegirArchivo id="os-contrato" name="contrato" accept={ACEPTA} hastaMb={MAXIMO_MB_FINANZAS} />
      </Campo>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCancelar} texto="Emitir orden de servicio" disabled={!proveedorId} />
    </form>
  )
}
