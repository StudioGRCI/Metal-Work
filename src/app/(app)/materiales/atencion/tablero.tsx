'use client'

import { ArrowDownToLine, ArrowUpFromLine, Plus, ShoppingCart, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Ventana } from '@/components/ui/ventana'
import { subirArchivoPrivado } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'
import { registrarIngresoGeneral } from './acciones'

import { CodigoInternoConLista } from '@/components/codigo-interno/elegir-codigo'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cantidad, fecha as formatearFecha } from '@/lib/format'
import { SIN_RESPUESTA, useAccion, useEnvio } from '@/lib/envio'
import type {
  AreaMaterial,
  CompraMaterialPendiente,
  ExistenciaMaterial,
  LineaAtencionMaterial,
  ResponsableMaterial,
} from '@/lib/datos/atencion-materiales'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { APROBACION_COMPRA, comprobantePedido, compraDetenida, condicionDePago } from '@/lib/dominio/proveedores'
import { AYUDA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { CODIGOS_FIJOS, type CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { RECOJO_COMPRA, VALIDACION_INGRESO, puedeIrARecojo, situacionCompra } from '@/lib/dominio/logistica'
import { mandarARecojo } from '@/app/(app)/compras/ordenes/acciones'
import { FormularioProveedor } from '@/app/(app)/proveedores/formulario'

import { crearOrdenCompra, despacharMaterial, registrarRecepcion, resolverPropuesta, revisarStock, registrarPrecioCompra, fijarCondicionCompra } from './acciones'
import { SubirDocumentoCompra } from './subir-documento-compra'

const NOMBRE_AREA: Record<string, string> = {
  MTZ: 'Maestranza',
  PRD: 'Producción',
  ACB: 'Acabados',
}

const NOMBRE_ESTADO: Record<string, string> = {
  DISENO: 'Espera Diseño',
  RECHAZADO: 'Rechazado',
  ALMACEN: 'Revisar stock',
  STOCK: 'Por despachar',
  SOLICITADO: 'Derivado a Logística',
  EN_COMPRA: 'En compra',
  EN_ALMACEN: 'En almacén',
  ATENDIDO: 'Entregado',
}

const TONO_ESTADO: Record<string, 'aviso' | 'info' | 'exito' | 'neutro'> = {
  DISENO: 'aviso', RECHAZADO: 'neutro', ALMACEN: 'aviso', STOCK: 'info',
  SOLICITADO: 'aviso',
  EN_COMPRA: 'info',
  EN_ALMACEN: 'aviso',
  ATENDIDO: 'exito',
}

type Filtro = string

function estadoOperativo(linea: LineaAtencionMaterial): string {
  if (linea.aprobacion_diseno === 'PROPUESTO') return 'DISENO'
  if (linea.aprobacion_diseno === 'RECHAZADO') return 'RECHAZADO'
  if (linea.decision_almacen === 'PENDIENTE') return 'ALMACEN'
  if (linea.estado === 'SOLICITADO' && linea.decision_almacen === 'STOCK') return 'STOCK'
  return linea.estado ?? 'SOLICITADO'
}

export function TableroMateriales({
  lineas,
  existencias,
  compras,
  areas,
  responsables,
  puedeCrearCompra,
  puedeAprobarDiseno,
  puedeRevisarStock,
  puedeAdjuntarDocumentos,
  puedeVerCompras,
  puedeRecibir,
  puedeDespachar,
  clavesRecepcion,
  clavesDespacho,
  clavesDocumento,
  proveedores = [],
  puedeRegistrarProveedor = false,
  puedeVerAdquisiciones = false,
  codigos = null,
}: {
  lineas: LineaAtencionMaterial[]
  existencias: ExistenciaMaterial[]
  compras: CompraMaterialPendiente[]
  areas: AreaMaterial[]
  responsables: ResponsableMaterial[]
  puedeCrearCompra: boolean
  puedeAprobarDiseno: boolean
  puedeRevisarStock: boolean
  puedeAdjuntarDocumentos: boolean
  puedeVerCompras: boolean
  puedeRecibir: boolean
  puedeDespachar: boolean
  clavesCompra?: Record<string,string>
  clavesRecepcion: Record<string, string>
  clavesDespacho: Record<string, string>
  clavesDocumento: Record<string, string>
  /** El padrón activo, para elegir el proveedor de la orden de compra. */
  proveedores?: ProveedorParaCompra[]
  puedeRegistrarProveedor?: boolean
  /** Entra a Adquisiciones: el aviso de un anexo por revisar enlaza a la OC. */
  puedeVerAdquisiciones?: boolean
  /** Los códigos internos para buscar en la orden de compra; null si no se pudieron leer. */
  codigos?: CodigoParaElegir[] | null
}) {
  const [compraAbierta,setCompraAbierta]=useState(false)
  const [avisoCompra,setAvisoCompra]=useState<string|null>(null)
  const [filtro, setFiltro] = useState<Filtro>('TODOS')
  const agrupados = useMemo(() => {
    const grupos = new Map<string, LineaAtencionMaterial[]>()
    for (const linea of lineas) {
      if (filtro !== 'TODOS' && estadoOperativo(linea) !== filtro) continue
      const grupo = grupos.get(linea.requerimiento_id ?? '') ?? []
      grupo.push(linea)
      grupos.set(linea.requerimiento_id ?? '', grupo)
    }
    return [...grupos.entries()]
  }, [filtro, lineas])

  const completos = lineas.filter((linea) => linea.estado === 'ATENDIDO').length
  const porComprar = lineas.filter(l=>l.aprobacion_diseno==='APROBADO'&&l.decision_almacen==='COMPRA'&&Number(l.cantidad_solicitada)-Number(l.cantidad_stock??0)>Number(l.cantidad_comprada)).length
  const porRevisar = lineas.filter((linea) => estadoOperativo(linea) === 'ALMACEN').length
  const enAlmacen = lineas.filter((linea) => linea.estado === 'EN_ALMACEN').length
  const avanceLineas = lineas.length > 0 ? Math.round((completos / lineas.length) * 100) : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-lg font-semibold text-texto">Solicitudes y entregas</h2>
          <p className="mt-1 text-sm text-texto-suave">{porRevisar} por revisar · {porComprar} por comprar · {enAlmacen} por despachar · {completos} entregadas</p></div>
        {puedeCrearCompra && <Boton onClick={()=>{setAvisoCompra(null);setCompraAbierta(true)}} disabled={porComprar===0}><ShoppingCart aria-hidden className="size-4" />Nueva orden de compra</Boton>}
      </div>
      {avisoCompra && <p role="status" className="rounded-md bg-exito-suave px-3 py-2 text-sm text-exito">{avisoCompra}</p>}
      <Ventana abierta={compraAbierta} alCerrar={()=>setCompraAbierta(false)} titulo="Orden de compra" descripcion="Selecciona los insumos, registra sus precios y define el pago. Cada línea conserva su OT." ancho="xl">
        <FormularioCompra lineas={lineas.filter(l=>l.aprobacion_diseno==='APROBADO'&&l.decision_almacen==='COMPRA'&&Number(l.cantidad_solicitada)-Number(l.cantidad_stock??0)>Number(l.cantidad_comprada))} proveedores={proveedores} puedeRegistrarProveedor={puedeRegistrarProveedor} codigos={codigos} alTerminar={(mensaje)=>{setCompraAbierta(false);setAvisoCompra(mensaje??null)}} />
      </Ventana>
      {lineas.length > 0 && (
        <Tarjeta>
          <TarjetaCuerpo className="flex flex-wrap items-center gap-4">
            <div className="min-w-48 flex-1">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-texto">Atención completa de requerimientos</p>
                <p className="tabular text-sm font-semibold text-acento">{avanceLineas}%</p>
              </div>
              <Progreso valor={avanceLineas} etiqueta="Líneas de materiales entregadas por completo" />
              <p className="mt-1 text-xs text-texto-suave">
                {completos} de {lineas.length} líneas entregadas por completo. Este porcentaje mide materiales, separado del avance de fabricación.
              </p>
            </div>
            <Campo etiqueta="Estado" htmlFor="filtro-atencion"><Seleccion id="filtro-atencion" value={filtro} onChange={e=>{const v=e.target.value; if(v in NOMBRE_ESTADO||v==='TODOS')setFiltro(v)}}>
              <option value="TODOS">Todos los materiales</option>{Object.entries(NOMBRE_ESTADO).map(([v,t])=><option key={v} value={v}>{t}</option>)}
            </Seleccion></Campo>

          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {porComprar > 0 && <p className="text-xs text-texto-suave">{porComprar} {porComprar === 1 ? 'línea derivada' : 'líneas derivadas'} a Logística por Almacén, pendientes de compra.</p>}

      {agrupados.length > 0 && agrupados.map(([id, grupo]) => {
        const cabecera = grupo[0]
        const comprasReq = compras.filter((compra) => compra.requerimiento_id === cabecera.requerimiento_id)

        return (
          <Tarjeta key={id}>
            <TarjetaCabecera
              titulo={`OT ${cabecera.numero_ot ?? '—'} · ${NOMBRE_AREA[cabecera.area_destino ?? ''] ?? cabecera.area_destino ?? 'Área'}`}
              descripcion={`${grupo.length} ${grupo.length === 1 ? 'línea solicitada' : 'líneas solicitadas'} · ${formatearFecha(cabecera.creado_en)}`}
              acciones={<Insignia tono={TONO_ESTADO[estadoGrupo(grupo)]}>{NOMBRE_ESTADO[estadoGrupo(grupo)]}</Insignia>}
            />
            <TarjetaCuerpo className="space-y-3">
              {grupo.map((linea) => (
                <LineaMaterial
                  key={linea.detalle_id}
                  linea={linea}
                  responsables={responsables}
                  areas={areas}
                  compras={comprasReq.filter((compra) => compra.requerimiento_detalle_id === linea.detalle_id)}
                  existencias={existencias}
                  puedeVerCompras={puedeVerCompras}
                  puedeRecibir={puedeRecibir}
                  puedeDespachar={puedeDespachar}
                  puedeAprobarDiseno={puedeAprobarDiseno}
                  puedeRevisarStock={puedeRevisarStock}
                  claveDespacho={clavesDespacho[linea.detalle_id ?? '']}
                />
              ))}
            </TarjetaCuerpo>
          </Tarjeta>
        )
      })}

      {(puedeVerCompras||puedeRecibir||puedeAdjuntarDocumentos)&&[...new Map(compras.filter(c=>c.orden_compra_id).map(c=>[c.orden_compra_id,c])).values()].map(compra=>{
        const lineasCompra=compras.filter(c=>c.orden_compra_id===compra.orden_compra_id)
        const pendientesCompra=lineasCompra.filter(c=>Number(c.cantidad_pendiente)>0)
        const detenida=compraDetenida(compra.aprobacion)
        const aprobacion=APROBACION_COMPRA[compra.aprobacion]
        const situacion=situacionCompra(compra)
        return <Tarjeta key={compra.orden_compra_id}><TarjetaCabecera titulo={`${compra.sin_numero ? 'OC sin número' : compra.nombre} · ${compra.proveedor}`} descripcion={`${compra.sin_numero ? `Ref. del proveedor: ${compra.referencia} · ` : ''}${lineasCompra.length} ${lineasCompra.length === 1 ? 'insumo' : 'insumos'} · ${detenida?aprobacion?.descripcion:detalleDelRecojo(compra)}`} acciones={<Insignia tono={situacion.tono}>{situacion.etiqueta}</Insignia>}/><TarjetaCuerpo>
          <div className="space-y-3 border-t border-borde pt-3">
                  {puedeCrearCompra && detenida && (
                    <p className="text-xs text-texto-suave">Mientras no se apruebe no se descarga, no se envía al proveedor ni se entrega a Almacén. La decide quien aprueba las compras en <Link href="/compras/aprobacion" className="font-medium text-acento underline">Aprobación de compras</Link>.</p>
                  )}
                  {puedeCrearCompra && !detenida && [compra].length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-texto">Compra y recojo</p>
                      {[compra].map((compra) => compra.orden_compra_id && <CondicionCompra
                        key={`condicion-${compra.orden_compra_id}`} compra={compra} />)}
                      {[compra].map((compra) => compra.orden_compra_id && <RecojoCompra
                        key={compra.orden_compra_id} compra={compra} />)}
                      {[compra].map(c=><Link key={'pdf-'+c.orden_compra_id} href={`/compras/${c.orden_compra_id}/pdf`} className="inline-flex min-h-11 items-center text-sm font-medium text-acento underline">Descargar compra {c.nombre}</Link>)}
                      {lineasCompra.filter((compra) => compra.precio_unitario === null).map((compra) => (
                        <PrecioCompra key={compra.id} compra={compra} />
                      ))}
                    </div>
                  )}
                  {puedeRecibir && !detenida && pendientesCompra.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold text-texto">Llegadas pendientes</p>
                      {compra.recojo === 'DEJADO' ? (
                        <p className="mb-2 text-xs text-texto-suave">El conductor la dejó en el almacén. Valida el ingreso en el <Link href="/almacen/kardex" className="font-medium text-acento underline">kardex</Link>, sin volver a registrarlo.</p>
                      ) : compra.recojo ? (
                        <p className="mb-2 text-xs text-texto-suave">Va con el conductor. Cuando la deje en el almacén, el ingreso te llega al kardex para validarlo.</p>
                      ) : pendientesCompra.every((compra) => !compra.entregado_almacen_en) && (
                        <p className="mb-2 text-xs text-texto-suave">Todavía no va con el conductor: Logística la manda a recojo.</p>
                      )}
                      <div className="grid gap-2 lg:grid-cols-2">
                        {!compra.recojo && pendientesCompra.filter((compra) => compra.entregado_almacen_en).map((compra) => (
                          <FormularioRecepcion key={compra.id} compra={compra} clave={clavesRecepcion[compra.id ?? '']} />
                        ))}
                      </div>
                    </div>
                  )}
                  {puedeAdjuntarDocumentos && !detenida && [compra].length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-texto">Documentos para Tesorería</p>
                      {[compra].map((compra) => compra.orden_compra_id && (
                        <SubirDocumentoCompra
                          key={compra.orden_compra_id}
                          ordenCompraId={compra.orden_compra_id}
                          solicitudId={clavesDocumento[compra.orden_compra_id] ?? ''}
                          tipoInicial={compra.con_factura ? 'FACTURA' : 'COMPROBANTE'}
                          verAdquisiciones={puedeVerAdquisiciones}
                        />
                      ))}
                    </div>
                  )}
                </div>
        </TarjetaCuerpo></Tarjeta>
      })}
      {lineas.length > 0 && agrupados.length === 0 && (
        <Tarjeta><TarjetaCuerpo><p className="text-sm text-texto-suave">No hay materiales con este estado.</p></TarjetaCuerpo></Tarjeta>
      )}

    </div>
  )
}

