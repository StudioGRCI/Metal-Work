/**
 * Desde la migración 20261017220000 cada pago y cada cobro pide la cuenta de la
 * caja diaria de la que salió o a la que entró, y con varias cuentas activas no
 * viene ninguna elegida. Las pruebas de clic que pagan o cobran dan de alta la
 * suya —con un mes de antigüedad, para que el pago de hoy la mueva— y la eligen
 * en la ventana. La cuenta queda en la base del banco: son datos de prueba.
 */

/** Da de alta una cuenta de banco de prueba a nombre de esa cuenta de Tesorería y devuelve su nombre. */
export async function crearCajaDePrueba(consulta, correoTesoreria, moneda = 'PEN') {
  const nombre = `Caja de prueba ${moneda === 'USD' ? 'dólares' : 'soles'} ${Date.now().toString().slice(-6)}`
  const [fila] = await consulta(
    `insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
     select $1, 'BANCO', 'BANCO DE PRUEBA', $2, 100000, (now() at time zone 'America/Lima')::date - 30, u.id
       from usuarios u where u.correo = $3
     returning id`,
    [nombre, moneda, correoTesoreria],
  )
  if (!fila) throw new Error(`Falta la cuenta ${correoTesoreria} en la base del banco para dar de alta su caja de prueba.`)
  return nombre
}

/** Elige la cuenta por su nombre en el desplegable de la ventana de pago o de cobro. */
export async function elegirCuenta(ventana, nombre) {
  const valor = await ventana.locator('select[name="caja_id"] option', { hasText: nombre }).getAttribute('value')
  await ventana.locator('select[name="caja_id"]').selectOption(valor)
}

/** Los movimientos vigentes de esa cuenta de prueba, para comprobar que el pago la movió. */
export async function movimientosDeLaCaja(consulta, nombre) {
  return consulta(
    `select m.origen, m.tipo, m.monto::float as monto from movimientos_caja m join cajas c on c.id = m.caja_id
      where c.nombre = $1 and m.anulado_en is null order by m.creado_en`,
    [nombre],
  )
}
