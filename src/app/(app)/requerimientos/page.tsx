import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cargarRequerimientos, catalogosDelRequerimiento, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { ESTADO_REQUERIMIENTO, ESTADOS_RQ_ABIERTOS, TIPO_REQUERIMIENTO, type TipoRequerimiento } from '@/lib/dominio/requerimientos'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AvanceDelRequerimiento, CompraDelInsumo } from './avance'
import { AnularRequerimiento } from './controles'
import { NuevoRequerimiento } from './formulario'

export const metadata = { title: 'Requerimientos' }

const VISTAS = [
  { valor: 'todos', titulo: 'Todos' },
  { valor: 'OPERACION', titulo: 'Operación' },
  { valor: 'ADMINISTRACION', titulo: 'Administración' },
] as const

export default async function PaginaRequerimientos({ searchParams }: PageProps<'/requerimientos'>) {
  const perfil = await exigirPermiso([
    'requerimientos.emitir',
    'requerimientos.administracion',
    'requerimientos.ver',
    'compras.crear',
    'almacen.recibir',
  ])
  // Cada requerimiento lo lleva su dueño: el de operación, Requerimientos; el
  // de Administración, la administradora (migración 20261015162000).
  const tipos: TipoRequerimiento[] = [
    ...(puede(perfil, 'requerimientos.emitir') ? (['OPERACION'] as const) : []),
    ...(puede(perfil, 'requerimientos.administracion') ? (['ADMINISTRACION'] as const) : []),
  ]
  const emite = tipos.length > 0
  // Quien lleva uno solo abre en el suyo; los demás, en todos.
  const params = await searchParams
  const pedida = VISTAS.find((v) => v.valor === params.tipo)?.valor
  const vista = pedida ?? (tipos.length === 1 ? tipos[0] : 'todos')
  const [requerimientos, catalogos] = await Promise.all([
    cargarRequerimientos({ tipo: vista === 'todos' ? undefined : vista }),
    emite ? catalogosDelRequerimiento() : Promise.resolve(null),
  ])
  const abiertos = requerimientos.filter((r) => ESTADOS_RQ_ABIERTOS.includes(r.estado as (typeof ESTADOS_RQ_ABIERTOS)[number])).length
  const listos = requerimientos.filter((r) => r.estado === 'LISTO_EN_ALMACEN').length
  // Los dos momentos del recojo que se quieren distinguir de un vistazo.
  const pendientesDeRecojo = requerimientos.filter((r) => r.lineas.some((l) => l.etapa === 'PENDIENTE_RECOJO')).length
  const enRecojo = requerimientos.filter((r) => r.lineas.some((l) => l.etapa === 'EN_RECOJO')).length

  return (
    <>
      <EncabezadoPagina
        titulo="Requerimientos"
        descripcion={
          emite
            ? 'Lo que cada área necesita, con el código interno y su justificación. Al registrarlo lo revisa Almacén insumo por insumo: lo que tiene lo separa y solo lo que falta se compra.'
            : 'Los requerimientos de operación y de Administración. «Listo en almacén» es lo que el área ya puede recoger.'
        }
        migas={[{ titulo: 'Requerimientos' }]}
        acciones={catalogos && <NuevoRequerimiento {...catalogos} tipos={tipos} />}
      />

      <nav aria-label="Requerimiento" className="mb-3 flex flex-wrap items-center gap-2">
        {VISTAS.map((v) => (
          <Link
            key={v.valor}
            href={`/requerimientos?tipo=${v.valor}`}
            aria-current={vista === v.valor ? 'page' : undefined}
            title={v.valor === 'todos' ? undefined : TIPO_REQUERIMIENTO[v.valor]?.descripcion}
            className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium ${
              vista === v.valor ? 'border-acento bg-acento-suave text-texto' : 'border-borde text-texto-suave hover:text-texto'
            }`}
          >
            {v.titulo}
            {vista === v.valor && <span className="ml-2 tabular text-xs text-texto-suave">{requerimientos.length}</span>}
          </Link>
        ))}
      </nav>

      {requerimientos.length > 0 && (
        <p className="mb-3 text-sm text-texto-suave">
          {abiertos === 0 ? 'Ninguno en camino.' : `${abiertos} en camino`}
          {pendientesDeRecojo > 0 && ` · ${pendientesDeRecojo} con insumos pendientes de recojo`}
          {enRecojo > 0 && ` · ${enRecojo} con insumos en recojo`}
          {listos > 0 && ` · ${listos} ${listos === 1 ? 'listo' : 'listos'} en almacén para recoger`}
          {abiertos > 0 && '.'}
        </p>
      )}

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
                titulo="Todavía no hay requerimientos"
                descripcion={emite ? 'Registra el primero con «Nuevo requerimiento».' : 'Requerimientos y la administradora los registran; aparecen aquí con su número.'}
              />
            ) : (
              requerimientos.map((r) => <FilaRequerimiento key={r.id} rq={r} anula={tipos.includes(r.tipo as TipoRequerimiento)} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaRequerimiento({ rq, anula }: { rq: RequerimientoListado; anula: boolean }) {
  const estado = ESTADO_REQUERIMIENTO[rq.estado]
  return (
    <TR>
      <TD className="align-top">
        <p className="tabular font-semibold text-texto">
          {rq.numero}
          {rq.tipo === 'ADMINISTRACION' && (
            <Insignia tono="acento" className="ml-2 align-middle">
              Administración
            </Insignia>
          )}
        </p>
        <p className="text-xs text-texto">
          {rq.area} · <span className="tabular">{rq.codigo_interno}</span>
        </p>
        <p className="mt-1 max-w-sm text-xs text-texto-suave">{rq.justificacion}</p>
        <p className="text-[11px] text-texto-suave">
          {[`Registrado ${fechaHora(rq.creado_en)}`, rq.fecha_requerida ? `se necesita el ${fecha(rq.fecha_requerida)}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {rq.motivo_anulacion && <p className="mt-1 text-xs text-peligro">Anulado: {rq.motivo_anulacion}</p>}
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
        {rq.nota_almacen && <p className="mt-1 max-w-xs text-[11px] text-texto-suave">Almacén: {rq.nota_almacen}</p>}
        {rq.listo_en_almacen_en && !rq.entregado_en && <p className="text-[11px] text-texto-suave">Desde {fechaHora(rq.listo_en_almacen_en)}</p>}
        {rq.entregado_en && <p className="text-[11px] text-texto-suave">Entregado {fechaHora(rq.entregado_en)}{rq.nota_entrega ? ` a ${rq.nota_entrega}` : ''}</p>}
      </TD>
      <TD className="text-right align-top">
        {anula && (rq.estado === 'POR_ATENDER' || rq.estado === 'SIN_STOCK') && <AnularRequerimiento id={rq.id} numero={rq.numero} />}
      </TD>
    </TR>
  )
}
