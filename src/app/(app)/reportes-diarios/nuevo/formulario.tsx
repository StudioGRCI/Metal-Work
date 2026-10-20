'use client'

import { Plus, Trash2, Users, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import { SelectorFotos, fotosParaEnviar, hayFallidas, haySubiendo, type FotoLista } from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable, type OpcionBuscable } from '@/components/ui/seleccion-buscable'
import {
  BUCKET_FOTOS_REPORTE,
  MAXIMO_FOTOS_REPORTE,
  MAXIMO_MB_FOTO_REPORTE,
  MAXIMO_TRABAJOS_REPORTE,
} from '@/lib/dominio/reporte-diario'
import { CODIGO_SIN_AVANCE } from '@/lib/dominio/codigos-internos'
import { horasCortas } from '@/lib/dominio/rrhh'
import type { OpcionDeTrabajo } from '@/lib/datos/reportes-diarios'
import { useEnvio } from '@/lib/envio'
import { fecha as fechaCorta } from '@/lib/format'
import { cn } from '@/lib/utils'

import { opcionesDelCodigo, registrarReporteDiario } from '../acciones'

export type OpcionPersona = OpcionBuscable

type FilaPersona = { clave: string; trabajadorId: string; horas: string }
/**
 * `sobre`: sobre qué es el trabajo, como `TIPO:id` (un plano, un subcontrato o
 * una actividad que sigue) o `NUEVA` (una actividad nueva, con su descripción).
 */
type FilaTrabajo = { clave: string; sobre: string; descripcion: string; avance: string; personal: FilaPersona[] }

const NUEVA = 'NUEVA'
const claveDe = (o: Pick<OpcionDeTrabajo, 'tipo' | 'id'>) => `${o.tipo}:${o.id}`

// Las filas que se agregan tocando llevan una clave al azar; las primeras, una
// fija, porque el servidor y el navegador tienen que pintar los mismos `id`.
const nuevaPersona = (clave: string = crypto.randomUUID()): FilaPersona => ({ clave, trabajadorId: '', horas: '' })
const nuevoTrabajo = (clave: string = crypto.randomUUID()): FilaTrabajo => ({
  clave,
  sobre: '',
  descripcion: '',
  avance: '',
  personal: [nuevaPersona(`${clave}-1`)],
})

/** Lo que ya traía el reporte observado que se corrige: se abre con todo eso escrito. */
export type ReporteACorregir = {
  reemplaza: string
  fecha: string
  codigo_interno: string
  asunto: string
  descripcion: string
  general: boolean
  trabajos: {
    /** `TIPO:id` de la actividad del trabajo, o `NUEVA` si es de antes y no tiene. */
    sobre: string
    descripcion: string
    avance: number
    personal: { trabajador_id: string; horas: number }[]
  }[]
  personal_general: { trabajador_id: string; horas: number }[]
  fotos: { ruta: string; enlace: string | null }[]
}

function filasDe(personal: { trabajador_id: string; horas: number }[], prefijo: string): FilaPersona[] {
  return personal.length === 0
    ? [nuevaPersona(`${prefijo}-1`)]
    : personal.map((p, i) => ({ clave: `${prefijo}-${i + 1}`, trabajadorId: p.trabajador_id, horas: String(p.horas) }))
}

/** «4,5» o «4.5» → 4.5; vacío → NaN. */
function horasDe(texto: string) {
  return texto.trim() === '' ? Number.NaN : Number(texto.replace(',', '.'))
}

/** Lo que se manda de una lista de personas: las filas vacías se ignoran, las a medias van y la base las rechaza con su motivo. */
function paraEnviar(filas: FilaPersona[]) {
  return filas
    .filter((p) => p.trabajadorId || p.horas.trim())
    .map((p) => ({ trabajador_id: p.trabajadorId, horas: horasDe(p.horas) }))
}

/** Por qué lo elegido ya no está en la lista de ese día. */
function noEntra(nombres: string[], fecha: string) {
  const varios = nombres.length > 1
  return `${nombres.join(', ')} ya no ${varios ? 'se pueden' : 'se puede'} reportar el ${fechaCorta(fecha)}: ${varios ? 'están terminados o anulados' : 'está terminado o anulado'}, o un reporte posterior ya lleva tanto o más. Elige otra cosa.`
}