/** Existencias globales y conteo físico, fuera del circuito de una OT. */
function PrecioCompra({ compra }: { compra: CompraMaterialPendiente }) {
  const { alEnviar, enviando, error } = useEnvio(registrarPrecioCompra)
  return <form onSubmit={alEnviar} className="flex flex-wrap items-end gap-2 rounded-md border border-borde p-2">
    <input type="hidden" name="detalle_id" value={compra.id ?? ''} />
    <span className="min-w-0 flex-1 text-xs text-texto">{compra.proveedor} · {compra.nombre}</span>
    <Campo etiqueta={`Precio unitario (${compra.moneda})`} htmlFor={`precio-${compra.id}`} ayuda="Sin IGV. Si el proveedor lo da con IGV, divídelo entre 1.18.">
      <Entrada id={`precio-${compra.id}`} name="precio" type="number" inputMode="decimal" min={0} step="0.01" required className="tabular w-32" />
    </Campo>
    <Boton type="submit" tamano="sm" cargando={enviando}>Registrar precio</Boton>
    {error && <p role="alert" className="basis-full text-xs text-peligro">{error}</p>}
  </form>
}

/** Una frase con lo que pasa con la compra después de emitida. */
function detalleDelRecojo(compra: CompraMaterialPendiente): string {
  if (compra.recojo === 'DEJADO' && compra.validacion) return VALIDACION_INGRESO[compra.validacion]?.descripcion ?? ''
  if (compra.recojo) return RECOJO_COMPRA[compra.recojo]?.descripcion ?? ''
  if (compra.entregado_almacen_en) return 'Entregada a Almacén antes de que hubiera conductor.'
  return 'Todavía no va con el conductor.'
}

