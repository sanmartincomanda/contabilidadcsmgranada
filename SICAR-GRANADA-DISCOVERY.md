# Descubrimiento SICAR Granada

Fecha de revision: `2026-05-22`

## Conexion MySQL identificada

- host: `127.0.0.1`
- host alterno observado: `localhost`
- puerto: `3307`
- base principal: `sicar`
- usuario: `root`
- motor: `MySQL 5.6` embebido en SICAR
- instalacion SICAR: `C:\Program Files (x86)\SICAR-S-131AB`
- `my.ini`: `C:\Program Files (x86)\SICAR-S-131AB\MySQL\MySQL Server 5.6\my.ini`
- `datadir`: `C:\Program Files (x86)\SICAR-S-131AB\db`

La clave de MySQL ya existe en la maquina dentro de la configuracion local del piloto anterior. No la copie al repo. Debe cargarse como secret en Firebase usando `SICAR_DB_PASSWORD`.

## Sucursal detectada

- nombre exacto local: `Carnes San Martin Granada`
- alias de servidor visto en config local: `CARNES SAN MARTIN GRANADA`
- branch id recomendado para la app: `granada`

Fuente local usada para esta confirmacion:

- `C:\sicar-pilot\config\pilot.settings.json`

## Tablas candidatas

### Ventas

- `venta`
- `ventatipopago`
- `tipopago`
- `detallev`

Columnas relevantes encontradas:

- fecha: `venta.fecha`
- monto total: `venta.total`
- id unico: `venta.ven_id`
- folio fiscal visible: `venta.afFolio`
- estado: `venta.status`
- anulacion ligada: `venta.can_caj_id`, `venta.can_rcc_id`
- tipo de pago: `ventatipopago.tpa_id -> tipopago.nombre`

### Compras

- `compra`
- `proveedor`
- `compratipopago`
- `tipopago`
- `creditoproveedor`
- `caja`

Columnas relevantes encontradas:

- fecha: `compra.fecha`
- monto total: `compra.total`
- proveedor: `proveedor.nombre`
- folio / factura: `compra.folio`
- serie adicional: `compra.serieFolio`
- id unico: `compra.com_id`
- estado: `compra.status`
- anulacion ligada: `compra.can_caj_id`, `compra.can_rcc_id`
- metodo de pago: `compratipopago.tpa_id -> tipopago.nombre`
- vencimiento credito: `creditoproveedor.fechaLimite`
- referencia de cuenta por pagar: `creditoproveedor.cpr_id`
- caja de origen: `caja.nombre`

## Deteccion de anulaciones

La tabla `cancelacion` no resulto confiable para compras y ventas de este flujo. En esta base revisada solo aparecieron registros para `detalleCom` y `comanda`.

Las señales utiles y consistentes fueron:

- activo: `status = 1`
- anulado: `status = -1`
- apoyo adicional: `can_caj_id IS NOT NULL` o `can_rcc_id IS NOT NULL`

Esto coincide con la logica ya soportada por `functions/index.js`.

## Tipos de pago encontrados

Catalogo en `tipopago`:

- `1 = Efectivo`
- `2 = Cheque`
- `3 = Crédito`
- `4 = Transferencia`
- `5 = Vales`
- `6 = Tarjeta`
- `7 = Anticipo`
- `8 = SICAR Pagos`

Observaciones:

- compras activas clasificadas por heuristica actual:
  - `sin_tipopago`: `7382`
  - `credito`: `2808`
  - `otro`: `513`
  - `efectivo`: `323`
- las compras a credito quedan bien identificadas por `creditoproveedor`
- las compras en efectivo recientes usan sobre todo `CAJA 2`, con algunos casos en `CAJA 3`

## Query sugerida para ventas diarias

Pensada para ejecutar el traspaso diario hacia `ingresos` a las `20:00` hora local y guardar un total por dia.

```sql
SELECT
  DATE(v.fecha) AS fecha,
  ROUND(SUM(v.total), 2) AS monto
FROM venta v
WHERE DATE(v.fecha) BETWEEN {{startDate}} AND {{endDate}}
  AND v.status = 1
GROUP BY DATE(v.fecha)
ORDER BY DATE(v.fecha);
```

