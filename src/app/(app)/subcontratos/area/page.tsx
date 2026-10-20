import { CalendarRange, ClipboardPen } from 'lucide-react'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { areasDeSubcontratos, subcontratosDelArea, type SubcontratoDelArea } from '@/lib/datos/subcontratos'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { ESTADO_SUBCONTRATO, estadoDeSubcontrato } from '@/lib/dominio/subcontratos'
import { cantidad, fecha, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Subcontratos de mi área' }

/** Días de `desde` a `hasta`, dos fechas `YYYY-MM-DD`, sin pasar por la hora local. */
function dias(desde: string, hasta: string) {
  const [a, b] = [desde, hasta].map((d) => {
    const [y, m, n] = d.slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, n)
  })
  return Math.round((b - a) / 86_400_000)
}

/** Dónde está el plazo hoy, en palabras del taller, y si ya se pasó. */
function plazo(s: SubcontratoDelArea, hoy: string): { texto: string; vencido: boolean } | null {
  if (s.estado !== 'VIGENTE') return null
  if (s.fecha_inicio && hoy < s.fecha_inicio) {
    const n = dias(hoy, s.fecha_inicio)
    return { texto: n === 1 ? 'Empieza mañana' : `Empieza en ${n} días`, vencido: false }
  }
  if (!s.fecha_fin) return null
  const n = dias(hoy, s.fecha_fin)
  if (n < 0) return { texto: `Se pasó del fin ${n === -1 ? 'por un día' : `por ${-n} días`}`, vencido: true }
  if (s.fecha_inicio) {
    const total = dias(s.fecha_inicio, s.fecha_fin) + 1
    return { texto: `Día ${dias(s.fecha_inicio, hoy) + 1} de ${total}`, vencido: false }
  }
  return { texto: n === 0 ? 'Termina hoy' : n === 1 ? 'Termina mañana' : `Faltan ${n} días`, vencido: false }
}

/**
 * Los subcontratos que Administración registró para el área del supervisor
 * (Maestranza, Producción o Acabados), por código interno: quién hace el
 * trabajo, qué es, su inicio, su fin y en cuánto va según lo que el área
 * reportó en el reporte diario. Sin montos ni recibos: DKS lo pidió así el
 * 2026-10-20 («no visualizarán dinero, solo su etapa de inicio y fin donde
 * tendrán que reportar cuál es su progreso»), y la base no se los da. El avance
 * se reporta en el reporte diario, sobre el subcontrato: de ahí el botón. Con
 * `produccion.cualquier_area`, los de las tres áreas.
 */
