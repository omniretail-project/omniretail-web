/**
 * Politica de autenticacion multifactor (MFA), doc seccion 4.12.
 *
 * Fuente: Arquitectura_Frontend_SaaS.pdf, secciones 4.12 (MFA), 4.10 (fila
 * OTP/MFA de la tabla de tokens/limites) y 3.3.1 (entidades). Regla ancla:
 * R-A16 -- "Si la cuenta exige MFA, la contraseña correcta no crea sesion
 * definitiva hasta completar el segundo factor."
 *
 * El documento NO fija tres de estos numeros (dígitos del código, minutos
 * de vigencia del challenge, cantidad de recovery codes) -- solo dice
 * "puede simularse un código TOTP" y "se generan códigos de recuperación"
 * (plural, sin cantidad). Se documentan las decisiones propias abajo.
 */

/**
 * Máximo de intentos fallidos por desafío antes de invalidarlo. Este SÍ
 * está fijado por el documento (4.12 y 4.10 coinciden: "cinco fallos
 * consecutivos" / "máximo 5 intentos").
 */
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;

/**
 * Cantidad de dígitos del código MFA (tanto método "totp" simulado como
 * "email" simulado). El documento no fija un número -- solo dice "puede
 * simularse un código TOTP". Se usa 6 porque es el estándar universal de
 * TOTP real (Google Authenticator, Authy, etc.), y aplicarlo también al
 * método "email" mantiene ambos métodos con la misma UX de captura de
 * código, sin inventar dos formatos distintos.
 */
export const MFA_CODE_DIGITS = 6;

/**
 * Minutos de vigencia de un MfaChallenge (el desafío que se crea a mitad
 * de login()). La tabla 4.10 da minutos para otros tokens (30/15/24h) pero
 * la fila OTP/MFA solo especifica "5 intentos por desafío", sin un tiempo.
 * Se elige 5 minutos -- deliberadamente el más corto de todo el sistema --
 * porque a diferencia de un link de correo, el usuario ya está en la
 * pantalla de login, con el segundo factor a mano (o el correo ya
 * abierto); no hay razón para dejar un desafío vivo por más tiempo que
 * eso, y uno abandonado no debe quedar reutilizable indefinidamente.
 */
export const MFA_CHALLENGE_EXPIRATION_MINUTES = 5;

/**
 * Cantidad de códigos de recuperación generados al activar MFA. El
 * documento dice "se generan códigos de recuperación" (plural) sin
 * cantidad exacta. Se eligen 8 -- un número intermedio razonable, en
 * línea con lo que ofrecen sistemas reales conocidos (Google/GitHub
 * generan entre 8 y 10) -- ni tan pocos que se agoten rápido, ni tantos
 * que sea una lista incómoda de guardar.
 */
export const RECOVERY_CODES_COUNT = 8;