/**
 * La compra va con el conductor: sale sola al aprobarse o al emitirse sin
 * aprobación. «Mandar a recojo» queda para las compras de antes.
 */
function RecojoCompra({ compra }: { compra: CompraMaterialPendiente }) {
  const envio = useAccion(mandarARecojo)
  // En qué va ya lo dice la cabecera de la tarjeta.
  if (!puedeIrARecojo(compra)) return null
  return <div className="flex flex-wrap items-center gap-2">
    <span className="min-w-0 flex-1 text-xs text-texto">{compra.proveedor} · {compra.nombre}</span>
    <Boton type="button" tamano="sm" variante="secundario" cargando={envio.enviando} onClick={() => {
      const datos = new FormData()
      datos.set('id', compra.orden_compra_id ?? '')
      envio.ejecutar(datos)
    }}><Truck aria-hidden className="size-4" />Mandar a recojo</Boton>
    <p className="basis-full text-[11px] text-texto-suave">El conductor la recoge donde el proveedor y la deja en el almacén; Almacén valida el ingreso sin volver a registrarlo.</p>
    {envio.error && <p role="alert" className="basis-full text-xs text-peligro">{envio.error}</p>}
  </div>
}

function CondicionCompra({ compra }: { compra: CompraMaterialPendiente }) {
  const { alEnviar, enviando, error, resultado } = useEnvio(fijarCondicionCompra)
  if (compra.entregado_almacen_en) return <p className="text-xs text-texto-suave">Pago: {condicionDePago(compra.condicion_pago, compra.dias_credito)} · {compra.moneda === 'USD' ? 'Dólares' : 'Soles'}</p>
  return <form onSubmit={alEnviar} className="grid gap-2 rounded-lg border border-borde p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
    <input type="hidden" name="compra_id" value={compra.orden_compra_id ?? ''} />
    <Campo etiqueta="Pago" htmlFor={`cond-${compra.orden_compra_id}`}><Seleccion id={`cond-${compra.orden_compra_id}`} name="condicion" defaultValue={compra.condicion_pago}><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></Seleccion></Campo>
    <Campo etiqueta="Días de crédito (0 si contado)" htmlFor={`dias-${compra.orden_compra_id}`}><Entrada id={`dias-${compra.orden_compra_id}`} name="dias" type="number" min={0} max={365} defaultValue={compra.dias_credito} required /></Campo>
    <Campo etiqueta="Moneda" htmlFor={`mon-${compra.orden_compra_id}`}><Seleccion id={`mon-${compra.orden_compra_id}`} name="moneda" defaultValue={compra.moneda}><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
    <Boton type="submit" tamano="sm" variante="secundario" cargando={enviando}>Guardar pago</Boton>
    {error && <p role="alert" className="text-xs text-peligro sm:col-span-4">{error}</p>}
    {resultado?.ok && <p role="status" className="text-xs text-exito sm:col-span-4">{resultado.mensaje}</p>}
  </form>
}

