//! A Metroidvania skeleton made of a GBA-Studio project: walk and jump through the
//! rooms painted in the studio, crossing from one to the next where they touch on the
//! world map. Everything on screen comes from `studio/` and `assets/`; this file is
//! the rules.
//!
//! D-pad moves, A jumps (hold for a higher jump), Down drops through platforms.
#![no_std]
#![no_main]

use agb::input::{Button, ButtonController};
use gba_studio_rt::{
    data::{CollisionKind, SCREEN_H, SCREEN_W},
    gfx::{AnimPlayer, RoomView},
    physics::{Body, SUB},
};

gba_studio_rt::include_data!();
gba_studio_rt::include_gfx!();

use data::{EntityKind, WORLD};

const RUN: i32 = SUB * 3 / 2;
const GRAVITY: i32 = 48;
const MAX_FALL: i32 = 4 * SUB;
const JUMP: i32 = 1100;
/// Letting go of A caps the rise at this speed, for short hops.
const JUMP_CUT: i32 = 400;

/// The hero's box: the hitbox drawn in the studio, or a default.
fn hero_size() -> (i32, i32) {
    gfx::SPRITE_HERO.hitbox.map_or((10, 14), |(_, _, w, h)| (w as i32, h as i32))
}

/// Where a game starts: the player-start entity of a room, or the room's top-left.
fn start_in(room: usize) -> Body {
    let (w, h) = hero_size();
    let start = WORLD.rooms[room].entities.iter().find(|e| EntityKind::of(e) == Some(EntityKind::PlayerStart));
    let (x, y) = start.map_or((24, 24), |e| (e.x as i32, e.y as i32));
    Body::standing_at(x, y, w, h)
}

/// The camera's top-left corner: the hero in the middle, kept inside the room.
fn camera(room: usize, body: &Body) -> (i32, i32) {
    let room = &WORLD.rooms[room];
    let (x, y) = body.feet();
    (
        (x - SCREEN_W / 2).clamp(0, (room.width() - SCREEN_W).max(0)),
        (y - body.h / 2 - SCREEN_H / 2).clamp(0, (room.height() - SCREEN_H).max(0)),
    )
}

#[agb::entry]
fn main(mut gba: agb::Gba) -> ! {
    let mut graphics = gba.graphics.get();
    let mut input = ButtonController::new();
    let hero = &gfx::SPRITE_HERO;
    let idle = hero.animation("idle").unwrap_or(&hero.animations[0]);
    let run = hero.animation("run").unwrap_or(idle);
    let jump = hero.animation("jump").unwrap_or(idle);

    let mut room = WORLD.start.unwrap_or(0) as usize;
    let mut body = start_in(room);
    // Where the hero comes back to after touching a hazard: where it entered the room.
    let mut entry = body;
    let mut view = RoomView::new(&gfx::ROOMS[room], &mut graphics);
    let (x, y) = camera(room, &body);
    view.load(x, y);
    let mut animation = AnimPlayer::new(idle);
    let mut faces_left = false;

    loop {
        input.update();
        let direction = input.x_tri() as i32;
        if direction != 0 {
            faces_left = direction < 0;
        }
        body.vx = direction * RUN;
        if body.on_ground && input.is_just_pressed(Button::A) {
            body.vy = -JUMP;
        }
        if !input.is_pressed(Button::A) && body.vy < -JUMP_CUT {
            body.vy = -JUMP_CUT;
        }
        body.vy = (body.vy + GRAVITY).min(MAX_FALL);
        body.step(&WORLD, &WORLD.rooms[room], input.is_pressed(Button::Down));

        // Past the room's edge: on into the room that touches it there, if any.
        let here = &WORLD.rooms[room];
        let (x, y) = (body.x + body.w / 2, body.y + body.h / 2);
        if x < 0 || y < 0 || x >= here.width() || y >= here.height() {
            match WORLD.cross(room, x, y) {
                Some((next, next_x, next_y)) => {
                    room = next;
                    body.x += next_x - x;
                    body.y += next_y - y;
                    entry = body;
                    view = RoomView::new(&gfx::ROOMS[room], &mut graphics);
                    let (x, y) = camera(room, &body);
                    view.load(x, y);
                }
                // The edge of the map: a wall at the sides and above, a pit below.
                None if y >= here.height() => body = entry,
                None => {
                    body.x = body.x.clamp(-body.w / 2, here.width() - body.w / 2 - 1);
                    body.y = body.y.max(-body.h / 2);
                }
            }
        }
        if body.touches(&WORLD, &WORLD.rooms[room], CollisionKind::Hazard) {
            body = entry;
        }

        animation.play(if !body.on_ground {
            jump
        } else if direction != 0 {
            run
        } else {
            idle
        });
        animation.tick();

        let (camera_x, camera_y) = camera(room, &body);
        view.set_camera(camera_x, camera_y);
        let mut frame = graphics.frame();
        view.show(&mut frame);
        let (feet_x, feet_y) = body.feet();
        hero.object(animation.frame(), feet_x - camera_x, feet_y - camera_y, faces_left).show(&mut frame);
        // Every other entity whose type has a sprite stands where it was placed.
        for entity in WORLD.rooms[room].entities {
            if EntityKind::of(entity) == Some(EntityKind::PlayerStart) {
                continue;
            }
            let (x, y) = (entity.x as i32 - camera_x, entity.y as i32 - camera_y);
            if let Some(sheet) = gfx::ENTITY_SPRITES[entity.kind as usize]
                && x > -64
                && y > -64
                && x < SCREEN_W + 64
                && y < SCREEN_H + 64
            {
                sheet.object(0, x, y, false).show(&mut frame);
            }
        }
        frame.commit();
    }
}
