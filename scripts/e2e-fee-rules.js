/**
 * Règles métier frais & tarifs (alignées web/src/lib/fees.ts).
 */
const { normalize } = require("./e2e-api-helpers");

const DEFAULT_MONTHLY_MONTHS = [
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
];

function newFeeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function feeGridKey(grid) {
  return [
    normalize(grid.schoolCode),
    normalize(grid.className),
    normalize(grid.academicYear),
    normalize(grid.periodName ?? ""),
  ].join("|");
}

function findDuplicateFeeGrid(grids, candidate) {
  const key = feeGridKey(candidate);
  return grids.find((grid) => grid.id !== candidate.id && feeGridKey(grid) === key);
}

function validateFeeGridInput(grid, items, state) {
  const className = String(grid.className ?? "").trim();
  if (!className) {
    return { ok: false, error: "La classe est obligatoire pour créer une grille tarifaire." };
  }
  const schoolCode = String(grid.schoolCode ?? "").trim();
  if (!schoolCode) {
    return { ok: false, error: "Le compte établissement est obligatoire." };
  }
  const academicYear = String(grid.academicYear ?? "").trim();
  if (!academicYear) {
    return { ok: false, error: "L'année scolaire est obligatoire." };
  }
  const currency = String(grid.currency ?? "").trim();
  if (!currency) {
    return { ok: false, error: "La devise est obligatoire." };
  }
  const duplicate = findDuplicateFeeGrid(state.feeGrids ?? [], {
    id: grid.id ?? "",
    schoolCode,
    className,
    academicYear,
    periodName: grid.periodName,
  });
  if (duplicate) {
    return {
      ok: false,
      error: `Une grille existe déjà pour ${className}, ${academicYear}${grid.periodName ? ` (${grid.periodName})` : ""}.`,
    };
  }
  const activeItems = items.filter((item) => item.status !== "Désactivé");
  if (!activeItems.length) {
    return { ok: false, error: "Ajoutez au moins un frais (inscription, mensualité ou annexe)." };
  }
  for (const item of activeItems) {
    const amount = Number(item.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "Chaque montant doit être strictement positif." };
    }
    if (!String(item.label ?? "").trim()) {
      return { ok: false, error: "Chaque frais doit avoir un libellé." };
    }
    if (item.feeType === "Mensualité") {
      const months = item.monthlyMonths ?? [];
      if (!months.length) {
        return { ok: false, error: "Sélectionnez au moins un mois pour la mensualité." };
      }
    }
  }
  return { ok: true };
}

function itemsForGrid(items, feeGridId) {
  return items.filter((item) => item.feeGridId === feeGridId && item.status === "Actif");
}

function studentDisplayName(student) {
  const first = String(student.firstName ?? "").trim();
  const last = String(student.name ?? student.lastName ?? "").trim();
  return `${first} ${last}`.trim() || String(student.id ?? "Élève");
}

function studentFeeDedupeKey(studentId, schoolFeeItemId, periodLabel) {
  return `${studentId}|${schoolFeeItemId}|${normalize(periodLabel ?? "")}`;
}

function buildStudentFeeFromItem(student, item, grid, periodLabel) {
  const amount = Number(item.amount);
  const studentId = String(student.id ?? "");
  return {
    id: newFeeId("STUFEE"),
    studentId,
    studentName: studentDisplayName(student),
    schoolCode: grid.schoolCode,
    className: grid.className,
    schoolFeeItemId: item.id,
    feeGridId: grid.id,
    feeType: item.feeType,
    label: periodLabel ? `${item.label} — ${periodLabel}` : item.label,
    currency: grid.currency,
    academicYear: grid.academicYear,
    initialAmount: amount,
    discount: 0,
    exemption: 0,
    amountDue: amount,
    amountPaid: 0,
    balance: amount,
    status: "À payer",
    dueDate: item.dueDate,
    periodLabel,
    createdAt: new Date().toISOString(),
  };
}

