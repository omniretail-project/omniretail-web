# Límites de campos del módulo de administración

Este documento registra la primera capa de validación aplicada en las pantallas del módulo de administración. Sirve como referencia para alinear el backend cuando se implementen endpoints reales.

## Reglas transversales

- Los límites son de **caracteres visibles** después de recortar espacios al inicio y al final.
- Los correos usan estructura básica `usuario@dominio.tld` y máximo de 254 caracteres.
- Los teléfonos administrativos usan formato Guatemala: **8 dígitos** y la UI los muestra/persiste como `0000-0000` (**9 caracteres visibles** incluyendo el guion). El guion se inserta automáticamente después del cuarto dígito. Si un dato legado trae prefijo `502`, se normaliza quitando ese prefijo antes de validar.
- Los selects y checkboxes no se listan con longitud porque no aceptan texto libre; sus valores se validan contra catálogos/enums existentes.

## Sucursales

| Campo              | Requerido | Máximo | Formato / regla                                       |
| ------------------ | --------- | -----: | ----------------------------------------------------- |
| Código             | Sí        |     16 | Se normaliza a mayúsculas. Debe ser único por tenant. |
| Nombre             | Sí        |    120 | Texto libre prudente.                                 |
| Dirección          | No        |    180 | Texto libre.                                          |
| Teléfono           | No        |      9 | `0000-0000`, equivalente a 8 dígitos Guatemala.       |
| Correo electrónico | No        |    254 | Email válido.                                         |

## Usuarios / empleados

| Campo              | Requerido | Máximo | Formato / regla                                                                 |
| ------------------ | --------- | -----: | ------------------------------------------------------------------------------- |
| Nombre             | Sí        |    120 | Texto libre prudente.                                                           |
| Correo electrónico | Sí        |    254 | Email válido; se normaliza a minúsculas. En edición no se modifica desde la UI. |
| Teléfono           | No        |      9 | `0000-0000`, equivalente a 8 dígitos Guatemala.                                 |

## Roles y permisos

| Campo       | Requerido | Máximo | Formato / regla       |
| ----------- | --------- | -----: | --------------------- |
| Nombre      | Sí        |     80 | Texto libre prudente. |
| Descripción | No        |    240 | Texto libre.          |

## Proveedores

| Campo                     | Requerido | Máximo | Formato / regla                                       |
| ------------------------- | --------- | -----: | ----------------------------------------------------- |
| Nombre                    | Sí        |    120 | Texto libre prudente.                                 |
| Razón social              | No        |    160 | Texto libre.                                          |
| Identificación tributaria | No        |     20 | Texto libre para no asumir formato fiscal definitivo. |
| Correo electrónico        | No        |    254 | Email válido; se normaliza a minúsculas.              |
| Teléfono                  | No        |      9 | `0000-0000`, equivalente a 8 dígitos Guatemala.       |
| Dirección                 | No        |    180 | Texto libre.                                          |
| Notas                     | No        |    500 | Texto libre de observaciones internas.                |

## Cuentas bancarias

| Campo                          | Requerido                       | Máximo | Formato / regla                                               |
| ------------------------------ | ------------------------------- | -----: | ------------------------------------------------------------- |
| Banco                          | Sí                              |     80 | Texto libre prudente.                                         |
| Titular                        | Sí                              |    120 | Texto libre prudente.                                         |
| Alias                          | Sí                              |     50 | Nombre corto para identificar la cuenta.                      |
| Número de cuenta               | Sí en alta; opcional en edición |     24 | Solo dígitos. En edición, vacío conserva el número existente. |
| Instrucciones de transferencia | No                              |    300 | Texto libre.                                                  |

## Diseño E-commerce

| Campo               | Requerido | Máximo | Formato / regla                                 |
| ------------------- | --------- | -----: | ----------------------------------------------- |
| Nombre de la tienda | Sí        |    120 | Texto libre prudente.                           |
| Teléfono público    | No        |      9 | `0000-0000`, equivalente a 8 dígitos Guatemala. |
| Correo público      | No        |    254 | Email válido; se normaliza a minúsculas.        |
