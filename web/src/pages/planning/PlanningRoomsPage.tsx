import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DoorOpen } from "lucide-react";
import { ApiError } from "../../api/client";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { DataTable } from "../../components/ui/DataTable";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/ui/ConfirmDialog";
import { useFeaturePermissions } from "../../lib/usePermissionContext";
import { schoolRoomsApi, type SchoolRoom } from "../../lib/planningRoomsReplacementsApi";

const ROOM_TYPES = [
  { value: "", label: "—" },
  { value: "Salle de classe", label: "Salle de classe" },
  { value: "Laboratoire", label: "Laboratoire" },
  { value: "Amphithéâtre", label: "Amphithéâtre" },
  { value: "Salle informatique", label: "Salle informatique" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archivée" },
];

type FormState = {
  id: string;
  name: string;
  capacity: string;
  roomType: string;
  building: string;
  floor: string;
  equipment: string;
  status: string;
};

const EMPTY_FORM: FormState = {
  id: "",
  name: "",
  capacity: "",
  roomType: "Salle de classe",
  building: "",
  floor: "",
  equipment: "",
  status: "active",
};

function statusLabel(status: string): string {
  if (status === "inactive") return "Inactive";
  if (status === "archived") return "Archivée";
  return "Active";
}

export function PlanningRoomsPage() {
  const { canRead, canCreate, canUpdate, canDelete } = useFeaturePermissions("Salles");
  const { showToast } = useToast();
  const { confirm } = useConfirm();
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "forbidden">("loading");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<SchoolRoom[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!canRead) {
      setStatus("forbidden");
      return;
    }
    setStatus("loading");
    try {
      const result = await schoolRoomsApi.list({ status: "all", search });
      setItems(result.items ?? []);
      setStatus("ok");
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setStatus("forbidden");
        return;
      }
      setStatus("error");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, search]);

  const columns = useMemo<ColumnDef<SchoolRoom>[]>(
    () => [
      { accessorKey: "roomCode", header: "Code" },
      { accessorKey: "name", header: "Salle" },
      {
        accessorKey: "capacity",
        header: "Capacité",
        cell: ({ getValue }) => getValue<number | null>() ?? "—",
      },
      { accessorKey: "roomType", header: "Type" },
      { accessorKey: "building", header: "Bâtiment" },
      {
        id: "equipment",
        header: "Équipements",
        cell: ({ row }) => (row.original.equipment || []).join(", ") || "—",
      },
      { accessorKey: "occupationToday", header: "Occupation aujourd'hui" },
      {
        accessorKey: "status",
        header: "Statut",
        cell: ({ getValue }) => statusLabel(String(getValue() ?? "")),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-2">
            {canUpdate ? (
              <Button variant="secondary" onClick={() => openEdit(row.original)}>
                Modifier
              </Button>
            ) : null}
            {canDelete && row.original.status !== "archived" ? (
              <Button variant="secondary" onClick={() => void archiveRoom(row.original)}>
                Archiver
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [canUpdate, canDelete],
  );

  function openCreate() {
    setForm({ ...EMPTY_FORM });
  }

  function openEdit(room: SchoolRoom) {
    setForm({
      id: room.id,
      name: room.name,
      capacity: room.capacity != null ? String(room.capacity) : "",
      roomType: room.roomType || "",
      building: room.building || "",
      floor: room.floor || "",
      equipment: (room.equipment || []).join(", "),
      status: room.status,
    });
  }

  async function archiveRoom(room: SchoolRoom) {
    const ok = await confirm({
      title: "Archiver la salle",
      description: `${room.name} sera archivée. L'historique des créneaux est conservé.`,
    });
    if (!ok) return;
    try {
      await schoolRoomsApi.archive(room.id);
      showToast("Salle archivée", "success");
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'archivage.", "error");
    }
  }

  async function saveForm() {
    if (!form) return;
    if (!form.name.trim()) {
      showToast("Le nom de la salle est obligatoire.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        capacity: form.capacity.trim() ? Number(form.capacity) : null,
        roomType: form.roomType.trim() || null,
        building: form.building.trim() || null,
        floor: form.floor.trim() || null,
        equipment: form.equipment,
        status: form.status,
      };
      if (form.id) await schoolRoomsApi.update(form.id, payload);
      else await schoolRoomsApi.create(payload);
      showToast(form.id ? "Salle mise à jour" : "Salle créée", "success");
      setForm(null);
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Échec de l'enregistrement.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (status === "forbidden" || !canRead) {
    return (
      <Card className="p-6" data-testid="planning-rooms-forbidden">
        <p className="text-sm font-semibold text-muted">Accès refusé au module Salles.</p>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="p-6" data-testid="planning-rooms-error">
        <p className="text-sm font-semibold text-danger">Impossible de charger les salles.</p>
        <Button className="mt-3" onClick={() => void load()}>
          Réessayer
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5" data-testid="planning-rooms-page">
      <Card className="p-6">
        <SectionHeader
          title="Salles"
          description="Ressources durables de l'établissement. Un créneau pointe vers un identifiant de salle, jamais un libellé libre."
          actions={
            canCreate ? (
              <Button data-testid="planning-room-create" onClick={openCreate}>
                + Ajouter une salle
              </Button>
            ) : null
          }
        />
        <div className="mt-4 max-w-md">
          <Field label="Rechercher une salle">
            <Input
              data-testid="planning-room-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom, code, bâtiment"
            />
          </Field>
        </div>
        <div className="mt-4">
          {status === "loading" ? (
            <p className="text-sm text-muted">Chargement des salles…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-16 text-center" data-testid="planning-rooms-empty">
              <DoorOpen className="mb-3 h-10 w-10 text-muted" />
              <h3 className="text-lg font-black text-ink">Aucune salle</h3>
              <p className="mt-1 max-w-md text-sm text-muted">
                Ajoutez une première salle pour pouvoir l'affecter depuis l'emploi du temps.
              </p>
            </div>
          ) : (
            <DataTable columns={columns} data={items} emptyLabel="Aucune salle." />
          )}
        </div>
      </Card>

      {form ? (
        <Card className="p-6" data-testid="planning-room-form">
          <SectionHeader title={form.id ? "Modifier la salle" : "Nouvelle salle"} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Nom" required>
              <Input
                data-testid="planning-room-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label="Capacité">
              <Input
                type="number"
                min={1}
                data-testid="planning-room-capacity"
                value={form.capacity}
                onChange={(event) => setForm({ ...form, capacity: event.target.value })}
              />
            </Field>
            <Field label="Type">
              <Select
                options={ROOM_TYPES}
                value={form.roomType}
                onChange={(event) => setForm({ ...form, roomType: event.target.value })}
              />
            </Field>
            <Field label="Bâtiment">
              <Input value={form.building} onChange={(event) => setForm({ ...form, building: event.target.value })} />
            </Field>
            <Field label="Étage">
              <Input value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} />
            </Field>
            <Field label="Statut">
              <Select
                options={STATUS_OPTIONS}
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
              />
            </Field>
            <Field label="Équipements" hint="Séparés par des virgules">
              <Input
                value={form.equipment}
                onChange={(event) => setForm({ ...form, equipment: event.target.value })}
                placeholder="Tableau, projecteur"
              />
            </Field>
          </div>
          <div className="mt-4 flex gap-3">
            <Button data-testid="planning-room-save" disabled={saving} onClick={() => void saveForm()}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Fermer
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
