"use client";

import { useCallback, useState } from "react";
import { PasswordPolicyError } from "@/config/auth-policy";
import type { ResetPasswordResult } from "@/core/repositories/AuthRepository";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import {
  hasResetPasswordValidationErrors,
  validateResetPasswordForm,
  type ResetPasswordFormDto,
  type ResetPasswordValidationErrors,
} from "@/modules/auth/validation/resetPassword.validation";

export function useResetPassword(token: string) {
  const repositories = useRepositories();

  const [password, setPasswordState] = useState("");
  const [confirmPassword, setConfirmPasswordState] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ResetPasswordValidationErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [result, setResult] = useState<ResetPasswordResult | null>(null);

  const setPassword = useCallback((value: string) => {
    setPasswordState(value);
    setFieldErrors((current) => {
      if (!current.password && !current.confirmPassword) return current;
      const validation = validateResetPasswordForm({ password: value, confirmPassword });
      return { ...current, password: validation.password, confirmPassword: validation.confirmPassword };
    });
  }, [confirmPassword]);
  const setConfirmPassword = useCallback((value: string) => {
    setConfirmPasswordState(value);
    setFieldErrors((current) => {
      if (!current.confirmPassword) return current;
      return { ...current, confirmPassword: validateResetPasswordForm({ password, confirmPassword: value }).confirmPassword };
    });
  }, [password]);

  const submit = useCallback(async () => {
    setFormError(undefined);

    const dto: ResetPasswordFormDto = { password, confirmPassword };
    const errors = validateResetPasswordForm(dto);
    setFieldErrors(errors);

    if (hasResetPasswordValidationErrors(errors)) {
      return;
    }

    setIsSubmitting(true);
    try {
      const resetResult = await repositories.auth.resetPassword(token, dto.password);
      setResult(resetResult);
      setCompleted(true);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        setFormError(error.message);
        return;
      }
      // Mismo criterio que verifyEmail/activateEmployeeAccount: token
      // inexistente, ya usado, superseded o vencido producen el mismo
      // mensaje genérico.
      setFormError("Este enlace no es válido o ya expiró.");
    } finally {
      setIsSubmitting(false);
    }
  }, [confirmPassword, password, repositories, token]);

  return {
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    fieldErrors,
    formError,
    isSubmitting,
    completed,
    result,
    submit,
  };
}
