'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { rucEsValido } from '@/lib/dominio/proveedores'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

// El mismo permiso que acepta la política de `proveedores` para escribir. Si
// estos dos se separan, la escritura afecta cero filas sin error y la pantalla
// dice «guardado» sin haber guardado nada.
const PERMISO = 'proveedores.editar'

const texto = (maximo: number) => z.string().trim().max(maximo, `Ese dato pasa de ${maximo} caracteres.`).optional()

const esquemaProveedor = z
  .object({
    id: z.string().uuid().optional().or(z.literal('')),
    tipo_documento: z.enum(['RUC', 'DNI', 'CE', 'PASAPORTE']),
    numero_documento: z.string().trim().min(1, 'Falta el número de documento.').max(20, 'El documento es demasiado largo.'),
    razon_social: z.string().trim().min(2, 'Falta la razón social.').max(160, 'La razón social pasa de 160 caracteres.'),
    nombre_comercial: texto(160),
    rubro: texto(120),
    contacto: texto(120),
    telefono: texto(40),
    correo: z.string().trim().max(160).optional().refine((c) => !c || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c), 'El correo no parece válido.'),
    direccion: texto(250),
    direccion_recojo: texto(250),
    condicion_pago: z.enum(['CONTADO', 'CREDITO']),
    dias_credito: z.coerce.number().int('Los días de crédito son un número entero.').min(0).max(365, 'El crédito llega hasta 365 días.'),
    observaciones: texto(1000),
  })
  .superRefine((v, ctx) => {
    if (v.tipo_documento === 'RUC' && !rucEsValido(v.numero_documento)) {
      ctx.addIssue({
        code: 'custom',
        message: 'El RUC no es válido: son 11 dígitos, empieza en 10, 15, 16, 17 o 20, y el último es el verificador de SUNAT. Cópialo de la factura.',
      })
    }
    if (v.tipo_documento === 'DNI' && !/^\d{8}$/.test(v.numero_documento)) {
      ctx.addIssue({ code: 'custom', message: 'El DNI tiene 8 dígitos.' })
    }
    if (v.condicion_pago === 'CREDITO' && v.dias_credito === 0) {
      ctx.addIssue({ code: 'custom', message: 'Indica a cuántos días es el crédito (de 1 a 365).' })
    }
  })

// Una cuenta bancaria como la escribe Logística. El número se guarda solo con
// sus dígitos: «191-2345678-0-12» y «1912345678012» son la misma cuenta, y el
// CCI (20 dígitos) también entra aquí.
const esquemaCuenta = z.object({
  id: z.string().uuid().nullish(),
  banco: z.string().trim().min(2, 'Falta el banco de una de las cuentas.').max(80, 'El nombre del banco pasa de 80 caracteres.'),
  numero_cuenta: z
    .string()
    .transform((n) => n.replace(/[\s.-]/g, ''))
    .pipe(z.string().regex(/^\d{6,30}$/, 'El número de cuenta va con sus dígitos (de 6 a 30; guiones y espacios no cuentan).')),
  titular: z
    .string()
    .trim()
    .max(160, 'El titular de la cuenta pasa de 160 caracteres.')
    .refine((t) => t.length === 0 || t.length >= 2, 'El titular de la cuenta va con 2 caracteres o más; vacío, va la razón social.'),
  moneda: z.enum(['PEN', 'USD']),
})

type Cuenta = z.infer<typeof esquemaCuenta>

/**
 * Lee las cuentas que manda el formulario. `null` cuando no vienen —quien no las
 * ve no las manda—, para no darle de baja las que tiene sin que nadie las tocara.
 */
