import type { AuthAccount, MfaMethod, Session, User } from "@/core/entities";
import type { AccountStatus, UserType } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

/**
 * Lectura administrativa MÍNIMA del estado de cuenta de un empleado (admin-users, módulo
 * administration). Nunca incluye `passwordHashMock`, historial de contraseñas,
 * `failedLoginAttempts`, secretos de MFA, recovery codes, `MfaChallenge` ni tokens de invitación
 * -- esos siguen siendo territorio exclusivo de Auth, ninguno de ellos tiene motivo para viajar
 * fuera de este módulo. `mfaEnabled` es el único booleano autoritativo (deriva de
 * `MfaEnrollment.enabled`, nunca de si existe un enrollment sin verificar). `lastLoginAt` viene
 * tal cual de `AuthAccount`.
 */
export interface EmployeeAuthSummary {
  userId: string;
  status: AccountStatus;
  mfaEnabled: boolean;
  lastLoginAt?: ISODateString;
}

export interface LoginInput {
  /**
   * Tenant "preferido" para resolver cuentas CUSTOMER -- el caller lo
   * obtiene del mecanismo de tenant publico ya existente
   * (usePublicTenant()), nunca de un campo que el usuario pueda declarar.
   * Opcional porque el login operacional (Employee/Admin) no depende de
   * el: ver la nota de resolucion por contexto+credenciales mas abajo.
   *
   * RESOLUCION POR CONTEXTO + CREDENCIALES (login() en MockAuthRepository),
   * pensada para que el UNICO formulario de login compartido por Customer
   * y Employee/Admin (desde que se unifico, sin tabs) no ate el acceso
   * operacional al storefront publico que este abierto, y para que una
   * cuenta encontrada primero jamas oculte a otra cuenta valida que
   * comparta el mismo email:
   *
   * 1. Se arma la lista de candidatos: cuentas CUSTOMER cuyo email
   *    coincide Y cuyo User.tenantId sea exactamente este tenantId (email
   *    unico POR tenant desde R-A03: el mismo email puede tener cuentas
   *    Customer distintas en tenants distintos, y sin tenantId resuelto
   *    no hay candidato Customer posible), mas TODAS las cuentas
   *    Employee/Admin cuyo email coincide, SIN restriccion de tenant --
   *    el login operacional no depende de cual storefront publico este
   *    cargado en el navegador.
   * 2. Con un unico candidato, se evalua ese directamente (caso comun).
   *    Con varios (colision real de email entre cuentas independientes,
   *    p.ej. un Customer de este tenant y un Employee de otro), la
   *    contraseña ingresada identifica cual: solo se autentica si
   *    exactamente UNA de las candidatas la tiene. Si ninguna coincide, o
   *    si dos cuentas independientes ademas comparten password mock, no
   *    hay forma segura de saber cual se intentaba autenticar -- fallo
   *    generico (R-A13: nunca revela cual cuenta, cual tenant, ni que
   *    hubo una colision), sin mutar el estado de ninguna candidata.
   *
   * Un Customer jamas puede terminar autenticado como la cuenta Employee
   * de otro tenant (ni viceversa) salvo que acierte exactamente SU
   * password, y sigue siendo su propia cuenta la que se autentica.
   */
  tenantId?: string;
  email: string;
  passwordMock: string;
  rememberMe?: boolean;
  deviceLabel?: string;
  /**
   * Optional expected account kind for this login attempt (e.g. which tab
   * the UI used: "Cliente" vs "Personal"). When provided, login() rejects
   * the attempt if the resolved account's User.type doesn't match — using
   * the exact same generic failure and failed-attempt accounting as a
   * wrong password (doc rule R-A13: never reveal which credential/check
   * failed). Optional so existing callers that don't care about the
   * distinction are unaffected.
   */
  expectedUserType?: UserType;
}

