'use client'

import { ArrowUpFromLine } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'

import { EntradaCodigoInterno, type CodigoParaElegir } from '@/components/codigo-interno/elegir-codigo'
import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import { type Almacen, ALMACENES, exigeFormato, redondearCantidad, topeDeCantidad } from '@/lib/dominio/almacen'
import {
  CODIGO_FIJO_OFICINA, CODIGO_FIJO_PLANTA, CODIGO_TODOS_LOS_ACTIVOS, CODIGOS_FIJOS, llavePlaca, normalizarCodigo, vehiculosDeLaPlaca as vehiculosConLaPlaca,
} from '@/lib/dominio/codigos-internos'
import { SIN_RESPUESTA, useEnvio } from '@/lib/envio'
import { cantidad } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'

import { registrarSalidaAlmacen, type SalidaRegistrada } from './acciones'

/** Lo que ya es de un código interno: lo que separaron sus RQ abiertos y lo que entró para su unidad. */
export type SeparadoDeCodigo = {
  codigo: string; cantidad: number; de_requerimientos: number; requerimientos: string[]
  /** Los accesorios que entraron para la unidad y siguen ahí: solo salen hacia ella. */
  del_kardex: number
  /** Lo separado por cada línea de RQ. */
  lineas: { linea: string; numero: string; cantidad: number }[]
}
export type MaterialParaSalida = {
  id: string; codigo: string; descripcion: string; unidad: string | null; almacen: Almacen | null
  /** Lo que puede salir por aquí: lo que hay menos lo apartado para pedidos de OT. */
  disponible: number
  /** Lo apartado para pedidos de OT: sale con su despacho, no por aquí. */
  reservadoOt: number
  /** Lo libre de «Stock en almacén»: lo que no es de ningún código. */
  libre: number
  /** Todo lo separado para los códigos; puede pasar lo que hay. */
  separado: number
  /** Cuánto se separó por encima de lo que hay. */
  deMas: number
  porCodigo: SeparadoDeCodigo[]
}
/** Una línea de requerimiento con algo por entregar; la salida la descuenta. */
export type LineaRqParaElegir = {
  linea_id: string; requerimiento_id: string; numero: string; codigo_interno: string; area: string; item: number
  descripcion: string; unidad: string; almacen: Almacen | null; pendiente: number
  /** El material del catálogo con que se pidió; vacío en un material nuevo sin revisar. */
  material_id: string | null
  /** El que entró de su compra, si ya llegó; puede ser otra marca que el pedido. */
  material_comprado: string | null
}
export type UnidadParaElegir = { id: string; nombre: string; vehiculo: string | null; ordenes: string | null; codigo_interno: string | null; placa: string | null }

/**
 * Códigos que no son de una unidad: un accesorio sale a uno de ellos solo si
 * lo pide así su RQ (la base lo rechaza si no, migración 20261020196000).
 */
const NO_SON_UNIDAD = [CODIGO_FIJO_PLANTA.codigo, CODIGO_FIJO_OFICINA.codigo, CODIGO_TODOS_LOS_ACTIVOS]

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Si el material puede salir para el ítem de RQ elegido: uno de su almacén, o
 * lo que llegó de su compra aunque Logística lo haya comprado de otra categoría
 * (la base acepta lo mismo, migración 20261020196000). Sin RQ, cualquiera.
 */
function sirvePara(m: MaterialParaSalida, linea: LineaRqParaElegir | undefined) {
  return !linea?.almacen || !m.almacen || m.almacen === linea.almacen || m.id === linea.material_comprado
}

/**
 * Las partes de lo que hay, en orden, sin pasar de lo que hay: si se separó de
 * más, la última parte se corta. Lo que sobra es de otros.
 */
function partesDe(hay: number, partes: [number, (n: number) => string][]) {
  let queda = hay
  const textos = partes.flatMap(([n, texto], i) => {
    const parte = Math.min(n, queda)
    // Las cantidades llevan hasta tres decimales: sin redondear, quedan restos de coma flotante.
    queda = Math.round((queda - parte) * 1000) / 1000
    return parte > 0 || i === 0 ? [texto(parte)] : []
  })
  if (queda > 0) textos.push(`${cantidad(queda)} con dueño`)
  return textos
}

const enPlural = (n: number, uno: string, varios: string) => `${cantidad(n)} ${n === 1 ? uno : varios}`
/** «a», «a y b», «a, b y c». */
const enLista = (cosas: string[]) => cosas.length < 2 ? cosas.join('') : `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`

/**
 * De quién es lo que hay de un material, mirado desde esta salida, con la regla
 * de la base (stock_libre_en_almacen, migración 20261020196000): lo que separó
 * una línea de RQ se descuenta solo con una salida de esa línea, y lo que entró
 * para una unidad, con la salida que va a su código. Lo que sale con un RQ de
 * PLANTA hacia una unidad se cubre primero con lo que separó ese RQ, y lo que
 * pase de eso se le descuenta a la unidad. `destino` es el código con que sale
 * (el del RQ, o el elegido si el RQ es de PLANTA o no hay RQ). `puede`: cuánto
 * saca sin tocar lo que es de otros.
 */
