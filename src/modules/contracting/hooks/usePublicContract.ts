"use client";

import { useCallback, useRef, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { CreatePublicContractService } from "@/modules/contracting/application/services/CreatePublicContractService";
import type { BusinessPreset } from "@/core/enums";
import {
  validatePublicContractForm,
  type PublicContractFormErrors,
  type PublicContractFormValues,
} from "@/modules/contracting/validation/publicContract.validation";

const INITIAL_VALUES: PublicContractFormValues = {
  businessName: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
  confirmPassword: "",
};

export function usePublicContract() {
  const repositories = useRepositories();
  const [values, setValues] = useState(INITIAL_VALUES);
  const [fieldErrors, setFieldErrors] = useState<PublicContractFormErrors>({});
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedBusinessName, setCompletedBusinessName] = useState<string>();
  const [businessPreset, setBusinessPreset] = useState<BusinessPreset>();
  const submittingRef = useRef(false);

  const setField = useCallback((field: keyof PublicContractFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(undefined);
  }, []);

  const submit = useCallback(async () => {
    if (submittingRef.current) return;

    const errors = validatePublicContractForm(values);
    setFieldErrors(errors);
    setFormError(undefined);
    if (Object.keys(errors).length > 0 || !businessPreset) {
      if (!businessPreset) setFormError("Selecciona el rubro comercial principal.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await new CreatePublicContractService(repositories).execute({
        businessName: values.businessName,
        adminName: values.adminName,
        adminEmail: values.adminEmail,
        adminPassword: values.adminPassword,
        businessPreset,
      });
      setCompletedBusinessName(values.businessName.trim());
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "No pudimos crear tu negocio. Intenta nuevamente.",
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [businessPreset, repositories, values]);

  return {
    values,
    setField,
    fieldErrors,
    formError,
    isSubmitting,
    completedBusinessName,
    businessPreset,
    setBusinessPreset,
    submit,
  };
}
