/**
 * Lo que la acción de servidor y la pantalla de los responsables de área se
 * dicen entre sí. Va aparte porque un archivo `'use server'` solo exporta
 * acciones.
 */

/**
 * La cuenta elegida está dada de baja: se dio de baja con la ventana abierta
 * (la base la rechaza,
 * migración 20261125205000). Es un rechazo del campo «Cuenta responsable», no
 * del formulario: la pantalla lo pone junto a él y le lleva el cursor.
 */
export const CUENTA_YA_NO_ACTIVA = 'Esa cuenta está dada de baja: elige otra.'
