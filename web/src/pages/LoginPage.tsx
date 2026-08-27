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
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between bg-gradient-to-br from-brand to-brand-700 p-12 text-white lg:flex">
        <BrandLogo variant="onDark" size="hero" />
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-black leading-tight">
            La plateforme qui simplifie la gestion de votre établissement scolaire
          </h2>
          <p className="text-white/80">
            Établissements, utilisateurs, droits, élèves, enseignants, présences, notes, paiements,
            communications et rapports — pilotés depuis une plateforme unique et sécurisée.
          </p>
        </div>
        <p className="text-sm text-white/60">© {new Date().getFullYear()} Somafrik</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-6">
          <BrandLogo className="mb-4 lg:hidden" size="xl" />
          <div>
            <Link
              to="/"
              className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted transition hover:text-brand"
            >
              <span aria-hidden>←</span> Retour à l’accueil
            </Link>
            <h1 className="text-2xl font-black text-ink">Connexion plateforme</h1>
            <p className="mt-1 text-sm text-muted">
              Sélectionnez un compte démo ou saisissez vos identifiants.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PROFILES.map((option) => (
              <button
                key={option.id}
                type="button"
                data-testid={`login-profile-${option.id}`}
                onClick={() => form.setValue("profile", option.id, { shouldValidate: true })}
                className={cn(
                  "rounded-xl border px-2 py-3 text-center text-xs font-bold transition",
                  profile === option.id
                    ? "border-brand bg-brand-50 text-brand"
                    : "border-line bg-white text-slate-600 hover:border-brand/40",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {profile === "school" ? (
                <FormField
                  control={form.control}
                  name="schoolCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>Code établissement</FormLabel>
                      <FormControl>
                        <Input
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
                        placeholder="ex. identifiant administrateur"
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
                        type="password"
                        placeholder="••••"
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
                <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                  {serverError}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={submitting} data-testid="login-submit">
                {submitting ? "Connexion…" : "Se connecter"}
              </Button>
            </form>
          </Form>

          {showDemoAccounts ? (
          <div className="rounded-xl border border-dashed border-line bg-slate-50 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
              Comptes de démonstration
            </p>
            <div className="space-y-3">
              {DEMO_ACCOUNT_GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-brand">
                    {group.title}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.accounts.map((account) => (
                      <button
                        key={`${group.title}-${account.label}`}
                        type="button"
                        onClick={() => applyDemo(account)}
                        title={`${account.role} · ${account.identifier}`}
                        className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand/40 hover:text-brand"
                      >
                        {account.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">
              Mot de passe démo : <strong>1234</strong> · Code établissement :{" "}
              <strong>{DEMO_SCHOOL_CODE}</strong>
            </p>
          </div>
          ) : null}
        </div>
      </section>

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
            {passwordChangeError ? (
              <p className="text-sm text-danger">{passwordChangeError}</p>
            ) : null}
          </form>
        </Form>
      </Modal>
    </div>
  );
}
