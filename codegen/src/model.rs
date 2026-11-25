//! The project's JSON documents, as `core/src/schema.ts` defines them. Only what the
//! generated data needs is read; the studio validates the rest.
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    #[serde(default)]
    pub build: Build,
    pub collision_classes: Vec<CollisionClass>,
    #[serde(default)]
    pub entity_types: Vec<EntityType>,
    #[serde(default)]
    pub physics: Physics,
}

/// The part of `build` the generated data needs; the commands are the studio's.
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Build {
    /// Bytes kept free after the data section, for patching in a larger project.
    pub data_reserve: Option<u32>,
}

#[derive(Deserialize, Default, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PhysicsMode {
    #[default]
    Platformer,
    Topdown,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Physics {
    pub mode: PhysicsMode,
    pub platformer: PlatformerPhysics,
    pub top_down: TopDownPhysics,
}

/// The defaults are those of `core/src/schema.ts`, for projects saved without them.
#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlatformerPhysics {
    pub gravity: i32,
    pub fall_gravity: i32,
    pub max_fall_speed: i32,
    pub run_speed: i32,
    pub ground_acceleration: i32,
    pub ground_friction: i32,
    pub air_acceleration: i32,
    pub jump_speed: i32,
    pub jump_cut: i32,
    pub air_jumps: u8,
    pub coyote_frames: u8,
    pub jump_buffer_frames: u8,
}

impl Default for PlatformerPhysics {
    fn default() -> Self {
        Self {
            gravity: 48,
            fall_gravity: 48,
            max_fall_speed: 1024,
            run_speed: 384,
            ground_acceleration: 0,
            ground_friction: 0,
            air_acceleration: 0,
            jump_speed: 1100,
            jump_cut: 400,
            air_jumps: 0,
            coyote_frames: 0,
            jump_buffer_frames: 0,
        }
    }
}

#[derive(Deserialize, Default, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Movement {
    #[default]
    Free,
    Grid,
}

#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TopDownPhysics {
    pub movement: Movement,
    pub speed: i32,
    pub acceleration: i32,
    pub friction: i32,
    pub directions: u8,
    pub normalize_diagonal: bool,
    pub corner_slide: i32,
    pub grid_size: i32,
}

impl Default for TopDownPhysics {
    fn default() -> Self {
        Self { movement: Movement::Free, speed: 256, acceleration: 0, friction: 0, directions: 8, normalize_diagonal: true, corner_slide: 4, grid_size: 16 }
    }
}

#[derive(Deserialize)]
pub struct CollisionClass {
    pub id: String,
    pub kind: String,
    pub slope: Option<Slope>,
}

#[derive(Deserialize)]
pub struct Slope {
    pub left: u8,
    pub right: u8,
}

#[derive(Deserialize)]
pub struct EntityType {
    pub id: String,
    pub sprite: Option<String>,
    #[serde(default)]
    pub props: Vec<PropDef>,
    /// Behaviours from the runtime's library, with the type's values for their properties.
    #[serde(default)]
    pub behaviours: Vec<BehaviourUse>,
}

/// A behaviour an entity type has: its id, and values for the properties it declares.
/// What is left out takes the declaration's default.
#[derive(Deserialize)]
pub struct BehaviourUse {
    pub id: String,
    #[serde(default)]
    pub props: BTreeMap<String, Value>,
}

#[derive(Deserialize)]
pub struct PropDef {
    pub name: String,
    pub default: Value,
    /// For an int property: the smallest value the studio lets an entity have. The studio
    /// checks it; the build does not use it yet.
    #[serde(default)]
    pub min: Option<i64>,
    /// For an int property: the largest value, as `min`.
    #[serde(default)]
    pub max: Option<i64>,
}

#[derive(Deserialize)]
pub struct Tileset {
    pub image: String,
    #[serde(default)]
    pub collision: BTreeMap<String, String>,
}

#[derive(Deserialize)]
pub struct Sprite {
    pub image: String,
    pub frame: Frame,
    pub anchor: Point,
    pub hitbox: Option<Hitbox>,
    #[serde(default)]
    pub animations: Vec<Animation>,
    /// A palette file shared with other sprites: one palette on the GBA for all of them.
    #[serde(default)]
    pub palette: Option<String>,
}