function LineaMaterial({
  linea,
  responsables,
  areas,
  compras,
  existencias,
  puedeVerCompras,
  puedeRecibir,
  puedeDespachar,
  puedeAprobarDiseno,
  puedeRevisarStock,
  claveDespacho,
}: {
  linea: LineaAtencionMaterial
  responsables: ResponsableMaterial[]
  areas: AreaMaterial[]
  compras: CompraMaterialPendiente[]
  existencias: ExistenciaMaterial[]
  puedeVerCompras: boolean
  puedeRecibir: boolean
  puedeDespachar: boolean
  puedeAprobarDiseno: boolean
  puedeRevisarStock: boolean
  claveDespacho: string | undefined
}) {
  const solicitado = Number(linea.cantidad_solicitada ?? 0)
  const comprado = Number(linea.cantidad_comprada ?? 0)
  const recibido = Number(linea.cantidad_recibida ?? 0)
  const despachado = Number(linea.cantidad_despachada ?? 0)
  const saldoGlobal = Number(existencias.find((item) => item.material_id === linea.material_id)?.existencia ?? 0)
  const reserva = Number(linea.cantidad_stock ?? (linea.decision_almacen==='STOCK'?solicitado:0))
  const saldoDeCompra = reserva + recibido - despachado
  const disponible = Math.max(0, Math.min(saldoGlobal, saldoDeCompra, solicitado - despachado))
  const porcentaje = solicitado > 0 ? Math.min(100, Math.round((despachado / solicitado) * 100)) : 0
  const areaId = areas.find((area) => area.codigo === linea.area_destino)?.id
  const candidatos = responsables.filter((persona) => persona.area_id === areaId)

  return (
    <div className="rounded-[var(--radius-base)] border border-borde bg-superficie p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-texto">{linea.material ?? 'Material'}</p>
            <Insignia tono={TONO_ESTADO[estadoOperativo(linea)] ?? 'neutro'}>{NOMBRE_ESTADO[estadoOperativo(linea)] ?? 'Solicitado'}</Insignia>
          </div>
          <p className="mt-1 text-xs text-texto-suave">
            {linea.material_codigo ?? ''}{linea.numero_plano ? ` · Plano ${linea.numero_plano}` : ''}{linea.plano ? ` · ${linea.plano}` : ''}
          </p>
        </div>
        <div className="min-w-52 flex-1 sm:max-w-72">
          <div className="mb-1 flex justify-between gap-2 text-[11px] text-texto-suave">
            <span>Entregado al área</span><span className="tabular font-medium text-texto">{porcentaje}%</span>
          </div>
          <Progreso valor={porcentaje} etiqueta={`Material entregado: ${linea.material ?? 'material'}`} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <CantidadMini nombre="Solicitado" valor={solicitado} unidad={linea.unidad} />
        <CantidadMini nombre="Comprado" valor={comprado} unidad={linea.unidad} />
        <CantidadMini nombre="Recibido" valor={recibido} unidad={linea.unidad} />
        <CantidadMini nombre="Entregado" valor={despachado} unidad={linea.unidad} />
      </div>

      {puedeRevisarStock && linea.aprobacion_diseno === 'APROBADO' && linea.decision_almacen === 'PENDIENTE' && (
        <p className="mt-3 text-xs text-texto-suave">Saldo registrado de este material: <span className="font-semibold tabular text-texto">{cantidad(saldoGlobal)} {linea.unidad}</span>. Si existe físicamente pero no está registrado, verifica su ingreso antes de marcar «Hay stock».</p>
      )}
      {puedeRevisarStock && linea.aprobacion_diseno === 'APROBADO' &&
        linea.decision_almacen === 'PENDIENTE' && (
        <Link href={`/almacen/kardex?material=${linea.material_id}`} className="mt-2 inline-block text-sm text-acento underline">Ver el kardex de este material</Link>
      )}

      {linea.aprobacion_diseno === 'PROPUESTO' && (
        puedeAprobarDiseno ? <DecisionMaterial linea={linea} tipo="diseno" />
          : <p className="mt-3 text-xs text-aviso">Pendiente de aprobación de Diseño.</p>
      )}
      {linea.aprobacion_diseno === 'RECHAZADO' && <p className="mt-3 text-xs text-peligro">Diseño rechazó esta propuesta.</p>}
      {linea.aprobacion_diseno === 'APROBADO' && linea.decision_almacen === 'PENDIENTE' && (
        puedeRevisarStock ? <DecisionMaterial linea={linea} tipo="almacen" />
          : <p className="mt-3 text-xs text-aviso">Almacén revisará si hay stock.</p>
      )}
      {puedeRevisarStock && linea.aprobacion_diseno === 'APROBADO' &&
        linea.decision_almacen === 'COMPRA' && compras.length === 0 && (
        <ReconsiderarStock linea={linea} />
      )}

      {linea.responsables && (
        <p className="mt-3 border-t border-borde pt-2 text-xs text-texto-suave">
          Recibió: <span className="font-medium text-texto">{linea.responsables}</span>
        </p>
      )}

      {puedeDespachar && linea.aprobacion_diseno === 'APROBADO' && linea.decision_almacen !== 'PENDIENTE' && disponible > 0 && (
        <FormularioDespacho
          linea={linea}
          candidatos={candidatos}
          disponible={disponible}
          clave={claveDespacho}
        />
      )}

      {puedeRecibir && compras.length > 0 && !puedeVerCompras && <p className="mt-3 text-xs text-texto-suave">Hay compras esperando ingreso en almacén.</p>}
    </div>
  )
}