/** Lo que ya lleva lo elegido, para el detalle de la lista y la ayuda del avance. */
function yaLleva(o: OpcionDeTrabajo, pasado: boolean) {
  return o.avance === null ? 'sin reportar todavía' : `${pasado ? 'iba' : 'va'} en ${o.avance} % (${fechaCorta(o.ultima_fecha)})`
}

function detalleDe(o: OpcionDeTrabajo, pasado: boolean) {
  const tipo = o.tipo === 'PLANO' ? 'Plano de Diseño' : o.tipo === 'SUBCONTRATO' ? 'Subcontrato' : 'Actividad que sigue'
  return `${tipo} · ${yaLleva(o, pasado)}`
}

/**
 * El reporte diario del supervisor, pensado para el teléfono: arriba lo que
 * cuenta el reporte y su código interno, después cada trabajo con su avance y
 * su gente, y al final las fotos. Cada trabajo va sobre un plano o un
 * subcontrato de su área, sobre una actividad que ya abrió otro día (y solo
 * puede subir su avance), o sobre una actividad nueva. El personal sale de la lista de RR. HH.; con
 * «Personal general» se pone una sola vez para todo el reporte.
 *
 * El id del reporte llega del servidor con la página: las fotos viajan a
 * `{cuenta}/{reporte}/…` antes de que el reporte exista, y un reintento manda
 * el mismo y no duplica. Sacarlo con `crypto.randomUUID()` en el navegador daba
 * uno distinto al que pintó el servidor, y el campo oculto se quedaba con el
 * del servidor mientras las fotos subían con el otro.
 */