function duenosDe(m: MaterialParaSalida, linea: LineaRqParaElegir | undefined, destino: string | null) {
  const ajenos: string[] = []
  // Los RQ del destino que separaron este material: sin RQ, la salida no se lo descuenta.
  const delDestino: string[] = []
  let delRq = 0
  let deLaUnidad = 0
  for (const c of m.porCodigo) {
    const codigo = normalizarCodigo(c.codigo)
    const paraLaUnidad = Math.max(redondearCantidad(c.cantidad - c.de_requerimientos), 0)
    if (codigo === destino) deLaUnidad += paraLaUnidad
    else if (paraLaUnidad > 0) ajenos.push(`${cantidad(paraLaUnidad)} de ${c.codigo}, para su unidad`)
    if (c.de_requerimientos <= 0) continue
    if (c.lineas.length === 0) {
      // Quien no ve los RQ recibe el total, sin las líneas.
      ajenos.push(`${cantidad(c.de_requerimientos)} de ${c.codigo}${c.requerimientos.length > 0 ? ` (${c.requerimientos.join(', ')})` : ''}`)
      continue
    }
    const porRq = new Map<string, number>()
    for (const l of c.lineas) {
      if (l.cantidad <= 0) continue
      if (linea && l.linea === linea.linea_id) delRq += l.cantidad
      else porRq.set(l.numero, (porRq.get(l.numero) ?? 0) + l.cantidad)
    }
    for (const [numero, n] of porRq) {
      ajenos.push(`${cantidad(n)} de ${c.codigo} (${numero}${numero === linea?.numero ? ', otro ítem' : ''})`)
      if (!linea && codigo === destino) delDestino.push(numero)
    }
  }
  // Con un RQ de otro código (uno de PLANTA hacia una unidad), la base cubre con
  // lo de este RQ solo lo que está fuera de lo que entró para las unidades; lo
  // demás se lo descuenta a la unidad (registrar_salida_material).
  if (linea && normalizarCodigo(linea.codigo_interno) !== destino) {
    const deLasUnidades = m.porCodigo.reduce((suma, c) => suma + c.del_kardex, 0)
    delRq = Math.min(delRq, Math.max(topeDeCantidad(m.disponible - deLasUnidades), 0))
  }
  // Las sumas, a los tres decimales de la base: 0.1 + 0.2 daba 0.30000000000000004,
  // y esa propuesta la base la rechazaba con un motivo que no era. Lo que puede
  // salir, cortado y no redondeado: no pasa de lo que hay.
  delRq = redondearCantidad(delRq)
  deLaUnidad = redondearCantidad(deLaUnidad)
  return { ajenos, delDestino, delRq, deLaUnidad, puede: Math.min(m.disponible, topeDeCantidad(m.libre + delRq + deLaUnidad)) }
}

/**
 * Cuánto de un accesorio puede salir hacia `destino`: lo que entró para otra
 * unidad sale solo hacia ella, y la base rechaza lo demás (la misma cuenta que
 * registrar_salida_material). PLANTA no es una unidad.
 */
function topeDeAccesorio(m: MaterialParaSalida, destino: string | null) {
  if (m.almacen !== 'ACCESORIOS' || destino === null) return null
  const deOtras = redondearCantidad(m.porCodigo
    .filter((c) => normalizarCodigo(c.codigo) !== destino && normalizarCodigo(c.codigo) !== CODIGO_FIJO_PLANTA.codigo)
    .reduce((suma, c) => suma + c.del_kardex, 0))
  return deOtras > 0 ? { deOtras, tope: Math.max(topeDeCantidad(m.disponible - deOtras), 0) } : null
}

/**
 * Salida de material sin solicitud de OT. Nada sale del almacén sin decir a qué
 * unidad va: un vehículo registrado o, si todavía no está en el sistema, su
 * código interno, elegido de la misma lista que el RQ (se busca también por la
 * placa o la marca).
 */
