import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { metradoDeRequerimientos, type MetradoDelInsumo } from '@/lib/datos/metrado-rq'
import { cargarRequerimientos, type RequerimientoListado } from '@/lib/datos/requerimientos'
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
export default async function PaginaPorAutorizar() {
  const perfil = await exigirPermiso('requerimientos.autorizar_metrado')
  const cargaMetrado = puede(perfil, 'diseno.codigos')
  const abiertos = await cargarRequerimientos({ soloAbiertos: true })
  const metrado = await metradoDeRequerimientos(abiertos.map((r) => r.id))
  const de = (r: RequerimientoListado, estados: MetradoDelInsumo['estado'][]) =>
    r.lineas.filter((l) => estados.includes(metrado.get(l.id)?.estado ?? 'NO_APLICA'))
  // El más antiguo primero: es el que lleva más tiempo frenando a Almacén.
  const porAutorizar = abiertos.filter((r) => de(r, ['POR_AUTORIZAR']).length > 0).reverse()
  const sinSustento = abiertos.filter((r) => de(r, ['POR_AUTORIZAR']).length === 0 && de(r, ['SIN_SUSTENTO', 'RECHAZADO']).length > 0).reverse()

  return (
    <>
      <EncabezadoPagina
        titulo="Insumos por autorizar"
        descripcion="Lo que un requerimiento pide de más sobre el metrado de su código, con el sustento de quien lo pidió."
        ayuda="Cada insumo de materia prima o accesorio de un requerimiento de unidad se compara con el metrado que cargaste para su código, descontando lo que ya pidieron los requerimientos anteriores. Si se pasa, o no está en el metrado, quien lo pidió escribe por qué y tú lo autorizas o no. Mientras tanto Almacén no revisa ese requerimiento ni Logística lo compra. Si el metrado estaba incompleto, amplíalo en Gestión de materiales: lo que entra en el metrado ya no pide tu visto."
        migas={[{ titulo: 'Requerimientos', ruta: '/requerimientos' }, { titulo: 'Por autorizar' }]}
      />

      <ConAvisos>
        <section aria-labelledby="por-autorizar" className="space-y-3">
          <h2 id="por-autorizar" className="text-sm font-semibold text-texto">
            Esperan tu visto <span className="tabular font-normal text-texto-suave">· {porAutorizar.length}</span>
          </h2>
          {porAutorizar.length === 0 ? (
            <Tarjeta>
              <SinDatos
                enTabla={false}
                titulo="Nada espera tu visto"
                descripcion="Cuando un requerimiento pida más de lo que dice el metrado y quien lo pidió escriba por qué, aparece aquí y te llega el aviso."
              />
            </Tarjeta>
          ) : (
            porAutorizar.map((r) => (
              <Tarjeta key={r.id} className="overflow-hidden" data-rq={r.numero}>
                <CabeceraDelRq rq={r} cargaMetrado={cargaMetrado} />
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
                          <span className="font-medium text-texto">Tu nota:</span> {m.nota_decision}
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
