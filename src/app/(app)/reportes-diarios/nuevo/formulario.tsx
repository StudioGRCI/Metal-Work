'use client'

import { Plus, Trash2, Users, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import {
  SelectorFotos,
  fotosParaEnviar,
  hayFallidas,
  haySubiendo,
  quitarAlSaberseVieja,
  quitarFotosSueltas,
  SE_ACTUALIZO_CON_FOTOS,
  type FotoLista,
} from '@/components/avance/selector-fotos'
import { YaQuedo } from '@/components/estructura/ida-que-no-salio'
import { Boton } from '@/components/ui/boton'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Progreso } from '@/components/ui/progreso'
import { SeleccionBuscable, type OpcionBuscable } from '@/components/ui/seleccion-buscable'
import {
  BUCKET_FOTOS_REPORTE,
  MAXIMO_CODIGOS_REPORTE,
  MAXIMO_FOTOS_REPORTE,
  MAXIMO_MB_FOTO_REPORTE,
  MAXIMO_TRABAJOS_REPORTE,
} from '@/lib/dominio/reporte-diario'
import { pudoHaberEntrado, yaEntroLaPrimeraVez, type ResultadoAccion } from '@/lib/acciones'
import { CODIGO_SIN_AVANCE, normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { horasCortas } from '@/lib/dominio/rrhh'
import type { OpcionDeTrabajo } from '@/lib/datos/reportes-diarios'
import {
  alVolverACargar,
  esDeLaVersionAnterior,
  laPestanaEsDeLaVersionAnterior,
  motivoDelFallo,
  navegarSiEsDeLaPestana,
  OtraCuentaEnLaPestana,
  SE_ACTUALIZO_EL_SISTEMA,
  useCursorAlRechazo,
  useEnvio,
  usePestanaDeLaVersionAnterior,
  vigilarLaVersion,
} from '@/lib/envio'
import { fecha as fechaCorta } from '@/lib/format'
import { cn } from '@/lib/utils'

import { opcionesDelCodigo, registrarReporteCorregido, registrarReportesDiarios } from '../acciones'
import { BuscadorCodigo } from './buscador-codigo'

export type OpcionPersona = OpcionBuscable

type FilaPersona = { clave: string; trabajadorId: string; horas: string }
/**
 * `sobre`: sobre qué es el trabajo, como `TIPO:id` (un plano, un subcontrato o
 * una actividad que sigue) o `NUEVA` (una actividad nueva, con su descripción).
 */
type FilaTrabajo = { clave: string; sobre: string; descripcion: string; avance: string; personal: FilaPersona[] }
type FotoPrevia = { ruta: string; enlace: string | null }

/**
 * Un código interno del reporte, con lo suyo: sus trabajos, su gente y sus
 * fotos. Cada uno entra como su propio reporte, con su `id`, porque de cada
 * reporte salen las horas que van al costeo de su código.
 */
type Seccion = {
  clave: string
  id: string
  codigo: string
  opciones: OpcionDeTrabajo[]
  codigoLeido: string
  /** Lo que lleva cada cosa se lee al día del reporte: cambiar el día vuelve a pedirlo. */
  diaLeido: string
  leyendo: boolean
  errorOpciones: string | null
  /** Lo elegido que la última lectura sacó, para decir por qué desapareció. */
  quitados: string | null
  trabajos: FilaTrabajo[]
  general: boolean
  personalGeneral: FilaPersona[]
  fotos: FotoLista[]
  /** Al corregir: las fotos del observado, que se quedan donde están. */
  fotosPrevias: FotoPrevia[]
}

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
  fotos: FotoPrevia[]
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
  const tipo = o.tipo === 'PLANO' ? 'Plano de Diseño' : o.tipo === 'SUBCONTRATO' ? 'Subcontrato' : 'Tarea tuya que sigue'
  return `${tipo} · ${yaLleva(o, pasado)}`
}

/** Los trabajos, como los espera la acción. */
function trabajosParaEnviar(s: Seccion) {
  return s.trabajos.map((t) => {
    const [tipo, idElegido] = t.sobre.split(':')
    return {
      sobre: tipo || null,
      ...(tipo === NUEVA ? { descripcion: t.descripcion } : { id: idElegido }),
      avance: t.avance.trim() === '' ? null : Number(t.avance),
      personal: s.general ? [] : paraEnviar(t.personal),
    }
  })
}

/** Las que ya están en Storage o van en camino: si nadie las nombra, quedan sueltas. */
function fotosSubidas(s: Seccion) {
  return s.fotos.filter((f) => f.ruta || f.subiendo)
}

/** La foto va en un envío que sigue en camino, o en uno que no se sabe cómo terminó. */
function esDeUnEnvio(f: FotoLista, enCamino: Set<FotoLista>, enDuda: Set<string>) {
  return enCamino.has(f) || Boolean(f.ruta && enDuda.has(f.ruta))
}

