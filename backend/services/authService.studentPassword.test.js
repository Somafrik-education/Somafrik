const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthService } = require("./authService");
const { hashSecret } = require("./credentialService");

const auth = new AuthService({
  school: { code: "BI-TEST", status: "active" },
  teachers: [],
  students: [],
  userAccounts: [],
});

test("student resolves the password field and does not accept a PIN-only payload", () => {
  assert.equal(auth.resolveLoginSecret({ role: "student", password: "student-test-pass" }), "student-test-pass");
  assert.equal(auth.resolveLoginSecret({ role: "student", pin: "1234" }), "");
  assert.equal(auth.resolveLoginSecret({ role: "parent_student", pin: "1234" }), "");
  assert.equal(auth.resolveLoginSecret({ role: "teacher", pin: "1234" }), "1234");
});

test("student secret verification uses passwordHash only (no pinHash fallback)", () => {
  const user = {
    role: "Élève / Étudiant",
    passwordHash: hashSecret("student-test-pass"),
    pinHash: hashSecret("1234"),
  };
  assert.equal(auth.verifyUserSecret(user, "student-test-pass", { role: "student" }), true);
  assert.equal(auth.verifyUserSecret(user, "1234", { role: "student" }), false);
  assert.equal(auth.verifyUserSecret(user, "1234", { role: "parent_student" }), false);
  assert.equal(auth.verifyUserSecret(user, "1234", { role: "teacher" }), true);
});

test("student with only legacy pinHash must activate a real password", () => {
  const user = { role: "Élève / Étudiant", pinHash: hashSecret("1234") };
  assert.equal(auth.verifyUserSecret(user, "1234", { role: "student" }), false);
});
