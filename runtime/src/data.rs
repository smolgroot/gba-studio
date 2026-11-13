//! What a studio project is at run time: rooms of collision cells and entities, placed
//! on a world grid of screens.

/// Side of a background tile in pixels.
pub const TILE: i32 = 8;
pub const SCREEN_W: i32 = 240;
pub const SCREEN_H: i32 = 160;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CollisionKind {
    Empty,
    Solid,
    /// Solid from above only.
    OneWay,
    /// A floor that crosses the tile; see [`CollisionClass::floor_height`].
    Slope,
    Hazard,
    /// Means what the game says it means.
    Custom,
}

#[derive(Clone, Copy, Debug)]
pub struct CollisionClass {
    pub id: &'static str,
    pub kind: CollisionKind,
    /// For a slope: the floor's height over the tile's bottom edge at its left and right side, 0 to 8.
    pub slope: (u8, u8),
}

impl CollisionClass {
    /// How high a slope's floor is over the tile's bottom edge at pixel column `x` (0 to 7).
    /// A 45 degree rise gives 1 to 8, so neighbouring tiles of a ramp meet without a step.
    pub const fn floor_height(&self, x: i32) -> i32 {
        let (left, right) = (self.slope.0 as i32, self.slope.1 as i32);
        left + ((right - left) * (2 * x + 1) + 8).div_euclid(16)
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Prop {
    Int(i32),
    Bool(bool),
    Str(&'static str),
}

#[derive(Clone, Copy, Debug)]
pub struct Entity {
    /// Index of its entity type in the project; the generated `EntityKind` names them.
    pub kind: u16,
    /// Position in pixels from the room's top-left: by convention the feet, the middle
    /// of the bottom edge.
    pub x: i16,
    pub y: i16,
    /// Every property its type defines, with defaults filled in.
    pub props: &'static [(&'static str, Prop)],
}

impl Entity {
    pub fn prop(&self, name: &str) -> Option<Prop> {
        self.props.iter().find(|(n, _)| *n == name).map(|(_, value)| *value)
    }
    pub fn int(&self, name: &str) -> Option<i32> {
        match self.prop(name) {
            Some(Prop::Int(value)) => Some(value),
            _ => None,
        }
    }
    pub fn bool(&self, name: &str) -> Option<bool> {
        match self.prop(name) {
            Some(Prop::Bool(value)) => Some(value),
            _ => None,
        }
    }
    pub fn str(&self, name: &str) -> Option<&'static str> {
        match self.prop(name) {
            Some(Prop::Str(value)) => Some(value),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Room {
    pub id: &'static str,
    pub name: &'static str,
    /// Size in tiles: a whole number of screens, 30 by 20 each.
    pub cols: u16,
    pub rows: u16,
    /// Collision class index of every cell, row by row: painted overrides and the
    /// tiles' own classes already resolved.
    pub collision: &'static [u8],
    pub entities: &'static [Entity],
    /// Where its top-left screen sits on the world grid, if it is on the map.
    pub world: Option<(i16, i16)>,
    /// Index of the track that plays here.
    pub music: Option<u16>,
}

impl Room {
    pub const fn width(&self) -> i32 {
        self.cols as i32 * TILE
    }
    pub const fn height(&self) -> i32 {
        self.rows as i32 * TILE
    }
    /// Collision class index of a cell; 0 (the project's first class) outside the room.
    pub fn class_index(&self, col: i32, row: i32) -> u8 {
        if col < 0 || row < 0 || col >= self.cols as i32 || row >= self.rows as i32 {
            return 0;
        }
        self.collision[row as usize * self.cols as usize + col as usize]
    }
}

#[derive(Clone, Copy, Debug)]
pub struct World {
    pub rooms: &'static [Room],
    pub classes: &'static [CollisionClass],
    /// Index of the room a new game starts in.
    pub start: Option<u16>,
}

/// A grid of collision cells a body can move through.
pub trait Cells {
    /// The class of a cell. Where there is nothing, the project's first class.
    fn class(&self, col: i32, row: i32) -> &CollisionClass;

    /// The class of the cell holding a pixel.
    fn class_at(&self, x: i32, y: i32) -> &CollisionClass {
        self.class(x.div_euclid(TILE), y.div_euclid(TILE))
    }
}

/// One room on its own, in pixels from its top-left corner.
#[derive(Clone, Copy)]
pub struct RoomCells<'a> {
    pub world: &'a World,
    pub room: &'a Room,
}

impl Cells for RoomCells<'_> {
    fn class(&self, col: i32, row: i32) -> &CollisionClass {
        &self.world.classes[self.room.class_index(col, row) as usize]
    }
}

/// Every room on the map as one space, in world pixels: screen `(sx, sy)` of the map
/// starts at pixel `(sx * 240, sy * 160)`.
impl Cells for World {
    fn class(&self, col: i32, row: i32) -> &CollisionClass {
        const COLS: i32 = SCREEN_W / TILE;
        const ROWS: i32 = SCREEN_H / TILE;
        let index = self.room_at_screen(col.div_euclid(COLS), row.div_euclid(ROWS)).map_or(0, |room| {
            let room = &self.rooms[room];
            let (wx, wy) = room.world.unwrap_or((0, 0));
            room.class_index(col - wx as i32 * COLS, row - wy as i32 * ROWS)
        });
        &self.classes[index as usize]
    }
}

impl World {
    pub fn room_cells(&self, room: usize) -> RoomCells<'_> {
        RoomCells { world: self, room: &self.rooms[room] }
    }

