import { ArrowUpFromLine, ShoppingCart } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Recorrido } from '@/components/ui/recorrido'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { catalogoDeAlmacen, type MaterialParaConteo } from '@/lib/datos/atencion-materiales'
import { correccionesDe, type CorreccionVista } from '@/lib/datos/correcciones'
import { insumosPorSacarDelKardex, type InsumoPorSacar } from '@/lib/datos/kardex'
import { metradoDeRequerimientos, type MetradoDelInsumo } from '@/lib/datos/metrado-rq'
import { proveedoresParaCompra, type ProveedorParaCompra } from '@/lib/datos/proveedores'
import { recorridoDeRequerimientos } from '@/lib/datos/recorrido'
import { cargarRequerimientos, catalogoParaRequerimiento, type MaterialParaRequerimiento, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { stockEnAlmacen, type MaterialEnStock } from '@/lib/datos/stock-almacen'
import { ESTADO_METRADO, FRENO_DEL_RQ, frenaElRq, frenoDelRq, listaDeItems, queFaltaDelFreno } from '@/lib/dominio/metrado-rq'
import { estadoDelRequerimiento, leTocaAtender, quienAtiende, tipoDeRequerimiento, type CompraDe } from '@/lib/dominio/requerimientos'
import { describirRecorridoDelRequerimiento, type PasoDelRecorrido, type PasoDescrito } from '@/lib/dominio/recorrido'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AvanceDelRequerimiento, CompraDelInsumo, EntregaDelInsumo, MaterialDelInsumo } from '../avance'
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
  const [{ requerimientos, sinEntregado }, proveedores, materiales] = await Promise.all([
    // Con lo entregado de cada insumo: Almacén ve qué falta entregar de cada RQ
    // (plan 2, entrega 2.1). Si eso no se pudo leer, la bandeja sigue sin las
    // cifras y lo dice, como el metrado y el recorrido.
    cargarRequerimientos({ soloAbiertos: vista !== 'todos', conEntregado: true }).then(
      (requerimientos) => ({ requerimientos, sinEntregado: false }),
      async (e: unknown) => {
        console.error('Atención: no se pudo leer lo entregado de cada insumo.', e)
        return { requerimientos: await cargarRequerimientos({ soloAbiertos: vista !== 'todos' }), sinEntregado: true }
      },
    ),
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
  const [catalogo, correcciones, stock, porSacar, metradoLeido, recorridos] = await Promise.all([
    hayNuevos ? catalogoParaRequerimiento() : Promise.resolve<MaterialParaRequerimiento[]>([]),
    correccionesDe('REQUERIMIENTO', requerimientos.map((r) => r.id)),
    stockDelSistema(hayNuevos ? null : porRevisar),
    insumosPorSacarDelKardex(listos),
    // Lo que se pasa del metrado de Diseño espera su visto: Almacén no lo revisa y
    // Logística no lo compra. Si no se pudo leer, la base igual lo frena al enviar.
    metradoDeRequerimientos(requerimientos.map((r) => r.id)).catch((e: unknown) => {
      console.error('Atención: no se pudo leer el metrado de Diseño.', e)
      return null
    }),
    // El recorrido de cada RQ: quién tiene cada abierto y desde cuándo, con los
    // días que cuenta la base (fecha de Lima), y los pasos que se pliegan en su
    // fila (plan 2, entrega 2.1). Sin eso la bandeja sigue: solo sin la insignia
    // de días ni el recorrido.
    recorridoDeRequerimientos(requerimientos.map((r) => r.id)).catch(
      (e: unknown) => {
        console.error('Atención: no se pudo leer el recorrido de los requerimientos (días en espera y pasos).', e)
        return null
      },
    ),
  ])
  const espera = new Map<string, PasoDelRecorrido>()
  for (const [id, pasos] of recorridos ?? []) {
    const ahora = pasos.find((p) => p.situacion === 'AHORA')
    if (ahora) espera.set(id, ahora)
  }
  const metrado = metradoLeido ?? new Map<string, MetradoDelInsumo>()
  const stockDelCatalogo = stock === 'no_se_pudo' ? null : hayNuevos ? Object.fromEntries([...stock].map(([id, m]) => [id, sistemaDe(m)])) : {}

  // El que espera el sustento o el visto de Diseño todavía no le toca a Almacén:
  // no cuenta como suyo y va después de los que sí puede revisar.
  const leToca = (r: RequerimientoListado) => leTocaAtender(r, { recibe, despacha, compraDe }) && !frenoDelRq(r, metrado)
  const meToca = requerimientos.filter(leToca).length
  // En qué grupo va cada RQ de «Por atender», para leer el orden (`data-grupo`).
  const grupoDe = new Map<string, string>()
  if (vista === 'abiertos') {
    const orden = (r: RequerimientoListado) => (leToca(r) ? 0 : frenoDelRq(r, metrado) ? 2 : 1)
    // Dentro de cada grupo, primero lo que hoy tiene el puesto de quien mira
    // (Almacén, Logística o la administradora, según su recorrido) y después lo
    // demás; en cada parte, el que más espera arriba (plan 0): desde que lo tiene
    // quien lo tiene. Sin el recorrido queda el orden de antes.
    const propios = new Set([
      ...(recibe || despacha ? ['Almacén'] : []),
      ...(compraDe.OPERACION ? ['Logística'] : []),
      ...(compraDe.ADMINISTRACION ? ['Administración'] : []),
    ])
    const ajeno = (r: RequerimientoListado) => {
      const quien = espera.get(r.id)?.puesto
      return quien && propios.has(quien) ? 0 : 1
    }
    const desde = (r: RequerimientoListado) => {
      const en = espera.get(r.id)?.en
      return en ? Date.parse(en) : Number.POSITIVE_INFINITY
    }
    requerimientos.sort((a, b) => orden(a) - orden(b) || ajeno(a) - ajeno(b) || desde(a) - desde(b))
    for (const r of requerimientos) grupoDe.set(r.id, `${orden(r)}${ajeno(r)}`)
  }
  const grupos = compra ? insumosPorComprar(requerimientos, compraDe, metrado, espera) : []
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

      {metradoLeido === null && requerimientos.length > 0 && (
        <p role="status" className="mb-3 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-metrado-sin-leer>
          No se pudo leer el metrado de Diseño. Si un requerimiento se pasa del metrado, el sistema no deja revisarlo ni comprarlo y
          dice por qué. Vuelve a cargar la pantalla en un momento.
        </p>
      )}

      {sinEntregado && requerimientos.length > 0 && (
        <p role="status" className="mb-3 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-entregado-sin-leer>
          No se pudo leer lo entregado de cada insumo: la lista sigue sin las cifras de lo entregado, lo separado y lo que falta. Vuelve a
          cargar la pantalla en un momento.
        </p>
      )}

      {recorridos === null && requerimientos.length > 0 && (
        <p role="status" className="mb-3 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-dias-sin-leer>
          No se pudo leer el recorrido de los requerimientos: la lista sigue sin los días que lleva esperando cada uno, sin ordenarse por
          antigüedad y sin su recorrido. Vuelve a cargar la pantalla en un momento.
        </p>
      )}

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
                      metrado={metrado}
                      espera={espera.get(r.id)}
                      recorrido={recorridos ? describirRecorridoDelRequerimiento(recorridos.get(r.id) ?? []) : undefined}
                      grupo={grupoDe.get(r.id)}
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
function insumosPorComprar(
  requerimientos: RequerimientoListado[],
  compraDe: CompraDe,
  metrado: Map<string, MetradoDelInsumo>,
  espera: Map<string, PasoDelRecorrido>,
): GrupoPorComprar[] {
  // El que más espera, arriba (plan 0): desde que lo tiene quien compra.
  const desde = (r: RequerimientoListado) => {
    const en = espera.get(r.id)?.en
    return en ? Date.parse(en) : Number.POSITIVE_INFINITY
  }
  return (['OPERACION', 'ADMINISTRACION'] as const)
    .filter((tipo) => compraDe[tipo])
    .map((tipo) => ({
      tipo,
      ...TITULO_POR_COMPRAR[tipo],
      insumos: requerimientos
        .filter((r) => tipoDeRequerimiento(r) === tipo && (r.estado === 'SIN_STOCK' || r.estado === 'EN_ATENCION'))
        .sort((a, b) => desde(a) - desde(b))
        .flatMap((r) =>
          r.lineas
            // Lo que se pasa del metrado sin el visto de Diseño no va en una OC (la base lo rechaza).
            .filter((l) => l.en_stock !== null && l.en_stock < l.cantidad && (!l.orden_compra || l.compra_rechazada) && !frenaElRq(metrado.get(l.id)?.estado))
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
              dias: espera.get(r.id)?.dias ?? null,
              desde: espera.get(r.id)?.en ?? null,
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
  metrado,
  espera,
  recorrido,
  grupo,
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
  metrado: Map<string, MetradoDelInsumo>
  /** Quién lo tiene ahora, desde cuándo y hace cuántos días (del recorrido); nada si no se pudo leer o ya no lo tiene nadie. */
  espera: PasoDelRecorrido | undefined
  /** Los pasos del RQ en palabras; nada si no se pudo leer (lo dice el aviso de arriba, una vez). */
  recorrido: PasoDescrito[] | undefined
  /** En «Por atender», su grupo en el orden: le toca / no / frenado, y si lo tiene el puesto de quien mira. */
  grupo?: string
}) {
  const estado = estadoDelRequerimiento(rq)
  // Los insumos que se pasan del metrado sin el visto de Diseño.
  const frenados = rq.lineas.filter((l) => frenaElRq(metrado.get(l.id)?.estado))
  // Por atender y frenado: la etapa y la insignia dicen quién lo tiene, no «Almacén revisa».
  const freno = frenoDelRq(rq, metrado)
  const enEspera = freno ? FRENO_DEL_RQ[freno.freno] : undefined
  const administracion = rq.tipo === 'ADMINISTRACION'
  const quienCompra = administracion ? 'la administradora' : 'Logística'
  // Quien compra genera la OC mientras el RQ está por comprar o en compra y
  // queda algún insumo que Almacén no tenía completo y sin su OC viva.
  const generaOc = compra && paraComprar && (rq.estado === 'SIN_STOCK' || rq.estado === 'EN_ATENCION')
    && rq.lineas.some((l) => faltaComprar(l) && (!l.orden_compra || l.compra_rechazada) && !frenados.includes(l))
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
    <TR id={`rq-${rq.id}`} className="block scroll-mt-20 sm:table-row" data-grupo={grupo}>
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
              <span className="block text-xs text-texto-suave">
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
              <EntregaDelInsumo linea={l} estadoRq={rq.estado} />
              {frenados.includes(l) && rq.estado !== 'ANULADO' && rq.estado !== 'ENTREGADO' && (
                <Insignia tono={ESTADO_METRADO[metrado.get(l.id)!.estado].tono} className="mt-0.5" data-metrado={metrado.get(l.id)!.estado}>
                  {ESTADO_METRADO[metrado.get(l.id)!.estado].etiqueta}
                </Insignia>
              )}
            </li>
          ))}
        </ul>
      </TD>
      <TD className="block pt-1 pb-3 align-top sm:table-cell sm:py-2">
        <span className="inline-flex flex-wrap items-center gap-1">
          {enEspera ? (
            <Insignia tono={enEspera.tono} data-freno={freno?.freno}>
              {enEspera.etiqueta}
            </Insignia>
          ) : estado ? (
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
          ) : (
            rq.estado
          )}
          {/* Aquí no todo lo tiene quien mira (la OC espera a Gerencia, el conductor salió): se ve de quién son los días. */}
          <DiasEnEspera dias={espera?.dias} desde={espera?.en} quien={espera?.puesto} verQuien />
        </span>
        <AvanceDelRequerimiento rq={rq} frenado={enEspera && { etiqueta: enEspera.etapa, tono: enEspera.tono }} />
        <ul className="mt-1 space-y-0.5 text-xs text-texto-suave">
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
        {/* Plegado; quién lo tiene y hace cuánto ya lo dice la insignia de arriba. */}
        <Recorrido pasos={recorrido} className="mt-2 max-w-sm rounded-[var(--radius-base)] border border-borde" relleno="px-2" sinQuienEnElResumen />
      </TD>
      {/* Sin acciones, la celda no deja un hueco en el teléfono. */}
      <TD className="block p-0 align-top sm:table-cell sm:px-3 sm:py-2 sm:text-right">
        <div className="flex flex-col items-start gap-2 px-3 pb-3 empty:hidden sm:items-end sm:p-0">
          {recibe && freno && (
            <p className="max-w-xs text-xs text-texto-suave sm:text-right" data-espera-metrado>
              <span className={`font-medium ${freno.freno === 'DISENO' ? 'text-aviso' : 'text-peligro'}`}>
                {freno.freno === 'DISENO' ? 'Espera el visto de Diseño.' : 'Espera el sustento de quien pidió.'}
              </span>{' '}
              {freno.items.length === 1 ? `El insumo ${freno.items[0]} se pasa` : `Los insumos ${listaDeItems(freno.items)} se pasan`} del
              metrado de Diseño. {queFaltaDelFreno(freno)}. Cuando Diseño {freno.items.length === 1 ? 'lo' : 'los'} autorice te llega el aviso; si
              en cambio amplía el metrado, queda para revisar aquí.
            </p>
          )}
          {recibe && rq.estado === 'POR_ATENDER' && !freno && (
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