export function NuevaSalida({ materiales, unidades, codigos, lineasRq = [], rqConSalida = [], rqInicial, stockLeido = true }: {
  materiales: MaterialParaSalida[]; unidades: UnidadParaElegir[]; lineasRq?: LineaRqParaElegir[]
  /**
   * De los RQ cuyo código es la placa de un vehículo con otro código, los que ya
   * tienen una salida cargada a ese código: el suyo ya no se corrige. `null` si
   * no se pudo leer.
   */
  rqConSalida?: string[] | null
  /** Si se pudo leer lo separado para cada código; si no, «libre» es lo que da el kardex. */
  stockLeido?: boolean
  /** La lista de códigos internos; `null` si no se pudo leer, y el código se escribe a mano. */
  codigos: CodigoParaElegir[] | null
  /** Un requerimiento que viene de «Atención»: la ventana se abre con su primer ítem elegido. */
  rqInicial?: string
}) {
  // La primera línea pendiente del RQ que mandó la pantalla de atención, si la hay.
  const lineaInicial = rqInicial ? lineasRq.find((l) => l.requerimiento_id === rqInicial)?.linea_id ?? '' : ''
  // La salida trae elegido el material que llegó de la compra del insumo (puede
  // ser otra marca que el pedido) y, si no hay de ese, el que se pidió; cada uno
  // solo si tiene saldo.
  const materialDelRq = (lineaId: string) => {
    const l = lineasRq.find((x) => x.linea_id === lineaId)
    const conSaldo = (id: string | null | undefined) => Boolean(id) && materiales.some((m) => m.id === id && m.disponible > 0 && sirvePara(m, l))
    return [l?.material_comprado, l?.material_id].find(conSaldo) ?? ''
  }
  const [abierta, setAbierta] = useState(Boolean(lineaInicial))
  const [id, setId] = useState(() => crypto.randomUUID())
  const [materialId, setMaterialId] = useState(() => materialDelRq(lineaInicial))
  const [lineaId, setLineaId] = useState(lineaInicial)
  const [destino, setDestino] = useState<'UNIDAD' | 'CODIGO'>(unidades.length > 0 ? 'UNIDAD' : 'CODIGO')
  const [unidadId, setUnidadId] = useState('')
  // El código va aquí y no dentro del campo: al seguir con el ítem siguiente
  // del RQ, o al ir a «Vehículo registrado» y volver, el formulario se rehace y
  // el código elegido se perdía. El que ya salió vale como está al seguir.
  const [codigo, setCodigo] = useState('')
  const [codigoAceptado, setCodigoAceptado] = useState('')
  const codigoEnviado = useRef('')
  const router = useRouter()
  const boton = useRef<HTMLButtonElement>(null)
  // El RQ que mandó «Atención». Se guarda al abrir: sus ítems se sacan uno
  // detrás de otro, y al terminar el último se ofrece volver a marcarlo
  // entregado, que es el paso que sigue.
  const [deAtencion] = useState(lineaInicial ? rqInicial : undefined)
  const [sigue, setSigue] = useState<string | null>(null)
  // Los RQ de los que salió algo en esta ventana, con lo que decía la página al
  // registrarlo: el ítem siguiente decía unos segundos, hasta que llegaba la
  // página, que el código del RQ todavía se corregía, y la base ya no lo deja.
  // Cuenta solo hasta que llega la página: después manda ella, también si la
  // salida se devolvió entera en la misma visita.
  const [rqSalieron, setRqSalieron] = useState<{ rq: string; antes: string[] | null }[]>([])
  const [volver, setVolver] = useState<'ENTREGAR' | 'VER' | null>(null)
  // Lo que salió en el último envío: si fue menos de lo que faltaba, al ítem
  // todavía le queda y no se invita a marcar el RQ entregado.
  const cantidadEnviada = useRef(0)
  // Quién recibe: el ítem siguiente del mismo RQ suele ir a la misma persona,
  // y volver a escribirlo en el teléfono, ítem por ítem, cansa.
  const recibioEnviado = useRef('')
  const [recibe, setRecibe] = useState('')
  // La cantidad que escribió Almacén, para este envío, ítem y material. Con un
  // RQ de PLANTA la propuesta cambia con el destino, que se elige después: lo
  // escrito no lo toca (antes la cantidad volvía a la propuesta y salía esa).
  const [escrita, setEscrita] = useState<{ para: string; valor: string } | null>(null)

  function cerrar({ cancelada }: { cancelada: boolean }) {
    setAbierta(false)
    setSigue(null)
    // Cancelada, la que nació abierta desde un RQ no vuelve a abrirse al
    // recargar. Después de una salida el enlace se queda: si al ítem le falta,
    // recargar la abre de nuevo con él.
    if (cancelada && rqInicial) router.replace('/almacen/kardex', { scroll: false })
    // Si nació abierta, no hay botón que la abrió al que devolver el foco.
    boton.current?.focus()
  }

  const { alEnviar, enviando, error, resultado } = useEnvio<SalidaRegistrada>(async (_previo, datos) => {
    cantidadEnviada.current = Number(datos.get('cantidad'))
    recibioEnviado.current = String(datos.get('recibido_por_nombre') ?? '')
    codigoEnviado.current = String(datos.get('codigo_unidad') ?? '')
    const archivo = datos.get('foto')
    if (!(archivo instanceof File) || archivo.size === 0 || archivo.size > 10485760 || !TIPOS_FOTO.includes(archivo.type)) {
      return { ok: false, error: 'Selecciona una foto JPG, PNG o WebP de hasta 10 MB.' }
    }
    const db = createClient()
    const { data, error: sesion } = await db.auth.getUser()
    // Sin señal, supabase-js devuelve el fallo como error de sesión: no es que haya terminado.
    if (sesion?.name === 'AuthRetryableFetchError') return { ok: false, error: SIN_RESPUESTA }
    if (sesion || !data.user) return { ok: false, error: 'Tu sesión terminó. Ingresa de nuevo.' }
    const extension = archivo.type === 'image/jpeg' ? 'jpg' : archivo.type === 'image/png' ? 'png' : 'webp'
    const ruta = `${data.user.id}/${String(datos.get('operacion_id'))}.${extension}`
    datos.delete('foto')
    datos.set('foto_ruta', ruta)
    return subirArchivoPrivado({
      bucket: 'evidencias-almacen', ruta, archivo, contentType: archivo.type,
      registrar: () => registrarSalidaAlmacen(null, datos),
    })
  }, (registrada) => {
    const hecha = lineasRq.find((l) => l.linea_id === lineaId)
    if (hecha) setRqSalieron((s) => [...s, { rq: hecha.requerimiento_id, antes: rqConSalida }])
    const otra = deAtencion && hecha?.requerimiento_id === deAtencion
      ? lineasRq.find((l) => l.requerimiento_id === deAtencion && l.linea_id !== lineaId)
      : undefined
    setId(crypto.randomUUID())
    if (hecha && otra) {
      // Al RQ le queda otro ítem: la ventana sigue abierta con ese elegido.
      setLineaId(otra.linea_id)
      setMaterialId(materialDelRq(otra.linea_id))
      setRecibe(recibioEnviado.current)
      // El vehículo o el código elegido se quedan (unidadId no se toca): el
      // ítem siguiente suele ir al mismo destino.
      setCodigo(codigoEnviado.current)
      setCodigoAceptado(codigoEnviado.current)
      // Lo que le tocó a la unidad se dice aquí: al seguir, el mensaje de la salida no se ve.
      const deLaUnidad = registrada.datos?.deLaUnidad
      setSigue(`Salida del ítem ${hecha.item} registrada${deLaUnidad ? `: ${deLaUnidad}` : ''}. Sigue el ítem ${otra.item} de ${otra.numero}.`)
      return
    }
    setMaterialId('')
    setLineaId('')
    setUnidadId('')
    setRecibe('')
    setCodigo('')
    setCodigoAceptado('')
    setVolver(!hecha || hecha.requerimiento_id !== deAtencion ? null : cantidadEnviada.current >= hecha.pendiente ? 'ENTREGAR' : 'VER')
    cerrar({ cancelada: false })
  }, {
    // El id vive fuera de la ventana: tras «No llegó la respuesta», volver a
    // abrir lleva el mismo. Si la base dice que la primera ya quedó, la salida
    // siguiente es otra (20261023200000); antes ese id quedaba pegado hasta
    // recargar y cada salida siguiente decía que ya existía.
    alYaEntrar: () => setId(crypto.randomUUID()),
  })

  const linea = lineasRq.find((l) => l.linea_id === lineaId)
  const elegido = materiales.find((m) => m.id === materialId)
  // Con un requerimiento elegido se ofrecen solo los materiales de su almacén y
  // lo que llegó de su compra.
  const conSaldo = materiales.filter((m) => m.disponible > 0 && sirvePara(m, linea))
  // El RQ ya dice a qué unidad va; solo «PLANTA» deja elegir el destino.
  const destinoDelRq = linea && normalizarCodigo(linea.codigo_interno) !== CODIGO_FIJO_PLANTA.codigo ? linea.codigo_interno : null
  const regla = elegido?.almacen ? ALMACENES[elegido.almacen] : null
  // Un accesorio sale solo para una unidad, o al código de su RQ (aquí, PLANTA):
  // la lista no ofrece los demás que no son una unidad, que también llegan en
  // ella por los RQ que los usan, y el campo dice por qué si ya estaba escrito.
  const rqDelCampo = linea ? normalizarCodigo(linea.codigo_interno) : null
  const noSonUnidad = elegido?.almacen === 'ACCESORIOS'
    ? {
        codigos: NO_SON_UNIDAD.filter((c) => c !== rqDelCampo),
        motivo: rqDelCampo
          ? `El requerimiento es de ${rqDelCampo}: un accesorio sale a ${rqDelCampo} o al código de una unidad.`
          : 'Un accesorio sale solo para una unidad: elige su código. A PLANTA u OFICINA sale solo con el requerimiento que lo pide.',
      }
    : null
  const sinTope = elegido ? (linea ? Math.min(elegido.disponible, linea.pendiente) : elegido.disponible) : undefined
  // Lo que ya tiene dueño sale con su RQ, o para su unidad; para otro destino
  // es quitárselo, y la salida lo dice antes de enviar. La base no lo impide:
  // Almacén decide, sabiendo de quién es. El destino cuenta cuando ya está
  // elegido: un código a medio escribir no es todavía ninguno.
  const unidad = destino === 'UNIDAD' ? unidades.find((u) => u.id === unidadId) : undefined
  const escrito = normalizarCodigo(codigo)
  const codigoElegido = escrito && (escrito === normalizarCodigo(codigoAceptado)
    || CODIGOS_FIJOS.some((f) => normalizarCodigo(f.codigo) === escrito)
    || (codigos ?? []).some((c) => normalizarCodigo(c.codigo) === escrito)) ? escrito : null
  // Los vehículos de lo escrito, en el orden en que los busca la base: el de
  // ese código; si no, el de esa placa tal cual y, si ninguno la tiene así, por
  // sus letras y números (sin guion se tomaba por un código nuevo). La placa de
  // un vehículo sin código interno, si es un código de la lista, es ese código:
  // Requerimientos usa la placa como código del vehículo que todavía no lo
  // tiene. La de uno que ya tiene código va a su código, aunque la placa siga en
  // la lista de cuando no lo tenía. Si es de uno solo, la base vincula la salida
  // a él y lleva su código: con la placa escrita, el tope y los dueños se
  // miraban con la placa y no con su código.
  const sinCodigo = (u: UnidadParaElegir | undefined) => u !== undefined && !normalizarCodigo(u.codigo_interno ?? '')
  const porCodigo = escrito ? unidades.filter((u) => u.codigo_interno !== null && normalizarCodigo(u.codigo_interno) === escrito) : []
  const esDeLaLista = escrito !== '' && (CODIGOS_FIJOS.some((f) => normalizarCodigo(f.codigo) === escrito)
    || (codigos ?? []).some((c) => normalizarCodigo(c.codigo) === escrito))
  const vehiculosDeLaPlaca = (placa: string) => vehiculosConLaPlaca(unidades, placa)
  const deLaPlacaEscrita = escrito && porCodigo.length === 0 ? vehiculosDeLaPlaca(escrito) : []
  const esElCodigoDeLaLista = esDeLaLista && deLaPlacaEscrita.every(sinCodigo)
  const deUnaUnidad = porCodigo.length > 0 ? porCodigo : esElCodigoDeLaLista ? [] : deLaPlacaEscrita
  // La placa de dos vehículos (de dos clientes, o una con guion y otra sin él):
  // no se adivina cuál, y la base la rechaza. Con un RQ que fija el destino, lo
  // escrito antes ya no cuenta: el campo ni se ve.
  const placaDeVarios = !destinoDelRq && porCodigo.length === 0 && deUnaUnidad.length > 1
  // Los códigos de la lista con las mismas letras y números que la placa de un
  // vehículo sin código: el que le puso Requerimientos, escrito de otra manera
  // («Q243ER» para la Q24-3ER). Se ofrecen: la placa sola no llevaba a él. No
  // se ofrece el que la base lleva a otro vehículo, por su código o su placa.
  const codigosDeSuPlaca = (u: UnidadParaElegir | undefined) => !u || !sinCodigo(u) || !llavePlaca(u.placa ?? '') ? []
    : (codigos ?? []).filter((c) => !c.cerrado && llavePlaca(c.codigo) === llavePlaca(u.placa ?? '')
        && !unidades.some((x) => x.codigo_interno !== null && normalizarCodigo(x.codigo_interno) === normalizarCodigo(c.codigo))
        && vehiculosDeLaPlaca(normalizarCodigo(c.codigo)).every(sinCodigo))
      .map((c) => c.codigo)
  // Los códigos de la lista que son la placa de un solo vehículo sin código (el
  // que le puso Requerimientos) dicen de qué vehículo son, como la base los
  // busca: la lista decía «Sin unidad registrada» y la salida queda en él.
  const codigosConVehiculo = useMemo(() => {
    if (!codigos) return codigos
    const porPlaca = new Map<string, UnidadParaElegir[]>()
    const porLlave = new Map<string, UnidadParaElegir[]>()
    for (const u of unidades) {
      if (!u.placa) continue
      const tal = normalizarCodigo(u.placa)
      const llave = llavePlaca(u.placa)
      porPlaca.set(tal, [...(porPlaca.get(tal) ?? []), u])
      if (llave) porLlave.set(llave, [...(porLlave.get(llave) ?? []), u])
    }
    return codigos.map((c) => {
      if (c.unidad) return c
      const tal = normalizarCodigo(c.codigo)
      const suyos = porPlaca.get(tal) ?? (llavePlaca(tal) ? porLlave.get(llavePlaca(tal)) : undefined) ?? []
      const v = suyos.length === 1 && !normalizarCodigo(suyos[0].codigo_interno ?? '') ? suyos[0] : null
      return v ? { ...c, unidad: [v.placa, v.vehiculo, 'sin código en el padrón'].filter(Boolean).join(' · ') } : c
    })
  }, [codigos, unidades])
  // El código con que sale, como lo pone la base: el del RQ y, si el RQ es de
  // PLANTA o no hay RQ, el elegido o el del vehículo.
  const codigoDestino = destinoDelRq ? normalizarCodigo(destinoDelRq)
    : destino === 'CODIGO'
      ? deUnaUnidad.length === 1 ? (deUnaUnidad[0].codigo_interno ? normalizarCodigo(deUnaUnidad[0].codigo_interno) : null) : codigoElegido
    : unidad?.codigo_interno ? normalizarCodigo(unidad.codigo_interno) : null
  const duenos = elegido && stockLeido ? duenosDe(elegido, linea, codigoDestino) : null
  // El accesorio que entró para otra unidad no sale hacia esta: la base lo rechaza.
  const topeAccesorio = elegido && stockLeido ? topeDeAccesorio(elegido, codigoDestino) : null
  const limitaElTope = topeAccesorio !== null && sinTope !== undefined && topeAccesorio.tope < sinTope
  const maximo = limitaElTope ? topeAccesorio.tope : sinTope
  // Avisa si lo que puede salir pasa de lo que es de nadie o de esta salida, o
  // si se separó más de lo que hay.
  const avisar = duenos !== null && elegido !== undefined
    && ((duenos.ajenos.length > 0 && (maximo ?? 0) > duenos.puede) || elegido.deMas > 0)
  const puede = duenos ? Math.min(duenos.puede, maximo ?? duenos.puede) : 0
  // Con el tope en cero la base rechaza cualquier cantidad: no se deja enviar.
  const sinNada = limitaElTope && maximo !== undefined && maximo <= 0
  // Con un RQ se propone lo que falta, o lo que sale sin tocar lo de otros si
  // eso es menos; mientras Almacén no escriba, sigue al destino.
  const paraLaCantidad = `${id}-${lineaId}-${materialId}`
  const propuesta = linea && maximo ? (avisar ? (puede > 0 ? puede : undefined) : maximo) : undefined
  const cantidadEscrita = escrita?.para === paraLaCantidad ? escrita.valor : null
  // Un accesorio sale solo para una unidad con código interno: el vehículo que
  // no lo tiene, la base lo rechaza (y antes lo decía después de la foto).
  const accesorioSinRq = elegido?.almacen === 'ACCESORIOS' && !destinoDelRq
  const unidadSinCodigo = accesorioSinRq
    && (destino === 'UNIDAD' ? sinCodigo(unidad) : deUnaUnidad.length === 1 && sinCodigo(deUnaUnidad[0]))
  // La placa de un vehículo sin código, o la de dos vehículos, escrita en
  // «Código de la unidad», el buscador la rechaza con su motivo: antes la
  // ofrecía como código nuevo y, aceptada, decía que se registraba como estaba
  // escrita. Se compara tal cual: por letras y números escondía de la lista el
  // código que el motivo pide elegir («Q243ER» con «Q24-3ER» escrita).
  const deLaPlacaSinCodigo = destino === 'CODIGO' && deUnaUnidad.length === 1 ? codigosDeSuPlaca(deUnaUnidad[0]) : []
  const enLaLista = (codigosLista: string[]) => codigosLista.join(' o ')
  // Con un consumible, que sí sale al vehículo sin código, se avisa que su
  // código está en la lista por si el gasto es de él; un accesorio no sale.
  const avisoDelConsumible = !unidadSinCodigo && codigosDeSuPlaca(unidad).length > 0
    ? `Este vehículo no tiene código interno: la salida queda en él, sin código. En la lista de códigos está ${enLaLista(codigosDeSuPlaca(unidad))}: úsalo si el gasto es de él.`
    : null
  const notaDelCodigo = destino === 'CODIGO' && esElCodigoDeLaLista && deLaPlacaEscrita.length === 1
    ? `La salida queda en el ${deLaPlacaEscrita[0].vehiculo ?? 'vehículo'} ${deLaPlacaEscrita[0].placa} y el gasto va a ${escrito}.`
    : null
  const vetados = [
    ...(noSonUnidad ? [noSonUnidad] : []),
    ...(placaDeVarios && destino === 'CODIGO'
      ? [{ codigos: [escrito], exacto: true, motivo: 'Esa placa es de más de un vehículo registrado: elige el vehículo en «Vehículo registrado».' }]
      : []),
    ...(unidadSinCodigo && destino === 'CODIGO'
      ? [{
          codigos: [escrito],
          exacto: true,
          ofrecer: deLaPlacaSinCodigo,
          motivo: deLaPlacaSinCodigo.length > 0
            ? `Esa placa es de un vehículo sin código interno. En la lista está ${enLaLista(deLaPlacaSinCodigo)}: elígelo si es el suyo.`
            : 'Esa placa es de un vehículo sin código interno: elige su código de la lista. Si no está, todavía no lo tiene, y el accesorio no sale.',
        }]
      : []),
  ]
  // La placa de un solo vehículo vale sin confirmarla como código nuevo, y el
  // campo dice adónde va la salida: decía «se registra como está escrito» y la
  // base la vinculaba al vehículo. Si el costeo de su código está cerrado, lo
  // avisa como cuando se escribe el código.
  const deLaPlaca = destino === 'CODIGO' && porCodigo.length === 0 && deUnaUnidad.length === 1 && !unidadSinCodigo ? deUnaUnidad[0] : null
  const codigoDeLaPlaca = deLaPlaca?.codigo_interno ? normalizarCodigo(deLaPlaca.codigo_interno) : null
  const cerradoDeLaPlaca = codigoDeLaPlaca !== null && (codigos ?? []).some((c) => c.cerrado && normalizarCodigo(c.codigo) === codigoDeLaPlaca)
  const reconocidos = deLaPlaca
    ? [{
        codigos: [escrito],
        ofrecer: deLaPlacaSinCodigo,
        texto: (
          <>
            Placa {deLaPlaca.placa}{deLaPlaca.vehiculo ? `, del ${deLaPlaca.vehiculo}` : ''}
            {codigoDeLaPlaca ? (
              <>: la salida va a <span className="font-mono whitespace-nowrap">{codigoDeLaPlaca}</span>.</>
            ) : (
              ', sin código interno: la salida va al vehículo y no a un código.'
            )}
            {cerradoDeLaPlaca && (
              <span className="block text-aviso">Gerencia ya cerró el costeo de {codigoDeLaPlaca} al entregar la unidad. Revisa que sea para ese código.</span>
            )}
            {deLaPlacaSinCodigo.length > 0 && (
              <span className="block text-aviso">En la lista está {enLaLista(deLaPlacaSinCodigo)}: elígelo si es el suyo, y el gasto va a ese código.</span>
            )}
          </>
        ),
      }]
    : undefined
  // El código del RQ que es la placa de un vehículo con código: la base deja la
  // salida en el vehículo (y en su OT), pero el gasto va al código del RQ, no al
  // del vehículo. Se dice: el costeo de ese código no lo recibe.
  const rqEnPlacaDe = destinoDelRq && !unidades.some((u) => u.codigo_interno !== null && normalizarCodigo(u.codigo_interno) === normalizarCodigo(destinoDelRq))
    ? vehiculosDeLaPlaca(normalizarCodigo(destinoDelRq)) : []
  const conCodigoDelRq = rqEnPlacaDe.length === 1 && !sinCodigo(rqEnPlacaDe[0]) ? rqEnPlacaDe[0] : null
  // Qué hacer si el gasto es del código del vehículo: corregir el RQ, mientras
  // no haya salido nada cargado a su código (después la base no lo deja).
  // Con un RQ, la salida lleva el código del RQ, que no es el del vehículo: la que se acaba de registrar cuenta.
  const yaSalioDelRq = !linea ? null : rqSalieron.some((x) => x.rq === linea.requerimiento_id && x.antes === rqConSalida)
    || (rqConSalida ? rqConSalida.includes(linea.requerimiento_id) : null)
  const codigoDelVehiculo = conCodigoDelRq?.codigo_interno ? normalizarCodigo(conCodigoDelRq.codigo_interno) : null
  const queHacerConElRq = !codigoDelVehiculo ? '' : yaSalioDelRq === true
    ? `Ya salió parte de este RQ: su código ya no se corrige. Si lo que falta es para ${codigoDelVehiculo}, que Requerimientos registre otro RQ.`
    : yaSalioDelRq === false
      ? `Si es para ${codigoDelVehiculo}, que Requerimientos corrija el código del RQ antes de sacarlo.`
      : `Si es para ${codigoDelVehiculo}, que Requerimientos corrija el código del RQ antes de sacarlo; si ya salió algo de él, que registre otro RQ.`
  const avisoDelRq = destinoDelRq && conCodigoDelRq && codigoDelVehiculo
    ? `Es la placa del ${conCodigoDelRq.vehiculo ?? 'vehículo'}, que tiene el código ${codigoDelVehiculo}: la salida queda en el vehículo, `
      + `pero el gasto va a ${destinoDelRq}, como pide el RQ, y no al costeo de su código. ${queHacerConElRq}`
    : null
  const paraQuien = linea ? `Para ${linea.numero}` : codigoDestino ? `Para ${codigoDestino}` : null
  const enUnidad = (n: number) => `${cantidad(n)}${elegido?.unidad ? ` ${elegido.unidad}` : ''}`
  // Lo escrito se queda al cambiar de destino, y puede pasar del tope del nuevo:
  // se dice junto a la cantidad, no solo en la burbuja del navegador al confirmar.
  // La recepción guarda hasta cuatro decimales y la salida, tres: con 1.0005 en
  // el kardex, escribir 1.0005 decía «Hay 1: no sale más que eso».
  let motivoDeLaCantidad: string | undefined
  const escritaConMasDecimales = cantidadEscrita !== null && cantidadEscrita !== ''
    && Math.abs(Number(cantidadEscrita) * 1000 - Math.round(Number(cantidadEscrita) * 1000)) > 1e-6
  if (!sinNada && elegido && escritaConMasDecimales) {
    // La cifra que se propone tiene que valer: con 0.0004 decía «escribe 0», y
    // con un tope de 5 y 9.0004, «escribe 9».
    const vale = topeDeCantidad(Math.min(Number(cantidadEscrita), maximo ?? Infinity))
    motivoDeLaCantidad = vale >= 0.001 ? `La salida lleva hasta tres decimales: escribe ${cantidad(vale)}.` : 'La salida lleva hasta tres decimales.'
  } else if (!sinNada && elegido && maximo !== undefined && cantidadEscrita && Number(cantidadEscrita) > maximo) {
    motivoDeLaCantidad = limitaElTope && codigoDestino ? `Hacia ${codigoDestino} sale como máximo ${enUnidad(maximo)} de este accesorio.`
      : linea && maximo === linea.pendiente ? `El RQ pide ${enUnidad(maximo)} más: no sale más que eso.`
      : `Hay ${enUnidad(maximo)}${elegido.reservadoOt > 0 ? ' sin contar los pedidos de OT' : ''}: no sale más que eso.`
  }

  return (
    <>
      <Boton ref={boton} variante="secundario" onClick={() => { setVolver(null); setAbierta(true) }}>
        <ArrowUpFromLine aria-hidden className="size-4" />Registrar salida
      </Boton>
      {resultado?.ok && !abierta && (
        <div role="status" className="mt-2 space-y-2">
          <p className="text-sm text-exito">{resultado.mensaje}</p>
          {volver && (
            <EnlaceBoton href={`/requerimientos/atencion#rq-${deAtencion}`} variante="secundario" tamano="sm">
              {volver === 'ENTREGAR' ? 'Volver a Atención para marcarlo entregado' : 'Volver a Atención'}
            </EnlaceBoton>
          )}
        </div>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => cerrar({ cancelada: true })}
        titulo="Salida de almacén"
        descripcion="Lo que sale sin solicitud de OT. Toda salida queda vinculada a un vehículo o al código de la unidad."
        ancho="lg"
      >
        <form key={id} onSubmit={alEnviar} className="space-y-5">
          <input type="hidden" name="operacion_id" value={id} />
          <input type="hidden" name="destino" value={destino} />
          {/* El foco va al aviso: el botón quedó desactivado al enviar y el
              formulario se rehízo, y en el teléfono el aviso quedaba arriba,
              fuera de la vista. */}
          {sigue && <AvisoEnfocado>{sigue}</AvisoEnfocado>}

          {lineasRq.length > 0 && (
            <Campo etiqueta="Requerimiento que atiende" htmlFor="sal-rq"
              ayuda="Opcional. Si la salida atiende un ítem de requerimiento, la cantidad se descuenta de lo pedido y el destino lo pone el RQ.">
              <SeleccionBuscable
                id="sal-rq"
                name="requerimiento_linea_id"
                valor={lineaId}
                onChange={(v) => { setLineaId(v); setMaterialId(materialDelRq(v)) }}
                marcador="Sin requerimiento"
                marcadorBusqueda="Número de RQ, código interno o material"
                opciones={lineasRq.map((l) => ({
                  valor: l.linea_id,
                  etiqueta: `${l.numero} · ítem ${l.item} · ${l.descripcion}`,
                  detalle: `${l.codigo_interno} · ${l.area} · faltan ${cantidad(l.pendiente)} ${l.unidad}`,
                }))}
              />
            </Campo>
          )}

          <Campo etiqueta="Material" htmlFor="sal-material" requerido
            ayuda={conSaldo.length === 0 ? 'No hay materiales con saldo libre. Registra primero su ingreso.' : undefined}>
            <SeleccionBuscable
              id="sal-material"
              name="material_id"
              requerido
              permiteVaciar={false}
              valor={materialId}
              onChange={setMaterialId}
              marcador="Elige el material"
              marcadorBusqueda="Código o descripción"
              opciones={conSaldo.map((m) => ({
                valor: m.id,
                etiqueta: m.descripcion,
                // Lo que puede salir, con los tres decimales de la salida: 1.0005 libre sale como 1.
                detalle: `${m.codigo} · libre ${cantidad(topeDeCantidad(m.libre))} ${m.unidad ?? ''}${m.separado > 0 ? ` · ${enPlural(m.separado, 'separado', 'separados')}` : ''}`,
              }))}
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Son cifras que cambian con el material y el destino: van a la vista, no detrás de la «i». */}
            <Campo etiqueta={`Cantidad${elegido?.unidad ? ` (${elegido.unidad})` : ''}`} htmlFor="sal-cantidad" requerido ayudaEnIcono={false}
              error={sinNada ? `Hacia ${codigoDestino} no sale nada de este accesorio.` : motivoDeLaCantidad}
              ayuda={elegido ? [
                elegido.separado <= 0
                  ? `Libre en almacén${elegido.reservadoOt > 0 ? ', sin contar los pedidos de OT' : ''}: ${cantidad(elegido.disponible)}`
                  : `Hay ${cantidad(elegido.disponible)}${elegido.reservadoOt > 0 ? ' sin contar los pedidos de OT' : ''}: ${enLista(partesDe(elegido.disponible, [
                      [topeDeCantidad(elegido.libre), (n) => enPlural(n, 'libre', 'libres')],
                      [duenos?.delRq ?? 0, (n) => `${cantidad(n)} de este RQ`],
                      [duenos?.deLaUnidad ?? 0, (n) => `${cantidad(n)} de esta unidad`],
                    ]))}`,
                linea ? `el RQ pide ${cantidad(linea.pendiente)} más` : null,
              ].filter(Boolean).join(' · ') : undefined}>
              <Entrada id="sal-cantidad" name="cantidad" type="number"
                inputMode="decimal" min={0.001} step="0.001" max={maximo}
                value={cantidadEscrita ?? (propuesta !== undefined ? String(propuesta) : '')}
                // También onInput: React no llama a onChange si se teclea encima
                // el mismo número que se proponía, y entonces no contaba como
                // escrito y cambiaba al elegir el destino.
                onInput={(e) => setEscrita({ para: paraLaCantidad, valor: e.currentTarget.value })}
                onChange={(e) => setEscrita({ para: paraLaCantidad, valor: e.target.value })} required />
            </Campo>
            <Campo etiqueta="Motivo o vale" htmlFor="sal-motivo" requerido>
              <Entrada key={lineaId} id="sal-motivo" name="motivo" required minLength={3} maxLength={200} placeholder="Ej.: Vale 0045, discos de corte"
                defaultValue={linea ? `${linea.numero} · ítem ${linea.item}` : undefined} />
            </Campo>
          </div>

          {/* Siempre en la página, para que el lector de pantalla diga el aviso cuando aparece o cambia. */}
          <div role="status">
            {avisar && duenos && elegido && (
              <p className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso" data-aviso-de-dueno>
                <span className="font-medium">
                  {elegido.deMas > 0 && `Se separó ${enUnidad(elegido.deMas)} más de lo que hay. `}
                  {puede > 0
                    ? `${paraQuien ? `${paraQuien} puedes` : 'Puedes'} sacar ${enUnidad(puede)} sin tocar lo que es de otros.`
                    : `Todo lo que hay ya tiene dueño${duenos.ajenos.length > 0 ? ':' : '.'}`}
                </span>
                {duenos.ajenos.length > 0 && <>{' '}{puede > 0 && 'Ya tiene dueño: '}{duenos.ajenos.join(' · ')}.</>}
                {duenos.delDestino.length > 0 && ` Si es para ${duenos.delDestino.join(' o ')}, elígelo en «Requerimiento que atiende»: así se descuenta de su pedido.`}
              </p>
            )}
            {limitaElTope && topeAccesorio && codigoDestino && (
              <p className="mt-2 text-sm text-aviso" data-tope-accesorio>
                De este accesorio, {enUnidad(topeAccesorio.deOtras)} {topeAccesorio.deOtras === 1 ? 'entró' : 'entraron'} para otras unidades y
                {' '}{topeAccesorio.deOtras === 1 ? 'sale' : 'salen'} solo para ellas: {topeAccesorio.tope > 0
                  ? `para ${codigoDestino} ${topeAccesorio.tope === 1 ? 'queda' : 'quedan'} ${enUnidad(topeAccesorio.tope)}.`
                  : `no queda nada para ${codigoDestino}.`}
              </p>
            )}
            {!stockLeido && elegido && (
              <p className="text-xs text-aviso">No se pudo leer lo separado para cada código: «libre» incluye lo que ya es de algún RQ.</p>
            )}
          </div>

          {regla && (
            <p className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm text-texto-suave">
              <span className="font-medium text-texto">{regla.etiqueta}:</span> {regla.regla}
              {exigeFormato(elegido?.almacen) && ' Después de confirmar, imprime el formato desde «Salidas por cerrar» y carga el escaneo firmado.'}
            </p>
          )}

          {destinoDelRq ? (
            <p className="rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm">
              {normalizarCodigo(destinoDelRq) === CODIGO_TODOS_LOS_ACTIVOS ? (
                <>
                  <span className="text-texto-suave">Va a </span><span className="font-medium">todos los códigos activos</span>
                  <span className="text-texto-suave">, como dice el requerimiento {linea?.numero}: se reparte en partes iguales entre los que trabajaron este mes.</span>
                </>
              ) : normalizarCodigo(destinoDelRq) === CODIGO_FIJO_OFICINA.codigo ? (
                <>
                  <span className="text-texto-suave">Va a </span><span className="font-medium">OFICINA</span>
                  <span className="text-texto-suave">, como dice el requerimiento {linea?.numero}: no es una unidad, es lo de la oficina.</span>
                </>
              ) : (
                <>
                  <span className="text-texto-suave">Va a la unidad </span><span className="font-medium">{destinoDelRq}</span>
                  <span className="text-texto-suave">, la del requerimiento {linea?.numero}.</span>
                  {avisoDelRq && conCodigoDelRq && (
                    // Lo dice al lector la región de más abajo: aquí se leería dos veces.
                    <span aria-hidden className="mt-1 block text-aviso">
                      Es la placa del {conCodigoDelRq.vehiculo ?? 'vehículo'}, que tiene el código{' '}
                      <span className="font-mono whitespace-nowrap">{codigoDelVehiculo}</span>: la salida
                      queda en el vehículo, pero el gasto va a {destinoDelRq}, como pide el RQ, y no al costeo de su código. {queHacerConElRq}
                    </span>
                  )}
                </>
              )}
            </p>
          ) : (
          <fieldset className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
            <legend className="px-1 text-sm font-medium text-texto">¿A qué unidad va? <span className="text-peligro">*</span></legend>
            <div role="group" aria-label="Destino de la salida" className="flex flex-wrap gap-2">
              <Boton type="button" tamano="sm" variante={destino === 'UNIDAD' ? 'primario' : 'contorno'}
                aria-pressed={destino === 'UNIDAD'} onClick={() => setDestino('UNIDAD')} disabled={unidades.length === 0}>
                Vehículo registrado
              </Boton>
              <Boton type="button" tamano="sm" variante={destino === 'CODIGO' ? 'primario' : 'contorno'}
                id="sal-destino-codigo" aria-pressed={destino === 'CODIGO'} onClick={() => setDestino('CODIGO')}>
                Código de unidad
              </Boton>
            </div>
            {destino === 'UNIDAD' ? (
              <>
              <Campo etiqueta="Vehículo" htmlFor="sal-unidad" requerido
                error={unidadSinCodigo
                  ? codigosDeSuPlaca(unidad).length > 0
                    ? `Este vehículo no tiene código interno, y un accesorio sale solo hacia un código. En la lista de códigos está ${enLaLista(codigosDeSuPlaca(unidad))}: úsalo si es el suyo.`
                    : 'Este vehículo no tiene código interno, y un accesorio sale solo hacia un código: elige el suyo en «Código de unidad». Si no está en la lista, todavía no lo tiene.'
                  : undefined}>
                <SeleccionBuscable
                  id="sal-unidad"
                  name="unidad_id"
                  requerido
                  permiteVaciar={false}
                  valor={unidadId}
                  onChange={setUnidadId}
                  marcador="Elige el vehículo"
                  marcadorBusqueda="Placa, código interno u OT"
                  opciones={unidades.map((u) => ({
                    valor: u.id,
                    etiqueta: u.nombre,
                    // Con un accesorio, el que no tiene código se ve antes de elegirlo:
                    // primero, porque en el teléfono el final del renglón se corta.
                    detalle: [accesorioSinRq && sinCodigo(u) ? 'Sin código interno' : null, u.vehiculo, u.ordenes ? `OT ${u.ordenes}` : null]
                      .filter(Boolean).join(' · ') || null,
                  }))}
                />
              </Campo>
              {/* El código que el aviso nombra, a un toque: había que ir a «Código de unidad» y escribirlo de memoria.
                  Con un consumible, que sí sale al vehículo sin código, es un aviso y no frena: el mismo
                  material salía con código o sin él según el botón que se tocara. */}
              {codigosDeSuPlaca(unidad).length > 0 && (
                <div className="-mt-2 text-xs">
                  {!unidadSinCodigo && <p id="sal-aviso-consumible" aria-hidden className="text-aviso">{avisoDelConsumible}</p>}
                  <div className="flex flex-col items-start sm:flex-row sm:flex-wrap sm:gap-x-4">
                    {codigosDeSuPlaca(unidad).map((c) => (
                      // Con el aviso escondido al lector (lo dice la región de abajo), el botón lo lleva de descripción.
                      <button key={c} type="button" aria-describedby={unidadSinCodigo ? undefined : 'sal-aviso-consumible'} onClick={() => {
                          setDestino('CODIGO')
                          setCodigo(c)
                          // El botón se va con el cambio: el foco pasa a «Código de unidad», que sigue en su
                          // lugar. En el campo, el teléfono abría el teclado sin nada que escribir.
                          requestAnimationFrame(() => document.getElementById('sal-destino-codigo')?.focus())
                        }}
                        className="inline-flex min-h-11 items-center font-medium text-acento underline underline-offset-2 sm:min-h-0">
                        Usar <span className="ml-1 font-mono break-all">{c}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              </>
            ) : (
              <Campo etiqueta="Código de la unidad" htmlFor="sal-codigo" requerido
                ayuda={codigos === null
                  ? 'El código interno de fabricación o la placa, como está en la unidad. Si es el de una unidad registrada, la salida se vincula a ella.'
                  : 'Búscalo por el código interno, la placa o la marca y elígelo de la lista: el mismo código del RQ y del costeo. Si es el de una unidad registrada, la salida se vincula a ella.'}>
                {/* El mismo buscador que el RQ: escrito de memoria, cada variante del código era otra unidad en el costeo. */}
                <EntradaCodigoInterno id="sal-codigo" name="codigo_unidad" requerido valor={codigo} onChange={setCodigo}
                  aceptadoInicial={codigoAceptado} alAceptarNuevo={setCodigoAceptado} codigos={codigosConVehiculo} fijos={CODIGOS_FIJOS}
                  vetados={vetados} reconocidos={reconocidos} />
              </Campo>
            )}
            {/* El código de la placa de un vehículo sin código: la base deja la salida también en él. */}
            {notaDelCodigo && (
              <p aria-hidden className="-mt-2 text-xs text-texto-suave">
                La salida queda en el {deLaPlacaEscrita[0].vehiculo ?? 'vehículo'} {deLaPlacaEscrita[0].placa} y el gasto va
                a <span className="font-mono whitespace-nowrap">{escrito}</span>.
              </p>
            )}
          </fieldset>
          )}
          <AvisoParaElLector texto={(destinoDelRq ? avisoDelRq : destino === 'UNIDAD' ? avisoDelConsumible : notaDelCodigo) ?? ''} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Nombre de quien recibe" htmlFor="sal-recibe" requerido>
              <Entrada id="sal-recibe" name="recibido_por_nombre" required minLength={3} maxLength={160} defaultValue={recibe || undefined} />
            </Campo>
            <Campo etiqueta="Foto de la salida" htmlFor="sal-foto" requerido ayuda="Que se vea el material.">
              <ElegirArchivo id="sal-foto" name="foto" accept="image/jpeg,image/png,image/webp" hastaMb={10} capture="environment" required />
            </Campo>
          </div>

          <PieDeVentana
            error={error}
            enviando={enviando}
            alCancelar={() => cerrar({ cancelada: true })}
            texto="Confirmar salida"
            disabled={conSaldo.length === 0 || sinNada || unidadSinCodigo || (destino === 'CODIGO' && placaDeVarios)}
          />
        </form>
      </Ventana>
    </>
  )
}

/**
 * Adónde va el gasto, dicho al lector de pantalla. Los avisos de la ventana
 * nacen con su texto, y una región que nace llena no se anuncia: esta nace
 * vacía y recibe el texto un instante después, también cuando la ventana se
 * abre desde «Atención» con el RQ ya elegido, y en cada ítem siguiente.
 */
function AvisoParaElLector({ texto }: { texto: string }) {
  const [dicho, setDicho] = useState('')
  useEffect(() => {
    const espera = setTimeout(() => setDicho(texto), 150)
    return () => clearTimeout(espera)
  }, [texto])
  return <p role="status" className="sr-only">{dicho}</p>
}