function leerCuentas(crudo: FormDataEntryValue | null, razonSocial: string): { cuentas: Cuenta[] | null; error?: string } {
  if (crudo === null) return { cuentas: null }
  let lista: unknown
  try {
    lista = JSON.parse(String(crudo))
  } catch {
    return { cuentas: null, error: 'No se reconocieron las cuentas bancarias. Vuelve a cargar la pantalla.' }
  }
  const analisis = z.array(esquemaCuenta).max(6, 'Un proveedor lleva hasta seis cuentas bancarias.').safeParse(lista)
  if (!analisis.success) return { cuentas: null, error: analisis.error.issues[0]?.message ?? 'Revisa las cuentas bancarias.' }
  const numeros = analisis.data.map((c) => c.numero_cuenta)
  if (new Set(numeros).size !== numeros.length) return { cuentas: null, error: 'Hay una cuenta repetida: cada número va una sola vez.' }
  // El titular casi siempre es el mismo proveedor: si se deja vacío, va su razón social.
  return { cuentas: analisis.data.map((c) => ({ ...c, titular: c.titular || razonSocial })) }
}

function errorDeCuenta(error: { message: string; code?: string }) {
  if (error.message.includes('ck_proveedor_cuentas_numero')) return 'El número de cuenta va con sus dígitos (de 6 a 30).'
  if (error.message.includes('ck_proveedor_cuentas_banco')) return 'El banco de una cuenta va con 2 a 80 caracteres.'
  return mensajeDeError(error)
}

function nulo(valor: string | undefined | null) {
  const t = valor?.trim()
  return t ? t : null
}

function errorDeProveedor(error: { message: string; code?: string }) {
  if (error.message.includes('ck_proveedores_documento')) {
    return 'El documento no es válido. Si es RUC, revisa los 11 dígitos: el último es el verificador de SUNAT.'
  }
  if (error.message.includes('ck_proveedores_pago')) {
    return 'El pago al contado va con 0 días; el crédito, de 1 a 365 días.'
  }
  return mensajeDeError(error)
}

/**
 * Da de alta o corrige un proveedor. Al dar de alta devuelve el proveedor, para
 * que la orden de compra desde la que se creó lo deje elegido.
 */
