//! Behaviours on entity types: checking a project's settings against the runtime's
//! declarations, the values written for each entity, and the JSON Schema the studio
//! reads. `core/src/behaviours.ts` checks projects the same way, in the same words:
//! `codegen/fixture/bad-behaviours` holds a project with one of each problem, and both
//! are tested against its `expected.txt`.
use std::collections::BTreeMap;

use pecten_studio_rt::behaviour::declare::{Declaration, PropDecl, PropType, PropValue};
use pecten_studio_rt::behaviour::{DECLARATIONS, declaration};
use pecten_studio_rt::data::Prop;
use serde_json::{Value, json};

use crate::model::{Entity, EntityType};

/// A JSON value as a behaviour property's value, if it is a whole number or a boolean.
fn value_of(json: &Value) -> Option<PropValue> {
    match json {
        Value::Bool(value) => Some(PropValue::Bool(*value)),
        Value::Number(number) => number.as_i64().and_then(|n| i32::try_from(n).ok()).map(PropValue::Int),
        _ => None,
    }
}

/// What a property allows, in the author's terms.
fn allows(prop: &PropDecl) -> String {
    match prop.ty {
        PropType::Int { min, max } => format!("a whole number from {min} to {max}"),
        PropType::Bool => "true or false".into(),
    }
}

fn names(list: impl Iterator<Item = &'static str>) -> String {
    list.collect::<Vec<_>>().join(", ")
}

/// The type's behaviours the runtime knows, each with its entry in the type.
fn known(ty: &EntityType) -> impl Iterator<Item = (&'static Declaration, &BTreeMap<String, Value>)> {
    ty.behaviours.iter().filter_map(|used| Some((declaration(&used.id)?, &used.props)))
}

/// Problems with the entity types' behaviours, as `studio/project.json: ...` lines.
pub fn check_types(types: &[EntityType], problems: &mut Vec<String>) {
    let mut add = |message: String| problems.push(format!("studio/project.json: {message}"));
    for ty in types {
        let t = &ty.id;
        for (i, used) in ty.behaviours.iter().enumerate() {
            let Some(declared) = declaration(&used.id) else {
                add(format!("entity type \"{t}\" has unknown behaviour \"{}\"; the behaviours are {}", used.id, names(DECLARATIONS.iter().map(|d| d.id))));
                continue;
            };
            if ty.behaviours[..i].iter().any(|before| before.id == used.id) {
                add(format!("entity type \"{t}\" has behaviour \"{}\" twice", used.id));
                continue;
            }
            for (name, value) in &used.props {
                match declared.prop(name) {
                    None if declared.props.is_empty() => add(format!("entity type \"{t}\": behaviour \"{}\" has no property \"{name}\"; it has none", used.id)),
                    None => add(format!(
                        "entity type \"{t}\": behaviour \"{}\" has no property \"{name}\"; its properties are {}",
                        used.id,
                        names(declared.props.iter().map(|p| p.name))
                    )),
                    Some((_, prop)) if !value_of(value).is_some_and(|v| prop.accepts(v)) => {
                        add(format!("entity type \"{t}\": {name} is {value}; it is {}", allows(prop)))
                    }
                    Some(_) => {}
                }
            }
            for prop in declared.props {
                if ty.props.iter().any(|own| own.name == prop.name) {
                    add(format!("entity type \"{t}\" has its own property \"{}\", which behaviour \"{}\" also has; rename its own", prop.name, used.id));
                }
            }
        }
        let behaviours: Vec<_> = known(ty).map(|(declared, _)| declared).collect();
        for (i, first) in behaviours.iter().enumerate() {
            for second in &behaviours[i + 1..] {
                for prop in first.props.iter().filter(|p| second.prop(p.name).is_some()) {
                    if first.id != second.id {
                        add(format!(
                            "entity type \"{t}\": behaviours \"{}\" and \"{}\" both have property \"{}\"; a type can have only one of them",
                            first.id, second.id, prop.name
                        ));
                    }
                }
            }
        }
    }
}

