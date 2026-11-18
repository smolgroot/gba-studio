//! A box that moves through collision cells: walls, floors, one-way platforms and
//! slopes. It moves in whatever [`Cells`] it is given: one room's, or the whole world's
//! so that it walks from a room into the next without noticing. Enough for a platformer's player or a walking enemy; a game
//! with other needs reads [`Room::class_index`] and writes its own.
//!
//! [`PlatformerController`] and [`TopDownController`] turn buttons into movement with the
//! numbers set in the studio's Physics tab, which a game gets as `data::PHYSICS`.
//! `core/src/physics.ts` is the same logic for the tab's preview: change them together.

use crate::data::{Cells, CollisionKind, TILE};

/// Velocities are in 1/256 of a pixel per frame.
pub const SUB: i32 = 256;
/// How far a grounded body follows the floor up or down in one step, to stay on slopes.
const SNAP: i32 = TILE;

/// Side-on movement. Speeds are in 1/256 pixel per frame, accelerations in 1/256 pixel
/// per frame per frame; an acceleration of 0 is instant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

impl PlatformerPhysics {
    pub const DEFAULT: Self = Self {
        gravity: 48,
        fall_gravity: 48,
        max_fall_speed: 4 * SUB,
        run_speed: SUB * 3 / 2,
        ground_acceleration: 0,
        ground_friction: 0,
        air_acceleration: 0,
        jump_speed: 1100,
        jump_cut: 400,
        air_jumps: 0,
        coyote_frames: 0,
        jump_buffer_frames: 0,
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Movement {
    /// Moves by the pixel, in any direction allowed.
    Free,
    /// Moves one grid step at a time and always finishes it.
    Grid,
}

/// Movement seen from above, in the units of [`PlatformerPhysics`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TopDownPhysics {
    pub movement: Movement,
    pub speed: i32,
    pub acceleration: i32,
    pub friction: i32,
    /// 4 or 8. Grid movement always uses 4.
    pub directions: u8,
    pub normalize_diagonal: bool,
    pub corner_slide: i32,
    pub grid_size: i32,
}

impl TopDownPhysics {
    pub const DEFAULT: Self =
        Self { movement: Movement::Free, speed: SUB, acceleration: 0, friction: 0, directions: 8, normalize_diagonal: true, corner_slide: 4, grid_size: 16 };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PhysicsMode {
    Platformer,
    TopDown,
}

/// What the studio's Physics tab holds. The project's own is `data::PHYSICS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Physics {
    pub mode: PhysicsMode,
    pub platformer: PlatformerPhysics,
    pub top_down: TopDownPhysics,
}

/// Moves a speed toward a target by at most `rate`; a rate of 0 gets there at once.
const fn approach(value: i32, target: i32, rate: i32) -> i32 {
    if rate <= 0 {
        target
    } else if value < target {
        if value + rate < target { value + rate } else { target }
    } else if value - rate > target {
        value - rate
    } else {
        target
    }
}

/// This frame's buttons for a [`PlatformerController`].
#[derive(Clone, Copy, Debug, Default)]
pub struct PlatformerInput {
    /// -1 left, 0 neither, 1 right.
    pub direction: i32,
    pub jump_pressed: bool,
    pub jump_held: bool,
}

/// Running and jumping. What it remembers between frames is here, the numbers are not.
#[derive(Clone, Copy, Debug, Default)]
pub struct PlatformerController {
    coyote: u8,
    buffer: u8,
    air_jumps: u8,
}

impl PlatformerController {
    pub const fn new() -> Self {
        Self { coyote: 0, buffer: 0, air_jumps: 0 }
    }

