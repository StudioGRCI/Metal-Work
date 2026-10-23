'use client'

import { Pencil, Plus, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { CodigoInternoConLista } from '@/components/codigo-interno/elegir-codigo'
import { CampoContrato, sacarContrato } from '@/components/estructura/contrato-adjunto'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirContrato } from '@/lib/contratos'
import type { Subcontratista } from '@/lib/datos/subcontratos'
import { problemaDeContrato } from '@/lib/dominio/contratos'
import { AYUDA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import type { CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { AREAS_SUBCONTRATO, AYUDA_AREA_SUBCONTRATO, BUCKET_SUBCONTRATOS } from '@/lib/dominio/subcontratos'
import { BANCOS_SUGERIDOS, rucEsValido } from '@/lib/dominio/proveedores'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'

import { adjuntarContratoSubcontrato, guardarSubcontratista, registrarSubcontrato } from './acciones'

/** El código interno con el buscador de todos los formularios: por el código, la placa o la marca. */
export function CampoCodigoInterno({ id, codigos, valor }: { id: string; codigos: CodigoParaElegir[] | null; valor?: string }) {
  return (
    <Campo etiqueta="Código interno" htmlFor={id} requerido ayuda={AYUDA_CODIGO_INTERNO}>
      <CodigoInternoConLista id={id} name="codigo_interno" requerido valorInicial={valor} codigos={codigos} />
    </Campo>
  )
}

/**
 * Para qué área va el subcontrato: Maestranza, Producción o Acabados. Obligatoria al
 * registrar; al corregir uno de antes que no la tiene, se puede dejar vacía.
 */
export function CampoAreaSubcontrato({ id, valor, opcional = false }: { id: string; valor?: string | null; opcional?: boolean }) {
  return (
    <Campo etiqueta="Para qué área va" htmlFor={id} requerido={!opcional} ayuda={AYUDA_AREA_SUBCONTRATO}>
      <Seleccion id={id} name="area" required={!opcional} defaultValue={valor ?? ''} data-area-subcontrato>
        <option value="" disabled={!opcional}>
          {opcional ? 'Sin área todavía' : 'Elige el área'}
        </option>
        {AREAS_SUBCONTRATO.map((a) => (
          <option key={a.codigo} value={a.codigo}>
            {a.nombre}
          </option>
        ))}
      </Seleccion>
    </Campo>
  )
}

/**
 * Registrar un subcontrato: a quién, para qué área y código interno, qué
 * trabajo y cuánto se pactó, y su contrato si ya lo tienen. El número SC-… lo pone la
 * base; al salir bien se abre el subcontrato para subirle sus recibos.
 */
export function NuevoSubcontrato({ subcontratistas, codigos }: { subcontratistas: Subcontratista[]; codigos: CodigoParaElegir[] | null }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  // Los ids del subcontrato y de su contrato viven aquí, fuera del formulario que
  // se rehace al abrir: tras «No llegó la respuesta», cancelar y volver a abrir
  // lleva los mismos, y la base no registra otro SC numerado con lo mismo
  // (decimoquinta pasada). Se renuevan con el ok o cuando la base dice que ya quedó.
  const subcontrato = useIdDelEnvio()
  const contrato = useIdDelEnvio()
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          subcontrato.abrir()
          contrato.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-nuevo-subcontrato
      >
        <Plus aria-hidden className="size-4" />
        Nuevo subcontrato
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Nuevo subcontrato"
        descripcion="Un trabajo que se le encarga a una persona de fuera y que cobra con recibos por honorarios. El número SC-… lo pone el sistema."
        ancho="lg"
      >
        {subcontrato.id && contrato.id && (
          <FormularioSubcontrato
            key={vez}
            id={subcontrato.id}
            idContrato={contrato.id}
            alSalir={() => {
              subcontrato.salio()
              contrato.salio()
            }}
            alTerminar={() => {
              subcontrato.otro()
              contrato.otro()
            }}
            subcontratistas={subcontratistas.filter((s) => s.activo)}
            codigos={codigos}
            alCancelar={() => setAbierta(false)}
          />
        )}
      </Ventana>
    </>
  )
}

function FormularioSubcontrato({
  id,
  idContrato,
  alSalir,
  alTerminar,
  subcontratistas,
  codigos,
  alCancelar,
}: {
  /** Un reintento manda el mismo y la base no registra otro. */
  id: string
  idContrato: string
  /** Al enviar: los ids salieron con este envío. */
  alSalir: () => void
  /** Con el ok, o cuando la base dice que ya quedó: el próximo es otro. */
  alTerminar: () => void
  subcontratistas: Subcontratista[]
  codigos: CodigoParaElegir[] | null
  alCancelar: () => void
}) {
  const router = useRouter()
  const [subcontratistaId, setSubcontratistaId] = useState('')

  // El contrato es opcional y sube después de registrar: su carpeta es el subcontrato,
  // que tiene que existir. Si el subcontrato entra y el contrato no, se abre el
  // subcontrato con el aviso y el botón para adjuntarlo.
  async function registrar(previo: unknown, datos: FormData): Promise<ResultadoAccion<{ id: string; contratoPendiente: boolean }>> {
    const contrato = sacarContrato(datos)
    const problema = contrato && problemaDeContrato(contrato)
    if (problema) return { ok: false, error: problema }
    alSalir()
    const r = await registrarSubcontrato(previo, datos)
    if (!r.ok || !contrato) return r.ok ? { ...r, datos: { id, contratoPendiente: false } } : r
    const c = await subirContrato({
      bucket: BUCKET_SUBCONTRATOS,
      carpeta: id,
      id: idContrato,
      archivo: contrato,
      adjuntar: (d) => adjuntarContratoSubcontrato(id, d),
    })
    return { ...r, datos: { id, contratoPendiente: !c.ok } }
  }
  const { alEnviar, enviando, error } = useEnvio(
    registrar,
    (r) => {
      alTerminar()
      router.push(`/subcontratos/${id}${r.datos?.contratoPendiente ? '?contrato=pendiente' : ''}`)
    },
    // Sin `refrescar: false` aunque el ok navegue: tras «ya quedó» o sin respuesta
    // no se navega, y al cerrar la lista tiene que mostrar el subcontrato que
    // entró. Sin refrescar, «la pantalla muestra lo que quedó» no mostraba nada
    // (decimosexta pasada).
    { alYaEntrar: alTerminar },
  )

  if (subcontratistas.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-texto">
          Todavía no hay subcontratistas en el padrón. Da de alta primero a la persona que hará el trabajo, en la pestaña «Subcontratistas».
        </p>
        <div className="flex justify-end">
          <Boton type="button" variante="contorno" onClick={alCancelar}>
            Cerrar
          </Boton>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Campo etiqueta="Subcontratista" htmlFor="sc-subcontratista" requerido ayuda="Quien emite los recibos. Si no está, dalo de alta en «Subcontratistas».">
        <SeleccionBuscable
          id="sc-subcontratista"
          name="subcontratista_id"
          valor={subcontratistaId}
          onChange={setSubcontratistaId}
          marcador="Elige del padrón"
          marcadorBusqueda="Nombre o RUC…"
          opciones={subcontratistas.map((s) => ({ valor: s.id, etiqueta: s.nombre, detalle: `RUC ${s.ruc}` }))}
        />
      </Campo>
      <Campo etiqueta="Qué trabajo se le encarga" htmlFor="sc-descripcion" requerido>
        <AreaTexto
          id="sc-descripcion"
          name="descripcion"
          required
          minLength={10}
          maxLength={1000}
          rows={3}
          placeholder="Por ejemplo: instalación eléctrica del furgón, con el material que entrega Metal Work."
        />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoAreaSubcontrato id="sc-area" />
        <CampoCodigoInterno id="sc-codigo" codigos={codigos} />
        <Campo etiqueta="Lo pactado" htmlFor="sc-monto" requerido ayuda="El total de honorarios acordado, en bruto: antes de la retención.">
          <div className="flex gap-2">
            <Seleccion id="sc-moneda" name="moneda" defaultValue="PEN" aria-label="Moneda" className="w-28">
              <option value="PEN">Soles</option>
              <option value="USD">Dólares</option>
            </Seleccion>
            <Entrada id="sc-monto" name="monto" type="number" inputMode="decimal" min={0.01} step="0.01" required className="tabular min-w-0 flex-1" />
          </div>
        </Campo>
        <Campo etiqueta="Inicio" htmlFor="sc-inicio">
          <Entrada id="sc-inicio" name="fecha_inicio" type="date" />
        </Campo>
        <Campo etiqueta="Término previsto" htmlFor="sc-fin">
          <Entrada id="sc-fin" name="fecha_fin" type="date" />
        </Campo>
      </div>
      <CampoContrato id="sc-contrato" disabled={enviando} />
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCancelar} texto="Registrar subcontrato" disabled={!subcontratistaId} />
    </form>
  )
}

