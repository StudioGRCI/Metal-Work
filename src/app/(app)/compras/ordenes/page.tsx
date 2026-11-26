import { FileDown } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { ConAvisos } from '@/app/(app)/requerimientos/atencion/avisos'
import { Recorrido } from '@/components/ui/recorrido'
import { AccionesDeFila, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { correccionesDe, type CorreccionVista } from '@/lib/datos/correcciones'
import { catalogoDeAlmacen } from '@/lib/datos/atencion-materiales'
import { codigosParaElegir } from '@/lib/datos/codigos-para-elegir'
import { devolucionesPorReponer } from '@/lib/datos/kardex'
import { cargarOrdenesCompra, type OrdenCompraListada } from '@/lib/datos/logistica'
import { plazosDeCompras } from '@/lib/datos/plazos-compras'
import { recorridoDeOrdenesCompra } from '@/lib/datos/recorrido'
import { proveedoresParaCompra } from '@/lib/datos/proveedores'
import { ocParaDetector } from '@/lib/dominio/adquisiciones'
import { igvCompra } from '@/lib/dominio/compra-materiales'
import { ORIGEN_COMPRA, puedeIrARecojo, situacionCompra } from '@/lib/dominio/logistica'
import { FILTRO_ATRASADAS, type PlazoDeCompra } from '@/lib/dominio/plazos'
import { correccionDeLaFecha, describirRecorridoDeLaOrdenDeCompra, type PasoDelRecorrido } from '@/lib/dominio/recorrido'
import { comprobantePedido, compraConPdf, condicionDePago } from '@/lib/dominio/proveedores'
import { fecha, moneda } from '@/lib/format'
import { compraComoLogistica, exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { EsperanReposicion } from '../../almacen/kardex/devolucion-proveedor'

import { InsigniaDelPlazo, PlazoDeLaCompra, UltimoMotivo } from '../plazo'
import { SeguimientoDeLaCompra } from '../seguimiento'
import { VerTodas } from '../ver-todas'

import { AccionesCompra } from './acciones-compra'
import { NuevaCompraDirecta } from './formulario-directa'

export const metadata = { title: 'Órdenes de compra' }

function divisa(codigo: string) {
  return codigo === 'USD' ? 'USD' : 'PEN'
}

export default async function PaginaOrdenesCompra({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const perfil = await exigirPermiso(['compras.crear', 'compras.ver'])
  // Emite la OC directa y lleva todas las OC quien compra como Logística. Administración
  // tiene `compras.crear` solo para la OC de su RQA: aquí lleva esa y mira las demás.
  const emite = compraComoLogistica(perfil)
  const llevaSuRqa = !emite && puede(perfil, 'compras.crear')
  const verAdquisiciones = puede(perfil, 'adquisiciones.ver')
  const [compras, proveedores, materiales, codigos, porReponer] = await Promise.all([
    cargarOrdenesCompra(),
    emite ? proveedoresParaCompra() : Promise.resolve([]),
    emite ? catalogoDeAlmacen() : Promise.resolve([]),
    emite ? codigosParaElegir() : Promise.resolve(null),
    // Lo que Almacén devolvió al proveedor y espera reposición: Logística dice si ya no viene.
    puede(perfil, ['compras.crear', 'almacen.ver']) ? devolucionesPorReponer() : Promise.resolve([]),
  ])
  const monedaDe = new Map(compras.map((c) => [c.id, c.moneda]))
  const [correcciones, plazos, recorridos, params] = await Promise.all([
    correccionesDe('ORDEN_COMPRA', compras.map((c) => c.id), (id) => monedaDe.get(id) ?? null),
    // Cada OC contra la fecha que prometió el proveedor. Si la base no contesta,
    // la lista sale igual, sin plazos, y lo dice arriba.
    plazosDeCompras(compras.map((c) => c.id)).catch((e: unknown) => {
      console.error(e)
      return null
    }),
    // Quién tiene cada OC, y el motivo y la fecha que anotó Logística (Plan 4.2).
    // Sin respuesta, cada fila lo dice en su recorrido.
    recorridoDeOrdenesCompra(compras.map((c) => c.id)).catch((e: unknown) => {
      console.error(e)
      return null
    }),
    searchParams,
  ])
  const esperan = new Set(porReponer.map((d) => d.orden_compra_id))
  const pideAtrasadas = params.ver === FILTRO_ATRASADAS
  const soloAtrasadas = pideAtrasadas && plazos !== null
  const atrasadas = plazos ? compras.filter((c) => plazos.get(c.id)?.atrasada).length : 0
  // Las atrasadas, de la que más días lleva a la que menos.
  const visibles = soloAtrasadas
    ? compras
        .filter((c) => plazos?.get(c.id)?.atrasada)
        .sort((a, b) => (plazos?.get(b.id)?.dias_atraso ?? 0) - (plazos?.get(a.id)?.dias_atraso ?? 0))
    : compras
  const sinComprobante = compras.filter((c) => !c.tiene_factura && c.aprobacion !== 'RECHAZADA' && c.aprobacion !== 'ANULADA').length

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de compra"
        ayuda="Todas las órdenes, con su número OC-…-MW: las que nacen de un requerimiento y las directas para el almacén, cada una con su código interno. Aquí se ve si esperan a Gerencia, si el conductor ya las recogió y si falta el comprobante."
        migas={[{ titulo: 'Compras' }, { titulo: 'Órdenes de compra' }]}
        acciones={
          emite && (
            <NuevaCompraDirecta
              proveedores={proveedores}
              materiales={materiales}
              codigos={codigos}
              puedeRegistrarProveedor={puede(perfil, 'proveedores.editar')}
            />
          )
        }
      />

      {sinComprobante > 0 && (
        <p className="mb-3 text-sm text-texto-suave">
          <span className="tabular font-semibold text-texto">{sinComprobante}</span>{' '}
          {sinComprobante === 1
            ? 'orden sigue sin su comprobante adjunto (factura, o boleta si es sin factura).'
            : 'órdenes siguen sin su comprobante adjunto (factura, o boleta si es sin factura).'}
        </p>
      )}

      {porReponer.length > 0 && (
        <Tarjeta id="por-reponer" className="mb-4 scroll-mt-20">
          <TarjetaCabecera
            titulo={`Devuelto al proveedor · ${porReponer.length === 1 ? '1 espera reposición' : `${porReponer.length} esperan reposición`}`}
            ayuda="Almacén devolvió lo que llegó malo y el proveedor dijo que lo repone. Si ya no viene, dilo: lo que falta vuelve a la lista para comprarlo en otra OC."
          />
          <TarjetaCuerpo>
            <EsperanReposicion devoluciones={porReponer} puedeRecibir={false} puedeDejar={emite} />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {plazos === null ? (
        <p role="status" className="mb-3 text-sm text-aviso">
          No se pudo leer el plazo de las órdenes: la lista sale sin sus fechas
          {pideAtrasadas ? ', y el filtro «Atrasadas» no está disponible: se ven todas' : ''}. Recarga la página; si continúa, avisa al
          administrador.
        </p>
      ) : (
        compras.length > 0 && (
          <PastillaFiltro
            ruta="/compras/ordenes"
            clave="ver"
            params={params}
            activo={soloAtrasadas ? FILTRO_ATRASADAS : null}
            etiqueta="Todas o solo las atrasadas"
            className="mb-3"
            opciones={[
              { valor: null, etiqueta: `Todas (${compras.length})` },
              { valor: FILTRO_ATRASADAS, etiqueta: `Atrasadas (${atrasadas})` },
            ]}
          />
        )
      )}

      {/* Lo que dijo la ventana del motivo o de la fecha va arriba: con «Atrasadas», corregir la fecha saca la fila de la lista. */}
      <ConAvisos>
      <Tarjeta className="overflow-hidden">
        <Tabla apilada>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              {/* «Para» espera a 1 280 px: entre 768 y 1 279 la tabla se deslizaba de costado y tapaba los botones. */}
              <TH className="hidden xl:table-cell">Para</TH>
              {/* Por debajo de 768 px cada OC es una ficha (`apilada`): el monto, en qué va y el plazo viajan bajo el número, y el recorrido abierto y los botones van a lo ancho. Con sus columnas la tabla medía 461 px en una pantalla de 390, y el recorrido quedaba en una columna de 150 px. */}
              <TH className="hidden text-right md:table-cell">Monto sin IGV</TH>
              <TH className="hidden md:table-cell">En qué va</TH>
              {/* «Comprobante» también espera a 1 280 px: entre 768 y 1 279 la columna «Orden» quedaba de 83 px y partía el proveedor palabra por palabra. Su dato va bajo el número. */}
              <TH className="hidden xl:table-cell">Comprobante</TH>
              {/* Con `relative`, el rótulo oculto queda dentro de la tabla que se desliza y no ensancha la página en el teléfono. El ancho, solo para quien tiene los botones: a quien consulta le queda «PDF». */}
              <TH className={cn('relative text-right', (emite || (llevaSuRqa && visibles.some(esDeUnRqa))) && 'md:w-64')}>
                <span className="sr-only">Acciones</span>
              </TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {soloAtrasadas && compras.length > 0 && visibles.length === 0 ? (
              <SinDatos
                titulo="Ninguna orden de compra está atrasada"
                descripcion="Ninguna vigente pasó la fecha que prometió el proveedor sin llegar completa."
                accion={<VerTodas ruta="/compras/ordenes" params={params} />}
              />
            ) : compras.length === 0 ? (
              <SinDatos
                titulo="Todavía no hay órdenes de compra"
                descripcion={
                  emite
                    ? 'Emite una directa con «Nueva OC directa», o desde Compras para atender un requerimiento.'
                    : 'Logística las emite; aparecen aquí con su número.'
                }
              />
            ) : (
              visibles.map((c) => <FilaCompra key={c.id} compra={c} plazo={plazos?.get(c.id)} recorrido={recorridos ? (recorridos.get(c.id) ?? []) : null} emite={emite || (llevaSuRqa && esDeUnRqa(c))} verAdquisiciones={verAdquisiciones} correcciones={correcciones.get(c.id)} esperaReposicion={esperan.has(c.id)} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
      </ConAvisos>
    </>
  )
}

/** La OC compra solo insumos de un RQA (RQA-0001-2026…): la que Administración lleva. */
function esDeUnRqa(c: OrdenCompraListada) {
  return c.requerimientos.length > 0 && c.requerimientos.every((rq) => rq.startsWith('RQA-'))
}

function FilaCompra({
  compra: c,
  plazo,
  recorrido,
  emite,
  verAdquisiciones,
  correcciones,
  esperaReposicion,
}: {
  compra: OrdenCompraListada
  plazo: PlazoDeCompra | undefined
  /** `null`: no se pudo leer. */
  recorrido: PasoDelRecorrido[] | null
  emite: boolean
  verAdquisiciones: boolean
  correcciones: CorreccionVista[] | undefined
  esperaReposicion: boolean
}) {
  // Validada en el almacén, pero Almacén devolvió parte y el proveedor la repone: la tarjeta de arriba dice cuánto.
  const reposicion = esperaReposicion && (
    <a href="#por-reponer" className="rounded focus-visible:outline-2 focus-visible:outline-acento">
      <Insignia tono="aviso">Espera reposición</Insignia>
    </a>
  )
  const origen = ORIGEN_COMPRA[c.origen === 'DIRECTA' && c.requerimientos.length > 0 ? 'RQ' : c.origen]
  const situacion = situacionCompra(c)
  const corregida = correccionDeLaFecha(recorrido)
  // Quién la tiene ahora y hace cuántos días; abierto, cada paso y lo que anotó Logística.
  const historia = (
    <Recorrido
      pasos={recorrido ? describirRecorridoDeLaOrdenDeCompra(recorrido) : null}
      className="mt-2 rounded-[var(--radius-base)] border border-borde"
      relleno="px-2.5"
      femenino
    />
  )
  const vigente = c.aprobacion !== 'RECHAZADA' && c.aprobacion !== 'ANULADA'
  const para = [
    // La OC que junta insumos de varios RQ no tiene un código propio: lleva el de cada uno.
    c.codigo_interno ?? (c.codigos.length ? c.codigos.join(', ') : null),
    ...(c.origen === 'DIRECTA'
      ? [c.requerimientos.length ? null : 'Almacén']
      : [c.codigo_interno || c.codigos.length ? null : 'Solicitud de antes de los RQ', ...c.unidades]),
    // Qué requerimiento (RQ-0001-2026…) atiende esta compra, si nació de uno.
    c.requerimientos.length ? c.requerimientos.join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const comprobante = comprobantePedido(c.con_factura)
  // La rechazada y la anulada no se atienden ni se pagan: no esperan comprobante.
  const sinCurso = c.aprobacion === 'RECHAZADA' || c.aprobacion === 'ANULADA'
  return (
    // La OC sin número se encuentra por su referencia: es lo que cita el proveedor.
    <TR id={`oc-${c.id}`} data-compra={c.numero ?? c.referencia} className="scroll-mt-20 target:bg-acento-suave">
      <TD>
        <div className="flex flex-wrap items-center gap-2">
          <span className={c.numero ? 'tabular font-semibold whitespace-nowrap text-texto' : 'font-semibold text-texto'}>{c.numero ?? 'OC sin número'}</span>
          {origen && <Insignia tono={origen.tono}>{origen.etiqueta}</Insignia>}
        </div>
        {/* Lo único que distingue dos OC sin número del mismo proveedor: va primero, como en Gestión. */}
        {c.numero === null && <p className="text-xs text-texto-suave">Ref. del proveedor: {c.referencia}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
          <span className="tabular text-sm font-semibold text-texto">{moneda(c.monto, divisa(c.moneda))}</span>
          <span className="text-xs text-texto-suave">sin IGV</span>
          <Insignia tono={situacion.tono}>{situacion.etiqueta}</Insignia>
          <InsigniaDelPlazo plazo={plazo} />
          {reposicion}
        </div>
        {/* Lo que la columna «Comprobante» dice, hasta que la columna aparece (1 280 px). */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 xl:hidden">
          {c.tiene_factura ? (
            <Insignia tono="exito">Comprobante adjunto</Insignia>
          ) : sinCurso ? (
            <span className="text-xs text-texto-suave">No se paga</span>
          ) : (
            <span className="text-xs text-texto-suave">{comprobantePendiente(c)}</span>
          )}
          {/* En la ficha, lo que la columna «Comprobante» dice debajo: qué se pidió y qué facturas tiene. */}
          {!sinCurso && <span className="text-xs text-texto-suave">{comprobante.etiqueta}</span>}
          {c.facturas.length > 0 && (
            <span className="tabular text-xs text-texto">{c.facturas.map((f) => f.numero).join(', ')}</span>
          )}
        </div>
        <p className="text-xs text-texto">{c.proveedor}</p>
        <p className="text-xs text-texto-suave">
          {[
            c.numero !== null && c.referencia && c.referencia !== c.numero ? `Ref. ${c.referencia}` : null,
            condicionDePago(c.condicion_pago, c.dias_credito),
            `${c.lineas} ${c.lineas === 1 ? 'línea' : 'líneas'}`,
            fecha(c.creado_en),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {c.motivo && <p className="mt-1 text-xs text-texto-suave">Motivo: {c.motivo}</p>}
        {c.motivo_rechazo && (
          <p className="mt-1 text-xs text-peligro">
            {c.aprobacion === 'ANULADA' ? 'Anulada' : 'Rechazada'}: {c.motivo_rechazo}
          </p>
        )}
        <p className="text-xs text-texto-suave xl:hidden">Para {para || '—'}</p>
        {/* En el teléfono el plazo va aquí, con el resto de la fila. */}
        <PlazoDeLaCompra plazo={plazo} corregida={corregida} className="mt-1 md:hidden" />
        <UltimoMotivo pasos={recorrido} className="mt-1 md:hidden" />
        <HistorialDeCorrecciones correcciones={correcciones} />
        {/* En la ficha del teléfono el recorrido va a lo ancho; en el monitor, en «En qué va», junto al motivo. */}
        <div className="md:hidden">{historia}</div>
      </TD>
      <TD className="hidden text-texto-suave xl:table-cell">{para || '—'}</TD>
      <TD className="tabular hidden text-right whitespace-nowrap md:table-cell">{moneda(c.monto, divisa(c.moneda))}</TD>
      <TD className="hidden md:table-cell">
        <div className="flex flex-wrap gap-1">
          <Insignia tono={situacion.tono}>{situacion.etiqueta}</Insignia>
          <InsigniaDelPlazo plazo={plazo} />
          {reposicion}
        </div>
        <PlazoDeLaCompra plazo={plazo} corregida={corregida} className="mt-1" />
        <UltimoMotivo pasos={recorrido} className="mt-1" />
        {historia}
      </TD>
      <TD className="hidden xl:table-cell">
        {c.tiene_factura ? (
          <Insignia tono="exito">Adjunto</Insignia>
        ) : sinCurso ? (
          <span className="text-xs text-texto-suave">No se paga</span>
        ) : (
          <span className="text-xs text-texto-suave">{comprobantePendiente(c)}</span>
        )}
        {!sinCurso && <p className="text-xs text-texto-suave">{comprobante.etiqueta}</p>}
        {c.facturas.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-texto">
            {c.facturas.map((f) => (
              // El mismo número puede ir anexado dos veces a la OC: la clave es el anexo.
              <li key={f.id} className="tabular whitespace-nowrap">
                {f.numero}
                {f.fecha && <span className="text-texto-suave"> · {fecha(f.fecha)}</span>}
              </li>
            ))}
          </ul>
        )}
      </TD>
      <TD className="text-right">
        <AccionesDeFila>
          {compraConPdf(c.aprobacion) && (
            <a
              href={`/compras/${c.id}/pdf`}
              download
              className="inline-flex min-h-11 items-center gap-1 px-1 text-xs text-acento hover:underline sm:min-h-0 sm:px-0"
              aria-label={`Descargar el PDF de la ${c.nombre}`}
            >
              <FileDown aria-hidden className="size-4" />
              PDF
            </a>
          )}
          {emite && vigente && plazo && (
            <SeguimientoDeLaCompra
              documento={{ tipo: 'OC', id: c.id, nombre: c.nombre }}
              motivo={(plazo.dias_atraso ?? 0) > 0}
              fecha={plazo.completa_en || (plazo.llego_en && !plazo.por_llegar?.length) ? undefined : plazo.esperada}
            />
          )}
          {emite && c.aprobacion !== 'ANULADA' && (
            <AccionesCompra
              id={c.id}
              oc={ocParaDetector(c)}
              recojo={puedeIrARecojo(c)}
              adjuntar={c.aprobacion !== 'RECHAZADA'}
              conFactura={c.con_factura}
              codigoInterno={c.codigo_interno}
              codigosDeInsumos={c.codigo_por_insumo ? c.codigos : null}
              tieneComprobante={c.tiene_factura}
              entregada={Boolean(c.entregado_almacen_en)}
              total={c.con_factura ? Math.round((c.monto + igvCompra(c.monto)) * 100) / 100 : c.monto}
              moneda={c.moneda}
              verAdquisiciones={verAdquisiciones}
            />
          )}
        </AccionesDeFila>
      </TD>
    </TR>
  )
}

/**
 * Lo que falta del comprobante: la factura que Contabilidad ya registró en
 * Adquisiciones no está «pendiente», solo le falta el PDF en la OC (en
 * Adquisiciones la OC salía pagada y aquí «Factura pendiente», 27/10/2026).
 */
function comprobantePendiente(c: { con_factura: boolean | null; registradas: string[] }) {
  if (c.registradas.length > 1) return `Facturas ${c.registradas.join(', ')} registradas por Contabilidad · falta anexarlas a la OC`
  if (c.registradas.length === 1) return `Factura ${c.registradas[0]} registrada por Contabilidad · falta anexarla a la OC`
  return c.con_factura ? 'Factura pendiente' : 'Comprobante pendiente'
}
