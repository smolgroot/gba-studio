//! Turns a Pecten-Studio project into Rust data for a game built on agb.
//!
//! In the game's `build.rs`:
//!
//! ```no_run
//! fn main() {
//!     pecten_studio_build::build();
//! }
//! ```
//!
//! That reads `studio/` beside the game's `Cargo.toml` (or the folder named by the
//! `PECTEN_STUDIO_PROJECT` environment variable) and writes three files into `OUT_DIR`,
//! which the game brings in with `pecten_studio_rt`'s `include_data!`, `include_gfx!`
//! and `include_audio!`. Problems in the project fail the build with a list of them.

pub mod behaviours;
mod image;
mod model;

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    fs,
    path::PathBuf,
};

use pecten_studio_rt::{
    data::{
        Background, CollisionClass, CollisionKind, Prop, RoomDim,
        layout::ENTITY,
        write::{ArtData, ClassData, EntityData, Manifest, RoomData, WorldData},
    },
    physics::{Movement, Physics, PhysicsMode, PlatformerPhysics, TopDownPhysics},
};
use serde_json::Value;

pub struct Options {
    /// The game folder: the one holding `studio/`.
    pub project: PathBuf,
    /// Where the generated files go.
    pub out: PathBuf,
}

pub struct Report {
    /// Every file the output depends on.
    pub inputs: Vec<PathBuf>,
    /// One line per thing converted, with the numbers that count on a GBA.
    pub summary: Vec<String>,
    /// What each room puts in video memory, as the studio's readout shows it.
    pub budgets: Vec<RoomBudget>,
}

/// The background tiles and palettes a room needs on screen: the tiles every room
/// drawn with its tileset uses, its pictures' distinct tiles, and their palettes.
#[derive(Debug, PartialEq, Eq)]
pub struct RoomBudget {
    /// The room's id.
    pub room: String,
    /// Tiles in video memory, of the 1024 there is room for.
    pub tiles: usize,
    /// Background palettes, of 16.
    pub palettes: usize,
}

/// Everything wrong with the project, one line each.
#[derive(Debug)]
pub struct Error(pub Vec<String>);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for problem in &self.0 {
            writeln!(f, "  {problem}")?;
        }
        Ok(())
    }
}

/// For a build script: generates from the project beside `Cargo.toml` into `OUT_DIR`,
/// tells cargo what to watch, and fails the build if the project has problems.
pub fn build() {
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("run from a build script"));
    println!("cargo:rerun-if-env-changed=PECTEN_STUDIO_PROJECT");
    let project = std::env::var_os("PECTEN_STUDIO_PROJECT").map_or(manifest.clone(), |dir| manifest.join(dir));
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("run from a build script"));
    // New and deleted documents count too: cargo looks through the whole folder.
    println!("cargo:rerun-if-changed={}", project.join("studio").display());
    match generate(&Options { project, out }) {
        Ok(report) => {
            for input in report.inputs {
                println!("cargo:rerun-if-changed={}", input.display());
            }
        }
        Err(error) => {
            eprintln!("Pecten-Studio project has problems:\n{error}");
            std::process::exit(1);
        }
    }
}

/// `crystal-cave_2` as `CRYSTAL_CAVE_2`, for constants.
fn constant(id: &str) -> String {
    let name: String = id.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' }).collect();
    if name.starts_with(|c: char| c.is_ascii_digit()) { format!("_{name}") } else { name }
}

/// `player-start` as `PlayerStart`, for enum variants.
fn variant(id: &str) -> String {
    let name: String =
        id.split(|c: char| !c.is_ascii_alphanumeric()).filter(|part| !part.is_empty()).map(|part| part[..1].to_ascii_uppercase() + &part[1..]).collect();
    if name.starts_with(|c: char| c.is_ascii_digit()) { format!("_{name}") } else { name }
}

/// Reports ids that become the same Rust name.
fn check_names<'a>(what: &str, ids: impl Iterator<Item = &'a String>, name: fn(&str) -> String, problems: &mut Vec<String>) {
    let mut seen = BTreeSet::new();
    for id in ids {
        if !seen.insert(name(id)) {
            problems.push(format!("{what} \"{id}\" has the same name in code ({}) as another; rename one", name(id)));
        }
    }
}

/// Run-length pairs `[count, cell, ...]` as cells, or `None` if they are not exactly `cells` long.
fn decode(data: &[u32], cells: usize) -> Option<Vec<u32>> {
    if data.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(cells);
    for pair in data.chunks_exact(2) {
        if pair[0] == 0 || out.len() + pair[0] as usize > cells {
            return None;
        }
        out.extend(std::iter::repeat_n(pair[1], pair[0] as usize));
    }
    (out.len() == cells).then_some(out)
}

const SCREEN_COLS: u32 = 30;
const SCREEN_ROWS: u32 = 20;
const SPRITE_SIZES: [(u32, u32); 12] = [(8, 8), (16, 16), (32, 32), (64, 64), (16, 8), (32, 8), (32, 16), (64, 32), (8, 16), (8, 32), (16, 32), (32, 64)];
/// Tiles one background can address, and all that video memory holds at once.
const MAX_TILES: usize = 1024;
/// Backgrounds the console draws at once: a room's tile layers and its pictures.
const SCREEN_LAYERS: usize = 4;
const MAX_BACKGROUNDS: usize = 2;
const PALETTES: usize = 16;
/// The distinct tiles and the palettes a background picture needs.
type PictureCost = (usize, usize);

fn palettes_source(palettes: &[[u16; 16]]) -> String {
    let rows: Vec<String> = palettes
        .iter()
        .map(|palette| format!("Palette16::new([{}])", palette.iter().map(|c| format!("Rgb15::new({c:#06x})")).collect::<Vec<_>>().join(", ")))
        .collect();
    rows.join(",\n        ")
}

/// The project's physics as the runtime holds it.
fn physics_of(physics: &model::Physics) -> Physics {
    let p = &physics.platformer;
    let t = &physics.top_down;
    Physics {
        mode: if physics.mode == model::PhysicsMode::Topdown { PhysicsMode::TopDown } else { PhysicsMode::Platformer },
        platformer: PlatformerPhysics {
            gravity: p.gravity,
            fall_gravity: p.fall_gravity,
            max_fall_speed: p.max_fall_speed,
            run_speed: p.run_speed,
            ground_acceleration: p.ground_acceleration,
            ground_friction: p.ground_friction,
            air_acceleration: p.air_acceleration,
            jump_speed: p.jump_speed,
            jump_cut: p.jump_cut,
            air_jumps: p.air_jumps,
            coyote_frames: p.coyote_frames,
            jump_buffer_frames: p.jump_buffer_frames,
        },
        top_down: TopDownPhysics {
            movement: if t.movement == model::Movement::Grid { Movement::Grid } else { Movement::Free },
            speed: t.speed,
            acceleration: t.acceleration,
            friction: t.friction,
            directions: t.directions,
            normalize_diagonal: t.normalize_diagonal,
            corner_slide: t.corner_slide,
            grid_size: t.grid_size,
        },
    }
}

/// A collision class kind as the project names it.
fn collision_kind(kind: &str) -> CollisionKind {
    match kind {
        "solid" => CollisionKind::Solid,
        "oneway" => CollisionKind::OneWay,
        "slope" => CollisionKind::Slope,
        "hazard" => CollisionKind::Hazard,
        "custom" => CollisionKind::Custom,
        _ => CollisionKind::Empty,
    }
}

