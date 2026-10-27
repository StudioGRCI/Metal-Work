import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { LineaDeDiseno } from '@/components/codigo-interno/linea-diseno'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { PorcentajeYCosto } from '@/components/ui/porcentaje-y-costo'
import { Progreso } from '@/components/ui/progreso'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { leerListaDeCodigos, sumarCodigosDeDiseno, type AvanceDeCodigo, type ResumenCodigo } from '@/lib/datos/codigos-internos'
import type { CodigoDeDiseno } from '@/lib/datos/diseno-codigos'
import {
  costoDelCodigo,
  dondeAparece,
  enlaceCodigo,
  faltaElPrecio,
  llaveParecido,
  montoMixto,
  noEsUnidad,
  origenDelAvance,
  parecidos,
} from '@/lib/dominio/codigos-internos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { horasCortas } from '@/lib/dominio/rrhh'
import { cantidad, fecha, moneda, parteDe, porcentaje } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Códigos internos' }

const tieneCosto = (c: ResumenCodigo) => {
  const costo = costoDelCodigo(c)
  return costo.pen + costo.usd > 0
}
const porCompletar = (c: ResumenCodigo) =>
  c.horas_sin_costo > 0 || c.materiales_sin_precio > 0 || c.compras_sin_precio > 0 || c.lineas_sin_cambio > 0

/**
 * Cuántos códigos se pintan por página. Con mil códigos la lista tardaba medio
 * minuto en pintarse, aunque la base respondía en milisegundos.
 */
const POR_PAGINA = 50

/**
 * Abierto o cerrado según el costeo: Gerencia lo cierra al entregar la unidad.
 * De entrada salen los abiertos (pedido de DKS, 2026-10-20).
 */
const ESTADOS: Record<string, (c: ResumenCodigo) => boolean> = {
  cerrados: (c) => c.cierre !== null,
  todos: () => true,
}
const abierto = (c: ResumenCodigo) => c.cierre === null

/** Los filtros de la lista. «Parecidos» es lo que Gerencia tiene que verificar a mano. */
const FILTROS: Record<string, (c: ResumenCodigo, parecido: boolean) => boolean> = {
  reportes: (c) => c.reportes > 0,
  costo: (c) => tieneCosto(c),
  parecidos: (_, parecido) => parecido,
  'por-completar': (c) => porCompletar(c),
}

