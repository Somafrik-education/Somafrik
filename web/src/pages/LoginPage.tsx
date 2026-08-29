import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ui/Toast";
import { Modal } from "../components/ui/Modal";
import { BrandLogo } from "../components/BrandLogo";
import { Button } from "../components/ui/shadcn/button";
import { Input } from "../components/ui/shadcn/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../components/ui/shadcn/form";
import { getDefaultAppPath } from "../lib/superAdminAccess";
import { showDemoAccounts } from "../lib/featureFlags";
import { cn } from "../lib/utils";
import { DEMO_ACCOUNT_GROUPS, DEMO_SCHOOL_CODE, type DemoAccount } from "../lib/demoAccounts";
import type { LoginProfile } from "../types";
import loginBackground from "../assets/somafrik-login-background.png";

const PROFILES: { id: LoginProfile; label: string }[] = [
  { id: "superadmin", label: "Super administrateur" },
  { id: "country", label: "Administrateur pays" },
  { id: "school", label: "Établissement" },
];

const loginSchema = z
  .object({
    profile: z.enum(["superadmin", "country", "school"]),
    schoolCode: z.string().optional(),
    identifier: z.string().min(1, "Identifiant requis"),
    password: z.string().min(1, "Mot de passe requis"),
  })
  .superRefine((values, ctx) => {
    if (values.profile === "school" && !values.schoolCode?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schoolCode"],
        message: "Code établissement requis",
      });
    }
  });

type LoginValues = z.infer<typeof loginSchema>;

const passwordChangeSchema = z
  .object({
    newPassword: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères."),
    confirmPassword: z.string().min(1, "Confirmation requise."),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Les mots de passe ne correspondent pas.",
  });

type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;

