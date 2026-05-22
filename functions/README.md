# API SICAR -> Firebase

Esta carpeta deja lista la integracion entre SICAR/MySQL y Firebase para `CARNES SAN MARTIN GRANADA`.

Ahora existen tres flujos:

- `ingresos`
  - sincroniza ventas diarias a la coleccion `ingresos`
- `compras`
  - primero guarda la compra en una base privada dentro de Firestore
  - despues la procesa automaticamente hacia `gastosDiarios`, `compras` o `cuentas_por_pagar`
- `ventas_privadas`
  - toma ventas desde Firestore privado
  - despues las transforma a `ingresos`

## Base privada de integracion

Las compras y ventas de SICAR no entran directo a la app visible.

Primero se guardan en:

```text
integraciones_privadas/sicar/compras_raw/{rawId}
integraciones_privadas/sicar/ventas_raw/{rawId}
```

Cada documento queda con:

- `rawPayload`
- `normalized`
- `status = pending | processing | processed | error | ignored`
- `sourceRecordId`
- `sourceMode = mysql-query | push | server-poll`
- `targetDocIds`

Esto sirve como capa oculta de staging para luego seguir trabajando la integracion sin tocar la operacion diaria.

## Tiempo real

Para que el integrador funcione en tiempo real, debe escribir directamente en Firestore privado usando el mismo documento por movimiento.

Reglas del contrato:

- usa un `rawId` estable por compra o venta
- escribe siempre sobre ese mismo documento cuando cambie algo
- haz `set(..., { merge: true })`
- cuando cambie monto, fecha, metodo de pago, descripcion o estado:
  - vuelve a poner `status = "pending"`
- si el movimiento fue anulado:
  - deja `status = "pending"`
  - manda tambien `isCancelled = true` o un estado equivalente

Con eso, los triggers de Firebase reaccionan en segundos y sincronizan la app visible.

Hay un ejemplo listo en:

```text
functions/examples/sicarRealtimeWriter.example.js
```

## Corte de inicio

La integracion visible tiene un corte de arranque para no arrastrar historico anterior.

Por default solo procesa documentos con fecha igual o posterior a:

```text
2026-05-14
```

Ese valor sale del parametro:

- `SICAR_PRIVATE_CUTOVER_DATE`

Si un documento privado tiene fecha anterior, queda marcado como `ignored` y no pasa a la app visible.

## Anulaciones desde el integrador

Si una compra o venta queda anulada en la base privada, ahora tambien se anula en la app visible.

La funcion detecta anulacion si el documento trae algo como:

- `anulado = true`
- `cancelado = true`
- `isCancelled = true`
- `estado = "ANULADO"`
- `status = "CANCELADO"`
- valores parecidos como `void`, `cancelled`, `inactive`
- tambien sirve si el integrador manda `status = -1` o ids de cancelacion como `can_caj_id`

### Efecto de una anulacion de compra

- si era `credito`
  - elimina `cuentas_por_pagar`
  - elimina su espejo en `compras`
  - si existian abonos ligados solo a esa factura, tambien los elimina
- si era `efectivo`
  - elimina `gastosDiarios`
  - elimina su espejo en `compras`
- si era otro medio
  - elimina solo `compras`

### Efecto de una anulacion de venta

- elimina el `ingreso` creado desde `ventas_raw`

## Funciones creadas

Nota: los nombres exportados que terminan en `CarnesAmparito` se mantienen asi por compatibilidad con el frontend actual. La marca visible de la app ya esta ajustada para Granada.

### Ingresos

- `syncSicarIngresosCarnesAmparito`
  - Callable Function para dispararla desde la app autenticada.
- `sicarIngresosApi`
  - Endpoint HTTP protegido por token para integraciones externas.

### Compras

- `syncSicarComprasCarnesAmparito`
  - Callable Function para traer compras desde MySQL o enviar filas manualmente.
- `sicarComprasApi`
  - Endpoint HTTP protegido por token.
  - Puede trabajar de dos formas:
    - consultando MySQL por rango de fechas
    - recibiendo `rows` o `records` ya armados desde otro servicio
- `processPendingSicarPurchase`
  - Trigger de Firestore.
  - Procesa automaticamente cada compra guardada en `compras_raw`.

### Ventas privadas

