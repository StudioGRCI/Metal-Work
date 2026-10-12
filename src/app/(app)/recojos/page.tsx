import { MapPin, Phone, User } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarRecojos, type CompraParaRecojo } from '@/lib/datos/logistica'
import { RECOJO_COMPRA } from '@/lib/dominio/logistica'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { PasoRecojo } from './paso-recojo'

export const metadata = { title: 'Recojos' }

export default async function PaginaRecojos() {
  const perfil = await exigirPermiso(['compras.recojo', 'compras.crear'])
  const conductor = puede(perfil, 'compras.recojo')
  const recojos = await cargarRecojos()
  const pendientes = recojos.filter((r) => r.recojo !== 'DEJADO')
  const dejadas = recojos.filter((r) => r.recojo === 'DEJADO')

  return (
    <>
      <EncabezadoPagina
        titulo="Recojos"
        descripcion={
          conductor
            ? 'Las compras aprobadas que tienes que recoger. Marca «Ya la recogí» al salir del proveedor y «La dejé en almacén» al entregarla: Almacén valida el ingreso sin volver a registrarlo.'
            : 'Lo que el conductor tiene que recoger y lo que ya dejó en almacén.'
        }
      />

      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-texto">
            Por hacer <span className="tabular text-texto-suave">({pendientes.length})</span>
          </h2>
          {pendientes.length === 0 ? (
            <Tarjeta>
              <SinDatos
                enTabla={false}
                titulo="No hay nada por recoger"
                descripcion="Cuando Gerencia apruebe una compra para recoger, aparece aquí y te llega un aviso."
              />
            </Tarjeta>
          ) : (
            pendientes.map((r) => <TarjetaRecojo key={r.id} recojo={r} conductor={conductor} />)
          )}
        </section>

        {dejadas.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-texto">Dejadas en almacén esta semana</h2>
            {dejadas.map((r) => (
              <TarjetaRecojo key={r.id} recojo={r} conductor={false} />
            ))}
          </section>
        )}
      </div>
    </>
  )
}

function TarjetaRecojo({ recojo: r, conductor }: { recojo: CompraParaRecojo; conductor: boolean }) {
  const estado = RECOJO_COMPRA[r.recojo]
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={`${r.numero} · ${r.proveedor}`}
        descripcion={[
          r.referencia && r.referencia !== r.numero ? `Ref. ${r.referencia}` : null,
          r.origen === 'DIRECTA' ? 'Para el almacén' : r.ordenes.length ? `OT ${r.ordenes.join(', ')}` : null,
          r.fecha_estimada ? `Lista desde ${fecha(r.fecha_estimada)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        acciones={estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
      />
      <TarjetaCuerpo className="space-y-4">
        <ul className="space-y-1 text-sm text-texto">
          {r.proveedor_direccion && (
            <li className="flex items-start gap-2">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave" />
              <a
                className="text-acento hover:underline"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.proveedor_direccion)}`}
                target="_blank"
                rel="noreferrer"
              >
                {r.proveedor_direccion}
              </a>
            </li>
          )}
          {r.proveedor_telefono && (
            <li className="flex items-center gap-2">
              <Phone aria-hidden className="size-4 shrink-0 text-texto-suave" />
              <a className="tabular text-acento hover:underline" href={`tel:${r.proveedor_telefono.replace(/[^\d+]/g, '')}`}>
                {r.proveedor_telefono}
              </a>
            </li>
          )}
          {r.proveedor_contacto && (
            <li className="flex items-center gap-2">
              <User aria-hidden className="size-4 shrink-0 text-texto-suave" />
              {r.proveedor_contacto}
            </li>
          )}
          {!r.proveedor_direccion && !r.proveedor_telefono && (
            <li className="text-xs text-texto-suave">El proveedor no tiene dirección ni teléfono en el padrón: pídeselos a Logística.</li>
          )}
        </ul>

        <ul className="divide-y divide-borde rounded-md border border-borde">
          {r.lineas.map((l, i) => (
            <li key={`${l.material_codigo}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-texto">{l.material}</p>
                <p className="text-[11px] text-texto-suave">{[l.material_codigo, l.orden ? `OT ${l.orden}` : null].filter(Boolean).join(' · ')}</p>
              </div>
              <p className="tabular shrink-0 font-semibold text-texto">
                {cantidad(l.cantidad)} {l.unidad}
              </p>
            </li>
          ))}
        </ul>

        <p className="text-xs text-texto-suave">
          {[
            r.pedido_en && `Mandada a recojo ${fechaHora(r.pedido_en)}`,
            r.recogido_en && `recogida ${fechaHora(r.recogido_en)}`,
            r.dejado_en && `dejada en almacén ${fechaHora(r.dejado_en)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {conductor && (r.recojo === 'POR_RECOGER' || r.recojo === 'RECOGIDO') && (
          <PasoRecojo id={r.id} numero={r.numero} paso={r.recojo === 'POR_RECOGER' ? 'RECOGIDO' : 'DEJADO'} />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
