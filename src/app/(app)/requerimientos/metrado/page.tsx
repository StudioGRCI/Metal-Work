import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { metradoDeRequerimientos, requerimientosPorAutorizar, type MetradoDelInsumo } from '@/lib/datos/metrado-rq'
import { cargarRequerimientos, type RequerimientoListado } from '@/lib/datos/requerimientos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { enlaceDisenoCodigo } from '@/lib/dominio/diseno-codigos'
import { cuentaDelMetrado, ESTADO_METRADO } from '@/lib/dominio/metrado-rq'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { ConAvisos } from '../atencion/avisos'
import { VistoDelRequerimiento } from './visto'

export const metadata = { title: 'Insumos por autorizar' }

/**
 * La bandeja de Diseño para el metrado (Almacén, 20/11/2026: «un requerimiento
 * no se aprueba sin sustento técnico»). Arriba lo que espera su visto, con el
 * sustento de quien pidió; abajo lo que todavía espera ese sustento, por si el
 * metrado del código está incompleto y basta con cargarlo.
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
  const abiertos = faltan.length > 0 ? [...recientes, ...(await cargarRequerimientos({ ids: faltan }))] : recientes
  abiertos.sort((a, b) => b.creado_en.localeCompare(a.creado_en))
  const metrado = await metradoDeRequerimientos(abiertos.map((r) => r.id))
  const de = (r: RequerimientoListado, estados: MetradoDelInsumo['estado'][]) =>
    r.lineas.filter((l) => estados.includes(metrado.get(l.id)?.estado ?? 'NO_APLICA'))
  // El más antiguo primero: es el que lleva más tiempo frenando a Almacén.
  const busca = (r: RequerimientoListado) =>
    palabras.length === 0 || coincide(palabras, [r.codigo_interno, r.numero, r.area, ...r.lineas.map((l) => l.descripcion)])
  const porAutorizar = abiertos.filter((r) => de(r, ['POR_AUTORIZAR']).length > 0 && busca(r)).reverse()
  const sinSustento = abiertos
    .filter((r) => de(r, ['POR_AUTORIZAR']).length === 0 && de(r, ['SIN_SUSTENTO', 'RECHAZADO']).length > 0 && busca(r))
    .reverse()

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
                <CabeceraDelRq rq={r} cargaMetrado={cargaMetrado} />
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
                      firma: [m.sustentado_por, m.sustentado_en ? fechaHora(m.sustentado_en) : null].filter(Boolean).join(', ') || null,
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
              <CabeceraDelRq rq={r} cargaMetrado={cargaMetrado} />
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
    </>
  )
}

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

/** Qué RQ es, de qué área y unidad, y para qué; con el enlace al metrado del código. */
function CabeceraDelRq({ rq, cargaMetrado }: { rq: RequerimientoListado; cargaMetrado: boolean }) {
  return (
    <div className="space-y-1 px-4 pt-4 pb-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="tabular text-base leading-tight font-semibold text-texto">{rq.numero}</h3>
        <span className="text-sm text-texto">
          {rq.area} · <span className="font-mono font-medium">{rq.codigo_interno}</span>
        </span>
      </div>
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
