//! A Metroidvania skeleton made of a GBA-Studio project: walk and jump through the
//! rooms painted in the studio. The rooms on the world map are one continuous space:
//! the hero walks from a room into the one touching it and the camera scrolls along,
//! with the next room's tiles loaded just ahead of it. Everything on screen comes from
//! `studio/` and `assets/`; this file is the rules.
//!
//! D-pad moves, A jumps (hold for a higher jump), Down drops through platforms.
#![no_std]
#![no_main]

use agb::input::{Button, ButtonController};
use gba_studio_rt::{
    data::{CollisionKind, SCREEN_H, SCREEN_W},
    gfx::{AnimPlayer, WorldView},
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
/// The most the camera moves in a frame when the area it may show changes, so it
/// glides to its new place. Following the hero never needs this much.
const CAMERA_SPEED: i32 = 6;

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
                }
            }
            Some(_) => {}
            // Off the map: its sides and top are walls, and below it is a pit.
            None if WORLD.room_at(x, before.y + before.h / 2).is_none() && body.y > before.y => body = entry,
            None => {
                body.x = before.x;
                body.y = body.y.max(before.y);
            }
        }
        if body.touches(&WORLD, CollisionKind::Hazard) {
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
        // every room that is in view.
        for (index, other) in WORLD.rooms.iter().enumerate() {
            let Some((left, top)) = WORLD.origin(index).filter(|_| view.shows(index)) else { continue };
            if left >= camera.0 + SCREEN_W || top >= camera.1 + SCREEN_H || left + other.width() <= camera.0 || top + other.height() <= camera.1 {
                continue;
            }
            for entity in other.entities {
                if EntityKind::of(entity) == Some(EntityKind::PlayerStart) {
                    continue;
                }
                let (x, y) = (left + entity.x as i32 - camera.0, top + entity.y as i32 - camera.1);
                if let Some(sheet) = gfx::ENTITY_SPRITES[entity.kind as usize]
                    && (-64..SCREEN_W + 64).contains(&x)
                    && (-64..SCREEN_H + 64).contains(&y)
                {
                    sheet.object(0, x, y, false).show(&mut frame);
                }
            }
        }
        frame.commit();
    }
}