export default async function PaginaCodigosInternos({ searchParams }: PageProps<'/codigos-internos'>) {
  await exigirPermiso('codigos_internos.ver')
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const filtro = typeof params.ver === 'string' && Object.hasOwn(FILTROS, params.ver) ? params.ver : null
  const estado = typeof params.costeo === 'string' && Object.hasOwn(ESTADOS, params.costeo) ? params.costeo : null

  const { codigos: conDocumentos, diseno: deDiseno, avances } = await leerListaDeCodigos()
  // Un código puede tener planos o etapas de Diseño antes que cualquier documento.
  const todos = sumarCodigosDeDiseno(conDocumentos, deDiseno)
  const diseno = new Map(deDiseno.map((d) => [d.codigo, d]))
  // Los parecidos se buscan entre todos, no solo entre los que deja la búsqueda.
  const parecidosDe = parecidos(todos.map((c) => c.codigo))
  const llave = llaveParecido(q)
  // También por la placa y el vehículo que muestra cada fila.
  const palabras = palabrasDeBusqueda(q)
  const buscados = q
    ? todos.filter((c) => c.codigo.includes(q.toUpperCase()) || (llave && llaveParecido(c.codigo).includes(llave)) || coincide(palabras, [c.codigo, diseno.get(c.codigo)?.unidad]))
    : todos
  const enEstado = buscados.filter(estado ? ESTADOS[estado] : abierto)
  const cuantos = (clave: string) => enEstado.filter((c) => FILTROS[clave](c, parecidosDe.has(c.codigo))).length
  const codigos = filtro ? enEstado.filter((c) => FILTROS[filtro](c, parecidosDe.has(c.codigo))) : enEstado
  const paginas = Math.max(1, Math.ceil(codigos.length / POR_PAGINA))
  const pagina = Math.min(Math.max(1, Math.trunc(Number(params.pagina)) || 1), paginas)
  const mostrar = codigos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
  const cerrados = buscados.filter(ESTADOS.cerrados).length
  // El «Todos» del segundo grupo es de lo elegido en el primero: dicho a secas se leía como todos los códigos.
  const todosDelEstado = estado === 'cerrados' ? 'Todos los cerrados' : estado === 'todos' ? 'Todos' : 'Todos los abiertos'

  const costo = codigos.reduce((n, c) => n + costoDelCodigo(c).pen, 0)
  const dolares = codigos.reduce((n, c) => n + costoDelCodigo(c).usd, 0)
  const horas = codigos.reduce((n, c) => n + c.horas, 0)

  const sinBuscarNiFiltrar = !q && !filtro
  const vacio =
    todos.length === 0
      ? {
          titulo: 'Todavía no hay códigos internos',
          texto: 'Aparecen aquí apenas un requerimiento, una salida del almacén, un reporte diario o una carga de horas lleva uno.',
        }
      : sinBuscarNiFiltrar && estado === 'cerrados'
        ? { titulo: 'Ningún código con el costeo cerrado', texto: 'Gerencia lo cierra en el detalle del código, con «Cerrar el costeo», al entregar la unidad.' }
        : sinBuscarNiFiltrar && !estado
          ? { titulo: 'Ningún código abierto', texto: 'Todos los códigos tienen el costeo cerrado. Los ves en «Costeo cerrado».' }
          : {
              titulo: 'Ningún código con esta búsqueda o filtro',
              texto:
                !estado && cerrados > 0
                  ? `Mira en «Costeo cerrado» (${cantidad(cerrados)}), borra la búsqueda con «Limpiar» o quita el filtro con «${todosDelEstado}».`
                  : `Borra la búsqueda con «Limpiar» o quita el filtro con «${todosDelEstado}».`,
            }

  return (
    <>
      <EncabezadoPagina
        titulo="Códigos internos"
        ayuda="Cada código interno con cómo va, lo que lleva costado y lo que deja de margen. De entrada salen los abiertos: el código cuyo costeo cerró Gerencia al entregar la unidad está en «Costeo cerrado»."
        migas={[{ titulo: 'Códigos internos' }]}
      />

      <SeccionDesplegable titulo="Cómo se calcula" className="mb-3">
        <div className="space-y-2 text-sm text-texto-suave">
          <p>
            Aparece cada código que está en el sistema: reportes diarios, horas de RR. HH., salidas del almacén, requerimientos, compras,
            órdenes de servicio, subcontratos, unidades e ingresos a la planta.
          </p>
          <p>
            <strong className="text-texto">El avance</strong> sale de lo que arma Diseño. Si puso a cada plano el porcentaje de la unidad que
            representa, cada plano aporta ese porcentaje por lo que avanzó: lo último que reportó su área, o 100 % si la etapa de su área ya
            terminó. Lo que no se repartió en planos se mide por el promedio de las etapas, donde la terminada vale 100 % y la que no, el
            promedio de las actividades de su área que no son de un plano (el plano ya contó por su lado); si no hay etapas, por el promedio
            de las actividades del reporte diario que no son de un plano. Sin planos con porcentaje, el avance es el promedio de las etapas,
            con lo que su área reporta en el reporte diario; sin etapas, el promedio del último avance de cada trabajo del reporte diario,
            área por área. En el detalle de cada código, la pestaña Avance muestra cómo sale el suyo.
          </p>
          <p>
            <strong className="text-texto">El costo</strong> suma, en soles, la mano de obra con el recargo de sus horas extras, los
            materiales que salieron del almacén con la merma que Diseño evaluó en la OT, las órdenes de servicio aprobadas, los recibos por
            honorarios de los subcontratos, los gastos del mes, los gastos que Administración aprobó en la OT y los egresos de caja con el
            código. Lo que está en dólares pasa a soles con el tipo de cambio que Contabilidad registró para el día de cada línea. Las compras se
            muestran aparte y no se suman: lo comprado se cuenta cuando sale del almacén.
          </p>
          <p>
            <strong className="text-texto">El margen</strong> es la cotización aprobada sin IGV menos ese costo.
          </p>
        </div>
      </SeccionDesplegable>

      <div className="mb-3 space-y-3">
        <BuscadorSimple ruta="/codigos-internos" etiqueta="Buscar código interno" marcador="Código, placa o vehículo" />
        <PastillaFiltro
          ruta="/codigos-internos"
          clave="costeo"
          params={params}
          activo={estado}
          etiqueta="Abiertos o con el costeo cerrado"
          opciones={[
            { valor: null, etiqueta: `Abiertos (${cantidad(buscados.length - cerrados)})` },
            { valor: 'cerrados', etiqueta: `Costeo cerrado (${cantidad(cerrados)})` },
            { valor: 'todos', etiqueta: `Abiertos y cerrados (${cantidad(buscados.length)})` },
          ]}
        />
        <PastillaFiltro
          ruta="/codigos-internos"
          clave="ver"
          params={params}
          activo={filtro}
          etiqueta="Qué códigos mostrar"
          opciones={[
            { valor: null, etiqueta: `${todosDelEstado} (${cantidad(enEstado.length)})` },
            { valor: 'reportes', etiqueta: `Con reporte diario (${cantidad(cuantos('reportes'))})` },
            { valor: 'costo', etiqueta: `Con costo (${cantidad(cuantos('costo'))})` },
            { valor: 'parecidos', etiqueta: `Parecidos a otro (${cantidad(cuantos('parecidos'))})` },
            { valor: 'por-completar', etiqueta: `Sin precio, sin costo o sin cambio (${cantidad(cuantos('por-completar'))})` },
          ]}
        />
        <p className="text-xs text-texto-suave">
          <span className="tabular">{cantidad(codigos.length)}</span> {codigos.length === 1 ? 'código' : 'códigos'} ·{' '}
          <span className="tabular">{moneda(costo)}</span>
          {dolares > 0 && (
            <>
              {' '}
              + <span className="tabular">{moneda(dolares, 'USD')}</span> sin tipo de cambio
            </>
          )}{' '}
          costados · <span className="tabular">{horasCortas(horas)}</span> de personal
        </p>
      </div>

      {codigos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">{vacio.titulo}</p>
            <p className="text-sm text-texto-suave">{vacio.texto}</p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {mostrar.map((c) => (
            <li key={c.codigo}>
              <FilaCodigo codigo={c} parecidos={parecidosDe.get(c.codigo) ?? []} diseno={diseno.get(c.codigo)} avance={avances.get(c.codigo)} />
            </li>
          ))}
        </ul>
      )}

      <Paginacion
        ruta="/codigos-internos"
        pagina={pagina}
        paginas={paginas}
        total={codigos.length}
        porPagina={POR_PAGINA}
        params={params}
      />
    </>
  )
}

