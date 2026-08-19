"use strict";

const {
  PEDAGOGY_ERROR,
  asTrimmed,
  createPedagogyError,
  ignoreClientScope,
} = require("./pedagogyManagement");
const { formatRoomCode, extractRoomSequence } = require("./roomCodeAllocation");
const { isExclusionViolation, mapExclusionViolation } = require("./planningWeekly");
const { mapPedagogyPersistenceError } = require("./pedagogyReferences");

const ROOM_STATUSES = new Set(["active", "inactive", "archived"]);

function parseEquipment(value) {
  if (Array.isArray(value)) {
    return value.map((item) => asTrimmed(item)).filter(Boolean);
  }
  const raw = asTrimmed(value);
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => asTrimmed(item)).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return raw
    .split(/[,;|]/)
    .map((item) => asTrimmed(item))
    .filter(Boolean);
}

function parseCapacity(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw createPedagogyError(400, "capacity doit être un entier strictement positif.", "INVALID_CAPACITY");
  }
  return n;
}

function parseRoomStatus(value, fallback = "active") {
  const raw = asTrimmed(value).toLowerCase() || fallback;
  if (!ROOM_STATUSES.has(raw)) {
    throw createPedagogyError(400, "status salle invalide (active|inactive|archived).", "INVALID_ROOM_STATUS");
  }
  return raw;
}