Notas:

- no depende de `branchName` porque esta base local ya corresponde a una sola sucursal
- la anulacion queda fuera con `status = 1`

## Query sugerida para compras

Esta version ya devuelve `caja` por movimiento para que las compras en efectivo no dependan de una sola caja fija.

```sql
SELECT
  c.com_id AS compra_id,
  DATE(c.fecha) AS fecha,
  UPPER(p.nombre) AS proveedor,
  NULLIF(TRIM(c.folio), '') AS folio,
  NULLIF(TRIM(c.serieFolio), '') AS serieFolio,
  ROUND(c.total, 2) AS monto,
  CASE
    WHEN cp.cpr_id IS NOT NULL THEN 'credito'
    WHEN EXISTS (
      SELECT 1
      FROM compratipopago ctp
      JOIN tipopago tp ON tp.tpa_id = ctp.tpa_id
      WHERE ctp.com_id = c.com_id
        AND tp.nombre = 'Crédito'
    ) THEN 'credito'
    WHEN EXISTS (
      SELECT 1
      FROM compratipopago ctp
      JOIN tipopago tp ON tp.tpa_id = ctp.tpa_id
      WHERE ctp.com_id = c.com_id
        AND tp.nombre = 'Efectivo'
    ) THEN 'efectivo'
    WHEN EXISTS (
      SELECT 1
      FROM compratipopago ctp
      JOIN tipopago tp ON tp.tpa_id = ctp.tpa_id
      WHERE ctp.com_id = c.com_id
        AND tp.nombre = 'Transferencia'
    ) THEN 'transferencia'
    WHEN EXISTS (
      SELECT 1
      FROM compratipopago ctp
      JOIN tipopago tp ON tp.tpa_id = ctp.tpa_id
      WHERE ctp.com_id = c.com_id
        AND tp.nombre = 'Tarjeta'
    ) THEN 'tarjeta'
    WHEN EXISTS (
      SELECT 1
      FROM compratipopago ctp
      JOIN tipopago tp ON tp.tpa_id = ctp.tpa_id
      WHERE ctp.com_id = c.com_id
        AND tp.nombre = 'Cheque'
    ) THEN 'cheque'
    ELSE 'otro'
  END AS metodo_pago,
  DATE(cp.fechaLimite) AS vencimiento,
  cj.nombre AS caja,
  c.comentario AS detalle,
  c.status AS estado,
  c.can_caj_id,
  c.can_rcc_id
FROM compra c
LEFT JOIN proveedor p
  ON p.pro_id = c.pro_id
LEFT JOIN creditoproveedor cp
  ON cp.com_id = c.com_id
  AND cp.status <> -1
LEFT JOIN caja cj
  ON cj.caj_id = c.caj_id
WHERE DATE(c.fecha) BETWEEN {{startDate}} AND {{endDate}};
```

## Secrets a cargar en Firebase

- `SICAR_DB_HOST`
- `SICAR_DB_PORT`
- `SICAR_DB_USER`
- `SICAR_DB_PASSWORD`
- `SICAR_DB_NAME`
- `SICAR_INGRESOS_QUERY`
- `SICAR_COMPRAS_QUERY`
- `SICAR_SYNC_API_TOKEN`

Parametros recomendados para esta sucursal:

- `SICAR_BRANCH_ID = granada`
- `SICAR_BRANCH_NAME = CARNES SAN MARTIN GRANADA`
- `SICAR_TIMEZONE = America/Managua`
- `SICAR_CASHBOX_NAME = CAJA 2`

## Pendientes

- definir si ventas se dispararan por Functions consultando MySQL o por worker local empujando a Firestore
- cargar los secrets reales en Firebase
- probar una compra efectiva, una a credito, una anulada y una venta diaria real contra la Firebase nueva
- validar si `SICAR_CASHBOX_NAME` debe quedarse en `CAJA 2` como fallback o si todas las compras deben salir siempre con la caja real enviada en la query
