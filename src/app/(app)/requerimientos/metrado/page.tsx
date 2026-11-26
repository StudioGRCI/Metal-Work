import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Recorrido } from '@/components/ui/recorrido'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { metradoDeRequerimientos, requerimientosPorAutorizar, type MetradoDelInsumo } from '@/lib/datos/metrado-rq'
import { recorridoDeRequerimientos, type Recorridos } from '@/lib/datos/recorrido'
import { cargarRequerimientos, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { enlaceDisenoCodigo } from '@/lib/dominio/diseno-codigos'
import { cuentaDelMetrado, ESTADO_METRADO } from '@/lib/dominio/metrado-rq'
import { describirRecorridoDelRequerimiento, type PasoDelRecorrido } from '@/lib/dominio/recorrido'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { ConAvisos } from '../atencion/avisos'
import { VistoDelRequerimiento } from './visto'

export const metadata = { title: 'Insumos por autorizar' }

/**
 * La bandeja de Diseño para el metrado (Almacén, 20/11/2026: «un requerimiento
 * no se aprueba sin sustento técnico»). Arriba lo que espera su visto, con el
 * sustento de quien pidió; abajo lo que todavía espera ese sustento, por si el
 * metrado del código está incompleto y basta con cargarlo. Al final, lo que ya
 * autorizó y sigue abierto, con su recorrido: por dónde va después del visto
 * (plan 6, entrega 6.2).
 */
export default async function PaginaPorAutorizar({ searchParams }: PageProps<'/requerimientos/metrado'>) {
  const perfil = await exigirPermiso('requerimientos.autorizar_metrado')
  // Por código interno (o por RQ, área o insumo): con varios RQ la bandeja se hacía larga en el teléfono.
  const params = await searchParams
  const q = typeof params.codigo === 'string' ? params.codigo.trim().slice(0, 80) : ''
  const palabras = palabrasDeBusqueda(q)
  const cargaMetrado = puede(perfil, 'diseno.codigos')
  // Los 300 abiertos más recientes, y además los que esperan el visto aunque sean
  // más antiguos: el globo los cuenta todos, y la bandeja no puede dejar uno fuera.
  const [recientes, esperan] = await Promise.all([cargarRequerimientos({ soloAbiertos: true }), requerimientosPorAutorizar()])
  const faltan = esperan.filter((id) => !recientes.some((r) => r.id === id))
  // Los ids ya se saben: el metrado se lee a la vez que los que faltan.
  const [extra, metrado] = await Promise.all([
    faltan.length > 0 ? cargarRequerimientos({ ids: faltan }) : Promise.resolve([]),
    metradoDeRequerimientos([...recientes.map((r) => r.id), ...faltan]),
  ])
  const abiertos = [...recientes, ...extra]
  abiertos.sort((a, b) => b.creado_en.localeCompare(a.creado_en))
  const de = (r: RequerimientoListado, estados: MetradoDelInsumo['estado'][]) =>
    r.lineas.filter((l) => estados.includes(metrado.get(l.id)?.estado ?? 'NO_APLICA'))
  const busca = (r: RequerimientoListado) =>
    palabras.length === 0 || coincide(palabras, [r.codigo_interno, r.numero, r.area, ...r.lineas.map((l) => l.descripcion)])
  const porAutorizar = abiertos.filter((r) => de(r, ['POR_AUTORIZAR']).length > 0 && busca(r))
  const sinSustento = abiertos.filter(
    (r) => de(r, ['POR_AUTORIZAR']).length === 0 && de(r, ['SIN_SUSTENTO', 'RECHAZADO']).length > 0 && busca(r),
  )
  // Lo que Diseño ya autorizó y sigue abierto: el visto más reciente arriba,
  // hasta veinte. Se mira el visto, no el estado de hoy: si después se amplió el
  // metrado, el insumo pasa a «en el metrado» y el visto sigue dado. Lo que no se
  // autorizó vuelve a quien pidió y ya sale arriba.
  const autorizadas = (r: RequerimientoListado) => r.lineas.filter((l) => metrado.get(l.id)?.decision === 'AUTORIZADO')
  const ultimoVisto = (r: RequerimientoListado) =>
    autorizadas(r).reduce((max, l) => {
      const en = metrado.get(l.id)?.decidido_en ?? ''
      return en > max ? en : max
    }, '')
  const todosLosAutorizados = abiertos
    .filter((r) => autorizadas(r).length > 0 && de(r, ['POR_AUTORIZAR', 'SIN_SUSTENTO', 'RECHAZADO']).length === 0 && busca(r))
    .sort((a, b) => ultimoVisto(b).localeCompare(ultimoVisto(a)))
  const autorizados = todosLosAutorizados.slice(0, AUTORIZADOS_A_LA_VISTA)

  // Quién pidió cada RQ, quién lo tiene ahora y desde cuándo, con los días que
  // cuenta la base (fecha de Lima). Sin eso la bandeja sigue: sin días ni recorrido.
  const recorridos: Recorridos | null = await recorridoDeRequerimientos(
    [...porAutorizar, ...sinSustento, ...autorizados].map((r) => r.id),
  ).catch((e: unknown) => {
    console.error('Insumos por autorizar: no se pudo leer el recorrido de los requerimientos.', e)
    return null
  })
  const paso = (r: RequerimientoListado, cual: (p: PasoDelRecorrido) => boolean) => recorridos?.get(r.id)?.find(cual)
  const ahora = (r: RequerimientoListado) => paso(r, (p) => p.situacion === 'AHORA')
  const pidio = (r: RequerimientoListado) => paso(r, (p) => p.paso === 'REGISTRO' && p.situacion === 'HECHO')?.puesto ?? null
  /** El puesto de quien sustentó a esa hora (del recorrido), nunca su nombre. */
  const sustento = (r: RequerimientoListado, en: string | null) =>
    en
      ? (recorridos?.get(r.id) ?? []).filter((p) => p.paso === 'SUSTENTO' && p.situacion === 'HECHO' && p.en && p.en <= en).at(-1)?.puesto ?? null
      : null
  // El que más espera arriba. Lo que espera tu visto, desde el sustento más
  // antiguo de lo que espera tu visto (si otro insumo del RQ espera sustento, el
  // recorrido dice que lo tiene quien pidió); lo demás, desde que lo tiene quien
  // lo tiene. Sin el recorrido, desde que se registró. Solo se comparan fechas.
  const desdeElSustento = (r: RequerimientoListado) =>
    de(r, ['POR_AUTORIZAR'])
      .map((l) => metrado.get(l.id)?.sustentado_en ?? r.creado_en)
      .sort()[0] ?? r.creado_en
  const desde = (r: RequerimientoListado) => ahora(r)?.en ?? r.creado_en
  porAutorizar.sort((a, b) => desdeElSustento(a).localeCompare(desdeElSustento(b)))
  sinSustento.sort((a, b) => desde(a).localeCompare(desde(b)))
  const hayAlgo = porAutorizar.length + sinSustento.length + autorizados.length > 0

  return (
    <>
      <EncabezadoPagina
        titulo="Insumos por autorizar"
        descripcion="Lo que un requerimiento pide de más sobre el metrado de su código, con el sustento de quien lo pidió."
        ayuda="Cada insumo de materia prima o accesorio de un requerimiento de unidad se compara con el metrado que cargaste para su código, descontando lo que ya pidieron los requerimientos anteriores. Si se pasa, o no está en el metrado, quien lo pidió escribe por qué y tú lo autorizas o no. Mientras tanto Almacén no revisa ese requerimiento ni Logística lo compra. Si el metrado estaba incompleto, amplíalo en Gestión de materiales: lo que entra en el metrado ya no pide tu visto."
        migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Por autorizar' }]}
      />

      <div className="mb-4 max-w-md">
        <BuscadorSimple
          ruta="/requerimientos/metrado"
          clave="codigo"
          etiqueta="Buscar por código interno"
          marcador="Código interno, RQ o insumo"
        />
      </div>

      {recorridos === null && hayAlgo && (
        <p role="status" className="mb-3 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-dias-sin-leer>
          No se pudo leer el recorrido de los requerimientos: quién pidió cada uno, cuántos días lleva esperando y, en los ya
          autorizados, por dónde van. La bandeja sigue sin esos datos. Vuelve a cargar la pantalla en un momento.
        </p>
      )}

      <ConAvisos>
        <section aria-labelledby="por-autorizar" className="space-y-3">
          <h2 id="por-autorizar" className="text-sm font-semibold text-texto">
            Esperan tu visto <span className="tabular font-normal text-texto-suave">· {porAutorizar.length}</span>
          </h2>
          {porAutorizar.length === 0 ? (
            <Tarjeta>
              {q ? (
                <SinDatos
                  enTabla={false}
                  titulo="Nada de lo que espera tu visto coincide"
                  descripcion={`Ningún requerimiento por autorizar coincide con «${q}». Prueba con otro código o borra la búsqueda.`}
                />
              ) : (
                <SinDatos
                  enTabla={false}
                  titulo="Nada espera tu visto"
                  descripcion="Cuando un requerimiento pida más de lo que dice el metrado y quien lo pidió escriba por qué, aparece aquí y te llega el aviso."
                />
              )}
            </Tarjeta>
          ) : (
            porAutorizar.map((r) => (
              <Tarjeta key={r.id} className="overflow-hidden" data-rq={r.numero}>
                {/* Si el recorrido dice que lo tiene otro (un insumo espera sustento), se dice quién. */}
                <CabeceraDelRq rq={r} cargaMetrado={cargaMetrado} pidio={pidio(r)} espera={ahora(r)} verQuien={ahora(r)?.paso !== 'VISTO_DISENO'} />
                <OtrosQueFrenan rq={r} items={de(r, ['SIN_SUSTENTO', 'RECHAZADO']).map((l) => l.item)} />
                <VistoDelRequerimiento
                  id={r.id}
                  numero={r.numero}
                  insumos={de(r, ['POR_AUTORIZAR']).map((l) => {
                    const m = metrado.get(l.id)!
                    return {
                      item: l.item,
                      pedido: `${cantidad(l.cantidad)} ${l.unidad} ${l.descripcion}`,
                      cuenta: cuentaDelMetrado(m, l.unidad),
                      sustento: m.sustento,
                      // Por su puesto, como «Pidió»: nunca el nombre de la persona (decisión del 2026-11-25).
                      firma: [sustento(r, m.sustentado_en), m.sustentado_en ? fechaHora(m.sustentado_en) : null].filter(Boolean).join(', ') || null,
                    }
                  })}
                />
              </Tarjeta>
            ))
          )}
        </section>
      </ConAvisos>

      {sinSustento.length > 0 && (
        <section aria-labelledby="sin-sustento" className="mt-8 space-y-3">
          <div>
            <h2 id="sin-sustento" className="text-sm font-semibold text-texto">
              Esperan el sustento de quien pidió <span className="tabular font-normal text-texto-suave">· {sinSustento.length}</span>
            </h2>
            <p className="text-xs text-texto-suave">
              Se pasan del metrado y todavía nadie escribió por qué. Si el metrado del código está incompleto, amplíalo y dejan de pasarse.
            </p>
          </div>
          {sinSustento.map((r) => (
            <Tarjeta key={r.id} className="overflow-hidden" data-rq={r.numero}>
              <CabeceraDelRq rq={r} cargaMetrado={cargaMetrado} pidio={pidio(r)} espera={ahora(r)} verQuien />
              <ul className="divide-y divide-borde border-t border-borde">
                {de(r, ['SIN_SUSTENTO', 'RECHAZADO']).map((l) => {
                  const m = metrado.get(l.id)!
                  const e = ESTADO_METRADO[m.estado]
                  return (
                    <li key={l.item} className="space-y-0.5 px-4 py-3 text-sm">
                      <p className="break-words text-texto">
                        <span className="tabular font-semibold">Ítem {l.item} ·</span> {cantidad(l.cantidad)} {l.unidad} {l.descripcion}{' '}
                        <Insignia tono={e.tono}>{e.etiqueta}</Insignia>
                      </p>
                      <p className="text-xs text-texto-suave">{cuentaDelMetrado(m, l.unidad)}</p>
                      {m.estado === 'RECHAZADO' && m.nota_decision && (
                        <p className="text-xs break-words text-texto-suave">
                          <span className="font-medium text-texto">Diseño:</span> {m.nota_decision}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Tarjeta>
          ))}
        </section>
      )}

      {autorizados.length > 0 && (
        <section aria-labelledby="ya-autorizados" className="mt-8 space-y-3" data-ya-autorizados>
          <div>
            <h2 id="ya-autorizados" className="text-sm font-semibold text-texto">
              Ya autorizados por Diseño <span className="tabular font-normal text-texto-suave">· {todosLosAutorizados.length}</span>
            </h2>
            <p className="text-xs text-texto-suave">
              Siguen abiertos: abre su recorrido para ver por dónde van después del visto, quién los tiene y hace cuántos días.
              {todosLosAutorizados.length > AUTORIZADOS_A_LA_VISTA &&
                ` Van los ${AUTORIZADOS_A_LA_VISTA} de visto más reciente; para uno anterior, búscalo por su código.`}
            </p>
          </div>
          {autorizados.map((r) => (
            <Tarjeta key={r.id} className="overflow-hidden" data-rq={r.numero} data-autorizado>
              <CabeceraDelRq rq={r} cargaMetrado={cargaMetrado} pidio={pidio(r)} />
              <ul className="divide-y divide-borde border-t border-borde">
                {autorizadas(r).map((l) => {
                  const m = metrado.get(l.id)!
                  return (
                    <li key={l.item} className="space-y-0.5 px-4 py-3 text-sm">
                      <p className="break-words text-texto">
                        <span className="tabular font-semibold">Ítem {l.item} ·</span> {cantidad(l.cantidad)} {l.unidad} {l.descripcion}{' '}
                        <Insignia tono={ESTADO_METRADO.AUTORIZADO.tono}>
                          {m.decidido_en ? `Autorizado el ${fecha(m.decidido_en)}` : ESTADO_METRADO.AUTORIZADO.etiqueta}
                        </Insignia>
                      </p>
                      {m.nota_decision && (
                        <p className="text-xs break-words text-texto-suave">
                          <span className="font-medium text-texto">Diseño:</span> {m.nota_decision}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
              {/* Si no se pudo leer, ya lo dice el aviso de arriba: no se repite en cada tarjeta. */}
              {recorridos !== null && (
                <Recorrido pasos={describirRecorridoDelRequerimiento(recorridos.get(r.id) ?? [])} className="border-t border-borde" />
              )}
            </Tarjeta>
          ))}
        </section>
      )}
    </>
  )
}

/** Cuántos de los ya autorizados se muestran: los de visto más reciente. */
const AUTORIZADOS_A_LA_VISTA = 20

/**
 * Los otros insumos del mismo RQ que todavía esperan el sustento de quien pidió:
 * aunque autorices los de abajo, Almacén no lo revisa hasta que esos se resuelvan.
 */
function OtrosQueFrenan({ rq, items }: { rq: RequerimientoListado; items: number[] }) {
  if (items.length === 0) return null
  const cuales = items.length === 1 ? `El ítem ${items[0]}` : `Los ítems ${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
  return (
    <p className="border-t border-borde bg-aviso-suave px-4 py-2 text-sm text-texto" data-otros-frenan={rq.numero}>
      {cuales} de {rq.numero} {items.length === 1 ? 'espera' : 'esperan'} todavía el sustento de quien pidió: aunque autorices lo de abajo,
      Almacén lo revisa cuando {items.length === 1 ? 'ese se resuelva' : 'esos se resuelvan'}.
    </p>
  )
}

/**
 * Qué RQ es, de qué área y unidad, quién lo pidió y para qué; con el enlace al
 * metrado del código. `espera` es el paso que lo tiene ahora (del recorrido):
 * sus días van junto al número. `verQuien`, cuando no lo tiene quien mira.
 */
function CabeceraDelRq({
  rq,
  cargaMetrado,
  pidio,
  espera,
  verQuien = false,
}: {
  rq: RequerimientoListado
  cargaMetrado: boolean
  /** El puesto de la cuenta que lo registró, nunca su nombre (plan 0). */
  pidio: string | null
  espera?: PasoDelRecorrido
  verQuien?: boolean
}) {
  return (
    <div className="space-y-1 px-4 pt-4 pb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="tabular text-base leading-tight font-semibold text-texto">{rq.numero}</h3>
        <span className="text-sm text-texto">
          {rq.area} · <span className="font-mono font-medium">{rq.codigo_interno}</span>
        </span>
        <DiasEnEspera dias={espera?.dias} desde={espera?.en} quien={espera?.puesto} verQuien={verQuien} />
      </div>
      {pidio && (
        <p className="text-sm text-texto" data-pidio>
          <span className="text-texto-suave">Pidió:</span> <span className="font-medium">{pidio}</span>
        </p>
      )}
      <p className="text-sm break-words text-texto-suave">{rq.justificacion}</p>
      <p className="text-xs text-texto-tenue">
        {[`Registrado ${fechaHora(rq.creado_en)}`, rq.fecha_requerida ? `se necesita el ${fecha(rq.fecha_requerida)}` : null].filter(Boolean).join(' · ')}
      </p>
      {cargaMetrado && (
        <Link
          href={enlaceDisenoCodigo(rq.codigo_interno, 'materiales')}
          className="inline-flex min-h-11 items-center text-sm font-medium text-acento hover:underline sm:min-h-0"
        >
          Ver o ampliar el metrado de {rq.codigo_interno}
        </Link>
      )}
    </div>
  )
}
