import { ArrowUpFromLine, ShoppingCart } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { catalogoDeAlmacen, type MaterialParaConteo } from '@/lib/datos/atencion-materiales'
import { correccionesDe, type CorreccionVista } from '@/lib/datos/correcciones'
import { insumosPorSacarDelKardex, type InsumoPorSacar } from '@/lib/datos/kardex'
import { proveedoresParaCompra, type ProveedorParaCompra } from '@/lib/datos/proveedores'
import { cargarRequerimientos, catalogoParaRequerimiento, type MaterialParaRequerimiento, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { stockEnAlmacen, type MaterialEnStock } from '@/lib/datos/stock-almacen'
import { estadoDelRequerimiento, leTocaAtender, quienAtiende, tipoDeRequerimiento, type CompraDe } from '@/lib/dominio/requerimientos'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AvanceDelRequerimiento, CompraDelInsumo, MaterialDelInsumo } from '../avance'
import { ConAvisos } from './avisos'
import { EntregarConFaltante, PasoRequerimiento, RevisarStock, type StockDelSistema } from './controles'
import { PorComprar, type GrupoPorComprar } from './por-comprar'

export const metadata = { title: 'Atención de requerimiento' }

const VISTAS = [
  { valor: 'abiertos', titulo: 'Por atender' },
  { valor: 'comprar', titulo: 'Por comprar' },
  { valor: 'todos', titulo: 'Historial' },
] as const

const TITULO_POR_COMPRAR: Record<string, { titulo: string; descripcion: string }> = {
  OPERACION: {
    titulo: 'Por comprar · requerimientos de operación',
    descripcion:
      'Lo que Almacén no tiene de cada RQ. Marca lo de uno o varios RQ que le compras al mismo proveedor y genera una sola orden: cada insumo sigue con su RQ y su código interno.',
  },
  ADMINISTRACION: {
    titulo: 'Por comprar · requerimientos de Administración',
    descripcion:
      'Lo que Almacén no tiene de cada RQA. Marca lo de uno o varios que le compras al mismo proveedor y genera una sola orden: cada insumo sigue con su RQA y su código interno.',
  },
}

/**
 * La bandeja que comparten Almacén, Logística y la administradora. Cada RQ
 * muestra el botón del paso que le toca a quien mira: Almacén revisa el stock
 * insumo por insumo y entrega; quien compra hace la OC de lo que falta.
 * Supervisión entra solo a ver qué está listo.
 */