/** Dar de alta a un subcontratista, o corregirlo y darlo de baja si ya está en el padrón. */
export function FormularioSubcontratista({ subcontratista }: { subcontratista?: Subcontratista }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const nuevo = !subcontratista
  return (
    <>
      {nuevo ? (
        <Boton
          type="button"
          onClick={() => {
            setVez((v) => v + 1)
            setAbierta(true)
          }}
          data-nuevo-subcontratista
        >
          <UserPlus aria-hidden className="size-4" />
          Nuevo subcontratista
        </Boton>
      ) : (
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          onClick={() => {
            setVez((v) => v + 1)
            setAbierta(true)
          }}
          aria-label={`Corregir a ${subcontratista.nombre}`}
        >
          <Pencil aria-hidden className="size-4" />
          Corregir
        </Boton>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={nuevo ? 'Nuevo subcontratista' : `Corregir a ${subcontratista.nombre}`}
        descripcion="La persona natural que emite los recibos por honorarios, con la cuenta donde Tesorería le paga."
        ancho="md"
      >
        <DatosSubcontratista key={vez} subcontratista={subcontratista} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

function DatosSubcontratista({ subcontratista: s, alTerminar }: { subcontratista?: Subcontratista; alTerminar: () => void }) {
  const [id] = useState(() => s?.id ?? crypto.randomUUID())
  const [ruc, setRuc] = useState(s?.ruc ?? '')
  const { alEnviar, enviando, error } = useEnvio(guardarSubcontratista, alTerminar)
  const limpio = ruc.replace(/\s/g, '')
  const avisoRuc =
    limpio.length === 11
      ? !rucEsValido(limpio)
        ? 'Ese RUC no es válido: revisa los dígitos.'
        : !limpio.startsWith('10')
          ? 'Quien emite recibos por honorarios es una persona natural: su RUC empieza con 10. Una empresa va como proveedor de Logística.'
          : null
      : null
  const prefijo = `subc-${id.slice(0, 8)}`

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="RUC" htmlFor={`${prefijo}-ruc`} requerido error={avisoRuc ?? undefined}>
          <Entrada
            id={`${prefijo}-ruc`}
            name="ruc"
            inputMode="numeric"
            pattern="[0-9]{11}"
            maxLength={11}
            required
            value={ruc}
            onChange={(e) => setRuc(e.target.value.replace(/\D/g, ''))}
            className="tabular"
            autoComplete="off"
          />
        </Campo>
        <Campo etiqueta="Teléfono" htmlFor={`${prefijo}-telefono`}>
          <Entrada id={`${prefijo}-telefono`} name="telefono" type="tel" maxLength={40} defaultValue={s?.telefono ?? ''} />
        </Campo>
      </div>
      <Campo etiqueta="Nombre completo" htmlFor={`${prefijo}-nombre`} requerido ayuda="Como sale en el recibo por honorarios.">
        <Entrada id={`${prefijo}-nombre`} name="nombre" required minLength={2} maxLength={160} defaultValue={s?.nombre ?? ''} autoComplete="off" />
      </Campo>
      <fieldset className="space-y-3 rounded-lg border border-borde p-3">
        <legend className="px-1 text-sm font-medium text-texto">Cuenta donde se le paga</legend>
        <Campo etiqueta="Banco" htmlFor={`${prefijo}-banco`}>
          <Entrada id={`${prefijo}-banco`} name="banco" maxLength={80} list={`${prefijo}-bancos`} defaultValue={s?.banco ?? ''} autoComplete="off" />
          <datalist id={`${prefijo}-bancos`}>
            {BANCOS_SUGERIDOS.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="N.º de cuenta" htmlFor={`${prefijo}-cuenta`} ayuda="Solo los dígitos.">
            <Entrada id={`${prefijo}-cuenta`} name="numero_cuenta" inputMode="numeric" maxLength={40} defaultValue={s?.numero_cuenta ?? ''} className="tabular" autoComplete="off" />
          </Campo>
          <Campo etiqueta="CCI" htmlFor={`${prefijo}-cci`} ayuda="20 dígitos, para transferir desde otro banco.">
            <Entrada id={`${prefijo}-cci`} name="cci" inputMode="numeric" maxLength={30} defaultValue={s?.cci ?? ''} className="tabular" autoComplete="off" />
          </Campo>
        </div>
      </fieldset>
      {s && (
        <Campo etiqueta="En el padrón" htmlFor={`${prefijo}-activo`} ayuda="Uno dado de baja ya no recibe subcontratos nuevos; los que tiene siguen.">
          <Seleccion id={`${prefijo}-activo`} name="activo" defaultValue={s.activo ? 'si' : 'no'}>
            <option value="si">Activo</option>
            <option value="no">Dado de baja</option>
          </Seleccion>
        </Campo>
      )}
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando} disabled={Boolean(avisoRuc)}>
          {s ? 'Guardar' : 'Dar de alta'}
        </Boton>
      </div>
    </form>
  )
}
