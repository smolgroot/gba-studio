//! Runtime for games built with Pecten-Studio.
//!
//! [`data`] and [`physics`] are plain `no_std` code with no dependencies: rooms,
//! collision classes, entities, and a body that moves against them. They compile for
//! the host too, so game rules can be tested off the console. [`gfx`], behind the
//! `agb` feature, draws rooms and plays sprite animations on agb.
//!
//! A game's `build.rs` calls `pecten_studio_build::build()`, and its code brings the
//! result in with [`include_data!`] and [`include_gfx!`].
#![no_std]

// The data section's writer, for the build helper and tests, builds into a Vec.
#[cfg(any(test, feature = "write"))]
extern crate alloc;

pub mod data;
pub mod physics;

#[cfg(feature = "agb")]
pub mod gfx;

/// Includes the project's rooms, collision and entities as a `data` module.
#[macro_export]
macro_rules! include_data {
    () => {
        include!(concat!(env!("OUT_DIR"), "/studio_data.rs"));
    };
}

/// Includes the project's tilesets, room tiles and sprites as a `gfx` module. Needs the `agb` feature.
#[macro_export]
macro_rules! include_gfx {
    () => {
        include!(concat!(env!("OUT_DIR"), "/studio_gfx.rs"));
    };
}

/// Includes the project's music and sound effects as an `audio` module. The game needs `agb_tracker`.
#[macro_export]
macro_rules! include_audio {
    () => {
        include!(concat!(env!("OUT_DIR"), "/studio_audio.rs"));
    };
}
