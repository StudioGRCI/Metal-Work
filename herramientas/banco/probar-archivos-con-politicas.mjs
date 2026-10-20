/**
 * Los archivos del banco respetan las políticas de `storage.objects`, como
 * Supabase Storage. Quien subió una foto de vehículo la firma, la descarga y su
 * enlace la entrega; una ficha falsa o de otro archivo no abre nada; Ventas no
 * firma, ni descarga, ni sube, ni quita lo que su política le tapa; y sin sesión
 * no sale nada. Hasta el 2026-10-20 el banco firmaba y servía cualquier archivo.
 *
 * Usa los archivos que ya tiene el banco (una foto de vehículo y un comprobante
 * de la planilla diaria) y no deja nada nuevo.
 *
 * Variables: BANCO_CLAVE, NEXT_PUBLIC_SUPABASE_ANON_KEY (la que imprime el
 * servidor), BANCO_URL (http://127.0.0.1:5599), BANCO_BASE (mw_demo).
 */
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const URL = process.env.BANCO_URL ?? 'http://127.0.0.1:5599'
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const CLAVE = process.env.BANCO_CLAVE
if (!ANON || !CLAVE) {
  console.error('Faltan BANCO_CLAVE y NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  process.exit(1)
}
const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.BANCO_BASE ?? 'mw_demo' })
await base.connect()
const { rows: [foto] } = await base.query("select o.name from storage.objects o join registro_vehiculo_fotos f on f.ruta = o.name where o.bucket_id = 'fotos-vehiculos' limit 1")
const { rows: [planilla] } = await base.query("select name from storage.objects where bucket_id = 'planilla-diaria' limit 1")
if (!foto || !planilla) {
  console.error('El banco no tiene una foto de vehículo y un comprobante de la planilla diaria: corre antes probar-vehiculo-con-codigo y probar-planilla-diaria.')
  process.exit(1)
}
await base.end()

let fallas = 0
const ok = (c, t) => { console.log(`${c ? '  ok' : 'FALLA'} · ${t}`); if (!c) fallas++ }

async function cliente(correo) {
  const s = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await s.auth.signInWithPassword({ email: correo, password: CLAVE })
  if (error) throw new Error(`${correo}: ${error.message}`)
  return s
}

const porteria = await cliente('requerimientos.local@metalwork.test')
const ventas = await cliente('ventas.local@metalwork.test')

{
  const { data, error } = await porteria.storage.from('fotos-vehiculos').createSignedUrl(foto.name, 60)
  ok(!error && data?.signedUrl, `Requerimientos firma una foto de vehículo ${error?.message ?? ''}`)
  const r = await fetch(data.signedUrl)
  ok(r.status === 200, `y el enlace firmado la entrega (${r.status})`)
  const falsa = await fetch(data.signedUrl.replace(/token=.*/, 'token=otra'))
  ok(falsa.status === 400, `un enlace con otra ficha no entrega nada (${falsa.status})`)
  const ajena = await fetch(data.signedUrl.replace(foto.name, planilla.name).replace('fotos-vehiculos', 'planilla-diaria'))
  ok(ajena.status === 400, `la ficha de un archivo no abre otro (${ajena.status})`)
  const { data: blob, error: e2 } = await porteria.storage.from('fotos-vehiculos').download(foto.name)
  ok(!e2 && blob?.size > 0, `Requerimientos la descarga con su sesión ${e2?.message ?? ''}`)
}
{
  const { data, error } = await ventas.storage.from('planilla-diaria').createSignedUrl(planilla.name, 60)
  ok(error && !data, `Ventas no firma un comprobante de la planilla diaria: ${error?.message}`)
  const { data: lote } = await ventas.storage.from('planilla-diaria').createSignedUrls([planilla.name], 60)
  ok(lote?.[0]?.error && !lote[0].signedUrl, `ni en lote: ${lote?.[0]?.error}`)
  const { error: e3 } = await ventas.storage.from('planilla-diaria').download(planilla.name)
  ok(e3, `ni la descarga con sesión: ${e3?.message}`)
  const { error: e4 } = await ventas.storage.from('fotos-vehiculos').upload(`x/${Date.now()}.jpg`, new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' }))
  ok(e4, `Ventas no sube una foto de vehículo: ${e4?.message}`)
  const { data: quitados, error: e5 } = await ventas.storage.from('fotos-vehiculos').remove([foto.name])
  ok(!e5 && quitados.length === 0, `ni la quita (${quitados?.length ?? e5?.message})`)
}
const anon = createClient(URL, ANON, { auth: { persistSession: false } })
{
  const { error } = await anon.storage.from('fotos-vehiculos').download(foto.name)
  ok(error, `sin sesión no se descarga nada: ${error?.message}`)
}
console.log(fallas ? `\n${fallas} comprobación(es) fallaron.` : '\nTodo bien: los archivos piden lo mismo que en Supabase.')
process.exit(fallas ? 1 : 0)
