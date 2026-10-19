"use client";

import { useMemo, useRef, useState } from "react";
import {
  type InformationRequestFieldErrors,
  type InformationRequestFormValues,
  type InformationRequestPayload,
  type InterestModuleCode,
  type SubmitInformationRequestResult,
} from "@/modules/information-request/application/dto/InformationRequestDto";
import { SubmitInformationRequestService } from "@/modules/information-request/application/services/SubmitInformationRequestService";
import { validateInformationRequest } from "@/modules/information-request/validation/informationRequest.schema";

const INITIAL_VALUES: InformationRequestFormValues = {
  fullName: "",
  businessName: "",
  email: "",
  phone: "",
  industry: "",
  modules: [],
  message: "",
  consentAccepted: false,
  website: "",
  captchaToken: "",
};

export type InformationRequestStatus = "idle" | "submitting" | "received" | "failed" | "uncertain";

export interface InformationRequestOptions {
  /** Cuando hay CAPTCHA configurado, el token es obligatorio antes de enviar. */
  captchaRequired?: boolean;
  service?: SubmitInformationRequestService;
}

/**
 * La clave de idempotencia identifica UNA peticion logica: se conserva en los reintentos con los
 * mismos datos (el token CAPTCHA no cuenta, caduca) y cambia en cuanto el usuario edita algo.
 */
function requestFingerprint(payload: InformationRequestPayload) {
  return JSON.stringify({ ...payload, captchaToken: "" });
}

export function useInformationRequest({
  captchaRequired = false,
  service: injectedService,
}: InformationRequestOptions = {}) {
  const service = useMemo(
    () => injectedService ?? new SubmitInformationRequestService(),
    [injectedService],
  );
  const [values, setValues] = useState<InformationRequestFormValues>(INITIAL_VALUES);
  const [fieldErrors, setFieldErrors] = useState<InformationRequestFieldErrors>({});
  const [status, setStatus] = useState<InformationRequestStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const submittingRef = useRef(false);
  const attemptRef = useRef<{ key: string; fingerprint: string } | null>(null);

  function setField<K extends keyof InformationRequestFormValues>(
    field: K,
    value: InformationRequestFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function toggleModule(module: InterestModuleCode) {
    setField(
      "modules",
      values.modules.includes(module)
        ? values.modules.filter((item) => item !== module)
        : [...values.modules, module],
    );
  }

  function applyResult(result: SubmitInformationRequestResult) {
    switch (result.status) {
      case "received":
        attemptRef.current = null;
        setRequestId(result.requestId);
        setMessage(null);
        setStatus("received");
        return;
      case "invalid":
        setFieldErrors(result.fields);
        setMessage(result.message);
        setStatus("failed");
        setCaptchaNonce((current) => current + 1);
        return;
      case "uncertain":
        // Se conserva la clave: reintentar la misma peticion no la duplica.
        setMessage(result.message);
        setStatus("uncertain");
        return;
      case "failed":
        setMessage(result.message);
        setStatus("failed");
        setCaptchaNonce((current) => current + 1);
        return;
    }
  }

  async function submit() {
    if (submittingRef.current) return;
    const validation = validateInformationRequest(values);
    const errors: InformationRequestFieldErrors = validation.ok ? {} : { ...validation.errors };
    if (captchaRequired && !values.captchaToken) {
      errors.captchaToken = "Completa la verificación de seguridad.";
    }
    if (Object.keys(errors).length > 0 || !validation.ok) {
      setFieldErrors(errors);
      setMessage(null);
      return;
    }

    const fingerprint = requestFingerprint(validation.payload);
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = { key: globalThis.crypto.randomUUID(), fingerprint };
    }
    const attempt = attemptRef.current;

    submittingRef.current = true;
    setFieldErrors({});
    setMessage(null);
    setStatus("submitting");
    try {
      applyResult(await service.execute(validation.payload, attempt.key));
    } finally {
      submittingRef.current = false;
    }
  }

  function reset() {
    attemptRef.current = null;
    setValues(INITIAL_VALUES);
    setFieldErrors({});
    setMessage(null);
    setRequestId(null);
    setStatus("idle");
    setCaptchaNonce((current) => current + 1);
  }

  return {
    values,
    fieldErrors,
    status,
    message,
    requestId,
    captchaNonce,
    isSubmitting: status === "submitting",
    setField,
    toggleModule,
    submit,
    reset,
  };
}
