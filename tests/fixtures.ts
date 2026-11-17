import type { Monster } from "../src/models/monster.ts";

let n = 0;
/** A minimal monster record for tests. */
export function monster(name: string, cr: string, extra: Partial<Monster> = {}): Monster {
  n++;
  return {
    id: "00000000-0000-4000-8000-" + String(n).padStart(12, "0"),
    name, size: "Medium", type: "Beast", alignment: "Unaligned", challenge_rating: cr,
    armor_class: 12, hit_points: 11, initiative_bonus: 1, tags: [], source: { type: "official_srd", name: "SRD 5.2.1" },
    ...extra,
  } as unknown as Monster;
}

export const wolf = monster("Wolf", "1/4", { tags: ["Forest", "Hill"] });
export const direWolf = monster("Dire Wolf", "1", { tags: ["Forest"] });
export const ogre = monster("Ogre", "2", { type: "Giant", size: "Large", tags: ["Hill"] });
export const dragon = monster("Adult Red Dragon", "17", { type: "Dragon", size: "Huge", tags: ["Mountain"] });
export const catalog = [wolf, direWolf, ogre, dragon];
export const byId = new Map(catalog.map(m => [m.id, m]));

/** A complete, valid model answer. */
export function goodAnswer() {
  return {
    encounter_name: "Hungry Eyes in the Darkness",
    read_aloud: "As the campfire fades, eyes gleam between the trees. So what do you do?",
    motivation: "A hungry pack driven from its hunting grounds.",
    avoiding_combat: [{ action: "Offer food", check: "Wisdom (Animal Handling)", dc: 12, success: "The wolves withdraw.", failure: "They grow bolder." }],
    dm_tactics: "Surround isolated characters.",
    treasure: "Nothing but pelts.",
    monsters: [{ monster_id: wolf.id, count: 3 }, { monster_id: direWolf.id, count: 1 }],
  };
}

/** Encrypted by Critter Codex's own encryptToken (src/artworkSettings.ts), to prove Scrap Sheet uses the same format. */
export const CRITTER_CODEX_FIXTURE = {
  token: "sk-test-FAKE0000parity",
  password: "correct horse battery",
  encrypted: {"algorithm":"AES-256-GCM","kdf":"PBKDF2-SHA-256","iterations":310000,"salt":"+OEdDXqX37/ssrCnMPlRYw==","iv":"2p7YUK4rAKoHUOMi","ciphertext":"GmI/+gXD10TCta/YHzooCAk3QBewiaR4YlXrAkTwfsJXJNfpbPs="} as const,
};
