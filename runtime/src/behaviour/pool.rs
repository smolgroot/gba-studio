/// Up to `N` things made while the game runs, such as shots and spawned enemies, in a
/// fixed array: adding to a full pool fails, and nothing is allocated.
#[derive(Clone, Debug)]
pub struct Pool<T, const N: usize> {
    slots: [Option<T>; N],
}

impl<T, const N: usize> Default for Pool<T, N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T, const N: usize> Pool<T, N> {
    pub const fn new() -> Self {
        Self { slots: [const { None }; N] }
    }

    /// Puts a thing in a free slot and says which. When every slot is taken the thing
    /// comes back, so the game can drop it or make room.
    pub fn add(&mut self, thing: T) -> Result<usize, T> {
        match self.slots.iter().position(Option::is_none) {
            Some(slot) => {
                self.slots[slot] = Some(thing);
                Ok(slot)
            }
            None => Err(thing),
        }
    }

    /// Takes a thing out, freeing its slot.
    pub fn remove(&mut self, slot: usize) -> Option<T> {
        self.slots.get_mut(slot)?.take()
    }

    pub fn get(&self, slot: usize) -> Option<&T> {
        self.slots.get(slot)?.as_ref()
    }

    pub fn get_mut(&mut self, slot: usize) -> Option<&mut T> {
        self.slots.get_mut(slot)?.as_mut()
    }

    /// The things in the pool, with their slots.
    pub fn iter(&self) -> impl Iterator<Item = (usize, &T)> {
        self.slots.iter().enumerate().filter_map(|(slot, thing)| Some((slot, thing.as_ref()?)))
    }

    /// The things in the pool, with their slots, to change.
    pub fn iter_mut(&mut self) -> impl Iterator<Item = (usize, &mut T)> {
        self.slots.iter_mut().enumerate().filter_map(|(slot, thing)| Some((slot, thing.as_mut()?)))
    }

    /// Keeps only the things for which `keep` says true: the way to drop dead shots
    /// once a frame.
    pub fn retain(&mut self, mut keep: impl FnMut(&mut T) -> bool) {
        for slot in &mut self.slots {
            if slot.as_mut().is_some_and(|thing| !keep(thing)) {
                *slot = None;
            }
        }
    }

    pub fn len(&self) -> usize {
        self.slots.iter().filter(|slot| slot.is_some()).count()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.iter().all(Option::is_none)
    }

    pub fn is_full(&self) -> bool {
        self.slots.iter().all(Option::is_some)
    }
}
