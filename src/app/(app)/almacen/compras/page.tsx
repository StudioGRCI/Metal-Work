import Link from 'next/link'
import { ChevronLeft, ChevronRight, Download, FileWarning, ReceiptText, Truck } from 'lucide-react'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { DelDocumento } from '@/components/estructura/del-documento'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { BASE_BOTON, Boton, TAMANOS, VARIANTES, type Tamano, type Variante } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { DetalleEnTelefono, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { controlDeCompras, faltaAlgo, type FilaControlDeCompras, type MaterialDeLaCompra } from '@/lib/datos/control-de-compras'
import { nombreDeOc } from '@/lib/dominio/adquisiciones'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { cantidad, fecha, fechaHora, fechaLarga, hoyLima, moneda, sumarDias } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { AnotarRecibido } from './anotar-recibido'

export const metadata = { title: 'Control de compras' }

const VISTAS = [
  { valor: 'dia', titulo: 'Del día', descripcion: 'Las OC y OS que salieron ese día, como el CONTROL DE FACTURAS' },
  { valor: 'pendientes', titulo: 'Pendientes', descripcion: 'De cualquier día: falta el material o la factura' },
] as const
type Vista = (typeof VISTAS)[number]['valor']

const MATERIAL: Record<MaterialDeLaCompra, { texto: string; tono: 'exito' | 'aviso' | 'peligro' | 'neutro' }> = {
  // Es de Gerencia, no de Almacén: sin el ámbar de lo que le toca.
  POR_APROBAR: { texto: 'Por aprobar', tono: 'neutro' },
  EN_CAMINO: { texto: 'En camino', tono: 'neutro' },
  POR_VALIDAR: { texto: 'Por verificar', tono: 'aviso' },
  OBSERVADO: { texto: 'Observado', tono: 'peligro' },
  PARCIAL: { texto: 'Llegó una parte', tono: 'aviso' },
  LLEGO: { texto: 'Llegó', tono: 'exito' },
  NO_APLICA: { texto: 'Servicio', tono: 'neutro' },
}

const esDia = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const nombreDe = (f: FilaControlDeCompras) => (f.tipo === 'OC' ? nombreDeOc(f) : (f.numero ?? 'OS sin número'))

/**
 * El CONTROL DE FACTURAS de Almacén, ya sin Excel (pedido de Almacén, 25/11/2026):
 * cada OC y OS del día sale sola de Logística con lo que se compró, el
 * proveedor, el destino, el peso y el monto, y Almacén solo anota la factura y
 * la guía que le llegan. El comprobante que registró Contabilidad sale al lado.
 */
export default async function PaginaControlDeCompras({ searchParams }: PageProps<'/almacen/compras'>) {
  const perfil = await exigirPermiso(['almacen.ver', 'adquisiciones.ver', 'tesoreria.ver_documentos'])
  const anota = puede(perfil, 'almacen.recibir')
  const params = await searchParams
  const vista: Vista = params.vista === 'pendientes' ? 'pendientes' : 'dia'
  const hoy = hoyLima()
  const dia = esDia(params.fecha) && params.fecha <= hoy ? params.fecha : hoy
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 80) : ''
  const palabras = palabrasDeBusqueda(q)

  // Lo pendiente se lee siempre (cuenta la pestaña) y una sola vez; el día, a la par.
  const [pendientesTodas, delDiaLeidas] = await Promise.all([
    controlDeCompras(null, null).then((t) => t.filter(faltaAlgo)),
    vista === 'dia' ? controlDeCompras(dia, dia) : Promise.resolve(null),
  ])
  const filas = (delDiaLeidas ?? pendientesTodas).filter(
    (f) =>
      palabras.length === 0 ||
      coincide(palabras, [f.numero, f.referencia, f.descripcion, f.proveedor, f.destino, f.factura_numero, f.guia_numero, f.observacion]),
  )
  const sinFactura = filas.filter((f) => f.factura_numero === null).length
  // La que Gerencia no aprobó todavía no salió al proveedor: no está «por llegar».
  const enCamino = filas.filter((f) => !['LLEGO', 'NO_APLICA', 'POR_APROBAR'].includes(f.material)).length
  // Cuántas quedan pendientes de cualquier día, para la pestaña.
  const pendientes = pendientesTodas.length
  const conQ = (href: string) => (q ? `${href}${href.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}` : href)
  const delDia = (d: string) => conQ(d === hoy ? '/almacen/compras' : `/almacen/compras?fecha=${d}`)
  // El mes entero del día que se mira; si es el mes en curso, hasta hoy.
  const mes = dia.slice(0, 7)
  const finDeMes = sumarDias(`${sumarDias(`${mes}-28`, 4).slice(0, 7)}-01`, -1)
  const hastaDelMes = finDeMes < hoy ? finDeMes : hoy

  const vacio = q
    ? { titulo: 'Ninguna compra coincide', descripcion: `Nada coincide con «${q}». Prueba con el número, el proveedor o el destino, o borra la búsqueda.` }
    : vista === 'dia'
      ? {
          titulo: dia === hoy ? 'Hoy todavía no sale ninguna compra' : `El ${fecha(dia)} no salió ninguna compra`,
          descripcion: 'Cada OC y OS que Logística emite en el sistema aparece aquí sola, el día que sale. Mira otro día con las flechas.',
        }
      : { titulo: 'Nada pendiente', descripcion: 'Todo lo comprado llegó y Almacén ya recibió su factura.' }

  return (
    <>
      <EncabezadoPagina
        titulo="Control de compras"
        descripcion={vista === 'dia' ? fechaLarga(dia) : 'Lo que falta recibir, de cualquier día'}
        ayuda="Sale solo de cada OC y OS que emite Logística: lo que se compró, el proveedor, a qué código interno va (o «STOCK»), el peso (si Logística programó su recojo) y el monto con IGV. «Material» dice si llegó y Almacén lo verificó. En «Almacén recibió» se anota la factura y la guía que trae el proveedor; en «Comprobante en el sistema», el de la OC que registró Contabilidad o el que se adjuntó a la OS. Las OC rechazadas o anuladas no salen."
        migas={[{ titulo: 'Almacén' }, { titulo: 'Control de compras' }]}
        acciones={
          <a
            href={vista === 'dia' ? `/almacen/compras/excel?desde=${mes}-01&hasta=${hastaDelMes}` : '/almacen/compras/excel?pendientes=1'}
            download
            className={cn(BASE_BOTON, VARIANTES.secundario, TAMANOS.md)}
          >
            <Download aria-hidden className="size-4" />
            {vista === 'dia' ? 'Descargar el mes' : 'Descargar pendientes'}
          </a>
        }
      />

      <div className="space-y-5">
        <div className="hidden gap-3 sm:grid sm:grid-cols-3" data-resumen-control>
          <Indicador titulo={vista === 'dia' ? 'Compras del día' : 'Pendientes'} valor={filas.length} icono={ReceiptText}
            pie={filas.length === 1 ? 'orden de compra o de servicio' : 'órdenes de compra o de servicio'} />
          <Indicador titulo="Sin factura recibida" valor={sinFactura} icono={FileWarning} tono={sinFactura > 0 ? 'aviso' : 'neutro'}
            pie="Almacén todavía no anotó su comprobante" />
          <Indicador titulo="Material por llegar" valor={enCamino} icono={Truck} tono={enCamino > 0 ? 'acento' : 'neutro'}
            pie="en camino, por verificar, una parte u observado" />
        </div>

        <div className="space-y-3">
          <Vistas
            etiqueta="Vista"
            vistas={VISTAS.map((v) => ({
              clave: v.valor,
              titulo: v.titulo,
              href: conQ(v.valor === 'dia' ? (dia === hoy ? '/almacen/compras' : `/almacen/compras?fecha=${dia}`) : '/almacen/compras?vista=pendientes'),
              activa: vista === v.valor,
              descripcion: v.descripcion,
              cuenta: v.valor === 'pendientes' ? pendientes : undefined,
            }))}
          />
          <div className="flex flex-wrap items-end gap-3">
            {vista === 'dia' && (
              <div className="flex flex-wrap items-center gap-2" data-dia-control>
                <Link href={delDia(sumarDias(dia, -1))} aria-label="Día anterior" className={cn(BASE_BOTON, VARIANTES.contorno, TAMANOS.icono)}>
                  <ChevronLeft aria-hidden className="size-4" />
                </Link>
                {/* Sin JavaScript también: el día lo elige la búsqueda. */}
                <form action="/almacen/compras" className="flex items-center gap-2">
                  {q && <input type="hidden" name="q" value={q} />}
                  <label htmlFor="dia-control" className="sr-only">Día</label>
                  <Entrada key={dia} id="dia-control" name="fecha" type="date" max={hoy} defaultValue={dia} className="w-auto" />
                  <Boton type="submit" variante="contorno">Ver</Boton>
                </form>
                {/* «Día siguiente» y «Hoy» guardan su sitio desde 400 px, como en la
                    caja diaria: al aparecer corrían el buscador. Más angosto el
                    selector va solo en su renglón y no se guarda nada. */}
                {dia < hoy ? (
                  <Link href={delDia(sumarDias(dia, 1))} aria-label="Día siguiente" className={cn(BASE_BOTON, VARIANTES.contorno, TAMANOS.icono)}>
                    <ChevronRight aria-hidden className="size-4" />
                  </Link>
                ) : (
                  <Reservado variante="contorno" tamano="icono" className="max-[25rem]:hidden" />
                )}
                {dia < hoy ? (
                  <Link href={conQ('/almacen/compras')} className={cn(BASE_BOTON, VARIANTES.fantasma, TAMANOS.md)}>
                    Hoy
                  </Link>
                ) : (
                  <Reservado variante="fantasma" tamano="md" className="max-[25rem]:hidden">
                    Hoy
                  </Reservado>
                )}
              </div>
            )}
            <div className="w-full max-w-md">
              <BuscadorSimple ruta="/almacen/compras" etiqueta="Buscar compra" marcador="Número, proveedor, destino o factura" />
            </div>
          </div>
        </div>

        <DelDocumento documento={`control:${vista}:${dia}`}>
          <Tarjeta className="overflow-hidden">
            <Tabla apilada>
              <TablaCabecera>
                <tr>
                  <TH>Compra</TH>
                  <TH className="hidden xl:table-cell">Destino</TH>
                  <TH className="hidden md:table-cell text-right">Monto</TH>
                  <TH className="hidden md:table-cell">Material</TH>
                  <TH>Almacén recibió</TH>
                  <TH className="hidden md:table-cell">En el sistema</TH>
                </tr>
              </TablaCabecera>
              <tbody>
                {filas.length === 0 ? (
                  <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
                ) : (
                  filas.map((f) => <Fila key={`${f.tipo}:${f.id}`} f={f} anota={anota} conFecha={vista !== 'dia'} />)
                )}
              </tbody>
            </Tabla>
          </Tarjeta>
        </DelDocumento>
      </div>
    </>
  )
}

