//! A box that moves through collision cells: walls, floors, one-way platforms and
//! slopes. It moves in whatever [`Cells`] it is given: one room's, or the whole world's
//! so that it walks from a room into the next without noticing. Enough for a platformer's player or a walking enemy; a game
//! with other needs reads [`Room::class_index`] and writes its own.

use crate::data::{Cells, CollisionKind, TILE};

/// Velocities are in 1/256 of a pixel per frame.
pub const SUB: i32 = 256;
/// How far a grounded body follows the floor up or down in one step, to stay on slopes.
const SNAP: i32 = TILE;

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