function fotosDe(s: Seccion) {
  return [...s.fotosPrevias.map((f) => f.ruta), ...fotosParaEnviar(s.fotos).map((f) => f.ruta_storage)]
}

/**
 * Lo que trae la lectura de un código: sus opciones, y lo elegido que ya no
 * entra se vacía y se dice por qué.
 */
function conOpciones(
  s: Seccion,
  r: Awaited<ReturnType<typeof opcionesDelCodigo>>,
  codigo: string,
  fecha: string,
): Seccion {
  if (!r.ok) return { ...s, leyendo: false, errorOpciones: r.error }
  const nuevas = r.datos ?? []
  const validas = new Set(nuevas.map(claveDe))
  const anteriores = new Map(s.opciones.map((o) => [claveDe(o), o.etiqueta]))
  const sacados = s.trabajos
    .filter((t) => t.sobre !== '' && t.sobre !== NUEVA && !validas.has(t.sobre))
    .map((t) => anteriores.get(t.sobre) ?? 'Lo elegido')
  return {
    ...s,
    leyendo: false,
    errorOpciones: null,
    quitados:
      sacados.length === 0
        ? null
        : codigo !== s.codigoLeido
          ? `${sacados.join(', ')} no ${sacados.length === 1 ? 'es' : 'son'} de ${codigo}. Elige otra cosa.`
          : noEntra(sacados, fecha),
    opciones: nuevas,
    codigoLeido: codigo,
    diaLeido: fecha,
    trabajos: s.trabajos.map((t) => (t.sobre === '' || t.sobre === NUEVA || validas.has(t.sobre) ? t : { ...t, sobre: '', avance: '' })),
  }
}

/**
 * El reporte diario del supervisor, pensado para el teléfono: arriba el día y
 * lo que cuenta el reporte; después cada código interno en que trabajó su
 * gente, con sus trabajos, su avance, su personal y sus fotos; al final la
 * gente del día con sus horas. Cada trabajo va sobre un plano o un subcontrato
 * de su área, sobre una tarea que ya abrió otro día (y solo puede subir su
 * avance), o sobre una tarea nueva, que queda en el código para los reportes
 * siguientes. El personal sale de la lista de RR. HH.
 *
 * Se guarda un reporte por código (`registrar_reportes_diarios`): las horas de
 * cada uno van al costeo de su código. Los ids llegan del servidor con la
 * página, uno por código posible: las fotos viajan a `{cuenta}/{reporte}/…`
 * antes de que el reporte exista, y un reintento manda los mismos y no duplica.
 * Sacarlos con `crypto.randomUUID()` en el navegador daba uno distinto al que
 * pintó el servidor. Al corregir un observado va un solo código, el suyo.
 */
