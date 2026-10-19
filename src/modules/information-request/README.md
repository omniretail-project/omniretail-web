# Solicitudes de información

El navegador envía el formulario al Route Handler de mismo origen
`POST /api/public/contact-requests`. Ese proxy valida el contrato y reenvía únicamente el cuerpo
permitido a `${OMNIRETAIL_API_URL}/public/contact-requests`; el frontend nunca envía correos ni
expone la URL del backend al navegador.

## Configuración local

Frontend:

- `NEXT_PUBLIC_API_MODE=api` para usar las integraciones reales.
- `NEXT_PUBLIC_PUBLIC_DEMO` vacío o `false`; con demo pública Mock el backend queda bloqueado.
- `OMNIRETAIL_API_URL=http://localhost:8080/api/v1` (solo servidor, nunca `NEXT_PUBLIC_*`).
- `APP_ORIGIN=http://localhost:3000` es recomendable; si falta en desarrollo directo, el proxy usa
  el origen de la petición.
- `NEXT_PUBLIC_CONTACT_CAPTCHA_SITE_KEY` solo cuando CAPTCHA también está habilitado en backend.

Backend comercial:

- `COMMERCIAL_CONTACT_REQUESTS_ENABLED=true` crea el controller; apagado o ausente produce `404`.
- `COMMERCIAL_CONTACT_TEAM_TO` con el buzón receptor.
- `COMMERCIAL_CONTACT_HASH_SECRET` con al menos 32 caracteres; no debe compartirse ni registrarse.
- `MAIL_HOST`, `MAIL_PORT` y `MAIL_FROM`. Si el SMTP exige autenticación/TLS, también
  `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SMTP_AUTH=true` y `MAIL_SMTP_STARTTLS=true`.
- Para CAPTCHA: `COMMERCIAL_CAPTCHA_ENABLED=true` y `COMMERCIAL_CAPTCHA_SECRET`. Los límites,
  retención, reintentos y URL/timeout de verificación tienen defaults en `application.yaml` y no
  son obligatorios para desarrollo.

## Diagnóstico de disponibilidad

- `404`: el backend alcanzado no publica `/api/v1/public/contact-requests`, normalmente porque
  `COMMERCIAL_CONTACT_REQUESTS_ENABLED` está apagado. La UI muestra «El formulario no está
  disponible por el momento…».
- `503` generado por el proxy: falta `OMNIRETAIL_API_URL`, la demo pública Mock bloqueó el backend
  o la conexión al backend falló.
- `503` del backend: el endpoint existe, pero no pudo registrar la solicitud
  (`CONTACT_REQUESTS_UNAVAILABLE`).
- `500`, `502`, `504`, timeout o error de red se tratan como resultado incierto porque el backend
  podría haber registrado la solicitud antes del fallo.