export async function guardarProveedor(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<ProveedorParaCompra>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, PERMISO)) return { ok: false, error: 'Tu perfil no puede registrar ni corregir proveedores.' }

  const crudo = Object.fromEntries(datos)
  const analisis = esquemaProveedor.safeParse({
    ...crudo,
    numero_documento: String(crudo.numero_documento ?? '').replace(/\s/g, ''),
    // El contado va siempre con 0 días: si alguien dejó un número escrito antes
    // de cambiar a contado, no se le hace volver a borrarlo.
    dias_credito: crudo.condicion_pago === 'CONTADO' ? 0 : crudo.dias_credito,
  })
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del proveedor.' }
  }

  const v = analisis.data
  // Las cuentas se revisan antes de tocar el proveedor: una cuenta mal escrita
  // no deja el proveedor guardado a medias.
  const { cuentas, error: errorCuentas } = leerCuentas(datos.get('cuentas'), v.razon_social)
  if (errorCuentas) return { ok: false, error: errorCuentas }

  const fila = {
    tipo_documento: v.tipo_documento,
    numero_documento: v.numero_documento,
    razon_social: v.razon_social,
    nombre_comercial: nulo(v.nombre_comercial),
    rubro: nulo(v.rubro),
    contacto: nulo(v.contacto),
    telefono: nulo(v.telefono),
    correo: nulo(v.correo),
    direccion: nulo(v.direccion),
    direccion_recojo: nulo(v.direccion_recojo),
    condicion_pago: v.condicion_pago,
    dias_credito: v.dias_credito,
    observaciones: nulo(v.observaciones),
  }
  const columnas = 'id, razon_social, numero_documento, condicion_pago, dias_credito'
  const supabase = await createClient()

  async function guardarCuentas(proveedor: string) {
    if (!cuentas) return null
    const { error } = await supabase.rpc('guardar_cuentas_proveedor', {
      p_proveedor: proveedor,
      p_cuentas: cuentas.map(({ id, banco, numero_cuenta, titular, moneda }) => ({ id: id ?? null, banco, numero_cuenta, titular, moneda })),
    })
    return error ? errorDeCuenta(error) : null
  }

  if (v.id) {
    // Con `.select()`: un UPDATE que el RLS esconde afecta cero filas sin error.
    const { data, error } = await supabase.from('proveedores').update(fila).eq('id', v.id).select(columnas).maybeSingle()
    if (error) return { ok: false, error: errorDeProveedor(error) }
    if (!data) return { ok: false, error: NO_TOCO_NADA }
    const fallaCuentas = await guardarCuentas(data.id)
    revalidatePath('/proveedores')
    if (fallaCuentas) return { ok: false, error: `Los datos del proveedor se guardaron, pero las cuentas no: ${fallaCuentas}` }
    return { ok: true, mensaje: 'Proveedor actualizado.', datos: data }
  }

  const { data, error } = await supabase.from('proveedores').insert(fila).select(columnas).single()
  if (error) {
    if (error.code === '23505') {
      // Ya estaba en el padrón: se devuelve el que había en vez de un error, para
      // que quien lo buscaba desde la orden de compra siga con su compra.
      const { data: existente } = await supabase
        .from('proveedores')
        .select(`${columnas}, activo`)
        .eq('tipo_documento', v.tipo_documento)
        .eq('numero_documento', v.numero_documento)
        .maybeSingle()
      if (existente && !existente.activo) {
        return {
          ok: false,
          error: `Ese documento ya está en el padrón como ${existente.razon_social}, dado de baja. Reactívalo en Proveedores para volver a comprarle.`,
        }
      }
      if (existente) {
        return {
          ok: true,
          // Sus cuentas no se tocan desde aquí: quien lo buscaba no estaba corrigiendo el padrón.
          mensaje: cuentas?.length
            ? `Ese documento ya estaba registrado: ${existente.razon_social}. Quedó elegido; sus cuentas se corrigen en Proveedores.`
            : `Ese documento ya estaba registrado: ${existente.razon_social}. Quedó elegido.`,
          datos: {
            id: existente.id,
            razon_social: existente.razon_social,
            numero_documento: existente.numero_documento,
            condicion_pago: existente.condicion_pago,
            dias_credito: existente.dias_credito,
          },
        }
      }
    }
    return { ok: false, error: errorDeProveedor(error) }
  }

  const fallaCuentas = await guardarCuentas(data.id)
  revalidatePath('/proveedores')
  revalidatePath('/compras')
  if (fallaCuentas) {
    // El proveedor ya entró y quien lo creaba desde la OC sigue con su compra;
    // la cuenta se completa después en el padrón.
    return { ok: true, mensaje: `Proveedor registrado, pero sin sus cuentas: ${fallaCuentas} Corrígelas en Proveedores.`, datos: data }
  }
  return { ok: true, mensaje: 'Proveedor registrado.', datos: data }
}

/** Dar de baja o reactivar. Un proveedor no se borra: sus compras lo nombran. */
export async function cambiarEstadoProveedor(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, PERMISO)) return { ok: false, error: 'Tu perfil no puede dar de baja proveedores.' }

  const analisis = z
    .object({ id: z.string().uuid(), activo: z.enum(['true', 'false']) })
    .safeParse({ id: datos.get('id'), activo: datos.get('activo') })
  if (!analisis.success) return { ok: false, error: 'No se reconoció el proveedor. Vuelve a cargar la pantalla.' }

  const activo = analisis.data.activo === 'true'
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('proveedores')
    .update({ activo })
    .eq('id', analisis.data.id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: errorDeProveedor(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/proveedores')
  revalidatePath('/compras')
  return { ok: true, mensaje: activo ? 'Proveedor reactivado.' : 'Proveedor dado de baja. Sus compras anteriores quedan como estaban.' }
}