/// Problems with a placed entity's behaviour properties, as `{file}: entity {n} ...` lines.
pub fn check_entity(file: &str, n: usize, ty: &EntityType, entity: &Entity, problems: &mut Vec<String>) {
    let at = format!("{file}: entity {n} ({})", ty.id);
    let mut seen: Vec<&str> = Vec::new();
    for (declared, values) in known(ty) {
        if seen.contains(&declared.id) {
            continue;
        }
        seen.push(declared.id);
        for prop in declared.props {
            match entity.props.get(prop.name) {
                Some(value) if !value_of(value).is_some_and(|v| prop.accepts(v)) => {
                    problems.push(format!("{at}: {} is {value}; it is {}", prop.name, allows(prop)))
                }
                None if prop.default.is_none() && !values.contains_key(prop.name) => {
                    problems.push(format!("{at}: {} has no value; behaviour \"{}\" needs it, and the type does not set it", prop.name, declared.id))
                }
                _ => {}
            }
        }
    }
}

/// Whether a placed entity's property belongs to one of its type's behaviours.
pub fn is_behaviour_prop(ty: &EntityType, name: &str) -> bool {
    known(ty).any(|(declared, _)| declared.prop(name).is_some())
}

/// The behaviour properties written for an entity, after its type's own: each of the
/// type's behaviours in turn, its properties in declared order. Each value is the
/// entity's own, else the type's, else the default. `None` when one is missing or
/// does not fit, which [`check_types`] and [`check_entity`] have reported.
pub fn values(ty: &EntityType, entity: &BTreeMap<String, Value>) -> Option<Vec<(&'static str, Prop<'static>)>> {
    let mut out = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for (declared, type_values) in known(ty) {
        if seen.contains(&declared.id) {
            continue;
        }
        seen.push(declared.id);
        for prop in declared.props {
            let value = match entity.get(prop.name).or_else(|| type_values.get(prop.name)) {
                Some(json) => value_of(json).filter(|v| prop.accepts(*v))?,
                None => prop.default?,
            };
            out.push((
                prop.name,
                match value {
                    PropValue::Int(value) => Prop::Int(value),
                    PropValue::Bool(value) => Prop::Bool(value),
                },
            ));
        }
    }
    Some(out)
}

/// Where each of a type's behaviours starts among its entities' properties, for the
/// data section: after the type's own, each behaviour's properties in turn, in the
/// order [`values`] writes them.
pub fn positions(ty: &EntityType) -> Vec<(u16, u16)> {
    let mut at = ty.props.len();
    let mut seen: Vec<&str> = Vec::new();
    let mut out = Vec::new();
    for (declared, _) in known(ty) {
        if seen.contains(&declared.id) {
            continue;
        }
        seen.push(declared.id);
        out.push((declared.number, at as u16));
        at += declared.props.len();
    }
    out
}

/// Every behaviour as the studio reads it: id, number, summary, a JSON Schema of its
/// properties, and their names in the order they are written into the ROM (a JSON
/// object's keys have no order).
pub fn schema() -> Value {
    let behaviours: Vec<Value> = DECLARATIONS
        .iter()
        .map(|declared| {
            let properties: serde_json::Map<String, Value> = declared
                .props
                .iter()
                .map(|prop| {
                    let mut schema = match prop.ty {
                        PropType::Int { min, max } => json!({ "type": "integer", "minimum": min, "maximum": max }),
                        PropType::Bool => json!({ "type": "boolean" }),
                    };
                    schema["description"] = json!(prop.summary);
                    match prop.default {
                        Some(PropValue::Int(value)) => schema["default"] = json!(value),
                        Some(PropValue::Bool(value)) => schema["default"] = json!(value),
                        None => {}
                    }
                    (prop.name.to_string(), schema)
                })
                .collect();
            let required: Vec<&str> = declared.props.iter().filter(|p| p.default.is_none()).map(|p| p.name).collect();
            json!({
                "id": declared.id,
                "number": declared.number,
                "summary": declared.summary,
                "order": declared.props.iter().map(|p| p.name).collect::<Vec<_>>(),
                "schema": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                    "additionalProperties": false,
                },
            })
        })
        .collect();
    Value::Array(behaviours)
}

/// `core/src/behaviourschema.ts`: [`schema`] as a module the studio imports.
pub fn schema_module() -> String {
    let json = serde_json::to_string_pretty(&schema()).expect("the schema is plain JSON");
    format!(
        "// Generated from the runtime's behaviour declarations (runtime/src/behaviour/) by\n\
         // `cargo run -p pecten_studio_build --bin behaviours-schema`. Do not edit: codegen's\n\
         // tests fail when this file and the declarations differ.\n\
         \n\
         /** Every behaviour the runtime has: its id in projects, its number in the ROM, and a JSON Schema of its properties. */\n\
         export const BEHAVIOURS = {json} as const\n"
    )
}
