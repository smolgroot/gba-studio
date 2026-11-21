//! Writes the runtime's behaviour declarations as the module the studio reads,
//! `core/src/behaviourschema.ts`, or to the path given.
use std::path::PathBuf;

fn main() {
    let default = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../core/src/behaviourschema.ts");
    let path = std::env::args_os().nth(1).map_or(default, PathBuf::from);
    if let Err(error) = std::fs::write(&path, pecten_studio_build::behaviours::schema_module()) {
        eprintln!("{}: {error}", path.display());
        std::process::exit(1);
    }
    println!("wrote {}", path.display());
}