pub fn generate(options: &Options) -> Result<Report, Error> {
    let docs = model::load(&options.project).map_err(Error)?;
    let mut problems = Vec::new();
    let mut summary = Vec::new();
    let mut inputs = docs.files.clone();
    fs::create_dir_all(&options.out).map_err(|error| Error(vec![format!("{}: {error}", options.out.display())]))?;
    let write = |name: &str, bytes: &[u8], problems: &mut Vec<String>| {
        if let Err(error) = fs::write(options.out.join(name), bytes) {
            problems.push(format!("{}: {error}", options.out.join(name).display()));
        }
    };
    let out_file = |name: &str| format!("concat!(env!(\"OUT_DIR\"), \"/{name}\")");
    let asset = |file: &str, inputs: &mut Vec<PathBuf>| {
        let path = options.project.join(file);
        inputs.push(path.clone());
        path
    };

    let classes = &docs.project.collision_classes;
    let types = &docs.project.entity_types;
    let room_ids: Vec<&String> = docs.rooms.keys().collect();
    let tileset_ids: Vec<&String> = docs.tilesets.keys().collect();
    let sprite_ids: Vec<&String> = docs.sprites.keys().collect();
    check_names("collision class", classes.iter().map(|c| &c.id), constant, &mut problems);
    check_names("entity type", types.iter().map(|t| &t.id), variant, &mut problems);
    check_names("room", docs.rooms.keys(), constant, &mut problems);
    check_names("sprite", docs.sprites.keys(), constant, &mut problems);
    check_names("track", docs.audio.tracks.iter().map(|t| &t.id), constant, &mut problems);
    check_names("sound effect", docs.audio.sfx.iter().map(|s| &s.id), constant, &mut problems);
    if classes.len() > 255 {
        problems.push("studio/project.json: more than 255 collision classes".into());
    }
    behaviours::check_types(types, &mut problems);

    // Tilesets: tiles and palettes for drawing, and each tile's collision class for the rooms.
    let mut gfx = String::new();
    let mut tile_classes: Vec<Vec<u8>> = Vec::new();
    let mut tile_counts: Vec<usize> = Vec::new();
    let mut tileset_palettes: Vec<usize> = Vec::new();
    let mut tileset_rows = Vec::new();
    for (index, (id, tileset)) in docs.tilesets.iter().enumerate() {
        let file = format!("studio/tilesets/{id}.json");
        let converted = image::Image::load(&asset(&tileset.image, &mut inputs)).and_then(|image| image::tileset(&image));
        let tiles = match converted {
            Ok(tiles) => tiles,
            Err(problem) => {
                problems.push(format!("{file}: {}: {problem}", tileset.image));
                tile_classes.push(Vec::new());
                tile_counts.push(0);
                tileset_palettes.push(0);
                continue;
            }
        };
        if tiles.count() > MAX_TILES {
            problems.push(format!("{file}: {} has {} tiles; a GBA background can address {MAX_TILES}", tileset.image, tiles.count()));
        }
        let mut by_tile = vec![0u8; tiles.count()];
        for (tile, class) in &tileset.collision {
            match (tile.parse::<usize>().ok().filter(|&t| t < tiles.count()), classes.iter().position(|c| &c.id == class)) {
                (Some(tile), Some(class)) => by_tile[tile] = class as u8,
                (None, _) => problems.push(format!("{file}: collision is set for tile {tile}, which the image does not have")),
                (_, None) => problems.push(format!("{file}: tile {tile} uses unknown collision class \"{class}\"")),
            }
        }
        write(&format!("tileset_{id}.4bpp"), &tiles.data, &mut problems);
        write(&format!("tileset_{id}.palettes"), &tiles.tile_palettes, &mut problems);
        summary.push(format!("tileset {id}: {} tiles, {} of 16 palettes", tiles.count(), tiles.palettes.len()));
        let _ = write!(
            gfx,
            "    static TILESET_{index}_TILES: &Aligned<[u8]> = &Aligned(*include_bytes!({}));\n    static TILESET_{index}_PALETTES: [Palette16; {}] = [\n        {},\n    ];\n",
            out_file(&format!("tileset_{id}.4bpp")),
            tiles.palettes.len(),
            palettes_source(&tiles.palettes),
        );
        tileset_rows.push(format!(
            "        // SAFETY: the bytes are whole 4-bit tiles, aligned to 4 bytes.\n        Tileset {{ tiles: unsafe {{ TileSet::new(&TILESET_{index}_TILES.0, TileFormat::FourBpp) }}, tile_palettes: include_bytes!({}), palettes: &TILESET_{index}_PALETTES }},",
            out_file(&format!("tileset_{id}.palettes")),
        ));
        tile_classes.push(by_tile);
        tile_counts.push(tiles.count());
        tileset_palettes.push(tiles.palettes.len());
    }

    // Background pictures: each image once, however many rooms show it. What it costs
    // in tiles and palettes is kept for the rooms' budgets; `None` is one that failed.
    let mut pictures: BTreeMap<&str, (String, Option<PictureCost>)> = BTreeMap::new();
    for (id, room) in &docs.rooms {
        for background in &room.backgrounds {
            pictures.entry(&background.image).or_insert_with(|| (format!("studio/rooms/{id}.json"), None));
        }
    }
    let mut background_rows = Vec::new();
    for (index, (file, (room_file, cost))) in pictures.iter_mut().enumerate() {
        if !file.to_ascii_lowercase().ends_with(".png") {
            problems.push(format!("{room_file}: background {file} is not a PNG"));
            continue;
        }
        let picture = match image::Image::load(&asset(file, &mut inputs)).and_then(|image| image::background(&image)) {
            Ok(picture) => picture,
            Err(problem) => {
                problems.push(format!("{room_file}: background {file}: {problem}"));
                continue;
            }
        };
        let tiles = &picture.tiles;
        let cells: Vec<u8> = picture.cells.iter().flat_map(|cell| cell.to_le_bytes()).collect();
        write(&format!("background_{index}.4bpp"), &tiles.data, &mut problems);
        write(&format!("background_{index}.palettes"), &tiles.tile_palettes, &mut problems);
        write(&format!("background_{index}.cells"), &cells, &mut problems);
        summary.push(format!("background {file}: {}x{} tiles, {} distinct, {} palettes", picture.cols, picture.rows, tiles.count(), tiles.palettes.len()));
        let _ = write!(
            gfx,
            "    static BACKGROUND_{index}_TILES: &Aligned<[u8]> = &Aligned(*include_bytes!({}));\n    static BACKGROUND_{index}_PALETTES: [Palette16; {}] = [\n        {},\n    ];\n",
            out_file(&format!("background_{index}.4bpp")),
            tiles.palettes.len(),
            palettes_source(&tiles.palettes),
        );
        background_rows.push(format!(
            "        // {file}\n        // SAFETY: the bytes are whole 4-bit tiles, aligned to 4 bytes.\n        BackgroundImage {{\n            tiles: Tileset {{ tiles: unsafe {{ TileSet::new(&BACKGROUND_{index}_TILES.0, TileFormat::FourBpp) }}, tile_palettes: include_bytes!({}), palettes: &BACKGROUND_{index}_PALETTES }},\n            cols: {},\n            rows: {},\n            cells: include_bytes!({}),\n        }},",
            out_file(&format!("background_{index}.palettes")),
            picture.cols,
            picture.rows,
            out_file(&format!("background_{index}.cells")),
        ));
        *cost = Some((tiles.count(), tiles.palettes.len()));
    }
    // A failed picture leaves a gap in the numbering, and the build fails anyway.
    let picture_index = |file: &str| pictures.keys().position(|key| *key == file).unwrap_or(0);

    // Rooms: collision, entities and tile layers, all for the data section.
    let mut rooms: Vec<RoomData> = Vec::new();
    // What the rooms drawn with each tileset put on screen together: the tiles they
    // use, and the most tile layers any of them has.
    let mut used_tiles: Vec<BTreeSet<u32>> = vec![BTreeSet::new(); tileset_ids.len()];
    let mut most_layers: Vec<usize> = vec![0; tileset_ids.len()];
    for (id, room) in &docs.rooms {
        let file = format!("studio/rooms/{id}.json");
        let (cols, rows) = (room.width * SCREEN_COLS, room.height * SCREEN_ROWS);
        let cells = (cols * rows) as usize;
        let Some(tileset) = tileset_ids.iter().position(|t| **t == room.tileset) else {
            problems.push(format!("{file}: unknown tileset \"{}\"", room.tileset));
            continue;
        };
        let mut layers = Vec::new();
        for layer in &room.layers {
            match decode(&layer.data, cells) {
                Some(layer_cells) => {
                    if let Some(&bad) = layer_cells.iter().find(|&&cell| cell as usize > tile_counts[tileset]) {
                        problems.push(format!("{file}: layer \"{}\" uses tile {}, which tileset \"{}\" does not have", layer.name, bad - 1, room.tileset));
                    }
                    layers.push(layer_cells);
                }
                None => problems.push(format!("{file}: layer \"{}\" does not hold {cells} cells", layer.name)),
            }
        }
        let overrides = match &room.collision {
            Some(data) => decode(data, cells).unwrap_or_else(|| {
                problems.push(format!("{file}: collision does not hold {cells} cells"));
                vec![0; cells]
            }),
            None => vec![0; cells],
        };
        if layers.len() != room.layers.len() || layers.is_empty() || layers.len() > 3 {
            if layers.len() == room.layers.len() {
                problems.push(format!("{file}: a room has 1 to 3 layers, this one has {}", layers.len()));
            }
            continue;
        }
        used_tiles[tileset].extend(layers.iter().flatten().filter(|&&cell| cell > 0));
        most_layers[tileset] = most_layers[tileset].max(layers.len());
        if room.backgrounds.len() > MAX_BACKGROUNDS {
            problems.push(format!("{file}: a room has at most {MAX_BACKGROUNDS} backgrounds, this one has {}", room.backgrounds.len()));
        }
        // A cell's class: what was painted over it, or else its frontmost tile that has one.
        let class_of = |tile: u32| tile_classes[tileset].get(tile as usize - 1).copied().unwrap_or(0);
        let collision: Vec<u8> = (0..cells)
            .map(|i| {
                if overrides[i] > 0 {
                    return (overrides[i] - 1).min(classes.len() as u32 - 1) as u8;
                }
                layers
                    .iter()
                    .rev()
                    .filter(|layer| layer[i] > 0)
                    .map(|layer| class_of(layer[i]))
                    .find(|&class| classes.get(class as usize).is_some_and(|c| c.kind != "empty"))
                    .unwrap_or(0)
            })
            .collect();
        let mut entities = Vec::new();
        for (n, entity) in room.entities.iter().enumerate() {
            let Some(kind) = types.iter().position(|t| t.id == entity.kind) else {
                problems.push(format!("{file}: entity {n} has unknown type \"{}\"", entity.kind));
                continue;
            };
            behaviours::check_entity(&file, n, &types[kind], entity, &mut problems);
            let mut props: Vec<(&str, Prop)> = types[kind]
                .props
                .iter()
                .filter_map(|def| {
                    let value = match entity.props.get(&def.name).unwrap_or(&def.default) {
                        Value::Bool(b) => Prop::Bool(*b),
                        Value::Number(number) => Prop::Int(number.as_i64().unwrap_or(0) as i32),
                        Value::String(text) => Prop::Str(text),
                        other => {
                            problems
                                .push(format!("{file}: entity {n}: property \"{}\" has a value that is not a number, a boolean or text: {other}", def.name));
                            return None;
                        }
                    };
                    Some((def.name.as_str(), value))
                })
                .collect();
            // Its behaviours' properties come after the type's own; a missing or bad value
            // has been reported above.
            props.extend(behaviours::values(&types[kind], &entity.props).unwrap_or_default());
            let (Ok(x), Ok(y)) = (i16::try_from(entity.x), i16::try_from(entity.y)) else {
                problems.push(format!("{file}: entity {n} is at ({}, {}); positions run from -32768 to 32767", entity.x, entity.y));
                continue;
            };
            entities.push(EntityData { kind: kind as u16, x, y, props });
        }
        let world = docs.world.rooms.iter().find(|p| &p.room == id).map(|p| (p.x as i16, p.y as i16));
        let music = room.music.as_ref().and_then(|track| match docs.audio.tracks.iter().position(|t| &t.id == track) {
            Some(index) => Some(index as u16),
            None => {
                problems.push(format!("{file}: unknown music track \"{track}\""));
                None
            }
        });
        // Percent of the camera's speed, as the 256ths the runtime shifts by.
        let speed = |percent: u32| ((percent.min(100) * 256 + 50) / 100) as u16;
        let backgrounds: Vec<Background> = room
            .backgrounds
            .iter()
            .map(|b| Background { image: picture_index(&b.image) as u16, parallax: (speed(b.parallax.x), speed(b.parallax.y)) })
            .collect();
        summary.push(format!("room {id}: {cols}x{rows} tiles, {} layers, {} backgrounds, {} entities", layers.len(), backgrounds.len(), entities.len()));
        rooms.push(RoomData {
            id,
            name: &room.name,
            cols: cols as u16,
            rows: rows as u16,
            world,
            music,
            tileset: tileset as u16,
            collision,
            layers: layers.iter().map(|layer| layer.iter().map(|&cell| cell as u16).collect()).collect(),
            backgrounds,
            dim: RoomDim {
                level: room.dim_level.unwrap_or(0),
                tiles: room.layers.iter().enumerate().fold(0, |bits, (n, l)| bits | (u8::from(l.dim) << n)),
                backgrounds: room.backgrounds.iter().enumerate().fold(0, |bits, (n, b)| bits | (u8::from(b.dim) << n)),
            },
            entities,
        });
    }

    // What a room's pictures share with the rooms on screen beside it: the console's
    // four backgrounds, its 16 background palettes and the tiles video memory holds.
    let mut budgets = Vec::new();
    for (id, room) in &docs.rooms {
        let Some(tileset) = tileset_ids.iter().position(|t| **t == room.tileset) else { continue };
        // Two layers of one picture share its tiles and palettes.
        let files: BTreeSet<&str> = room.backgrounds.iter().map(|b| b.image.as_str()).collect();
        let costs: Vec<PictureCost> = files.iter().filter_map(|file| pictures.get(file).and_then(|(_, cost)| *cost)).collect();
        let palettes = tileset_palettes[tileset] + costs.iter().map(|c| c.1).sum::<usize>();
        let tiles = used_tiles[tileset].len() + costs.iter().map(|c| c.0).sum::<usize>();
        budgets.push(RoomBudget { room: id.clone(), tiles, palettes });
        // Without pictures, the tileset's own checks above cover the room.
        if room.backgrounds.is_empty() {
            continue;
        }
        let file = format!("studio/rooms/{id}.json");
        let name = tileset_ids[tileset];
        let layers = most_layers[tileset] + room.backgrounds.len();
        if layers > SCREEN_LAYERS {
            problems.push(format!(
                "{file}: {} backgrounds and the {} tile layers of rooms drawn with tileset \"{name}\" are {layers} layers; the GBA draws {SCREEN_LAYERS} at once",
                room.backgrounds.len(),
                most_layers[tileset],
            ));
        }
        if palettes > PALETTES {
            problems.push(format!(
                "{file}: its backgrounds need {} palettes and tileset \"{name}\" {}, which is {palettes}; the GBA has {PALETTES} for backgrounds. Use fewer colour combinations in the pictures",
                palettes - tileset_palettes[tileset],
                tileset_palettes[tileset],
            ));
        }
        if tiles > MAX_TILES {
            problems.push(format!(
                "{file}: its backgrounds have {} distinct tiles and the rooms drawn with tileset \"{name}\" use {}, which is {tiles}; video memory holds {MAX_TILES}. Make the pictures smaller or more repetitive",
                tiles - used_tiles[tileset].len(),
                used_tiles[tileset].len(),
            ));
        }
    }

    // Sprites: every frame of each sheet, and its animations. Sheets naming one palette
    // file share one palette: its file and its colours, numbered in order of first use.
    let mut sprite_items = String::new();
    let mut shared_palettes: Vec<(String, [u16; 16])> = Vec::new();
    for (index, (id, sprite)) in docs.sprites.iter().enumerate() {
        let file = format!("studio/sprites/{id}.json");
        let (width, height) = (sprite.frame.width, sprite.frame.height);
        if !SPRITE_SIZES.contains(&(width, height)) {
            problems.push(format!("{file}: frame {width}x{height} is not a GBA sprite size"));
            continue;
        }
        if !sprite.image.to_ascii_lowercase().ends_with(".png") {
            problems.push(format!("{file}: {} is not a PNG; export the sheet as PNG", sprite.image));
            continue;
        }
        let shared = match &sprite.palette {
            None => None,
            Some(path) => match shared_palettes.iter().position(|(p, _)| p == path) {
                Some(n) => Some(n),
                None => match image::Image::load(&asset(path, &mut inputs)).and_then(|image| image::palette_file(&image)) {
                    Ok(colours) => {
                        let _ = writeln!(sprite_items, "    static SHARED_PALETTE_{}: Palette16 = {};", shared_palettes.len(), palettes_source(&[colours]));
                        shared_palettes.push((path.clone(), colours));
                        Some(shared_palettes.len() - 1)
                    }
                    Err(problem) => {
                        problems.push(format!("{file}: {path}: {problem}"));
                        continue;
                    }
                },
            },
        };
        let cut = |image: &image::Image| match shared {
            Some(n) => image::sheet_in(image, width, height, &shared_palettes[n].1),
            None => image::sheet(image, width, height),
        };
        let sheet = match image::Image::load(&asset(&sprite.image, &mut inputs)).and_then(|image| cut(&image)) {
            Ok(sheet) => sheet,
            Err(problem) => {
                problems.push(format!("{file}: {}: {problem}", sprite.image));
                continue;
            }
        };
        let palette_name = shared.map_or(format!("SPRITE_{index}_PALETTE"), |n| format!("SHARED_PALETTE_{n}"));
        write(&format!("sprite_{id}.4bpp"), &sheet.data, &mut problems);
        let frame_bytes = (width / image::TILE * (height / image::TILE)) as usize * image::TILE_BYTES;
        let mut animations = Vec::new();
        for animation in &sprite.animations {
            if let Some(bad) = animation.frames.iter().find(|f| f.index as usize >= sheet.frames) {
                problems.push(format!("{file}: animation \"{}\" uses frame {}, the sheet has {}", animation.name, bad.index, sheet.frames));
            }
            let frames: Vec<String> = animation.frames.iter().map(|f| format!("({}, {})", f.index, f.duration.clamp(1, 255))).collect();
            animations.push(format!("Animation {{ name: {:?}, frames: &[{}], looping: {} }}", animation.name, frames.join(", "), animation.looping));
        }
        let frames: Vec<String> = (0..sheet.frames)
            .map(|frame| {
                format!("unsafe {{ Sprite::new(&{palette_name}, frame_bytes(&SPRITE_{index}_DATA.0, {frame}, {frame_bytes}), Size::S{width}x{height}) }}")
            })
            .collect();
        let hitbox = sprite.hitbox.as_ref().map_or("None".to_string(), |h| format!("Some(({}, {}, {}, {}))", h.x, h.y, h.width, h.height));
        let _ = write!(
            sprite_items,
            "    static SPRITE_{index}_DATA: &Aligned<[u8]> = &Aligned(*include_bytes!({}));\n    {}\n    // SAFETY: each frame is whole 4-bit tiles inside 4-byte aligned data.\n    static SPRITE_{index}_FRAMES: [Sprite; {}] = [\n        {},\n    ];\n",
            out_file(&format!("sprite_{id}.4bpp")),
            if shared.is_some() { String::new() } else { format!("static SPRITE_{index}_PALETTE: Palette16 = {};", palettes_source(&[sheet.palette])) },
            sheet.frames,
            frames.join(",\n        "),
        );
        let _ = write!(
            sprite_items,
            "    pub static SPRITE_{}: SpriteSheet = SpriteSheet {{\n        frames: &SPRITE_{index}_FRAMES,\n        width: {width},\n        height: {height},\n        anchor: ({}, {}),\n        hitbox: {hitbox},\n        animations: &[{}],\n    }};\n",
            constant(id),
            sprite.anchor.x,
            sprite.anchor.y,
            animations.iter().map(|a| format!("\n            {a},")).collect::<String>(),
        );
        summary.push(format!("sprite {id}: {} frames of {width}x{height}, {} animations", sheet.frames, sprite.animations.len()));
    }
    let entity_sprites: Vec<String> = types
        .iter()
        .map(|t| match &t.sprite {
            None => "None".to_string(),
            Some(sprite) if sprite_ids.contains(&sprite) => format!("Some(&SPRITE_{})", constant(sprite)),
            Some(sprite) => {
                problems.push(format!("studio/project.json: entity type \"{}\" uses unknown sprite \"{sprite}\"", t.id));
                "None".to_string()
            }
        })
        .collect();

    // Music and sound effects go through agb's own converters.
    let mut track_rows = Vec::new();
    for track in &docs.audio.tracks {
        let path = asset(&track.file, &mut inputs);
        let path = path.to_string_lossy();
        track_rows.push(match (track.format.as_str(), &track.soundfont) {
            ("xm", _) => format!("agb_tracker::include_xm!({path:?})"),
            ("mod", _) => format!("agb_tracker::include_mod!({path:?})"),
            ("midi", Some(soundfont)) => format!("agb_tracker::include_midi!({:?}, {path:?})", asset(soundfont, &mut inputs).to_string_lossy()),
            ("midi", None) => {
                problems.push(format!("studio/audio.json: track \"{}\" is MIDI and needs a soundfont", track.id));
                continue;
            }
            (other, _) => {
                problems.push(format!("studio/audio.json: track \"{}\" has unknown format \"{other}\"", track.id));
                continue;
            }
        });
    }
    let sfx_rows: Vec<String> = docs.audio.sfx.iter().map(|s| format!("agb::include_wav!({:?})", asset(&s.file, &mut inputs).to_string_lossy())).collect();

    let start = docs.world.start.as_ref().and_then(|room| match room_ids.iter().position(|r| *r == room) {
        Some(index) => Some(index as u16),
        None => {
            problems.push(format!("studio/world.json: start room \"{room}\" does not exist"));
            None
        }
    });
    if !problems.is_empty() {
        return Err(Error(problems));
    }

    let header = format!("// @generated by pecten_studio_build from the studio project {:?}. Do not edit.\n", docs.project.name);
    let indexed = |ids: &mut dyn Iterator<Item = &String>, kind: &str| {
        ids.enumerate().map(|(i, id)| format!("        pub const {}: {kind} = {i};\n", constant(id))).collect::<String>()
    };
    let kinds: Vec<String> = types.iter().map(|t| variant(&t.id)).collect();
    // The table of live entities has room for these and some placed while the game runs.
    let live_entities = pecten_studio_rt::behaviour::live::slots_for(rooms.iter().map(|room| room.entities.len()).sum());
    // Each type's hitbox from its sprite, as `SpriteSheet::hitbox` gives it; empty without one.
    let hitboxes: Vec<String> = types
        .iter()
        .map(|t| {
            let (x, y, w, h) = t.sprite.as_ref().and_then(|id| docs.sprites.get(id)).map_or((0, 0, 0, 0), |sprite| {
                let (left, top, w, h) = sprite.hitbox.as_ref().map_or((0, 0, sprite.frame.width, sprite.frame.height), |h| (h.x, h.y, h.width, h.height));
                (left - sprite.anchor.x, top - sprite.anchor.y, w, h)
            });
            format!("Hitbox {{ x: {x}, y: {y}, w: {w}, h: {h} }}")
        })
        .collect();
    let world = WorldData {
        classes: classes
            .iter()
            .map(|c| ClassData {
                id: &c.id,
                class: CollisionClass { kind: collision_kind(&c.kind), slope: c.slope.as_ref().map_or((0, 0), |s| (s.left, s.right)) },
            })
            .collect(),
        rooms,
        start,
        physics: physics_of(&docs.project.physics),
        behaviours: types.iter().map(behaviours::positions).collect(),
        manifest: Manifest {
            entity_types: types.iter().map(|t| (t.id.as_str(), t.sprite.as_deref())).collect(),
            tilesets: tileset_ids
                .iter()
                .enumerate()
                .map(|(n, id)| ArtData { id, tiles: tile_counts[n] as u32, palettes: tileset_palettes[n] as u32 })
                .collect(),
            pictures: pictures
                .iter()
                .map(|(file, (_, cost))| ArtData { id: file, tiles: cost.map_or(0, |c| c.0 as u32), palettes: cost.map_or(0, |c| c.1 as u32) })
                .collect(),
            tracks: docs.audio.tracks.iter().map(|t| t.id.as_str()).collect(),
            live_entities: Some(live_entities as u32),
        },
    };
    let (section, used) = pecten_studio_rt::data::write::write(&world, docs.project.build.data_reserve.map(|bytes| bytes as usize));
    summary.push(format!("data section: {used} bytes, {} more reserved", section.len() - used));
    write("studio_data.bin", &section, &mut problems);
    let data = format!(
        r#"{header}#[allow(dead_code, unused_imports)]
pub mod data {{
    use pecten_studio_rt::behaviour::{{Context, Dispatch, Event, Hitbox, LiveEntities, LiveEntity}};
    use pecten_studio_rt::data::{{Entity, Limits, World}};

    #[repr(C, align(4))]
    struct Aligned<T: ?Sized>(T);

    /// The data section: rooms, collision, entities, world placement and physics, in
    /// the layout of `pecten_studio_rt::data::layout`. Tools find it in the ROM by its
    /// magic number and may replace it, up to its capacity, without a build.
    static SECTION: Aligned<[u8; {section_len}]> = Aligned(*include_bytes!({section_file}));
    static SECTION_BYTES: &[u8] = &SECTION.0;

    /// What the compiled half of the game holds, which the section may name.
    pub const LIMITS: Limits = Limits {{ entity_kinds: {kind_count}, tilesets: {tileset_count}, backgrounds: {background_count}, tracks: {track_count} }};

    /// The most entities the section has room for: size `Collected` with it, so that
    /// entities added to a patched ROM can be collected too.
    pub const ENTITY_SLOTS: usize = {entity_slots};

    /// The world as the ROM holds it now. Call it once, at the start.
    ///
    /// # Panics
    /// If the ROM's data section was replaced by one this game cannot read.
    pub fn world() -> World<'static> {{
        // A volatile read keeps the compiler from building values of the section into
        // the code, where replacing the section in the ROM would not reach them.
        // SAFETY: reads an initialised, aligned static.
        let bytes: &'static [u8] = unsafe {{ core::ptr::read_volatile(&raw const SECTION_BYTES) }};
        match World::new(bytes, &LIMITS) {{
            Ok(world) => world,
            Err(error) => panic!("the ROM's level data cannot be read ({{error:?}}); rebuild the game"),
        }}
    }}

    /// Collision class indices, as `Room::class_index` gives them.
    pub mod class {{
{class_consts}    }}

    /// The project's entity types, in the order [`Entity::kind`] numbers them.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum EntityKind {{
{kind_variants}    }}

    impl EntityKind {{
        pub const ALL: [EntityKind; {kind_count}] = [{kind_all}];

        pub fn of(entity: &Entity) -> Option<EntityKind> {{
            Self::ALL.get(entity.kind as usize).copied()
        }}
    }}

    impl EntityKind {{
        /// The kind of a live entity.
        pub fn of_live(entity: &LiveEntity) -> Option<EntityKind> {{
            Self::ALL.get(entity.kind as usize).copied()
        }}
    }}

    /// Room indices, as `World::room` takes them.
    pub mod room {{
{room_consts}    }}

    /// Each entity type's hitbox, from its sprite, as an offset from its feet. A type
    /// with no sprite has an empty one, which touches nothing.
    pub static HITBOXES: [Hitbox; {kind_count}] = [{hitboxes}];

    /// How many entities the table of live entities holds: the project's, and room for
    /// more placed while the game runs. The studio asks for a build past this.
    pub const LIVE_ENTITIES: usize = {live_entities};

    /// Every entity of the world while the game runs, with its behaviours.
    pub type Entities = LiveEntities<LIVE_ENTITIES>;

    /// The game's table of live entities. It is a static, which agb puts in EWRAM.
    ///
    /// # Panics
    /// If called a second time: keep the reference it gave.
    pub fn entities() -> &'static mut Entities {{
        static mut TABLE: Entities = Entities::new();
        static mut TAKEN: bool = false;
        // SAFETY: the GBA has one core and no interrupt handler calls this. The flag is
        // set before the reference is made, so a second call panics instead of
        // making another.
        unsafe {{
            assert!(!TAKEN, "data::entities() gives the table once; keep the reference it gave");
            TAKEN = true;
            &mut *(&raw mut TABLE)
        }}
    }}

    /// Makes `room` and the rooms touching it the active ones, building their entities
    /// the first time. `skip` leaves out an entity by its number in the world, such as
    /// one the game has collected, after [`LiveEntities::clear`].
    pub fn enter_room(entities: &mut Entities, world: &World, room: usize, skip: impl Fn(usize) -> bool) {{
        entities.enter(world, room, |kind| HITBOXES.get(kind as usize).copied().unwrap_or_default(), skip);
    }}

    /// What the camera, its top-left corner at `camera` in world pixels, shows: the area
    /// [`update_entities`] runs and [`LiveEntities::visible`] takes.
    pub const fn view(camera: (i32, i32)) -> (i32, i32, i32, i32) {{
        (camera.0, camera.1, pecten_studio_rt::data::SCREEN_W, pecten_studio_rt::data::SCREEN_H)
    }}

    /// One frame of every entity in the active rooms that the camera, its top-left
    /// corner at `camera` in world pixels, shows. `before` is the game's own code for
    /// an entity, run first: it answers [`Dispatch::Handled`] to stand in for the
    /// entity's behaviours, or [`Dispatch::Behaviours`] to run them, in the order its
    /// type lists them. Every event they give goes to `event`.
    pub fn update_entities(
        entities: &mut Entities,
        world: &World,
        cx: &Context,
        camera: (i32, i32),
        mut before: impl FnMut(EntityKind, &mut LiveEntity) -> Dispatch,
        mut event: impl FnMut(EntityKind, &mut LiveEntity, Event),
    ) {{
        entities.update(
            world,
            cx,
            view(camera),
            |entity| match EntityKind::of_live(entity) {{
                Some(kind) => before(kind, entity),
                None => Dispatch::Handled,
            }},
            |entity, happened| {{
                if let Some(kind) = EntityKind::of_live(entity) {{
                    event(kind, entity, happened);
                }}
            }},
        );
    }}
}}
"#,
        hitboxes = hitboxes.join(", "),
        section_len = section.len(),
        entity_slots = section.len() / ENTITY,
        section_file = out_file("studio_data.bin"),
        tileset_count = tileset_rows.len(),
        background_count = pictures.len(),
        track_count = docs.audio.tracks.len(),
        class_consts = indexed(&mut classes.iter().map(|c| &c.id), "u8"),
        kind_variants = kinds.iter().map(|k| format!("        {k},\n")).collect::<String>(),
        kind_count = kinds.len(),
        kind_all = kinds.iter().map(|k| format!("EntityKind::{k}")).collect::<Vec<_>>().join(", "),
        room_consts = indexed(&mut docs.rooms.keys(), "usize"),
    );
    let gfx = format!(
        r#"{header}#[allow(dead_code, unused_imports)]
pub mod gfx {{
    use agb::display::{{
        Palette16, Rgb15,
        object::{{Size, Sprite}},
        tiled::{{TileFormat, TileSet}},
    }};
    use pecten_studio_rt::gfx::{{Animation, Art, BackgroundImage, SpriteSheet, Tileset, frame_bytes}};

    #[repr(C, align(4))]
    struct Aligned<T: ?Sized>(T);

{gfx}
    pub static TILESETS: [Tileset; {tileset_count}] = [
{tileset_rows}
    ];

    /// The pictures rooms have behind them, each once.
    pub static BACKGROUNDS: [BackgroundImage; {background_count}] = [
{background_rows}
    ];

    /// What the data section's rooms are drawn with, for `WorldView`.
    pub const ART: Art = Art {{ tilesets: &TILESETS, backgrounds: &BACKGROUNDS }};

{sprite_items}
    /// The sprite of each entity type that has one, in the order of `data::EntityKind`.
    pub static ENTITY_SPRITES: [Option<&SpriteSheet>; {kind_count}] = [{entity_sprites}];
}}
"#,
        tileset_count = tileset_rows.len(),
        tileset_rows = tileset_rows.join("\n"),
        background_count = background_rows.len(),
        background_rows = background_rows.join("\n"),
        kind_count = kinds.len(),
        entity_sprites = entity_sprites.join(", "),
    );
    let audio = format!(
        r#"{header}#[allow(dead_code, unused_imports)]
pub mod audio {{
    use agb::sound::mixer::SoundData;
    use agb_tracker::Track;

    /// Music, in the order `Room::music` numbers it.
    pub static TRACKS: [Track; {track_count}] = [
{track_rows}    ];

    /// Track indices in [`TRACKS`].
    pub mod track {{
{track_consts}    }}

    pub static SFX: [SoundData; {sfx_count}] = [
{sfx_rows}    ];

    /// Sound effect indices in [`SFX`].
    pub mod sfx {{
{sfx_consts}    }}
}}
"#,
        track_count = track_rows.len(),
        track_rows = track_rows.iter().map(|row| format!("        {row},\n")).collect::<String>(),
        track_consts = indexed(&mut docs.audio.tracks.iter().map(|t| &t.id), "usize"),
        sfx_count = sfx_rows.len(),
        sfx_rows = sfx_rows.iter().map(|row| format!("        {row},\n")).collect::<String>(),
        sfx_consts = indexed(&mut docs.audio.sfx.iter().map(|s| &s.id), "usize"),
    );
    let mut failed = Vec::new();
    write("studio_data.rs", data.as_bytes(), &mut failed);
    write("studio_gfx.rs", gfx.as_bytes(), &mut failed);
    write("studio_audio.rs", audio.as_bytes(), &mut failed);
    if !failed.is_empty() {
        return Err(Error(failed));
    }
    summary.push(format!("audio: {} tracks, {} sound effects", track_rows.len(), sfx_rows.len()));
    Ok(Report { inputs, summary, budgets })
}

