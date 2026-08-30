import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Boton } from '@/components/ui/boton'
import { Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  calendarioLaboral,
  catalogosDelTaller,
  quienFirmaLasCotizaciones,
  ultimosTiposCambio,
} from '@/lib/datos/configuracion'
import { cantidad, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { DiasLaborables, Feriados } from './calendario'
import { MedidasCarroceria, type CarroceriaConMedidas } from './medidas-carroceria'
import { QuienFirma } from './quien-firma'
import { TipoDeCambio } from './tipo-cambio'

export const metadata = { title: 'Configuración' }

export default async function PaginaConfiguracion({
  searchParams,
}: PageProps<'/configuracion'>) {
  const perfil = await exigirPermiso('configuracion.ver')
  const query = await searchParams

  const hoy = new Date().getFullYear()
  const anio = Number(typeof query.anio === 'string' ? query.anio : hoy) || hoy

  const [calendario, catalogos, cambios, firma] = await Promise.all([
    calendarioLaboral(anio),
    catalogosDelTaller(),
    ultimosTiposCambio(),
    quienFirmaLasCotizaciones(),
  ])
  const puedeEditar = puede(perfil, 'configuracion.editar')

  return (
    <>
      <EncabezadoPagina
        titulo="Configuración"
        descripcion="El calendario del taller y los catálogos con los que trabaja el sistema."
        acciones={
          // Campo y botón del sistema en vez de un <input> suelto: el original
          // medía 28 px de alto y en el teléfono no se acertaba ni el año ni el
          // «Ver». `inputMode="numeric"` saca el teclado de números.
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="anio" className="text-xs text-texto-suave">
              Año
            </label>
            <Entrada
              id="anio"
              type="number"
              inputMode="numeric"
              name="anio"
              defaultValue={anio}
              min={2020}
              max={2100}
              className="w-24"
            />
            <Boton type="submit" variante="secundario">
              Ver año
            </Boton>
          </form>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {/* Va primero a propósito: es el único dato de esta pantalla que, si
              falta, se cuela en cada cotización en dólares sin decir nada. */}
          <TipoDeCambio hoy={hoyLima()} cambios={cambios} puedeEditar={puedeEditar} />
          <QuienFirma nombre={firma.nombre} cargo={firma.cargo} puedeEditar={puedeEditar} />
          <DiasLaborables dias={calendario.diasLaborables} puedeEditar={puedeEditar} />
          <Feriados anio={anio} feriados={calendario.feriados} puedeEditar={puedeEditar} />
        </div>

        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera
              titulo="Tipos de carrocería"
              descripcion="Lo que el taller fabrica, con las medidas que la cotización copia al elegir el tipo. Una vez copiadas se corrigen en la cotización."
            />
            <TarjetaCuerpo className="space-y-1">
              {/* La lista vacía sin explicación se lee como pantalla rota. Es
                  además el caso que deja al taller sin poder cotizar. */}
              {catalogos.carrocerias.length === 0 && (
                <p className="text-sm text-texto-suave">
                  Todavía no hay tipos de carrocería. Se dan de alta desde administración; sin al
                  menos uno no se puede cotizar ni abrir una orden.
                </p>
              )}
              {catalogos.carrocerias.map((c) => (
                <MedidasCarroceria
                  key={c.id}
                  carroceria={c as unknown as CarroceriaConMedidas}
                  puedeEditar={puedeEditar}
                />
              ))}
            </TarjetaCuerpo>
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera
              titulo="Etapas de fabricación"
              descripcion="En este orden avanza cada orden. Las marcadas exigen inspección de calidad."
            />
            <TarjetaCuerpo className="space-y-1">
              {catalogos.etapas.length === 0 && (
                <p className="text-sm text-texto-suave">
                  Todavía no hay etapas cargadas. Sin ellas ninguna orden puede reportar avance.
                </p>
              )}
              {catalogos.etapas.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 border-b border-borde py-1.5 text-sm last:border-0">
                  <span className="text-texto">
                    <span className="tabular mr-2 text-xs text-texto-tenue">{e.orden_secuencia}</span>
                    {e.nombre}
                  </span>
                  <span className="flex items-center gap-2">
                    {e.requiere_inspeccion && <Insignia tono="aviso">calidad</Insignia>}
                    <span className="tabular text-xs text-texto-suave">{cantidad(e.horas_estandar)} h</span>
                  </span>
                </div>
              ))}
            </TarjetaCuerpo>
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera
              titulo="Fichas y verificaciones"
              descripcion="Las plantillas que se aplican al cotizar y al aprobar una orden."
            />
            <TarjetaCuerpo className="space-y-3">
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-texto-suave uppercase">
                  Fichas técnicas preescritas
                </p>
                {catalogos.fichas.length === 0 ? (
                  <p className="text-sm text-texto-suave">Todavía no hay fichas.</p>
                ) : (
                  catalogos.fichas.map((f) => (
                    <p key={f.id} className="text-sm text-texto">
                      {f.nombre}
                      {f.carroceria && <span className="text-texto-suave"> · {f.carroceria}</span>}
                    </p>
                  ))
                )}
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-texto-suave uppercase">
                  Pasos de verificación por carrocería
                </p>
                {catalogos.verificaciones.length === 0 ? (
                  <p className="text-sm text-texto-suave">
                    Ninguna carrocería tiene pasos de verificación: hoy las órdenes se aprueban sin
                    lista de control.
                  </p>
                ) : (
                  catalogos.verificaciones.map((v) => (
                    <p key={v.nombre} className="text-sm text-texto">
                      {v.nombre} <span className="tabular text-texto-suave">· {v.pasos} pasos</span>
                    </p>
                  ))
                )}
              </div>
              <p className="text-xs text-texto-tenue">
                Estas listas se editan con administración; cambiarlas cambia lo que el taller firma.
              </p>
            </TarjetaCuerpo>
          </Tarjeta>
        </div>
      </div>
    </>
  )
}
