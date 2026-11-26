import { ChevronLeft, ChevronRight } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { SeleccionDeFiltro } from '@/components/estructura/seleccion-de-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { AccionesDeFila, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import {
  DECISION,
  DECISIONES,
  NOMBRE_DEL_TIPO,
  TIPOS_DE_DECISION,
  decisionesDelMes,
  type Decision,
  type TipoDecision,
} from '@/lib/datos/decisiones'
import { fechaHora, hoyLima, mesLargo } from '@/lib/format'
import { PERMISOS_POR_DECIDIR } from '@/lib/navegacion'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Decisiones tomadas' }

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/
/** Cuántos meses ofrece la lista del mes: dos años bastan para buscar una decisión. */
const MESES_EN_LA_LISTA = 24

/** El mes `YYYY-MM` que sigue (o el anterior, con -1). */
function otroMes(mes: string, n: number) {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const mesCorto = (mes: string) => mesLargo(mes).replace(/ de \d{4}$/, '')

/**
 * Lo que Gerencia ya decidió (plan 12, entrega 12.2), en lectura: qué documento,
 * de qué código, qué se decidió, cuándo y con qué motivo, mes por mes. No se
 * cambia nada aquí: cada fila abre su documento.
 */
export default async function PaginaDecisionesTomadas({ searchParams }: PageProps<'/por-decidir/decisiones'>) {
  // La misma puerta que «Por decidir», de donde se llega: es de la Gerencia General.
  await exigirPermiso(PERMISOS_POR_DECIDIR)
  const params = await searchParams

  const esteMes = hoyLima().slice(0, 7)
  const pedido = typeof params.mes === 'string' && MES.test(params.mes) ? params.mes : esteMes
  // Un mes que todavía no empieza no tiene decisiones: se queda en el de hoy.
  const mes = pedido > esteMes ? esteMes : pedido
  const tipo = (TIPOS_DE_DECISION as readonly string[]).includes(String(params.tipo)) ? (params.tipo as TipoDecision) : null
  const decision = (DECISIONES as string[]).includes(String(params.decision)) ? (params.decision as Decision) : null

  const todas = await decisionesDelMes(mes)
  // Cada grupo de pastillas cuenta con el otro filtro puesto: el número dice lo que sale al tocarla.
  const delTipo = tipo ? todas.filter((f) => f.tipo === tipo) : todas
  const deLaDecision = decision ? todas.filter((f) => f.decision === decision) : todas
  const filas = decision ? delTipo.filter((f) => f.decision === decision) : delTipo
  const deTipo = (t: TipoDecision) => deLaDecision.filter((f) => f.tipo === t).length
  const deDecision = (d: Decision) => delTipo.filter((f) => f.decision === d).length
  const decisionesConAlgo = DECISIONES.filter((d) => deDecision(d) > 0 || d === decision)

  const anterior = otroMes(mes, -1)
  const siguiente = mes < esteMes ? otroMes(mes, 1) : null
  const conMes = (m: string) =>
    `/por-decidir/decisiones?${new URLSearchParams({ mes: m, ...(tipo ? { tipo } : {}), ...(decision ? { decision } : {}) })}`
  const meses = Array.from({ length: MESES_EN_LA_LISTA }, (_, i) => otroMes(esteMes, -i))
  if (!meses.includes(mes)) meses.push(mes)
  const filtrado = Boolean(tipo || decision)
  // Lo que estorba cuando el filtro deja la lista vacía, dicho con sus palabras.
  // «ninguna devolución de compras», «ningún visto bueno», «ninguna decisión de reportes diarios».
  const loQueFiltra = `${decision === 'VISTO' || decision === 'CERRADO' ? 'ningún' : 'ninguna'} ${decision ? DECISION[decision].etiqueta.toLowerCase() : 'decisión'}${tipo && tipo !== 'CIERRE_CODIGO' ? ` de ${NOMBRE_DEL_TIPO[tipo].varios.toLowerCase()}` : ''}`

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Por decidir', ruta: '/por-decidir' }, { titulo: 'Decisiones tomadas' }]}
        titulo="Decisiones tomadas"
        descripcion={
          todas.length === 0
            ? `Sin decisiones en ${mesLargo(mes)}.`
            : `${plural(todas.length, 'decisión', 'decisiones')} en ${mesLargo(mes)}, la más reciente primero.`
        }
        ayuda="Lo que tu puesto aprobó, devolvió, anuló, dio por visto o cerró, con la fecha y el motivo. Es solo lectura: cada fila abre su documento. Las listas de cotizaciones, compras y servicios cargan solo las más recientes (200 o 300): un documento de hace meses puede no salir al abrirlo."
        acciones={
          <div className="flex items-center gap-2" role="group" aria-label="Mes">
            <EnlaceBoton href={conMes(anterior)} variante="contorno" tamano="sm" aria-label={`Ver ${mesLargo(anterior)}`}>
              <ChevronLeft aria-hidden className="size-4" />
              <span className="capitalize">{mesCorto(anterior)}</span>
            </EnlaceBoton>
            {siguiente && (
              <EnlaceBoton href={conMes(siguiente)} variante="contorno" tamano="sm" aria-label={`Ver ${mesLargo(siguiente)}`}>
                <span className="capitalize">{mesCorto(siguiente)}</span>
                <ChevronRight aria-hidden className="size-4" />
              </EnlaceBoton>
            )}
          </div>
        }
      />

      <div className="space-y-5">
        <div className="space-y-3">
          <SeleccionDeFiltro
            etiqueta="Mes"
            className="sm:max-w-56"
            opciones={meses.map((m) => ({
              etiqueta: `${mesLargo(m).charAt(0).toUpperCase()}${mesLargo(m).slice(1)}`,
              href: conMes(m),
              activa: m === mes,
            }))}
          />
          {/* Con un filtro puesto, las pastillas se quedan aunque el mes no traiga nada: si no, no se podía quitar. */}
          {(todas.length > 0 || filtrado) && (
            <>
              <PastillaFiltro
                ruta="/por-decidir/decisiones"
                clave="tipo"
                params={params}
                activo={tipo}
                etiqueta="Tipo de documento"
                opciones={[
                  { valor: null, etiqueta: `Todos los documentos (${deLaDecision.length})` },
                  ...TIPOS_DE_DECISION.filter((t) => deTipo(t) > 0 || t === tipo).map((t) => ({
                    valor: t,
                    etiqueta: `${NOMBRE_DEL_TIPO[t].varios} (${deTipo(t)})`,
                  })),
                ]}
              />
              {/* Con una sola clase de decisión en lo que se ve, el grupo no filtra nada. */}
              {(decisionesConAlgo.length > 1 || decision) && (
                <PastillaFiltro
                  ruta="/por-decidir/decisiones"
                  clave="decision"
                  params={params}
                  activo={decision}
                  etiqueta="Decisión"
                  opciones={[
                    { valor: null, etiqueta: `Todas las decisiones (${delTipo.length})` },
                    ...decisionesConAlgo.map((d) => ({
                      valor: d,
                      etiqueta: `${DECISION[d].varias} (${deDecision(d)})`,
                    })),
                  ]}
                />
              )}
            </>
          )}
        </div>

        <Tarjeta className="overflow-hidden" data-decisiones={filas.length}>
          {filas.length === 0 ? (
            todas.length > 0 ? (
              <SinDatos
                enTabla={false}
                titulo={`Nada con ese filtro en ${mesLargo(mes)}`}
                descripcion={`El mes tiene ${plural(todas.length, 'decisión', 'decisiones')}, pero ${loQueFiltra}.`}
                accion={
                  <EnlaceBoton href={`/por-decidir/decisiones?${new URLSearchParams({ mes })}`} variante="contorno" tamano="sm">
                    Ver todas las de {mesCorto(mes)}
                  </EnlaceBoton>
                }
              />
            ) : (
              <SinDatos
                enTabla={false}
                titulo={`Sin decisiones en ${mesLargo(mes)}`}
                descripcion={mes === esteMes ? 'Tu puesto no aprobó, devolvió, anuló ni cerró nada este mes.' : 'Tu puesto no aprobó, devolvió, anuló ni cerró nada ese mes.'}
                accion={
                  <EnlaceBoton href={conMes(anterior)} variante="contorno" tamano="sm">
                    Ver {mesLargo(anterior)}
                  </EnlaceBoton>
                }
              />
            )
          ) : (
            <Tabla apilada>
              <TablaCabecera>
                <tr>
                  <TH className="md:w-40">Fecha</TH>
                  <TH>Documento</TH>
                  <TH className="md:w-40">Decisión</TH>
                  <TH>Motivo</TH>
                  <TH className="md:w-28">
                    <span className="sr-only">Abrir</span>
                  </TH>
                </tr>
              </TablaCabecera>
              <tbody>
                {filas.map((f) => {
                  const d = DECISION[f.decision]
                  const deQue = [f.codigo && f.codigo !== f.nombre ? f.codigo : null, f.detalle].filter(Boolean).join(' · ')
                  return (
                    <TR key={f.clave} data-decision={f.decision} data-tipo={f.tipo}>
                      <TD className="hidden whitespace-nowrap tabular text-texto-suave md:table-cell">{fechaHora(f.en)}</TD>
                      <TD>
                        <p className="text-xs text-texto-suave">{NOMBRE_DEL_TIPO[f.tipo].uno}</p>
                        <p className="font-medium text-texto">{f.nombre}</p>
                        {deQue && <p className="text-xs text-texto-suave">{deQue}</p>}
                        {/* En el teléfono, la decisión y la fecha en un renglón, bajo el documento. */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 md:hidden">
                          <Insignia tono={d.tono}>{d.etiqueta}</Insignia>
                          <span className="tabular text-xs text-texto-suave">{fechaHora(f.en)}</span>
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">
                        <Insignia tono={d.tono}>{d.etiqueta}</Insignia>
                      </TD>
                      <TD data-rotulo="Motivo" className={f.motivo ? 'text-sm text-texto' : 'hidden text-xs text-texto-suave md:table-cell'}>
                        {f.motivo ?? '—'}
                      </TD>
                      <TD>
                        <AccionesDeFila>
                          <EnlaceBoton
                            href={f.ruta}
                            variante="contorno"
                            tamano="sm"
                            aria-label={`Abrir ${NOMBRE_DEL_TIPO[f.tipo].uno.toLowerCase()} ${f.nombre}${f.codigo && f.codigo !== f.nombre ? ` de ${f.codigo}` : ''}`}
                          >
                            Abrir
                          </EnlaceBoton>
                        </AccionesDeFila>
                      </TD>
                    </TR>
                  )
                })}
              </tbody>
            </Tabla>
          )}
        </Tarjeta>
      </div>
    </>
  )
}
