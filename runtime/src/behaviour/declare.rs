//! What each behaviour reads from an entity, declared once next to its code: the
//! build helper checks projects against these and exports them as JSON Schema for the
//! studio (`core/src/behaviourschema.ts`).

/// The type of a behaviour's property, and the values it allows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PropType {
    /// A whole number from `min` to `max`, both included.
    Int {
        min: i32,
        max: i32,
    },
    Bool,
}

/// A property's value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PropValue {
    Int(i32),
    Bool(bool),
}

/// One property a behaviour reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PropDecl {
    /// The property's name in the project, unique among the behaviour's properties.
    pub name: &'static str,
    /// What it is, in the author's terms, for the studio's form.
    pub summary: &'static str,
    pub ty: PropType,
    /// `None` when the author must set it.
    pub default: Option<PropValue>,
}

impl PropDecl {
    pub const fn int(name: &'static str, summary: &'static str, default: Option<i32>, min: i32, max: i32) -> Self {
        let default = match default {
            Some(value) => Some(PropValue::Int(value)),
            None => None,
        };
        Self { name, summary, ty: PropType::Int { min, max }, default }
    }

    pub const fn bool(name: &'static str, summary: &'static str, default: bool) -> Self {
        Self { name, summary, ty: PropType::Bool, default: Some(PropValue::Bool(default)) }
    }

    /// Whether a value is of the property's type and in its range.
    pub const fn accepts(&self, value: PropValue) -> bool {
        match (self.ty, value) {
            (PropType::Int { min, max }, PropValue::Int(value)) => min <= value && value <= max,
            (PropType::Bool, PropValue::Bool(_)) => true,
            _ => false,
        }
    }
}

/// A behaviour as projects name it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Declaration {
    /// Its id in `project.json`: lowercase, words joined by `-`.
    pub id: &'static str,
    /// Its number in the ROM. Numbers are only ever added, never reused.
    pub number: u16,
    /// What it does, in a sentence, for the studio.
    pub summary: &'static str,
    /// What it reads, in the order it reads them.
    pub props: &'static [PropDecl],
}

impl Declaration {
    /// A property by name, with its position among the behaviour's properties.
    pub fn prop(&self, name: &str) -> Option<(usize, &'static PropDecl)> {
        self.props.iter().enumerate().find(|(_, prop)| prop.name == name)
    }
}