function applyFeeGridToStudents(state, feeGridId, options = {}) {
  const grid = (state.feeGrids ?? []).find((row) => row.id === feeGridId);
  if (!grid) {
    return { studentFees: state.studentFees ?? [], created: 0, skipped: 0, message: "Grille introuvable." };
  }
  if (grid.status !== "Active") {
    return {
      studentFees: state.studentFees ?? [],
      created: 0,
      skipped: 0,
      message: "Seule une grille active peut être appliquée aux élèves.",
    };
  }

  const items = itemsForGrid(state.schoolFeeItems ?? [], feeGridId);
  if (!items.length) {
    return {
      studentFees: state.studentFees ?? [],
      created: 0,
      skipped: 0,
      message: "Aucun frais actif dans cette grille.",
    };
  }

  const students = (state.students ?? []).filter((row) => {
    if (normalize(row.schoolCode) !== normalize(grid.schoolCode)) return false;
    if (normalize(String(row.className ?? "")) !== normalize(grid.className)) return false;
    if (options.studentIds?.length) {
      return options.studentIds.includes(String(row.id ?? ""));
    }
    return true;
  });

  const existing = state.studentFees ?? [];
  const existingKeys = new Set(
    existing.map((fee) => studentFeeDedupeKey(fee.studentId, fee.schoolFeeItemId, fee.periodLabel)),
  );
  const toAdd = [];
  let skipped = 0;

  for (const student of students) {
    for (const item of items) {
      if (item.feeType === "Mensualité") {
        const months = item.monthlyMonths?.length ? item.monthlyMonths : DEFAULT_MONTHLY_MONTHS;
        for (const month of months) {
          const key = studentFeeDedupeKey(String(student.id ?? ""), item.id, month);
          if (existingKeys.has(key)) {
            skipped += 1;
            continue;
          }
          const fee = buildStudentFeeFromItem(student, item, grid, month);
          toAdd.push(fee);
          existingKeys.add(key);
        }
        continue;
      }
      const key = studentFeeDedupeKey(String(student.id ?? ""), item.id);
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      const fee = buildStudentFeeFromItem(student, item, grid);
      toAdd.push(fee);
      existingKeys.add(key);
    }
  }

  return {
    studentFees: [...existing, ...toAdd],
    created: toAdd.length,
    skipped,
    message:
      toAdd.length === 0
        ? "Aucun nouveau frais généré : les dettes existent déjà pour ces élèves."
        : undefined,
  };
}

function applyActiveGridsToStudent(state, student) {
  const schoolCode = String(student.schoolCode ?? "").trim();
  const className = String(student.className ?? "").trim();
  if (!schoolCode || !className || !student.id) return state.studentFees ?? [];

  const activeGrids = (state.feeGrids ?? []).filter(
    (grid) =>
      grid.status === "Active" &&
      normalize(grid.schoolCode) === normalize(schoolCode) &&
      normalize(grid.className) === normalize(className),
  );

  let nextFees = state.studentFees ?? [];
  for (const grid of activeGrids) {
    const result = applyFeeGridToStudents(
      { ...state, studentFees: nextFees },
      grid.id,
      { studentIds: [String(student.id)] },
    );
    nextFees = result.studentFees;
  }
  return nextFees;
}

function expectedStudentFeeTotal(items) {
  return items.reduce((sum, item) => {
    if (item.feeType === "Mensualité") {
      const months = item.monthlyMonths?.length ? item.monthlyMonths : DEFAULT_MONTHLY_MONTHS;
      return sum + Number(item.amount) * months.length;
    }
    return sum + Number(item.amount);
  }, 0);
}

function studentFeesMatchGrid(studentFees, studentId, grid, items) {
  const fees = studentFees.filter((fee) => fee.studentId === studentId && fee.feeGridId === grid.id);
  const expectedTotal = expectedStudentFeeTotal(items);
  const actualTotal = fees.reduce((sum, fee) => sum + Number(fee.amountDue ?? 0), 0);
  return {
    fees,
    expectedTotal,
    actualTotal,
    ok: fees.length > 0 && actualTotal === expectedTotal,
  };
}

module.exports = {
  DEFAULT_MONTHLY_MONTHS,
  newFeeId,
  validateFeeGridInput,
  itemsForGrid,
  applyFeeGridToStudents,
  applyActiveGridsToStudent,
  expectedStudentFeeTotal,
  studentFeesMatchGrid,
};
