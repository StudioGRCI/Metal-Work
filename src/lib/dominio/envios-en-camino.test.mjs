import test from 'node:test'
import assert from 'node:assert/strict'
import { cuentaDeEnvios } from './envios-en-camino.ts'

// Si la espera ya terminó, sin dejar correr el reloj.
const terminada = async (promesa) => {
  let fin = false
  promesa.then(() => (fin = true))
  await new Promise((listo) => setImmediate(listo))
  return fin
}
const pausa = (ms) => new Promise((listo) => setTimeout(listo, ms))

test('sin nada en camino, «Volver a cargar» no espera', async () => {
  const envios = cuentaDeEnvios()
  assert.equal((await envios.esperar()).noEntro, false)
})

test('espera lo que está en camino, y si entró recarga', async () => {
  const envios = cuentaDeEnvios()
  const volvio = envios.salir()
  const espera = envios.esperar()
  assert.equal(await terminada(espera), false)
  volvio(true)
  assert.equal((await espera).noEntro, false)
})

test('si volvió sin entrar, no recarga encima de su aviso', async () => {
  const envios = cuentaDeEnvios()
  const volvio = envios.salir()
  const espera = envios.esperar()
  volvio(false)
  assert.equal((await espera).noEntro, true)
})

test('«igual» no espera lo que no entró, pero sí el reenvío que salió después (F3)', async () => {
  const envios = cuentaDeEnvios()
  const rechazo = envios.salir()
  const primera = envios.esperar()
  rechazo(false)
  assert.equal((await primera).noEntro, true)
  envios.ofrecer()

  // La persona corrige y lo envía otra vez: «Volver a cargar igual» lo espera.
  const reenvio = envios.salir()
  const igual = envios.esperar({ igual: true })
  assert.equal(await terminada(igual), false, 'recargaba en el acto con el reenvío en camino')
  reenvio(true)
  assert.equal((await igual).noEntro, false)
})

test('si el reenvío tampoco entra, «igual» tampoco recarga encima', async () => {
  const envios = cuentaDeEnvios()
  const rechazo = envios.salir()
  const primera = envios.esperar()
  rechazo(false)
  await primera
  envios.ofrecer()
  const reenvio = envios.salir()
  const igual = envios.esperar({ igual: true })
  reenvio(false)
  assert.equal((await igual).noEntro, true)
})

test('a los 10 s lo que no contesta pasa a lo ofrecido: «igual» ya no lo espera, ni su desenlace', async () => {
  const envios = cuentaDeEnvios()
  const colgado = envios.salir()
  let tardo = 0
  const primera = envios.esperar({ tope: 20, alTardar: () => tardo++ })
  await pausa(40)
  assert.equal(tardo, 1)
  assert.equal(await terminada(primera), false, 'la primera espera sigue: si entra, la pantalla recarga sola')

  const igual = envios.esperar({ igual: true })
  assert.equal((await igual).noEntro, false, '«igual» no espera lo que no contestaba')
  colgado(false)
})

test('con algo colgado, «igual» espera lo que salió después y no lo que ya se ofreció', async () => {
  const envios = cuentaDeEnvios()
  const colgado = envios.salir()
  void envios.esperar({ tope: 10 })
  await pausa(30)
  const otro = envios.salir()
  const igual = envios.esperar({ igual: true })
  assert.equal(await terminada(igual), false)
  colgado(false)
  assert.equal(await terminada(igual), false, 'lo colgado que vuelve no la suelta: falta el otro')
  otro(true)
  assert.equal((await igual).noEntro, false, 'lo colgado que no entró no cuenta: se ofreció no esperarlo')
})

test('la espera que sigue tras los 10 s también sabe que lo suyo no entró, aunque después se pida «igual»', async () => {
  const envios = cuentaDeEnvios()
  const colgado = envios.salir()
  const primera = envios.esperar({ tope: 10 })
  await pausa(30)
  const otro = envios.salir()
  const igual = envios.esperar({ igual: true })
  colgado(false)
  otro(true)
  assert.equal((await igual).noEntro, false, '«igual» no cuenta lo que se ofreció no esperar')
  assert.equal((await primera).noEntro, true, 'la primera esperaba lo colgado: no recarga encima de su aviso')
})

test('un envío que vuelve dos veces no cuenta dos veces', async () => {
  const envios = cuentaDeEnvios()
  const volvio = envios.salir()
  volvio(true)
  const espera = envios.esperar()
  volvio(false)
  assert.equal((await espera).noEntro, false)
})

test('el «no entró» que trae su motivo lo dice; si alguno no lo trae, ninguno (funcionalidad H1)', async () => {
  const envios = cuentaDeEnvios()
  const ventanaCerrada = envios.salir()
  const espera = envios.esperar()
  ventanaCerrada(false, 'Ya existe un registro con esos datos.')
  assert.deepEqual(await espera, { noEntro: true, motivo: 'Ya existe un registro con esos datos.' })

  // Uno lo dice junto a su botón (sin motivo) y otro no: arriba se manda al botón.
  const junto = envios.salir()
  const suelto = envios.salir()
  const otra = envios.esperar()
  suelto(false, 'Ya existe un registro con esos datos.')
  junto(false)
  assert.deepEqual(await otra, { noEntro: true, motivo: null })
})

test('el motivo de lo que ya se ofreció no esperar no llega a «igual»', async () => {
  const envios = cuentaDeEnvios()
  const rechazo = envios.salir()
  const primera = envios.esperar()
  rechazo(false, 'La placa ya está registrada.')
  assert.equal((await primera).motivo, 'La placa ya está registrada.')
  envios.ofrecer()
  const reenvio = envios.salir()
  const igual = envios.esperar({ igual: true })
  reenvio(true)
  assert.deepEqual(await igual, { noEntro: false, motivo: null })
})

test('cuantos cuenta lo que sigue en camino, también lo que no entró, hasta que vuelve (Y1)', async () => {
  const envios = cuentaDeEnvios()
  assert.equal(envios.cuantos(), 0)
  const a = envios.salir()
  const b = envios.salir()
  assert.equal(envios.cuantos(), 2)
  b(false, 'Ya hay una OT 0001-2026.')
  assert.equal(envios.cuantos(), 1, 'el que volvió sin entrar ya no está en camino')
  b(true)
  assert.equal(envios.cuantos(), 1, 'volver dos veces no cuenta dos')
  // Lo ofrecido no lo saca de la cuenta: sigue en camino.
  envios.ofrecer()
  assert.equal(envios.cuantos(), 1)
  a(true)
  assert.equal(envios.cuantos(), 0)
})
