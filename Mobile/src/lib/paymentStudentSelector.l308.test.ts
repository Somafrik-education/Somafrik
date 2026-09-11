/**
 * FIN-L3-08 RED-MOBILE — contrat de sélection élève (catalogue canonique).
 *
 * Cause visée sur develop :
 * - paymentStudentsFromOptions jette studentCode (matricule) → homonymes indistinguables
 * - aucune recherche nom/matricule : PaymentMutationControls n'expose que des chips nom
 * - pas de filtre schoolCode côté client
 */
import assert from "node:assert/strict";
import {
  L308_FOREIGN,
  L308_HOMONYM_A,
  L308_HOMONYM_B,
  L308_LEFTOVER_SCHOOL_CODE,
  L308_NON_LEFTOVER_SCHOOL_CODE,
  L308_SCHOOL_CODE,
  l308PickerLabel,
} from "../../../web/src/lib/financeL308PaymentStudent.fixture";
import * as enrollment from "./paymentEnrollment";
import { paymentStudentsFromOptions } from "./paymentEnrollment";

type PaymentSearchScopeSession = {
  user?: { schoolCode?: string; schoolPublicCode?: string };
  school?: { code?: string };
};

function paymentSearchScopeResolver() {
  return (enrollment as {
    resolvePaymentStudentSearchScope?: (session: PaymentSearchScopeSession | null) => string;
  }).resolvePaymentStudentSearchScope;
}

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "FIN-L3-08-M-CODE",
    title: "paymentStudentsFromOptions conserve studentCode (matricule) du catalogue",
    run() {
      const rows = paymentStudentsFromOptions([L308_HOMONYM_A]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, L308_HOMONYM_A.studentId);
      const code = (rows[0] as { studentCode?: string }).studentCode;
      assert.equal(
        code,
        L308_HOMONYM_A.studentCode,
        "studentCode jeté — le picker Mobile ne peut pas afficher le matricule ni chercher par identifiant",
      );
    },
  },
  {
    id: "FIN-L3-08-M-SEARCH",
    title: "searchPaymentStudents : nom + matricule, studentId UUID, isolation tenant",
    run() {
      const search = enrollment.searchPaymentStudents;
      assert.equal(typeof search, "function");
      const roster = paymentStudentsFromOptions([L308_HOMONYM_A, L308_HOMONYM_B, L308_FOREIGN]);
      const byName = search("Mbala", roster, L308_SCHOOL_CODE);
      assert.equal(byName.length, 2, "les deux Jean Mbala du tenant doivent sortir");
      assert.ok(
        byName.every((row) => row.id === L308_HOMONYM_A.studentId || row.id === L308_HOMONYM_B.studentId),
        "la recherche doit renvoyer le studentId UUID canonique, pas le nom affiché",
      );
      const byCode = search(L308_HOMONYM_A.studentCode, roster, L308_SCHOOL_CODE);
      assert.equal(byCode.length, 1);
      assert.equal(byCode[0].id, L308_HOMONYM_A.studentId);
      const foreign = search("Intru", roster, L308_SCHOOL_CODE);
      assert.equal(foreign.length, 0, "élève d'un autre établissement absent de la recherche");
    },
  },
  {
    id: "FIN-L3-08-M-HOMONYM",
    title: "libellé picker : nom + classe + matricule pour distinguer les homonymes",
    run() {
      const format = enrollment.formatPaymentStudentLabel;
      assert.equal(typeof format, "function");
      const rows = paymentStudentsFromOptions([L308_HOMONYM_A, L308_HOMONYM_B]);
      const labelA = format!(rows[0]);
      const labelB = format!(rows[1]);
      assert.notEqual(labelA, labelB);
      assert.equal(labelA, l308PickerLabel({ name: "Jean Mbala", className: "6ème A", studentCode: L308_HOMONYM_A.studentCode }));
      assert.match(labelB, /5ème B/);
      assert.match(labelB, new RegExp(L308_HOMONYM_B.studentCode));
    },
  },
  {
    id: "FIN-L3-08-M-LEFTOVER",
    title: "leftover CD-2026-0001 ne gagne pas contre schoolPublicCode V2",
    run() {
      const resolve = paymentSearchScopeResolver();
      assert.equal(
        typeof resolve,
        "function",
        "PaymentMutationControls prend encore schoolCode leftover avant schoolPublicCode",
      );
      const scope = resolve!({
        user: {
          schoolCode: L308_LEFTOVER_SCHOOL_CODE,
          schoolPublicCode: L308_SCHOOL_CODE,
        },
      });
      assert.equal(
        scope,
        L308_SCHOOL_CODE,
        "leftover CC-YYYY-NNNN ne doit pas devenir le filtre de recherche Élève",
      );
      const roster = paymentStudentsFromOptions([L308_HOMONYM_A, L308_FOREIGN]);
      const hits = enrollment.searchPaymentStudents("Mbala", roster, scope);
      assert.equal(hits.length, 1, "les élèves CD-IN-26-001 doivent rester trouvables");
      assert.equal(hits[0].id, L308_HOMONYM_A.studentId);
    },
  },
  {
    id: "FIN-L3-08-M-SCH001",
    title: "SCH-001 non leftover reste un tenant valide pour la recherche",
    run() {
      const resolve = paymentSearchScopeResolver();
      assert.equal(typeof resolve, "function");
      const scope = resolve!({ user: { schoolCode: L308_NON_LEFTOVER_SCHOOL_CODE } });
      assert.equal(scope, L308_NON_LEFTOVER_SCHOOL_CODE);
      const roster = paymentStudentsFromOptions([
        { ...L308_HOMONYM_A, schoolCode: L308_NON_LEFTOVER_SCHOOL_CODE },
        { ...L308_FOREIGN, schoolCode: "SCH-999" },
      ]);
      const hits = enrollment.searchPaymentStudents("Mbala", roster, scope);
      assert.equal(hits.length, 1);
      assert.equal(hits[0].id, L308_HOMONYM_A.studentId);
      assert.equal(enrollment.searchPaymentStudents("Intru", roster, scope).length, 0);
    },
  },
];

let failed = 0;
for (const item of cases) {
  try {
    item.run();
    console.log(`PASS ${item.id} ${item.title}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.id} ${item.title}`);
    console.error(error instanceof Error ? error.message : error);
  }
}
if (failed) {
  process.exitCode = 1;
  console.error(`\nRED ${failed}/${cases.length} cas FIN-L3-08 Mobile lib encore ouverts`);
} else {
  console.log(`\nGREEN ${cases.length}/${cases.length} cas FIN-L3-08 Mobile lib`);
}