/** El sitio de un mando del selector que ese día no va: se guarda sin verse ni recibir el cursor. */
function Reservado({ variante, tamano, className, children }: { variante: Variante; tamano: Tamano; className?: string; children?: string }) {
  return (
    <span aria-hidden className={cn(BASE_BOTON, VARIANTES[variante], TAMANOS[tamano], 'invisible', className)}>
      {children}
    </span>
  )
}

function Material({ f }: { f: FilaControlDeCompras }) {
  const m = MATERIAL[f.material]
  return (
    <span className="space-y-1">
      <Insignia tono={m.tono}>{m.texto}</Insignia>
      {f.material === 'LLEGO' && f.material_en && <span className="block text-xs whitespace-nowrap text-texto-suave">{fechaHora(f.material_en)}</span>}
    </span>
  )
}

function Fila({ f, anota, conFecha }: { f: FilaControlDeCompras; anota: boolean; conFecha: boolean }) {
  const nombre = nombreDe(f)
  const monto = f.total === null ? '—' : moneda(f.total, f.moneda)
  return (
    <TR data-compra={nombre}>
      <TD>
        <p className="font-medium text-texto">
          <span className="font-mono">{nombre}</span>
          {conFecha && <span className="font-normal text-texto-suave"> · {fecha(f.fecha)}</span>}
        </p>
        <p className="break-words text-texto">{f.descripcion ?? <span className="text-texto-tenue">Sin detalle</span>}</p>
        <p className="text-xs text-texto-suave">
          {f.proveedor ?? 'Sin proveedor'}
          {f.peso_kg !== null && <span className="whitespace-nowrap"> · {cantidad(f.peso_kg)} kg</span>}
        </p>
        <DetalleEnTelefono className="md:hidden">
          <p className="text-xs text-texto-suave">
            Va a <span className="font-medium text-texto">{f.destino ?? 'STOCK'}</span> · <span className="tabular">{monto}</span>
          </p>
          <Material f={f} />
        </DetalleEnTelefono>
        <p className="hidden text-xs text-texto-suave md:block xl:hidden">Va a {f.destino ?? 'STOCK'}</p>
      </TD>
      <TD className="hidden xl:table-cell">{f.destino ?? 'STOCK'}</TD>
      <TD className="hidden md:table-cell text-right tabular whitespace-nowrap">{monto}</TD>
      <TD className="hidden md:table-cell">
        <Material f={f} />
      </TD>
      <TD data-rotulo="Almacén recibió">
        <div className="space-y-1">
          {f.factura_numero || f.guia_numero ? (
            <p className="text-sm text-texto">
              {f.factura_numero ? <span className="font-mono">{f.factura_numero}</span> : <span className="text-aviso">Falta la factura</span>}
              {f.guia_numero && <span className="block text-xs text-texto-suave">Guía {f.guia_numero}</span>}
            </p>
          ) : (
            <p className="text-sm text-texto-tenue">Nada todavía</p>
          )}
          {f.recibio && f.factura_recibida_en && (
            <p className="text-xs text-texto-suave">
              {f.recibio}, <span className="whitespace-nowrap">{fechaHora(f.factura_recibida_en)}</span>
            </p>
          )}
          {f.observacion && <p className="text-xs break-words text-texto-suave">{f.observacion}</p>}
          {f.comprobante_registrado && (
            <p className="text-xs text-texto-suave md:hidden">Comprobante en el sistema: {f.comprobante_registrado}</p>
          )}
          {anota && (
            <AnotarRecibido
              tipo={f.tipo}
              ordenId={f.id}
              nombre={nombre}
              compra={f.descripcion}
              proveedor={f.proveedor}
              monto={f.total === null ? null : monto}
              factura={f.factura_numero}
              guia={f.guia_numero}
              observacion={f.observacion}
              mostrado={f.recepcion_actualizada_en}
            />
          )}
        </div>
      </TD>
      <TD className="hidden md:table-cell">
        {f.comprobante_registrado ? (
          <span className="font-mono text-sm">{f.comprobante_registrado}</span>
        ) : (
          <span className="text-sm text-texto-tenue">Sin registrar</span>
        )}
      </TD>
    </TR>
  )
}
