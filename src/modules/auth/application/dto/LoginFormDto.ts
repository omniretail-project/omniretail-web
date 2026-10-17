/**
 * Forma del formulario de login (capa UI). useLogin la mapea a
 * AuthRepository.LoginInput agregando deviceLabel segun corresponda.
 *
 * Sin selector de tipo de cuenta (Cliente/Personal): el usuario nunca
 * declara su tipo. AuthRepository.LoginInput.expectedUserType lo define la
 * RUTA que renderiza el login (/tienda/[tenantSlug]/iniciar-sesion ->
 * customer, /iniciar-sesion -> employee) y useLogin lo recibe como
 * parametro fijo, por eso no forma parte de este DTO ni es editable.
 *
 * Es una validacion del flujo de login (una cuenta de otro tipo falla con
 * el mismo error generico que una contraseña incorrecta, R-A13), NO una
 * frontera de autorizacion: la autorizacion real sigue siendo el usuario,
 * rol y permisos que devuelve la sesion (/auth/me en modo api).
 */
export interface LoginFormDto {
  email: string;
  password: string;
  rememberMe: boolean;
}
