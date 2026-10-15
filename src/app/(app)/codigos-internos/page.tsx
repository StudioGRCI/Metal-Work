import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { LineaDeDiseno } from '@/components/codigo-interno/linea-diseno'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { avanceDeLosCodigos, listarCodigosInternos, sumarCodigosDeDiseno, type AvanceDeCodigo, type ResumenCodigo } from '@/lib/datos/codigos-internos'
import { codigosDeDiseno, type CodigoDeDiseno } from '@/lib/datos/diseno-codigos'
import {
  CODIGO_SIN_AVANCE,
  costoDelCodigo,
  dondeAparece,
  enlaceCodigo,
  faltaElPrecio,
  llaveParecido,
  origenDelAvance,
  parecidos,
} from '@/lib/dominio/codigos-internos'
import { horasCortas } from '@/lib/dominio/rrhh'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Códigos internos' }

const tieneCosto = (c: ResumenCodigo) => {
  const costo = costoDelCodigo(c)
  return costo.pen + costo.usd > 0
}
const porCompletar = (c: ResumenCodigo) => c.horas_sin_costo > 0 || c.materiales_sin_precio > 0 || c.compras_sin_precio > 0

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
  const filtro = typeof params.ver === 'string' && params.ver in FILTROS ? params.ver : null

  const [conDocumentos, deDiseno, avances] = await Promise.all([listarCodigosInternos(), codigosDeDiseno(), avanceDeLosCodigos()])
  // Un código puede tener planos o etapas de Diseño antes que cualquier documento.
  const todos = sumarCodigosDeDiseno(conDocumentos, deDiseno)
  const diseno = new Map(deDiseno.map((d) => [d.codigo, d]))
  // Los parecidos se buscan entre todos, no solo entre los que deja la búsqueda.
  const parecidosDe = parecidos(todos.map((c) => c.codigo))
  const llave = llaveParecido(q)
  const buscados = q ? todos.filter((c) => c.codigo.includes(q.toUpperCase()) || (llave && llaveParecido(c.codigo).includes(llave))) : todos
  const cuantos = (clave: string) => buscados.filter((c) => FILTROS[clave](c, parecidosDe.has(c.codigo))).length
  const codigos = filtro ? buscados.filter((c) => FILTROS[filtro](c, parecidosDe.has(c.codigo))) : buscados

  const costo = codigos.reduce((n, c) => n + costoDelCodigo(c).pen, 0)
  const dolares = codigos.reduce((n, c) => n + costoDelCodigo(c).usd, 0)
  const horas = codigos.reduce((n, c) => n + c.horas, 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Códigos internos"
        descripcion="Cada código interno que aparece en el sistema —reportes diarios, horas de RR. HH., salidas del almacén, requerimientos, compras, órdenes de servicio, subcontratos, unidades e ingresos a la planta— con cómo va y lo que lleva costado. El avance es el promedio de las etapas que arma Diseño: la terminada vale 100 % y la que no, lo que su área reporta en el reporte diario; sin etapas, sale del reporte diario. El costo suma la mano de obra, los materiales que salieron del almacén, las órdenes de servicio aprobadas y los recibos por honorarios de los subcontratos; las compras se muestran aparte y no se suman, porque lo comprado se cuenta cuando sale del almacén."
        migas={[{ titulo: 'Códigos internos' }]}
      />

      <div className="mb-3 space-y-3">
        <BuscadorSimple ruta="/codigos-internos" etiqueta="Buscar código interno" marcador="Busca por código, por ejemplo SR_04" />
        <PastillaFiltro
          ruta="/codigos-internos"
          clave="ver"
          params={params}
          activo={filtro}
          etiqueta="Qué códigos mostrar"
          opciones={[
            { valor: null, etiqueta: `Todos (${buscados.length})` },
            { valor: 'reportes', etiqueta: `Con reporte diario (${cuantos('reportes')})` },
            { valor: 'costo', etiqueta: `Con costo (${cuantos('costo')})` },
            { valor: 'parecidos', etiqueta: `Parecidos a otro (${cuantos('parecidos')})` },
            { valor: 'por-completar', etiqueta: `Sin precio o sin costo (${cuantos('por-completar')})` },
          ]}
        />
        <p className="text-xs text-texto-suave">
          <span className="tabular">{codigos.length}</span> {codigos.length === 1 ? 'código' : 'códigos'} ·{' '}
          <span className="tabular">{moneda(costo)}</span>
          {dolares > 0 && (
            <>
              {' '}
              + <span className="tabular">{moneda(dolares, 'USD')}</span>
            </>
          )}{' '}
          costados · <span className="tabular">{horasCortas(horas)}</span> de personal
        </p>
      </div>

      {codigos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              {todos.length === 0 ? 'Todavía no hay códigos internos' : 'Ningún código con esta búsqueda o filtro'}
            </p>
            <p className="text-sm text-texto-suave">
              {todos.length === 0
                ? 'Aparecen aquí apenas un requerimiento, una salida del almacén, un reporte diario o una carga de horas lleva uno.'
                : 'Borra la búsqueda con «Limpiar» o quita el filtro con «Todos».'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {codigos.map((c) => (
            <li key={c.codigo}>
              <FilaCodigo codigo={c} parecidos={parecidosDe.get(c.codigo) ?? []} diseno={diseno.get(c.codigo)} avance={avances.get(c.codigo)} />
            </li>
          ))}
        </ul>
      )}
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
  return (
    <Link
      href={enlaceCodigo(c.codigo)}
      className="block rounded-[var(--radius-base)] border border-borde bg-superficie p-4 hover:border-acento"
      data-codigo={c.codigo}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono font-semibold break-all text-texto">{c.codigo}</p>
          {diseno?.unidad && <p className="text-xs text-texto">{diseno.unidad}</p>}
          <p className="text-xs text-texto-suave">{dondeAparece(c, diseno)}</p>
        </div>
        <div className="text-right">
          <p className="tabular font-semibold text-texto">
            {faltaElPrecio(costo.pen + costo.usd, c.materiales_sin_precio + c.horas_sin_costo) ?? moneda(costo.pen)}
          </p>
          {costo.usd > 0 && <p className="tabular text-xs text-texto">+ {moneda(costo.usd, 'USD')}</p>}
          <p className="text-[11px] text-texto-suave">costo hasta hoy</p>
        </div>
      </div>

      {parecidos.length > 0 && (
        <p className="mt-1 text-xs text-aviso">
          Se escribe casi igual que <span className="font-mono">{parecidos.join(', ')}</span>: ¿es el mismo código?
        </p>
      )}

      <div className="mt-2">
        <LineaDeDiseno d={diseno} />
      </div>

      {c.codigo === CODIGO_SIN_AVANCE ? (
        <p className="mt-2 text-xs text-texto-suave">{origenDelAvance(c.codigo, avance)}.</p>
      ) : (
        <div className="mt-2 grid grid-cols-[1fr_6.5rem] items-center gap-3 text-xs" data-avance={avance?.avance ?? 0}>
          <span className={avance ? 'text-texto' : 'text-texto-suave'}>
            {origenDelAvance(c.codigo, avance)}
            {c.ultimo_reporte && <span className="text-texto-suave"> · último reporte el {fecha(c.ultimo_reporte)}</span>}
          </span>
          <Progreso valor={avance?.avance ?? 0} alto="sm" mostrarValor etiqueta={`Avance de ${c.codigo}`} />
        </div>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texto-suave">
        <span>
          Mano de obra <span className="tabular text-texto">{faltaElPrecio(c.mano_obra, c.horas_sin_costo, 'sin costo') ?? moneda(c.mano_obra)}</span>
          {c.horas > 0 && <span className="tabular"> ({horasCortas(c.horas)})</span>}
        </span>
        <span>
          Materiales{' '}
          <span className="tabular text-texto">
            {faltaElPrecio(c.materiales_pen + c.materiales_usd, c.materiales_sin_precio, 'sin precio') ?? moneda(c.materiales_pen)}
          </span>
          {c.materiales_usd > 0 && <span className="tabular text-texto"> + {moneda(c.materiales_usd, 'USD')}</span>}
        </span>
        {(c.servicios_pen > 0 || c.servicios_usd > 0) && (
          <span>
            Servicios <span className="tabular text-texto">{moneda(c.servicios_pen)}</span>
            {c.servicios_usd > 0 && <span className="tabular text-texto"> + {moneda(c.servicios_usd, 'USD')}</span>}
          </span>
        )}
        {(c.subcontratos_pen > 0 || c.subcontratos_usd > 0) && (
          <span>
            Subcontratos <span className="tabular text-texto">{moneda(c.subcontratos_pen)}</span>
            {c.subcontratos_usd > 0 && <span className="tabular text-texto"> + {moneda(c.subcontratos_usd, 'USD')}</span>}
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
      </p>
    </Link>
  )
}