function ReconsiderarStock({ linea }: { linea: LineaAtencionMaterial }) {
  const { alEnviar, enviando, error } = useEnvio(revisarStock)
  return <form onSubmit={alEnviar} className="mt-3 flex flex-wrap items-center gap-2">
    <input type="hidden" name="detalle_id" value={linea.detalle_id ?? ''} />
    <input type="hidden" name="decision" value="STOCK" />
    <Boton type="submit" variante="secundario" tamano="sm" cargando={enviando}>Cambiar a stock disponible</Boton>
    <p className="text-xs text-texto-suave">Solo antes de registrar una compra y si el saldo libre alcanza.</p>
    {error && <p role="alert" className="basis-full text-xs text-peligro">{error}</p>}
  </form>
}

function DecisionMaterial({ linea, tipo }: { linea: LineaAtencionMaterial; tipo: 'diseno' | 'almacen' }) {
  const { alEnviar, enviando, error } = useEnvio(tipo === 'diseno' ? resolverPropuesta : revisarStock)
  return <form onSubmit={alEnviar} className="mt-3 flex flex-wrap items-end gap-2 border-t border-borde pt-3">
    <input type="hidden" name="detalle_id" value={linea.detalle_id ?? ''} />
    <Campo etiqueta={tipo === 'diseno' ? 'Decisión de Diseño' : 'Revisión de Almacén'} htmlFor={`decision-${tipo}-${linea.detalle_id}`}>
      <Seleccion id={`decision-${tipo}-${linea.detalle_id}`} name="decision" required defaultValue="">
        <option value="" disabled>Elige una opción</option>
        {tipo === 'diseno' ? <><option value="aprobar">Aprobar</option><option value="rechazar">Rechazar</option></>
          : <><option value="STOCK">Hay stock</option><option value="COMPRA">Derivar a Logística</option></>}
      </Seleccion>
    </Campo>
    <Boton type="submit" tamano="sm" cargando={enviando}>Guardar decisión</Boton>
    {error && <p role="alert" className="basis-full text-xs text-peligro">{error}</p>}
  </form>
}

