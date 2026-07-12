/**
 * Flux Contacts → fiches opérationnelles pour les tests E2E API.
 */
const path = require("path");
const { newId, normalize } = require("./e2e-api-helpers");
const {
  prepareContactForSave,
  validateContactDuplicate,
  assertContactRequiredFields,
} = require("./e2e-contacts-rules");
const { linkContactToOperationalRecord } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "contactRegistrySync",
));

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block, duplicate };
  const contact = { ...prepared, id: draft.id ?? newId("CONTACT") };
  return { ok: true, contact };
}

function createStudentFromContact(state, contactDraft, schoolCode, enrollment = {}) {
  const contactFlow = saveContactOnly(state, contactDraft, schoolCode);
  if (!contactFlow.ok) return contactFlow;
  const nextState = {
    ...state,
    contacts: [contactFlow.contact, ...(state.contacts ?? [])],
  };
  const link = linkContactToOperationalRecord(contactFlow.contact, nextState, schoolCode);
  if (link.linkedType !== "student") {
    return { ok: false, error: "Liaison élève impossible." };
  }
  const student = (link.students ?? []).find(
    (row) => normalize(row.contactId) === normalize(contactFlow.contact.id),
  );
  if (!student) return { ok: false, error: "Fiche élève absente." };
  const enrolled = { ...student, ...enrollment, schoolCode };
  return {
    ok: true,
    contact: link.contact,
    student: enrolled,
    patch: {
      contacts: (nextState.contacts ?? []).map((row) =>
        normalize(row.id) === normalize(link.contact.id) ? link.contact : row,
      ),
      students: (link.students ?? []).map((row) => (row.id === student.id ? enrolled : row)),
    },
  };
}

function createParentUserFromContact(contact, schoolCode, identifier, password) {
  return {
    id: newId("USERS"),
    contactId: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    role: "Parent",
    identifier,
    phone: contact.phone ?? identifier,
    email: contact.email,
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    password,
    permissions: [],
  };
}

module.exports = {
  saveContactOnly,
  createStudentFromContact,
  createParentUserFromContact,
};
