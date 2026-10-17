export interface ChangePasswordFormDto {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  /**
   * PR13: solo se pide/envía si la cuenta tiene MFA activo (ver
   * AuthRepository.ChangePasswordInput.mfaCodeMock).
   */
  mfaCode?: string;
}