function FilaCodigo({
  codigo: c,
  parecidos,
  diseno,
  avance,
}: {
  codigo: ResumenCodigo
  parecidos: string[]
  diseno: CodigoDeDiseno | undefined
  avance: AvanceDeCodigo | undefined
}) {
  const costo = costoDelCodigo(c)
  const sinPrecio = faltaElPrecio(costo.pen + costo.usd, c.materiales_sin_precio + c.horas_sin_costo)
  const presupuesto = c.venta?.presupuesto_pen ?? null
  const margen = c.venta?.margen_pct ?? null
  // Cada parte del costo con lo que pesa en el total en soles: se lee de un
  // vistazo qué se lleva la plata (DKS, 27/10/2026: porcentaje y costo).
  const partes = [
    {
      clave: 'mano-obra',
      etiqueta: 'Mano de obra',
      pen: c.mano_obra + c.recargo_extras,
      usd: 0,
      texto: faltaElPrecio(c.mano_obra + c.recargo_extras, c.horas_sin_costo, 'sin costo'),
      extra: c.horas > 0 ? horasCortas(c.horas) : null,
    },
    {
      clave: 'materiales',
      etiqueta: 'Materiales',
      pen: c.materiales_pen + c.merma_pen,
      usd: c.materiales_usd + c.merma_usd,
      texto: faltaElPrecio(c.materiales_pen + c.materiales_usd, c.materiales_sin_precio, 'sin precio'),
      extra: c.merma_pen + c.merma_usd > 0 ? 'con su merma' : null,
    },
    { clave: 'servicios', etiqueta: 'Servicios', pen: c.servicios_pen, usd: c.servicios_usd, texto: null, extra: null },
    { clave: 'subcontratos', etiqueta: 'Subcontratos', pen: c.subcontratos_pen, usd: c.subcontratos_usd, texto: null, extra: null },
    {
      clave: 'gastos',
      etiqueta: 'Gastos y caja',
      pen: c.gastos_mes_pen + c.gastos_ot_pen + c.caja_pen,
      usd: c.gastos_mes_usd + c.gastos_ot_usd + c.caja_usd,
      texto: null,
      extra: null,
    },
  ].filter((p) => p.pen > 0 || p.usd > 0 || p.texto !== null)

  return (
    <Link
      href={enlaceCodigo(c.codigo)}
      className="block rounded-[var(--radius-base)] border border-borde bg-superficie p-4 hover:border-acento"
      data-codigo={c.codigo}
    >
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="font-mono font-semibold break-all text-texto">{c.codigo}</p>
          {diseno?.unidad && <p className="text-xs text-texto">{diseno.unidad}</p>}
          <p className="text-xs text-texto-suave">{dondeAparece(c, diseno)}</p>
        </div>
        {/* Las tres cifras del código, cada una en sus dos unidades. En el
            teléfono van debajo del código, en una rejilla de rótulo y cifra. */}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs sm:justify-items-end sm:text-right">
          <dt className="text-texto-suave">Costo hasta hoy</dt>
          <dd className="tabular font-semibold text-texto">
            {sinPrecio ?? (
              <>
                {moneda(costo.pen)}
                {presupuesto !== null && c.venta?.consumido_pct !== null && c.venta?.consumido_pct !== undefined && (
                  <span
                    className={`font-normal ${c.venta.semaforo === 'EXCEDIDO' ? 'text-peligro' : c.venta.semaforo === 'AJUSTADO' ? 'text-aviso' : 'text-texto-suave'}`}
                    data-consumido={c.venta.consumido_pct}
                  >
                    {' '}
                    · {porcentaje(c.venta.consumido_pct)} del presupuesto
                  </span>
                )}
              </>
            )}
            {costo.usd > 0 && <span className="block font-normal text-texto">+ {moneda(costo.usd, 'USD')} sin cambio</span>}
          </dd>
          {margen !== null && (
            <>
              <dt className="text-texto-suave">Margen a hoy</dt>
              <dd data-margen={margen}>
                <PorcentajeYCosto porcentaje={margen} costo={c.venta?.margen_pen} decimales={1} tono={margen < 0 ? 'text-peligro' : 'text-texto'} />
                <span className="sr-only">, sobre la venta sin IGV</span>
              </dd>
            </>
          )}
          {presupuesto !== null && (
            <>
              <dt className="text-texto-suave">Presupuesto</dt>
              <dd className="tabular text-texto" data-presupuesto={presupuesto}>
                {moneda(presupuesto)}
                {c.venta?.presupuesto_fijado && <span className="text-texto-suave"> · fijado en la OT</span>}
              </dd>
            </>
          )}
          {c.cierre && (
            <>
              <dt className="text-texto-suave">
                <Insignia tono="exito">Costeo cerrado</Insignia>
              </dt>
              {/* Lo congelado al entregar; si después entró algo, el costo de arriba ya no es el mismo. */}
              <dd className="tabular text-texto-suave" data-cerrado={c.cierre.costo_pen}>
                en {moneda(c.cierre.costo_pen)} el {fecha(c.cierre.cerrado_en)}
              </dd>
            </>
          )}
        </dl>
      </div>

      {parecidos.length > 0 && (
        <p className="mt-1 text-xs text-aviso">
          Se escribe casi igual que <span className="font-mono">{parecidos.join(', ')}</span>: ¿es el mismo código?
        </p>
      )}

      <div className="mt-2">
        <LineaDeDiseno d={diseno} />
      </div>

      {noEsUnidad(c.codigo) ? (
        <p className="mt-2 text-xs text-texto-suave">{origenDelAvance(c.codigo, avance)}.</p>
      ) : (
        <div className="mt-2 grid items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(0,1fr)_14rem]" data-avance={avance?.avance ?? 0}>
          <span className={avance ? 'text-texto' : 'text-texto-suave'}>
            {origenDelAvance(c.codigo, avance)}
            {c.ultimo_reporte && <span className="text-texto-suave"> · último reporte el {fecha(c.ultimo_reporte)}</span>}
          </span>
          {/* Con presupuesto, el avance se lee también en plata: lo que vale lo hecho del presupuesto. */}
          <Progreso
            valor={avance?.avance ?? 0}
            alto="sm"
            mostrarValor
            costo={presupuesto !== null ? (presupuesto * (avance?.avance ?? 0)) / 100 : undefined}
            etiqueta={`Avance de ${c.codigo}`}
          />
        </div>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texto-suave">
        {partes.map((p) => {
          const parte = p.texto === null ? parteDe(p.pen, costo.pen) : null
          return (
            <span key={p.clave} data-costo-parte={p.clave}>
              {p.etiqueta}{' '}
              <span className="tabular text-texto">{p.texto ?? montoMixto(p.pen, p.usd)}</span>
              {parte !== null && costo.pen > 0 && <span className="tabular"> · {porcentaje(parte)}</span>}
              {p.extra && <span className="tabular"> ({p.extra})</span>}
            </span>
          )
        })}
        {c.usd_al_cambio > 0 && (
          <span>
            Los <span className="tabular">{moneda(c.usd_al_cambio, 'USD')}</span> suman{' '}
            <span className="tabular text-texto">{moneda(c.usd_en_soles)}</span> al cambio
          </span>
        )}
        {(c.compras_pen > 0 || c.compras_usd > 0) && (
          <span>
            Compras <span className="tabular">{moneda(c.compras_pen)}</span>
            {c.compras_usd > 0 && <span className="tabular"> + {moneda(c.compras_usd, 'USD')}</span>} sin IGV, aparte
          </span>
        )}
        {c.horas_sin_costo > 0 && <Insignia tono="aviso">{horasCortas(c.horas_sin_costo)} sin costo</Insignia>}
        {c.materiales_sin_precio > 0 && (
          <Insignia tono="aviso">
            {c.materiales_sin_precio} {c.materiales_sin_precio === 1 ? 'salida sin precio' : 'salidas sin precio'}
          </Insignia>
        )}
        {c.servicios_por_aprobar > 0 && (
          <Insignia tono="aviso">
            {c.servicios_por_aprobar} OS por aprobar
          </Insignia>
        )}
        {c.subcontratos_por_pagar > 0 && (
          <Insignia tono="aviso">
            {c.subcontratos_por_pagar} RxH por pagar
          </Insignia>
        )}
        {c.compras_sin_precio > 0 && (
          <Insignia tono="aviso">
            {c.compras_sin_precio} {c.compras_sin_precio === 1 ? 'línea de OC sin precio' : 'líneas de OC sin precio'}
          </Insignia>
        )}
        {c.lineas_sin_cambio > 0 && <Insignia tono="aviso">Dólares sin tipo de cambio</Insignia>}
      </p>
    </Link>
  )
}