/**
 * Resultado de login() desde PR13 (MFA, doc R-A16): "si la cuenta exige
 * MFA, la contraseña correcta no crea sesión definitiva hasta completar
 * el segundo factor" -- por eso login() ya NO devuelve Session
 * directamente, sino uno de estos dos resultados. `demoCodeMock` en la
 * rama mfa_required existe solo porque este entorno no tiene un canal
 * real de entrega (SMS/app autenticadora) -- mismo criterio de
 * transparencia dummy que RegisterCustomerResult.emailVerificationToken.
 * Es opcional porque en modo api no existe: el codigo sale de la app
 * autenticadora del usuario.
 */
/**
 * "Continuar con Google" (solo clientes de una tienda). `idToken` es la
 * credencial que entrega Google Identity Services: solo viaja en memoria
 * hacia el backend, que la verifica con Google; nunca se guarda ni se
 * registra. La tienda se identifica por slug (como el registro), nunca por
 * un id elegido por el caller.
 */
export interface GoogleLoginInput {
  idToken: string;
  tenantSlug: string;
  rememberMe: boolean;
  deviceLabel?: string;
}

export type LoginResult =
  | { status: "authenticated"; session: Session }
  | { status: "mfa_required"; challengeId: string; method: MfaMethod; demoCodeMock?: string };

/**
 * Datos para registrar el segundo factor. Mock: `demoCodeMock` (transparencia
 * dummy). Modo api (TOTP real): `secret` en Base32 y `otpauthUri` para el
 * QR, que se genera solo en el navegador. El secreto nunca se guarda ni se
 * registra en ningun lado.
 */
export interface BeginMfaEnrollmentResult {
  demoCodeMock?: string;
  secret?: string;
  otpauthUri?: string;
}

/**
 * Lanzado por verifyMfaChallenge() cuando el desafío ya no se puede
 * reintentar (vencido, invalidado por demasiados fallos, o inexistente)
 * -- a diferencia de un código simplemente incorrecto con intentos
 * restantes (Error genérico común), este caso exige reiniciar el login
 * completo. Clase propia para que la UI distinga "seguí intentando" de
 * "volvé a empezar" sin parsear el texto del mensaje.
 */
export class MfaChallengeUnavailableError extends Error {
  constructor(message = "El código no es válido o venció. Vuelve a iniciar sesión.") {
    super(message);
    this.name = "MfaChallengeUnavailableError";
  }
}

export interface RegisterCustomerInput {
  tenantSlug: string;
  name: string;
  email: string;
  phone?: string;
  passwordMock: string;
}
/**
 * Lo unico que el registro devuelve de la cuenta: nunca su id (ni tenantId, customerId o roleId).
 * La respuesta es la misma para un correo nuevo y para uno ya registrado, asi que no hay ningun
 * identificador real que exponer.
 */
export interface RegisteredCustomerSummary {
  name: string;
  email: string;
  type: UserType;
}
export interface RegisterCustomerResult {
  user: RegisteredCustomerSummary;
  /**
   * Token de verificacion recien generado para ESTE registro, o null si
   * por algun motivo no se pudo generar. Existe unicamente porque este
   * entorno no envia correos reales -- en produccion este campo no
   * existiria, el token viajaria solo por el correo. Se entrega como
   * parte del resultado del registro (registration-scoped) en vez de
   * exponer un metodo separado que permita consultar el token de
   * cualquier usuario por id (ver historial de AuthRepository: asi
   * funcionaba antes y era un oraculo cross-account/cross-tenant).
   */
  emailVerificationToken: string | null;
}
export interface InviteEmployeeResult {
  user: User;
  /**
   * Igual que RegisterCustomerResult.emailVerificationToken: existe solo
   * porque este entorno no envía correos reales. Viaja exclusivamente
   * como resultado de ESTA invitación (invitation-scoped) -- nunca queda
   * un método separado para consultarlo después por userId, para no
   * repetir el oráculo cross-account que existía antes en el flujo de
   * cliente (ver historial: getActiveEmailVerificationToken, removido).
   */
  invitationToken: string | null;
}
/**
 * Reenvio del correo de verificacion de una cuenta de cliente pendiente. La tienda se identifica
 * por slug (igual que el registro), nunca por un id elegido por el caller.
 */
