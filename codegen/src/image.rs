//! PNG to the GBA's formats: 4-bit tiles, 16-colour palettes of 15-bit colour.
use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    path::Path,
};

pub const TILE: u32 = 8;
/// Bytes of one 8x8 tile at 4 bits a pixel.
pub const TILE_BYTES: usize = 32;
/// Colours a tile or sprite can use beside transparency.
const COLOURS: usize = 15;
const PALETTES: usize = 16;

pub struct Image {
    pub width: u32,
    pub height: u32,
    /// RGBA, row by row.
    pixels: Vec<[u8; 4]>,
}

impl Image {
    pub fn load(path: &Path) -> Result<Self, String> {
        let mut decoder = png::Decoder::new(File::open(path).map_err(|error| error.to_string())?);
        // Palettes, low bit depths and 16-bit samples all come out as 8-bit grey or RGB, with alpha if any.
        decoder.set_transformations(png::Transformations::normalize_to_color8());
        let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
        let mut buffer = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut buffer).map_err(|error| error.to_string())?;
        let bytes = &buffer[..info.buffer_size()];
        let pixels = match info.color_type {
            png::ColorType::Rgba => bytes.chunks_exact(4).map(|p| [p[0], p[1], p[2], p[3]]).collect(),
            png::ColorType::Rgb => bytes.chunks_exact(3).map(|p| [p[0], p[1], p[2], 255]).collect(),
            png::ColorType::GrayscaleAlpha => bytes.chunks_exact(2).map(|p| [p[0], p[0], p[0], p[1]]).collect(),
            png::ColorType::Grayscale => bytes.iter().map(|&g| [g, g, g, 255]).collect(),
            png::ColorType::Indexed => return Err("unexpected indexed output from the PNG decoder".into()),
        };
        Ok(Self { width: info.width, height: info.height, pixels })
    }

    #[cfg(test)]
    pub fn from_pixels(width: u32, height: u32, pixels: Vec<[u8; 4]>) -> Self {
        Self { width, height, pixels }
    }

    /// The GBA colour of a pixel, or `None` where it is transparent (alpha under half).
    fn colour(&self, x: u32, y: u32) -> Option<u16> {
        let [r, g, b, a] = self.pixels[(y * self.width + x) as usize];
        (a >= 128).then(|| (r as u16 >> 3) | ((g as u16 >> 3) << 5) | ((b as u16 >> 3) << 10))
    }

    /// For a sprite sheet saved with no transparency at all: clears its background, the
    /// colour of its top-left pixel, as sheets drawn on a flat backdrop mean it.
    fn keyed(&self) -> Option<Self> {
        if self.pixels.iter().any(|p| p[3] < 128) {
            return None;
        }
        let key = self.colour(0, 0);
        let pixels = (0..self.height).flat_map(|y| (0..self.width).map(move |x| (x, y)));
        let pixels = pixels.map(|(x, y)| if self.colour(x, y) == key { [0; 4] } else { self.pixels[(y * self.width + x) as usize] }).collect();
        Some(Self { width: self.width, height: self.height, pixels })
    }

    fn colours_in(&self, left: u32, top: u32, width: u32, height: u32) -> BTreeSet<u16> {
        (0..height).flat_map(|y| (0..width).map(move |x| (x, y))).filter_map(|(x, y)| self.colour(left + x, top + y)).collect()
    }

    /// An 8x8 block as 4-bit pixels: the index of each colour in `palette` plus one, 0 for transparent.
    fn tile(&self, left: u32, top: u32, palette: &[u16], out: &mut Vec<u8>) {
        let index = |x: u32, y: u32| self.colour(left + x, top + y).map_or(0, |c| palette.iter().position(|&p| p == c).unwrap() as u8 + 1);
        for y in 0..TILE {
            for x in (0..TILE).step_by(2) {
                out.push(index(x, y) | (index(x + 1, y) << 4));
            }
        }
    }
}

/// A palette as the hardware holds it: transparency first, then its colours.
fn hardware_palette(colours: &[u16]) -> [u16; 16] {
    let mut out = [0; 16];
    out[1..=colours.len()].copy_from_slice(colours);
    out
}

pub struct Tiles {
    /// [`TILE_BYTES`] per tile, numbered row by row as in the image.
    pub data: Vec<u8>,
    /// Which of `palettes` each tile is drawn with.
    pub tile_palettes: Vec<u8>,
    pub palettes: Vec<[u16; 16]>,
}

impl Tiles {
    pub fn count(&self) -> usize {
        self.tile_palettes.len()
    }
}