- `processPendingSicarSale`
  - Trigger de Firestore.
  - Procesa automaticamente cada venta guardada en `ventas_raw`.
  - La convierte en un documento de `ingresos`.

### Arranque desde staging privado

- `processSicarPrivateStagingFromCutover`
  - Callable Function administrativa.
  - Revisa `compras_raw` y `ventas_raw`.
  - Solo procesa documentos con fecha desde el corte en adelante.
- `sicarPrivateReplayApi`
  - Endpoint HTTP protegido por token.
  - Hace el mismo arranque controlado sin depender del frontend.

## Secrets y parametros

Antes de desplegar, configura:

```bash
firebase functions:secrets:set SICAR_DB_HOST
firebase functions:secrets:set SICAR_DB_USER
firebase functions:secrets:set SICAR_DB_PASSWORD
firebase functions:secrets:set SICAR_DB_NAME
firebase functions:secrets:set SICAR_INGRESOS_QUERY
firebase functions:secrets:set SICAR_COMPRAS_QUERY
firebase functions:secrets:set SICAR_SYNC_API_TOKEN
```

Los parametros no secretos ya tienen defaults:

- `SICAR_DB_PORT = 3306`
- `SICAR_BRANCH_ID = granada`
- `SICAR_BRANCH_NAME = CARNES SAN MARTIN GRANADA`
- `SICAR_TIMEZONE = America/Managua`
- `SICAR_CASHBOX_NAME = CAJA 2`
- `SICAR_PRIVATE_CUTOVER_DATE = 2026-05-14`

## Query esperada para ingresos

`SICAR_INGRESOS_QUERY` debe devolver por lo menos:

- una fecha por fila: `date`, `fecha`, `sale_date`, `saleDate`, `dia` o `day`
- un monto por fila: `amount`, `monto`, `total`, `ingreso` o `importe`

La plantilla soporta estos placeholders:

- `{{startDate}}`
- `{{endDate}}`
- `{{branchName}}`

Ejemplo:

```sql
SELECT
  DATE(v.fecha) AS fecha,
  SUM(v.total) AS monto
FROM ventas v
WHERE DATE(v.fecha) BETWEEN {{startDate}} AND {{endDate}}
  AND v.sucursal = {{branchName}}
GROUP BY DATE(v.fecha)
ORDER BY DATE(v.fecha);
```

## Query esperada para compras

`SICAR_COMPRAS_QUERY` debe devolver por lo menos:

- una fecha: `date`, `fecha`, `purchase_date`, `purchaseDate`, `compra_date`, `compraDate`, `dia` o `day`
- un monto: `amount`, `monto`, `total`, `importe`, `purchase_total` o `purchaseTotal`

Campos recomendados para mejor clasificacion:

- proveedor: `supplier`, `proveedor`, `vendor`
- factura: `invoiceNumber`, `numero_factura`, `factura`, `folio`, `serieFolio`
- metodo de pago: `paymentMethod`, `metodo_pago`, `forma_pago`, `tipo_pago`, `condicion_pago`
- vencimiento: `dueDate`, `vencimiento`, `fecha_vencimiento`
- id unico de SICAR: `sourceRecordId`, `id`, `compra_id`, `purchase_id`, `movimiento_id`, `uuid`
- descripcion: `description`, `descripcion`, `detalle`
- caja opcional para reflejo en `gastosDiarios`: `cashboxName`, `caja`, `cajaNombre`

La plantilla tambien soporta:

- `{{startDate}}`
- `{{endDate}}`
- `{{branchName}}`

Ejemplo:

```sql
SELECT
  c.id AS compra_id,
  DATE(c.fecha) AS fecha,
  p.nombre AS proveedor,
  c.numero_factura AS numero_factura,
  c.total AS monto,
  c.forma_pago AS metodo_pago,
  DATE(c.fecha_vencimiento) AS vencimiento,
  c.observaciones AS detalle
FROM compras c
LEFT JOIN proveedores p ON p.id = c.proveedor_id
WHERE DATE(c.fecha) BETWEEN {{startDate}} AND {{endDate}}
  AND c.sucursal = {{branchName}}
ORDER BY c.fecha, c.id;
```

## Como se reparte una compra

Cuando una compra entra al staging privado, el trigger la reparte asi:

- `efectivo`
  - crea `gastosDiarios` con `tipo = "Compra"`
  - crea tambien su espejo en `compras`
