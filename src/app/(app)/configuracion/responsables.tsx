'use client'

import { useState } from 'react'
import { UserCheck, UserPlus } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Campo, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { Ventana } from '@/components/ui/ventana'
import type { AreaConResponsable, CuentaParaResponsable } from '@/lib/datos/configuracion'
import { useEnvio } from '@/lib/envio'

import { asignarResponsableDeArea } from './acciones'

/**
 * Las áreas del organigrama con la cuenta que responde por cada una. Solo la
 * ve el administrador del sistema: es quien da de alta las cuentas.
 *
 * Se lee como una lista —área, quién responde, quién figura en el organigrama—
 * y se cambia en una ventana por área. El nombre del organigrama no se toca
 * desde aquí: dice a quién hay que darle cuenta, y se conserva hasta que todas
 * las áreas tengan la suya.
 */
export function ResponsablesDeArea({
  areas,
  cuentas,
}: {
  areas: AreaConResponsable[]
  cuentas: CuentaParaResponsable[]
}) {
  // Con cuenta es con una cuenta activa: a la dada de baja no le llega nada.
  const conCuenta = areas.filter((a) => a.responsable?.activo).length
  const faltan = areas.length - conCuenta

  return (
    <Tarjeta id="responsables" className="scroll-mt-20">
      <TarjetaCabecera
        titulo="Responsables de área"
        descripcion={
          areas.length === 0
            ? undefined
            : faltan === 0
              ? `Las ${areas.length} áreas tienen su cuenta responsable.`
              : `${conCuenta} de ${areas.length} áreas tienen cuenta responsable. ${faltan === 1 ? 'Falta 1.' : `Faltan ${faltan}.`}`
        }
        ayuda="La cuenta que responde por cada área: a ella le llega lo que se le avisa al área. Cada cuenta se nombra por su puesto. El nombre del organigrama se conserva al lado hasta que todas tengan su cuenta. Las cuentas se dan de alta en Personal."
      />
      <TarjetaCuerpo>
        {areas.length === 0 ? (
          <p className="text-sm text-texto-suave">Todavía no hay áreas cargadas.</p>
        ) : (
          <ul className="divide-y divide-borde">
            {areas.map((a) => (
              <FilaDeArea key={a.id} area={a} cuentas={cuentas} />
            ))}
          </ul>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** Un área: quién responde por ella y la ventana para asignarlo o cambiarlo. */
function FilaDeArea({ area, cuentas }: { area: AreaConResponsable; cuentas: CuentaParaResponsable[] }) {
  const [abierta, setAbierta] = useState(false)
  // Corrige lo que la fila muestra: la ventana se cierra con la fila ya al día
  // (`corrige`). El envío vive aquí y no dentro de la ventana, que desmonta lo
  // suyo al cerrarse y se llevaría el rechazo con ella.
  const envio = useEnvio(asignarResponsableDeArea, () => setAbierta(false), { documento: area.id, corrige: true })

  const responsable = area.responsable
  const deBaja = Boolean(responsable && !responsable.activo)
  const idCampo = `responsable-${area.id}`
  // Las cuentas se nombran por su puesto, como en todo el sistema (migración
  // 109). Primero las de la misma área: entre diecisiete, la que se busca casi
  // siempre es una de esas.
  const deLaCasa = cuentas.filter((c) => c.area_id === area.id)
  const lasDemas = cuentas.filter((c) => c.area_id !== area.id)

  return (
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-x-2 py-2.5">
      <span className="tabular pt-0.5 text-xs text-texto-tenue">{area.codigo}</span>

      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-texto">
          <span>{area.nombre}</span>
          {!responsable && <Insignia tono="aviso">Sin cuenta</Insignia>}
          {deBaja && <Insignia tono="peligro">Cuenta dada de baja</Insignia>}
        </p>
        {responsable && (
          <p className="text-sm text-texto">
            <span className="text-texto-suave">Cuenta responsable: </span>
            {responsable.etiqueta}
          </p>
        )}
        {deBaja && (
          <p className="text-xs text-peligro">A esta cuenta ya no le llegan los avisos del área: elige otra.</p>
        )}
        {area.encargado && <p className="text-xs text-texto-suave">En el organigrama: {area.encargado}</p>}
        {/* Siempre montado: un aviso que nace ya con su texto no se anuncia. La
            fila ya lo dice a la vista (el nombre, la insignia). */}
        <p role="status" className="sr-only">
          {envio.resultado?.ok ? envio.resultado.mensaje : ''}
        </p>
      </div>

      <Boton
        type="button"
        variante={responsable ? 'fantasma' : 'secundario'}
        tamano="sm"
        aria-label={`${responsable ? 'Cambiar' : 'Asignar'} la cuenta responsable de ${area.nombre}`}
        onClick={() => setAbierta(true)}
      >
        {responsable ? <UserCheck aria-hidden className="size-3.5" /> : <UserPlus aria-hidden className="size-3.5" />}
        {responsable ? 'Cambiar' : 'Asignar'}
      </Boton>

      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Responsable de ${area.nombre}`}
        descripcion="La cuenta que responde por el área. A ella le llega lo que se le avisa al área."
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="area_id" value={area.id} />
          <Campo
            etiqueta="Cuenta responsable"
            htmlFor={idCampo}
            ayuda={area.encargado ? `En el organigrama figura ${area.encargado}.` : 'El organigrama no nombra a nadie en esta área.'}
            ayudaEnIcono={false}
          >
            <Seleccion id={idCampo} name="jefe_id" defaultValue={responsable?.id ?? ''} className="w-full">
              <option value="">Sin cuenta responsable</option>
              {/* La cuenta dada de baja no está entre las activas: se muestra
                  para que el campo diga lo que hay guardado. */}
              {deBaja && responsable && (
                <option value={responsable.id}>{responsable.etiqueta} (dada de baja)</option>
              )}
              {deLaCasa.length > 0 ? (
                <>
                  <optgroup label={`Cuentas de ${area.nombre}`}>
                    {deLaCasa.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.etiqueta}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Las demás cuentas">
                    {lasDemas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.etiqueta}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                lasDemas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.etiqueta}
                  </option>
                ))
              )}
            </Seleccion>
          </Campo>
          <PieDeVentana error={envio.error} enviando={envio.enviando} alCancelar={() => setAbierta(false)} texto="Guardar" />
        </form>
      </Ventana>
    </li>
  )
}
