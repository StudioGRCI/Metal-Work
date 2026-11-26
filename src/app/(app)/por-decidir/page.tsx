import { BadgeCheck, FilePenLine, Hammer, Lock, NotebookPen, Stamp, Wallet } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Indicador, tramos } from '@/components/ui/indicador'
import { AccionesDeFila, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { porDecidir, type ClaveGrupo, type GrupoPorDecidir } from '@/lib/datos/por-decidir'
import { haceDias } from '@/lib/dominio/recorrido'
import { fecha } from '@/lib/format'
import { PERMISOS_POR_DECIDIR } from '@/lib/navegacion'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Por decidir' }

const ICONOS: Record<ClaveGrupo, typeof FilePenLine> = {
  cotizaciones: FilePenLine,
  compras: BadgeCheck,
  pagos: Wallet,
  reportes: NotebookPen,
  trabajos: Hammer,
  cierres: Lock,
  tramites: Stamp,
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Lo que más espera de un grupo: su primera fila con días, que ya viene la más antigua. */
const masAntigua = (g: GrupoPorDecidir) => (g.aparte ? null : (g.filas.find((f) => f.dias !== null)?.dias ?? null))

/**
 * Lo que espera a Gerencia, reunido (plan 12, entrega 12.1). No se aprueba aquí:
 * cada fila salta a la pantalla donde vive la regla de esa decisión. Se suma a
 * las pantallas de siempre, no las reemplaza.
 */
export default async function PaginaPorDecidir() {
  const perfil = await exigirPermiso(PERMISOS_POR_DECIDIR)
  const { grupos, diasSinLeer } = await porDecidir(perfil)

  // Las facturas detenidas se resuelven aprobando su OC, que ya cuenta: van aparte.
  const decisiones = grupos.filter((g) => !g.aparte)
  const total = decisiones.reduce((n, g) => n + g.filas.length, 0)
  const detenidas = grupos.filter((g) => g.aparte).reduce((n, g) => n + g.filas.length, 0)
  const sinLeer = grupos.filter((g) => g.sinLeer)
  const conAlgo = grupos.filter((g) => g.filas.length > 0 || g.sinLeer || g.nota)
  const antiguas = decisiones.map(masAntigua).filter((d): d is number => d !== null)
  const mayor = antiguas.length ? Math.max(...antiguas) : null

  const porDetenidas = detenidas > 0 ? ` ${plural(detenidas, 'factura espera', 'facturas esperan')} una de esas compras para pagarse.` : ''
  const descripcion =
    sinLeer.length > 0
      ? `${total > 0 ? `${plural(total, 'decisión espera', 'decisiones esperan')} tu visto, y ` : ''}${plural(sinLeer.length, 'grupo no se pudo leer', 'grupos no se pudieron leer')}.${porDetenidas}`
      : total === 0
        ? `Nada espera tu decisión.${porDetenidas}`
        : `${plural(total, 'decisión te espera', 'decisiones te esperan')}${mayor !== null ? `; la más antigua, ${haceDias(mayor)}` : ''}.${porDetenidas}`

  return (
    <>
      <EncabezadoPagina
        titulo="Por decidir"
        descripcion={descripcion}
        acciones={
          <EnlaceBoton href="/por-decidir/decisiones" variante="contorno" tamano="sm">
            Decisiones tomadas
          </EnlaceBoton>
        }
        ayuda="Lo que espera tu decisión en cotizaciones, compras y servicios, pagos, reportes diarios, trabajos sin orden, cierre de códigos y anulación de trámites, lo más antiguo primero. Aquí no se aprueba: cada fila abre su pantalla, donde se decide con su regla de siempre."
      />

      <div className="space-y-5">
        {/* Con un solo grupo, las cifras repetirían su tarjeta. En el teléfono, una fila de enlaces cortos:
            seis tarjetas de cifras dejaban la primera fila fuera de la pantalla. */}
        {grupos.length > 1 && (
          <>
            <nav aria-label="Grupos por decidir" className="flex flex-wrap gap-2 md:hidden">
              {grupos.map((g) => (
                <Link
                  key={g.clave}
                  href={g.filas.length > 0 || g.sinLeer || g.nota ? `#${g.clave}` : g.pantalla.ruta}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-base)] border border-borde-fuerte bg-superficie px-3 text-sm text-texto"
                >
                  {g.corto}
                  <span className={g.filas.length > 0 ? 'tabular font-semibold text-acento' : 'tabular text-texto-suave'}>
                    {g.sinLeer ? '—' : g.filas.length}
                  </span>
                </Link>
              ))}
            </nav>
            {/* Con siete grupos, en el monitor ancho van cuatro por fila: de a tres, el último quedaba solo. */}
            <nav aria-label="Grupos por decidir" className={`hidden grid-cols-3 gap-3 md:grid ${grupos.length > 6 ? 'xl:grid-cols-4' : ''}`}>
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
                    href={g.filas.length > 0 || g.sinLeer || g.nota ? `#${g.clave}` : g.pantalla.ruta}
                  />
                )
              })}
            </nav>
          </>
        )}

        {diasSinLeer && (
          <p role="status" className="text-xs text-aviso">
            No se pudieron contar los días en espera: la lista va por fecha, sin el número de días.
          </p>
        )}

        {conAlgo.length === 0 ? (
          <Tarjeta>
            <SinDatos
              enTabla={false}
              titulo="Al día"
              descripcion="Cuando algo espere tu decisión, aparece aquí con los días que lleva esperando."
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
              ? undefined
              : `${g.filas.length} ${g.filas.length === 1 ? g.cuenta.uno : g.cuenta.varios}${dias !== null ? ` · el más antiguo, ${haceDias(dias)}` : ''}`
          }
          acciones={
            <EnlaceBoton href={g.pantalla.ruta} variante="contorno" tamano="sm" aria-label={`Abrir ${g.pantalla.titulo}`}>
              Ver la lista
            </EnlaceBoton>
          }
        />
        {g.sinLeer ? (
          <p role="status" className="px-4 py-3 text-sm text-aviso" data-sin-leer={g.clave}>
            No se pudo leer lo que espera aquí. Recarga la página; si continúa, ábrelo desde su pantalla y avisa al administrador.
          </p>
        ) : g.filas.length === 0 ? null : (
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
                      <Espera g={g} dias={f.dias} desde={f.desde} />
                    </div>
                  </TD>
                  <TD className="hidden text-texto-suave md:table-cell">{f.quien ?? '—'}</TD>
                  <TD className="hidden md:table-cell">
                    <Espera g={g} dias={f.dias} desde={f.desde} />
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
        {g.nota && (
          <p className="border-t border-borde px-4 py-3 text-xs text-texto-suave" data-nota-del-grupo={g.clave}>
            {g.nota}
          </p>
        )}
      </Tarjeta>
    </section>
  )
}

/**
 * Cuánto lleva esperando. Sin días contados, la fecha desde la que espera. La
 * factura detenida no espera a Gerencia desde que se emitió (pudo registrarse
 * semanas después): dice su fecha de emisión, sin días a nombre de nadie.
 */
function Espera({ g, dias, desde }: { g: GrupoPorDecidir; dias: number | null; desde: string | null }) {
  if (g.aparte) return <span className="tabular text-xs text-texto-suave">{desde ? `emitida el ${fecha(desde)}` : '—'}</span>
  if (dias !== null) return <DiasEnEspera dias={dias} desde={desde} quien="Gerencia" />
  return <span className="tabular text-xs text-texto-suave">{desde ? `desde el ${fecha(desde)}` : '—'}</span>
}