- `credito`
  - crea una factura nueva en `cuentas_por_pagar`
  - crea tambien su espejo en `compras`
- `otro`
  - crea solo una compra en `compras`

Nota:

- no la mando a la coleccion `gastos` porque eso la contaria como gasto operativo y no como costo
- para efectivo la salida visible queda en `gastosDiarios`, pero el costo real sigue entrando por `compras`

## Como se reparte una venta privada

Cuando una venta entra a `ventas_raw`, el trigger la convierte en:

- `ingresos/sicar_venta_diaria_YYYY-MM-DD` para ventas diarias
- `ingresos/sicar_venta_*` para ventas por ticket legacy

Campos principales:

- `date`
- `month`
- `amount`
- `subtotal`
- `subtotalExento`
- `subtotalGravado`
- `iva`
- `total`
- `dailySaleCode`
- `description`
- `reference`
- `source = "sicar"`
- `sourceSystem = "SICAR"`

Para estado de resultados, `amount` y `subtotal` son la venta contable. El IVA se guarda aparte y no aumenta la venta contable.

## Worker local de ventas diarias

Como MySQL SICAR esta en `127.0.0.1:3307`, la sincronizacion diaria de ventas corre localmente en el servidor SICAR.

Configura el entorno local en `.env.local` o variables de sistema:

```text
FIREBASE_PROJECT_ID=sistema-contable-csm-granada
GOOGLE_APPLICATION_CREDENTIALS=C:\SICAR\keys\firebase-adminsdk.json
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_DATABASE=sicar
MYSQL_USER=root
MYSQL_PASSWORD=...
```

Prueba manual:

```powershell
cd functions
.\scripts\runDailySicarSales.ps1 -Date 2026-05-22 -Preview
.\scripts\runDailySicarSales.ps1 -Date 2026-05-22
```

Registrar la tarea diaria de las 8:00 PM:

```powershell
cd functions
.\scripts\registerDailySicarSalesTask.ps1
```

El worker:

- lee `venta`, `ventatipopago` y `tipopago`
- excluye anuladas por `status < 0`, `can_caj_id` o `can_rcc_id`
- guarda staging en `integraciones_privadas/sicar/ventas_raw/venta_diaria_YYYY-MM-DD`
- actualiza `ingresos/sicar_venta_diaria_YYYY-MM-DD`
- mantiene idempotencia si corre mas de una vez

## Ejemplo de push directo

Si despues pones un servicio en el servidor SICAR, puedes empujar compras casi en tiempo real con:

```http
POST /sicarComprasApi
Authorization: Bearer TU_TOKEN
Content-Type: application/json
```

```json
{
  "rows": [
    {
      "id": 5012,
      "fecha": "2026-05-14",
      "proveedor": "DISTRIBUIDORA CENTRAL",
      "factura": "A-1299",
      "monto": 15420.75,
      "metodo_pago": "efectivo",
      "detalle": "COMPRA DE CARNE"
    }
  ]
}
```

## Despliegue

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

## Arranque desde hoy

Despues del deploy, dispara una vez la callable administrativa:

```js
processSicarPrivateStagingFromCutover({
  preview: false,
  requeueErrors: true,
  limit: 200
})
```

Eso hace dos cosas:

- procesa solo documentos privados con fecha `>= 2026-05-14`
- ignora y marca como `ignored` los anteriores

Tambien puedes hacerlo por HTTP:

```http
POST /sicarPrivateReplayApi
Authorization: Bearer TU_TOKEN
Content-Type: application/json
```

```json
{
  "preview": false,
  "requeueErrors": true,
  "limit": 200
}
```

## Resultado en Firestore

### Ingresos

La sincronizacion hace `upsert` por dia en `ingresos` con ids tipo:

```text
sicar_amparito_2026-05-04
```

Las ventas privadas generan:

- `ingresos/sicar_venta_*`

### Compras

La sincronizacion privada genera documentos tipo:

```text
integraciones_privadas/sicar/compras_raw/compra_2026-05-14_xxxxxxxxxxxxxxxxxxxxxxxx
```

Y luego crea automaticamente, segun aplique:

- `gastosDiarios/sicar_gd_*`
- `compras/sicar_compra_*`
- `cuentas_por_pagar/sicar_cxp_*`

Tambien guarda bitacora en `sicar_sync_logs`.
