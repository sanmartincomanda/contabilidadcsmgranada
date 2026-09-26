# Contrato minimo para exportaciones BAC AR19

Estado actual: la consulta y la vista previa F10 estan habilitadas. La exportacion real permanece bloqueada.

## Alcance

- Compania: Carnes San Martin SR.
- Plan: `AR19`.
- Moneda: `NIO`.
- Cuenta origen: `1102101` / BAC `362843534`.
- No incluye BAC (2), cuentas USD ni otras cuentas bancarias.

## Registro compartido requerido

El sistema anterior y el ERP deben usar una unica autoridad para reservar numeros de envio y pagos. Esa autoridad debe ofrecer una operacion atomica que:

1. Reciba plan, fecha de aplicacion, actor, clave de idempotencia y las identidades compartidas de los pagos.
2. Bloquee el plan `AR19` durante la reserva.
3. Verifique que ningun pago ya pertenezca a otro envio.
4. Asigne exactamente el siguiente numero vigente sin reutilizar numeros.
5. Guarde el archivo exacto, hash SHA-256, filas, versiones, total en centavos y usuario.
6. Devuelva el mismo archivo y numero cuando se repita la misma clave de idempotencia.
7. Rechace la misma clave si el contenido de la solicitud cambia.

Cada pago necesita una identidad compartida estable. Cuando los IDs locales difieran, debe existir una tabla de equivalencias con: sistema origen, coleccion o tipo, ID local, sucursal, proveedor, factura, fecha, monto neto y ID compartido.

## Estados minimos

- `reserved`: numero e identidades apartados dentro de la transaccion.
- `generated`: archivo y hash persistidos.
- `cancelled`: solo por un procedimiento auditado; el numero no se reutiliza.

La descarga posterior siempre debe recuperar los bytes persistidos del estado `generated`; nunca debe reconstruir el archivo ni consumir otro numero.

## Limites de esta aplicacion

Hasta que ese registro sea accesible desde ambos sistemas, `createBacSupplierPaymentFile` debe responder `FAILED_PRECONDITION`. No se debe escribir directamente en SQL del ERP, modificar envios existentes ni activar la integracion automatica de gastos hacia el ERP.