#[cfg(test)]
mod tests {
    use super::*;
    use pecten_studio_rt::data::{Limits, World};
    use std::path::Path;

    #[test]
    fn names_ids_for_code() {
        assert_eq!(constant("crystal-cave_2"), "CRYSTAL_CAVE_2");
        assert_eq!(constant("2nd"), "_2ND");
        assert_eq!(variant("player-start"), "PlayerStart");
        assert_eq!(variant("boss_2-door"), "Boss2Door");
        let mut problems = Vec::new();
        check_names("room", ["a-b".to_string(), "a_b".to_string()].iter(), constant, &mut problems);
        assert_eq!(problems.len(), 1);
    }

    #[test]
    fn decodes_run_length_cells_of_the_right_size_only() {
        assert_eq!(decode(&[2, 0, 1, 5], 3), Some(vec![0, 0, 5]));
        assert_eq!(decode(&[2, 0, 1, 5], 4), None);
        assert_eq!(decode(&[5, 0], 3), None);
        assert_eq!(decode(&[2, 0, 1], 3), None);
        assert_eq!(decode(&[0, 1, 3, 0], 3), None);
    }

    /// Each room's tiles and palettes are the ones `codegen/fixture/budget.json` gives,
    /// which the studio's readout is checked against too.
    #[test]
    fn room_budgets_match_the_shared_fixture() {
        let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixture");
        let fixture: serde_json::Value = serde_json::from_str(&fs::read_to_string(project.join("budget.json")).unwrap()).unwrap();
        let out = std::env::temp_dir().join(format!("pecten-studio-build-budget-{}", std::process::id()));
        let report = generate(&Options { project, out: out.clone() }).unwrap_or_else(|error| panic!("{error}"));
        let expected: Vec<RoomBudget> = fixture["project"]["rooms"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(room, b)| RoomBudget {
                room: room.clone(),
                tiles: b["tiles"].as_u64().unwrap() as usize,
                palettes: b["palettes"].as_u64().unwrap() as usize,
            })
            .collect();
        assert_eq!(report.budgets, expected);
        fs::remove_dir_all(out).ok();
    }