export function FormularioReporteDiario({
  ids,
  cuentaId,
  hoy,
  minimo,
  personal,
  codigos,
  corrige = null,
  codigoInicial = '',
  opcionesIniciales = [],
  errorOpcionesIniciales = null,
  subcontratoInicial = null,
}: {
  /** Uno por cada código que puede llevar el reporte; al corregir, el primero. */
  ids: string[]
  cuentaId: string
  hoy: string
  minimo: string
  personal: OpcionPersona[]
  codigos: string[]
  corrige?: ReporteACorregir | null
  /** El código con que se abre (al reportar el avance de un subcontrato). */
  codigoInicial?: string
  /** Lo que se puede elegir en el código con que se abre. */
  opcionesIniciales?: OpcionDeTrabajo[]
  /** Si no se pudo leer lo que se puede elegir en ese código. */
  errorOpcionesIniciales?: string | null
  /** El subcontrato cuyo avance se viene a reportar: el primer trabajo se abre sobre él. */
  subcontratoInicial?: string | null
}) {
  const router = useRouter()
  const [dia, setDia] = useState(corrige?.fecha ?? hoy)
  const [secciones, setSecciones] = useState<Seccion[]>(() => {
    const codigo = corrige?.codigo_interno ?? codigoInicial
    // Al corregir, lo que el observado llevaba y ese día ya no entra.
    const sinLugar = (corrige?.trabajos ?? []).filter(
      (t) => t.sobre !== NUEVA && !opcionesIniciales.some((o) => claveDe(o) === t.sobre),
    )
    return [
      {
        clave: 'codigo-1',
        id: ids[0],
        codigo,
        opciones: opcionesIniciales,
        // Sin leer, el código se vuelve a leer en cuanto la persona lo toque.
        codigoLeido: errorOpcionesIniciales ? '' : codigo.trim().toUpperCase(),
        diaLeido: corrige?.fecha ?? hoy,
        leyendo: false,
        errorOpciones: errorOpcionesIniciales,
        quitados: corrige && sinLugar.length > 0 ? noEntra(sinLugar.map((t) => t.descripcion), corrige.fecha) : null,
        trabajos:
          corrige && corrige.trabajos.length > 0
            ? corrige.trabajos.map((t, i) => ({
                clave: `codigo-1-trabajo-${i + 1}`,
                sobre: sinLugar.includes(t) ? '' : t.sobre,
                descripcion: t.sobre === NUEVA ? t.descripcion : '',
                avance: String(t.avance),
                personal: filasDe(t.personal, `codigo-1-trabajo-${i + 1}`),
              }))
            : [
                {
                  ...nuevoTrabajo('codigo-1-trabajo-1'),
                  sobre: opcionesIniciales.some((o) => o.tipo === 'SUBCONTRATO' && o.id === subcontratoInicial)
                    ? `SUBCONTRATO:${subcontratoInicial}`
                    : '',
                },
              ],
        general: corrige?.general ?? false,
        personalGeneral: filasDe(corrige?.personal_general ?? [], 'codigo-1-general'),
        fotos: [],
        fotosPrevias: corrige?.fotos ?? [],
      },
    ]
  })
  // Los ids que ningún código usa todavía; el de un código quitado vuelve aquí.
  const [libres, setLibres] = useState(() => ids.slice(1))
  const espera = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pedido = useRef(new Map<string, number>())
  // Las fotos del envío que sigue en camino, y las rutas del que no se sabe
  // cómo terminó (no llegó la respuesta): pudo nombrarlas. Ni al saberse vieja
  // la pestaña ni con «Volver a cargar» se quitan, como en `useFotosDelEnvio`.
  // Se quitaban: el reporte en camino no entraba porque su foto ya no estaba, y
  // del que sí había entrado se decía «Se quitó… elígela otra vez», y subirlo
  // otra vez lo duplicaba con sus horas (trigesimoprimera pasada).
  const enCamino = useRef(new Set<FotoLista>())
  const enDuda = useRef(new Set<string>())
  const [enDudaElAnterior, setEnDudaElAnterior] = useState(false)
  const { alEnviar, enviando, error, resultado } = useEnvio(
    async (previo: unknown, datos: FormData) => {
      const van = secciones.flatMap((s) => s.fotos)
      for (const f of van) enCamino.current.add(f)
      const dudar = () => {
        for (const f of van) if (f.ruta) enDuda.current.add(f.ruta)
        setEnDudaElAnterior(true)
      }
      let salida: ResultadoAccion<{ id: string }>
      try {
        salida = await (corrige ? registrarReporteCorregido : registrarReportesDiarios)(previo, datos)
      } catch (e) {
        if (!esDeLaVersionAnterior(e)) {
          // Lo cortó la traba antes de salir: no se envió nada. Lo demás no se sabe.
          if (!(e instanceof OtraCuentaEnLaPestana)) dudar()
          throw e
        }
        // Una pestaña de antes del último despliegue: la acción no corrió, y al
        // recargar el formulario sale con otros ids. Las fotos ya subidas no las
        // nombraría nadie: se quitan, y se dice que hay que elegirlas otra vez
        // (vigesimonovena pasada; como `conFotos` en las demás ventanas). Las de
        // un envío anterior en duda se quedan, y lo dice el texto de abajo.
        const sueltas = (s: Seccion) => s.fotos.filter((f) => !(f.ruta && enDuda.current.has(f.ruta)))
        const habia = secciones.some((s) => sueltas(s).length > 0)
        for (const s of secciones) quitarFotosSueltas(BUCKET_FOTOS_REPORTE, sueltas(s))
        setSecciones((ss) => ss.map((s) => ({ ...s, fotos: s.fotos.filter((f) => f.ruta && enDuda.current.has(f.ruta)) })))
        return { ok: false, error: habia && !enDudaElAnterior ? SE_ACTUALIZO_CON_FOTOS : SE_ACTUALIZO_EL_SISTEMA }
      } finally {
        for (const f of van) enCamino.current.delete(f)
      }
      if (!salida.ok && pudoHaberEntrado(salida.error)) {
        dudar()
        return salida
      }
      // Con los mismos ids, cualquier otra respuesta dice también cómo terminó el anterior.
      enDuda.current.clear()
      setEnDudaElAnterior(false)
      // El reporte ya había entrado la primera vez: lo de este envío no se
      // guardó, y sus fotos nuevas no las nombra nadie. Se quitan (las de la
      // primera vez, que su reporte nombra, la base no las deja quitar), y la
      // pantalla lleva al reporte en vez de ofrecer subirlo otra vez.
      if (!salida.ok && yaEntroLaPrimeraVez(salida.error)) {
        for (const s of secciones) quitarFotosSueltas(BUCKET_FOTOS_REPORTE, s.fotos)
        setSecciones((ss) => ss.map((s) => ({ ...s, fotos: [] })))
      }
      return salida
    },
    (r, desde) => {
      const { url, ...dicho } = idaAlReporte(r.datos?.id ?? ids[0])
      navegarSiEsDeLaPestana(router, url, desde, { ...dicho, juntoAlBoton: true })
    },
    { refrescar: false },
  )
  const yaEntro = yaEntroLaPrimeraVez(error)
  // Subido, el formulario se traba y lo dice junto al botón, salga la ida o no (`YaQuedo`).
  const entro = resultado?.ok ? idaAlReporte(resultado.datos?.id ?? ids[0]) : null
  const vieja = usePestanaDeLaVersionAnterior()

  // Las fotos ya subidas que nadie va a nombrar si la pantalla se recarga. Se
  // leen de aquí, no del pintado en que se pidió quitarlas.
  const actuales = useRef(secciones)
  useEffect(() => {
    actuales.current = secciones
  })
  // Al saberse vieja la pestaña, como venga, sus fotos ya subidas se quitan en
  // el acto (`quitarAlSaberseVieja`): desde aquí el reporte ya no entra, y al
  // recargar, como pide el aviso de arriba, quedaban sueltas. Las de la
  // corrección (`fotosPrevias`) son del reporte que ya está y no se tocan.
  useEffect(
    () =>
      vigilarLaVersion(() => {
        if (!laPestanaEsDeLaVersionAnterior()) return
        const libres = actuales.current.flatMap((s) => s.fotos).filter((f) => !esDeUnEnvio(f, enCamino.current, enDuda.current))
        const marcar = quitarAlSaberseVieja(BUCKET_FOTOS_REPORTE, libres)
        if (marcar) setSecciones((ss) => ss.map((s) => ({ ...s, fotos: marcar(s.fotos) })))
      }),
    [],
  )
  // Y «Volver a cargar», el del aviso de arriba después de un despliegue, las
  // quita antes de recargar: antes quedaban sueltas (trigésima pasada).
  useEffect(
    () =>
      alVolverACargar(() =>
        Promise.all(
          actuales.current.map((s) =>
            quitarFotosSueltas(BUCKET_FOTOS_REPORTE, fotosSubidas(s).filter((f) => !esDeUnEnvio(f, enCamino.current, enDuda.current))),
          ),
        ),
      ),
    [],
  )

  // El cursor va al aviso, al final de un formulario largo: caía a la página.
  const aviso = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(enviando, error, () => aviso.current)

  const nombres = new Map(personal.map((p) => [p.valor, p.etiqueta]))
  // Lo que cada persona suma en todo el día, en todos los códigos: el tope es 16 horas.
  const porPersona = new Map<string, number>()
  for (const s of secciones) {
    for (const l of s.general ? s.personalGeneral : s.trabajos.flatMap((t) => t.personal)) {
      const h = horasDe(l.horas)
      if (l.trabajadorId && Number.isFinite(h)) porPersona.set(l.trabajadorId, (porPersona.get(l.trabajadorId) ?? 0) + h)
    }
  }
  const totalHoras = [...porPersona.values()].reduce((n, h) => n + h, 0)
  const sinPersonal = personal.length === 0
  const todasLasFotos = secciones.flatMap((s) => s.fotos)
  const subiendo = haySubiendo(todasLasFotos)
  const fallidas = hayFallidas(todasLasFotos)
  const soloSubcontratos = secciones.every((s) => s.trabajos.every((t) => t.sobre.startsWith('SUBCONTRATO:')))
  // El mismo código dos veces: la base lo rechaza; se dice antes, en el segundo.
  const repetidos = new Set(
    secciones
      .map((s, i) => ({ s, i, n: normalizarCodigo(s.codigo) }))
      .filter(({ n, i }) => n.length >= 2 && secciones.findIndex((x) => normalizarCodigo(x.codigo) === n) < i)
      .map(({ s }) => s.clave),
  )
  const varios = secciones.length > 1

  function cambiar(clave: string, cambio: Partial<Seccion> | ((s: Seccion) => Partial<Seccion>)) {
    setSecciones((ss) => ss.map((s) => (s.clave === clave ? { ...s, ...(typeof cambio === 'function' ? cambio(s) : cambio) } : s)))
  }

  /**
   * Al escribir el código (o cambiar el día) se piden sus planos, subcontratos
   * y tareas con lo que llevaban ese día, un momento después de la última
   * tecla. La respuesta de un pedido anterior se descarta, y lo elegido que el
   * código nuevo no tiene se vacía.
   */
  function leerCodigo(s: Seccion, texto: string, fecha: string) {
    const codigo = texto.trim().toUpperCase()
    const anterior = espera.current.get(s.clave)
    if (anterior) clearTimeout(anterior)
    const numero = (pedido.current.get(s.clave) ?? 0) + 1
    pedido.current.set(s.clave, numero)
    if (codigo === s.codigoLeido && fecha === s.diaLeido) {
      // Volvió a lo que ya estaba leído: lo que se pidió en medio ya no vale.
      cambiar(s.clave, { leyendo: false, errorOpciones: null })
      return
    }
    if (codigo.length < 2) {
      cambiar(s.clave, { opciones: [], codigoLeido: '', leyendo: false, errorOpciones: null, quitados: null })
      return
    }
    cambiar(s.clave, { leyendo: true, quitados: null })
    espera.current.set(
      s.clave,
      setTimeout(async () => {
        const r = await opcionesDelCodigo(codigo, corrige?.reemplaza ?? null, fecha).catch((e: unknown) => ({
          ok: false as const,
          error: motivoDelFallo(e, 'No llegó la respuesta. Revisa la conexión y vuelve a escribir el código.'),
        }))
        if (numero !== pedido.current.get(s.clave)) return
        cambiar(s.clave, (actual) => conOpciones(actual, r, codigo, fecha))
      }, 400),
    )
  }

  function agregarCodigo() {
    const [id, ...resto] = libres
    if (!id) return
    const clave = crypto.randomUUID()
    setLibres(resto)
    setSecciones((ss) => [
      ...ss,
      {
        clave,
        id,
        codigo: '',
        opciones: [],
        codigoLeido: '',
        diaLeido: dia,
        leyendo: false,
        errorOpciones: null,
        quitados: null,
        trabajos: [nuevoTrabajo()],
        general: false,
        personalGeneral: [nuevaPersona()],
        fotos: [],
        fotosPrevias: [],
      },
    ])
  }

  function quitarCodigo(s: Seccion) {
    const anterior = espera.current.get(s.clave)
    if (anterior) clearTimeout(anterior)
    // Las fotos ya subidas de ese código no las nombrará ningún reporte.
    quitarFotosSueltas(BUCKET_FOTOS_REPORTE, s.fotos)
    setSecciones((ss) => ss.filter((x) => x.clave !== s.clave))
    setLibres((ls) => [...ls, s.id])
  }

  return (
    <form
      onSubmit={(e) =>
        alEnviar(e, (datos) => {
          const [s] = secciones
          if (corrige) {
            datos.set('id', s.id)
            datos.set('reemplaza', corrige.reemplaza)
            datos.set('codigo_interno', s.codigo)
            datos.set('trabajos', JSON.stringify(trabajosParaEnviar(s)))
            datos.set('personal_general', s.general ? 'si' : '')
            datos.set('personal', JSON.stringify(s.general ? paraEnviar(s.personalGeneral) : []))
            datos.set('fotos', JSON.stringify(fotosDe(s)))
            return
          }
          datos.set(
            'codigos',
            JSON.stringify(
              secciones.map((x) => ({
                id: x.id,
                codigo_interno: x.codigo,
                trabajos: trabajosParaEnviar(x),
                general: x.general,
                personal_general: x.general ? paraEnviar(x.personalGeneral) : [],
                fotos: fotosDe(x),
              })),
            ),
          )
        })
      }
      className="space-y-6"
    >
      {/* Tras «ya quedó», lo de arriba ya no se envía: queda a la vista y trabado.
          Abierto, una foto elegida después subía y quedaba suelta (decimotercera pasada).
          Mientras se envía, también: lo elegido o quitado entonces no iba con el
          reporte (vigesimoséptima pasada). */}
      <fieldset disabled={yaEntro || enviando || Boolean(entro)} className="min-w-0 space-y-6">
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
                  for (const s of secciones) leerCodigo(s, s.codigo, e.target.value)
                }}
                min={minimo}
                max={hoy}
              />
            </Campo>
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
          </div>
          <Campo etiqueta="Breve descripción" htmlFor="rd-descripcion" requerido>
            <AreaTexto
              id="rd-descripcion"
              name="descripcion"
              required
              minLength={3}
              maxLength={1000}
              rows={2}
              placeholder="Lo que pasó hoy: qué se avanzó, qué falta, si algo trabó el trabajo."
              defaultValue={corrige?.descripcion}
            />
          </Campo>
        </section>

        <section aria-labelledby="rd-codigos-titulo" className="space-y-4">
          <h2 id="rd-codigos-titulo" className="text-sm font-semibold text-texto">
            {corrige ? 'Código interno' : varios ? `Códigos internos (${secciones.length})` : 'Código interno'}
          </h2>
          {secciones.map((s, n) => (
            <SeccionDelCodigo
              key={s.clave}
              seccion={s}
              numero={n + 1}
              varios={varios}
              repetido={repetidos.has(s.clave)}
              dia={dia}
              hoy={hoy}
              corrige={corrige !== null}
              cuentaId={cuentaId}
              codigos={codigos}
              personal={personal}
              sinPersonal={sinPersonal}
              alCambiar={(cambio) => cambiar(s.clave, cambio)}
              alEscribirCodigo={(texto) => {
                cambiar(s.clave, { codigo: texto })
                leerCodigo(s, texto, dia)
              }}
              alQuitar={varios ? () => quitarCodigo(s) : null}
            />
          ))}

          {!corrige && (
            <Boton type="button" variante="contorno" disabled={libres.length === 0} onClick={agregarCodigo} className="w-full sm:w-auto">
              <Plus aria-hidden className="size-4" />
              Agregar otro código interno
            </Boton>
          )}
          {!corrige && libres.length === 0 && (
            <p className="text-xs text-texto-suave">Un reporte lleva hasta {MAXIMO_CODIGOS_REPORTE} códigos: el resto, en otro reporte.</p>
          )}
        </section>

        <section aria-labelledby="rd-personal" className="space-y-3">
          <h2 id="rd-personal" className="text-sm font-semibold text-texto">
            Tu gente en el día
          </h2>
          {sinPersonal ? (
            <p role="alert" className="rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto">
              No hay nadie de planilla de taller en Maestranza, Producción o Acabados. Sin esa lista no se pueden cargar las horas: pídele
              a Recursos Humanos que registre a tu gente en Personal, con su área y en la planilla de taller.
            </p>
          ) : porPersona.size === 0 ? (
            <p className="text-xs text-texto-suave">Aquí se suman las horas de cada persona en todos los códigos del reporte.</p>
          ) : (
            <div className="rounded-lg bg-superficie-2 px-3 py-2 text-xs text-texto-suave" aria-live="polite" data-resumen-personal>
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
      </fieldset>

      {error && (
        <p
          ref={aviso}
          tabIndex={-1}
          role="alert"
          data-ya-entro={yaEntro || undefined}
          className={yaEntro ? 'rounded-[var(--radius-base)] bg-info-suave px-3 py-2 text-sm text-texto' : 'text-sm text-peligro'}
        >
          {yaEntro
            ? 'Este reporte ya quedó registrado la primera vez que lo enviaste, y lo que cambiaste después no se guardó. Ábrelo con «Ver el reporte»: ahí está lo que quedó y, si hay que cambiar algo, cómo corregirlo.'
            : error}
        </p>
      )}
      {vieja && enDudaElAnterior ? (
        <p className="text-sm text-peligro">
          No se sabe si entró el reporte que enviaste: búscalo en Reportes diarios antes de volver a cargar la pantalla y subirlo otra vez.
        </p>
      ) : (
        fallidas &&
        !subiendo && (
          <p className="text-sm text-peligro">
            {vieja ? 'Vuelve a cargar la pantalla para subir el reporte.' : 'Quita o vuelve a subir las fotos que no entraron antes de subir el reporte.'}
          </p>
        )
      )}
      {repetidos.size > 0 && <p className="text-sm text-peligro">Un código va dos veces: junta sus trabajos en uno solo.</p>}
      <YaQuedo ida={entro} />
      <div className="flex justify-end">
        {yaEntro ? (
          <EnlaceBoton href={`/reportes-diarios/${secciones[0]?.id ?? ids[0]}`} className="w-full sm:w-auto">
            Ver el reporte
          </EnlaceBoton>
        ) : (
          <Boton
            type="submit"
            cargando={enviando}
            disabled={(sinPersonal && !soloSubcontratos) || subiendo || fallidas || repetidos.size > 0 || Boolean(entro)}
            className="w-full sm:w-auto"
          >
            {subiendo
              ? 'Esperando las fotos…'
              : corrige
                ? 'Subir el reporte corregido'
                : varios
                  ? `Subir reporte de ${secciones.length} códigos`
                  : 'Subir reporte'}
          </Boton>
        )}
      </div>
    </form>
  )
}