export default async function PaginaSubcontratosDelArea({ searchParams }: PageProps<'/subcontratos/area'>) {
  const perfil = await exigirPermiso('subcontratos.area')
  const params = await searchParams
  const texto = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '')
  const buscado = texto(params.codigo).trim()
  const estado = texto(params.estado) === 'TERMINADO' || texto(params.estado) === 'todos' ? texto(params.estado) : 'VIGENTE'
  const hoy = hoyLima()

  const [subcontratos, areas] = await Promise.all([subcontratosDelArea(), areasDeSubcontratos()])
  const todasLasAreas = puede(perfil, 'produccion.cualquier_area')
  const reporta = puede(perfil, 'reporte_diario.registrar')
  const nombreDeMiArea = areas.find((a) => a.id === perfil.area_id)?.nombre
  const deQuien = todasLasAreas ? 'Maestranza, Producción y Acabados' : (nombreDeMiArea ?? 'tu área')

  // El código se compara como en «Códigos internos»: sin mayúsculas, espacios ni signos, y O igual a 0.
  const llave = llaveParecido(buscado)
  const visibles = subcontratos.filter(
    (s) => (estado === 'todos' || s.estado === estado) && (!buscado || llaveParecido(s.codigo_interno).includes(llave)),
  )
  const cuenta = (e: string) => subcontratos.filter((s) => s.estado === e).length
  const codigos = [...new Set(visibles.map((s) => s.codigo_interno))]

  return (
    <>
      <EncabezadoPagina
        titulo="Subcontratos"
        ayuda={`Los trabajos que Administración le encargó a gente de fuera para ${deQuien}, por código interno: quién lo hace, su inicio, su fin y en cuánto va. El avance lo reportas en el reporte diario, eligiendo el subcontrato en «Sobre qué». Los montos los lleva Administración.`}
        migas={[{ titulo: 'Supervisión' }, { titulo: 'Subcontratos' }]}
      />

      <div className="mb-4 space-y-3">
        <BuscadorSimple ruta="/subcontratos/area" clave="codigo" etiqueta="Buscar por código interno" marcador="Código interno, por ejemplo SR_04" />
        <PastillaFiltro
          ruta="/subcontratos/area"
          clave="estado"
          etiqueta="Estado"
          opciones={[
            { valor: null, etiqueta: `Vigentes (${cantidad(cuenta('VIGENTE'))})` },
            { valor: 'TERMINADO', etiqueta: `Terminados (${cantidad(cuenta('TERMINADO'))})` },
            { valor: 'todos', etiqueta: 'Todos' },
          ]}
          params={params}
          activo={estado === 'VIGENTE' ? null : estado}
        />
      </div>

      {codigos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto" data-sin-subcontratos>
              {buscado
                ? `Ningún subcontrato de ${todasLasAreas ? 'las áreas' : 'tu área'} lleva el código ${buscado}`
                : estado === 'VIGENTE'
                  ? `No hay subcontratos vigentes para ${deQuien}`
                  : estado === 'TERMINADO'
                    ? 'Ningún subcontrato terminado todavía'
                    : `No hay subcontratos para ${deQuien}`}
            </p>
            <p className="text-sm text-texto-suave">
              {buscado
                ? 'Revisa cómo está escrito o borra la búsqueda para ver todos.'
                : 'Cuando Administración registre uno para tu área te llega el aviso, y aparece aquí con su código interno.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-4">
          {codigos.map((codigo) => {
            const deCodigo = visibles.filter((s) => s.codigo_interno === codigo)
            const vigentes = deCodigo.filter((s) => s.estado === 'VIGENTE').length
            return (
              <li key={codigo}>
                <Tarjeta className="overflow-hidden" data-codigo={codigo}>
                  <TarjetaCabecera
                    titulo={<span className="font-mono break-all">{codigo}</span>}
                    descripcion={deCodigo.length === 1 ? 'Un subcontrato' : `${deCodigo.length} subcontratos`}
                    acciones={
                      reporta &&
                      vigentes > 0 && (
                        <EnlaceBoton href={`/reportes-diarios/nuevo?codigo=${encodeURIComponent(codigo)}`} variante="secundario" tamano="sm">
                          <ClipboardPen aria-hidden className="size-4" />
                          Reportar avance
                        </EnlaceBoton>
                      )
                    }
                  />
                  <ul className="divide-y divide-borde">
                    {deCodigo.map((s) => (
                      <Subcontrato key={s.id} s={s} hoy={hoy} conArea={todasLasAreas} />
                    ))}
                  </ul>
                </Tarjeta>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function Subcontrato({ s, hoy, conArea }: { s: SubcontratoDelArea; hoy: string; conArea: boolean }) {
  const def = ESTADO_SUBCONTRATO[estadoDeSubcontrato(s.estado)]
  const p = plazo(s, hoy)
  return (
    <li className="space-y-3 px-4 py-3" data-subcontrato={s.numero}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-texto">
            <span className="tabular font-semibold">{s.numero}</span> · {s.subcontratista}
            {conArea && <span className="text-texto-suave"> · {s.area_nombre}</span>}
          </p>
          <p className="text-sm whitespace-pre-line text-texto-suave">{s.descripcion}</p>
        </div>
        <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-[repeat(3,minmax(0,1fr))]">
        <div>
          <dt className="text-xs text-texto-suave">Inicio</dt>
          <dd className="tabular text-texto">{s.fecha_inicio ? fecha(s.fecha_inicio) : 'Sin fecha'}</dd>
        </div>
        <div>
          <dt className="text-xs text-texto-suave">{s.terminado_en ? 'Terminó' : 'Fin'}</dt>
          <dd className="tabular text-texto">
            {s.terminado_en ? fecha(s.terminado_en) : s.fecha_fin ? fecha(s.fecha_fin) : 'Sin fecha'}
          </dd>
        </div>
        {p && (
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-texto-suave">Plazo</dt>
            <dd className={p.vencido ? 'font-medium text-peligro' : 'text-texto'} data-plazo>
              <CalendarRange aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
              {p.texto}
            </dd>
          </div>
        )}
      </dl>

      <div className="space-y-1" data-avance={s.avance ?? ''}>
        <Progreso valor={s.avance} mostrarValor etiqueta={`Avance de ${s.numero}`} />
        <p className="text-xs text-texto-suave">
          {s.estado === 'TERMINADO'
            ? 'Administración lo dio por terminado.'
            : s.avance === null
              ? 'Todavía nadie reportó su avance.'
              : `Último avance reportado el ${fecha(s.ultimo_reporte)}${s.reportes > 1 ? `, en ${s.reportes} reportes` : ''}.`}
        </p>
      </div>
    </li>
  )
}
