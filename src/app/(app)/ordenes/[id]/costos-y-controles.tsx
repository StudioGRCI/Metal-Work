'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ComposicionDelCosto } from '@/components/expediente/composicion-costo'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { controlesYSolicitudesDeOrden } from '@/lib/datos/costos-ot'
import { ESTADO_GASTO_AREA, ESTADO_SOLICITUD_TESORERIA, TIPO_GASTO_AREA, definir } from '@/lib/dominio/estados'
import { composicionDelCosto } from '@/lib/dominio/expediente'
import { fecha, fechaHora, moneda } from '@/lib/format'
import { useEnvio } from '@/lib/envio'
import { solicitarTesoreria } from './acciones-costos'
import { adjuntarControlFirmado, guardarControlVehicular, registrarGastoArea, revisarGastoArea } from './acciones-control-y-gastos'

type Datos = Awaited<ReturnType<typeof controlesYSolicitudesDeOrden>>
export function CostosYControles({ ordenId, datos, puedeSolicitar, puedeRegistrarGasto, puedeRevisarGasto, puedeVerCosteo, ordenCerrada }: {
  ordenId: string
  datos: Datos
  puedeSolicitar: boolean
  puedeRegistrarGasto: boolean
  puedeRevisarGasto: boolean
  puedeVerCosteo: boolean
  ordenCerrada: boolean
}) {
  return <div className="space-y-5">
    {puedeVerCosteo && <ResumenCosteo ordenId={ordenId} lineas={datos.costeo} />}
    <GastosDeAreas ordenId={ordenId} datos={datos} puedeRegistrar={puedeRegistrarGasto && !ordenCerrada} puedeRevisar={puedeRevisarGasto} />
    <SolicitudesTesoreria ordenId={ordenId} datos={datos} tipo="MATERIALES"
      puedeSolicitar={puedeSolicitar && !ordenCerrada} salidaCompleta={false} />
  </div>
}

export function ControlDeSalida({ ordenId, datos, puedeControlar, puedeVerCosteo, puedeSolicitar, ordenCerrada }: {
  ordenId: string
  datos: Datos
  puedeControlar: boolean
  puedeVerCosteo: boolean
  puedeSolicitar: boolean
  ordenCerrada: boolean
}) {
  const salidaCompleta = Boolean(datos.control?.salida_cerrada_en && datos.control.escaneo_ruta)
  return <div className="space-y-4">
    {(puedeControlar || puedeVerCosteo) && <FichaVehicular ordenId={ordenId} datos={datos} editable={puedeControlar && !ordenCerrada} />}
    <SolicitudesTesoreria ordenId={ordenId} datos={datos} tipo="SALIDA_OT"
      puedeSolicitar={puedeSolicitar && !ordenCerrada} salidaCompleta={salidaCompleta} />
  </div>
}