    /// Sets the body's velocity for this frame, before [`Body::step`]. Returns whether it jumped.
    pub fn update(&mut self, body: &mut Body, physics: &PlatformerPhysics, input: PlatformerInput) -> bool {
        let rate = if !body.on_ground {
            physics.air_acceleration
        } else if input.direction != 0 {
            physics.ground_acceleration
        } else {
            physics.ground_friction
        };
        body.vx = approach(body.vx, input.direction * physics.run_speed, rate);

        if body.on_ground {
            self.coyote = physics.coyote_frames;
            self.air_jumps = physics.air_jumps;
        }
        if input.jump_pressed {
            self.buffer = physics.jump_buffer_frames.saturating_add(1);
        }
        let mut jumped = false;
        if self.buffer > 0 {
            if body.on_ground || self.coyote > 0 {
                jumped = true;
                self.coyote = 0;
            } else if self.air_jumps > 0 {
                jumped = true;
                self.air_jumps -= 1;
            }
        }
        if jumped {
            body.vy = -physics.jump_speed;
            self.buffer = 0;
        }
        self.buffer = self.buffer.saturating_sub(1);
        if !body.on_ground {
            self.coyote = self.coyote.saturating_sub(1);
        }

        if !input.jump_held && body.vy < -physics.jump_cut {
            body.vy = -physics.jump_cut;
        }
        let gravity = if body.vy >= 0 { physics.fall_gravity } else { physics.gravity };
        body.vy = (body.vy + gravity).min(physics.max_fall_speed);
        jumped
    }
}

/// Walking seen from above, freely or one grid step at a time.
#[derive(Clone, Copy, Debug, Default)]
pub struct TopDownController {
    held: (i32, i32),
    horizontal: bool,
    step: (i32, i32),
    left: i32,
    sub: i32,
}

impl TopDownController {
    pub const fn new() -> Self {
        Self { held: (0, 0), horizontal: false, step: (0, 0), left: 0, sub: 0 }
    }

    /// Forgets a grid step under way, for when the body is put somewhere else.
    pub const fn stop(&mut self) {
        self.left = 0;
        self.sub = 0;
    }

    /// The body as it will be when its grid step ends: a safe place to come back to.
    pub const fn settled(&self, mut body: Body) -> Body {
        body.x += self.step.0 * self.left;
        body.y += self.step.1 * self.left;
        body
    }

    /// With both axes held, the one pressed last wins.
    fn one_axis(&mut self, dx: i32, dy: i32) -> (i32, i32) {
        if dx != 0 && dy != 0 {
            if self.held.0 == 0 {
                self.horizontal = true;
            } else if self.held.1 == 0 {
                self.horizontal = false;
            }
        } else {
            self.horizontal = dx != 0;
        }
        self.held = (dx, dy);
        match (dx != 0 && dy != 0, self.horizontal) {
            (false, _) => (dx, dy),
            (true, true) => (dx, 0),
            (true, false) => (0, dy),
        }
    }

    /// Moves the body for this frame. `dx` and `dy` are -1, 0 or 1; down is positive.
    pub fn update(&mut self, body: &mut Body, cells: &impl Cells, physics: &TopDownPhysics, dx: i32, dy: i32) {
        let (dx, dy) = (dx.signum(), dy.signum());
        let single = self.one_axis(dx, dy);
        if physics.movement == Movement::Grid {
            self.update_grid(body, cells, physics, single);
            return;
        }
        let (mx, my) = if physics.directions == 4 { single } else { (dx, dy) };
        let speed = if mx != 0 && my != 0 && physics.normalize_diagonal { physics.speed * 181 / SUB } else { physics.speed };
        body.vx = approach(body.vx, mx * speed, if mx != 0 { physics.acceleration } else { physics.friction });
        body.vy = approach(body.vy, my * speed, if my != 0 { physics.acceleration } else { physics.friction });
        body.step_top_down(cells, physics.corner_slide);
    }