    /// The fixture project generates, and what comes out matches what was painted.
    #[test]
    fn generates_the_fixture_project() {
        // A small fixed project kept beside the crate: two rooms on the placeholder tileset.
        let project = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixture");
        let out = std::env::temp_dir().join(format!("pecten-studio-build-test-{}", std::process::id()));
        let report = generate(&Options { project, out: out.clone() }).unwrap_or_else(|error| panic!("{error}"));
        assert!(report.summary.iter().any(|line| line.starts_with("room entry: 60x20 tiles")), "{:?}", report.summary);

        let data = fs::read_to_string(out.join("studio_data.rs")).unwrap();
        assert!(data.contains("pub const SOLID: u8 = 1;"));
        assert!(data.contains("PlayerStart,"));
        assert!(data.contains("pub const ENTRY: usize = 0;"));
        assert!(data.contains("pub const ENTITY_SLOTS: usize = "), "{data}");
        // The dispatch: three entities, so 16 spare, rounded to 32. The hero's hitbox is
        // its sprite's, from its anchor; the sign has no sprite.
        assert!(data.contains("pub const LIVE_ENTITIES: usize = 32;"), "{data}");
        assert!(data.contains("HITBOXES: [Hitbox; 2] = [Hitbox { x: -4, y: -14, w: 9, h: 14 }, Hitbox { x: 0, y: 0, w: 0, h: 0 }];"), "{data}");
        for item in ["pub type Entities = LiveEntities<LIVE_ENTITIES>;", "pub fn entities()", "pub fn enter_room(", "pub fn update_entities("] {
            assert!(data.contains(item), "{item} in {data}");
        }
        assert!(data.contains("Limits { entity_kinds: "), "{data}");
        assert!(!data.contains("pub static ROOMS"), "rooms are in the section, not in code: {data}");

        // Everything else is in the data section, which the runtime reads back.
        let section = fs::read(out.join("studio_data.bin")).unwrap();
        // The studio's TypeScript port writes sections too (core/src/datasection.ts) and
        // is tested against this same file, so the two cannot drift apart. Set
        // PECTEN_STUDIO_UPDATE_FIXTURE=1 to rewrite it after a deliberate change.
        let expected = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixture/expected/studio_data.bin");
        if std::env::var_os("PECTEN_STUDIO_UPDATE_FIXTURE").is_some() {
            fs::create_dir_all(expected.parent().unwrap()).unwrap();
            fs::write(&expected, &section).unwrap();
        }
        assert!(
            fs::read(&expected).is_ok_and(|bytes| bytes == section),
            "the section differs from {}; rerun with PECTEN_STUDIO_UPDATE_FIXTURE=1 if that is meant",
            expected.display()
        );
        assert!(data.contains(&format!("ENTITY_SLOTS: usize = {};", section.len() / 12)), "{data}");
        assert!(data.contains(&format!("Aligned<[u8; {}]>", section.len())), "{data}");
        let world = World::new(&section, &Limits::ANY).unwrap_or_else(|error| panic!("{error:?}"));
        assert_eq!(world.start(), Some(0));
        assert_eq!(world.class_id(1), "solid");
        assert_eq!(world.collision_class(1).kind, CollisionKind::Solid);
        // The fixture says nothing about physics: it gets the defaults.
        assert_eq!(world.physics(), Physics { mode: PhysicsMode::Platformer, platformer: PlatformerPhysics::DEFAULT, top_down: TopDownPhysics::DEFAULT });

        // The entry room: 60x20 cells, floor from row 17 down, a one-way girder at row 12.
        let entry = world.room(0);
        assert_eq!((entry.id(), entry.cols(), entry.rows()), ("entry", 60, 20));
        // Signs are also checkpoints and doors: their behaviours' properties follow the
        // type's own, with the type's value unless the placed sign has its own.
        let signs: Vec<_> = entry.entities().filter(|e| e.kind == 1).collect();
        assert_eq!(signs.iter().map(|sign| sign.int("needs_ability")).collect::<Vec<_>>(), [Some(4), Some(7)]);
        assert_eq!(signs[0].int("weight"), Some(-3), "the type's own properties are still there");
        // The game reads them by position, through the behaviours section.
        use pecten_studio_rt::behaviour::{Behaviour, Checkpoint, Door, Patrol};
        assert_eq!(signs.iter().map(|sign| Door::from_entity(sign).map(|door| door.needs)).collect::<Vec<_>>(), [Some(Some(4)), Some(Some(7))]);
        assert!(Checkpoint::from_entity(&signs[0]).is_some());
        assert_eq!(Patrol::from_entity(&signs[0]), None, "signs do not patrol");
        let collision = entry.collision();
        let at = |col: usize, row: usize| collision[row * 60 + col];
        assert_eq!(at(10, 17), 1, "ground is solid");
        assert_eq!(at(10, 16), 0, "air above it");
        assert_eq!(at(13, 12), 2, "the girder is one-way");
        assert_eq!(at(24, 16), 3, "the ramp up");
        assert_eq!(at(45, 17), 5, "spikes are a hazard");
        assert_eq!(at(30, 10), 0, "the back wall has no collision");

        let tiles = fs::read(out.join("tileset_tiles.4bpp")).unwrap();
        assert_eq!(tiles.len(), 16 * image::TILE_BYTES);
        assert!(tiles[..image::TILE_BYTES].iter().all(|&b| b == 0), "tile 0 is empty");
        assert_eq!(entry.layer_count(), 2);
        let painted = (0..20).flat_map(|row| (0..60).map(move |col| (col, row))).filter(|&(col, row)| entry.tile(1, col, row) > 0).count();
        assert!(painted > 0, "the front layer has tiles");

        // The entry room has one picture behind it twice, at two speeds: it is converted
        // once, 16x20 tiles with one of each kept, and the speeds become 256ths.
        let gfx = fs::read_to_string(out.join("studio_gfx.rs")).unwrap();
        assert!(gfx.contains("pub static BACKGROUNDS: [BackgroundImage; 1]"), "{gfx}");
        assert_eq!(entry.backgrounds().collect::<Vec<_>>(), [Background { image: 0, parallax: (64, 0) }, Background { image: 0, parallax: (128, 256) }]);
        // The entry room dims its back wall and first picture to level 6; the shaft dims nothing.
        assert_eq!(entry.dim(), RoomDim { level: 6, tiles: 0b01, backgrounds: 0b01 });
        let shaft = world.room(1);
        assert_eq!(shaft.dim(), RoomDim::default());
        assert_eq!((shaft.id(), shaft.world(), shaft.backgrounds().len()), ("shaft", Some((2, 0)), 0), "the shaft has none");
        let cells = fs::read(out.join("background_0.cells")).unwrap();
        assert_eq!(cells.len(), 16 * 20 * 2);
        let distinct = fs::read(out.join("background_0.4bpp")).unwrap().len() / image::TILE_BYTES;
        assert!(distinct < 16 * 20, "repeated tiles are kept once: {distinct}");
        assert!(cells.chunks_exact(2).all(|cell| (u16::from_le_bytes([cell[0], cell[1]]) as usize) < distinct));
        fs::remove_dir_all(out).ok();
    }