const idaAlReporte = (id: string) => ({ url: `/reportes-diarios/${id}?subido=1`, dice: 'El reporte quedó registrado.', enlace: 'Ver el reporte' })

/**
 * Un código interno del reporte: el código, sus trabajos con su avance y su
 * gente, y sus fotos. Con varios, cada uno en su recuadro numerado.
 */
function SeccionDelCodigo({
  seccion: s,
  numero,
  varios,
  repetido,
  dia,
  hoy,
  corrige,
  cuentaId,
  codigos,
  personal,
  sinPersonal,
  alCambiar,
  alEscribirCodigo,
  alQuitar,
}: {
  seccion: Seccion
  numero: number
  varios: boolean
  repetido: boolean
  dia: string
  hoy: string
  corrige: boolean
  cuentaId: string
  codigos: string[]
  personal: OpcionPersona[]
  sinPersonal: boolean
  alCambiar: (cambio: Partial<Seccion> | ((s: Seccion) => Partial<Seccion>)) => void
  alEscribirCodigo: (texto: string) => void
  alQuitar: (() => void) | null
}) {
  // El primero conserva el id de siempre: lo buscan los recorridos del banco.
  const idCodigo = s.clave === 'codigo-1' ? 'rd-codigo' : `rd-${s.clave}-codigo`
  const porClave = new Map(s.opciones.map((o) => [claveDe(o), o]))
  const elegidos = new Set(s.trabajos.map((t) => t.sobre).filter((v) => v && v !== NUEVA))
  const nombre = s.codigo.trim().toUpperCase() || `Código ${numero}`

  function cambiarTrabajo(clave: string, cambio: Partial<FilaTrabajo>) {
    alCambiar((actual) => ({ trabajos: actual.trabajos.map((t) => (t.clave === clave ? { ...t, ...cambio } : t)) }))
  }

  return (
    <fieldset
      className={cn('min-w-0 space-y-4 rounded-xl border p-3 sm:p-4', repetido ? 'border-peligro' : 'border-borde')}
      data-codigo-reporte={numero}
    >
      <legend className="sr-only">{varios ? `Código ${numero}: ${nombre}` : 'Código interno'}</legend>
      {/* El número y «Quitar» van arriba: el código, que es largo, usa todo el ancho. */}
      {varios && (
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-texto">
            <span
              aria-hidden
              className="inline-flex size-7 flex-none items-center justify-center rounded-full bg-acento-suave text-acento tabular"
            >
              {numero}
            </span>
            Código {numero}
          </span>
          {alQuitar && (
            <Boton type="button" variante="fantasma" tamano="sm" aria-label={`Quitar ${nombre} del reporte`} onClick={alQuitar}>
              <Trash2 aria-hidden className="size-4" />
              Quitar
            </Boton>
          )}
        </div>
      )}
      <Campo
        etiqueta="Código interno"
        htmlFor={idCodigo}
        requerido
        ayuda={numero === 1 ? 'El de la unidad, por ejemplo PLA_SR_O4_1_26/28; PLANTA si no es para una unidad.' : undefined}
      >
        <BuscadorCodigo
          id={idCodigo}
          codigos={codigos}
          valor={s.codigo}
          alCambiar={alEscribirCodigo}
          soloLectura={corrige}
          invalido={repetido}
        />
      </Campo>
      {repetido && (
        <p role="alert" className="text-xs text-peligro">
          Este código ya está más arriba: junta sus trabajos en uno solo.
        </p>
      )}

      <div className="space-y-3">
        <p className={cn('text-xs', s.errorOpciones ? 'text-peligro' : 'text-texto-suave')} aria-live="polite" data-opciones>
          {s.leyendo
            ? 'Buscando los planos, subcontratos y tareas del código…'
            : s.errorOpciones
              ? s.errorOpciones
              : !s.codigoLeido
                ? 'Escribe el código interno para ver sus planos, subcontratos y las tareas que siguen.'
                : `${s.quitados ? `${s.quitados} ` : ''}${
                    s.opciones.length > 0
                      ? `${s.codigoLeido}: ${s.opciones.length} ${s.opciones.length === 1 ? 'cosa' : 'cosas'} para reportar en tu área, o una tarea nueva.`
                      : s.codigoLeido === CODIGO_SIN_AVANCE
                        ? `${CODIGO_SIN_AVANCE} no lleva avance: anota el trabajo del día como tarea nueva.`
                        : `${s.codigoLeido} no tiene planos ni subcontratos de tu área, ni tareas abiertas. Revisa que el código esté bien escrito; si lo está, anota una tarea nueva.`
                  }`}
        </p>
        {s.trabajos.map((t, i) => {
          const elegida = porClave.get(t.sobre) ?? null
          // El avance solo sube: más que lo que llevaba ese día y menos que lo de un día posterior.
          const lleva = elegida?.avance ?? null
          const tope = elegida?.tope ?? null
          const desde = lleva !== null ? lleva + 1 : 0
          const hasta = tope !== null ? tope - 1 : 100
          const escrito = t.avance.trim() === '' ? null : Number(t.avance)
          const lista: OpcionBuscable[] = [
            ...s.opciones
              .filter((o) => claveDe(o) === t.sobre || !elegidos.has(claveDe(o)))
              .map((o) => ({ valor: claveDe(o), etiqueta: o.etiqueta, detalle: detalleDe(o, dia < hoy) })),
            {
              valor: NUEVA,
              etiqueta: 'Tarea nueva',
              detalle: 'Lo que el plano no trae: queda en el código para tus próximos reportes',
            },
          ]
          const titulo = varios ? `${nombre}, trabajo ${i + 1}` : `Trabajo ${i + 1}`
          return (
            <fieldset key={t.clave} className="min-w-0 space-y-3 rounded-lg border border-borde bg-superficie p-3" data-trabajo={i + 1}>
              <legend className="sr-only">{titulo}</legend>
              <div className="flex items-center justify-between gap-2">
                <p aria-hidden className="text-sm font-medium text-texto">
                  Trabajo {i + 1}
                </p>
                <Boton
                  type="button"
                  variante="fantasma"
                  tamano="icono"
                  aria-label={`Quitar ${varios ? `el trabajo ${i + 1} de ${nombre}` : `el trabajo ${i + 1}`}`}
                  disabled={s.trabajos.length === 1}
                  onClick={() => alCambiar((actual) => ({ trabajos: actual.trabajos.filter((x) => x.clave !== t.clave) }))}
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
                  marcador="Elige el plano, el subcontrato o la tarea"
                  marcadorBusqueda="Plano, subcontrato o tarea…"
                  etiquetaAccesible={`${titulo}: sobre qué`}
                  requerido
                  permiteVaciar={false}
                />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                {t.sobre === NUEVA ? (
                  <Campo
                    etiqueta="Qué tarea es"
                    htmlFor={`rd-trabajo-${t.clave}`}
                    requerido
                    ayuda="Queda en el código: en tus próximos reportes la eliges en «Sobre qué» para sumarle avance."
                  >
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
                          ? corrige
                            ? 'Sin contar el reporte que corriges, nadie lo reportó antes de este día.'
                            : 'Todavía nadie lo reportó.'
                          : `Iba en ${lleva} % el ${fechaCorta(elegida.ultima_fecha)}: pon en cuánto ${dia < hoy ? 'iba ese día' : 'va ahora'}, de ${desde} a 100.`
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
              {/* Cuánto sube con este reporte: de lo que llevaba a lo que se pone. */}
              {t.sobre !== '' && (lleva !== null || (escrito !== null && Number.isFinite(escrito))) && (
                <Progreso
                  valor={escrito !== null && Number.isFinite(escrito) ? escrito : lleva}
                  mostrarValor
                  alto="sm"
                  etiqueta={`${titulo}: avance`}
                />
              )}
              {!s.general && t.sobre.startsWith('SUBCONTRATO:') && (
                <p className="text-xs text-texto-suave">El subcontratista no va en el personal: pon a tu gente solo si ayudó.</p>
              )}
              {!s.general && (
                <ListaPersonal
                  titulo={`Personal ${varios ? `de ${nombre}, trabajo ${i + 1}` : `del trabajo ${i + 1}`}`}
                  visible={`Personal del trabajo ${i + 1}`}
                  filas={t.personal}
                  alCambiar={(filas) => cambiarTrabajo(t.clave, { personal: filas })}
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
          disabled={s.trabajos.length >= MAXIMO_TRABAJOS_REPORTE}
          onClick={() => alCambiar((actual) => ({ trabajos: [...actual.trabajos, nuevoTrabajo()] }))}
        >
          <Plus aria-hidden className="size-4" />
          Agregar trabajo{varios && <span className="sr-only"> en {nombre}</span>}
        </Boton>
      </div>

      {!sinPersonal && (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-borde px-3 py-2.5">
          <input
            type="checkbox"
            checked={s.general}
            onChange={(e) => alCambiar({ general: e.target.checked })}
            className="mt-0.5 size-5 flex-none accent-[var(--acento)]"
          />
          <span>
            <span className="block text-sm font-medium text-texto">
              Personal general{' '}
              {varios ? (
                <>
                  para todo este código<span className="sr-only"> {nombre}</span>
                </>
              ) : (
                'para todo el reporte'
              )}
            </span>
            <span className="block text-xs text-texto-suave">
              Márcalo si la misma gente trabajó en todo lo {varios ? 'de este código' : 'del reporte'}: la pones una sola vez, con sus
              horas, en lugar de en cada trabajo.
            </span>
          </span>
        </label>
      )}
      {s.general && (
        <ListaPersonal
          titulo={varios ? `Personal general de ${nombre}` : 'Personal general del reporte'}
          visible={varios ? 'Personal general de este código' : undefined}
          filas={s.personalGeneral}
          alCambiar={(filas) => alCambiar({ personalGeneral: filas })}
          opciones={personal}
          deshabilitado={sinPersonal}
        />
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-texto-suave">
          {varios ? (
            <>
              Fotos de este código<span className="sr-only"> {nombre}</span>
            </>
          ) : (
            'Fotos del trabajo'
          )}
        </p>
        {s.fotosPrevias.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Fotos del reporte observado">
            {s.fotosPrevias.map((f, i) => (
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
                  onClick={() => alCambiar((actual) => ({ fotosPrevias: actual.fotosPrevias.filter((x) => x.ruta !== f.ruta) }))}
                  className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full bg-superficie/90 text-texto shadow"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <SelectorFotos
          fotos={s.fotos}
          alCambiar={(cambio) => alCambiar((actual) => ({ fotos: typeof cambio === 'function' ? cambio(actual.fotos) : cambio }))}
          prefijoRuta={`${cuentaId}/${s.id}`}
          maximo={MAXIMO_FOTOS_REPORTE - s.fotosPrevias.length}
          bucket={BUCKET_FOTOS_REPORTE}
          comprimir
          maximoMb={MAXIMO_MB_FOTO_REPORTE}
          titulo={null}
        />
      </div>
    </fieldset>
  )
}

/** Las personas de un trabajo (o del código entero), cada una con sus horas. */
function ListaPersonal({
  titulo,
  visible,
  filas,
  alCambiar,
  opciones,
  deshabilitado,
}: {
  titulo: string
  /** Lo que se lee en la pantalla, si es más corto que `titulo`. */
  visible?: string
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
      <p aria-hidden className="text-xs font-medium text-texto-suave">
        {visible ?? titulo}
      </p>
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
