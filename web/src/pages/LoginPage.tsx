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

const PROFILES: { id: LoginProfile; label: string }[] = [
  { id: "superadmin", label: "Super administrateur" },
  { id: "country", label: "Administrateur pays" },
  { id: "school", label: "Établissement" },
];

const LOGIN_BACKGROUND_URL = new URL(
  "../assets/somafrik-login-background.webp",
  import.meta.url,
).href;

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

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      profile: "superadmin",
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
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950">
      <img
        src={LOGIN_BACKGROUND_URL}
        alt=""
        aria-hidden="true"
        className="fixed inset-0 h-full w-full object-cover object-center"
      />
      <div aria-hidden="true" className="fixed inset-0 bg-slate-950/35" />
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-gradient-to-b from-slate-950/5 via-slate-950/10 to-slate-950/35"
      />

      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-4 sm:px-6 sm:py-6">
        <section
          aria-labelledby="login-title"
          className="w-full max-w-[440px] rounded-3xl border border-white/60 bg-white/95 p-4 shadow-[0_24px_70px_-24px_rgba(15,23,42,0.62)] backdrop-blur-xl sm:p-6"
        >
          <div className="text-center">
            <BrandLogo className="justify-center" size="md" />
            <p className="mt-3 text-[11px] font-black uppercase tracking-[0.18em] text-brand">
              Accès sécurisé
            </p>
            <h1 id="login-title" className="mt-1.5 text-xl font-black tracking-tight text-ink sm:text-2xl">
              Connexion plateforme
            </h1>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
              Connectez-vous à votre espace Somafrik.
            </p>
          </div>

          <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-slate-50 p-1 shadow-inner">
            {PROFILES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={profile === option.id}
                data-testid={`login-profile-${option.id}`}
                onClick={() => selectProfile(option.id)}
                className={cn(
                  "min-h-[52px] rounded-lg px-1.5 py-2 text-center text-[11px] font-bold leading-tight transition sm:px-2 sm:text-xs",
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 space-y-3.5">
              {profile === "school" ? (
                <FormField
                  control={form.control}
                  name="schoolCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Code établissement</FormLabel>
                      <FormControl>
                        <Input
                          className="h-10 bg-white"
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
                  <FormItem>
                    <FormLabel required>Identifiant</FormLabel>
                    <FormControl>
                      <Input
                        className="h-10 bg-white"
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
                  <FormItem>
                    <FormLabel required>Mot de passe</FormLabel>
                    <FormControl>
                      <Input
                        className="h-10 bg-white"
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
                  className="rounded-xl border border-danger/15 bg-danger/10 px-3 py-2.5 text-sm font-medium text-danger"
                >
                  {serverError}
                </p>
              ) : null}

              <Button
                type="submit"
                className="h-10 w-full rounded-xl bg-brand-gradient font-bold text-white shadow-brand hover:bg-brand-gradient hover:opacity-95"
                disabled={submitting}
                data-testid="login-submit"
              >
                {submitting ? "Connexion…" : "Se connecter"}
              </Button>
            </form>
          </Form>

          {showDemoAccounts ? (
            <div className="mt-4 rounded-xl border border-dashed border-line bg-slate-50/90 p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">
                Comptes de démonstration
              </p>
              <div className="space-y-2.5">
                {DEMO_ACCOUNT_GROUPS.map((group) => (
                  <div key={group.title}>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                      {group.title}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.accounts.map((account) => (
                        <button
                          key={`${group.title}-${account.label}`}
                          type="button"
                          onClick={() => applyDemo(account)}
                          title={`${account.role} · ${account.identifier}`}
                          className="rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-brand/40 hover:text-brand"
                        >
                          {account.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[10px] text-muted">
                Mot de passe démo : <strong>1234</strong> · Code établissement :{" "}
                <strong>{DEMO_SCHOOL_CODE}</strong>
              </p>
            </div>
          ) : null}

          <div className="mt-4 border-t border-line pt-4 text-center">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm font-bold text-brand transition hover:text-brand-700"
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