export default async function PaginaAtencion({ searchParams }: PageProps<'/requerimientos/atencion'>) {
  const perfil = await exigirPermiso([
    'almacen.recibir',
    'almacen.despachar',
    'compras.crear',
    'requerimientos.administracion',
    'requerimientos.ver',
  ])
  const { recibe, despacha, compraDe } = quienAtiende(perfil)
  const compra = compraDe.OPERACION || compraDe.ADMINISTRACION
  const params = await searchParams
  const vista = params.vista === 'todos' ? 'todos' : params.vista === 'comprar' && compra ? 'comprar' : 'abiertos'
  const preseleccion = typeof params.rq === 'string' ? params.rq : null
  // Logística genera la OC desde aquí: necesita el padrón y el catálogo de Almacén.
  const [requerimientos, proveedores, materiales] = await Promise.all([
    cargarRequerimientos({ soloAbiertos: vista !== 'todos' }),
    compra ? proveedoresParaCompra() : Promise.resolve([]),
    compra ? catalogoDeAlmacen() : Promise.resolve([]),
  ])
  const paraComprar = compra ? { proveedores, materiales, puedeRegistrarProveedor: puede(perfil, 'proveedores.editar') } : null
  // Almacén asocia o da de alta el material nuevo al revisar el stock: el catálogo
  // solo se carga si hay alguno por revisar.
  const hayNuevos = recibe && requerimientos.some((r) => r.estado === 'POR_ATENDER' && r.lineas.some((l) => l.material_nuevo && !l.material_id))
  // Al revisar el stock, Almacén ve al lado de cada insumo lo que dice el
  // sistema: cuánto está libre y cuánto ya es de otros códigos internos (DKS,
  // 2026-10-20). Solo de los materiales de los RQ que esperan esa revisión; si
  // hay un material nuevo por asociar, de todos, para ver el del que elija.
  const porRevisar = recibe
    ? [...new Set(requerimientos.flatMap((r) => (r.estado === 'POR_ATENDER' ? r.lineas.flatMap((l) => (l.material_id ? [l.material_id] : [])) : [])))]
    : []
  // «Entregado» pide antes la salida del kardex de cada insumo: a quien despacha
  // se le dice cuántos faltan en cada RQ listo.
  const listos = despacha ? requerimientos.filter((r) => r.estado === 'LISTO_EN_ALMACEN').map((r) => r.id) : []
  const [catalogo, correcciones, stock, porSacar] = await Promise.all([
    hayNuevos ? catalogoParaRequerimiento() : Promise.resolve<MaterialParaRequerimiento[]>([]),
    correccionesDe('REQUERIMIENTO', requerimientos.map((r) => r.id)),
    stockDelSistema(hayNuevos ? null : porRevisar),
    insumosPorSacarDelKardex(listos),
  ])
  const stockDelCatalogo = stock === 'no_se_pudo' ? null : hayNuevos ? Object.fromEntries([...stock].map(([id, m]) => [id, sistemaDe(m)])) : {}

  const meToca = requerimientos.filter((r) => leTocaAtender(r, { recibe, despacha, compraDe })).length
  const grupos = compra ? insumosPorComprar(requerimientos, compraDe) : []
  const porComprar = grupos.reduce((suma, g) => suma + g.insumos.length, 0)
  const cuenta = { abiertos: requerimientos.length, comprar: porComprar, todos: requerimientos.length }

  return (
    <>
      <EncabezadoPagina
        titulo="Atención de requerimiento"
        ayuda="Cada requerimiento pasa primero por Almacén, insumo por insumo: lo que tiene lo separa y solo lo que falta se compra. Lo de operación lo compra Logística; lo de Administración, la administradora. Cuando llega, Almacén lo recepciona y lo entrega."
        migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Atención' }]}
      />

      <Vistas
        etiqueta="Vista"
        className="mb-3"
        vistas={VISTAS.filter((v) => v.valor !== 'comprar' || compra).map((v) => ({
          clave: v.valor,
          titulo: v.titulo,
          href: v.valor === 'abiertos' ? '/requerimientos/atencion' : `/requerimientos/atencion?vista=${v.valor}`,
          activa: vista === v.valor,
          cuenta: vista === v.valor || v.valor === 'comprar' ? cuenta[v.valor] : undefined,
        }))}
      >
        {vista === 'abiertos' && requerimientos.length > 0 && (recibe || despacha || compra) && (
          <p className="text-sm text-texto-suave sm:ml-auto">
            {meToca === 0 ? 'Ninguno espera por ti.' : `${meToca} ${meToca === 1 ? 'espera' : 'esperan'} por ti.`}
          </p>
        )}
      </Vistas>

      {vista === 'comprar' && paraComprar ? (
        <PorComprar grupos={grupos} preseleccion={preseleccion} {...paraComprar} />
      ) : (
        <ConAvisos>
          <Tarjeta className="overflow-hidden">
            {/* En el teléfono cada RQ va apilado, una celda debajo de otra: la
                tabla medía 681 px en una tarjeta de 356 y las acciones (revisar,
                la salida del kardex, «Entregado») quedaban fuera de la pantalla
                sin que nada lo dijera. */}
            <Tabla>
              <TablaCabecera className="hidden sm:table-header-group">
                <tr>
                  <TH>Requerimiento</TH>
                  <TH>Insumos</TH>
                  <TH>En qué va</TH>
                  <TH className="text-right">
                    <span className="sr-only">Acciones</span>
                  </TH>
                </tr>
              </TablaCabecera>
              <tbody>
                {requerimientos.length === 0 ? (
                  <SinDatos
                    titulo={vista === 'abiertos' ? 'Nada por atender' : 'Todavía no hay requerimientos'}
                    descripcion="Cuando se registre un requerimiento, aparece aquí y te llega un aviso."
                  />
                ) : (
                  requerimientos.map((r) => (
                    <Fila
                      key={r.id}
                      rq={r}
                      recibe={recibe}
                      despacha={despacha}
                      compra={compraDe[tipoDeRequerimiento(r)]}
                      paraComprar={paraComprar}
                      catalogo={catalogo}
                      stock={stock}
                      stockDelCatalogo={stockDelCatalogo}
                      porSacar={porSacar === null ? null : porSacar[r.id] ?? []}
                      correcciones={correcciones.get(r.id)}
                    />
                  ))
                )}
              </tbody>
            </Tabla>
          </Tarjeta>
        </ConAvisos>
      )}
    </>
  )
}