export interface ResendEmailVerificationInput {
  email: string;
  tenantSlug: string;
}
export interface RequestPasswordResetInput {
  email: string;
  /**
   * Igual que LoginInput.tenantId: alimenta únicamente la resolución de
   * candidatos CUSTOMER (tenant-scoped). Employee/Admin nunca depende de
   * esto. Opcional por la misma razón que en login().
   */
  tenantId?: string;
}
export interface ResetPasswordResult {
  userType: UserType;
  /** Present only for a Customer, so the UI can return to the authoritative tenant storefront. */
  tenantSlug?: string;
}
export interface ChangePasswordInput {
  /**
   * Se resuelve la identidad desde una sesión activa y no revocada, nunca
   * desde un userId declarado por el caller -- mismo criterio de "un dato
   * que el cliente puede declarar nunca es autoridad por sí solo" que ya
   * se aplicó en PR9 (EmployeeInvitation.tenantId) y PR10 (resolución de
   * candidatos). getCurrentSessionId() ya expone esto públicamente.
   */
  sessionId: string;
  currentPasswordMock: string;
  newPasswordMock: string;
  /**
   * PR13: obligatorio únicamente si la cuenta tiene MfaEnrollment
   * enabled=true -- interpretación de "reautenticar con contraseña
   * actual/MFA" (doc 4.13) como AMBOS factores para una cuenta que ya
   * tiene el segundo factor activo, no como alternativa que reemplace la
   * verificación de contraseña ya aprobada en PR12. No se afloja nada de
   * lo que ya estaba aprobado -- se agrega un requisito más, solo cuando
   * aplica.
   */
  mfaCodeMock?: string;
}
export interface AuthRepository {
  /**
   * CAMBIO DE CONTRATO (PR13, antes: Promise<Session>). Ver LoginResult.
   */
  login(input: LoginInput): Promise<LoginResult>;
  /**
   * Inicio de sesion de un cliente con Google. Mismo resultado que login():
   * la sesion, o el desafio de MFA si el cliente lo tiene activo. Si el
   * correo de Google no existe en la tienda, el backend crea la cuenta de
   * cliente. Error siempre generico, igual que login(). Mock: no disponible.
   */
  loginWithGoogle(input: GoogleLoginInput): Promise<LoginResult>;
  /**
   * Completa un login pausado por MFA (PR13). Igual que resetPassword/
   * activateEmployeeAccount: revalida todo antes de mutar (challenge
   * existe, no consumido, no invalidado, no vencido, intentos restantes)
   * y produce el mismo error genérico para cualquier motivo de rechazo --
   * no se distingue "código incorrecto" de "desafío vencido" hacia afuera
   * (R-A13).
   *
   * Al quinto fallo consecutivo (MFA_CHALLENGE_MAX_ATTEMPTS): invalida el
   * challenge y registra auditoría (`mfa_failed`) -- NO incrementa
   * failedLoginAttempts/lockout de la cuenta (regla explícita de 4.12:
   * los fallos de MFA no cuentan como contraseña fallida).
   */
  verifyMfaChallenge(challengeId: string, codeMock: string): Promise<Session>;
  /**
   * Reenvia el codigo del segundo paso del login cuando el metodo es
   * `email` (el de la app se genera en la app). Un desafio vencido, usado o
   * reemplazado lanza MfaChallengeUnavailableError (volver al paso 1).
   * Modo api: el codigo llega por correo y hay limite de envios (el backend
   * responde con su mensaje si todavia no se puede). Mock: devuelve el mismo
   * `demoCodeMock` (no rotativo), por transparencia dummy.
   */
  resendMfaChallengeCode(challengeId: string): Promise<{ demoCodeMock?: string }>;
  /**
   * Inicia (o reinicia, si había un enrollment sin verificar) el
   * enrolamiento de MFA para la sesión actual: genera un nuevo
   * demoCodeMock y crea/reemplaza el MfaEnrollment con
   * enabled=false/verifiedAt=undefined. Devuelve el código para
   * mostrarlo en pantalla -- transparencia dummy, mismo criterio que
   * registerCustomer.emailVerificationToken.
   */
  beginMfaEnrollment(sessionId: string, method: MfaMethod): Promise<BeginMfaEnrollmentResult>;
  /**
   * Confirma el código mostrado por beginMfaEnrollment. Marca
   * verifiedAt/enabled=true y genera RECOVERY_CODES_COUNT RecoveryCode
   * nuevos (reemplazando cualquier lote previo). Devuelve los códigos en
   * texto plano UNA sola vez -- igual que cualquier secreto de un solo
   * uso en este sistema, no hay un método separado para volver a
   * consultarlos después.
   */
  verifyMfaEnrollment(sessionId: string, codeMock: string): Promise<{ recoveryCodes: string[] }>;
  /**
   * Desactiva MFA. Requiere reautenticación con la contraseña actual
   * (mismo criterio que changePassword) -- apagar el segundo factor es
   * al menos tan sensible como cambiarlo. No borra el MfaEnrollment ni su
   * demoCodeMock (para que reactivar no obligue a "reescanear" nada);
   * simplemente enabled=false.
   */
  disableMfa(sessionId: string, currentPasswordMock: string): Promise<void>;
  /**
   * Estado actual de MFA para la sesión (PR13) -- lectura pura, sin mutar
   * nada. `null` si nunca se inició un enrollment. La UI de Seguridad lo
   * necesita para saber si mostrar "Activar" o "Desactivar" sin adivinar
   * a partir de otro estado.
   */
  getMfaStatus(sessionId: string): Promise<{ enabled: boolean; method: MfaMethod } | null>;
  /**
   * Con el MFA por correo activo, envia un codigo para una accion sensible
   * de la sesion (hoy: changePassword, como `mfaCodeMock`). Con el MFA por
   * app o sin MFA activo, lanza un error. Mock: devuelve el `demoCodeMock`.
   */
  requestMfaActionCode(sessionId: string): Promise<{ demoCodeMock?: string }>;
  logout(sessionId: string): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
  getCurrentSessionId(): Promise<string | null>;
  setActiveBranchId(branchId: string): Promise<void>;
  /**
   * Elimina el puntero de sesion persistido en este navegador,
   * incondicionalmente -- sin tocar el repositorio ni intentar revocar
   * nada del lado "servidor" (eso es logout()). Pensado como la garantia
   * de ultimo recurso: aunque logout() falle antes de completar la
   * revocacion remota, este metodo por si solo asegura que el navegador
   * ya no pueda reconstruir la sesion.
   */
  clearLocalSession(): Promise<void>;
  /**
   * El tenant del registro NO es un parametro que el caller elija -- no
   * existe forma de pasarlo. El repositorio resuelve internamente el
   * UNICO tenant publico (via el mismo slug que usa PublicTenantProvider,
   * @/config/publicStorefront) y valida que exista y este activo antes de
   * crear nada. Asi se cierra por completo la superficie de "sustituir
   * el tenant A por el tenant B": no hay ningun dato de entrada que
   * pueda cambiar a que tenant se registra un formulario publico de
   * registro.
   */
  registerCustomer(input: RegisterCustomerInput): Promise<RegisterCustomerResult>;
  /**
   * Reenvia el correo de verificacion de una cuenta de cliente pendiente. SIEMPRE resuelve sin
   * error (nunca lanza ni devuelve nada): la UI muestra el mismo mensaje generico exista o no la
   * cuenta, este o no verificada, o falle la red -- mismo criterio que requestPasswordReset (R-A19).
   * El token nuevo viaja solo por correo; ningun modo lo devuelve.
   */
  resendEmailVerification(input: ResendEmailVerificationInput): Promise<void>;
  /**
   * Solicita recuperación de contraseña. SIEMPRE resuelve exitosamente
   * (nunca lanza, nunca revela si el correo tiene o no una cuenta
   * asociada, ni si hubo rate limiting) -- R-A19: la UI muestra la misma
   * respuesta genérica pase lo que pase adentro. Por eso este método NO
   * devuelve ningún token/resultado (a diferencia de registerCustomer/
   * inviteEmployee, cuyo modo demo sí expone el token porque ahí la
   * existencia de la cuenta nunca fue un secreto que proteger). Para
   * pruebas manuales sin correo real, el token se lee directamente del
   * store (scripts/manual-verify-*.ts), nunca a través de un método del
   * repositorio -- exponerlo aquí reintroduciría exactamente el tipo de
   * oráculo que se cerró en PR8 (getActiveEmailVerificationToken).
   *
   * Mismo criterio de candidatos que login() (Customer tenant-scoped,
   * Employee sin restricción de tenant) -- pero SIN desambiguación por
   * contraseña: no se está autenticando como una única cuenta, así que
   * si el correo coincide con más de una cuenta independiente, CADA una
   * recibe su propio challenge (igual que en un sistema real, donde
   * ambas recibirían un correo separado a la misma bandeja de entrada).
   *
   * Por cada cuenta candidata: si ya alcanzó el límite de solicitudes
   * recientes (R-A21, PASSWORD_RESET_REQUEST_LIMIT dentro de
   * PASSWORD_RESET_COOLDOWN_MINUTES), esa cuenta se omite en silencio. Si
   * no, se invalida (supersededAt) cualquier challenge previo sin usar de
   * esa misma cuenta -- doc 4.10, "una nueva solicitud invalida el
   * enlace anterior" -- y se crea uno nuevo.
   */
  requestPasswordReset(input: RequestPasswordResetInput): Promise<void>;
  /**
   * Completa un reset vigente: valida que el token exista, no esté usado
   * ni superseded, y no haya vencido; que el User asociado siga
   * existiendo (nunca un fallback como "tenant-demo" para el tenant del
   * audit log si ya no existe -- mismo criterio que
   * activateEmployeeAccount desde PR9, aunque acá el AuthAccount ya
   * identifica inequívocamente a quién se le cambia la contraseña, así
   * que el riesgo es solo de atribución de auditoría, no de identidad);
   * valida la contraseña elegida contra la policy de Customer o Employee resuelta desde el User
   * asociado (para que una
   * llamada directa a este método no pueda saltarse lo que el formulario
   * ya exige, mismo patrón que activateEmployeeAccount); actualiza la
   * contraseña; revoca todas las sesiones existentes (R-A24); registra
   * una Notification de cambio de contraseña (R-A24, antes pendiente); y
   * desbloquea temporarily_locked/password_reset_required de vuelta a
   * active -- PERO NUNCA reactiva una cuenta disabled/archived (R-A25:
   * la contraseña cambia, el acceso no).
   */
  resetPassword(token: string, newPasswordMock: string): Promise<ResetPasswordResult>;
  verifyEmail(token: string): Promise<{ tenantSlug?: string }>;
  /**
   * Invita (o reinvita) a un empleado YA EXISTENTE a activar su acceso.
   * Nunca crea el User -- eso es responsabilidad de la pantalla de
   * administración de usuarios (/administracion/usuarios, módulo de
   * Jose, fuera de este repositorio). Este método resuelve únicamente la
   * parte de autenticación:
   *
   * - Sin AuthAccount todavía: se crea en AccountStatus.
   *   password_reset_required, con una contraseña inutilizable que nadie
   *   conoce y nunca se expone -- el cierre real de acceso es el status,
   *   no el secreto de esa contraseña: login() ya rechaza cualquier
   *   cuenta que no esté 'active' antes de comparar password (R-A12).
   * - Con AuthAccount en password_reset_required (invitación anterior
   *   vencida o nunca usada): se reutiliza la MISMA cuenta -- nunca se
   *   duplica un AuthAccount para el mismo userId -- y se emite una
   *   invitación nueva (doc 4.10: "si expira, Administración genera otra
   *   invitación"). La invitación anterior queda huérfana pero válida
   *   hasta su propio vencimiento, mismo criterio ya aceptado en
   *   requestPasswordReset() (tampoco invalida challenges previos).
   * - Con AuthAccount 'active': se rechaza -- reinvitar a alguien que ya
   *   activó su cuenta no es este flujo (sería password recovery, PR10).
   * - Con AuthAccount 'disabled'/'archived'/'temporarily_locked': se
   *   rechaza -- ninguno de esos estados se resuelve invitando de nuevo.
   *
   * Atribución de auditoría (limitación conocida, no un descuido): el
   * evento employee_invited que este método genera NO incluye un actor
   * administrativo -- este método sólo recibe el userId del empleado, no
   * la identidad de quién invita, porque todavía no existe el service
   * administrativo (/administracion/usuarios) que la proveería. Cuando
   * exista, ese caller deberá pasar la identidad del admin autenticado
   * para que el audit log la registre correctamente; hasta entonces, no
   * se le atribuye el evento a nadie (ni siquiera al propio empleado
   * invitado, que sería una atribución falsa).
   */
  /**
   * Boundary ESTRECHO exclusivo para el onboarding de un nuevo Tenant (feature/tenant-onboarding,
   * auditoría §5): crea un AuthAccount ya `active` (inmediatamente utilizable, contraseña real
   * elegida por el caller) para un User que ya existe -- a diferencia de `inviteEmployee`, que
   * deja la cuenta en `password_reset_required` con una contraseña inutilizable pensada para un
   * flujo de invitación por token. El primer admin de un Tenant nuevo necesita poder loguearse de
   * inmediato con la contraseña que se le asignó durante el alta, no completar una invitación.
   *
   * NUNCA se expone a la UI directamente -- el único consumidor autorizado es
   * `TenantOnboardingService`. No genera sesión (nunca hace login por sí mismo) ni usa ningún
   * fallback de tenant: recibe el `userId` de un User ya persistido y correcto.
   *
   * Nota de atomicidad: el flujo REAL de onboarding no invoca este método como una llamada de
   * repositorio separada -- `MockAuthRepository.bootstrapEmployeeAccount` abre su propio
   * `store.mutate()` independiente, igual que cualquier otro método de este repositorio, así que
   * llamarlo desde otro repositorio no comparte su draft (ver docstring de
   * `MockTenantOnboardingRepository`, que reproduce esta misma lógica de creación de cuenta
   * DENTRO de su único `store.transact()` para poder garantizar rollback real). Este método
   * existe igual como capacidad mínima e independientemente verificable del boundary de
   * bootstrap, y como pieza reutilizable fuera del onboarding atómico si alguna vez hiciera falta
   * (p.ej. rehidratar una cuenta de bootstrap perdida sin repetir todo el alta del Tenant).
   */
  bootstrapEmployeeAccount(userId: string, passwordMock: string): Promise<AuthAccount>;
  inviteEmployee(userId: string): Promise<InviteEmployeeResult>;
  /**
   * Completa una invitación vigente: establece la contraseña elegida por
   * el empleado y activa la cuenta. Antes de mutar nada, revalida que:
   * el token exista, no esté ya usado y no haya vencido; que la
   * AuthAccount asociada siga en password_reset_required (una invitación
   * hermana pudo haber activado la cuenta primero); que el User todavía
   * exista, siga siendo Employee, y siga perteneciendo al MISMO tenant
   * que tenía al momento de la invitación (EmployeeInvitation.tenantId,
   * nunca un fallback como "tenant-demo"); y que la contraseña elegida
   * cumpla EMPLOYEE_PASSWORD_POLICY -- la misma
   * regla que ya aplica el formulario, para que una llamada directa a
   * este método no pueda saltársela. Cualquiera de esas condiciones que
   * falle produce el mismo error genérico -- /activar-cuenta/[token] no
   * distingue el motivo hacia afuera, mismo criterio que
   * verifyEmail/resetPassword -- y no consume el token ni cambia ningún
   * estado.
   */
  activateEmployeeAccount(token: string, newPasswordMock: string): Promise<void>;
  /**
   * Cambia la contraseña de una cuenta YA autenticada (doc 4.1/4.13),
   * distinto de resetPassword() (PR10, no autenticado, por token/link).
   *
   * Reautenticación (doc 4.13, "reautenticar con contraseña actual/MFA"):
   * la reautenticación siempre incluye currentPasswordMock contra el hash
   * actual. Desde PR13, si la cuenta tiene MfaEnrollment.enabled=true,
   * ADEMÁS exige `mfaCodeMock` válido (ver ChangePasswordInput.mfaCodeMock)
   * -- ambos factores, no uno u otro.
   *
   * Valida newPasswordMock contra la policy Customer/Employee resuelta desde la sesión (mismo patrón que
   * resetPassword/activateEmployeeAccount: la política se aplica en la capa
   * funcional, no solo en el formulario), y además rechaza que
   * newPasswordMock sea igual a currentPasswordMock -- regla de UX (no del
   * documento de arquitectura) confirmada por QA manual, aplicada aquí y
   * no solo en el formulario por el mismo motivo que la password policy.
   *
   * Revoca las SESIONES RESTANTES (todas menos la que se usó para hacer este
   * cambio) -- distinto de resetPassword(), que revoca TODAS sin excepción
   * porque ahí no hay ninguna sesión activa legítima todavía (el reset llega
   * por link, no por una sesión). Acá el usuario sigue en el dispositivo
   * donde acaba de reautenticarse, y el doc dice explícitamente "revocar las
   * demás sesiones", no todas.
   *
   * Genérico por diseño (sirve para cualquier AuthAccount, Customer o
   * Employee) -- desde PR13 se conecta tanto desde "Mi Cuenta" del cliente
   * (SeguridadPage) como desde "Mi perfil" del empleado
   * (EmployeeSeguridadPage), sin duplicar esta lógica.
   */
  changePassword(input: ChangePasswordInput): Promise<void>;
  /**
   * Lectura batch para la tabla de administración de empleados (admin-users) -- NUNCA
   * `getById`-en-loop desde el caller (N+1). `tenantId` llega ya resuelto/autorizado por la
   * sesión administrativa activa, nunca de un valor declarado por el caller (mismo criterio que
   * `RoleRepository.getByIdScoped`/`BranchRepository.getByIdScoped`). `userIds` se deduplica
   * internamente. Cada `userId` que no pertenece a `tenantId`, no existe, o no tiene todavía un
   * `AuthAccount` (invitación nunca aceptada) simplemente NO aparece en el resultado -- no hay
   * forma de distinguir esos tres motivos desde afuera, mismo principio de no-oráculo que el
   * resto de estos contratos.
   */
  getEmployeeAuthSummariesByUserIds(
    tenantId: string,
    userIds: readonly string[],
  ): Promise<EmployeeAuthSummary[]>;
  /**
   * Revoca TODAS las sesiones activas de `userId` (no solo la que hizo el pedido) -- para
   * cambios de seguridad disparados por administration: inactivar el empleado, cambiarle el Role
   * o las sucursales asignadas. Idempotente: revocar sesiones ya revocadas o inexistentes no
   * falla, simplemente no cambia nada más. Nunca toca sesiones de otro `userId`. Verifica que
   * `userId` pertenezca a `tenantId` antes de tocar nada -- un intento cross-tenant no revoca
   * nada y no distingue "otro tenant" de "no existe" (mismo criterio que el resto del contrato).
   * Solo marca `Session.revokedAt`, igual que `logout()` -- `getSession()` ya trata cualquier
   * sesión con `revokedAt` como inválida, así que esto es efectivo de inmediato sin depender de
   * que ninguna UI se entere primero.
   */
  revokeAllSessionsByUserId(tenantId: string, userId: string): Promise<void>;
}