/// Cuts an image into 8x8 tiles and sorts their colours into at most 16 palettes of 15.
pub fn tileset(image: &Image) -> Result<Tiles, String> {
    if image.width % TILE != 0 || image.height % TILE != 0 {
        return Err(format!("is {}x{} pixels; an image of tiles must be a multiple of 8 each way", image.width, image.height));
    }
    let (cols, rows) = (image.width / TILE, image.height / TILE);
    let mut palettes: Vec<Vec<u16>> = Vec::new();
    let mut tile_palettes = Vec::new();
    for tile in 0..cols * rows {
        let colours = image.colours_in(tile % cols * TILE, tile / cols * TILE, TILE, TILE);
        if colours.len() > COLOURS {
            return Err(format!("tile {tile} uses {} colours; a GBA tile can use {COLOURS} plus transparency", colours.len()));
        }
        // The palette that needs the fewest colours added to hold this tile's.
        let missing = |palette: &Vec<u16>| colours.iter().filter(|c| !palette.contains(c)).count();
        let best = (0..palettes.len()).filter(|&p| palettes[p].len() + missing(&palettes[p]) <= COLOURS).min_by_key(|&p| missing(&palettes[p]));
        let chosen = match best {
            Some(p) => p,
            None if palettes.len() < PALETTES => {
                palettes.push(Vec::new());
                palettes.len() - 1
            }
            None => {
                return Err(format!(
                    "tile {tile} needs a 17th palette; the tiles' colours must fit {PALETTES} palettes of {COLOURS}. Use fewer colour combinations across tiles"
                ));
            }
        };
        for colour in colours {
            if !palettes[chosen].contains(&colour) {
                palettes[chosen].push(colour);
            }
        }
        tile_palettes.push(chosen as u8);
    }
    let mut data = Vec::with_capacity(tile_palettes.len() * TILE_BYTES);
    for tile in 0..cols * rows {
        image.tile(tile % cols * TILE, tile / cols * TILE, &palettes[tile_palettes[tile as usize] as usize], &mut data);
    }
    if palettes.is_empty() {
        palettes.push(Vec::new());
    }
    Ok(Tiles { data, tile_palettes, palettes: palettes.iter().map(|p| hardware_palette(p)).collect() })
}

pub struct Picture {
    /// The distinct tiles of the picture.
    pub tiles: Tiles,
    /// Size in tiles.
    pub cols: u32,
    pub rows: u32,
    /// Which of `tiles` each cell shows, row by row.
    pub cells: Vec<u16>,
}

/// Cuts a background picture into tiles like a tileset, keeping one of each tile that
/// repeats: video memory holds few tiles, and skies and walls are mostly repetition.
pub fn background(image: &Image) -> Result<Picture, String> {
    let all = tileset(image)?;
    let mut tiles = Tiles { data: Vec::new(), tile_palettes: Vec::new(), palettes: all.palettes };
    let mut seen: HashMap<(u8, &[u8]), u16> = HashMap::new();
    let mut cells = Vec::with_capacity(all.tile_palettes.len());
    for (pixels, &palette) in all.data.chunks_exact(TILE_BYTES).zip(&all.tile_palettes) {
        let next = tiles.tile_palettes.len() as u16;
        cells.push(*seen.entry((palette, pixels)).or_insert_with(|| {
            tiles.data.extend_from_slice(pixels);
            tiles.tile_palettes.push(palette);
            next
        }));
    }
    Ok(Picture { tiles, cols: image.width / TILE, rows: image.height / TILE, cells })
}

pub struct Sheet {
    /// Each frame's 8x8 tiles row by row, [`TILE_BYTES`] each, frame after frame.
    pub data: Vec<u8>,
    pub frames: usize,
    pub palette: [u16; 16],
}

