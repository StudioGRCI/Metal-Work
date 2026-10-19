import { Search } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Boton } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { areasDeSubcontratos, subcontratosDeMiArea, type SubcontratoDelArea } from '@/lib/datos/subcontratos'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { ESTADO_RECIBO, ESTADO_SUBCONTRATO, estadoDeSubcontrato } from '@/lib/dominio/subcontratos'
import { fecha } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Subcontratos de mi área' }

/**
 * Los subcontratos que Administración registró para el área del supervisor,
 * Producción o Acabados (migración 20261017100000), por código interno: quién
 * hace el trabajo, qué trabajo es, en qué va y sus recibos por honorarios, con
 * la fecha y si ya se pagaron. Sin montos: lo pactado y lo pagado son de
 * Administración, Tesorería, Gerencia y Contabilidad, y la base no se los da.
 * Solo lectura. Con `produccion.cualquier_area`, los de las dos áreas.
 */
export default async function PaginaSubcontratosDelArea({ searchParams }: PageProps<'/subcontratos/area'>) {
  const perfil = await exigirPermiso('subcontratos.area')
  const params = await searchParams
  const texto = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '')
  const buscado = texto(params.codigo).trim()
  const estado = texto(params.estado) === 'TERMINADO' || texto(params.estado) === 'todos' ? texto(params.estado) : 'VIGENTE'

  const [subcontratos, areas] = await Promise.all([subcontratosDeMiArea(), areasDeSubcontratos()])
  const todasLasAreas = puede(perfil, 'produccion.cualquier_area')
  // Maestranza no recibe subcontratos: se lo decimos en vez de dejarle una lista vacía sin explicación.
  const recibe = todasLasAreas || areas.some((a) => a.id === perfil.area_id)
  const nombreDeMiArea = areas.find((a) => a.id === perfil.area_id)?.nombre

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
        ayuda={
          recibe
            ? `Los trabajos que Administración le encargó a gente de fuera para ${todasLasAreas ? 'Producción y Acabados' : (nombreDeMiArea ?? 'tu área')}, por código interno: quién lo hace, en qué va y sus recibos por honorarios. Solo para consultar; los montos los lleva Administración.`
            : 'Los trabajos que Administración le encarga a gente de fuera, por código interno, van a Producción o a Acabados.'
        }
        migas={[{ titulo: 'Supervisión' }, { titulo: 'Subcontratos' }]}
      />

      {!recibe ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto" data-sin-subcontratos>
              Tu área no recibe subcontratos
            </p>
            <p className="text-sm text-texto-suave">
              Administración registra cada subcontrato para Producción o para Acabados, y lo ve el supervisor de esa área. Si un trabajo de fuera
              es para tu área, pídele a Administración que lo registre para el área que lo va a recibir.
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <PastillaFiltro
              ruta="/subcontratos/area"
              clave="estado"
              etiqueta="Estado"
              opciones={[
                { valor: null, etiqueta: `Vigentes (${cuenta('VIGENTE')})` },
                { valor: 'TERMINADO', etiqueta: `Terminados (${cuenta('TERMINADO')})` },
                { valor: 'todos', etiqueta: 'Todos' },
              ]}
              params={params}
              activo={estado === 'VIGENTE' ? null : estado}
            />
            <form className="flex max-w-md flex-1 gap-2" role="search">
              {estado !== 'VIGENTE' && <input type="hidden" name="estado" value={estado} />}
              <Entrada name="codigo" defaultValue={buscado} placeholder="Código interno, por ejemplo PLA_SR_O4_1_26/28" aria-label="Buscar por código interno" />
              <Boton type="submit" variante="secundario">
                <Search aria-hidden className="size-4" />
                Buscar
              </Boton>
            </form>
          </div>

          {codigos.length === 0 ? (
            <Tarjeta>
              <TarjetaCuerpo>
                <p className="text-sm font-medium text-texto" data-sin-subcontratos>
                  {buscado
                    ? `Ningún subcontrato de ${todasLasAreas ? 'Producción o Acabados' : 'tu área'} lleva el código ${buscado}`
                    : estado === 'VIGENTE'
                      ? `No hay subcontratos vigentes para ${todasLasAreas ? 'Producción ni Acabados' : 'tu área'}`
                      : 'No hay subcontratos aquí'}
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
                return (
                  <li key={codigo}>
                    <Tarjeta className="overflow-hidden" data-codigo={codigo}>
                      <TarjetaCabecera
                        titulo={<span className="font-mono break-all">{codigo}</span>}
                        descripcion={deCodigo.length === 1 ? 'Un subcontrato' : `${deCodigo.length} subcontratos`}
                      />
                      <ul className="divide-y divide-borde">
                        {deCodigo.map((s) => (
                          <Subcontrato key={s.id} s={s} conArea={todasLasAreas} />
                        ))}
                      </ul>
                    </Tarjeta>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </>
  )
}

function Subcontrato({ s, conArea }: { s: SubcontratoDelArea; conArea: boolean }) {
  const def = ESTADO_SUBCONTRATO[estadoDeSubcontrato(s.estado)]
  return (
    <li className="space-y-2 px-4 py-3" data-subcontrato={s.numero}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-texto">
            <span className="tabular font-semibold">{s.numero}</span> · {s.subcontratista}
            {conArea && <span className="text-texto-suave"> · {s.area_nombre}</span>}
          </p>
          <p className="text-sm whitespace-pre-line text-texto-suave">{s.descripcion}</p>
          {(s.fecha_inicio || s.fecha_fin) && (
            <p className="text-xs text-texto-suave">
              {fecha(s.fecha_inicio)} → {fecha(s.fecha_fin)}
            </p>
          )}
          {s.terminado_en && <p className="text-xs text-texto-suave">Terminado el {fecha(s.terminado_en)}</p>}
        </div>
        <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
      </div>
      {s.recibos.length === 0 ? (
        <p className="text-xs text-texto-suave">Todavía no tiene recibos por honorarios.</p>
      ) : (
        <ul className="space-y-1" aria-label={`Recibos por honorarios de ${s.numero}`}>
          {s.recibos.map((r) => {
            const e = ESTADO_RECIBO[r.pagado ? 'PAGADO' : 'POR_PAGAR']
            return (
              <li key={r.numero} className="flex flex-wrap items-center gap-2 text-xs text-texto" data-recibo={r.numero}>
                <span className="tabular font-medium">Recibo {r.numero}</span>
                <span className="text-texto-suave">del {fecha(r.fecha_emision)}</span>
                {r.concepto && <span className="text-texto-suave">· {r.concepto}</span>}
                <Insignia tono={e.tono}>{e.etiqueta}</Insignia>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