function CantidadMini({ nombre, valor, unidad }: { nombre: string; valor: number; unidad: string | null }) {
  return <div className="rounded-md bg-superficie-2 px-2 py-1.5"><p className="text-texto-suave">{nombre}</p><p className="tabular mt-0.5 font-semibold text-texto">{cantidad(valor)} {unidad}</p></div>
}

function FormularioCompra({lineas,proveedores,puedeRegistrarProveedor,codigos,alTerminar}:{lineas:LineaAtencionMaterial[];proveedores:ProveedorParaCompra[];puedeRegistrarProveedor:boolean;codigos:CodigoParaElegir[]|null;alTerminar:(mensaje?:string)=>void}) {
 const [id]=useState(()=>crypto.randomUUID())
 const [seleccionados,setSeleccionados]=useState<string[]>([])
 // El que se registra desde aquí se suma a la lista sin esperar a que la
 // pantalla se vuelva a cargar, y queda elegido.
 const [nuevos,setNuevos]=useState<ProveedorParaCompra[]>([])
 const [proveedorId,setProveedorId]=useState('')
 const [condicion,setCondicion]=useState('CONTADO')
 const [dias,setDias]=useState(0)
 const [altaAbierta,setAltaAbierta]=useState(false)
 const [avisoAlta,setAvisoAlta]=useState<string|null>(null)
 const [conFactura,setConFactura]=useState(true)
 const padron=useMemo(()=>{const vistos=new Set(proveedores.map(p=>p.id));return [...proveedores,...nuevos.filter(n=>!vistos.has(n.id))]},[proveedores,nuevos])
 const {alEnviar,enviando,error}=useEnvio(crearOrdenCompra,(r)=>alTerminar(r.mensaje))
 // Si la pantalla se refresca con la ventana abierta, una línea elegida que otra
 // compra acaba de cubrir desaparece de la lista: deja de contar como elegida.
 const elegidas=seleccionados.filter(id=>lineas.some(l=>l.detalle_id===id))
 // Elegir el proveedor trae su pago habitual; se puede cambiar para esta compra.
 function elegir(id:string){
   setProveedorId(id)
   const p=padron.find(x=>x.id===id)
   if(p){setCondicion(p.condicion_pago);setDias(p.dias_credito)}
 }
 return <><form onSubmit={alEnviar} className="space-y-6">
   <input type="hidden" name="operacion_id" value={id}/>
   <div className="grid gap-4 sm:grid-cols-2">
     <Campo etiqueta="Proveedor" htmlFor="oc-proveedor" requerido ayuda={padron.length===0?'El padrón está vacío: registra el primero.':undefined}>
       <div className="flex gap-2">
         <SeleccionBuscable id="oc-proveedor" name="proveedor_id" className="min-w-0 flex-1" requerido valor={proveedorId} onChange={elegir} marcador="Elige del padrón…" marcadorBusqueda="Razón social o RUC…" opciones={padron.map(p=>({valor:p.id,etiqueta:p.razon_social,detalle:`${p.numero_documento} · ${condicionDePago(p.condicion_pago,p.dias_credito)}`}))}/>
         {puedeRegistrarProveedor&&<Boton type="button" variante="contorno" onClick={()=>{setAvisoAlta(null);setAltaAbierta(true)}}><Plus aria-hidden className="size-4"/>Nuevo</Boton>}
       </div>
       {avisoAlta&&<p role="status" className="text-xs text-exito">{avisoAlta}</p>}
     </Campo>
     <Campo etiqueta="Referencia del proveedor" htmlFor="oc-numero" requerido ayuda="Su cotización o proforma. El número OC-…-MW lo pone el sistema al emitir."><Entrada id="oc-numero" name="referencia" required minLength={2} maxLength={100}/></Campo>
     <Campo etiqueta="Código interno" htmlFor="oc-codigo" requerido ayuda={AYUDA_CODIGO_INTERNO}><CodigoInternoConLista id="oc-codigo" name="codigo_interno" requerido codigos={codigos} fijos={CODIGOS_FIJOS}/></Campo>
     <Campo etiqueta="Comprobante" htmlFor="oc-comprobante" ayuda={comprobantePedido(conFactura).pide}><Seleccion id="oc-comprobante" name="con_factura" value={conFactura?'true':'false'} onChange={e=>setConFactura(e.target.value==='true')}><option value="true">Con factura</option><option value="false">Sin factura</option></Seleccion></Campo>
     <Campo etiqueta="Entrega estimada" htmlFor="oc-fecha"><Entrada id="oc-fecha" name="fecha_estimada" type="date"/></Campo>
     <Campo etiqueta="Moneda" htmlFor="oc-moneda"><Seleccion id="oc-moneda" name="moneda"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
     <Campo etiqueta="Pago" htmlFor="oc-pago"><Seleccion id="oc-pago" name="condicion" value={condicion} onChange={e=>{setCondicion(e.target.value);if(e.target.value==='CONTADO')setDias(0)}}><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option></Seleccion></Campo>
     <Campo etiqueta="Días de crédito" ayuda="0 para contado" htmlFor="oc-dias"><Entrada id="oc-dias" name="dias" type="number" min={condicion==='CREDITO'?1:0} max={condicion==='CREDITO'?365:0} value={dias} onChange={e=>setDias(Number(e.target.value))}/></Campo>
   </div>
   <fieldset className="space-y-3"><legend className="mb-3 font-semibold text-texto">Insumos pendientes · {elegidas.length} seleccionados</legend>
     {lineas.map(l=>{const id=l.detalle_id??'';const seleccionado=seleccionados.includes(id);const faltante=Number(l.cantidad_solicitada)-Number(l.cantidad_stock??0)-Number(l.cantidad_comprada);return <div key={id} className="rounded-xl border border-borde p-4">
       <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-texto"><input type="checkbox" name="detalle_id" value={id} checked={seleccionado} onChange={e=>setSeleccionados(e.target.checked?[...seleccionados,id]:seleccionados.filter(x=>x!==id))} className="size-5 accent-acento"/>{l.material}</label>
       <p className="ml-8 text-xs text-texto-suave">OT {l.numero_ot} · {NOMBRE_AREA[l.area_destino??'']} · Faltan {cantidad(faltante)} {l.unidad}</p>
       {seleccionado&&<div className="mt-3 grid gap-3 sm:grid-cols-2"><Campo etiqueta="Cantidad a comprar" htmlFor={'oc-cant-'+id}><Entrada id={'oc-cant-'+id} name={'cantidad_'+id} type="number" min={0.001} max={faltante} step="0.001" defaultValue={faltante} required/></Campo>
       <Campo etiqueta="Precio unitario sin IGV" htmlFor={'oc-precio-'+id}><Entrada id={'oc-precio-'+id} name={'precio_'+id} type="number" min={0} step="0.01" required/></Campo></div>}
     </div>})}
     {lineas.length===0&&<p className="text-sm text-texto-suave">Almacén aún no derivó insumos pendientes de compra.</p>}
   </fieldset>
   {error&&<p role="alert" className="text-sm text-peligro">{error}</p>}
   <Boton type="submit" cargando={enviando} disabled={!elegidas.length||!proveedorId}>Crear orden de compra</Boton>
 </form>
 <Ventana abierta={altaAbierta} alCerrar={()=>setAltaAbierta(false)} titulo="Nuevo proveedor" descripcion="Queda en el padrón y elegido para esta compra. Lo demás se completa en Proveedores." ancho="md">
   <FormularioProveedor breve alTerminar={(creado,mensaje)=>{
     setAltaAbierta(false)
     if(!creado)return
     setNuevos(n=>[...n.filter(x=>x.id!==creado.id),creado])
     setProveedorId(creado.id);setCondicion(creado.condicion_pago);setDias(creado.dias_credito)
     setAvisoAlta(mensaje??null)
   }}/>
 </Ventana>
 </>
}

