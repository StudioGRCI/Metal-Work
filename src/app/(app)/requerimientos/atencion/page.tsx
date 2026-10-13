import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cargarRequerimientos, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { ESTADO_REQUERIMIENTO } from '@/lib/dominio/requerimientos'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { PasoRequerimiento } from './controles'

export const metadata = { title: 'Atención de requerimiento' }

const VISTAS = [
  { valor: 'abiertos', titulo: 'Por atender' },
  { valor: 'todos', titulo: 'Historial' },
] as const

/**
 * La bandeja que comparten Almacén y Logística. Cada RQ muestra el botón del
 * paso que le toca a quien mira: Almacén revisa el stock y entrega; Logística
 * marca que está comprando. Supervisión entra solo a ver qué está listo.
 */
export default async function PaginaAtencion({ searchParams }: PageProps<'/requerimientos/atencion'>) {
  const perfil = await exigirPermiso(['almacen.recibir', 'almacen.despachar', 'compras.crear', 'requerimientos.ver'])
  const recibe = puede(perfil, 'almacen.recibir')
  const despacha = puede(perfil, 'almacen.despachar')
  const compra = puede(perfil, 'compras.crear')
  const params = await searchParams
  const vista = params.vista === 'todos' ? 'todos' : 'abiertos'
  const requerimientos = await cargarRequerimientos({ soloAbiertos: vista === 'abiertos' })

  const meToca = requerimientos.filter((r) => leToca(r.estado, { recibe, despacha, compra })).length

  return (
    <>
      <EncabezadoPagina
        titulo="Atención de requerimiento"
        descripcion="Cada requerimiento pasa primero por Almacén: si hay stock queda listo y el área lo recoge; si no, Logística lo compra, Almacén lo recepciona y lo entrega."
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
                descripcion="Cuando Requerimientos registre uno, aparece aquí y te llega un aviso."
              />
            ) : (
              requerimientos.map((r) => <Fila key={r.id} rq={r} recibe={recibe} despacha={despacha} compra={compra} />)
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function leToca(estado: string, p: { recibe: boolean; despacha: boolean; compra: boolean }) {
  if (estado === 'POR_ATENDER' || estado === 'EN_ATENCION') return p.recibe
  if (estado === 'SIN_STOCK') return p.compra || p.recibe
  if (estado === 'LISTO_EN_ALMACEN') return p.despacha
  return false
}

function Fila({ rq, recibe, despacha, compra }: { rq: RequerimientoListado; recibe: boolean; despacha: boolean; compra: boolean }) {
  const estado = ESTADO_REQUERIMIENTO[rq.estado]
  const pasos = [
    [`Registrado ${fechaHora(rq.creado_en)}`, rq.fecha_requerida ? `se necesita el ${fecha(rq.fecha_requerida)}` : null].filter(Boolean).join(' · '),
    rq.revision_stock_en && rq.estado !== 'LISTO_EN_ALMACEN' && rq.estado !== 'ENTREGADO' ? `Almacén revisó ${fechaHora(rq.revision_stock_en)}` : null,
    rq.nota_almacen ? `Almacén: ${rq.nota_almacen}` : null,
    rq.en_atencion_en ? `Logística compra desde ${fechaHora(rq.en_atencion_en)}` : null,
    rq.nota_logistica ? `Logística: ${rq.nota_logistica}` : null,
    rq.listo_en_almacen_en ? `Listo en almacén ${fechaHora(rq.listo_en_almacen_en)}` : null,
    rq.entregado_en ? `Entregado ${fechaHora(rq.entregado_en)}${rq.nota_entrega ? ` a ${rq.nota_entrega}` : ''}` : null,
    rq.motivo_anulacion ? `Anulado: ${rq.motivo_anulacion}` : null,
  ].filter((p): p is string => Boolean(p))

  return (
    <TR>
      <TD className="align-top">
        <p className="tabular font-semibold text-texto">{rq.numero}</p>
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
              <span className="block text-[11px] text-texto-suave">{l.categoria}</span>
            </li>
          ))}
        </ul>
      </TD>
      <TD className="align-top">
        {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : rq.estado}
        <ul className="mt-1 space-y-0.5 text-[11px] text-texto-suave">
          {pasos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </TD>
      <TD className="text-right align-top">
        <div className="flex flex-col items-end gap-1.5">
          {recibe && rq.estado === 'POR_ATENDER' && (
            <>
              <PasoRequerimiento id={rq.id} numero={rq.numero} paso="listo" />
              <PasoRequerimiento id={rq.id} numero={rq.numero} paso="sin_stock" />
            </>
          )}
          {compra && rq.estado === 'SIN_STOCK' && <PasoRequerimiento id={rq.id} numero={rq.numero} paso="en_atencion" />}
          {recibe && (rq.estado === 'SIN_STOCK' || rq.estado === 'EN_ATENCION') && (
            <PasoRequerimiento id={rq.id} numero={rq.numero} paso="listo" />
          )}
          {despacha && rq.estado === 'LISTO_EN_ALMACEN' && <PasoRequerimiento id={rq.id} numero={rq.numero} paso="entregado" />}
        </div>
      </TD>
    </TR>
  )
}