    #[test]
    fn writes_the_physics_set_in_the_project() {
        let physics: model::Physics =
            serde_json::from_str(r#"{"mode":"topdown","platformer":{"gravity":30,"airJumps":2},"topDown":{"movement":"grid","gridSize":8,"directions":4}}"#)
                .unwrap();
        let physics = physics_of(&physics);
        assert_eq!(physics.mode, PhysicsMode::TopDown);
        assert_eq!((physics.platformer.gravity, physics.platformer.fall_gravity), (30, 48), "fields left out keep their defaults");
        assert_eq!(physics.platformer.air_jumps, 2);
        assert_eq!(physics.top_down.movement, Movement::Grid);
        assert_eq!((physics.top_down.directions, physics.top_down.grid_size), (4, 8));
    }

    /// The section is followed by zeros up to its capacity: the project's reserve, or
    /// by default a quarter of the data and at least 4 KiB.
    #[test]
    fn reserves_room_to_grow() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixture");
        let dir = std::env::temp_dir().join(format!("pecten-studio-build-reserve-{}", std::process::id()));
        let header = |section: &[u8]| {
            (u32::from_le_bytes(section[12..16].try_into().unwrap()) as usize, u32::from_le_bytes(section[16..20].try_into().unwrap()) as usize)
        };

        let out = dir.join("default");
        generate(&Options { project: fixture.clone(), out: out.clone() }).unwrap_or_else(|error| panic!("{error}"));
        let section = fs::read(out.join("studio_data.bin")).unwrap();
        let (used, capacity) = header(&section);
        assert_eq!(capacity, section.len());
        assert_eq!(capacity - used, pecten_studio_rt::data::layout::default_reserve(used));
        assert!(capacity - used >= 4096);
        assert!(section[used..].iter().all(|&b| b == 0));

        // A project that sets its own reserve.
        fn copy(from: &Path, to: &Path) {
            fs::create_dir_all(to).unwrap();
            for entry in fs::read_dir(from).unwrap().map(Result::unwrap) {
                if entry.file_type().unwrap().is_dir() {
                    copy(&entry.path(), &to.join(entry.file_name()))
                } else {
                    fs::copy(entry.path(), to.join(entry.file_name())).map(|_| ()).unwrap()
                }
            }
        }
        let project = dir.join("project");
        copy(&fixture, &project);
        let mut json: Value = serde_json::from_str(&fs::read_to_string(project.join("studio/project.json")).unwrap()).unwrap();
        json["build"] = serde_json::json!({ "dataReserve": 10000 });
        fs::write(project.join("studio/project.json"), json.to_string()).unwrap();
        let out = dir.join("set");
        let report = generate(&Options { project, out: out.clone() }).unwrap_or_else(|error| panic!("{error}"));
        let section = fs::read(out.join("studio_data.bin")).unwrap();
        let (used, capacity) = header(&section);
        assert_eq!(capacity, (used + 10000).next_multiple_of(4));
        assert!(report.summary.iter().any(|line| line == &format!("data section: {used} bytes, {} more reserved", capacity - used)), "{:?}", report.summary);
        fs::remove_dir_all(dir).ok();
    }