/**
 * El stock que dice el sistema de los materiales por revisar (`null`: de todos).
 * Si no se pudo leer, la revisión sigue —Almacén cuenta lo que tiene— y la
 * ventana lo dice; la causa queda en el registro del servidor.
 */
async function stockDelSistema(materiales: string[] | null): Promise<Map<string, MaterialEnStock> | 'no_se_pudo'> {
  if (materiales?.length === 0) return new Map()
  try {
    return new Map((await stockEnAlmacen(materiales ?? undefined)).map((m) => [m.material_id, m]))
  } catch (error) {
    console.error('Revisar stock: no se pudo leer el stock de Almacén.', error)
    return 'no_se_pudo'
  }
}

function sistemaDe(m: MaterialEnStock): StockDelSistema {
  return {
    existencia: m.existencia,
    libre: m.libre,
    reservado_ot: m.reservado_ot,
    unidad: m.unidad,
    codigos: m.por_codigo,
  }
}

/** Lo que dice el sistema de un insumo: nada si es un material nuevo, cero si su material no tiene kardex. */
function sistemaDelInsumo(
  l: RequerimientoListado['lineas'][number],
  stock: Map<string, MaterialEnStock> | 'no_se_pudo',
): StockDelSistema | 'no_se_pudo' | null {
  if (!l.material_id) return null
  if (stock === 'no_se_pudo') return 'no_se_pudo'
  const m = stock.get(l.material_id)
  return m ? sistemaDe(m) : { existencia: 0, libre: 0, reservado_ot: 0, unidad: l.unidad, codigos: [] }
}

/** Lo que falta comprar de un insumo: todo si Almacén no lo revisó, o lo que no tenía. */
function faltaComprar(l: RequerimientoListado['lineas'][number]) {
  return l.en_stock === null || l.en_stock < l.cantidad
}

/**
 * Los insumos que esperan su compra, por tipo de RQ: los de los RQ que Almacén
 * ya revisó, que no tenía completos y que no van en una OC viva. Solo los del
 * tipo que compra quien mira.
 */
function insumosPorComprar(requerimientos: RequerimientoListado[], compraDe: CompraDe): GrupoPorComprar[] {
  return (['OPERACION', 'ADMINISTRACION'] as const)
    .filter((tipo) => compraDe[tipo])
    .map((tipo) => ({
      tipo,
      ...TITULO_POR_COMPRAR[tipo],
      insumos: requerimientos
        .filter((r) => tipoDeRequerimiento(r) === tipo && (r.estado === 'SIN_STOCK' || r.estado === 'EN_ATENCION'))
        .flatMap((r) =>
          r.lineas
            .filter((l) => l.en_stock !== null && l.en_stock < l.cantidad && (!l.orden_compra || l.compra_rechazada))
            .map((l) => ({
              id: l.id,
              requerimiento_id: r.id,
              requerimiento: r.numero,
              area: r.area,
              codigo_interno: r.codigo_interno,
              descripcion: l.descripcion,
              falta: Math.round((l.cantidad - (l.en_stock ?? 0)) * 1000) / 1000,
              unidad: l.unidad,
              material_id: l.material_id,
              material: l.material_nombre ?? l.descripcion,
              codigo_material: l.material_codigo,
              fecha_requerida: r.fecha_requerida,
            })),
        ),
    }))
}

type ParaComprar = { proveedores: ProveedorParaCompra[]; materiales: MaterialParaConteo[]; puedeRegistrarProveedor: boolean }

