"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  EmailSenderConfigDto,
  EmailSenderConfigInputDto,
} from "@/modules/administration/application/dto/EmailSenderConfigDto";
import { DisconnectEmailSenderService } from "@/modules/administration/application/services/DisconnectEmailSenderService";
import { GetEmailSenderConfigService } from "@/modules/administration/application/services/GetEmailSenderConfigService";
import { SaveEmailSenderConfigService } from "@/modules/administration/application/services/SaveEmailSenderConfigService";
import { SendEmailSenderTestService } from "@/modules/administration/application/services/SendEmailSenderTestService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import {
  EMAIL_CONFIG_MANAGE_PERMISSION,
  EMAIL_CONFIG_READ_PERMISSION,
} from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export type EmailSenderBusyAction = "save" | "test" | "disconnect";

export function useEmailSenderConfig() {
  const repositories = useRepositories();
  const { user, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const canManage = hasPermission(EMAIL_CONFIG_MANAGE_PERMISSION);
  const canRead = canManage || hasPermission(EMAIL_CONFIG_READ_PERMISSION);

  const getService = useMemo(() => new GetEmailSenderConfigService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveEmailSenderConfigService(repositories), [repositories]);
  const testService = useMemo(() => new SendEmailSenderTestService(repositories), [repositories]);
  const disconnectService = useMemo(
    () => new DisconnectEmailSenderService(repositories),
    [repositories],
  );

  const [config, setConfig] = useState<EmailSenderConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<EmailSenderBusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (sessionLoading || !tenantId || !canRead) return;
    try {
      setConfig(await getService.execute());
      setError(null);
    } catch (caughtError) {
      setError(cleanError(caughtError));
    }
  }, [canRead, getService, sessionLoading, tenantId]);

  useDataEvent("email-sender.changed", reload);

  useEffect(() => {
    let active = true;
    if (sessionLoading) return;
    if (!tenantId || !canRead) {
      window.queueMicrotask(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    getService
      .execute()
      .then((next) => {
        if (!active) return;
        setConfig(next);
        setError(null);
      })
      .catch((caughtError: unknown) => {
        if (active) setError(cleanError(caughtError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canRead, getService, sessionLoading, tenantId]);

  const run = useCallback(
    async (action: EmailSenderBusyAction, task: () => Promise<EmailSenderConfigDto>) => {
      setBusy(action);
      setError(null);
      try {
        const next = await task();
        setConfig(next);
        return next;
      } catch (caughtError) {
        const message = cleanError(caughtError);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const save = useCallback(
    (input: EmailSenderConfigInputDto) => run("save", () => saveService.execute(input)),
    [run, saveService],
  );
  const sendTest = useCallback(
    (recipient: string) => run("test", () => testService.execute(recipient)),
    [run, testService],
  );
  const disconnect = useCallback(
    () => run("disconnect", () => disconnectService.execute()),
    [disconnectService, run],
  );

  return {
    loading: loading || sessionLoading,
    busy,
    error,
    config,
    canRead,
    canManage,
    userEmail: user?.email ?? "",
    save,
    sendTest,
    disconnect,
    reload,
  };
}
