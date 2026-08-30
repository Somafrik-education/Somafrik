import assert from "node:assert/strict";
import {
  isHelpBusinessModalOpen,
  reportHelpBusinessModal,
  resetHelpBusinessModalForTests,
  subscribeHelpBusinessModal,
} from "./helpBusinessModal";

resetHelpBusinessModalForTests();
assert.equal(isHelpBusinessModalOpen(), false);

const seen: boolean[] = [];
const unsubscribe = subscribeHelpBusinessModal((open) => seen.push(open));
assert.deepEqual(seen, [false], "subscribe émet l’état courant");

reportHelpBusinessModal(true);
assert.equal(isHelpBusinessModalOpen(), true);
assert.deepEqual(seen, [false, true]);

reportHelpBusinessModal(true);
assert.equal(isHelpBusinessModalOpen(), true, "deux modales empilées restent ouvertes");
assert.deepEqual(seen, [false, true, true]);

reportHelpBusinessModal(false);
assert.equal(isHelpBusinessModalOpen(), true, "une modal restante → toujours ouvert");
reportHelpBusinessModal(false);
assert.equal(isHelpBusinessModalOpen(), false);
assert.equal(seen.at(-1), false);

unsubscribe();
const afterUnsub = seen.length;
reportHelpBusinessModal(true);
assert.equal(seen.length, afterUnsub, "listener retiré");

resetHelpBusinessModalForTests();
assert.equal(isHelpBusinessModalOpen(), false);

console.log("helpBusinessModal.test.ts OK");