function Fila({
  rq,
  recibe,
  despacha,
  compra,
  paraComprar,
  catalogo,
  stock,
  stockDelCatalogo,
  porSacar,
  correcciones,
}: {
  rq: RequerimientoListado
  recibe: boolean
  despacha: boolean
  compra: boolean
  paraComprar: ParaComprar | null
  /** El catálogo de Almacén para asociar los materiales nuevos al revisar el stock. */
  catalogo: MaterialParaRequerimiento[]
  /** Lo que dice el sistema de los materiales por revisar. */
  stock: Map<string, MaterialEnStock> | 'no_se_pudo'
  /** El de cada material del catálogo con kardex, para el material nuevo que Almacén asocie; vacío si no se pudo leer. */
  stockDelCatalogo: Record<string, StockDelSistema> | null
  /** Insumos de este RQ que falta sacar del kardex; `null` si no se pudo leer. */
  porSacar: InsumoPorSacar[] | null
  correcciones: CorreccionVista[] | undefined
}) {
  const estado = estadoDelRequerimiento(rq)
  const administracion = rq.tipo === 'ADMINISTRACION'
  const quienCompra = administracion ? 'la administradora' : 'Logística'
  // Quien compra genera la OC mientras el RQ está por comprar o en compra y
  // queda algún insumo que Almacén no tenía completo y sin su OC viva.
  const generaOc = compra && paraComprar && (rq.estado === 'SIN_STOCK' || rq.estado === 'EN_ATENCION')
    && rq.lineas.some((l) => faltaComprar(l) && (!l.orden_compra || l.compra_rechazada))
  const pasos = [
    [`Registrado ${fechaHora(rq.creado_en)}`, rq.fecha_requerida ? `se necesita el ${fecha(rq.fecha_requerida)}` : null].filter(Boolean).join(' · '),
    rq.revision_stock_en && rq.estado !== 'LISTO_EN_ALMACEN' && rq.estado !== 'ENTREGADO' ? `Almacén revisó ${fechaHora(rq.revision_stock_en)}` : null,
    rq.nota_almacen ? `Almacén: ${rq.nota_almacen}` : null,
    rq.en_atencion_en ? `${administracion ? 'La administradora' : 'Logística'} compra desde ${fechaHora(rq.en_atencion_en)}` : null,
    rq.nota_logistica ? `${administracion ? 'Administración' : 'Logística'}: ${rq.nota_logistica}` : null,
    rq.listo_en_almacen_en ? `Listo en almacén ${fechaHora(rq.listo_en_almacen_en)}` : null,
    rq.entregado_en ? `Entregado ${fechaHora(rq.entregado_en)}${rq.nota_entrega ? ` · ${rq.nota_entrega}` : ''}` : null,
    // Lo que no salió del kardex y su motivo se leen como en Requerimientos: la
    // etiqueta resaltada, lo que no salió en tono de aviso.
    rq.faltante_al_entregar ? { etiqueta: 'No salió del kardex:', texto: rq.faltante_al_entregar, clase: 'text-aviso', faltante: true } : null,
    rq.motivo_del_faltante ? { etiqueta: 'Motivo:', texto: rq.motivo_del_faltante, clase: 'text-texto', faltante: false } : null,
    rq.motivo_anulacion ? `Anulado: ${rq.motivo_anulacion}` : null,
  ].filter((p): p is string | { etiqueta: string; texto: string; clase: string; faltante: boolean } => Boolean(p))

  return (
    // El ancla de la fila: la salida del kardex vuelve aquí para marcarlo entregado.
    <TR id={`rq-${rq.id}`} className="block scroll-mt-20 sm:table-row">
      <TD className="block pt-3 pb-1 align-top sm:table-cell sm:py-2">
        <p className="tabular font-semibold text-texto">
          {rq.numero}
          {administracion && (
            <Insignia tono="acento" className="ml-2 align-middle">
              Administración
            </Insignia>
          )}
        </p>
        <p className="text-xs text-texto">
          {rq.area} · <span className="tabular">{rq.codigo_interno}</span>
        </p>
        <p className="mt-1 max-w-sm text-xs text-texto-suave">{rq.justificacion}</p>
        <HistorialDeCorrecciones correcciones={correcciones} />
      </TD>
      <TD className="block py-1 align-top sm:table-cell sm:py-2">
        <ul className="space-y-1 text-xs">
          {rq.lineas.map((l) => (
            <li key={l.item}>
              <span className="tabular font-medium text-texto">
                {cantidad(l.cantidad)} {l.unidad}
              </span>{' '}
              <span className="text-texto">{l.descripcion}</span>
              <span className="block text-[11px] text-texto-suave">
                <MaterialDelInsumo linea={l} />
                {l.categoria}
                <CompraDelInsumo linea={l} estadoRq={rq.estado} />
                {l.sin_salida !== null && (
                  <>
                    {' · '}
                    <span className="font-medium text-aviso">
                      No salió del kardex: {cantidad(l.sin_salida)} {l.unidad}
                    </span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </TD>
      <TD className="block pt-1 pb-3 align-top sm:table-cell sm:py-2">
        {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : rq.estado}
        <AvanceDelRequerimiento rq={rq} />
        <ul className="mt-1 space-y-0.5 text-[11px] text-texto-suave">
          {pasos.map((p) =>
            typeof p === 'string' ? (
              <li key={p}>{p}</li>
            ) : (
              <li key={p.etiqueta} className={p.faltante ? 'text-texto' : undefined} data-faltante={p.faltante || undefined}>
                <span className={`font-medium ${p.clase}`}>{p.etiqueta}</span> {p.texto}
              </li>
            ),
          )}
        </ul>
      </TD>
      {/* Sin acciones, la celda no deja un hueco en el teléfono. */}
      <TD className="block p-0 align-top sm:table-cell sm:px-3 sm:py-2 sm:text-right">
        <div className="flex flex-col items-start gap-2 px-3 pb-3 empty:hidden sm:items-end sm:p-0">
          {recibe && rq.estado === 'POR_ATENDER' && (
            <RevisarStock
              id={rq.id}
              numero={rq.numero}
              codigo={rq.codigo_interno}
              compra={quienCompra}
              insumos={rq.lineas.map((l) => ({
                item: l.item,
                descripcion: l.descripcion,
                cantidad: l.cantidad,
                unidad: l.unidad,
                nuevo: l.material_nuevo && !l.material_id,
                codigo: l.material_codigo,
                unidad_pendiente: l.material_unidad_pendiente,
                sistema: sistemaDelInsumo(l, stock),
              }))}
              materiales={rq.lineas.some((l) => l.material_nuevo && !l.material_id) ? catalogo : []}
              stockDelCatalogo={rq.lineas.some((l) => l.material_nuevo && !l.material_id) ? stockDelCatalogo : {}}
            />
          )}
          {generaOc && (
            <EnlaceBoton href={`/requerimientos/atencion?vista=comprar&rq=${rq.id}`} tamano="sm">
              <ShoppingCart aria-hidden className="size-4" />
              Generar OC
            </EnlaceBoton>
          )}
          {compra && rq.estado === 'SIN_STOCK' && <PasoRequerimiento id={rq.id} numero={rq.numero} paso="en_atencion" />}
          {recibe && (rq.estado === 'SIN_STOCK' || rq.estado === 'EN_ATENCION') && (
            <PasoRequerimiento id={rq.id} numero={rq.numero} paso="listo" />
          )}
          {despacha && rq.estado === 'LISTO_EN_ALMACEN' && (porSacar?.length === 0 ? (
            <PasoRequerimiento id={rq.id} numero={rq.numero} paso="entregado" />
          ) : (
            <>
              {/* Si no se pudo leer lo que falta, «Entregado» va al lado y el
                  primario es él: dos primarios juntos no dicen cuál va primero. */}
              <EnlaceBoton href={`/almacen/kardex?rq=${rq.id}`} tamano="sm" variante={porSacar === null ? 'secundario' : 'primario'}>
                <ArrowUpFromLine aria-hidden className="size-4" />
                Registrar la salida en el kardex
              </EnlaceBoton>
              {porSacar === null ? (
                <PasoRequerimiento id={rq.id} numero={rq.numero} paso="entregado" />
              ) : (
                <p className="text-xs text-texto-suave" data-por-sacar={porSacar.length}>
                  {porSacar.length === 1 ? 'Falta la salida de 1 insumo' : `Falta la salida de ${porSacar.length} insumos`}; después se
                  marca entregado. Si ya no va a salir, se entrega con faltante.
                </p>
              )}
              {/* Para lo que ya no va a salir: sin esto el RQ quedaba listo para
                  siempre. También cuando no se pudo leer lo que falta, porque la
                  base igual rechaza «Entregado» y pide entregarlo con faltante. */}
              <EntregarConFaltante id={rq.id} numero={rq.numero} faltan={porSacar} />
            </>
          ))}
        </div>
      </TD>
    </TR>
  )
}