export function FormularioReporteDiario({
  id,
  cuentaId,
  hoy,
  minimo,
  personal,
  codigos,
  corrige = null,
  opcionesIniciales = [],
}: {
  id: string
  cuentaId: string
  hoy: string
  minimo: string
  personal: OpcionPersona[]
  codigos: string[]
  corrige?: ReporteACorregir | null
  /** Lo que se puede elegir en el código del reporte que se corrige. */
  opcionesIniciales?: OpcionDeTrabajo[]
}) {
  const router = useRouter()
  const [dia, setDia] = useState(corrige?.fecha ?? hoy)
  const [opciones, setOpciones] = useState<OpcionDeTrabajo[]>(opcionesIniciales)
  const [codigoLeido, setCodigoLeido] = useState(corrige?.codigo_interno.trim().toUpperCase() ?? '')
  // Lo que lleva cada cosa se lee al día del reporte: cambiar el día vuelve a pedirlo.
  const [diaLeido, setDiaLeido] = useState(corrige?.fecha ?? hoy)
  const codigoEscrito = useRef(corrige?.codigo_interno ?? '')
  const [leyendo, setLeyendo] = useState(false)
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null)
  // Lo elegido que la última lectura sacó, para decir por qué desapareció. Al
  // corregir, lo que el observado llevaba y ese día ya no entra.
  const sinLugar = (corrige?.trabajos ?? []).filter(
    (t) => t.sobre !== NUEVA && !opcionesIniciales.some((o) => claveDe(o) === t.sobre),
  )
  const [quitados, setQuitados] = useState<string | null>(() =>
    corrige && sinLugar.length > 0 ? noEntra(sinLugar.map((t) => t.descripcion), corrige.fecha) : null,
  )
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pedido = useRef(0)
  const [trabajos, setTrabajos] = useState<FilaTrabajo[]>(() =>
    corrige && corrige.trabajos.length > 0
      ? corrige.trabajos.map((t, i) => ({
          clave: `trabajo-${i + 1}`,
          sobre: sinLugar.includes(t) ? '' : t.sobre,
          descripcion: t.sobre === NUEVA ? t.descripcion : '',
          avance: String(t.avance),
          personal: filasDe(t.personal, `trabajo-${i + 1}`),
        }))
      : [nuevoTrabajo('trabajo-1')],
  )
  const [general, setGeneral] = useState(corrige?.general ?? false)
  const [personalGeneral, setPersonalGeneral] = useState<FilaPersona[]>(() => filasDe(corrige?.personal_general ?? [], 'general'))
  // Las fotos del observado se quedan donde están; se pueden quitar y sumar otras hasta el tope.
  const [fotosPrevias, setFotosPrevias] = useState(corrige?.fotos ?? [])
  const [fotos, setFotos] = useState<FotoLista[]>([])
  const { alEnviar, enviando, error } = useEnvio(
    registrarReporteDiario,
    (r) => router.push(`/reportes-diarios/${r.datos?.id ?? id}?subido=1`),
    { refrescar: false },
  )

  const nombres = new Map(personal.map((p) => [p.valor, p.etiqueta]))
  // Lo que cada persona suma en todo el reporte: el tope del día es 16 horas.
  const lineas = general ? personalGeneral : trabajos.flatMap((t) => t.personal)
  const porPersona = new Map<string, number>()
  for (const l of lineas) {
    const h = horasDe(l.horas)
    if (l.trabajadorId && Number.isFinite(h)) porPersona.set(l.trabajadorId, (porPersona.get(l.trabajadorId) ?? 0) + h)
  }
  const totalHoras = [...porPersona.values()].reduce((n, h) => n + h, 0)
  const sinPersonal = personal.length === 0
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)

  function cambiarTrabajo(clave: string, cambio: Partial<FilaTrabajo>) {
    setTrabajos((ts) => ts.map((t) => (t.clave === clave ? { ...t, ...cambio } : t)))
  }

  /**
   * Al escribir el código (o cambiar el día) se piden sus planos, subcontratos
   * y actividades con lo que llevaban ese día, un momento después de la última
   * tecla. La respuesta de un pedido anterior se descarta, y lo elegido que el
   * código nuevo no tiene se vacía.
   */
  function leerCodigo(texto: string, fecha: string) {
    const codigo = texto.trim().toUpperCase()
    if (espera.current) clearTimeout(espera.current)
    const numero = ++pedido.current
    if (codigo === codigoLeido && fecha === diaLeido) {
      // Volvió a lo que ya estaba leído: lo que se pidió en medio ya no vale.
      setLeyendo(false)
      setErrorOpciones(null)
      return
    }
    setQuitados(null)
    if (codigo.length < 2) {
      setOpciones([])
      setCodigoLeido('')
      setLeyendo(false)
      setErrorOpciones(null)
      return
    }
    setLeyendo(true)
    espera.current = setTimeout(async () => {
      const r = await opcionesDelCodigo(codigo, corrige?.reemplaza ?? null, fecha).catch(() => null)
      if (numero !== pedido.current) return
      setLeyendo(false)
      if (!r || !r.ok) {
        setErrorOpciones(r && !r.ok ? r.error : 'No llegó la respuesta. Revisa la conexión y vuelve a escribir el código.')
        return
      }
      const nuevas = r.datos ?? []
      const validas = new Set(nuevas.map(claveDe))
      const anteriores = new Map(opciones.map((o) => [claveDe(o), o.etiqueta]))
      const sacados = trabajos
        .filter((t) => t.sobre !== '' && t.sobre !== NUEVA && !validas.has(t.sobre))
        .map((t) => anteriores.get(t.sobre) ?? 'Lo elegido')
      setQuitados(
        sacados.length === 0
          ? null
          : codigo !== codigoLeido
            ? `${sacados.join(', ')} no ${sacados.length === 1 ? 'es' : 'son'} de ${codigo}. Elige otra cosa.`
            : noEntra(sacados, fecha),
      )
      setErrorOpciones(null)
      setOpciones(nuevas)
      setCodigoLeido(codigo)
      setDiaLeido(fecha)
      setTrabajos((ts) => ts.map((t) => (t.sobre === '' || t.sobre === NUEVA || validas.has(t.sobre) ? t : { ...t, sobre: '', avance: '' })))
    }, 400)
  }

  const porClave = new Map(opciones.map((o) => [claveDe(o), o]))
  const elegidos = new Set(trabajos.map((t) => t.sobre).filter((v) => v && v !== NUEVA))
  const soloSubcontratos = trabajos.every((t) => t.sobre.startsWith('SUBCONTRATO:'))

  return (
    <form
      onSubmit={(e) =>
        alEnviar(e, (datos) => {
          datos.set(
            'trabajos',
            JSON.stringify(
              trabajos.map((t) => {
                const [tipo, idElegido] = t.sobre.split(':')
                return {
                  sobre: tipo || null,
                  ...(tipo === NUEVA ? { descripcion: t.descripcion } : { id: idElegido }),
                  avance: t.avance.trim() === '' ? null : Number(t.avance),
                  personal: general ? [] : paraEnviar(t.personal),
                }
              }),
            ),
          )
          datos.set('personal', JSON.stringify(general ? paraEnviar(personalGeneral) : []))
          datos.set('fotos', JSON.stringify([...fotosPrevias.map((f) => f.ruta), ...fotosParaEnviar(fotos).map((f) => f.ruta_storage)]))
        })
      }
      className="space-y-6"
    >
      <input type="hidden" name="id" value={id} />
      {corrige && <input type="hidden" name="reemplaza" value={corrige.reemplaza} />}

      <section aria-labelledby="rd-cabecera" className="space-y-4">
        <h2 id="rd-cabecera" className="text-sm font-semibold text-texto">
          El reporte
        </h2>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Campo etiqueta="Día" htmlFor="rd-fecha" requerido>
            <Entrada
              id="rd-fecha"
              name="fecha"
              type="date"
              required
              value={dia}
              onChange={(e) => {
                setDia(e.target.value)
                leerCodigo(codigoEscrito.current, e.target.value)
              }}
              min={minimo}
              max={hoy}
            />
          </Campo>
          <Campo
            etiqueta="Código interno"
            htmlFor="rd-codigo"
            requerido
            ayuda="El de la unidad, por ejemplo PLA_SR_O4_1_26/28; PLANTA si no es para una unidad. Si trabajaste en dos códigos, sube dos reportes."
          >
            <Entrada
              id="rd-codigo"
              name="codigo_interno"
              required
              minLength={2}
              maxLength={60}
              list="rd-codigos"
              defaultValue={corrige?.codigo_interno}
              onChange={(e) => {
                codigoEscrito.current = e.target.value
                leerCodigo(e.target.value, dia)
              }}
              autoComplete="off"
              autoCapitalize="characters"
              className="font-mono uppercase"
            />
            <datalist id="rd-codigos">
              {codigos.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Campo>
        </div>
        <Campo etiqueta="Asunto" htmlFor="rd-asunto" requerido>
          <Entrada
            id="rd-asunto"
            name="asunto"
            required
            minLength={3}
            maxLength={120}
            placeholder="Por ejemplo: armado de la tolva"
            defaultValue={corrige?.asunto}
            autoComplete="off"
          />
        </Campo>
        <Campo etiqueta="Breve descripción" htmlFor="rd-descripcion" requerido>
          <AreaTexto
            id="rd-descripcion"
            name="descripcion"
            required
            minLength={3}
            maxLength={1000}
            rows={2}
            placeholder="Lo que pasó hoy en este código: qué se avanzó, qué falta, si algo trabó el trabajo."
            defaultValue={corrige?.descripcion}
          />
        </Campo>
      </section>

      <section aria-labelledby="rd-trabajos" className="space-y-3">
        <h2 id="rd-trabajos" className="text-sm font-semibold text-texto">
          Trabajos realizados
        </h2>
        <p className={cn('text-xs', errorOpciones ? 'text-peligro' : 'text-texto-suave')} aria-live="polite" data-opciones>
          {leyendo
            ? 'Buscando los planos, subcontratos y actividades del código…'
            : errorOpciones
              ? errorOpciones
              : !codigoLeido
                ? 'Escribe el código interno para ver sus planos, subcontratos y las actividades que siguen.'
                : `${quitados ? `${quitados} ` : ''}${
                    opciones.length > 0
                      ? `${codigoLeido}: ${opciones.length} ${opciones.length === 1 ? 'cosa' : 'cosas'} para reportar en tu área, o una actividad nueva.`
                      : codigoLeido === CODIGO_SIN_AVANCE
                        ? `${CODIGO_SIN_AVANCE} no lleva avance: anota el trabajo del día como actividad nueva.`
                        : `${codigoLeido} no tiene planos ni subcontratos de tu área, ni actividades abiertas. Revisa que el código esté bien escrito; si lo está, anota una actividad nueva.`
                  }`}
        </p>
        {trabajos.map((t, i) => {
          const elegida = porClave.get(t.sobre) ?? null
          // El avance solo sube: más que lo que llevaba ese día y menos que lo de un día posterior.
          const lleva = elegida?.avance ?? null
          const tope = elegida?.tope ?? null
          const desde = lleva !== null ? lleva + 1 : 0
          const hasta = tope !== null ? tope - 1 : 100
          const lista: OpcionBuscable[] = [
            ...opciones
              .filter((o) => claveDe(o) === t.sobre || !elegidos.has(claveDe(o)))
              .map((o) => ({ valor: claveDe(o), etiqueta: o.etiqueta, detalle: detalleDe(o, dia < hoy) })),
            { valor: NUEVA, etiqueta: 'Actividad nueva', detalle: 'Sin plano todavía: escribe qué es y su avance' },
          ]
          return (
            <fieldset key={t.clave} className="min-w-0 space-y-3 rounded-lg border border-borde p-3" data-trabajo={i + 1}>
              <legend className="sr-only">Trabajo {i + 1}</legend>
              <div className="flex items-center justify-between gap-2">
                <p aria-hidden className="text-sm font-medium text-texto">
                  Trabajo {i + 1}
                </p>
                <Boton
                  type="button"
                  variante="fantasma"
                  tamano="icono"
                  aria-label={`Quitar el trabajo ${i + 1}`}
                  disabled={trabajos.length === 1}
                  onClick={() => setTrabajos((ts) => ts.filter((x) => x.clave !== t.clave))}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Boton>
              </div>
              <Campo etiqueta="Sobre qué" htmlFor={`rd-sobre-${t.clave}`} requerido>
                <SeleccionBuscable
                  id={`rd-sobre-${t.clave}`}
                  name={`sobre-${t.clave}`}
                  opciones={lista}
                  valor={t.sobre}
                  onChange={(sobre) => cambiarTrabajo(t.clave, { sobre, avance: '' })}
                  marcador="Elige el plano, el subcontrato o la actividad"
                  marcadorBusqueda="Plano, subcontrato o actividad…"
                  etiquetaAccesible={`Trabajo ${i + 1}: sobre qué`}
                  requerido
                  permiteVaciar={false}
                />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                {t.sobre === NUEVA ? (
                  <Campo etiqueta="Qué actividad es" htmlFor={`rd-trabajo-${t.clave}`} requerido>
                    <AreaTexto
                      id={`rd-trabajo-${t.clave}`}
                      required
                      minLength={3}
                      maxLength={500}
                      rows={2}
                      value={t.descripcion}
                      onChange={(e) => cambiarTrabajo(t.clave, { descripcion: e.target.value })}
                      placeholder="Por ejemplo: corte de materia prima"
                    />
                  </Campo>
                ) : (
                  <p className="self-end text-xs text-texto-suave" id={`rd-lleva-${t.clave}`}>
                    {elegida
                      ? tope !== null
                        ? `${lleva !== null ? `Iba en ${lleva} % el ${fechaCorta(elegida.ultima_fecha)} y el` : 'El'} ${fechaCorta(elegida.tope_fecha)} ya iba en ${tope} %: pon en cuánto iba este día, de ${desde} a ${hasta}.`
                        : lleva === null
                          ? 'Todavía nadie lo reportó.'
                          : `Iba en ${lleva} % el ${fechaCorta(elegida.ultima_fecha)}: pon en cuánto va ahora, de ${desde} a 100.`
                      : ''}
                  </p>
                )}
                <Campo etiqueta="Va en (%)" htmlFor={`rd-avance-${t.clave}`} requerido className="max-w-32 sm:max-w-none">
                  <Entrada
                    id={`rd-avance-${t.clave}`}
                    type="number"
                    inputMode="numeric"
                    required
                    min={desde}
                    max={hasta}
                    step={1}
                    value={t.avance}
                    onChange={(e) => cambiarTrabajo(t.clave, { avance: e.target.value })}
                    aria-describedby={t.sobre && t.sobre !== NUEVA ? `rd-lleva-${t.clave}` : undefined}
                    className="tabular"
                  />
                </Campo>
              </div>
              {!general && t.sobre.startsWith('SUBCONTRATO:') && (
                <p className="text-xs text-texto-suave">El subcontratista no va en el personal: pon a tu gente solo si ayudó.</p>
              )}
              {!general && (
                <ListaPersonal
                  titulo={`Personal del trabajo ${i + 1}`}
                  filas={t.personal}
                  alCambiar={(personal) => cambiarTrabajo(t.clave, { personal })}
                  opciones={personal}
                  deshabilitado={sinPersonal}
                />
              )}
            </fieldset>
          )
        })}
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          disabled={trabajos.length >= MAXIMO_TRABAJOS_REPORTE}
          onClick={() => setTrabajos((ts) => [...ts, nuevoTrabajo()])}
        >
          <Plus aria-hidden className="size-4" />
          Agregar trabajo
        </Boton>
      </section>

      <section aria-labelledby="rd-personal" className="space-y-3">
        <h2 id="rd-personal" className="text-sm font-semibold text-texto">
          Personal
        </h2>
        {sinPersonal ? (
          <p role="alert" className="rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto">
            Recursos Humanos todavía no registró al personal. Sin esa lista no se pueden cargar las horas: pídele que registre a tu
            gente en Personal.
          </p>
        ) : (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-borde px-3 py-2.5">
            <input
              type="checkbox"
              name="personal_general"
              value="si"
              checked={general}
              onChange={(e) => setGeneral(e.target.checked)}
              className="mt-0.5 size-5 accent-[var(--acento)]"
            />
            <span>
              <span className="block text-sm font-medium text-texto">Personal general para todo el reporte</span>
              <span className="block text-xs text-texto-suave">
                Márcalo si la misma gente trabajó en todo lo del reporte: la pones una sola vez, con sus horas, en lugar de en cada
                trabajo.
              </span>
            </span>
          </label>
        )}
        {general && (
          <ListaPersonal
            titulo="Personal general del reporte"
            filas={personalGeneral}
            alCambiar={setPersonalGeneral}
            opciones={personal}
            deshabilitado={sinPersonal}
          />
        )}
        {porPersona.size > 0 && (
          <div className="rounded-lg bg-superficie-2 px-3 py-2 text-xs text-texto-suave" aria-live="polite">
            <p className="font-medium text-texto">
              <Users aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
              {porPersona.size} {porPersona.size === 1 ? 'persona' : 'personas'} · <span className="tabular">{horasCortas(totalHoras)}</span> en
              total
            </p>
            <ul className="mt-1 space-y-0.5">
              {[...porPersona.entries()].map(([persona, horas]) => (
                <li key={persona} className={cn(horas > 16 && 'font-medium text-peligro')}>
                  {nombres.get(persona) ?? 'Persona'}: <span className="tabular">{horasCortas(horas)}</span>
                  {horas > 16 && ' — pasa de 16 horas en el día'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="rd-fotos" className="space-y-2">
        <h2 id="rd-fotos" className="text-sm font-semibold text-texto">
          Fotos del trabajo
        </h2>
        {fotosPrevias.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Fotos del reporte observado">
            {fotosPrevias.map((f, i) => (
              <li key={f.ruta} className="relative size-24 overflow-hidden rounded-lg border border-borde">
                {f.enlace ? (
                  // eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador
                  <img src={f.enlace} alt={`Foto ${i + 1} del reporte observado`} className="size-full object-cover" />
                ) : (
                  <p className="flex size-full items-center justify-center p-1 text-center text-xs text-texto-suave">Foto {i + 1}</p>
                )}
                <button
                  type="button"
                  aria-label={`Quitar la foto ${i + 1}`}
                  onClick={() => setFotosPrevias((fs) => fs.filter((x) => x.ruta !== f.ruta))}
                  className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full bg-superficie/90 text-texto shadow"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <SelectorFotos
          fotos={fotos}
          alCambiar={setFotos}
          prefijoRuta={`${cuentaId}/${id}`}
          maximo={MAXIMO_FOTOS_REPORTE - fotosPrevias.length}
          bucket={BUCKET_FOTOS_REPORTE}
          comprimir
          maximoMb={MAXIMO_MB_FOTO_REPORTE}
          titulo={null}
        />
      </section>

      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      {fallidas && !subiendo && (
        <p className="text-sm text-peligro">Quita o vuelve a subir las fotos que no entraron antes de subir el reporte.</p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando} disabled={(sinPersonal && !soloSubcontratos) || subiendo || fallidas} className="w-full sm:w-auto">
          {subiendo ? 'Esperando las fotos…' : corrige ? 'Subir el reporte corregido' : 'Subir reporte'}
        </Boton>
      </div>
    </form>
  )
}

/** Las personas de un trabajo (o del reporte entero), cada una con sus horas. */
function ListaPersonal({
  titulo,
  filas,
  alCambiar,
  opciones,
  deshabilitado,
}: {
  titulo: string
  filas: FilaPersona[]
  alCambiar: (filas: FilaPersona[]) => void
  opciones: OpcionPersona[]
  deshabilitado: boolean
}) {
  function cambiar(clave: string, cambio: Partial<FilaPersona>) {
    alCambiar(filas.map((p) => (p.clave === clave ? { ...p, ...cambio } : p)))
  }

  return (
    <div className="space-y-2" role="group" aria-label={titulo}>
      <p className="text-xs font-medium text-texto-suave">{titulo}</p>
      {filas.map((p, i) => {
        // Quien ya está en otra fila de esta lista no se ofrece de nuevo.
        const elegidas = new Set(filas.filter((x) => x.clave !== p.clave).map((x) => x.trabajadorId))
        return (
          // En el teléfono el nombre va a lo ancho y las horas debajo: al lado, el nombre se cortaba en «Prue…».
          <div key={p.clave} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <SeleccionBuscable
              className="basis-full sm:basis-0 sm:flex-1"
              opciones={opciones.filter((o) => !elegidas.has(o.valor))}
              valor={p.trabajadorId}
              onChange={(valor) => cambiar(p.clave, { trabajadorId: valor })}
              marcador="Elige a la persona"
              marcadorBusqueda="Nombre o cargo…"
              etiquetaAccesible={`${titulo}: persona ${i + 1}`}
              deshabilitado={deshabilitado}
            />
            <Entrada
              type="number"
              inputMode="decimal"
              min={0.25}
              max={16}
              step={0.25}
              placeholder="Horas"
              aria-label={`${titulo}: horas de la persona ${i + 1}`}
              value={p.horas}
              onChange={(e) => cambiar(p.clave, { horas: e.target.value })}
              required={Boolean(p.trabajadorId)}
              disabled={deshabilitado}
              className="tabular w-24 flex-none"
            />
            <span aria-hidden className="-ml-1 text-sm text-texto-suave">
              h
            </span>
            <Boton
              type="button"
              variante="fantasma"
              tamano="icono"
              aria-label={`Quitar a la persona ${i + 1}`}
              disabled={filas.length === 1}
              onClick={() => alCambiar(filas.filter((x) => x.clave !== p.clave))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Boton>
          </div>
        )
      })}
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        disabled={deshabilitado || filas.length >= 60}
        onClick={() => alCambiar([...filas, nuevaPersona()])}
      >
        <Plus aria-hidden className="size-4" />
        Agregar persona
      </Boton>
    </div>
  )
}