export function LoginPage() {
  const { login, changePassword, setSession, session } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [serverError, setServerError] = useState("");
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [backgroundStatus, setBackgroundStatus] = useState<"pending" | "ready" | "error">("pending");

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      profile: "school",
      schoolCode: DEMO_SCHOOL_CODE,
      identifier: "",
      password: "",
    },
  });

  const passwordForm = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const profile = form.watch("profile");
  const submitting = form.formState.isSubmitting;

  useEffect(() => {
    if (session?.accessToken && !session.user?.mustChangePassword) {
      navigate(getDefaultAppPath(session.user?.role), { replace: true });
    }
  }, [session, navigate]);

  function applyDemo(account: DemoAccount) {
    form.reset({
      profile: account.profile,
      identifier: account.identifier,
      password: account.password,
      schoolCode: account.schoolCode ?? DEMO_SCHOOL_CODE,
    });
    setServerError("");
  }

  function selectProfile(nextProfile: LoginProfile) {
    form.setValue("profile", nextProfile, { shouldValidate: true });
    setServerError("");
  }

  async function onSubmit(values: LoginValues) {
    setServerError("");
    try {
      const result = await login({
        identifier: values.identifier,
        password: values.password,
        profile: values.profile,
        schoolCode: values.profile === "school" ? values.schoolCode : undefined,
      });

      if (result.user?.mustChangePassword) {
        passwordForm.reset({ newPassword: "", confirmPassword: "" });
        setPasswordChangeError("");
        setPasswordChangeOpen(true);
        return;
      }

      showToast("Connexion réussie", "success");
      navigate(getDefaultAppPath(result.user?.role ?? ""), { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Échec de la connexion");
    }
  }

  async function onPasswordChange(values: PasswordChangeValues) {
    setPasswordChangeError("");
    try {
      await changePassword(values.newPassword.trim());
      setPasswordChangeOpen(false);
      showToast("Mot de passe mis à jour", "success");
      navigate(getDefaultAppPath(session?.user?.role ?? ""), { replace: true });
    } catch (err) {
      setPasswordChangeError(
        err instanceof Error ? err.message : "Échec du changement de mot de passe",
      );
    }
  }

  function cancelPasswordChange() {
    setPasswordChangeOpen(false);
    setSession(null);
    setPasswordChangeError("");
  }

  return (
    <div
      className={cn(
        "relative min-h-dvh overflow-x-hidden md:overflow-hidden",
        backgroundStatus === "error" ? "bg-slate-200" : "bg-transparent",
      )}
    >
      <img
        src={loginBackground}
        alt=""
        aria-hidden="true"
        data-testid="login-background"
        data-status={backgroundStatus}
        onLoad={() => setBackgroundStatus("ready")}
        onError={() => {
          setBackgroundStatus("error");
          console.error("[login] somafrik-login-background.png failed to decode or load", loginBackground);
        }}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
      {backgroundStatus !== "error" ? (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-950/20" />
      ) : null}

      <main className="relative z-10 flex min-h-dvh items-center justify-center px-3 py-3 sm:px-4">
        <section
          aria-labelledby="login-title"
          className="w-full max-w-[400px] rounded-2xl border border-white/70 bg-white/95 px-3.5 py-3 shadow-[0_18px_50px_-22px_rgba(15,23,42,0.55)] backdrop-blur-md sm:px-4 sm:py-3.5"
        >
          <div className="text-center">
            <BrandLogo
              className="justify-center"
              imageClassName="h-14 w-14 object-contain"
            />
            <p className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-brand">
              Accès sécurisé
            </p>
            <h1 id="login-title" className="mt-1 text-lg font-black tracking-tight text-ink">
              Connexion plateforme
            </h1>
          </div>

          <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-lg border border-line bg-slate-50 p-0.5 shadow-inner">
            {PROFILES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={profile === option.id}
                data-testid={`login-profile-${option.id}`}
                onClick={() => selectProfile(option.id)}
                className={cn(
                  "min-h-[44px] rounded-md px-1 py-1.5 text-center text-[11px] font-bold leading-tight transition sm:px-1.5",
                  profile === option.id
                    ? "bg-brand text-white shadow-brand"
                    : "text-slate-600 hover:bg-white hover:text-brand",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="mt-3 space-y-2.5">
              {profile === "school" ? (
                <FormField
                  control={form.control}
                  name="schoolCode"
                  render={({ field }) => (
                    <FormItem className="space-y-1">
                      <FormLabel required>Code établissement</FormLabel>
                      <FormControl>
                        <Input
                          className="h-[38px] bg-white"
                          placeholder="ex. CD-IN-26-001"
                          data-testid="login-school-code"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              <FormField
                control={form.control}
                name="identifier"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel required>Identifiant</FormLabel>
                    <FormControl>
                      <Input
                        className="h-[38px] bg-white"
                        placeholder="Entrez votre identifiant"
                        autoComplete="username"
                        data-testid="login-identifier"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="space-y-1">
                    <FormLabel required>Mot de passe</FormLabel>
                    <FormControl>
                      <Input
                        className="h-[38px] bg-white"
                        type="password"
                        placeholder="Entrez votre mot de passe"
                        autoComplete="current-password"
                        data-testid="login-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {serverError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-danger/15 bg-danger/10 px-3 py-2 text-sm font-medium text-danger"
                >
                  {serverError}
                </p>
              ) : null}

              <Button
                type="submit"
                className="h-[38px] w-full rounded-lg bg-brand-gradient font-bold text-white shadow-brand hover:bg-brand-gradient hover:opacity-95"
                disabled={submitting}
                data-testid="login-submit"
              >
                {submitting ? "Connexion…" : "Se connecter"}
              </Button>
            </form>
          </Form>

          {showDemoAccounts ? (
            <div className="mt-3 rounded-lg border border-dashed border-line bg-slate-50/90 p-2.5">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                Comptes de démonstration
              </p>
              <div className="space-y-2">
                {DEMO_ACCOUNT_GROUPS.map((group) => (
                  <div key={group.title}>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-brand">
                      {group.title}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.accounts.map((account) => (
                        <button
                          key={`${group.title}-${account.label}`}
                          type="button"
                          onClick={() => applyDemo(account)}
                          title={`${account.role} · ${account.identifier}`}
                          className="rounded-md border border-line bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-brand/40 hover:text-brand"
                        >
                          {account.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted">
                Mot de passe démo : <strong>1234</strong> · Code établissement :{" "}
                <strong>{DEMO_SCHOOL_CODE}</strong>
              </p>
            </div>
          ) : null}

          <div className="mt-2.5 border-t border-line pt-2.5 text-center">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-brand transition hover:text-brand-700"
            >
              <span aria-hidden>←</span>
              Retour à l’accueil
            </Link>
          </div>
        </section>
      </main>

      <Modal
        open={passwordChangeOpen}
        title="Nouveau mot de passe"
        description="Votre mot de passe temporaire a été accepté. Choisissez un nouveau mot de passe pour continuer."
        onClose={cancelPasswordChange}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={cancelPasswordChange}>
              Annuler
            </Button>
            <Button type="submit" form="login-password-change-form" disabled={passwordForm.formState.isSubmitting}>
              Enregistrer
            </Button>
          </>
        }
      >
        <Form {...passwordForm}>
          <form
            id="login-password-change-form"
            onSubmit={passwordForm.handleSubmit(onPasswordChange)}
            className="space-y-4"
          >
            <FormField
              control={passwordForm.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Nouveau mot de passe</FormLabel>
                  <FormControl>
                    <Input type="password" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={passwordForm.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>Confirmation</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {passwordChangeError ? <p className="text-sm text-danger">{passwordChangeError}</p> : null}
          </form>
        </Form>
      </Modal>
    </div>
  );
}
