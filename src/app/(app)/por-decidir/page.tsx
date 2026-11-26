import { BadgeCheck, ClipboardCheck, FilePenLine, Lock, Truck, Wallet } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Indicador, tramos } from '@/components/ui/indicador'
import { AccionesDeFila, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { PERMISOS_POR_DECIDIR, porDecidir, type ClaveGrupo, type GrupoPorDecidir } from '@/lib/datos/por-decidir'
import { haceDias } from '@/lib/dominio/recorrido'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Por decidir' }

const ICONOS: Record<ClaveGrupo, typeof FilePenLine> = {
  cotizaciones: FilePenLine,
  compras: BadgeCheck,
  pagos: Wallet,
  reportes: ClipboardCheck,
  trabajos: Truck,
  cierres: Lock,
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Lo que más espera de un grupo: su primera fila con días, que ya viene la más antigua. */
const masAntigua = (g: GrupoPorDecidir) => g.filas.find((f) => f.dias !== null)?.dias ?? null

/**
 * Lo que espera a Gerencia, reunido (plan 12, entrega 12.1). No se aprueba aquí:
 * cada fila salta a la pantalla donde vive la regla de esa decisión. Se suma a
 * las pantallas de siempre, no las reemplaza.
 */
export default async function PaginaPorDecidir() {
  const perfil = await exigirPermiso(PERMISOS_POR_DECIDIR)
  const { grupos, diasSinLeer } = await porDecidir(perfil)

  const total = grupos.reduce((n, g) => n + g.filas.length, 0)
  const sinLeer = grupos.filter((g) => g.sinLeer)
  const conAlgo = grupos.filter((g) => g.filas.length > 0 || g.sinLeer)
  const antiguas = grupos.map(masAntigua).filter((d): d is number => d !== null)
  const mayor = antiguas.length ? Math.max(...antiguas) : null

  const descripcion =
    sinLeer.length > 0
      ? `${total > 0 ? `${plural(total, 'documento espera', 'documentos esperan')} tu decisión, y ` : ''}${plural(sinLeer.length, 'grupo no se pudo leer', 'grupos no se pudieron leer')}.`
      : total === 0
        ? 'Nada espera tu decisión.'
        : `${plural(total, 'documento espera', 'documentos esperan')} tu decisión${mayor !== null ? `; el más antiguo, ${haceDias(mayor)}` : ''}.`

  return (
    <>
      <EncabezadoPagina
        titulo="Por decidir"
        descripcion={descripcion}
        ayuda="Lo que espera tu decisión en cotizaciones, compras y servicios, pagos, reportes diarios, trabajos sin orden y cierre de códigos, lo más antiguo primero. Aquí no se aprueba: cada fila abre su pantalla, donde se decide con su regla de siempre."
      />

      <div className="space-y-5">
        <nav aria-label="Grupos por decidir" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {grupos.map((g) => {
            const dias = masAntigua(g)
            return (
              <Indicador
                key={g.clave}
                titulo={g.corto}
                icono={ICONOS[g.clave]}
                valor={g.sinLeer ? '—' : g.filas.length}
                tono={g.sinLeer ? 'aviso' : g.filas.length > 0 ? 'acento' : 'neutro'}
                pie={g.sinLeer ? 'No se pudo leer' : g.filas.length === 0 ? 'Al día' : dias !== null ? `el más antiguo, ${haceDias(dias)}` : undefined}
                href={g.filas.length > 0 || g.sinLeer ? `#${g.clave}` : g.pantalla.ruta}
              />
            )
          })}
        </nav>

        {diasSinLeer && (
          <p role="status" className="text-xs text-aviso">
            No se pudieron contar los días en espera: la lista va por fecha, sin el número de días.
          </p>
        )}

        {conAlgo.length === 0 ? (
          <Tarjeta>
            <SinDatos
              enTabla={false}
              titulo="Nada espera tu decisión"
              descripcion="Cuando Ventas suba una cotización, Logística pida aprobar una compra o un supervisor suba su reporte, aparece aquí con los días que lleva esperando."
            />
          </Tarjeta>
        ) : (
          conAlgo.map((g) => <Grupo key={g.clave} g={g} />)
        )}
      </div>
    </>
  )
}

function Grupo({ g }: { g: GrupoPorDecidir }) {
  const dias = masAntigua(g)
  return (
    <section id={g.clave} aria-labelledby={`titulo-${g.clave}`} className="scroll-mt-20">
      <Tarjeta className="overflow-hidden" data-grupo-por-decidir={g.clave} data-cantidad={g.filas.length}>
        <TarjetaCabecera
          titulo={<span id={`titulo-${g.clave}`}>{g.titulo}</span>}
          descripcion={
            g.sinLeer
              ? 'No se pudo leer: abre su pantalla para verlo.'
              : `${g.filas.length}${dias !== null ? ` · el más antiguo, ${haceDias(dias)}` : ''}`
          }
          acciones={
            <EnlaceBoton href={g.pantalla.ruta} variante="contorno" tamano="sm">
              Abrir {g.pantalla.titulo}
            </EnlaceBoton>
          }
        />
        {g.sinLeer ? (
          <p role="status" className="px-4 py-3 text-sm text-aviso" data-sin-leer={g.clave}>
            No se pudo leer lo que espera aquí. Recarga la página; si continúa, ábrelo desde su pantalla y avisa al administrador.
          </p>
        ) : (
          <Tabla apilada>
            <TablaCabecera>
              <tr>
                <TH>Qué es</TH>
                <TH className="md:w-64">Quién lo pide</TH>
                <TH className="md:w-36">Espera</TH>
                <TH className="md:w-52">
                  <span className="sr-only">Abrir</span>
                </TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {g.filas.map((f) => (
                <TR key={f.id} data-por-decidir={f.id}>
                  <TD>
                    <p className="font-medium text-texto">{f.que}</p>
                    {f.detalle && <p className="text-xs text-texto-suave">{tramos(f.detalle)}</p>}
                    {/* En el teléfono, quién y cuánto en un renglón: apilados, cada fila medía cuatro. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 md:hidden">
                      {f.quien && <span className="text-xs text-texto-suave">{f.quien}</span>}
                      <DiasEnEspera dias={f.dias} desde={f.desde} quien="Gerencia" />
                    </div>
                  </TD>
                  <TD className="hidden text-texto-suave md:table-cell">{f.quien ?? '—'}</TD>
                  <TD className="hidden md:table-cell">
                    {f.dias !== null ? <DiasEnEspera dias={f.dias} desde={f.desde} quien="Gerencia" /> : <span className="text-xs text-texto-suave">—</span>}
                  </TD>
                  <TD>
                    <AccionesDeFila>
                      <EnlaceBoton href={f.ruta} variante="contorno" tamano="sm" aria-label={`${g.accion}: ${f.que}`}>
                        {g.accion}
                      </EnlaceBoton>
                    </AccionesDeFila>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
    </section>
  )
}