#[derive(Deserialize)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Deserialize)]
pub struct Hitbox {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Deserialize)]
pub struct Animation {
    pub name: String,
    pub frames: Vec<AnimationFrame>,
    #[serde(rename = "loop", default = "yes")]
    pub looping: bool,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
pub struct AnimationFrame {
    pub index: u32,
    pub duration: u32,
}

#[derive(Deserialize)]
pub struct Room {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub tileset: String,
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub backgrounds: Vec<Background>,
    pub collision: Option<Vec<u32>>,
    #[serde(default)]
    pub entities: Vec<Entity>,
    pub music: Option<String>,
    /// How dark the layers set to `dim` are, 0 to 16.
    #[serde(rename = "dimLevel")]
    pub dim_level: Option<u8>,
}

#[derive(Deserialize)]
pub struct Background {
    pub image: String,
    pub parallax: Parallax,
    /// Darkened by the room's `dimLevel`.
    #[serde(default)]
    pub dim: bool,
}

/// Percent of the camera's speed, across and down.
#[derive(Deserialize)]
pub struct Parallax {
    pub x: u32,
    pub y: u32,
}

#[derive(Deserialize)]
pub struct Layer {
    pub name: String,
    pub data: Vec<u32>,
    /// Darkened by the room's `dimLevel`.
    #[serde(default)]
    pub dim: bool,
}

#[derive(Deserialize)]
pub struct Entity {
    #[serde(rename = "type")]
    pub kind: String,
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub props: BTreeMap<String, Value>,
}

#[derive(Deserialize, Default)]
pub struct World {
    #[serde(default)]
    pub rooms: Vec<Placement>,
    pub start: Option<String>,
}

#[derive(Deserialize)]
pub struct Placement {
    pub room: String,
    pub x: i32,
    pub y: i32,
}

#[derive(Deserialize, Default)]
pub struct Audio {
    #[serde(default)]
    pub tracks: Vec<Track>,
    #[serde(default)]
    pub sfx: Vec<Sfx>,
}

#[derive(Deserialize)]
pub struct Track {
    pub id: String,
    pub file: String,
    pub format: String,
    pub soundfont: Option<String>,
}

#[derive(Deserialize)]
pub struct Sfx {
    pub id: String,
    pub file: String,
}

/// Every document of a project, with ids in file-name order so indices are stable.
pub struct Documents {
    pub project: Project,
    pub world: World,
    pub audio: Audio,
    pub tilesets: BTreeMap<String, Tileset>,
    pub sprites: BTreeMap<String, Sprite>,
    pub rooms: BTreeMap<String, Room>,
    /// The JSON files read, for cargo's change tracking.
    pub files: Vec<PathBuf>,
}

fn read<T: for<'de> Deserialize<'de>>(path: &Path, files: &mut Vec<PathBuf>) -> Result<T, String> {
    files.push(path.to_path_buf());
    let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))
}

fn read_folder<T: for<'de> Deserialize<'de>>(dir: &Path, files: &mut Vec<PathBuf>, problems: &mut Vec<String>) -> BTreeMap<String, T> {
    let mut out = BTreeMap::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    let mut paths: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|e| e == "json")).collect();
    paths.sort();
    for path in paths {
        let id = path.file_stem().unwrap().to_string_lossy().into_owned();
        match read(&path, files) {
            Ok(doc) => {
                out.insert(id, doc);
            }
            Err(problem) => problems.push(problem),
        }
    }
    out
}

pub fn load(project_dir: &Path) -> Result<Documents, Vec<String>> {
    let studio = project_dir.join("studio");
    let mut files = Vec::new();
    let mut problems = Vec::new();
    let project = read::<Project>(&studio.join("project.json"), &mut files).map_err(|problem| vec![problem])?;
    let optional = |name: &str| studio.join(name).exists().then(|| studio.join(name));
    let world = match optional("world.json") {
        Some(path) => read(&path, &mut files).unwrap_or_else(|problem| {
            problems.push(problem);
            World::default()
        }),
        None => World::default(),
    };
    let audio = match optional("audio.json") {
        Some(path) => read(&path, &mut files).unwrap_or_else(|problem| {
            problems.push(problem);
            Audio::default()
        }),
        None => Audio::default(),
    };
    let tilesets = read_folder(&studio.join("tilesets"), &mut files, &mut problems);
    let sprites = read_folder(&studio.join("sprites"), &mut files, &mut problems);
    let rooms = read_folder(&studio.join("rooms"), &mut files, &mut problems);
    if problems.is_empty() { Ok(Documents { project, world, audio, tilesets, sprites, rooms, files }) } else { Err(problems) }
}
