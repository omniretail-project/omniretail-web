import { validatePhoneNumber } from "@/config/contact-policy";
import { TEXT_FIELD_POLICY, validateMaxLength } from "@/config/text-field-policy";
import type { ProfileFormDto } from "@/modules/customer/application/dto/ProfileFormDto";

export type ProfileValidationErrors = Partial<Record<"name" | "phone", string>>;

/**
 * Telefono opcional, misma regla canonica que register.validation.ts
 * (validatePhoneNumber en config/contact-policy.ts) -- antes cada
 * formulario duplicaba a mano "largo >= 8, sin más formato", que
 * dejaba pasar letras/símbolos.
 */
export function validateProfileForm(dto: ProfileFormDto): ProfileValidationErrors {
  const errors: ProfileValidationErrors = {};

  if (!dto.name.trim()) {
    errors.name = "El nombre es obligatorio.";
  } else {
    const lengthError = validateMaxLength(dto.name, TEXT_FIELD_POLICY.NAME_MAX_LENGTH, "El nombre");
    if (lengthError) errors.name = lengthError;
  }

  const phoneError = validatePhoneNumber(dto.phone);
  if (phoneError) {
    errors.phone = phoneError;
  }

  return errors;
}

export function hasProfileValidationErrors(errors: ProfileValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
