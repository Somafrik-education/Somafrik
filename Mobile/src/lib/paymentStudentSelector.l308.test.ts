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
  L308_SCHOOL_CODE,
  l308PickerLabel,
} from "../../../web/src/lib/financeL308PaymentStudent.fixture";
import * as enrollment from "./paymentEnrollment";
import { paymentStudentsFromOptions } from "./paymentEnrollment";

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
      const search = (enrollment as { searchPaymentStudents?: typeof paymentStudentsFromOptions }).searchPaymentStudents;
      assert.equal(
        typeof search,
        "function",
        "Mobile n'expose pas searchPaymentStudents — ChoiceChips nom-seul, pas de recherche Élève",
      );
      const roster = paymentStudentsFromOptions([L308_HOMONYM_A, L308_HOMONYM_B, L308_FOREIGN]);
      const byName = search!("Mbala", roster as never, L308_SCHOOL_CODE as never);
      assert.equal(byName.length, 2, "les deux Jean Mbala du tenant doivent sortir");
      assert.ok(
        byName.every((row) => row.id === L308_HOMONYM_A.studentId || row.id === L308_HOMONYM_B.studentId),
        "la recherche doit renvoyer le studentId UUID canonique, pas le nom affiché",
      );
      const byCode = search!(L308_HOMONYM_A.studentCode, roster as never, L308_SCHOOL_CODE as never);
      assert.equal(byCode.length, 1);
      assert.equal(byCode[0].id, L308_HOMONYM_A.studentId);
      const foreign = search!("Intru", roster as never, L308_SCHOOL_CODE as never);
      assert.equal(foreign.length, 0, "élève d'un autre établissement absent de la recherche");
    },
  },
  {
    id: "FIN-L3-08-M-HOMONYM",
    title: "libellé picker : nom + classe + matricule pour distinguer les homonymes",
    run() {
      const format = (enrollment as { formatPaymentStudentLabel?: (row: unknown) => string }).formatPaymentStudentLabel;
      assert.equal(
        typeof format,
        "function",
        "formatPaymentStudentLabel absent — chips = item.name seulement, homonymes identiques",
      );
      const rows = paymentStudentsFromOptions([L308_HOMONYM_A, L308_HOMONYM_B]);
      const labelA = format!(rows[0]);
      const labelB = format!(rows[1]);
      assert.notEqual(labelA, labelB);
      assert.equal(labelA, l308PickerLabel({ name: "Jean Mbala", className: "6ème A", studentCode: L308_HOMONYM_A.studentCode }));
      assert.match(labelB, /5ème B/);
      assert.match(labelB, new RegExp(L308_HOMONYM_B.studentCode));
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
