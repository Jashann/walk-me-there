// The house graph: everything the speaker said about the place, each piece tied to the
// turns of the recording that said it. Spark fills it with constrained decoding.

export const KINDS = [
  "compound", "courtyard", "room", "kitchen", "verandah", "roof_terrace", "upper_floor", "stairs", "ladder",
  "gate", "door", "window", "wall", "boundary_wall", "roof",
  "well", "handpump", "water_tank", "stove", "tandoor", "bed", "cot", "shelf", "niche", "storage", "chest",
  "animal_shed", "animal", "tree", "plant", "field", "pond", "building", "corridor", "path", "street", "drain", "furniture", "object", "other",
] as const;
export type Kind = (typeof KINDS)[number];

export const RELATIONS = [
  "left_of", "right_of", "in_front_of", "behind", "north_of", "south_of", "east_of", "west_of",
  "inside", "next_to", "on_top_of", "below", "across_from", "opens_into", "against_wall_of",
] as const;
export type Rel = (typeof RELATIONS)[number];

export const MATERIALS = [
  "mud_brick", "fired_brick", "lime_plaster", "mud_plaster", "cement", "stone", "wood", "dark_wood", "thatch",
  "tin", "earth", "dung_floor", "tile", "grass", "water", "leaves", "trunk", "cloth", "rope_weave", "iron",
  "clay", "glass", "white", "blue", "green", "yellow", "red",
  "marble", "gold", "sandstone", "red_sandstone", "blue_tile", "green_tile", "black_stone", "saffron", "pink",
  "vermilion", "dark_tile", "bark_shingle", "moss", "maple", "ginkgo", "pine", "blossom", "gravel", "lava", "unspecified",
] as const;
export type Material = (typeof MATERIALS)[number];
// foliage: see-through for walking, cameras and face culling, like "leaves"
export const FOLIAGE = new Set<string>(["leaves", "maple", "ginkgo", "pine", "blossom"]);

export type Size = { length_m: number | null; width_m: number | null; height_m: number | null; phrase: string | null };

export type Element = {
  id: string; // short snake_case id, unique
  kind: Kind;
  name: string; // English name as a person would say it ("grandmother's room")
  original: string | null; // the speaker's own word, romanized ("vehra", "nalka")
  material: Material;
  colour: string | null;
  size: Size;
  level: "ground" | "roof" | "upper";
  detail: string | null; // anything else said about it
  turns: number[]; // turn ids that support this element
};

export type Relation = { a: string; rel: Rel; b: string; turns: number[]; quote: string };

export type Gap = { question_en: string; question_original: string | null; about: string | null; why: string };

export type HouseGraph = {
  title: string; // "Grandmother's house in Kot Fatta"
  place: string | null;
  speaker_relation: string | null; // "my mother", "my grandmother"
  entrance: string | null; // id of the element you enter through (usually the gate)
  entrance_faces: "north" | "south" | "east" | "west" | null; // compass direction the entrance faces, if said
  landmark: string | null; // the real, well-known place this is, if the speaker names one ("Harmandir Sahib, Amritsar")
  surroundings?: "fields" | "town" | "forest" | null; // what lies around it (drawn as unclaimed scenery)
  elements: Element[];
  relations: Relation[];
  gaps: Gap[];
};

const nullable = (t: object) => ({ anyOf: [t, { type: "null" }] });

export const GRAPH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "place", "speaker_relation", "entrance", "entrance_faces", "landmark", "surroundings", "elements", "relations", "gaps"],
  properties: {
    title: { type: "string" },
    place: nullable({ type: "string" }),
    speaker_relation: nullable({ type: "string" }),
    entrance: nullable({ type: "string" }),
    entrance_faces: nullable({ type: "string", enum: ["north", "south", "east", "west"] }),
    landmark: nullable({ type: "string" }),
    surroundings: nullable({ type: "string", enum: ["fields", "town", "forest"] }),
    elements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "name", "original", "material", "colour", "size", "level", "detail", "turns"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: KINDS },
          name: { type: "string" },
          original: nullable({ type: "string" }),
          material: { type: "string", enum: MATERIALS },
          colour: nullable({ type: "string" }),
          size: {
            type: "object",
            additionalProperties: false,
            required: ["length_m", "width_m", "height_m", "phrase"],
            properties: {
              length_m: nullable({ type: "number" }),
              width_m: nullable({ type: "number" }),
              height_m: nullable({ type: "number" }),
              phrase: nullable({ type: "string" }),
            },
          },
          level: { type: "string", enum: ["ground", "roof", "upper"] },
          detail: nullable({ type: "string" }),
          turns: { type: "array", items: { type: "integer" } },
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["a", "rel", "b", "turns", "quote"],
        properties: {
          a: { type: "string" },
          rel: { type: "string", enum: RELATIONS },
          b: { type: "string" },
          turns: { type: "array", items: { type: "integer" } },
          quote: { type: "string" },
        },
      },
    },
    gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question_en", "question_original", "about", "why"],
        properties: {
          question_en: { type: "string" },
          question_original: nullable({ type: "string" }),
          about: nullable({ type: "string" }),
          why: { type: "string" },
        },
      },
    },
  },
} as const;

// Drop anything the decoder could not tie to a real turn or a real element.
export function sanitizeGraph(g: HouseGraph, validTurns: Set<number>): { graph: HouseGraph; dropped: string[] } {
  const dropped: string[] = [];
  const seen = new Set<string>();
  const elements = g.elements.filter((e) => {
    e.turns = e.turns.filter((t) => validTurns.has(t));
    e.id = e.id.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    if (!e.turns.length) return void dropped.push(`element ${e.id}: no supporting turn`), false;
    if (seen.has(e.id)) return void dropped.push(`element ${e.id}: duplicate id`), false;
    seen.add(e.id);
    return true;
  });
  const clean = (id: string) => id.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  const relations = g.relations.filter((r) => {
    r.a = clean(r.a);
    r.b = clean(r.b);
    r.turns = r.turns.filter((t) => validTurns.has(t));
    if (!seen.has(r.a) || !seen.has(r.b) || r.a === r.b) return void dropped.push(`relation ${r.a} ${r.rel} ${r.b}: unknown element`), false;
    if (!r.turns.length) return void dropped.push(`relation ${r.a} ${r.rel} ${r.b}: no supporting turn`), false;
    return true;
  });
  const entranceId = g.entrance ? clean(g.entrance) : null;
  const entrance = entranceId && seen.has(entranceId) ? entranceId : null;
  return { graph: { ...g, entrance, elements, relations }, dropped };
}
