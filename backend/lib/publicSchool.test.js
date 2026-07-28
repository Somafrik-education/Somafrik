const assert = require("assert");
const { toPublicSchool } = require("./publicSchool");

const result = toPublicSchool({
  id: "SCHOOL-1",
  publicId: "CD-2026-0001",
  code: " CD-2026-0001 ",
  name: " École Test ",
  city: " Kinshasa ",
  logoUrl: "https://example.test/logo.png",
  address: "Adresse privée",
  phone: "+243000000000",
  email: "contact@example.test",
  subscriptionPlan: "Premium",
  subscriptionStatus: "En retard",
  maxStudents: 500,
  maxTeachers: 50,
});

assert.deepStrictEqual(result, {
  code: "CD-2026-0001",
  name: "École Test",
  city: "Kinshasa",
  logoUrl: "https://example.test/logo.png",
});

for (const privateField of [
  "id",
  "publicId",
  "address",
  "phone",
  "email",
  "subscriptionPlan",
  "subscriptionStatus",
  "maxStudents",
  "maxTeachers",
]) {
  assert.ok(!(privateField in result), `${privateField} ne doit pas être exposé publiquement`);
}

console.log("publicSchool.test: SUCCESS");
