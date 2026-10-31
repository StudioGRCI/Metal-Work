'use client'

import { Archive, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { Proveedor, ProveedorParaCompra } from '@/lib/datos/proveedores'
import { BANCOS_SUGERIDOS, rucEsValido } from '@/lib/dominio/proveedores'
import { useAccion, useEnvio } from '@/lib/envio'

import { cambiarEstadoProveedor, guardarProveedor } from './acciones'

type FilaCuenta = { clave: string; id?: string; banco: string; numero_cuenta: string; titular: string; moneda: string }

// La clave de la primera fila es fija para que el servidor y el navegador pinten
// el mismo id; las que se agregan después nacen en un clic y llevan una al azar.
const filaVacia = (clave = 'nueva'): FilaCuenta => ({ clave, banco: '', numero_cuenta: '', titular: '', moneda: 'PEN' })
const filaEscrita = (f: FilaCuenta) => Boolean(f.banco.trim() || f.numero_cuenta.trim() || f.titular.trim())

/**
 * Las cuentas a las que se le paga. Van en la orden de compra que recibe el
 * proveedor, en la moneda de la compra. Una fila vacía no se manda.
 */
function CuentasBancarias({ prefijo, iniciales }: { prefijo: string; iniciales: Proveedor['cuentas'] }) {
  const [filas, setFilas] = useState<FilaCuenta[]>(() =>
    iniciales.length ? iniciales.map((c) => ({ clave: c.id, ...c })) : [filaVacia()],
  )
  const cambiar = (clave: string, cambio: Partial<FilaCuenta>) =>
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)))
  const enviadas = filas
    .filter(filaEscrita)
    .map(({ id, banco, numero_cuenta, titular, moneda }) => ({ id: id ?? null, banco, numero_cuenta, titular, moneda }))

  return (
    <fieldset className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
      <legend className="px-1 text-sm font-medium text-texto">Cuentas bancarias</legend>
      <p className="text-xs text-texto-suave">
        Salen en la orden de compra, la de la misma moneda de la compra. Si el titular es el mismo proveedor, déjalo vacío.
      </p>
      <input type="hidden" name="cuentas" value={JSON.stringify(enviadas)} />
      <datalist id={`${prefijo}-bancos`}>
        {BANCOS_SUGERIDOS.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      {filas.map((f, i) => {
        const id = `${prefijo}-cuenta-${f.clave}`
        return (
          <div key={f.clave} className="space-y-3 border-t border-borde pt-3 first-of-type:border-t-0 first-of-type:pt-0">
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Campo etiqueta={filas.length > 1 ? `Banco (cuenta ${i + 1})` : 'Banco'} htmlFor={`${id}-banco`}>
                <Entrada
                  id={`${id}-banco`}
                  list={`${prefijo}-bancos`}
                  value={f.banco}
                  onChange={(e) => cambiar(f.clave, { banco: e.target.value })}
                  maxLength={80}
                  autoComplete="off"
                />
              </Campo>
              <Campo etiqueta="Moneda" htmlFor={`${id}-moneda`}>
                <Seleccion id={`${id}-moneda`} value={f.moneda} onChange={(e) => cambiar(f.clave, { moneda: e.target.value })}>
                  <option value="PEN">Soles</option>
                  <option value="USD">Dólares</option>
                </Seleccion>
              </Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Campo etiqueta="Número de cuenta o CCI" htmlFor={`${id}-numero`}>
                <Entrada
                  id={`${id}-numero`}
                  value={f.numero_cuenta}
                  onChange={(e) => cambiar(f.clave, { numero_cuenta: e.target.value })}
                  inputMode="numeric"
                  maxLength={40}
                  autoComplete="off"
                />
              </Campo>
              <Campo etiqueta="Titular de la cuenta" htmlFor={`${id}-titular`}>
                <Entrada
                  id={`${id}-titular`}
                  value={f.titular}
                  onChange={(e) => cambiar(f.clave, { titular: e.target.value })}
                  placeholder="El mismo proveedor"
                  maxLength={160}
                />
              </Campo>
              <Boton
                type="button"
                variante="fantasma"
                tamano="sm"
                aria-label={`Quitar la cuenta ${i + 1}`}
                onClick={() =>
                  setFilas((fs) => (fs.length > 1 ? fs.filter((x) => x.clave !== f.clave) : [filaVacia(crypto.randomUUID())]))
                }
              >
                <Trash2 aria-hidden className="size-4" />
              </Boton>
            </div>
          </div>
        )
      })}
      {filas.length < 6 && (
        <Boton type="button" variante="contorno" tamano="sm" onClick={() => setFilas((fs) => [...fs, filaVacia(crypto.randomUUID())])}>
          <Plus aria-hidden className="size-3.5" />
          Agregar otra cuenta
        </Boton>
      )}
    </fieldset>
  )
}