/// Cuts a sprite sheet into frames of one size, all drawn with one 15-colour palette.
/// A sheet with no transparent pixel has its background colour (its top-left pixel) cleared.
pub fn sheet(image: &Image, width: u32, height: u32) -> Result<Sheet, String> {
    let keyed = image.keyed();
    let image = keyed.as_ref().unwrap_or(image);
    if image.width < width || image.height < height {
        return Err(format!("is {}x{} pixels, smaller than one {width}x{height} frame", image.width, image.height));
    }
    let (cols, rows) = (image.width / width, image.height / height);
    let colours: Vec<u16> = image.colours_in(0, 0, cols * width, rows * height).into_iter().collect();
    if colours.len() > COLOURS {
        return Err(format!("uses {} colours; a GBA sprite can use {COLOURS} plus transparency", colours.len()));
    }
    let mut data = Vec::new();
    for frame in 0..cols * rows {
        let (left, top) = (frame % cols * width, frame / cols * height);
        for ty in 0..height / TILE {
            for tx in 0..width / TILE {
                image.tile(left + tx * TILE, top + ty * TILE, &colours, &mut data);
            }
        }
    }
    Ok(Sheet { data, frames: (cols * rows) as usize, palette: hardware_palette(&colours) })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLEAR: [u8; 4] = [0, 0, 0, 0];
    fn rgb(n: u8) -> [u8; 4] {
        [n.wrapping_mul(8), n.wrapping_mul(16), 255 - n, 255]
    }

    #[test]
    fn packs_tiles_into_nibbles_and_shares_a_palette() {
        // Two tiles side by side: the first all one colour, the second that colour and another.
        let mut pixels = vec![rgb(1); 16 * 8];
        for y in 0..8 {
            pixels[y * 16 + 8] = rgb(2);
            pixels[y * 16 + 15] = CLEAR;
        }
        let tiles = tileset(&Image::from_pixels(16, 8, pixels)).unwrap();
        assert_eq!(tiles.count(), 2);
        assert_eq!(tiles.palettes.len(), 1);
        assert_eq!(tiles.tile_palettes, [0, 0]);
        assert_eq!(tiles.palettes[0][0], 0, "index 0 is transparency");
        assert_eq!(&tiles.data[..4], [0x11; 4]);
        // Second tile's row: colour 2 then colour 1 six times then transparent, low nibble first.
        assert_eq!(&tiles.data[32..36], [0x12, 0x11, 0x11, 0x01]);
    }

    #[test]
    fn opens_new_palettes_and_refuses_too_many_colours() {
        // Two tiles of 15 different colours each cannot share a palette.
        let mut pixels = Vec::new();
        for _y in 0..8 {
            for x in 0..16u8 {
                pixels.push(if x < 8 { rgb(x * 2 + _y as u8 % 2) } else { rgb(100 + (x - 8) * 2 + _y as u8 % 2) });
            }
        }
        // 16 colours per tile is one too many: trim each to 15 by clearing a pixel pair.
        let mut trimmed = pixels.clone();
        for y in 0..8 {
            if y % 2 == 1 {
                trimmed[y * 16 + 7] = rgb(0);
                trimmed[y * 16 + 15] = rgb(100);
            }
        }
        let tiles = tileset(&Image::from_pixels(16, 8, trimmed)).unwrap();
        assert_eq!(tiles.palettes.len(), 2);
        assert_eq!(tiles.tile_palettes, [0, 1]);
        let error = tileset(&Image::from_pixels(16, 8, pixels)).err().unwrap();
        assert!(error.contains("tile 0 uses 16 colours"), "{error}");
        assert!(tileset(&Image::from_pixels(12, 8, vec![CLEAR; 96])).is_err());
    }

    #[test]
    fn a_background_keeps_one_of_each_tile() {
        // Three tiles across and two down: all one colour, but for the last, which has a pixel of another.
        let mut pixels = vec![rgb(1); 24 * 16];
        pixels[15 * 24 + 23] = rgb(2);
        let picture = background(&Image::from_pixels(24, 16, pixels)).unwrap();
        assert_eq!((picture.cols, picture.rows), (3, 2));
        assert_eq!(picture.cells, [0, 0, 0, 0, 0, 1]);
        assert_eq!(picture.tiles.count(), 2);
        assert_eq!(picture.tiles.data.len(), 2 * TILE_BYTES);
        assert_eq!(picture.tiles.data[TILE_BYTES - 1], 0x11);
        assert_eq!(picture.tiles.data[2 * TILE_BYTES - 1], 0x21);
        assert!(background(&Image::from_pixels(24, 12, vec![CLEAR; 24 * 12])).is_err());
    }

    #[test]
    fn cuts_sheets_into_frames_of_tiles() {
        // Two 16x16 frames; the second has one pixel set in its bottom-right tile.
        let mut pixels = vec![CLEAR; 32 * 16];
        pixels[15 * 32 + 31] = rgb(3);
        let sheet = sheet(&Image::from_pixels(32, 16, pixels), 16, 16).unwrap();
        assert_eq!(sheet.frames, 2);
        assert_eq!(sheet.data.len(), 2 * 4 * TILE_BYTES);
        assert!(sheet.data[..4 * TILE_BYTES].iter().all(|&b| b == 0));
        // Frame 1, tile 3 (bottom-right), last byte: the pixel in the high nibble.
        assert_eq!(sheet.data[4 * TILE_BYTES + 3 * TILE_BYTES + 31], 0x10);
        assert_eq!(sheet.palette[0], 0);
        assert_ne!(sheet.palette[1], 0);
    }

    #[test]
    fn a_sheet_with_no_transparency_loses_its_background_colour() {
        // One 8x8 frame on a flat backdrop, with one pixel drawn at the end of its first row.
        let mut pixels = vec![rgb(1); 8 * 8];
        pixels[7] = rgb(2);
        let keyed = sheet(&Image::from_pixels(8, 8, pixels.clone()), 8, 8).unwrap();
        assert_eq!(keyed.data[3], 0x10);
        assert!(keyed.data[4..].iter().all(|&b| b == 0));
        assert_eq!(keyed.palette[2], 0, "the backdrop takes no palette entry");
        // With a transparent pixel anywhere, every colour is kept as drawn.
        pixels[63] = CLEAR;
        let kept = sheet(&Image::from_pixels(8, 8, pixels), 8, 8).unwrap();
        assert_ne!(kept.data[0], 0);
        assert_ne!(kept.palette[2], 0);
    }
}
