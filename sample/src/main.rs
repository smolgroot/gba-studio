//! A Metroidvania skeleton made of a Pecten-Studio project: walk and jump through the
//! rooms painted in the studio. The rooms on the world map are one continuous space:
//! the hero walks from a room into the one touching it and the camera scrolls along,
//! with the next room's tiles loaded just ahead of it. Behind the rooms are their two
//! backgrounds, which scroll slower than the camera. Everything on screen comes from
//! `studio/` and `assets/`; this file is the rules.
//!
//! D-pad moves, A jumps (hold for a higher jump), Down drops through platforms. How
//! all of that feels is set in the studio's Physics tab. Switched to top-down there,
//! the D-pad walks in every direction and the edges of the map are walls.
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
//!
//! Built with `--features measure`, the corner shows how long each frame's work takes
//! instead of the score: the worst frame so far on top, the average below, both in
//! hundreds of CPU cycles. A frame has 2808 of them.
#![no_std]
#![no_main]

use agb::input::{Button, ButtonController};
use agb::sound::mixer::{Frequency, Mixer, SoundChannel};
use pecten_studio_rt::{
    data::{Collected, CollisionKind, SCREEN_H, SCREEN_W, World},
    gfx::{AnimPlayer, WorldView},
    physics::{Body, PhysicsMode, PlatformerController, PlatformerInput, TopDownController},
};

pecten_studio_rt::include_data!();
pecten_studio_rt::include_gfx!();
pecten_studio_rt::include_audio!();

use data::EntityKind;

/// The most the camera moves in a frame when the area it may show changes, so it
/// glides to its new place. Following the hero never needs this much.
const CAMERA_SPEED: i32 = 6;

/// A sentry bot takes this many frames to walk a pixel.
const SENTRY_PACE: u32 = 2;

/// Words of 32 bits that hold one bit for every entity of the project.
const ENTITY_WORDS: usize = data::ENTITY_SLOTS.div_ceil(32);
/// The count in the corner shows this many digits at most.
const DIGITS: usize = 4;

/// Draws a number with the digit sprites, its left edge at `x`.
fn show_number(frame: &mut agb::display::GraphicsFrame, number: u32, x: i32, y: i32) {
    let mut places = [0usize; DIGITS];
    let mut rest = number.min(10u32.pow(DIGITS as u32) - 1);
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
        gfx::SPRITE_DIGITS.object(*digit, x + place as i32 * 6, y, false).show(frame);
    }
}

/// Counts CPU cycles with timers 2 and 3 chained into one 32-bit counter.
#[cfg(feature = "measure")]
struct Stopwatch {
    low: agb::timer::Timer,
    high: agb::timer::Timer,
    started: u32,
    worst: u32,
    total: u64,
    frames: u32,
}

