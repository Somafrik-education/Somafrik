import type { LoginProfile } from "../types";

export interface DemoAccount {
  label: string;
  role: string;
  identifier: string;
  password: string;
  profile: LoginProfile;
  schoolCode?: string;
}

export interface DemoAccountGroup {
  title: string;
  accounts: DemoAccount[];
}

export const DEMO_SCHOOL_CODE = "CD-IN-26-001";
export const DEMO_PASSWORD = "1234";

export const DEMO_ACCOUNT_GROUPS: DemoAccountGroup[] = [
  {
    title: "Plateforme",
    accounts: [
      {
        label: "Super Admin",
        role: "Super Administrateur Somafrik",
        identifier: "superadmin",
        password: DEMO_PASSWORD,
        profile: "superadmin",
      },
      {
        label: "Admin Pays RDC",
        role: "Admin Pays",
        identifier: "admin-rdc",
        password: DEMO_PASSWORD,
        profile: "country",
      },
      {
        label: "Admin Pays CG",
        role: "Admin Pays",
        identifier: "admin-cg",
        password: DEMO_PASSWORD,
        profile: "country",
      },
      {
        label: "Admin Pays BI",
        role: "Admin Pays",
        identifier: "admin-bi",
        password: DEMO_PASSWORD,
        profile: "country",
      },
    ],
  },
  {
    title: "Admins établissement",
    accounts: [
      {
        label: "Admin école CD",
        role: "Admin School",
        identifier: "admin",
        password: DEMO_PASSWORD,
        profile: "school",
        schoolCode: DEMO_SCHOOL_CODE,
      },
      {
        label: "Admin école CG",
        role: "Admin School",
        identifier: "admin-cg",
        password: DEMO_PASSWORD,
        profile: "school",
        schoolCode: "CG-2026-0001",
      },
      {
        label: "Admin école BI",
        role: "Admin School",
        identifier: "admin-bi",
        password: DEMO_PASSWORD,
        profile: "school",
        schoolCode: "BI-2026-0001",
      },
    ],
  },
  {
    title: "Établissement CD (rôles métier)",
    accounts: [
      {
        label: "Secrétaire",
        role: "Secrétaire",
        identifier: "secretaire",
        password: DEMO_PASSWORD,
        profile: "school",
        schoolCode: DEMO_SCHOOL_CODE,
      },
      {
        label: "Préfet des études",
        role: "Préfet des études",
        identifier: "prefet",
        password: DEMO_PASSWORD,
        profile: "school",
        schoolCode: DEMO_SCHOOL_CODE,
      },
      {
        label: "Enseignant",
        role: "Enseignant",
        identifier: "ENS-0001",
        password: DEMO_PASSWORD,
        profile: "school",
        schoolCode: DEMO_SCHOOL_CODE,
      },
      {
        label: "Parent",
        role: "Parent",
        identifier: "+243 820 000 001",
        password: DEMO_PASSWORD,
        profile: "school",
        schoolCode: DEMO_SCHOOL_CODE,
      },
      {
        label: "Élève",
        role: "Élève / Étudiant",
        identifier: "CD-IN-EL-26-001",
        password: DEMO_PASSWORD,
        profile: "school",
        schoolCode: DEMO_SCHOOL_CODE,
      },
    ],
  },
];

export const DEMO_ACCOUNTS = DEMO_ACCOUNT_GROUPS.flatMap((group) => group.accounts);
