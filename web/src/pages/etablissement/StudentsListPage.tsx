import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  EmptyState,
  EntityListForbidden,
  EntityListSearch,
  EntityListShell,
  EntityListTable,
  InlineAlert,
} from "@/design-system";
import { ApiError } from "../../api/client";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { useData } from "../../context/DataContext";
import { studentsApi, type SchoolStudent } from "../../lib/studentsApi";
import { scopedStudents } from "../../lib/establishment";
import { projectScopedStudents } from "../../lib/studentsScope";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { getEntityFeaturePermissions } from "../../lib/permissions";

function mapApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return err.message || "Accès refusé.";
    if (err.status === 400) return err.message || "Données invalides.";
    if (err.status >= 500) return err.message || "Erreur serveur. Réessayez plus tard.";
    return err.message || fallback;
  }
  return fallback;
}

function asSchoolStudents(rows: unknown[]): SchoolStudent[] {
  return rows as SchoolStudent[];
}

/**
 * Annuaire Élèves — snapshot canonique DataContext (même source que Vue d'ensemble).
 * Création : Classes → Inscrire un élève. Aucun bouton de création ni flux contact.
 * Retrait de l'annuaire : archivage PostgreSQL uniquement, jamais suppression physique.
 */
export function StudentsListPage() {
  const permissionCtx = usePermissionContext();
  const permissions = getEntityFeaturePermissions(permissionCtx, "students", "Élèves");
  const { scopedUser } = useActiveSchool();
  const { state, refresh, loading: dataLoading, error: dataError, scopeError } = useData();

  const studentsProjection = projectScopedStudents(scopedUser, state);
  const rows = asSchoolStudents(scopedStudents(scopedUser, state));
  const visibleScopeError = scopeError || studentsProjection.error?.message || null;

  const [search, setSearch] = useState("");
  const [archiving, setArchiving] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setMutationError(null);
    try {
      await refresh(["students"]);
    } catch (err) {
      setMutationError(mapApiError(err, "Impossible de charger les élèves."));
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [
        row.name,
        row.firstName,
        row.lastName,
        row.studentCode,
        row.matricule,
        row.loginCode,
        row.identifier,
        row.className,
        row.classCode,
        row.parentPhone,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  async function onArchive(row: SchoolStudent) {
    if (!permissions.canDelete || archiving) return;
    setArchiving(row.studentCode);
    setMutationError(null);
    try {
      await studentsApi.archive(row.studentCode);
      await refresh(["students"]);
    } catch (err) {
      setMutationError(mapApiError(err, "Archivage impossible."));
    } finally {
      setArchiving(null);
    }
  }

  const columns = useMemo(
    () => [
      {
        key: "lastName",
        header: "Nom",
        render: (row: SchoolStudent) => row.lastName || row.name || "—",
      },
      {
        key: "firstName",
        header: "Prénom",
        render: (row: SchoolStudent) => row.firstName || "—",
      },
      {
        key: "studentCode",
        header: "Matricule",
        render: (row: SchoolStudent) => row.studentCode || row.matricule || "—",
      },
      {
        key: "className",
        header: "Classe",
        render: (row: SchoolStudent) => row.className || "—",
      },
      {
        key: "actions",
        header: "Actions",
        sortable: false,
        render: (row: SchoolStudent) => (
          <div className="flex items-center gap-3">
            <Link
              className="text-sm font-semibold text-brand underline-offset-2 hover:underline"
              to={`/etablissement/eleves/${encodeURIComponent(row.studentCode)}`}
            >
              Dossier
            </Link>
            {permissions.canDelete ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={archiving === row.studentCode}
                onClick={() => void onArchive(row)}
              >
                {archiving === row.studentCode ? "Archivage…" : "Archiver"}
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [archiving, permissions.canDelete],
  );

  if (!permissions.canRead) {
    return <EntityListForbidden moduleLabel="élèves" />;
  }

  const loading = dataLoading || refreshing;
  const error = mutationError || (visibleScopeError ? null : dataError);

  return (
    <EntityListShell
      title="Élèves"
      description="Annuaire de consultation. Pour inscrire un élève, ouvrez une classe puis « Inscrire un élève »."
      alerts={
        <>
          {visibleScopeError ? (
            <InlineAlert tone="danger" title="Périmètre">
              {visibleScopeError}
            </InlineAlert>
          ) : null}
          {error ? (
            <InlineAlert tone="danger" title="Erreur">
              {error}
            </InlineAlert>
          ) : null}
        </>
      }
      filters={
        <EntityListSearch
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher dans élèves"
          aria-label="Rechercher dans élèves"
        />
      }
      primaryActions={null}
      secondaryActions={
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
          Actualiser
        </Button>
      }
    >
      {loading && rows.length === 0 && !visibleScopeError ? (
        <p className="text-sm text-muted">Chargement des élèves…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Liste vide"
          description="Aucun élève actif à afficher. Inscrivez un élève depuis une classe."
        />
      ) : (
        <EntityListTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.studentCode || row.publicId || row.id}
        />
      )}
    </EntityListShell>
  );
}
