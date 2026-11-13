//! A Metroidvania skeleton made of a GBA-Studio project: walk and jump through the
//! rooms painted in the studio. The rooms on the world map are one continuous space:
//! the hero walks from a room into the one touching it and the camera scrolls along,
//! with the next room's tiles loaded just ahead of it. Behind the rooms are their two
//! backgrounds, which scroll slower than the camera. Everything on screen comes from
//! `studio/` and `assets/`; this file is the rules.
//!
//! D-pad moves, A jumps (hold for a higher jump), Down drops through platforms.
//!
//! Collectibles are entities whose type has a `value` property, like the project's
//! coins and diamonds: touching one takes it for good and adds its value to the count
//! in the corner. A new kind of collectible is a new entity type in the studio, with
//! a sprite and a `value`; nothing here changes.
//!
//! Enemies are matched by type: a sentry bot walks back and forth around where it was
//! placed, as far each way as its `patrol` property says, and touching it hurts like
//! spikes do: the hero goes back to where it entered the room.
//!
//! Sound effects are the project's audio list, played by id: `jump`, `coin`, `diamond`
//! and `damage`.
#![no_std]
#![no_main]

use agb::input::{Button, ButtonController};
use agb::sound::mixer::{Frequency, Mixer, SoundChannel};
use gba_studio_rt::{
    data::{Collected, CollisionKind, SCREEN_H, SCREEN_W},
    gfx::{AnimPlayer, WorldView},
    physics::{Body, SUB},
};

gba_studio_rt::include_data!();
gba_studio_rt::include_gfx!();
gba_studio_rt::include_audio!();

use data::{EntityKind, WORLD};

const RUN: i32 = SUB * 3 / 2;
const GRAVITY: i32 = 48;
const MAX_FALL: i32 = 4 * SUB;
const JUMP: i32 = 1100;
/// Letting go of A caps the rise at this speed, for short hops.
const JUMP_CUT: i32 = 400;
/// The most the camera moves in a frame when the area it may show changes, so it
/// glides to its new place. Following the hero never needs this much.
const CAMERA_SPEED: i32 = 6;

/// A sentry bot takes this many frames to walk a pixel.
const SENTRY_PACE: u32 = 2;

/// Words of 32 bits that hold one bit for every entity of the project.
const ENTITY_WORDS: usize = WORLD.entity_count().div_ceil(32);
/// The count in the corner shows this many digits at most.
const DIGITS: usize = 4;

/// Plays a sound effect of the project. When every channel is busy it is dropped.
fn play(mixer: &mut Mixer, sound: usize) {
    let _ = mixer.play_sound(SoundChannel::new(audio::SFX[sound]));
}

/// Where a patrol has got to after `clock` frames: pixels from where the entity was
/// placed, out to `reach` on each side and back, and whether it is walking left.
fn patrol(reach: i32, clock: u32) -> (i32, bool) {
    if reach <= 0 {
        return (0, false);
    }
    let step = (clock / SENTRY_PACE % (4 * reach as u32)) as i32;
    match step {
        _ if step < reach => (step, false),
        _ if step < 3 * reach => (2 * reach - step, true),
        _ => (step - 4 * reach, false),
    }
}

/// The hero's box: the hitbox drawn in the studio, or a default.
fn hero_size() -> (i32, i32) {
    gfx::SPRITE_HERO.hitbox.map_or((10, 14), |(_, _, w, h)| (w as i32, h as i32))
}

/// Where a game starts, in world pixels: the player-start entity of the start room.
fn start() -> (usize, Body) {
    let room = WORLD.start.unwrap_or(0) as usize;
    let (left, top) = WORLD.origin(room).unwrap_or((0, 0));
    let (w, h) = hero_size();
    let entity = WORLD.rooms[room].entities.iter().find(|e| EntityKind::of(e) == Some(EntityKind::PlayerStart));
    let (x, y) = entity.map_or((24, 24), |e| (e.x as i32, e.y as i32));
    (room, Body::standing_at(left + x, top + y, w, h))
}

