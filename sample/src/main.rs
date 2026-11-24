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
//! What entities do comes from the runtime's behaviour library, as their types list it
//! in the project, and `data::update_entities` runs them: this file only says what
//! their events mean. Coins and diamonds are collectibles: touching one takes it for
//! good and adds its value to the count in the corner. The sentry bot is a patrol and
//! a hazard: it walks back and forth around where it was placed, as far each way as
//! its `patrol` says, and touching it hurts like spikes do: the hero goes back to
//! where it entered the room. A new enemy or pickup that does these things is a new
//! entity type in the studio with a sprite and behaviours; nothing here changes.
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
    behaviour::{Abilities, Context, Dispatch, Event},
    data::{Collected, CollisionKind, SCREEN_H, SCREEN_W, World},
    debug::{self, GameState, Live},
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

/// The hero's box: the hitbox drawn in the studio, or a default.
fn hero_size() -> (i32, i32) {
    gfx::SPRITE_HERO.hitbox.map_or((10, 14), |(_, _, w, h)| (w as i32, h as i32))
}

/// Where a game starts, in world pixels: the player-start entity of the start room.
fn start(world: &World) -> (usize, Body) {
    let (w, h) = hero_size();
    // "Play from here" in the studio: a dev build starts in the room and spot it chose.
    if let Some(point) = debug::start_override() {
        let room = point.room as usize;
        if room < world.room_count() {
            let (left, top) = world.origin(room).unwrap_or((0, 0));
            return (room, Body::standing_at(left + point.x, top + point.y, w, h));
        }
    }
    let room = world.start().unwrap_or(0) as usize;
    let (left, top) = world.origin(room).unwrap_or((0, 0));
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
    let mut world = data::world();
    let mut physics = world.physics();

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
    // Every entity with its behaviours, built from the ROM when its room is first near
    // the hero and kept: the hero's room and those touching it are the active ones.
    let entities = data::entities();
    data::enter_room(entities, &world, room, |_| false);
    // Ticks since the game began: every placed entity animates off this one clock.
    let mut clock = 0u32;
    let mut top_down = physics.mode == PhysicsMode::TopDown;
    let mut platformer = PlatformerController::new();
    let mut walker = TopDownController::new();
    // What the studio's debug map shows of the game, copied out once a frame. Dev
    // builds only: in a release build `publish` does nothing.
    let mut shown = GameState::new();
    shown.collected(&found);
    // Level data the studio changes while the game runs (Live apply in the Play panel).
    let mut live = Live::new();
    #[cfg(feature = "measure")]
    let timers = gba.timers.timers();
    #[cfg(feature = "measure")]
    let mut stopwatch = Stopwatch::new(timers);

    loop {
        #[cfg(feature = "measure")]
        stopwatch.start();
        // The studio changed the level data in the ROM: read it again, keeping the
        // hero, the camera and the score. Its tables may have moved, so the old world
        // is not read again, even by the view.
        if let Some(changes) = live.poll() {
            world = data::world();
            physics = world.physics();
            top_down = physics.mode == PhysicsMode::TopDown;
            let (x, y) = focus(&body);
            room = world.room_at(x, y).unwrap_or(room.min(world.room_count().saturating_sub(1)));
            if changes.rooms() {
                view = WorldView::new(&world, gfx::ART, room, &mut graphics);
                view.load(camera.0, camera.1);
            } else if changes.tiles() {
                view.redraw(&world, camera.0, camera.1);
            } else {
                view.set_world(&world);
            }
            // Entities may have moved, or be new: build them again, except those taken.
            entities.clear();
            data::enter_room(entities, &world, room, |index| found.has(index));
        }
        // A change to the hero made in the Play panel's entity list, before it moves.
        debug::apply_player_edit(&mut body);
        input.update();
        let direction = input.x_tri() as i32;
        let before = body;
        if top_down {
            let vertical = input.is_pressed(Button::Down) as i32 - input.is_pressed(Button::Up) as i32;
            walker.update(&mut body, &world.enclosed(), &physics.top_down, direction, vertical);
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
                data::enter_room(entities, &world, room, |index| found.has(index));
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

        // Select dims the scene over 12 frames and lets it back up: what a dialogue or a
        // pause menu would do, so the hero and the HUD stand out.
        view.fade_dim(if input.is_pressed(Button::Select) { 12 } else { 6 }, 12);
        let mut frame = graphics.frame();
        view.show(&mut frame);
        let (feet_x, feet_y) = body.feet();
        hero.object(animation.frame(), feet_x - camera.0, feet_y - camera.1, faces_left).show(&mut frame);
        // The behaviours of the entities in view: a collectible is taken for good when
        // the hero touches it, and a hazard hurts the hero it touches. The player start only
        // marks where the game begins, so it leaves the table on the first frame.
        let mut hurt = false;
        let (held, pressed) = pecten_studio_rt::gfx::buttons(&input);
        let cx = Context { player: &body, clock, held, pressed, abilities: Abilities::NONE };
        data::update_entities(
            entities,
            &world,
            &cx,
            camera,
            |kind, entity| {
                if kind == EntityKind::PlayerStart {
                    entity.actor.alive = false;
                    Dispatch::Handled
                } else {
                    Dispatch::Behaviours
                }
            },
            |kind, entity, event| match event {
                Event::Collect { value } if found.take(entity.index as usize) => {
                    score = score.saturating_add(value.max(0) as u32);
                    play(&mut mixer, if kind == EntityKind::Diamond { audio::sfx::DIAMOND } else { audio::sfx::COIN });
                }
                Event::Hurt => hurt = true,
                _ => {}
            },
        );
        // Every entity whose type has a sprite, in the rooms in view, playing its
        // sprite's first animation.
        // They come room by room: whether the view shows a room is asked once per room.
        let mut shown_room = (u16::MAX, false);
        for entity in entities.visible(data::view(camera)) {
            if entity.room != shown_room.0 {
                shown_room = (entity.room, view.shows(entity.room as usize));
            }
            let Some(sheet) = gfx::ENTITY_SPRITES[entity.kind as usize].filter(|_| shown_room.1) else { continue };
            let (x, y) = (entity.actor.x - camera.0, entity.actor.y - camera.1);
            if !(-64..SCREEN_W + 64).contains(&x) || !(-64..SCREEN_H + 64).contains(&y) {
                continue;
            }
            let shown = sheet.animations.first().map_or(0, |animation| animation.frame_at(clock));
            sheet.object(shown, x, y, entity.actor.faces_left).show(&mut frame);
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
        shown.frame = clock;
        shown.room = room as u32;
        (shown.camera_x, shown.camera_y) = camera;
        shown.player = body;
        debug::publish(&shown);
        // Mixing is the last work of the frame, just before the wait for the next one.
        mixer.frame();
        #[cfg(feature = "measure")]
        stopwatch.stop();
        frame.commit();
    }
}
