/**
 * El correo NO es parte de este DTO a proposito -- Customer.email,
 * User.email y AuthAccount.email son tres campos independientes en el
 * codigo actual (solo se sincronizan una vez, al registrar), y
 * CustomerRepository.update() es un passthrough generico que solo toca
 * db.customers. Editar el correo aqui desincronizaria silenciosamente el
 * dato que el cliente ve de la credencial con la que realmente inicia
 * sesion. Ver auditoria previa a este PR.
 */
export interface ProfileFormDto {
  name: string;
  phone: string;
}