    fn update_grid(&mut self, body: &mut Body, cells: &impl Cells, physics: &TopDownPhysics, (mx, my): (i32, i32)) {
        body.hit_wall = false;
        body.hit_ceiling = false;
        body.on_ground = false;
        if self.left == 0 {
            if (mx, my) == (0, 0) {
                self.sub = 0;
            } else if (1..=physics.grid_size).all(|n| !body.blocked_at(cells, body.x + mx * n, body.y + my * n)) {
                self.step = (mx, my);
                self.left = physics.grid_size;
            } else {
                body.hit_wall = true;
                self.sub = 0;
            }
        }
        if self.left == 0 {
            body.vx = 0;
            body.vy = 0;
            return;
        }
        self.sub += physics.speed;
        let pixels = (self.sub / SUB).min(self.left);
        self.sub -= pixels * SUB;
        self.left -= pixels;
        body.x += self.step.0 * pixels;
        body.y += self.step.1 * pixels;
        body.vx = self.step.0 * physics.speed;
        body.vy = self.step.1 * physics.speed;
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Body {
    /// Top-left corner in the room's pixels.
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub vx: i32,
    pub vy: i32,
    sub_x: i32,
    sub_y: i32,
    /// Standing on something after the last [`Body::step`].
    pub on_ground: bool,
    pub hit_wall: bool,
    pub hit_ceiling: bool,
}

impl Body {
    pub const fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Self { x, y, w, h, vx: 0, vy: 0, sub_x: 0, sub_y: 0, on_ground: false, hit_wall: false, hit_ceiling: false }
    }

    /// A body standing with its feet (the middle of its bottom edge) at a point, as entities are placed.
    pub const fn standing_at(feet_x: i32, feet_y: i32, w: i32, h: i32) -> Self {
        Self::new(feet_x - w / 2, feet_y - h, w, h)
    }

    /// The feet: the middle of the bottom edge.
    pub const fn feet(&self) -> (i32, i32) {
        (self.x + self.w / 2, self.y + self.h)
    }

    /// Whether the body overlaps a box given by its top-left corner and size, in the
    /// same pixels as the body: a pickup, an enemy, a trigger.
    pub const fn overlaps(&self, x: i32, y: i32, w: i32, h: i32) -> bool {
        self.x < x + w && x < self.x + self.w && self.y < y + h && y < self.y + self.h
    }

    /// Whether any cell the body overlaps is of this kind.
    pub fn touches(&self, cells: &impl Cells, kind: CollisionKind) -> bool {
        let mut row = self.y.div_euclid(TILE);
        while row <= (self.y + self.h - 1).div_euclid(TILE) {
            let mut col = self.x.div_euclid(TILE);
            while col <= (self.x + self.w - 1).div_euclid(TILE) {
                if cells.class(col, row).kind == kind {
                    return true;
                }
                col += 1;
            }
            row += 1;
        }
        false
    }

    /// Moves by the velocity for one frame. `drop_through` lets it fall through one-way platforms.
    pub fn step(&mut self, cells: &impl Cells, drop_through: bool) {
        self.hit_wall = false;
        self.hit_ceiling = false;
        let was_grounded = self.on_ground;
        let on_slope = was_grounded && self.slope_under(cells);

        self.sub_x += self.vx;
        let dx = self.sub_x / SUB;
        self.sub_x -= dx * SUB;
        for _ in 0..dx.abs() {
            let next = self.x + dx.signum();
            if self.wall_at(cells, next, on_slope) {
                self.hit_wall = true;
                self.sub_x = 0;
                break;
            }
            self.x = next;
            // Keep the feet on the floor while walking, so slopes are followed both ways.
            if was_grounded && self.vy >= 0 {
                self.follow_floor(cells, on_slope);
            }
        }

        self.sub_y += self.vy;
        let dy = self.sub_y / SUB;
        self.sub_y -= dy * SUB;
        for _ in 0..dy.abs() {
            if dy > 0 {
                if self.floor_under(cells, drop_through) {
                    break;
                }
                self.y += 1;
            } else {
                if self.ceiling_over(cells) {
                    self.hit_ceiling = true;
                    self.vy = 0;
                    self.sub_y = 0;
                    break;
                }
                self.y -= 1;
            }
        }
        self.on_ground = self.vy >= 0 && self.floor_under(cells, drop_through);
        if self.on_ground {
            self.vy = 0;
            self.sub_y = 0;
        }
    }

    /// Moves by the velocity for one frame as seen from above: only solid cells stop it,
    /// on either axis. `corner_slide` is how many pixels it is nudged around a corner it
    /// clips while moving straight.
    pub fn step_top_down(&mut self, cells: &impl Cells, corner_slide: i32) {
        self.hit_wall = false;
        self.hit_ceiling = false;
        self.on_ground = false;

        self.sub_x += self.vx;
        let dx = self.sub_x / SUB;
        self.sub_x -= dx * SUB;
        for _ in 0..dx.abs() {
            if self.blocked_at(cells, self.x + dx.signum(), self.y) {
                self.hit_wall = true;
                self.sub_x = 0;
                if self.vy == 0 {
                    self.slide_around(cells, dx.signum(), 0, corner_slide);
                }
                break;
            }
            self.x += dx.signum();
        }

        self.sub_y += self.vy;
        let dy = self.sub_y / SUB;
        self.sub_y -= dy * SUB;
        for _ in 0..dy.abs() {
            if self.blocked_at(cells, self.x, self.y + dy.signum()) {
                self.hit_wall = true;
                self.sub_y = 0;
                if self.vx == 0 {
                    self.slide_around(cells, 0, dy.signum(), corner_slide);
                }
                break;
            }
            self.y += dy.signum();
        }
    }

    /// Whether a solid cell overlaps the body with its top-left corner at a point.
    fn blocked_at(&self, cells: &impl Cells, x: i32, y: i32) -> bool {
        let mut row = y.div_euclid(TILE);
        while row <= (y + self.h - 1).div_euclid(TILE) {
            let mut col = x.div_euclid(TILE);
            while col <= (x + self.w - 1).div_euclid(TILE) {
                if cells.class(col, row).kind == CollisionKind::Solid {
                    return true;
                }
                col += 1;
            }
            row += 1;
        }
        false
    }

    /// Stopped while moving by `(dx, dy)`: takes one pixel sideways toward the nearest
    /// opening within `reach`, if the way there is clear.
    fn slide_around(&mut self, cells: &impl Cells, dx: i32, dy: i32, reach: i32) {
        let (across_x, across_y) = (dy.abs(), dx.abs());
        let mut open = [true, true];
        for distance in 1..=reach {
            for (index, side) in [-1, 1].into_iter().enumerate() {
                let (x, y) = (self.x + across_x * side * distance, self.y + across_y * side * distance);
                open[index] = open[index] && !self.blocked_at(cells, x, y);
                if open[index] && !self.blocked_at(cells, x + dx, y + dy) {
                    self.x += across_x * side;
                    self.y += across_y * side;
                    return;
                }
            }
        }
    }

    fn slope_under(&self, cells: &impl Cells) -> bool {
        let (cx, feet) = self.feet();
        cells.class_at(cx, feet).kind == CollisionKind::Slope || cells.class_at(cx, feet - 1).kind == CollisionKind::Slope
    }

    /// Whether solid cells stand where the body would be with its left edge at `x`.
    /// On a slope the feet are inside a row of tiles, whose solid neighbours are the
    /// ground the slope leads onto and not a wall.
    fn wall_at(&self, cells: &impl Cells, x: i32, on_slope: bool) -> bool {
        let feet = self.y + self.h;
        let mut bottom = (feet - 1).div_euclid(TILE);
        if on_slope && feet.rem_euclid(TILE) != 0 {
            bottom -= 1;
        }
        let col = if x > self.x { x + self.w - 1 } else { x }.div_euclid(TILE);
        let mut row = self.y.div_euclid(TILE);
        while row <= bottom {
            if cells.class(col, row).kind == CollisionKind::Solid {
                return true;
            }
            row += 1;
        }
        false
    }

    /// Whether pixel `(x, y)` is floor seen from above.
    fn is_floor(cells: &impl Cells, x: i32, y: i32, one_way: bool) -> bool {
        let class = cells.class_at(x, y);
        match class.kind {
            CollisionKind::Solid => true,
            CollisionKind::OneWay => one_way && y.rem_euclid(TILE) == 0,
            CollisionKind::Slope => TILE - y.rem_euclid(TILE) <= class.floor_height(x.rem_euclid(TILE)),
            _ => false,
        }
    }

    /// Whether the body stands on something: the row of pixels just under its feet.
    fn floor_under(&self, cells: &impl Cells, drop_through: bool) -> bool {
        let (cx, feet) = self.feet();
        // A slope carries the body by its middle.
        let middle = cells.class_at(cx, feet);
        if middle.kind == CollisionKind::Slope {
            return Self::is_floor(cells, cx, feet, false);
        }
        // Flat ground carries it by any part of its bottom edge, and only from the top
        // of a tile: walls keep a body from being inside one any other way.
        if feet.rem_euclid(TILE) != 0 {
            return false;
        }
        let row = feet.div_euclid(TILE);
        let mut col = self.x.div_euclid(TILE);
        while col <= (self.x + self.w - 1).div_euclid(TILE) {
            match cells.class(col, row).kind {
                CollisionKind::Solid => return true,
                CollisionKind::OneWay if !drop_through => return true,
                _ => {}
            }
            col += 1;
        }
        false
    }

    fn ceiling_over(&self, cells: &impl Cells) -> bool {
        let row = (self.y - 1).div_euclid(TILE);
        let mut col = self.x.div_euclid(TILE);
        while col <= (self.x + self.w - 1).div_euclid(TILE) {
            if cells.class(col, row).kind == CollisionKind::Solid {
                return true;
            }
            col += 1;
        }
        false
    }

    /// After a sideways step on the ground: puts the feet back on the floor under the
    /// body's middle if a slope moved it, up or down.
    fn follow_floor(&mut self, cells: &impl Cells, on_slope: bool) {
        let (cx, feet) = self.feet();
        let mut y = feet - SNAP;
        while y <= feet + SNAP {
            if Self::is_floor(cells, cx, y, y >= feet) && !Self::is_floor(cells, cx, y - 1, false) {
                let onto_slope = cells.class_at(cx, y).kind == CollisionKind::Slope;
                // Ledges are fallen off and steps are walls: only slopes are followed.
                if y != feet && (on_slope || onto_slope) {
                    self.y = y - self.h;
                }
                return;
            }
            y += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use crate::data::{CollisionClass, Room, World};
    use std::{boxed::Box, vec::Vec};

    static CLASSES: [CollisionClass; 5] = [
        CollisionClass { id: "empty", kind: CollisionKind::Empty, slope: (0, 0) },
        CollisionClass { id: "solid", kind: CollisionKind::Solid, slope: (0, 0) },
        CollisionClass { id: "oneway", kind: CollisionKind::OneWay, slope: (0, 0) },
        CollisionClass { id: "up", kind: CollisionKind::Slope, slope: (0, 8) },
        CollisionClass { id: "down", kind: CollisionKind::Slope, slope: (8, 0) },
    ];

    /// A world of one room drawn in text: `#` solid, `=` one-way, `/` and `\` slopes.
    fn world(map: &[&str]) -> World {
        let cells: Vec<u8> = map
            .iter()
            .flat_map(|row| row.bytes())
            .map(|c| match c {
                b'#' => 1,
                b'=' => 2,
                b'/' => 3,
                b'\\' => 4,
                _ => 0,
            })
            .collect();
        let room = Room {
            id: "test",
            name: "Test",
            cols: map[0].len() as u16,
            rows: map.len() as u16,
            collision: Box::leak(cells.into_boxed_slice()),
            entities: &[],
            world: Some((0, 0)),
            music: None,
        };
        World { rooms: Box::leak(Box::new([room])), classes: &CLASSES, start: Some(0) }
    }

    fn run(world: &World, body: &mut Body, frames: usize, vx: i32) {
        for _ in 0..frames {
            body.vx = vx;
            body.vy = (body.vy + 40).min(4 * SUB);
            body.step(&world.room_cells(0), false);
        }
    }

    /// Jumps from a flat floor; returns the height reached and the frames in the air.
    fn jump_arc(physics: &PlatformerPhysics, held_frames: u32) -> (i32, u32) {
        let w = world(&[".."; 400]);
        let floor = FlatFloor(&w, 300);
        let mut body = Body::standing_at(8, 2400, 8, 8);
        body.on_ground = true;
        let mut control = PlatformerController::new();
        let (mut highest, mut frames) = (0, 0);
        loop {
            let input = PlatformerInput { direction: 0, jump_pressed: frames == 0, jump_held: frames < held_frames };
            control.update(&mut body, physics, input);
            body.step(&floor, false);
            frames += 1;
            highest = highest.max(2400 - (body.y + body.h));
            if body.on_ground || frames > 5000 {
                return (highest, frames);
            }
        }
    }

    /// Solid from a row down, for arcs that need no walls.
    struct FlatFloor<'a>(&'a World, i32);
    impl Cells for FlatFloor<'_> {
        fn class(&self, _col: i32, row: i32) -> &CollisionClass {
            &self.0.classes[usize::from(row >= self.1)]
        }
    }

    // The same numbers are asserted of the preview's copy in core/test/physics.test.ts.
    #[test]
    fn default_jump_matches_the_preview() {
        assert_eq!(jump_arc(&PlatformerPhysics::DEFAULT, u32::MAX), (47, 45));
        assert_eq!(jump_arc(&PlatformerPhysics::DEFAULT, 1), (9, 20));
    }

    #[test]
    fn tuned_jump_matches_the_preview() {
        let physics = PlatformerPhysics { gravity: 30, fall_gravity: 70, max_fall_speed: 700, jump_speed: 900, ..PlatformerPhysics::DEFAULT };
        assert_eq!(jump_arc(&physics, u32::MAX), (50, 54));
    }

    #[test]
    fn acceleration_builds_up_and_zero_is_instant() {
        let mut body = Body::new(0, 0, 8, 8);
        body.on_ground = true;
        let physics = PlatformerPhysics { ground_acceleration: 100, ground_friction: 50, ..PlatformerPhysics::DEFAULT };
        let mut control = PlatformerController::new();
        let right = PlatformerInput { direction: 1, ..PlatformerInput::default() };
        control.update(&mut body, &physics, right);
        assert_eq!(body.vx, 100);
        for _ in 0..9 {
            control.update(&mut body, &physics, right);
            body.on_ground = true;
        }
        assert_eq!(body.vx, physics.run_speed);
        control.update(&mut body, &physics, PlatformerInput::default());
        assert_eq!(body.vx, physics.run_speed - 50);
        control.update(&mut body, &PlatformerPhysics::DEFAULT, PlatformerInput::default());
        assert_eq!(body.vx, 0);
    }

    #[test]
    fn coyote_time_buffer_and_air_jumps_allow_late_and_early_jumps() {
        let press = PlatformerInput { jump_pressed: true, jump_held: true, direction: 0 };
        let idle = PlatformerInput::default();

        // Coyote time: two frames after leaving the ground, and not three.
        let physics = PlatformerPhysics { coyote_frames: 2, ..PlatformerPhysics::DEFAULT };
        let mut control = PlatformerController::new();
        let mut body = Body::new(0, 0, 8, 8);
        body.on_ground = true;
        control.update(&mut body, &physics, idle);
        body.on_ground = false;
        control.update(&mut body, &physics, idle);
        assert!(control.update(&mut body, &physics, press));
        let mut control = PlatformerController::new();
        body.on_ground = true;
        control.update(&mut body, &physics, idle);
        body.on_ground = false;
        control.update(&mut body, &physics, idle);
        control.update(&mut body, &physics, idle);
        assert!(!control.update(&mut body, &physics, press));

        // Buffer: pressed in the air, it fires on landing within the window.
        let physics = PlatformerPhysics { jump_buffer_frames: 2, ..PlatformerPhysics::DEFAULT };
        let mut control = PlatformerController::new();
        body.on_ground = false;
        assert!(!control.update(&mut body, &physics, press));
        control.update(&mut body, &physics, idle);
        body.on_ground = true;
        assert!(control.update(&mut body, &physics, idle));

        // One air jump, then no more until landing.
        let physics = PlatformerPhysics { air_jumps: 1, ..PlatformerPhysics::DEFAULT };
        let mut control = PlatformerController::new();
        body.on_ground = true;
        control.update(&mut body, &physics, idle);
        body.on_ground = false;
        assert!(control.update(&mut body, &physics, press));
        assert!(!control.update(&mut body, &physics, press));
    }

    const ROOM: [&str; 6] = ["########", "#......#", "#..##..#", "#......#", "#......#", "########"];

    #[test]
    fn top_down_walks_on_both_axes_and_stops_at_walls() {
        let w = world(&ROOM);
        let cells = w.room_cells(0);
        let mut body = Body::new(10, 10, 6, 6);
        let mut control = TopDownController::new();
        for _ in 0..60 {
            control.update(&mut body, &cells, &TopDownPhysics { corner_slide: 0, ..TopDownPhysics::DEFAULT }, 0, 1);
        }
        assert_eq!(body.y + body.h, 40, "gravity plays no part: it walks to the wall");
        assert!(body.hit_wall);
        for _ in 0..60 {
            control.update(&mut body, &cells, &TopDownPhysics::DEFAULT, 1, 0);
        }
        assert_eq!(body.x + body.w, 56);
    }

    #[test]
    fn top_down_diagonals_are_no_faster_and_four_way_takes_the_newest_axis() {
        let w = world(&["................"; 16]);
        let cells = w.room_cells(0);
        let mut body = Body::new(8, 8, 6, 6);
        let mut control = TopDownController::new();
        control.update(&mut body, &cells, &TopDownPhysics::DEFAULT, 1, 1);
        assert_eq!((body.vx, body.vy), (181, 181));

        let physics = TopDownPhysics { directions: 4, ..TopDownPhysics::DEFAULT };
        let mut control = TopDownController::new();
        control.update(&mut body, &cells, &physics, 1, 0);
        assert_eq!((body.vx, body.vy), (SUB, 0));
        control.update(&mut body, &cells, &physics, 1, 1);
        assert_eq!((body.vx, body.vy), (0, SUB), "down was pressed last");
        control.update(&mut body, &cells, &physics, 1, 1);
        assert_eq!((body.vx, body.vy), (0, SUB), "and it stays that way");
    }

    #[test]
    fn top_down_slides_around_a_corner_it_clips() {
        let w = world(&["........", "...#....", "........", "........"]);
        let cells = w.room_cells(0);
        // Walking right, the top two pixels of the body catch the block's lower corner.
        let mut body = Body::new(10, 14, 6, 6);
        let mut control = TopDownController::new();
        for _ in 0..30 {
            control.update(&mut body, &cells, &TopDownPhysics::DEFAULT, 1, 0);
        }
        assert_eq!(body.y, 16, "nudged clear of the block");
        assert!(body.x > 32, "and on past it");
    }

    #[test]
    fn grid_movement_finishes_steps_and_refuses_blocked_ones() {
        let w = world(&["##########", "#........#", "#........#", "#...#....#", "#........#", "##########"]);
        let cells = w.room_cells(0);
        let physics = TopDownPhysics { movement: Movement::Grid, grid_size: 8, ..TopDownPhysics::DEFAULT };
        let mut body = Body::new(8, 24, 8, 8);
        let mut control = TopDownController::new();
        // A tap is a whole step.
        control.update(&mut body, &cells, &physics, 1, 0);
        for _ in 0..20 {
            control.update(&mut body, &cells, &physics, 0, 0);
        }
        assert_eq!((body.x, body.y), (16, 24));
        // Held, it stops on the last free cell before the block.
        for _ in 0..40 {
            control.update(&mut body, &cells, &physics, 1, 0);
            assert_eq!(body.y, 24);
        }
        assert_eq!(body.x, 24);
        assert!(body.hit_wall);
        assert_eq!((body.vx, body.vy), (0, 0));
    }

    #[test]
    fn a_grid_step_under_way_settles_on_its_end() {
        let w = world(&["........"; 4]);
        let cells = w.room_cells(0);
        let physics = TopDownPhysics { movement: Movement::Grid, ..TopDownPhysics::DEFAULT };
        let mut body = Body::new(0, 0, 8, 8);
        let mut control = TopDownController::new();
        control.update(&mut body, &cells, &physics, 1, 0);
        assert_eq!(body.x, 1);
        assert_eq!(control.settled(body).x, 16);
        control.stop();
        assert_eq!(control.settled(body).x, 1);
    }

    #[test]
    fn an_enclosed_world_is_solid_where_it_has_no_room() {
        let w = world(&["."; 20].map(|_| "..............................").as_slice());
        assert_eq!(w.enclosed().class(5, 5).kind, CollisionKind::Empty);
        assert_eq!(w.enclosed().class(-1, 5).kind, CollisionKind::Solid);
        assert_eq!(w.enclosed().class(30, 5).kind, CollisionKind::Solid);
    }

    #[test]
    fn overlapping_a_box_needs_shared_pixels() {
        let body = Body::new(10, 10, 8, 12);
        assert!(body.overlaps(17, 21, 4, 4));
        assert!(body.overlaps(12, 12, 2, 2));
        // Touching edges share no pixel.
        assert!(!body.overlaps(18, 10, 4, 4));
        assert!(!body.overlaps(10, 22, 4, 4));
        assert!(!body.overlaps(2, 10, 8, 8));
    }

    #[test]
    fn slope_heights_meet_without_a_step() {
        assert_eq!((0..8).map(|x| CLASSES[3].floor_height(x)).collect::<Vec<_>>(), [1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!((0..8).map(|x| CLASSES[4].floor_height(x)).collect::<Vec<_>>(), [8, 7, 6, 5, 4, 3, 2, 1]);
        let gentle = CollisionClass { id: "g", kind: CollisionKind::Slope, slope: (0, 4) };
        assert_eq!((0..8).map(|x| gentle.floor_height(x)).collect::<Vec<_>>(), [0, 1, 1, 2, 2, 3, 3, 4]);
    }

    #[test]
    fn falls_and_lands_on_the_floor() {
        let w = world(&["......", "......", "......", "######"]);
        let mut body = Body::new(8, 0, 10, 14);
        run(&w, &mut body, 60, 0);
        assert!(body.on_ground);
        assert_eq!(body.y + body.h, 24);
    }

    #[test]
    fn walls_stop_it() {
        let w = world(&["....#.", "....#.", "....#.", "######"]);
        let mut body = Body::standing_at(8, 24, 10, 14);
        run(&w, &mut body, 60, 2 * SUB);
        assert_eq!(body.x + body.w, 32);
        assert!(body.hit_wall);
        run(&w, &mut body, 20, -2 * SUB);
        assert!(body.x < 0, "the room's edge is open: only walls stop a body");
    }

    #[test]
    fn one_way_platforms_carry_from_above_only() {
        let w = world(&["......", "......", "..==..", "......", "......", "######"]);
        // Jumping up from under the platform passes through it and lands on it.
        let mut body = Body::standing_at(24, 40, 10, 14);
        body.on_ground = true;
        body.vy = -3 * SUB;
        run(&w, &mut body, 80, 0);
        assert!(body.on_ground);
        assert_eq!(body.y + body.h, 16);
        // Dropping through lets go of it.
        body.vy = SUB;
        body.step(&w.room_cells(0), true);
        run(&w, &mut body, 60, 0);
        assert_eq!(body.y + body.h, 40);
    }

    #[test]
    fn slopes_are_walked_up_and_down() {
        let w = world(&["..........", "..........", "..../##\\..", "##########"]);
        let mut body = Body::standing_at(8, 24, 10, 14);
        run(&w, &mut body, 5, 0);
        let mut highest = body.y + body.h;
        for _ in 0..64 {
            run(&w, &mut body, 1, SUB);
            assert!(body.on_ground, "left the ground at x {}", body.x);
            assert!(!body.hit_wall, "stopped by the slope at x {}", body.x);
            highest = highest.min(body.y + body.h);
        }
        assert_eq!(highest, 16, "reaches the top of the ramp");
        assert_eq!(body.y + body.h, 24, "and comes back down the other side");
        assert!(body.x > 64);
    }

    #[test]
    fn ledges_are_fallen_off_not_snapped_down() {
        let w = world(&["........", "###.....", "###.....", "########"]);
        let mut body = Body::standing_at(16, 8, 10, 14);
        run(&w, &mut body, 3, 0);
        assert!(body.on_ground);
        let mut airborne = false;
        for _ in 0..40 {
            run(&w, &mut body, 1, SUB);
            airborne |= !body.on_ground;
        }
        assert!(airborne, "it falls from the ledge");
        assert_eq!(body.y + body.h, 24);
    }

    #[test]
    fn ceilings_stop_a_jump() {
        let w = world(&["######", "......", "......", "......", "######"]);
        let mut body = Body::standing_at(16, 32, 10, 14);
        body.on_ground = true;
        body.vy = -4 * SUB;
        body.step(&w.room_cells(0), false);
        body.step(&w.room_cells(0), false);
        body.step(&w.room_cells(0), false);
        assert!(body.y >= 8);
        run(&w, &mut body, 60, 0);
        assert_eq!(body.y + body.h, 32);
    }

    #[test]
    fn walks_from_one_room_into_the_next_in_world_coordinates() {
        // Two one-screen rooms side by side, floor along the bottom row of both.
        let mut rows = [".............................."; 20];
        rows[19] = "##############################";
        let mut w = world(&rows);
        let mut rooms = w.rooms.to_vec();
        rooms.push(Room { world: Some((1, 0)), ..rooms[0] });
        w.rooms = Box::leak(rooms.into_boxed_slice());
        let mut body = Body::standing_at(200, 152, 10, 14);
        for _ in 0..80 {
            body.vx = SUB;
            body.vy = (body.vy + 40).min(4 * SUB);
            body.step(&w, false);
            assert!(body.on_ground, "lost the floor at x {}", body.x);
        }
        assert_eq!(w.room_at(body.feet().0, body.feet().1 - 1), Some(1));
        // Past the last room there is no floor.
        assert_eq!(w.class(70, 19).kind, CollisionKind::Empty);
    }

    #[test]
    fn the_camera_stays_on_rooms() {
        // A 2x1 room at (0,1) and a 1x2 room at (2,0), as in the sample.
        let wide: [&str; 20] = ["............................................................"; 20];
        let mut w = world(&wide);
        let mut rooms = w.rooms.to_vec();
        rooms[0].world = Some((0, 1));
        rooms.push(Room { cols: 30, rows: 40, world: Some((2, 0)), ..rooms[0] });
        w.rooms = Box::leak(rooms.into_boxed_slice());
        let all = |_: usize| true;
        // In the wide room the camera cannot rise into the empty screens above it.
        assert_eq!(w.camera_target(0, 100, 200, all), (0, 160));
        // Nearing its right end it scrolls on into the tall room beside it.
        assert_eq!(w.camera_target(0, 470, 240, all), (350, 160));
        // High in the tall room, the screens to its left are empty: it stays on the room.
        assert_eq!(w.camera_target(1, 500, 60, all), (480, 0));
        // A neighbour that cannot be shown together (another tileset) is a hard edge.
        assert_eq!(w.camera_target(0, 470, 240, |_| false), (240, 160));
    }

    #[test]
    fn rooms_connect_on_the_world_grid() {
        let mut w = world(&["."; 20].map(|_| "..............................").as_slice());
        let mut rooms = w.rooms.to_vec();
        rooms.push(Room { world: Some((1, 0)), ..rooms[0] });
        rooms.push(Room { world: None, ..rooms[0] });
        w.rooms = Box::leak(rooms.into_boxed_slice());
        assert_eq!(w.cross(0, 245, 50), Some((1, 5, 50)));
        assert_eq!(w.cross(1, -3, 50), Some((0, 237, 50)));
        assert_eq!(w.cross(0, -3, 50), None);
        assert_eq!(w.cross(0, 100, 50), None, "still inside the room");
        assert_eq!(w.cross(2, 245, 50), None, "a room off the map leads nowhere");
    }
}