#[cfg(feature = "measure")]
impl Stopwatch {
    fn new(timers: agb::timer::Timers<'_>) -> Self {
        let (mut low, mut high) = (timers.timer2, timers.timer3);
        high.set_cascade(true).set_enabled(true);
        low.set_divider(agb::timer::Divider::Divider1).set_enabled(true);
        Self { low, high, started: 0, worst: 0, total: 0, frames: 0 }
    }
    fn now(&self) -> u32 {
        // Read the high half twice so a carry between the two reads is not missed.
        loop {
            let high = self.high.value();
            let low = self.low.value();
            if self.high.value() == high {
                return (high as u32) << 16 | low as u32;
            }
        }
    }
    fn start(&mut self) {
        self.started = self.now();
    }
    fn stop(&mut self) {
        let took = self.now().wrapping_sub(self.started);
        self.worst = self.worst.max(took);
        self.total += took as u64;
        self.frames += 1;
    }
}

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
fn start(world: &World) -> (usize, Body) {
    let room = world.start().unwrap_or(0) as usize;
    let (left, top) = world.origin(room).unwrap_or((0, 0));
    let (w, h) = hero_size();
    let entity = world.room(room).entities().find(|e| EntityKind::of(e) == Some(EntityKind::PlayerStart));
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

    // Rooms, entities and physics, read from the ROM's data section.
    let world = data::world();
    let physics = world.physics();

    // The hero lives in world pixels; `room` is the one its middle is in.
    let (mut room, mut body) = start(&world);
    // Where the hero comes back to after a hazard or a fall off the map: where it entered the room.
    let mut entry = body;
    let mut view = WorldView::new(&world, gfx::ART, room, &mut graphics);
    let focus = |body: &Body| (body.x + body.w / 2, body.y + body.h / 2);
    let (x, y) = focus(&body);
    let mut camera = world.camera_target(room, x, y, |other| view.shows(other));
    view.load(camera.0, camera.1);
    let mut animation = AnimPlayer::new(idle);
    let mut faces_left = false;
    // What has been collected, and what it was worth. Coins stay taken after a respawn.
    let mut found = Collected::<ENTITY_WORDS>::new();
    let mut score = 0u32;
    // Ticks since the game began: every placed entity animates off this one clock.
    let mut clock = 0u32;
    let top_down = physics.mode == PhysicsMode::TopDown;
    let walls = world.enclosed();
    let mut platformer = PlatformerController::new();
    let mut walker = TopDownController::new();
    #[cfg(feature = "measure")]
    let timers = gba.timers.timers();
    #[cfg(feature = "measure")]
    let mut stopwatch = Stopwatch::new(timers);

    loop {
        #[cfg(feature = "measure")]
        stopwatch.start();
        input.update();
        let direction = input.x_tri() as i32;
        let before = body;
        if top_down {
            let vertical = input.is_pressed(Button::Down) as i32 - input.is_pressed(Button::Up) as i32;
            walker.update(&mut body, &walls, &physics.top_down, direction, vertical);
            if body.vx != 0 {
                faces_left = body.vx < 0;
            }
        } else {
            if direction != 0 {
                faces_left = direction < 0;
            }
            let buttons = PlatformerInput { direction, jump_pressed: input.is_just_pressed(Button::A), jump_held: input.is_pressed(Button::A) };
            if platformer.update(&mut body, &physics.platformer, buttons) {
                play(&mut mixer, audio::sfx::JUMP);
            }
            body.step(&world, input.is_pressed(Button::Down));
        }

        let (x, y) = focus(&body);
        match world.room_at(x, y) {
            Some(next) if next != room => {
                room = next;
                entry = walker.settled(body);
                // A room drawn with another tileset cannot share the screen: cut to it.
                if !view.shows(room) {
                    view = WorldView::new(&world, gfx::ART, room, &mut graphics);
                    camera = world.camera_target(room, x, y, |other| view.shows(other));
                    view.load(camera.0, camera.1);
                } else {
                    // The pictures behind the rooms are those of the room the hero is in.
                    view.set_backgrounds(room, &graphics);
                }
            }
            Some(_) => {}
            // Off the map: its sides and top are walls, and below it is a pit.
            None if world.room_at(x, before.y + before.h / 2).is_none() && body.y > before.y => {
                body = entry;
                walker.stop();
                play(&mut mixer, audio::sfx::DAMAGE);
            }
            None => {
                body.x = before.x;
                body.y = body.y.max(before.y);
            }
        }
        if body.touches(&world, CollisionKind::Hazard) {
            body = entry;
            walker.stop();
            play(&mut mixer, audio::sfx::DAMAGE);
        }

        let moving = if top_down { body.vx != 0 || body.vy != 0 } else { direction != 0 };
        animation.play(if !top_down && !body.on_ground {
            jump
        } else if moving {
            run
        } else {
            idle
        });
        animation.tick();
        clock = clock.wrapping_add(1);

        let (x, y) = focus(&body);
        let target = world.camera_target(room, x, y, |other| view.shows(other));
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
        for (index, other) in world.rooms().enumerate() {
            let Some((left, top)) = world.origin(index).filter(|_| view.shows(index)) else { continue };
            if left >= camera.0 + SCREEN_W || top >= camera.1 + SCREEN_H || left + other.width() <= camera.0 || top + other.height() <= camera.1 {
                continue;
            }
            for (number, entity) in other.entities().enumerate() {
                let taken = world.entity_index(index, number);
                if EntityKind::of(&entity) == Some(EntityKind::PlayerStart) || found.has(taken) {
                    continue;
                }
                let sentry = EntityKind::of(&entity) == Some(EntityKind::SentryBot);
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
                            let diamond = EntityKind::of(&entity) == Some(EntityKind::Diamond);
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
            walker.stop();
            play(&mut mixer, audio::sfx::DAMAGE);
        }
        // The count: a coin and the score beside it, in the top-left corner.
        #[cfg(not(feature = "measure"))]
        {
            gfx::SPRITE_COIN.object(0, 8, 12, false).show(&mut frame);
            show_number(&mut frame, score, 14, 4);
        }
        #[cfg(feature = "measure")]
        {
            show_number(&mut frame, stopwatch.worst / 100, 4, 4);
            show_number(&mut frame, (stopwatch.total / stopwatch.frames.max(1) as u64 / 100) as u32, 4, 14);
        }
        // Mixing is the last work of the frame, just before the wait for the next one.
        mixer.frame();
        #[cfg(feature = "measure")]
        stopwatch.stop();
        frame.commit();
    }
}