function SolicitudesTesoreria({ ordenId, datos, tipo, puedeSolicitar, salidaCompleta }: {
  ordenId: string
  datos: Datos
  tipo: 'MATERIALES' | 'SALIDA_OT'
  puedeSolicitar: boolean
  salidaCompleta: boolean
}) {
  const solicitudes = datos.solicitudes.filter((solicitud) => solicitud.tipo === tipo)
  return (
    <Tarjeta>
      <TarjetaCabecera titulo={tipo === 'MATERIALES' ? 'Pagos solicitados a Tesorería' : 'Revisión financiera para la salida'}
        descripcion={tipo === 'MATERIALES' ? 'Registra la solicitud de pago de materiales. Tesorería confirma su atención.' : 'Se solicita después de cerrar la ficha de salida y adjuntar el escaneo firmado.'} />
      <TarjetaCuerpo className="space-y-4">
        {puedeSolicitar && (tipo === 'MATERIALES' || salidaCompleta) &&
          <NuevaSolicitud ordenId={ordenId} tipo={tipo} salidaCompleta={salidaCompleta} />}
        {puedeSolicitar && tipo === 'SALIDA_OT' && !salidaCompleta &&
          <p className="text-sm text-texto-suave">Completa la ficha de salida y adjunta el escaneo firmado para solicitar la revisión a Tesorería.</p>}
        {solicitudes.length === 0 ? <p className="text-sm text-texto-suave">Todavía no hay solicitudes de este paso.</p> :
          <ol className="space-y-2">{solicitudes.map(s => <li key={s.id} className="rounded-[var(--radius-base)] border border-borde p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{s.tipo === 'SALIDA_OT' ? 'Revisión para salida' : 'Pago de materiales'}</strong><Insignia tono={definir(ESTADO_SOLICITUD_TESORERIA, s.estado).tono}>{definir(ESTADO_SOLICITUD_TESORERIA, s.estado).etiqueta}</Insignia></div>
            <p className="mt-1 whitespace-pre-wrap">{s.concepto}</p>
            {s.monto !== null && <p className="mt-1 font-semibold tabular">{moneda(s.monto, s.moneda === 'USD' ? 'USD' : 'PEN')}</p>}
            <p className="mt-1 text-xs text-texto-suave">{fechaHora(s.creado_en)} · {s.solicitante ? `${s.solicitante.nombres} ${s.solicitante.apellidos}` : 'Costos y Materiales'}</p>
            {s.respuesta && <p className="mt-2 rounded-[var(--radius-base)] bg-superficie-2 p-2">Tesorería: {s.respuesta}</p>}
          </li>)}</ol>}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/**
 * El costo a la fecha, con la misma barra repartida del expediente: antes eran
 * dos cajas fijas —soles y dólares— con cada fuente en renglones, y la de
 * dólares salía llena de ceros en casi todas las órdenes. El detalle línea por
 * línea vive en el expediente.
 */
function ResumenCosteo({ ordenId, lineas }: { ordenId: string; lineas: Datos['costeo'] }) {
  const { monedas, sinPrecio } = composicionDelCosto(lineas)
  return <Tarjeta>
    <TarjetaCabecera titulo="Costo acumulado de la OT" descripcion="Material despachado a precio de compra, planilla cerrada asignada y gastos aprobados de las áreas."
      acciones={<Link href={`/ordenes/${ordenId}/expediente#costo`} className="inline-flex min-h-11 items-center text-xs text-acento hover:underline sm:min-h-0">Ver el detalle línea por línea</Link>} />
    <TarjetaCuerpo className="space-y-4">
      {monedas.length === 0
        ? <p className="text-sm text-texto-suave">Todavía no hay costo: se suma al despachar material, al cerrar la planilla del mes y al aprobar un gasto de área.</p>
        : monedas.map(c => <ComposicionDelCosto key={c.moneda} composicion={c} />)}
      {sinPrecio > 0 && <p role="status" className="text-sm text-aviso">
        {sinPrecio === 1 ? 'Un despacho sigue sin precio' : `${sinPrecio} despachos siguen sin precio`}: el costo está incompleto hasta valorizarlos.
      </p>}
      <p className="text-xs text-texto-suave">El precio de material es el último precio de compra disponible al momento del despacho; revisa la valorización antes de cerrar la OT.</p>
    </TarjetaCuerpo>
  </Tarjeta>
}

function GastosDeAreas({ ordenId, datos, puedeRegistrar, puedeRevisar }: {
  ordenId: string; datos: Datos; puedeRegistrar: boolean; puedeRevisar: boolean
}) {
  const [id, setId] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, resultado, error } = useEnvio(registrarGastoArea, () => setId(crypto.randomUUID()))
  return <Tarjeta>
    <TarjetaCabecera titulo="Gastos de las áreas" descripcion="Cada área adjunta el comprobante de su OT. Administración aprueba; solo entonces se suma al costo." />
    <TarjetaCuerpo className="space-y-4">
      {puedeRegistrar && <details className="rounded-[var(--radius-base)] border border-borde p-3">
        <summary className="cursor-pointer font-medium">Registrar gasto de mi área</summary>
        <form onSubmit={alEnviar} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={id} /><input type="hidden" name="orden_id" value={ordenId} />
          <Campo etiqueta="Tipo" htmlFor="gasto-tipo" requerido><Seleccion id="gasto-tipo" name="tipo" defaultValue="SERVICIO"><option value="SERVICIO">Servicio</option><option value="TRANSPORTE">Transporte</option><option value="VIATICO">Viático</option><option value="SUBCONTRATO">Subcontrato</option><option value="OTRO">Otro</option></Seleccion></Campo>
          <Campo etiqueta="Fecha" htmlFor="gasto-fecha" requerido><Entrada id="gasto-fecha" type="date" name="fecha" required /></Campo>
          <Campo etiqueta="Importe" htmlFor="gasto-monto" requerido><Entrada id="gasto-monto" type="number" min="0.01" step="0.01" name="monto" required /></Campo>
          <Campo etiqueta="Moneda" htmlFor="gasto-moneda" requerido><Seleccion id="gasto-moneda" name="moneda" defaultValue="PEN"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
          <div className="sm:col-span-2"><Campo etiqueta="Descripción y referencia" htmlFor="gasto-descripcion" requerido><AreaTexto id="gasto-descripcion" name="descripcion" minLength={10} maxLength={500} required rows={2} /></Campo></div>
          <div className="sm:col-span-2"><Campo etiqueta="Comprobante PDF" htmlFor="gasto-pdf" requerido ayuda="Hasta 15 MB."><Entrada id="gasto-pdf" type="file" name="pdf" accept="application/pdf,.pdf" required /></Campo></div>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-peligro">{error}</p>}
          {resultado?.ok && <p role="status" className="sm:col-span-2 text-sm text-exito">{resultado.mensaje}</p>}
          <Boton type="submit" cargando={enviando}>Enviar para revisión</Boton>
        </form>
      </details>}
      {datos.gastos.length === 0 ? <p className="text-sm text-texto-suave">Todavía no hay gastos registrados en esta OT.</p> :
        <ol className="space-y-3">{datos.gastos.map(g => <li key={g.id} className="rounded-[var(--radius-base)] border border-borde p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><strong>{g.descripcion}</strong><Insignia tono={definir(ESTADO_GASTO_AREA, g.estado).tono}>{definir(ESTADO_GASTO_AREA, g.estado).etiqueta}</Insignia></div>
          <p className="mt-1 text-texto-suave">{g.area?.nombre ?? 'Área'} · {definir(TIPO_GASTO_AREA, g.tipo).etiqueta} · {fecha(g.fecha)} · {moneda(g.monto, g.moneda === 'USD' ? 'USD' : 'PEN')}</p>
          {g.url && <a className="text-acento underline" href={g.url} target="_blank" rel="noopener noreferrer">Ver comprobante</a>}
          {g.observacion_revision && <p className="mt-2 text-peligro">Observación: {g.observacion_revision}</p>}
          {puedeRevisar && g.estado === 'PENDIENTE' && <RevisionGasto id={g.id} ordenId={ordenId} />}
        </li>)}</ol>}
    </TarjetaCuerpo>
  </Tarjeta>
}

function RevisionGasto({ id, ordenId }: { id: string; ordenId: string }) {
  const { alEnviar, enviando, resultado, error } = useEnvio(revisarGastoArea)
  return <form onSubmit={alEnviar} className="mt-3 space-y-2 border-t border-borde pt-3">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="orden_id" value={ordenId} />
    <Campo etiqueta="Decisión de Administración" htmlFor={'decision-' + id}><Seleccion id={'decision-' + id} name="estado" defaultValue="APROBADO"><option value="APROBADO">Aprobar</option><option value="OBSERVADO">Observar</option></Seleccion></Campo>
    <Campo etiqueta="Motivo si observas" htmlFor={'motivo-' + id}><Entrada id={'motivo-' + id} name="observacion_revision" maxLength={1000} /></Campo>
    {error && <p role="alert" className="text-peligro">{error}</p>}{resultado?.ok && <p role="status" className="text-exito">{resultado.mensaje}</p>}
    <Boton type="submit" tamano="sm" cargando={enviando}>Guardar revisión</Boton>
  </form>
}

function estadoDeItem(valor: unknown, fase: 'ingreso' | 'salida'): string {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return ''
  const dato = Reflect.get(valor, fase)
  return typeof dato === 'string' ? dato : ''
}

function FichaVehicular({ ordenId, datos, editable }: { ordenId: string; datos: Datos; editable: boolean }) {
  const c = datos.control
  const ingresoCerrado = Boolean(c?.ingreso_cerrado_en)
  const salidaCerrada = Boolean(c?.salida_cerrada_en)
  const { alEnviar, enviando, resultado, error } = useEnvio(guardarControlVehicular)
  const escaneo = useEnvio(adjuntarControlFirmado)
  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    const boton = (evento.nativeEvent as SubmitEvent).submitter
    const accion = boton instanceof HTMLButtonElement ? boton.value : 'GUARDAR'
    if (accion !== 'GUARDAR' && !window.confirm(accion === 'CERRAR_INGRESO' ? '¿Cerrar el ingreso de esta OT? Sus datos quedarán fijos.' : '¿Cerrar la salida? Solo podrás adjuntar el escaneo firmado.')) {
      evento.preventDefault(); return
    }
    alEnviar(evento, d => d.set('accion', accion))
  }
  return <Tarjeta>
    <TarjetaCabecera titulo="Ficha única de ingreso y salida" descripcion="Usa el formato de inspección vehicular de Metal Work. Guarda avances, cierra cada etapa y descarga la misma ficha para firmarla." />
    <TarjetaCuerpo className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <span>Ingreso: {ingresoCerrado ? fechaHora(c?.ingreso_cerrado_en ?? '') : 'pendiente'}</span>
        <span>Salida: {salidaCerrada ? fechaHora(c?.salida_cerrada_en ?? '') : 'pendiente'}</span>
        <a className="text-acento underline" href={'/ordenes/' + ordenId + '/control-vehicular/pdf'} target="_blank" rel="noopener noreferrer">Descargar ficha PDF</a>
        {datos.escaneoUrl && <a className="text-acento underline" href={datos.escaneoUrl} target="_blank" rel="noopener noreferrer">Ver escaneo firmado</a>}
      </div>
      <form onSubmit={enviar} className="space-y-5">
        <input type="hidden" name="orden_id" value={ordenId} />
        <fieldset disabled={!editable || enviando || salidaCerrada} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Placa" htmlFor="cv-placa"><Entrada id="cv-placa" name="placa" maxLength={30} defaultValue={c?.placa ?? ''} readOnly={ingresoCerrado} /></Campo>
            <Campo etiqueta="Marca" htmlFor="cv-marca"><Entrada id="cv-marca" name="marca" maxLength={80} defaultValue={c?.marca ?? ''} readOnly={ingresoCerrado} /></Campo>
            <Campo etiqueta="Conductor al ingreso" htmlFor="cv-ci"><Entrada id="cv-ci" name="conductor_ingreso" maxLength={120} defaultValue={c?.conductor_ingreso ?? ''} readOnly={ingresoCerrado} /></Campo>
            <Campo etiqueta="DNI al ingreso" htmlFor="cv-di"><Entrada id="cv-di" name="dni_ingreso" maxLength={20} defaultValue={c?.dni_ingreso ?? ''} readOnly={ingresoCerrado} /></Campo>
            <Campo etiqueta="Fecha de ingreso" htmlFor="cv-fi"><Entrada id="cv-fi" name="fecha_ingreso" type="date" defaultValue={c?.fecha_ingreso ?? ''} readOnly={ingresoCerrado} /></Campo>
            <Campo etiqueta="Combustible al ingreso" htmlFor="cv-combi"><Entrada id="cv-combi" name="combustible_ingreso" maxLength={40} defaultValue={c?.combustible_ingreso ?? ''} readOnly={ingresoCerrado} /></Campo>
            <Campo etiqueta="Conductor a la salida" htmlFor="cv-cs"><Entrada id="cv-cs" name="conductor_salida" maxLength={120} defaultValue={c?.conductor_salida ?? ''} /></Campo>
            <Campo etiqueta="DNI a la salida" htmlFor="cv-ds"><Entrada id="cv-ds" name="dni_salida" maxLength={20} defaultValue={c?.dni_salida ?? ''} /></Campo>
            <Campo etiqueta="Fecha de salida" htmlFor="cv-fs"><Entrada id="cv-fs" name="fecha_salida" type="date" defaultValue={c?.fecha_salida ?? ''} /></Campo>
            <Campo etiqueta="Combustible a la salida" htmlFor="cv-combs"><Entrada id="cv-combs" name="combustible_salida" maxLength={40} defaultValue={c?.combustible_salida ?? ''} /></Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Accesorios adicionales" htmlFor="cv-ad"><AreaTexto id="cv-ad" name="adicionales" rows={2} defaultValue={c?.adicionales ?? ''} /></Campo>
            <Campo etiqueta="Trabajos realizados" htmlFor="cv-tr"><AreaTexto id="cv-tr" name="trabajos" rows={2} defaultValue={c?.trabajos ?? ''} /></Campo>
            <Campo etiqueta="Observación de ingreso" htmlFor="cv-oi"><AreaTexto id="cv-oi" name="observacion_ingreso" rows={2} defaultValue={c?.observacion_ingreso ?? ''} readOnly={ingresoCerrado} /></Campo>
            <Campo etiqueta="Observación de salida" htmlFor="cv-os"><AreaTexto id="cv-os" name="observacion_salida" rows={2} defaultValue={c?.observacion_salida ?? ''} /></Campo>
          </div>
          {['CABINA_EXTERIOR','ACCESORIOS','CABINA_INTERIOR','HERRAMIENTAS'].map(cat => <details key={cat} className="rounded-[var(--radius-base)] border border-borde p-3">
            <summary className="cursor-pointer font-medium">{({ CABINA_EXTERIOR: 'Cabina exterior', ACCESORIOS: 'Accesorios', CABINA_INTERIOR: 'Cabina interior', HERRAMIENTAS: 'Herramientas' } as Record<string,string>)[cat]}</summary>
            <div className="mt-3 space-y-3">{datos.items.filter(i => i.categoria === cat).map(i => {
              const estados = c?.items && typeof c.items === 'object' && !Array.isArray(c.items) ? Reflect.get(c.items, i.codigo) : null
              return <div key={i.codigo} className="grid gap-2 border-b border-borde pb-3 sm:grid-cols-[1fr_10rem_10rem]">
                <span className="self-center text-sm">{i.nombre}</span>
                {(['ingreso','salida'] as const).map(fase => <label key={fase} className="text-xs text-texto-suave">{fase === 'ingreso' ? 'Ingreso' : 'Salida'}
                  <Seleccion aria-label={i.nombre + ' al ' + fase} name={fase + '_' + i.codigo} defaultValue={estadoDeItem(estados, fase)} disabled={fase === 'ingreso' && ingresoCerrado}>
                    <option value="">Pendiente</option><option value="CONFORME">Conforme</option><option value="NO_TIENE">No tiene</option><option value="OBSERVADO">Observado</option>
                  </Seleccion>
                </label>)}
              </div>
            })}</div>
          </details>)}
        </fieldset>
        {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
        {resultado?.ok && <p role="status" className="text-sm text-exito">{resultado.mensaje}</p>}
        {editable && !salidaCerrada && <div className="flex flex-wrap gap-2">
          <Boton type="submit" value="GUARDAR" cargando={enviando} variante="secundario">Guardar avance</Boton>
          {!ingresoCerrado && <Boton type="submit" value="CERRAR_INGRESO" cargando={enviando}>Cerrar ingreso</Boton>}
          {ingresoCerrado && <Boton type="submit" value="CERRAR_SALIDA" cargando={enviando}>Cerrar salida</Boton>}
        </div>}
      </form>
      {editable && salidaCerrada && !c?.escaneo_ruta && <form onSubmit={escaneo.alEnviar} className="space-y-2 rounded-[var(--radius-base)] border border-borde p-3">
        <input type="hidden" name="orden_id" value={ordenId} />
        <Campo etiqueta="Escaneo firmado en PDF" htmlFor="cv-scan" requerido><Entrada id="cv-scan" name="pdf" type="file" accept="application/pdf,.pdf" required /></Campo>
        {escaneo.error && <p role="alert" className="text-peligro">{escaneo.error}</p>}
        {escaneo.resultado?.ok && <p role="status" className="text-exito">{escaneo.resultado.mensaje}</p>}
        <Boton type="submit" cargando={escaneo.enviando}>Adjuntar escaneo firmado</Boton>
      </form>}
    </TarjetaCuerpo>
  </Tarjeta>
}

function NuevaSolicitud({ ordenId, tipo, salidaCompleta }: { ordenId: string; tipo: 'MATERIALES' | 'SALIDA_OT'; salidaCompleta: boolean }) {
  const { alEnviar, enviando, resultado, error } = useEnvio(solicitarTesoreria)
  return <form onSubmit={alEnviar} className="grid gap-3 rounded-[var(--radius-base)] border border-borde p-4 sm:grid-cols-2">
    <input type="hidden" name="orden_id" value={ordenId} />
    <input type="hidden" name="tipo" value={tipo} />
    {tipo === 'MATERIALES' && <div className="grid grid-cols-[1fr_7rem] gap-2"><Campo etiqueta="Importe" htmlFor="solicitud-monto" requerido><Entrada id="solicitud-monto" name="monto" type="number" min="0.01" step="0.01" required /></Campo><Campo etiqueta="Moneda" htmlFor="solicitud-moneda" requerido><Seleccion id="solicitud-moneda" name="moneda" defaultValue="PEN"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo></div>}
    {tipo === 'SALIDA_OT' && <><input type="hidden" name="monto" value="" /><input type="hidden" name="moneda" value="" /><p className="self-end text-xs text-texto-suave">{salidaCompleta ? 'Lista de salida completada.' : 'Completa primero la lista de salida.'}</p></>}
    <div className="sm:col-span-2"><Campo etiqueta="Concepto y referencia" htmlFor="solicitud-concepto" requerido ayuda="Indica proveedor, factura o motivo de la revisión."><AreaTexto id="solicitud-concepto" name="concepto" minLength={10} maxLength={1000} required rows={3} /></Campo></div>
    {error && <p role="alert" className="sm:col-span-2 text-sm text-peligro">{error}</p>}
    {resultado?.ok && <p role="status" className="sm:col-span-2 text-sm text-exito">{resultado.mensaje}</p>}
    <div className="sm:col-span-2"><Boton type="submit" tamano="sm" cargando={enviando} disabled={tipo === 'SALIDA_OT' && !salidaCompleta}>Enviar a Tesorería</Boton></div>
  </form>
}
