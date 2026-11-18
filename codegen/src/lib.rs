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

mod image;
mod model;

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Write as _,
    fs,
    path::PathBuf,
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
    let name: String = id
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(|part| part[..1].to_ascii_uppercase() + &part[1..])
        .collect();
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

/// The project's physics as a Rust value.
fn physics_source(physics: &model::Physics) -> String {
    let p = &physics.platformer;
    let t = &physics.top_down;
    format!(
        "Physics {{\n        mode: PhysicsMode::{},\n        platformer: PlatformerPhysics {{ gravity: {}, fall_gravity: {}, max_fall_speed: {}, run_speed: {}, ground_acceleration: {}, ground_friction: {}, air_acceleration: {}, jump_speed: {}, jump_cut: {}, air_jumps: {}, coyote_frames: {}, jump_buffer_frames: {} }},\n        top_down: TopDownPhysics {{ movement: Movement::{}, speed: {}, acceleration: {}, friction: {}, directions: {}, normalize_diagonal: {}, corner_slide: {}, grid_size: {} }},\n    }}",
        if physics.mode == model::PhysicsMode::Topdown { "TopDown" } else { "Platformer" },
        p.gravity,
        p.fall_gravity,
        p.max_fall_speed,
        p.run_speed,
        p.ground_acceleration,
        p.ground_friction,
        p.air_acceleration,
        p.jump_speed,
        p.jump_cut,
        p.air_jumps,
        p.coyote_frames,
        p.jump_buffer_frames,
        if t.movement == model::Movement::Grid { "Grid" } else { "Free" },
        t.speed,
        t.acceleration,
        t.friction,
        t.directions,
        t.normalize_diagonal,
        t.corner_slide,
        t.grid_size,
    )
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

    // Rooms: collision and entities for the rules, tile layers for drawing.
    let mut room_rows = Vec::new();
    let mut room_gfx_rows = Vec::new();
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
        write(&format!("room_{id}.collision"), &collision, &mut problems);

        let mut entities = Vec::new();
        for (n, entity) in room.entities.iter().enumerate() {
            let Some(kind) = types.iter().position(|t| t.id == entity.kind) else {
                problems.push(format!("{file}: entity {n} has unknown type \"{}\"", entity.kind));
                continue;
            };
            let props: Vec<String> = types[kind]
                .props
                .iter()
                .filter_map(|def| {
                    let value = match entity.props.get(&def.name).unwrap_or(&def.default) {
                        Value::Bool(b) => format!("Prop::Bool({b})"),
                        Value::Number(number) => format!("Prop::Int({})", number.as_i64().unwrap_or(0) as i32),
                        Value::String(text) => format!("Prop::Str({text:?})"),
                        other => {
                            problems.push(format!("{file}: entity {n}: property \"{}\" has a value that is not a number, a boolean or text: {other}", def.name));
                            return None;
                        }
                    };
                    Some(format!("({:?}, {value})", def.name))
                })
                .collect();
            entities.push(format!("Entity {{ kind: {kind}, x: {}, y: {}, props: &[{}] }}", entity.x, entity.y, props.join(", ")));
        }
        let world = docs.world.rooms.iter().find(|p| &p.room == id).map_or("None".to_string(), |p| format!("Some(({}, {}))", p.x, p.y));
        let music = match &room.music {
            None => "None".to_string(),
            Some(track) => match docs.audio.tracks.iter().position(|t| &t.id == track) {
                Some(index) => format!("Some({index})"),
                None => {
                    problems.push(format!("{file}: unknown music track \"{track}\""));
                    "None".to_string()
                }
            },
        };
        room_rows.push(format!(
            "        Room {{\n            id: {id:?},\n            name: {:?},\n            cols: {cols},\n            rows: {rows},\n            collision: include_bytes!({}),\n            entities: &[{}],\n            world: {world},\n            music: {music},\n        }},",
            room.name,
            out_file(&format!("room_{id}.collision")),
            entities.iter().map(|e| format!("\n                {e},")).collect::<String>(),
        ));

        let mut layer_refs = Vec::new();
        for (n, layer) in layers.iter().enumerate() {
            let bytes: Vec<u8> = layer.iter().flat_map(|&cell| (cell as u16).to_le_bytes()).collect();
            write(&format!("room_{id}.layer{n}"), &bytes, &mut problems);
            let _ = writeln!(gfx, "    static ROOM_{}_LAYER_{n}: &Aligned<[u8]> = &Aligned(*include_bytes!({}));", constant(id), out_file(&format!("room_{id}.layer{n}")));
            layer_refs.push(format!("&ROOM_{}_LAYER_{n}.0", constant(id)));
        }
        let backgrounds: Vec<String> = room
            .backgrounds
            .iter()
            .map(|b| {
                // Percent of the camera's speed, as the 256ths the runtime shifts by.
                let speed = |percent: u32| (percent.min(100) * 256 + 50) / 100;
                format!("BackgroundLayer {{ image: &BACKGROUNDS[{}], parallax: ({}, {}) }}", picture_index(&b.image), speed(b.parallax.x), speed(b.parallax.y))
            })
            .collect();
        room_gfx_rows.push(format!(
            "        RoomGfx {{ tileset: &TILESETS[{tileset}], cols: {cols}, rows: {rows}, layers: &[{}], world: {world}, backgrounds: &[{}] }},",
            layer_refs.join(", "),
            backgrounds.join(", ")
        ));
        summary.push(format!("room {id}: {cols}x{rows} tiles, {} layers, {} backgrounds, {} entities", layers.len(), backgrounds.len(), entities.len()));
    }

    // What a room's pictures share with the rooms on screen beside it: the console's
    // four backgrounds, its 16 background palettes and the tiles video memory holds.
    for (id, room) in &docs.rooms {
        let Some(tileset) = tileset_ids.iter().position(|t| **t == room.tileset) else { continue };
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
        // Two layers of one picture share its tiles and palettes.
        let files: BTreeSet<&str> = room.backgrounds.iter().map(|b| b.image.as_str()).collect();
        let costs: Vec<PictureCost> = files.iter().filter_map(|file| pictures.get(file).and_then(|(_, cost)| *cost)).collect();
        let palettes = tileset_palettes[tileset] + costs.iter().map(|c| c.1).sum::<usize>();
        if palettes > PALETTES {
            problems.push(format!(
                "{file}: its backgrounds need {} palettes and tileset \"{name}\" {}, which is {palettes}; the GBA has {PALETTES} for backgrounds. Use fewer colour combinations in the pictures",
                palettes - tileset_palettes[tileset],
                tileset_palettes[tileset],
            ));
        }
        let tiles = used_tiles[tileset].len() + costs.iter().map(|c| c.0).sum::<usize>();
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
            .map(|frame| format!("unsafe {{ Sprite::new(&{palette_name}, frame_bytes(&SPRITE_{index}_DATA.0, {frame}, {frame_bytes}), Size::S{width}x{height}) }}"))
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

    let start = match &docs.world.start {
        None => "None".to_string(),
        Some(room) => match room_ids.iter().position(|r| *r == room) {
            Some(index) => format!("Some({index})"),
            None => {
                problems.push(format!("studio/world.json: start room \"{room}\" does not exist"));
                "None".to_string()
            }
        },
    };
    if !problems.is_empty() {
        return Err(Error(problems));
    }

    let header = format!("// @generated by pecten_studio_build from the studio project {:?}. Do not edit.\n", docs.project.name);
    let indexed = |ids: &mut dyn Iterator<Item = &String>, kind: &str| ids.enumerate().map(|(i, id)| format!("        pub const {}: {kind} = {i};\n", constant(id))).collect::<String>();
    let kinds: Vec<String> = types.iter().map(|t| variant(&t.id)).collect();
    let data = format!(
        r#"{header}#[allow(dead_code, unused_imports)]
pub mod data {{
    use pecten_studio_rt::data::{{CollisionClass, CollisionKind, Entity, Prop, Room, World}};
    use pecten_studio_rt::physics::{{Movement, Physics, PhysicsMode, PlatformerPhysics, TopDownPhysics}};

    /// The numbers set in the studio's Physics tab.
    pub static PHYSICS: Physics = {physics};

    pub static CLASSES: [CollisionClass; {class_count}] = [
{class_rows}    ];

    /// Collision class indices, as [`Room::class_index`] gives them.
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

    /// Room indices in [`ROOMS`].
    pub mod room {{
{room_consts}    }}

    pub static ROOMS: [Room; {room_count}] = [
{room_rows}
    ];

    pub static WORLD: World = World {{ rooms: &ROOMS, classes: &CLASSES, start: {start} }};
}}
"#,
        physics = physics_source(&docs.project.physics),
        class_count = classes.len(),
        class_rows = classes
            .iter()
            .map(|c| {
                let kind = match c.kind.as_str() {
                    "solid" => "Solid",
                    "oneway" => "OneWay",
                    "slope" => "Slope",
                    "hazard" => "Hazard",
                    "custom" => "Custom",
                    _ => "Empty",
                };
                let slope = c.slope.as_ref().map_or((0, 0), |s| (s.left, s.right));
                format!("        CollisionClass {{ id: {:?}, kind: CollisionKind::{kind}, slope: ({}, {}) }},\n", c.id, slope.0, slope.1)
            })
            .collect::<String>(),
        class_consts = indexed(&mut classes.iter().map(|c| &c.id), "u8"),
        kind_variants = kinds.iter().map(|k| format!("        {k},\n")).collect::<String>(),
        kind_count = kinds.len(),
        kind_all = kinds.iter().map(|k| format!("EntityKind::{k}")).collect::<Vec<_>>().join(", "),
        room_consts = indexed(&mut docs.rooms.keys(), "usize"),
        room_count = room_rows.len(),
        room_rows = room_rows.join("\n"),
    );
    let gfx = format!(
        r#"{header}#[allow(dead_code, unused_imports)]
pub mod gfx {{
    use agb::display::{{
        Palette16, Rgb15,
        object::{{Size, Sprite}},
        tiled::{{TileFormat, TileSet}},
    }};
    use pecten_studio_rt::gfx::{{Animation, BackgroundImage, BackgroundLayer, RoomGfx, SpriteSheet, Tileset, frame_bytes}};

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

    /// Tile layers and backgrounds of each room, in the order of `data::ROOMS`.
    pub static ROOMS: [RoomGfx; {room_count}] = [
{room_gfx_rows}
    ];

{sprite_items}
    /// The sprite of each entity type that has one, in the order of `data::EntityKind`.
    pub static ENTITY_SPRITES: [Option<&SpriteSheet>; {kind_count}] = [{entity_sprites}];
}}
"#,
        tileset_count = tileset_rows.len(),
        tileset_rows = tileset_rows.join("\n"),
        background_count = background_rows.len(),
        background_rows = background_rows.join("\n"),
        room_count = room_gfx_rows.len(),
        room_gfx_rows = room_gfx_rows.join("\n"),
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
    Ok(Report { inputs, summary })
}

#[cfg(test)]
mod tests {
    use super::*;
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
        assert!(data.contains("start: Some(0)"));
        // The fixture says nothing about physics: it gets the defaults.
        assert!(data.contains("mode: PhysicsMode::Platformer"), "{data}");
        assert!(data.contains("gravity: 48, fall_gravity: 48, max_fall_speed: 1024, run_speed: 384"), "{data}");
        assert!(data.contains("movement: Movement::Free, speed: 256"), "{data}");

        // The entry room: 60x20 cells, floor from row 17 down, a one-way girder at row 12.
        let collision = fs::read(out.join("room_entry.collision")).unwrap();
        assert_eq!(collision.len(), 60 * 20);
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
        let layer = fs::read(out.join("room_entry.layer1")).unwrap();
        assert_eq!(layer.len(), 60 * 20 * 2);

        // The entry room has one picture behind it twice, at two speeds: it is converted
        // once, 16x20 tiles with one of each kept, and the speeds become 256ths.
        let gfx = fs::read_to_string(out.join("studio_gfx.rs")).unwrap();
        assert!(gfx.contains("pub static BACKGROUNDS: [BackgroundImage; 1]"), "{gfx}");
        assert!(gfx.contains("backgrounds: &[BackgroundLayer { image: &BACKGROUNDS[0], parallax: (64, 0) }, BackgroundLayer { image: &BACKGROUNDS[0], parallax: (128, 256) }]"), "{gfx}");
        assert!(gfx.contains("world: Some((2, 0)), backgrounds: &[] }"), "the shaft has none: {gfx}");
        let cells = fs::read(out.join("background_0.cells")).unwrap();
        assert_eq!(cells.len(), 16 * 20 * 2);
        let distinct = fs::read(out.join("background_0.4bpp")).unwrap().len() / image::TILE_BYTES;
        assert!(distinct < 16 * 20, "repeated tiles are kept once: {distinct}");
        assert!(cells.chunks_exact(2).all(|cell| (u16::from_le_bytes([cell[0], cell[1]]) as usize) < distinct));
        fs::remove_dir_all(out).ok();
    }

    #[test]
    fn writes_the_physics_set_in_the_project() {
        let physics: model::Physics = serde_json::from_str(r#"{"mode":"topdown","platformer":{"gravity":30,"airJumps":2},"topDown":{"movement":"grid","gridSize":8,"directions":4}}"#).unwrap();
        let source = physics_source(&physics);
        assert!(source.contains("mode: PhysicsMode::TopDown"), "{source}");
        assert!(source.contains("gravity: 30, fall_gravity: 48"), "fields left out keep their defaults: {source}");
        assert!(source.contains("air_jumps: 2"), "{source}");
        assert!(source.contains("movement: Movement::Grid"), "{source}");
        assert!(source.contains("directions: 4"), "{source}");
        assert!(source.contains("grid_size: 8"), "{source}");
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
            format!(r#"{{"name":"R","width":1,"height":1,"tileset":"tiles","layers":[{}],"backgrounds":[{backgrounds}],"entities":[]}}"#, vec![layer; layers].join(","))
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
}