function FormularioRecepcion({ compra, clave }: { compra: CompraMaterialPendiente; clave: string | undefined }) {
  const { alEnviar, enviando, error } = useEnvio(registrarRecepcion)
  const restante = Number(compra.cantidad_pendiente ?? 0)
  return (
    <form onSubmit={alEnviar} className="grid gap-2 rounded-md border border-borde p-3 sm:grid-cols-2">
      <input type="hidden" name="operacion_id" value={clave ?? ''} />
      <input type="hidden" name="compra_detalle_id" value={compra.id ?? ''} />
      <div className="sm:col-span-2">
        <p className="text-xs font-medium text-texto">{compra.proveedor} · {compra.nombre}</p>
        <p className="mt-0.5 text-[11px] text-texto-suave">Pendiente {cantidad(restante)} · estimado {formatearFecha(compra.fecha_estimada)}</p>
      </div>
      <Campo etiqueta="Cantidad que llegó" htmlFor={`rec-cant-${compra.id}`} requerido>
        <Entrada id={`rec-cant-${compra.id}`} name="cantidad" type="number" inputMode="decimal" min={0.001} max={restante} step="0.001" defaultValue={restante} required />
      </Campo>
      <Campo etiqueta="Guía o documento" htmlFor={`rec-doc-${compra.id}`} requerido>
        <Entrada id={`rec-doc-${compra.id}`} name="documento_referencia" required maxLength={100} placeholder="Guía de remisión" />
      </Campo>
      {error && <p role="alert" className="text-xs text-peligro sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2"><Boton type="submit" variante="secundario" tamano="sm" cargando={enviando} className="w-full"><ArrowDownToLine aria-hidden className="size-4" />Registrar llegada a almacén</Boton></div>
    </form>
  )
}

function FormularioDespacho({
  linea,
  candidatos,
  disponible,
  clave,
}: {
  linea: LineaAtencionMaterial
  candidatos: ResponsableMaterial[]
  disponible: number
  clave: string | undefined
}) {
  const { alEnviar, enviando, error } = useEnvio(async (_previo,datos)=>{
    const archivo=datos.get('foto')
    if(!(archivo instanceof File)||archivo.size===0||archivo.size>10485760||!['image/jpeg','image/png','image/webp'].includes(archivo.type)) return {ok:false,error:'Selecciona una foto JPG, PNG o WebP de hasta 10 MB.'}
    const db=createClient();const {data,error}=await db.auth.getUser()
    if(error?.name==='AuthRetryableFetchError')return {ok:false,error:SIN_RESPUESTA}
    if(error||!data.user)return {ok:false,error:'Tu sesión terminó. Ingresa de nuevo.'}
    const extension=archivo.type==='image/jpeg'?'jpg':archivo.type==='image/png'?'png':'webp'
    const ruta=data.user.id+'/'+String(datos.get('operacion_id'))+'.'+extension
    datos.delete('foto');datos.set('foto_ruta',ruta)
    return subirArchivoPrivado({bucket:'evidencias-almacen',ruta,archivo,contentType:archivo.type,registrar:()=>despacharMaterial(null,datos)})
  })
  return (
    <form onSubmit={alEnviar} className="mt-3 grid gap-2 border-t border-borde pt-3 sm:grid-cols-[1fr_1fr_auto]">
      <input type="hidden" name="operacion_id" value={clave ?? ''} />
      <input type="hidden" name="requerimiento_detalle_id" value={linea.detalle_id ?? ''} />
      <Campo etiqueta="Cantidad a entregar" htmlFor={`sal-cant-${linea.detalle_id}`} requerido>
        <Entrada id={`sal-cant-${linea.detalle_id}`} name="cantidad" type="number" inputMode="decimal" min={0.001} max={disponible} step="0.001" defaultValue={disponible} required />
        <p className="mt-1 text-[11px] text-texto-suave">Disponible para este requerimiento: {cantidad(disponible)}</p>
      </Campo>
      <Campo etiqueta="Entregar a" htmlFor={`sal-persona-${linea.detalle_id}`} requerido>
        <Seleccion id={`sal-persona-${linea.detalle_id}`} name="responsable_id" required defaultValue="">
          <option value="" disabled>Elige a quien recibe</option>
          {candidatos.map((persona) => <option key={persona.id} value={persona.id}>{persona.nombres} {persona.apellidos}</option>)}
        </Seleccion>
        {candidatos.length === 0 && <p className="mt-1 text-[11px] text-aviso">No hay personas activas registradas para {NOMBRE_AREA[linea.area_destino ?? ''] ?? 'esta área'}.</p>}
      </Campo>
      <Campo etiqueta="Nombre de quien recibe físicamente" htmlFor={`sal-nombre-${linea.detalle_id}`} requerido><Entrada id={`sal-nombre-${linea.detalle_id}`} name="recibido_por_nombre" required minLength={3} maxLength={160}/></Campo>
      <Campo etiqueta="Foto de la entrega" htmlFor={`sal-foto-${linea.detalle_id}`} ayuda="Que se vea el material entregado." requerido><ElegirArchivo id={`sal-foto-${linea.detalle_id}`} name="foto" accept="image/jpeg,image/png,image/webp" hastaMb={10} capture="environment" required/></Campo>
      <div className="flex items-end"><Boton type="submit" tamano="sm" cargando={enviando} disabled={candidatos.length === 0} className="w-full"><ArrowUpFromLine aria-hidden className="size-4" />Despachar</Boton></div>
      {error && <p role="alert" className="text-xs text-peligro sm:col-span-3">{error}</p>}
    </form>
  )
}

function estadoGrupo(lineas: LineaAtencionMaterial[]): string {
  const prioridades: Record<string, number> = { RECHAZADO: 0, DISENO: 1, ALMACEN: 2, STOCK: 3, SOLICITADO: 4, EN_COMPRA: 5, EN_ALMACEN: 6, ATENDIDO: 7 }
  return lineas.reduce((actual, linea) =>
    (prioridades[estadoOperativo(linea)] ?? 0) < (prioridades[actual] ?? 0)
      ? estadoOperativo(linea)
      : actual,
  'ATENDIDO')
}
