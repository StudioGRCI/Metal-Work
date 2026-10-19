import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { HistorialDeCorrecciones } from '@/components/correcciones/historial'
import { correccionesDe, type CorreccionVista } from '@/lib/datos/correcciones'
import {
  cargarRequerimientos,
  catalogosDelRequerimiento,
  type MaterialParaRequerimiento,
  type RequerimientoListado,
} from '@/lib/datos/requerimientos'
import { ESTADO_REQUERIMIENTO, ESTADOS_RQ_ABIERTOS, TIPO_REQUERIMIENTO, type TipoRequerimiento } from '@/lib/dominio/requerimientos'
import { fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { esUuid } from '@/lib/utils'

import { AvanceDelRequerimiento, InsumosDelRequerimiento } from './avance'
import { AnularRequerimiento } from './controles'
import { CorregirRequerimiento } from './corregir'
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
  // `?rq=` muestra un solo RQ: es el enlace con que Adquisiciones abre el RQ de cada OC.
  const soloUno = typeof params.rq === 'string' && esUuid(params.rq) ? params.rq : undefined
  // `?codigo=` muestra los RQ de un código interno: el que se presiona en cada fila.
  const codigo = typeof params.codigo === 'string' && params.codigo.trim().length >= 2 ? params.codigo.trim().slice(0, 60) : undefined
  // El supervisor de área ve primero los RQ de su área, como en su dashboard;
  // `?area=todas` muestra los de todas. Los de Administración no son de ningún taller.
  const supervisaArea = perfil.rol.codigo === 'SUPERVISOR' && perfil.area_id !== null
  const deSuArea = supervisaArea && params.area !== 'todas' ? (perfil.area_id ?? undefined) : undefined
  const [requerimientos, catalogos] = await Promise.all([
    cargarRequerimientos(
      soloUno ? { id: soloUno } : { tipo: supervisaArea || vista === 'todos' ? undefined : vista, area: deSuArea, codigo },
    ),
    emite ? catalogosDelRequerimiento() : Promise.resolve(null),
  ])
  const correcciones = await correccionesDe('REQUERIMIENTO', requerimientos.map((r) => r.id))
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
            : supervisaArea
              ? 'Lo que pidió tu área, y con «Todas las áreas» lo de las demás. Presiona los insumos de cada RQ para ver cuáles da Almacén y cuáles van a compra; el código interno muestra solo los RQ de esa unidad.'
              : 'Los requerimientos de operación y de Administración. «Listo en almacén» es lo que el área ya puede recoger. Presiona los insumos de cada RQ para ver cuáles da Almacén y cuáles van a compra.'
        }
        migas={[{ titulo: 'Requerimientos' }]}
        acciones={catalogos && <NuevoRequerimiento {...catalogos} tipos={tipos} />}
      />

      <Vistas
        etiqueta="Requerimiento"
        className="mb-3"
        vistas={(supervisaArea
          ? [
              { clave: 'mia', titulo: 'De tu área', href: '/requerimientos', activa: Boolean(deSuArea), descripcion: undefined },
              { clave: 'todas', titulo: 'Todas las áreas', href: '/requerimientos?area=todas', activa: !deSuArea, descripcion: undefined },
            ]
          : VISTAS.map((v) => ({
              clave: v.valor,
              titulo: v.titulo,
              href: `/requerimientos?tipo=${v.valor}`,
              activa: vista === v.valor,
              descripcion: v.valor === 'todos' ? undefined : TIPO_REQUERIMIENTO[v.valor]?.descripcion,
            }))
        ).map((v) => ({
          ...v,
          href: codigo ? `${v.href}${v.href.includes('?') ? '&' : '?'}codigo=${encodeURIComponent(codigo)}` : v.href,
          activa: !soloUno && v.activa,
          cuenta: !soloUno && v.activa ? requerimientos.length : undefined,
        }))}
      />

      {!soloUno && codigo && (
        <p className="mb-3 text-sm text-texto-suave">
          Solo los del código interno <span className="font-mono text-texto">{codigo}</span>.{' '}
          <Link href={supervisaArea && !deSuArea ? '/requerimientos?area=todas' : '/requerimientos'} className="font-medium text-acento hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      {soloUno && (
        <p className="mb-3 text-sm text-texto-suave">
          {requerimientos.length === 1 ? `Solo el ${requerimientos[0].numero}.` : 'Ese requerimiento no está o no lo puedes ver.'}{' '}
          <Link href="/requerimientos" className="font-medium text-acento hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      {!soloUno && requerimientos.length > 0 && (
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
              requerimientos.map((r) => (
                <FilaRequerimiento
                  key={r.id}
                  rq={r}
                  // Quien los lleva los ve abiertos, como siempre; quien consulta, al presionar.
                  insumosAbiertos={emite || Boolean(soloUno)}
                  enlaceCodigo={supervisaArea && !deSuArea ? '/requerimientos?area=todas&codigo=' : '/requerimientos?codigo='}
                  anula={tipos.includes(r.tipo as TipoRequerimiento)}
                  materiales={catalogos?.materiales ?? []}
                  correcciones={correcciones.get(r.id)}
                />
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}

function FilaRequerimiento({
  rq,
  insumosAbiertos,
  enlaceCodigo,
  anula,
  materiales,
  correcciones,
}: {
  rq: RequerimientoListado
  insumosAbiertos: boolean
  /** A dónde lleva el código interno de la fila: la lista con solo los RQ de ese código. */
  enlaceCodigo: string
  /** Quien lleva su tipo: lo anula y lo corrige. */
  anula: boolean
  materiales: MaterialParaRequerimiento[]
  correcciones: CorreccionVista[] | undefined
}) {
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
          {rq.area} ·{' '}
          <Link
            href={`${enlaceCodigo}${encodeURIComponent(rq.codigo_interno)}`}
            title="Ver los requerimientos de este código interno"
            className="tabular font-medium text-acento hover:underline"
          >
            {rq.codigo_interno}
          </Link>
        </p>
        <p className="mt-1 max-w-sm text-xs text-texto-suave">{rq.justificacion}</p>
        <p className="text-[11px] text-texto-suave">
          {[`Registrado ${fechaHora(rq.creado_en)}`, rq.fecha_requerida ? `se necesita el ${fecha(rq.fecha_requerida)}` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {rq.motivo_anulacion && <p className="mt-1 text-xs text-peligro">Anulado: {rq.motivo_anulacion}</p>}
        <HistorialDeCorrecciones correcciones={correcciones} />
      </TD>
      <TD className="min-w-56 align-top">
        <InsumosDelRequerimiento rq={rq} abierto={insumosAbiertos} />
      </TD>
      <TD className="align-top">
        {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : rq.estado}
        <AvanceDelRequerimiento rq={rq} />
        {rq.nota_almacen && <p className="mt-1 max-w-xs text-[11px] text-texto-suave">Almacén: {rq.nota_almacen}</p>}
        {rq.listo_en_almacen_en && !rq.entregado_en && <p className="text-[11px] text-texto-suave">Desde {fechaHora(rq.listo_en_almacen_en)}</p>}
        {rq.entregado_en && <p className="text-[11px] text-texto-suave">Entregado {fechaHora(rq.entregado_en)}{rq.nota_entrega ? ` a ${rq.nota_entrega}` : ''}</p>}
      </TD>
      <TD className="text-right align-top">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {anula && rq.estado !== 'ENTREGADO' && rq.estado !== 'ANULADO' && <CorregirRequerimiento rq={rq} materiales={materiales} />}
          {anula && (rq.estado === 'POR_ATENDER' || rq.estado === 'SIN_STOCK') && <AnularRequerimiento id={rq.id} numero={rq.numero} />}
        </div>
      </TD>
    </TR>
  )
}
