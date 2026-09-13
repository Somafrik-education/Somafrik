import assert from "node:assert/strict";
import { mergeFocusedAnnouncement, resolveFocusedAnnouncement } from "./announcementsOpenById";

const FIRST_PAGE = [
  { id: "ann-1", title: "Première page" },
  { id: "ann-2", title: "Toujours en page 1" },
];
const TARGET = { id: "ann-99", title: "Hors snapshot initial" };

async function main() {
  assert.deepEqual(
    mergeFocusedAnnouncement(FIRST_PAGE, TARGET),
    [TARGET, ...FIRST_PAGE],
    "l'annonce ciblée absente de la liste doit être préfixée, sans pagination",
  );
  assert.deepEqual(
    mergeFocusedAnnouncement(FIRST_PAGE, FIRST_PAGE[0]),
    FIRST_PAGE,
    "déjà présente : pas de doublon",
  );

  const fetched: string[] = [];
  const fromList = await resolveFocusedAnnouncement({
    announcementId: "ann-2",
    list: FIRST_PAGE,
    fetchById: async (id) => {
      fetched.push(id);
      return TARGET;
    },
  });
  assert.equal(fromList?.id, "ann-2");
  assert.equal(fetched.length, 0, "présente dans le snapshot : pas d'aller-retour ID");

  const missing = await resolveFocusedAnnouncement({
    announcementId: "ann-99",
    list: FIRST_PAGE,
    fetchById: async (id) => {
      fetched.push(id);
      return id === "ann-99" ? TARGET : null;
    },
  });
  assert.deepEqual(missing, TARGET);
  assert.deepEqual(fetched, ["ann-99"], "absente du snapshot : GET par ID unique, pas de nextCursor");

  const unknown = await resolveFocusedAnnouncement({
    announcementId: "ann-404",
    list: FIRST_PAGE,
    fetchById: async () => null,
  });
  assert.equal(unknown, null);

  console.log("OK Mobile announcementsOpenById.test.ts");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
