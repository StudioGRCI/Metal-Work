import { MapPin, Phone } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { recojosDeCompras, type Recojo } from '@/lib/datos/recojos'
import { ESTADO_RECOJO } from '@/lib/dominio/proveedores'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import { DejarEnAlmacen, MarcarRecogida } from './controles'

export const metadata = { title: 'Recojos de compras' }

/**
 * La pantalla del conductor de Logística: a dónde ir, qué recoger y los dos
 * pasos que marca —recogida donde el proveedor y dejada en almacén con la guía
 * o la factura—. Lo que deja le llega a Almacén para validarlo en el kardex.
 */
export default async function PaginaRecojos() {
  await exigirPermiso('compras.recoger')
  const recojos = await recojosDeCompras()
  const enCamino = recojos.filter((r) => r.estado === 'EN_CAMINO')
  const porRecoger = recojos.filter((r) => r.estado === 'POR_RECOGER')
  const dejadas = recojos.filter((r) => r.estado === 'EN_ALMACEN')

  return (
    <>
      <EncabezadoPagina
        titulo="Recojos de compras"
        descripcion="Las compras aprobadas que hay que recoger donde el proveedor y dejar en almacén. Marca cada paso aquí: Almacén valida el ingreso cuando la dejas."
      />
      <p className="mb-4 text-sm text-texto-suave">
        {plural(porRecoger.length, 'compra por recoger', 'compras por recoger')} · {plural(enCamino.length, 'en camino', 'en camino')} · {plural(dejadas.length, 'dejada en almacén esta semana', 'dejadas en almacén esta semana')}
      </p>

      {enCamino.length + porRecoger.length === 0 && (
        <Tarjeta className="mb-4">
          <TarjetaCuerpo>
            <p className="font-medium text-texto">No tienes compras por recoger</p>
            <p className="mt-1 text-sm text-texto-suave">Cuando Logística emita una compra y Gerencia la apruebe, te llega un aviso y aparece aquí.</p>
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <div className="space-y-4">
        {[...enCamino, ...porRecoger].map((r) => <TarjetaRecojo key={r.id} recojo={r} />)}
      </div>

      {dejadas.length > 0 && (
        <section className="mt-8" aria-labelledby="dejadas">
          <h2 id="dejadas" className="mb-3 text-base font-semibold text-texto">Dejadas en almacén esta semana</h2>
          <div className="space-y-3">
            {dejadas.map((r) => <TarjetaRecojo key={r.id} recojo={r} />)}
          </div>
        </section>
      )}
    </>
  )
}

function TarjetaRecojo({ recojo: r }: { recojo: Recojo }) {
  const estado = ESTADO_RECOJO[r.estado] ?? { etiqueta: r.estado, tono: 'neutro' as const, descripcion: '' }
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={r.proveedor}
        descripcion={`Compra ${r.referencia}${r.fecha_estimada ? ` · para el ${fecha(r.fecha_estimada)}` : ''}`}
        acciones={<Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
      />
      <TarjetaCuerpo className="space-y-4">
        {r.estado !== 'EN_ALMACEN' && (
          <div className="space-y-1 text-sm">
            {r.proveedor_direccion
              ? <p className="flex gap-2 text-texto"><MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave" />{r.proveedor_direccion}</p>
              : <p className="text-texto-suave">Sin dirección en el padrón: pídela a Logística.</p>}
            {r.proveedor_telefono && (
              <p className="flex gap-2">
                <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave" />
                <a href={`tel:${r.proveedor_telefono.replace(/[^\d+]/g, '')}`} className="font-medium text-acento underline">{r.proveedor_telefono}</a>
                {r.proveedor_contacto && <span className="text-texto-suave">· {r.proveedor_contacto}</span>}
              </p>
            )}
            {r.proveedor_documento && <p className="text-xs text-texto-suave">RUC {r.proveedor_documento}</p>}
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold text-texto">Qué recoger</p>
          <ul className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
            {r.lineas.map((l, i) => (
              <li key={`${l.material_codigo}-${i}`} className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="min-w-0 text-sm text-texto">
                  {l.material}
                  <span className="block font-mono text-[11px] text-texto-suave">{l.material_codigo}</span>
                </span>
                <span className="tabular shrink-0 text-sm font-semibold text-texto">{cantidad(l.cantidad)} {l.unidad ?? ''}</span>
              </li>
            ))}
          </ul>
        </div>

        {r.estado === 'POR_RECOGER' && <MarcarRecogida compraId={r.id} />}
        {r.estado === 'EN_CAMINO' && (
          <>
            <p className="text-xs text-texto-suave">Recogida el {fechaHora(r.recogido_en)}{r.recogido_por ? ` por ${r.recogido_por}` : ''}.</p>
            <DejarEnAlmacen compraId={r.id} />
          </>
        )}
        {r.estado === 'EN_ALMACEN' && (
          <p className="text-sm text-texto-suave">
            Dejada el {fechaHora(r.dejado_en)}{r.dejado_por ? ` por ${r.dejado_por}` : ''}{r.documento_entrega ? ` con ${r.documento_entrega}` : ''}.{' '}
            <span className={r.ingresado ? 'font-medium text-exito' : 'font-medium text-aviso'}>
              {r.ingresado ? 'Almacén ya la ingresó al kardex.' : 'Almacén todavía no valida el ingreso.'}
            </span>
          </p>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`
}
