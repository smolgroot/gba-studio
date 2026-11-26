//! References between placed entities (US-017), as `core/src/refs.ts` has them. A `ref`
//! property holds the id of the entity it points at; the data section gets that entity's
//! number in the game (`World::entity_index`), or -1 for none. The problems are those the
//! studio reports, in the same words: `fixture/bad-refs/expected.txt` holds both to it.
use std::collections::BTreeMap;

use serde_json::Value;

use crate::model::{Documents, Entity, EntityType, PropDef};

/// An entity that has an id: where it is, its type, and its number in the game.
pub struct Placed<'a> {
    pub room: &'a str,
    pub index: usize,
    pub kind: &'a str,
    pub number: usize,
}

/// Every entity that has an id, by id. Rooms are in id order and entities in list order,
/// as the game numbers them; of two with one id the first is kept, and [`problems`]
/// reports the other.
pub fn by_id(docs: &Documents) -> BTreeMap<&str, Placed<'_>> {
    let mut out = BTreeMap::new();
    let mut number = 0;
    for (room, doc) in &docs.rooms {
        for (index, entity) in doc.entities.iter().enumerate() {
            if let Some(id) = &entity.id {
                out.entry(id.as_str()).or_insert(Placed { room, index, kind: &entity.kind, number });
            }
            number += 1;
        }
    }
    out
}

/// An id as the project format has it: lowercase letters, digits, `-` and `_`, 48 at most.
fn is_id(text: &str) -> bool {
    let bytes = text.as_bytes();
    let ok = |b: &u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    !bytes.is_empty() && bytes.len() <= 48 && ok(&bytes[0]) && bytes[1..].iter().all(|b| ok(b) || *b == b'-' || *b == b'_')
}

fn quoted(types: &[String]) -> String {
    types.iter().map(|t| format!("\"{t}\"")).collect::<Vec<_>>().join(" or ")
}

/// What a ref allows, in the studio's words (`propertyAllows`).
fn allows(def: &PropDef) -> String {
    if def.types.is_empty() {
        "the id of an entity, or \"\" for none".into()
    } else {
        format!("the id of an entity of type {}, or \"\" for none", quoted(&def.types))
    }
}

/// The value an entity has for a ref: its own, else the type's.
fn value_of<'a>(entity: &'a Entity, def: &'a PropDef) -> &'a Value {
    entity.props.get(&def.name).unwrap_or(&def.default)
}

/// The number written for an entity's ref: its target's, or -1 for none or for a
/// reference [`problems`] reports, which fails the build anyway.
pub fn number(ids: &BTreeMap<&str, Placed>, entity: &Entity, def: &PropDef) -> i32 {
    match value_of(entity, def) {
        Value::String(id) => ids.get(id.as_str()).map_or(-1, |target| target.number as i32),
        _ => -1,
    }
}

fn ref_defs(kind: &EntityType) -> impl Iterator<Item = &PropDef> {
    kind.props.iter().filter(|def| def.kind == "ref")
}

/// Every problem with the project's references: a limit naming a type there is not, an id
/// two entities have, a value that is not an id, a reference to an id no entity has, and
/// one to an entity of a type it may not point at.
pub fn problems(docs: &Documents, problems: &mut Vec<String>) {
    let types = &docs.project.entity_types;
    for kind in types {
        for def in ref_defs(kind) {
            for allowed in &def.types {
                if !types.iter().any(|t| &t.id == allowed) {
                    problems.push(format!(
                        "studio/project.json: entity type \"{}\": property \"{}\" may point at type \"{allowed}\", which the project does not have",
                        kind.id, def.name
                    ));
                }
            }
        }
    }
    let ids = by_id(docs);
    for (room, doc) in &docs.rooms {
        let file = format!("studio/rooms/{room}.json");
        for (index, entity) in doc.entities.iter().enumerate() {
            if let Some(first) = entity.id.as_deref().and_then(|id| ids.get(id))
                && (first.room != room || first.index != index)
            {
                problems.push(format!(
                    "{file}: entity {index} ({}) has id \"{}\", which entity {} of {} has too; an id names one entity, so change or remove one of them",
                    entity.kind,
                    entity.id.as_deref().unwrap_or_default(),
                    first.index,
                    first.room
                ));
            }
            let Some(kind) = types.iter().find(|t| t.id == entity.kind) else { continue };
            for def in ref_defs(kind) {
                let value = value_of(entity, def);
                let id = match value {
                    Value::String(id) if id.is_empty() => continue,
                    Value::String(id) if is_id(id) => id,
                    other => {
                        problems.push(format!("{file}: entity {index} ({}): {} is {other}; it is {}", entity.kind, def.name, allows(def)));
                        continue;
                    }
                };
                match ids.get(id.as_str()) {
                    None => problems.push(format!(
                        "{file}: entity {index} ({}): {} points at \"{id}\", which no entity has. It was deleted, or its id changed: pick another target or set it to None",
                        entity.kind, def.name
                    )),
                    Some(target) if !def.types.is_empty() && !def.types.iter().any(|t| t == target.kind) => problems.push(format!(
                        "{file}: entity {index} ({}): {} points at \"{id}\", of type \"{}\"; it may point at type {}",
                        entity.kind,
                        def.name,
                        target.kind,
                        quoted(&def.types)
                    )),
                    Some(_) => {}
                }
            }
        }
    }
}