#[agb::entry]
fn main(mut gba: agb::Gba) -> ! {
    let mut graphics = gba.graphics.get();
    let mut input = ButtonController::new();
    // The project's WAV files must be at this rate, or they play at the wrong speed.
    let mut mixer = gba.mixer.mixer(Frequency::Hz10512);
    let hero = &gfx::SPRITE_HERO;
    let idle = hero.animation("idle").unwrap_or(&hero.animations[0]);
    let run = hero.animation("run").unwrap_or(idle);
    let jump = hero.animation("jump").unwrap_or(idle);

    // The hero lives in world pixels; `room` is the one its middle is in.
    let (mut room, mut body) = start();
    // Where the hero comes back to after a hazard or a fall off the map: where it entered the room.
    let mut entry = body;
    let mut view = WorldView::new(&gfx::ROOMS, room, &mut graphics);
    let focus = |body: &Body| (body.x + body.w / 2, body.y + body.h / 2);
    let (x, y) = focus(&body);
    let mut camera = WORLD.camera_target(room, x, y, |other| view.shows(other));
    view.load(camera.0, camera.1);
    let mut animation = AnimPlayer::new(idle);
    let mut faces_left = false;
    // What has been collected, and what it was worth. Coins stay taken after a respawn.
    let mut found = Collected::<ENTITY_WORDS>::new();
    let mut score = 0u32;
    // Ticks since the game began: every placed entity animates off this one clock.
    let mut clock = 0u32;

    loop {
        input.update();
        let direction = input.x_tri() as i32;
        if direction != 0 {
            faces_left = direction < 0;
        }
        body.vx = direction * RUN;
        if body.on_ground && input.is_just_pressed(Button::A) {
            body.vy = -JUMP;
            play(&mut mixer, audio::sfx::JUMP);
        }
        if !input.is_pressed(Button::A) && body.vy < -JUMP_CUT {
            body.vy = -JUMP_CUT;
        }
        body.vy = (body.vy + GRAVITY).min(MAX_FALL);
        let before = body;
        body.step(&WORLD, input.is_pressed(Button::Down));

        let (x, y) = focus(&body);
        match WORLD.room_at(x, y) {
            Some(next) if next != room => {
                room = next;
                entry = body;
                // A room drawn with another tileset cannot share the screen: cut to it.
                if !view.shows(room) {
                    view = WorldView::new(&gfx::ROOMS, room, &mut graphics);
                    camera = WORLD.camera_target(room, x, y, |other| view.shows(other));
                    view.load(camera.0, camera.1);
                } else {
                    // The pictures behind the rooms are those of the room the hero is in.
                    view.set_backgrounds(room, &graphics);
                }
            }
            Some(_) => {}
            // Off the map: its sides and top are walls, and below it is a pit.
            None if WORLD.room_at(x, before.y + before.h / 2).is_none() && body.y > before.y => {
                body = entry;
                play(&mut mixer, audio::sfx::DAMAGE);
            }
            None => {
                body.x = before.x;
                body.y = body.y.max(before.y);
            }
        }
        if body.touches(&WORLD, CollisionKind::Hazard) {
            body = entry;
            play(&mut mixer, audio::sfx::DAMAGE);
        }

        animation.play(if !body.on_ground {
            jump
        } else if direction != 0 {
            run
        } else {
            idle
        });
        animation.tick();
        clock = clock.wrapping_add(1);

        let (x, y) = focus(&body);
        let target = WORLD.camera_target(room, x, y, |other| view.shows(other));
        // After a respawn the hero may be far away: cut. Otherwise glide.
        if (target.0 - camera.0).abs() >= SCREEN_W || (target.1 - camera.1).abs() >= SCREEN_H {
            camera = target;
            view.load(camera.0, camera.1);
        } else {
            camera.0 += (target.0 - camera.0).clamp(-CAMERA_SPEED, CAMERA_SPEED);
            camera.1 += (target.1 - camera.1).clamp(-CAMERA_SPEED, CAMERA_SPEED);
            view.set_camera(camera.0, camera.1);
        }

        let mut frame = graphics.frame();
        view.show(&mut frame);
        let (feet_x, feet_y) = body.feet();
        hero.object(animation.frame(), feet_x - camera.0, feet_y - camera.1, faces_left).show(&mut frame);
        // Every other entity whose type has a sprite stands where it was placed, in
        // every room that is in view, playing its sprite's first animation. One with a
        // `value` is a collectible: it is taken when the hero touches it. A sentry bot
        // patrols, and hurts the hero it touches.
        let mut hurt = false;
        for (index, other) in WORLD.rooms.iter().enumerate() {
            let Some((left, top)) = WORLD.origin(index).filter(|_| view.shows(index)) else { continue };
            if left >= camera.0 + SCREEN_W || top >= camera.1 + SCREEN_H || left + other.width() <= camera.0 || top + other.height() <= camera.1 {
                continue;
            }
            for (number, entity) in other.entities.iter().enumerate() {
                let taken = WORLD.entity_index(index, number);
                if EntityKind::of(entity) == Some(EntityKind::PlayerStart) || found.has(taken) {
                    continue;
                }
                let sentry = EntityKind::of(entity) == Some(EntityKind::SentryBot);
                let (walked, flip) = if sentry { patrol(entity.int("patrol").unwrap_or(0), clock) } else { (0, false) };
                let (world_x, world_y) = (left + entity.x as i32 + walked, top + entity.y as i32);
                let (x, y) = (world_x - camera.0, world_y - camera.1);
                if let Some(sheet) = gfx::ENTITY_SPRITES[entity.kind as usize]
                    && (-64..SCREEN_W + 64).contains(&x)
                    && (-64..SCREEN_H + 64).contains(&y)
                {
                    if let Some(value) = entity.int("value") {
                        let (box_x, box_y, box_w, box_h) = sheet.hitbox_at(world_x, world_y);
                        if body.overlaps(box_x, box_y, box_w, box_h) && found.take(taken) {
                            score = score.saturating_add(value.max(0) as u32);
                            let diamond = EntityKind::of(entity) == Some(EntityKind::Diamond);
                            play(&mut mixer, if diamond { audio::sfx::DIAMOND } else { audio::sfx::COIN });
                            continue;
                        }
                    }
                    if sentry {
                        let (box_x, box_y, box_w, box_h) = sheet.hitbox_at(world_x, world_y);
                        hurt |= body.overlaps(box_x, box_y, box_w, box_h);
                    }
                    let shown = sheet.animations.first().map_or(0, |animation| animation.frame_at(clock));
                    sheet.object(shown, x, y, flip).show(&mut frame);
                }
            }
        }
        if hurt {
            body = entry;
            play(&mut mixer, audio::sfx::DAMAGE);
        }
        // The count: a coin and the score beside it, in the top-left corner.
        gfx::SPRITE_COIN.object(0, 8, 12, false).show(&mut frame);
        let mut places = [0usize; DIGITS];
        let mut rest = score.min(10u32.pow(DIGITS as u32) - 1);
        let mut used = 0;
        loop {
            places[used] = (rest % 10) as usize;
            rest /= 10;
            used += 1;
            if rest == 0 {
                break;
            }
        }
        for (place, digit) in places[..used].iter().rev().enumerate() {
            gfx::SPRITE_DIGITS.object(*digit, 14 + place as i32 * 6, 4, false).show(&mut frame);
        }
        // Mixing is the last work of the frame, just before the wait for the next one.
        mixer.frame();
        frame.commit();
    }
}
