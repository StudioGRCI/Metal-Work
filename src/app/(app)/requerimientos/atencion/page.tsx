import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { GenerarCompraDelRequerimiento } from '@/app/(app)/compras/ordenes/formulario-directa'
import { catalogoDeAlmacen, type MaterialParaConteo } from '@/lib/datos/atencion-materiales'
import { proveedoresParaCompra, type ProveedorParaCompra } from '@/lib/datos/proveedores'
import { cargarRequerimientos, catalogoParaRequerimiento, type MaterialParaRequerimiento, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { ESTADO_REQUERIMIENTO, leTocaAtender, quienAtiende, tipoDeRequerimiento } from '@/lib/dominio/requerimientos'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AvanceDelRequerimiento, CompraDelInsumo, MaterialDelInsumo } from '../avance'
import { PasoRequerimiento, RevisarStock } from './controles'

export const metadata = { title: 'Atención de requerimiento' }

const VISTAS = [
  { valor: 'abiertos', titulo: 'Por atender' },
  { valor: 'todos', titulo: 'Historial' },
] as const

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
  const vista = params.vista === 'todos' ? 'todos' : 'abiertos'
  // Logística genera la OC desde aquí: necesita el padrón y el catálogo de Almacén.
  const [requerimientos, proveedores, materiales] = await Promise.all([
    cargarRequerimientos({ soloAbiertos: vista === 'abiertos' }),
    compra ? proveedoresParaCompra() : Promise.resolve([]),
    compra ? catalogoDeAlmacen() : Promise.resolve([]),
  ])
  const paraComprar = compra ? { proveedores, materiales, puedeRegistrarProveedor: puede(perfil, 'proveedores.editar') } : null
  // Almacén asocia o da de alta el material nuevo al revisar el stock: el catálogo
  // solo se carga si hay alguno por revisar.
  const hayNuevos = recibe && requerimientos.some((r) => r.estado === 'POR_ATENDER' && r.lineas.some((l) => l.material_nuevo && !l.material_id))
  const catalogo: MaterialParaRequerimiento[] = hayNuevos ? await catalogoParaRequerimiento() : []

  const meToca = requerimientos.filter((r) => leTocaAtender(r, { recibe, despacha, compraDe })).length

  return (
    <>
      <EncabezadoPagina
        titulo="Atención de requerimiento"
        descripcion="Cada requerimiento pasa primero por Almacén, insumo por insumo: lo que tiene lo separa y solo lo que falta se compra. Lo de operación lo compra Logística; lo de Administración, la administradora. Cuando llega, Almacén lo recepciona y lo entrega."
        migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Atención' }]}
      />

      <nav aria-label="Vista" className="mb-3 flex items-center gap-2">
        {VISTAS.map((v) => (
          <Link
            key={v.valor}
            href={v.valor === 'abiertos' ? '/requerimientos/atencion' : `/requerimientos/atencion?vista=${v.valor}`}
            aria-current={vista === v.valor ? 'page' : undefined}
            className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium ${
              vista === v.valor ? 'border-acento bg-acento-suave text-texto' : 'border-borde text-texto-suave hover:text-texto'
            }`}
          >
            {v.titulo}
            {vista === v.valor && <span className="ml-2 tabular text-xs text-texto-suave">{requerimientos.length}</span>}
          </Link>
        ))}
        {vista === 'abiertos' && requerimientos.length > 0 && (recibe || despacha || compra) && (
          <p className="ml-auto text-sm text-texto-suave">
            {meToca === 0 ? 'Ninguno espera por ti.' : `${meToca} ${meToca === 1 ? 'espera' : 'esperan'} por ti.`}
          </p>
        )}
      </nav>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
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
                />
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

/** Lo que falta comprar de un insumo: todo si Almacén no lo revisó, o lo que no tenía. */
function faltaComprar(l: RequerimientoListado['lineas'][number]) {
  return l.en_stock === null || l.en_stock < l.cantidad
}

type ParaComprar = { proveedores: ProveedorParaCompra[]; materiales: MaterialParaConteo[]; puedeRegistrarProveedor: boolean }

function Fila({
  rq,
  recibe,
  despacha,
  compra,
  paraComprar,
  catalogo,
}: {
  rq: RequerimientoListado
  recibe: boolean
  despacha: boolean
  compra: boolean
  paraComprar: ParaComprar | null
  /** El catálogo de Almacén para asociar los materiales nuevos al revisar el stock. */
  catalogo: MaterialParaRequerimiento[]
}) {
  const estado = ESTADO_REQUERIMIENTO[rq.estado]
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
    rq.entregado_en ? `Entregado ${fechaHora(rq.entregado_en)}${rq.nota_entrega ? ` a ${rq.nota_entrega}` : ''}` : null,
    rq.motivo_anulacion ? `Anulado: ${rq.motivo_anulacion}` : null,
  ].filter((p): p is string => Boolean(p))

  return (
    <TR>
      <TD className="align-top">
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
      </TD>
      <TD className="align-top">
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
              </span>
            </li>
          ))}
        </ul>
      </TD>
      <TD className="align-top">
        {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : rq.estado}
        <AvanceDelRequerimiento rq={rq} />
        <ul className="mt-1 space-y-0.5 text-[11px] text-texto-suave">
          {pasos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </TD>
      <TD className="text-right align-top">
        <div className="flex flex-col items-end gap-1.5">
          {recibe && rq.estado === 'POR_ATENDER' && (
            <RevisarStock
              id={rq.id}
              numero={rq.numero}
              compra={quienCompra}
              insumos={rq.lineas.map((l) => ({
                item: l.item,
                descripcion: l.descripcion,
                cantidad: l.cantidad,
                unidad: l.unidad,
                nuevo: l.material_nuevo && !l.material_id,
                codigo: l.material_codigo,
                unidad_pendiente: l.material_unidad_pendiente,
              }))}
              materiales={rq.lineas.some((l) => l.material_nuevo && !l.material_id) ? catalogo : []}
            />
          )}
          {generaOc && (
            <GenerarCompraDelRequerimiento
              requerimiento={{
                id: rq.id,
                numero: rq.numero,
                area: rq.area,
                codigo_interno: rq.codigo_interno,
                justificacion: rq.justificacion,
                lineas: rq.lineas.map((l) => ({
                  item: l.item,
                  descripcion: l.descripcion,
                  cantidad: l.cantidad,
                  unidad: l.unidad,
                  orden_compra: l.orden_compra,
                  compra_rechazada: l.compra_rechazada,
                  en_stock: l.en_stock,
                  material_id: l.material_id,
                })),
              }}
              {...paraComprar}
            />
          )}
          {compra && rq.estado === 'SIN_STOCK' && <PasoRequerimiento id={rq.id} numero={rq.numero} paso="en_atencion" />}
          {recibe && (rq.estado === 'SIN_STOCK' || rq.estado === 'EN_ATENCION') && (
            <PasoRequerimiento id={rq.id} numero={rq.numero} paso="listo" />
          )}
          {despacha && rq.estado === 'LISTO_EN_ALMACEN' && (
            <>
              <Link href={`/almacen/kardex?rq=${rq.id}`} className="text-xs text-acento hover:underline">
                Registrar la salida en el kardex
              </Link>
              <PasoRequerimiento id={rq.id} numero={rq.numero} paso="entregado" />
            </>
          )}
        </div>
      </TD>
    </TR>
  )
}
