// Generated from the runtime's behaviour declarations (runtime/src/behaviour/) by
// `cargo run -p pecten_studio_build --bin behaviours-schema`. Do not edit: codegen's
// tests fail when this file and the declarations differ.

/** Every behaviour the runtime has: its id in projects, its number in the ROM, and a JSON Schema of its properties. */
export const BEHAVIOURS = [
  {
    "id": "patrol",
    "number": 0,
    "order": [
      "patrol",
      "patrol_pace"
    ],
    "schema": {
      "additionalProperties": false,
      "properties": {
        "patrol": {
          "default": 32,
          "description": "How far it walks each way, in pixels",
          "maximum": 4096,
          "minimum": 0,
          "type": "integer"
        },
        "patrol_pace": {
          "default": 2,
          "description": "Frames it takes to walk a pixel",
          "maximum": 255,
          "minimum": 1,
          "type": "integer"
        }
      },
      "required": [],
      "type": "object"
    },
    "summary": "Walks back and forth around where it was placed."
  },
  {
    "id": "collectible",
    "number": 1,
    "order": [
      "value"
    ],
    "schema": {
      "additionalProperties": false,
      "properties": {
        "value": {
          "default": 1,
          "description": "What it is worth",
          "maximum": 1000000,
          "minimum": 0,
          "type": "integer"
        }
      },
      "required": [],
      "type": "object"
    },
    "summary": "Taken when the player touches it, for what it is worth."
  },
  {
    "id": "hazard",
    "number": 2,
    "order": [],
    "schema": {
      "additionalProperties": false,
      "properties": {},
      "required": [],
      "type": "object"
    },
    "summary": "Hurts the player that touches it."
  },
  {
    "id": "projectile",
    "number": 3,
    "order": [
      "shot_speed"
    ],
    "schema": {
      "additionalProperties": false,
      "properties": {
        "shot_speed": {
          "default": 2,
          "description": "Pixels a frame; left if negative",
          "maximum": 16,
          "minimum": -16,
          "type": "integer"
        }
      },
      "required": [],
      "type": "object"
    },
    "summary": "Flies along until it hits a wall or the player, or its time runs out."
  },
  {
    "id": "shooter",
    "number": 4,
    "order": [
      "fire_every",
      "shot_speed",
      "sight"
    ],
    "schema": {
      "additionalProperties": false,
      "properties": {
        "fire_every": {
          "default": 60,
          "description": "Frames between shots",
          "maximum": 3600,
          "minimum": 1,
          "type": "integer"
        },
        "shot_speed": {
          "default": 2,
          "description": "Pixels a frame its shots fly",
          "maximum": 16,
          "minimum": 1,
          "type": "integer"
        },
        "sight": {
          "default": 96,
          "description": "How near the player must be, in pixels",
          "maximum": 1024,
          "minimum": 0,
          "type": "integer"
        }
      },
      "required": [],
      "type": "object"
    },
    "summary": "Fires at the player when they are in sight."
  },
  {
    "id": "moving-platform",
    "number": 5,
    "order": [
      "travel_x",
      "travel_y",
      "travel_pace"
    ],
    "schema": {
      "additionalProperties": false,
      "properties": {
        "travel_pace": {
          "default": 2,
          "description": "Frames it takes to move a pixel",
          "maximum": 255,
          "minimum": 1,
          "type": "integer"
        },
        "travel_x": {
          "default": 0,
          "description": "How far it goes across, in pixels; left if negative",
          "maximum": 4096,
          "minimum": -4096,
          "type": "integer"
        },
        "travel_y": {
          "default": 0,
          "description": "How far it goes down, in pixels; up if negative",
          "maximum": 4096,
          "minimum": -4096,
          "type": "integer"
        }
      },
      "required": [],
      "type": "object"
    },
    "summary": "Goes back and forth along a line; the player can stand on it."
  },
  {
    "id": "door",
    "number": 6,
    "order": [
      "needs_ability"
    ],
    "schema": {
      "additionalProperties": false,
      "properties": {
        "needs_ability": {
          "default": -1,
          "description": "The ability that opens it, 0 to 31; -1 opens it with Up",
          "maximum": 31,
          "minimum": -1,
          "type": "integer"
        }
      },
      "required": [],
      "type": "object"
    },
    "summary": "Blocks the way until the player opens it."
  },
  {
    "id": "checkpoint",
    "number": 7,
    "order": [],
    "schema": {
      "additionalProperties": false,
      "properties": {},
      "required": [],
      "type": "object"
    },
    "summary": "Where the player comes back to, once they have touched it."
  },
  {
    "id": "ability-pickup",
    "number": 8,
    "order": [
      "grants_ability"
    ],
    "schema": {
      "additionalProperties": false,
      "properties": {
        "grants_ability": {
          "description": "The ability it gives, 0 to 31",
          "maximum": 31,
          "minimum": 0,
          "type": "integer"
        }
      },
      "required": [
        "grants_ability"
      ],
      "type": "object"
    },
    "summary": "Gives the player an ability when they touch it."
  },
  {
    "id": "spawner",
    "number": 9,
    "order": [
      "spawn_every",
      "max_alive"
    ],
    "schema": {
      "additionalProperties": false,
      "properties": {
        "max_alive": {
          "default": 3,
          "description": "How many of its entities may be alive at once",
          "maximum": 255,
          "minimum": 0,
          "type": "integer"
        },
        "spawn_every": {
          "default": 120,
          "description": "Frames between spawns",
          "maximum": 3600,
          "minimum": 1,
          "type": "integer"
        }
      },
      "required": [],
      "type": "object"
    },
    "summary": "Makes entities where it stands, a few at a time."
  }
] as const
