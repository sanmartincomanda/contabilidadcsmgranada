# Transferencia NO RC

Es un medio de cobro en cordobas para ventas y recibos. No representa efectivo contado ni una transferencia bancaria computable para RC.

| Operacion | Tratamiento |
| --- | --- |
| Factura membretada | Se permite como pago unico o como parte de un pago dividido. No cambia el importe facturado, el IVA ni la porcion a credito. |
| Recibo / abono de CxC | Se aplica el abono a las facturas por el importe bruto. El cobro que llega al desglose es el neto de retenciones IR y municipal. |
| Cierre abierto o en espera | Se genera una fila por documento con referencia F- o R-. Permite filas manuales y edicion. No se elige por defecto para transferencias genericas de SICAR. |
| Cuadre frente a SICAR | El total manual no suma NO RC. No se altera el esperado recibido de SICAR ni se ocultan diferencias. |
| RC y deposito | El RC excluye tanto la transferencia como la porcion neta del documento cobrada por ese medio. Una fila manual no reduce el flujo de otros documentos. El deposito sigue usando el efectivo fisico y el RC resultante. BAC (2) sigue siendo computable. |
| Ticket, vista previa diaria e historial | Muestran la transferencia por separado, con detalle y total informativo. El reporte diario suma los cierres seleccionados. El XLS de RC y el resumen de pagos de facturas tambien la identifican. |
| Edicion posterior | No se permite cambiar aisladamente el importe NO RC de un documento ya vinculado a un cierre. Al anular una factura se retiran solo sus filas NO RC automaticas; se conservan las manuales y las de otros documentos. |

Ejemplo: una factura de C$1,000 con C$700 en efectivo y C$300 en NO RC sigue siendo una venta de C$1,000. Si no hay otros movimientos, el ticket muestra C$700 de flujo, C$700 de efectivo y C$300 de transferencia informativa. Una fila manual adicional de C$25 cambia solo el detalle a C$325.

No requiere migracion, lecturas adicionales de Firestore, cambios a MySQL/SICAR ni reclasificar movimientos anteriores. La opcion no se agrega a compras, gastos o pagos a proveedores.

Pruebas de regresion: `npm run test:no-rc`.
