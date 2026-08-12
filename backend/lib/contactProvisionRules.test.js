/**
 * CONTACT-004 — teachers/users still gated ; students provisioning is a no-op (PR2).
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const { validateContactProvision } = require("./contactProvisionRules");

test("refuse new teacher without contact link", () => {
  const errors = validateContactProvision(
    { teachers: [], contacts: [], users: [] },
    {
      teachers: [{ id: "TEACHERS-1", name: "X", firstName: "Y", schoolCode: "SCH-A" }],
      contacts: [],
    },
    ["teachers"],
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].entity, "teachers");
});

test("no-op for new students even without contact", () => {
  const errors = validateContactProvision(
    { students: [], contacts: [], teachers: [] },
    {
      students: [{ id: "STUDENTS-1", name: "X", firstName: "Y", schoolCode: "SCH-A" }],
      contacts: [],
    },
    ["students"],
  );
  assert.deepEqual(errors, []);
});

test("accept teacher linked to contact", () => {
  const errors = validateContactProvision(
    { teachers: [], contacts: [{ id: "CONTACT-1" }], users: [] },
    {
      teachers: [
        {
          id: "TEACHERS-1",
          name: "X",
          firstName: "Y",
          schoolCode: "SCH-A",
          contactId: "CONTACT-1",
        },
      ],
      contacts: [{ id: "CONTACT-1" }],
    },
    ["teachers"],
  );
  assert.deepEqual(errors, []);
});