    /// The room holding a world pixel.
    pub fn room_at(&self, x: i32, y: i32) -> Option<usize> {
        self.room_at_screen(x.div_euclid(SCREEN_W), y.div_euclid(SCREEN_H))
    }

    /// A room's top-left corner in world pixels, if it is on the map.
    pub fn origin(&self, room: usize) -> Option<(i32, i32)> {
        self.rooms[room].world.map(|(x, y)| (x as i32 * SCREEN_W, y as i32 * SCREEN_H))
    }

    /// Where the camera's top-left corner should be, in world pixels, to centre on a
    /// point of `room`. The view never shows a screen of the map that has no room, so
    /// it scrolls on into touching rooms and stops at the map's holes and edges.
    /// `joined` says whether another room may be on screen together with this one (a
    /// game refuses rooms whose tileset differs, as their palettes cannot be shown at once).
    pub fn camera_target(&self, room: usize, x: i32, y: i32, joined: impl Fn(usize) -> bool) -> (i32, i32) {
        let Some((left, top)) = self.origin(room) else {
            return (x - SCREEN_W / 2, y - SCREEN_H / 2);
        };
        let here = &self.rooms[room];
        let shown = |cx: i32, cy: i32| {
            let screens = |from: i32, size: i32| from.div_euclid(size)..=(from + size - 1).div_euclid(size);
            screens(cy, SCREEN_H).all(|sy| screens(cx, SCREEN_W).all(|sx| self.room_at_screen(sx, sy).is_some_and(|r| r == room || joined(r))))
        };
        let free = (x - SCREEN_W / 2, y - SCREEN_H / 2);
        let held = (free.0.clamp(left, left + here.width() - SCREEN_W), free.1.clamp(top, top + here.height() - SCREEN_H));
        // Follow freely if that shows rooms only; else hold one axis inside this room, then both.
        [free, (free.0, held.1), (held.0, free.1)].into_iter().find(|&(cx, cy)| shown(cx, cy)).unwrap_or(held)
    }

    /// The room covering a screen of the world grid.
    pub fn room_at_screen(&self, sx: i32, sy: i32) -> Option<usize> {
        self.rooms.iter().position(|room| {
            room.world.is_some_and(|(x, y)| {
                let (x, y) = (x as i32, y as i32);
                sx >= x && sy >= y && sx < x + room.cols as i32 * TILE / SCREEN_W && sy < y + room.rows as i32 * TILE / SCREEN_H
            })
        })
    }

    /// Where a point that left `room` (in that room's pixels) lands: the neighbouring
    /// room on the world grid and the same point in its pixels. `None` where the map ends.
    pub fn cross(&self, room: usize, x: i32, y: i32) -> Option<(usize, i32, i32)> {
        let (wx, wy) = self.rooms[room].world?;
        let world_x = wx as i32 * SCREEN_W + x;
        let world_y = wy as i32 * SCREEN_H + y;
        let next = self.room_at_screen(world_x.div_euclid(SCREEN_W), world_y.div_euclid(SCREEN_H))?;
        if next == room {
            return None;
        }
        let (nx, ny) = self.rooms[next].world?;
        Some((next, world_x - nx as i32 * SCREEN_W, world_y - ny as i32 * SCREEN_H))
    }
}