/**
 * El formulario del proveedor. Completo en la pantalla de Proveedores; corto
 * (`breve`) cuando se da de alta desde la orden de compra, donde solo importa
 * quién es y cómo se le paga: el resto se completa después en el padrón.
 */
export function FormularioProveedor({
  proveedor,
  breve = false,
  cuentasVisibles = true,
  alTerminar,
}: {
  proveedor?: Proveedor
  breve?: boolean
  /** Sin `proveedores.ver_cuentas` las cuentas llegan vacías: no se ofrecen, para no darlas de baja al guardar. */
  cuentasVisibles?: boolean
  alTerminar: (creado: ProveedorParaCompra | undefined, mensaje: string | undefined) => void
}) {
  const [tipo, setTipo] = useState<string>(proveedor?.tipo_documento ?? 'RUC')
  const [documento, setDocumento] = useState(proveedor?.numero_documento ?? '')
  const [condicion, setCondicion] = useState(proveedor?.condicion_pago ?? 'CONTADO')
  const { alEnviar, enviando, error } = useEnvio(guardarProveedor, (r) => alTerminar(r.datos, r.mensaje))

  // El aviso sale cuando el RUC ya tiene sus 11 dígitos y no cuadra: antes de
  // eso, la persona todavía está escribiendo.
  const limpio = documento.replace(/\s/g, '')
  const rucMalo = tipo === 'RUC' && limpio.length === 11 && !rucEsValido(limpio)
  const prefijo = breve ? 'prov-rapido' : `prov-${proveedor?.id ?? 'nuevo'}`

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      {proveedor && <input type="hidden" name="id" value={proveedor.id} />}
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Campo etiqueta="Documento" htmlFor={`${prefijo}-tipo`}>
          <Seleccion id={`${prefijo}-tipo`} name="tipo_documento" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="RUC">RUC</option>
            <option value="DNI">DNI</option>
            <option value="CE">Carné de extranjería</option>
            <option value="PASAPORTE">Pasaporte</option>
          </Seleccion>
        </Campo>
        <Campo
          etiqueta="Número"
          htmlFor={`${prefijo}-numero`}
          requerido
          ayuda={tipo === 'RUC' ? 'Los 11 dígitos, como salen en la factura.' : undefined}
          error={rucMalo ? 'Ese RUC no pasa el dígito verificador de SUNAT: revisa que esté bien copiado.' : undefined}
        >
          <Entrada
            id={`${prefijo}-numero`}
            name="numero_documento"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
            inputMode={tipo === 'RUC' || tipo === 'DNI' ? 'numeric' : undefined}
            maxLength={20}
            required
            autoComplete="off"
          />
        </Campo>
      </div>

      <Campo etiqueta="Razón social" htmlFor={`${prefijo}-razon`} requerido>
        <Entrada id={`${prefijo}-razon`} name="razon_social" defaultValue={proveedor?.razon_social} required minLength={2} maxLength={160} />
      </Campo>

      {!breve && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombre comercial" htmlFor={`${prefijo}-comercial`}>
            <Entrada id={`${prefijo}-comercial`} name="nombre_comercial" defaultValue={proveedor?.nombre_comercial ?? ''} maxLength={160} />
          </Campo>
          <Campo etiqueta="Rubro" htmlFor={`${prefijo}-rubro`} ayuda="Qué le compramos: planchas, pintura, pernería, servicios…">
            <Entrada id={`${prefijo}-rubro`} name="rubro" defaultValue={proveedor?.rubro ?? ''} maxLength={120} />
          </Campo>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Pago habitual" htmlFor={`${prefijo}-pago`} ayuda="Se propone al hacerle una orden de compra; ahí se puede cambiar.">
          <Seleccion id={`${prefijo}-pago`} name="condicion_pago" value={condicion} onChange={(e) => setCondicion(e.target.value)}>
            <option value="CONTADO">Contado</option>
            <option value="CREDITO">Crédito</option>
          </Seleccion>
        </Campo>
        {condicion === 'CREDITO' && (
          <Campo etiqueta="Días de crédito" htmlFor={`${prefijo}-dias`} requerido>
            <Entrada
              id={`${prefijo}-dias`}
              name="dias_credito"
              type="number"
              min={1}
              max={365}
              defaultValue={proveedor?.dias_credito || 30}
              required
            />
          </Campo>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Persona de contacto" htmlFor={`${prefijo}-contacto`}>
          <Entrada id={`${prefijo}-contacto`} name="contacto" defaultValue={proveedor?.contacto ?? ''} maxLength={120} />
        </Campo>
        <Campo etiqueta="Teléfono" htmlFor={`${prefijo}-telefono`}>
          <Entrada id={`${prefijo}-telefono`} name="telefono" type="tel" defaultValue={proveedor?.telefono ?? ''} maxLength={40} />
        </Campo>
      </div>

      <Campo
        etiqueta="Dirección de recojo"
        htmlFor={`${prefijo}-recojo`}
        ayuda="Adonde va el conductor a recoger. Si es la misma dirección fiscal, puede quedar vacía."
      >
        <Entrada id={`${prefijo}-recojo`} name="direccion_recojo" defaultValue={proveedor?.direccion_recojo ?? ''} maxLength={250} />
      </Campo>

      {cuentasVisibles && <CuentasBancarias prefijo={prefijo} iniciales={proveedor?.cuentas ?? []} />}

      {!breve && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Correo" htmlFor={`${prefijo}-correo`}>
              <Entrada id={`${prefijo}-correo`} name="correo" type="email" defaultValue={proveedor?.correo ?? ''} maxLength={160} />
            </Campo>
            <Campo etiqueta="Dirección fiscal" htmlFor={`${prefijo}-direccion`}>
              <Entrada id={`${prefijo}-direccion`} name="direccion" defaultValue={proveedor?.direccion ?? ''} maxLength={250} />
            </Campo>
          </div>
          <Campo etiqueta="Observaciones" htmlFor={`${prefijo}-obs`}>
            <AreaTexto id={`${prefijo}-obs`} name="observaciones" defaultValue={proveedor?.observaciones ?? ''} maxLength={1000} />
          </Campo>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando} disabled={rucMalo}>
          {proveedor ? 'Guardar cambios' : 'Registrar proveedor'}
        </Boton>
      </div>
    </form>
  )
}

export function NuevoProveedor() {
  const [abierta, setAbierta] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3">
      {aviso && (
        <span role="status" className="text-sm text-exito">
          {aviso}
        </span>
      )}
      <Boton
        onClick={() => {
          setAviso(null)
          setAbierta(true)
        }}
      >
        <Plus aria-hidden className="size-4" />
        Nuevo proveedor
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Nuevo proveedor"
        descripcion="Queda en el padrón y se elige desde la orden de compra."
        ancho="lg"
      >
        <FormularioProveedor
          alTerminar={(_creado, mensaje) => {
            setAbierta(false)
            setAviso(mensaje ?? 'Proveedor registrado.')
          }}
        />
      </Ventana>
    </div>
  )
}

export function AccionesProveedor({ proveedor, cuentasVisibles }: { proveedor: Proveedor; cuentasVisibles: boolean }) {
  const [editando, setEditando] = useState(false)
  const estado = useAccion(cambiarEstadoProveedor, undefined, { documento: proveedor.id })

  function cambiarEstado() {
    const datos = new FormData()
    datos.set('id', proveedor.id)
    datos.set('activo', String(!proveedor.activo))
    estado.ejecutar(datos)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Boton type="button" tamano="sm" variante="contorno" onClick={() => setEditando(true)}>
        <Pencil aria-hidden className="size-3.5" />
        Editar
      </Boton>
      <Boton type="button" tamano="sm" variante="fantasma" cargando={estado.enviando} onClick={cambiarEstado}>
        {proveedor.activo ? <Archive aria-hidden className="size-3.5" /> : <RotateCcw aria-hidden className="size-3.5" />}
        {proveedor.activo ? 'Dar de baja' : 'Reactivar'}
      </Boton>
      {estado.error && (
        <span role="alert" className="text-xs text-peligro">
          {estado.error}
        </span>
      )}
      <Ventana abierta={editando} alCerrar={() => setEditando(false)} titulo={proveedor.razon_social} descripcion="Corregir los datos del proveedor." ancho="lg">
        <FormularioProveedor proveedor={proveedor} cuentasVisibles={cuentasVisibles} alTerminar={() => setEditando(false)} />
      </Ventana>
    </div>
  )
}