    /// A room's pictures share the console's four backgrounds with its tile layers.
    #[test]
    fn counts_backgrounds_against_the_four_layers() {
        let dir = std::env::temp_dir().join(format!("pecten-studio-build-layers-{}", std::process::id()));
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixture");
        fs::create_dir_all(dir.join("studio/rooms")).unwrap();
        fs::create_dir_all(dir.join("studio/tilesets")).unwrap();
        fs::create_dir_all(dir.join("assets")).unwrap();
        for file in ["studio/project.json", "studio/tilesets/tiles.json", "assets/tiles.png", "assets/sky.png"] {
            fs::copy(fixture.join(file), dir.join(file)).unwrap();
        }
        let layer = r#"{"name":"L","data":[600,0]}"#;
        let sky = r#"{"image":"assets/sky.png","parallax":{"x":25,"y":0}}"#;
        let room = |layers: usize, backgrounds: &str| {
            format!(
                r#"{{"name":"R","width":1,"height":1,"tileset":"tiles","layers":[{}],"backgrounds":[{backgrounds}],"entities":[]}}"#,
                vec![layer; layers].join(",")
            )
        };
        // Three tile layers in one room leave one background for every room drawn with it.
        fs::write(dir.join("studio/rooms/a.json"), room(3, "")).unwrap();
        fs::write(dir.join("studio/rooms/b.json"), room(1, &format!("{sky},{sky}"))).unwrap();
        fs::write(dir.join("studio/rooms/c.json"), room(1, r#"{"image":"assets/none.png","parallax":{"x":0,"y":0}}"#)).unwrap();
        let text = generate(&Options { project: dir.clone(), out: dir.join("out") }).err().expect("five layers fail").to_string();
        assert!(text.contains("studio/rooms/b.json: 2 backgrounds and the 3 tile layers of rooms drawn with tileset \"tiles\" are 5 layers"), "{text}");
        assert!(text.contains("studio/rooms/c.json: background assets/none.png:"), "{text}");
        assert!(!text.contains("rooms/a.json"), "{text}");
        fs::remove_dir_all(dir).ok();
    }

    /// The studio reads the behaviours from `core/src/behaviourschema.ts`, written from
    /// the runtime's declarations: the two must not differ.
    #[test]
    fn the_studio_has_the_behaviour_declarations() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../core/src/behaviourschema.ts");
        let written = fs::read_to_string(&path).unwrap_or_default();
        assert!(
            written == behaviours::schema_module(),
            "{} differs from the runtime's declarations; run `cargo run -p pecten_studio_build --bin behaviours-schema`",
            path.display()
        );
    }

    /// One of each problem with behaviour settings, in the words the studio uses too.
    #[test]
    fn reports_bad_behaviour_settings() {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixture/bad-behaviours");
        let out = std::env::temp_dir().join(format!("pecten-studio-build-behaviours-{}", std::process::id()));
        let error = generate(&Options { project: fixture.clone(), out: out.clone() }).err().expect("a project with bad settings does not build");
        let expected = fs::read_to_string(fixture.join("expected.txt")).unwrap();
        let mut reported = error.0.clone();
        reported.sort();
        let mut lines: Vec<String> = expected.lines().filter(|line| !line.is_empty()).map(String::from).collect();
        lines.sort();
        assert_eq!(reported, lines);
        fs::remove_dir_all(out).ok();
    }

    #[test]
    fn lists_every_problem_at_once() {
        let dir = std::env::temp_dir().join(format!("pecten-studio-build-bad-{}", std::process::id()));
        fs::create_dir_all(dir.join("studio/rooms")).unwrap();
        fs::write(dir.join("studio/project.json"), r#"{"name":"Bad","collisionClasses":[{"id":"empty","kind":"empty"}],"entityTypes":[]}"#).unwrap();
        fs::write(dir.join("studio/world.json"), r#"{"rooms":[],"start":"nowhere"}"#).unwrap();
        fs::write(
            dir.join("studio/rooms/a.json"),
            r#"{"name":"A","width":1,"height":1,"tileset":"missing","layers":[{"name":"L","data":[600,0]}],"entities":[]}"#,
        )
        .unwrap();
        let error = generate(&Options { project: dir.clone(), out: dir.join("out") }).err().expect("a broken project fails");
        let text = error.to_string();
        assert!(text.contains("unknown tileset \"missing\""), "{text}");
        assert!(text.contains("start room \"nowhere\" does not exist"), "{text}");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_sample_runs_behaviours_through_the_generated_dispatch() {
        // US-013: the sample's loop is data::update_entities; it names no behaviour and
        // matches no entity type to run one.
        let main = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../sample/src/main.rs")).unwrap();
        assert!(main.contains("data::update_entities("));
        for name in pecten_studio_rt::behaviour::DECLARATIONS.iter().map(|d| d.id) {
            let ty: String = name.split('-').map(|w| w[..1].to_uppercase() + &w[1..]).collect();
            assert!(!main.contains(&format!("{ty}::")) && !main.contains(&format!("{ty},")), "main.rs names {ty}");
        }
        assert!(!main.contains("from_entity"));
    }
}