function assertTenant(principal, schoolCode) {
  const scope = asTrimmed(principal?.schoolCode);
  if (!scope || scope === "*") return;
  if (asTrimmed(schoolCode).toUpperCase() !== scope.toUpperCase()) {
    throw createPedagogyError(403, "Accès refusé : établissement hors périmètre.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
}

async function resolveSchoolContext(tx, principal) {
  const schoolCode = asTrimmed(principal?.schoolCode);
  if (!schoolCode || schoolCode === "*") {
    throw createPedagogyError(400, "Établissement requis.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
  const school = await tx.getSchoolByCode(schoolCode);
  if (!school) throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  assertTenant(principal, school.code);
  return school;
}

async function writeAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordPedagogyAudit !== "function") {
    throw createPedagogyError(500, "Audit pédagogie indisponible dans la transaction.");
  }
  await tx.recordPedagogyAudit({
    schoolCode: entry.schoolCode || principal?.schoolCode,
    userId: principal?.sub || principal?.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId ?? ""),
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
}

async function allocateRoomCode(tx, schoolId) {
  await tx.one("SELECT id FROM schools WHERE id = $1 FOR UPDATE", [schoolId]);
  const row = await tx.one(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(room_code FROM 5) AS INTEGER)), 0) AS max
     FROM school_rooms
     WHERE school_id = $1 AND room_code ~ '^SAL-[0-9]{4}$'`,
    [schoolId],
  );
  return formatRoomCode(Number(row?.max ?? 0) + 1);
}

function mapRoomPersistenceError(error) {
  const message = String(error?.message ?? "");
  if (error?.code === "23505" && /uq_school_rooms_school_name_active|school_name/i.test(message)) {
    return createPedagogyError(409, "Une salle active porte déjà ce nom.", "ROOM_NAME_CONFLICT");
  }
  if (error?.code === "23505" && /uq_school_rooms_school_code|room_code/i.test(message)) {
    return createPedagogyError(409, "Code salle déjà attribué.", "ROOM_CODE_CONFLICT");
  }
  if (isExclusionViolation(error)) return mapExclusionViolation(error);
  return mapPedagogyPersistenceError(error);
}

async function listSchoolRooms(store, principal, query = {}) {
  return store.withTransaction(async (tx) => {
    const school = await resolveSchoolContext(tx, principal);
    const filters = {
      schoolId: school.id,
      status: asTrimmed(query.status) || "active",
      roomType: asTrimmed(query.type || query.roomType) || null,
      search: asTrimmed(query.search || query.q) || null,
      minCapacity: query.capacity != null && query.capacity !== "" ? Number(query.capacity) : null,
      classId: asTrimmed(query.classId || query.class_id) || null,
    };
    if (filters.status === "all") filters.status = null;
    if (filters.minCapacity != null && (!Number.isInteger(filters.minCapacity) || filters.minCapacity <= 0)) {
      throw createPedagogyError(400, "capacity filtre invalide.", "INVALID_CAPACITY");
    }
    const items = await tx.listSchoolRooms(filters);
    return { items };
  });
}

async function createSchoolRoom(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const name = asTrimmed(payload.name);
  if (!name) throw createPedagogyError(400, "Nom de salle obligatoire.");
  return store.withTransaction(async (tx) => {
    try {
      const school = await resolveSchoolContext(tx, principal);
      const roomCode = asTrimmed(payload.roomCode || payload.room_code);
      const allocated = roomCode && extractRoomSequence(roomCode) ? roomCode.toUpperCase() : await allocateRoomCode(tx, school.id);
      const saved = await tx.insertSchoolRoom({
        schoolId: school.id,
        roomCode: allocated,
        name,
        capacity: parseCapacity(payload.capacity),
        roomType: asTrimmed(payload.roomType || payload.type) || null,
        building: asTrimmed(payload.building) || null,
        floor: asTrimmed(payload.floor) || null,
        equipment: parseEquipment(payload.equipment),
        status: parseRoomStatus(payload.status, "active"),
      });
      await writeAudit(tx, principal, auditMeta, {
        action: "ROOM_CREATE",
        entityType: "school_room",
        entityId: saved.id,
        schoolCode: school.code,
        newValue: saved,
      });
      return saved;
    } catch (error) {
      throw mapRoomPersistenceError(error);
    }
  });
}

async function updateSchoolRoom(store, roomId, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    try {
      const school = await resolveSchoolContext(tx, principal);
      const existing = await tx.getSchoolRoomById(roomId, school.id);
      if (!existing) throw createPedagogyError(404, "Salle introuvable.", PEDAGOGY_ERROR.ROOM_NOT_FOUND);
      const saved = await tx.updateSchoolRoom(existing.id, school.id, {
        name: patch.name !== undefined ? asTrimmed(patch.name) : undefined,
        capacity: patch.capacity !== undefined ? parseCapacity(patch.capacity) : undefined,
        roomType: patch.roomType !== undefined || patch.type !== undefined
          ? asTrimmed(patch.roomType || patch.type) || null
          : undefined,
        building: patch.building !== undefined ? asTrimmed(patch.building) || null : undefined,
        floor: patch.floor !== undefined ? asTrimmed(patch.floor) || null : undefined,
        equipment: patch.equipment !== undefined ? parseEquipment(patch.equipment) : undefined,
        status: patch.status !== undefined ? parseRoomStatus(patch.status, existing.status) : undefined,
      });
      await writeAudit(tx, principal, auditMeta, {
        action: "ROOM_UPDATE",
        entityType: "school_room",
        entityId: saved.id,
        schoolCode: school.code,
        oldValue: existing,
        newValue: saved,
      });
      return saved;
    } catch (error) {
      throw mapRoomPersistenceError(error);
    }
  });
}

async function archiveSchoolRoom(store, roomId, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const school = await resolveSchoolContext(tx, principal);
    const existing = await tx.getSchoolRoomById(roomId, school.id);
    if (!existing) throw createPedagogyError(404, "Salle introuvable.", PEDAGOGY_ERROR.ROOM_NOT_FOUND);
    const saved = await tx.archiveSchoolRoom(existing.id, school.id);
    await writeAudit(tx, principal, auditMeta, {
      action: "ROOM_ARCHIVE",
      entityType: "school_room",
      entityId: saved.id,
      schoolCode: school.code,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function resolveActiveRoomId(tx, schoolId, roomIdRaw) {
  const roomId = asTrimmed(roomIdRaw);
  if (!roomId) return { roomId: null, room: null };
  const room = await tx.getSchoolRoomById(roomId, schoolId);
  if (!room) throw createPedagogyError(404, "Salle introuvable.", PEDAGOGY_ERROR.ROOM_NOT_FOUND);
  if (room.status !== "active") {
    throw createPedagogyError(409, "La salle n'est pas active.", PEDAGOGY_ERROR.ROOM_INACTIVE);
  }
  return { roomId: room.id, room };
}

function capacityWarningFor(room, classSize) {
  if (!room || room.capacity == null || classSize == null) return null;
  if (Number(room.capacity) >= Number(classSize)) return null;
  return {
    roomId: room.id,
    roomName: room.name,
    roomCapacity: Number(room.capacity),
    classSize: Number(classSize),
    message: `Salle ${room.name} : capacité ${room.capacity}. Classe : ${classSize} élèves. Capacité inférieure à l'effectif de la classe.`,
  };
}

module.exports = {
  parseEquipment,
  parseCapacity,
  listSchoolRooms,
  createSchoolRoom,
  updateSchoolRoom,
  archiveSchoolRoom,
  resolveActiveRoomId,
  capacityWarningFor,
};
